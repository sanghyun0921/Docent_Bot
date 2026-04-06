#include "tb3_standalone_nav/controller/pure_pursuit_controller_server.hpp"
#include <thread>
#include <chrono>
#include "tf2_geometry_msgs/tf2_geometry_msgs.hpp"
#include "tf2/utils.h"

namespace tb3_standalone_nav
{
namespace controller
{

PurePursuitControllerServer::PurePursuitControllerServer(const rclcpp::NodeOptions & options)
: core::LifecycleNodeBase("pure_pursuit_controller_server", options)
{
}

core::CallbackReturn PurePursuitControllerServer::on_configure(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_configure(state);
  
  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(this->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

  cmd_vel_pub_ = this->create_publisher<geometry_msgs::msg::Twist>("cmd_vel", 10);
  
  scan_sub_ = this->create_subscription<sensor_msgs::msg::LaserScan>(
    "scan", 10, std::bind(&PurePursuitControllerServer::scan_callback, this, std::placeholders::_1));
  
  action_server_ = rclcpp_action::create_server<FollowPath>(
    this, "follow_path",
    std::bind(&PurePursuitControllerServer::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&PurePursuitControllerServer::handle_cancel, this, std::placeholders::_1),
    std::bind(&PurePursuitControllerServer::handle_accepted, this, std::placeholders::_1));

  return core::CallbackReturn::SUCCESS;
}

void PurePursuitControllerServer::scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(obs_mutex_);
  obstacles_.clear();

  geometry_msgs::msg::TransformStamped scan_to_base;
  try {
    scan_to_base = tf_buffer_->lookupTransform("base_footprint", msg->header.frame_id, tf2::TimePointZero);
  } catch (const tf2::TransformException & ex) {
    return;
  }

  for (size_t i = 0; i < msg->ranges.size(); ++i) {
    double r = msg->ranges[i];
    if (r > msg->range_min && r < msg->range_max) {
       double angle = msg->angle_min + i * msg->angle_increment;
       geometry_msgs::msg::Point pt, pt_base;
       pt.x = r * std::cos(angle);
       pt.y = r * std::sin(angle);
       pt.z = 0.0;
       
       tf2::doTransform(pt, pt_base, scan_to_base);
       
       // 로봇 기둥(0.22m) 밖의 장애물만 저장
       if (std::hypot(pt_base.x, pt_base.y) > 0.22) {
         obstacles_.push_back({pt_base.x, pt_base.y});
       }
    }
  }
}

core::CallbackReturn PurePursuitControllerServer::on_activate(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_activate(state);
  cmd_vel_pub_->on_activate();
  return core::CallbackReturn::SUCCESS;
}

core::CallbackReturn PurePursuitControllerServer::on_deactivate(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_deactivate(state);
  cmd_vel_pub_->on_deactivate();
  return core::CallbackReturn::SUCCESS;
}

rclcpp_action::GoalResponse PurePursuitControllerServer::handle_goal(
  const rclcpp_action::GoalUUID & /*uuid*/, std::shared_ptr<const FollowPath::Goal> /*goal*/)
{
  return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
}

rclcpp_action::CancelResponse PurePursuitControllerServer::handle_cancel(
  const std::shared_ptr<GoalHandleFollowPath> /*goal_handle*/)
{
  return rclcpp_action::CancelResponse::ACCEPT;
}

void PurePursuitControllerServer::handle_accepted(const std::shared_ptr<GoalHandleFollowPath> goal_handle)
{
  std::lock_guard<std::mutex> lock(thread_mutex_);
  if (active_goal_ && active_goal_->is_active()) {
    auto result = std::make_shared<FollowPath::Result>();
    active_goal_->canceled(result);
  }
  active_goal_ = goal_handle;

  using namespace std::placeholders;
  std::thread{std::bind(&PurePursuitControllerServer::execute, this, _1), goal_handle}.detach();
}

void PurePursuitControllerServer::execute(const std::shared_ptr<GoalHandleFollowPath> goal_handle)
{
  RCLCPP_INFO(this->get_logger(), "🏎️ [Pure Pursuit] 부드러운 곡선 자율주행 시작!");
  
  auto result = std::make_shared<FollowPath::Result>();
  auto goal = goal_handle->get_goal();
  rclcpp::Rate loop_rate(10); 
  
  nav_msgs::msg::Path global_plan = goal->path;
  
  if (global_plan.poses.empty()) {
    goal_handle->abort(result);
    return;
  }
  
  while (rclcpp::ok()) { 
    {
      std::lock_guard<std::mutex> lock(thread_mutex_);
      if (active_goal_ != goal_handle) return;
    }

    if (goal_handle->is_canceling()) {
      goal_handle->canceled(result);
      return;
    }
    
    double rx = 0.0, ry = 0.0, rtheta = 0.0;
    try {
      auto transform = tf_buffer_->lookupTransform("map", "base_footprint", tf2::TimePointZero);
      rx = transform.transform.translation.x;
      ry = transform.transform.translation.y;
      rtheta = tf2::getYaw(transform.transform.rotation);
    } catch (const tf2::TransformException & ex) {
      continue;
    }
    
    prune_plan(global_plan, rx, ry);
    
    if (global_plan.poses.empty()) {
      RCLCPP_INFO(this->get_logger(), "✅ 목적지 도착 완료!");
      break; 
    }
    
    geometry_msgs::msg::Twist cmd_vel;
    if (computeVelocityCommands(global_plan, cmd_vel, rx, ry, rtheta)) {
      cmd_vel_pub_->publish(cmd_vel);
      if (cmd_vel.linear.x == 0.0 && cmd_vel.angular.z == 0.0) {
        break; 
      }
    } else {
      // 장애물이 길을 막고 있을 때 Pure Pursuit는 길을 새로 찾도록 BT에 Failure를 반환합니다.
      RCLCPP_WARN(this->get_logger(), "🚨 경로 상에 장애물 발견! 플래너에게 새로운 경로를 요청합니다.");
      geometry_msgs::msg::Twist stop_vel;
      cmd_vel_pub_->publish(stop_vel); 
      goal_handle->abort(result);
      return;
    }
    
    loop_rate.sleep();
  }
  
  geometry_msgs::msg::Twist stop_vel;
  cmd_vel_pub_->publish(stop_vel);
  goal_handle->succeed(result);
}

// 🏎️ 핵심: 토끼(Lookahead Point)를 쫓아가는 Pure Pursuit 수학 연산
bool PurePursuitControllerServer::computeVelocityCommands(
  const nav_msgs::msg::Path & global_plan, geometry_msgs::msg::Twist & cmd_vel, double rx, double ry, double rtheta)
{
  if (global_plan.poses.empty()) return false;

  // 1. 내가 당장 가야 할 방향(토끼) 찾기
  double lookahead_dist = 0.4;
  auto target_pose = get_lookahead_point(global_plan, rx, ry, lookahead_dist).pose;
  
  double dx = target_pose.position.x - rx;
  double dy = target_pose.position.y - ry;
  double local_goal_x = dx * std::cos(-rtheta) - dy * std::sin(-rtheta);
  double local_goal_y = dx * std::sin(-rtheta) + dy * std::cos(-rtheta);
  double target_angle = std::atan2(local_goal_y, local_goal_x); // 가야 할 각도

  // 목적지가 0.2m 내로 들어오면 정지
  double dist_to_target = std::hypot(local_goal_x, local_goal_y);
  if (dist_to_target < 0.2) {
    cmd_vel.linear.x = 0.0;
    cmd_vel.angular.z = 0.0;
    return true; 
  }

  // 2. 🚨 완벽하게 스마트해진 장애물 검사 로직
  bool path_blocked = false;
  bool obstacle_very_close = false;

  {
    std::lock_guard<std::mutex> lock(obs_mutex_);
    for (const auto & obs : obstacles_) {
      double obs_x = obs.first;
      double obs_y = obs.second;
      double dist = std::hypot(obs_x, obs_y);
      
      if (dist < 0.35) { // 35cm 이내의 위험한 장애물
        double obs_angle = std::atan2(obs_y, obs_x); // 장애물의 실제 방향
        
        // 🚨 킬러 로직: 내가 가려는 방향(target_angle)과 장애물의 방향(obs_angle)의 차이 계산
        double angle_diff = obs_angle - target_angle;
        while (angle_diff > M_PI) angle_diff -= 2.0 * M_PI;
        while (angle_diff < -M_PI) angle_diff += 2.0 * M_PI;
        
        // 내가 나아갈 경로 기준 좌우 ±40도 안에 장애물이 있으면 "길이 진짜 막혔다"고 판단
        if (std::abs(angle_diff) < (M_PI / 4.5)) { 
          path_blocked = true;
          break;
        }

        // 경로를 막진 않았지만, 내 정면 코앞(0.2m)에 장애물이 있으면 스치거나 박을 수 있음
        if (obs_x > 0.0 && dist < 0.25 && std::abs(obs_y) < 0.15) {
          obstacle_very_close = true;
        }
      }
    }
  }

  // 🌟 내가 가려는 길이 진짜로 가로막혀 있을 때만 플래너에게 SOS!
  if (path_blocked) {
    return false; 
  }

  // 🌟 정면에 장애물이 있는데, 플래너가 피하라고 살짝 꺾어준 경로를 받은 상태라면?
  // -> 직진하면 모서리가 긁히므로, 일단 전진을 멈추고 제자리 회전으로 머리부터 돌립니다!
  if (obstacle_very_close && std::abs(target_angle) > 0.1) {
    cmd_vel.linear.x = 0.0; // 🚨 직진 절대 금지
    cmd_vel.angular.z = (target_angle > 0) ? 0.8 : -0.8;
    return true;
  }

  // 3. 평상시 부드러운 Pure Pursuit 곡선 주행 로직
  double v = 0.22; // 기본 주행 속도
  
  // 경로가 크게 꺾여 있다면(>45도), 속도를 줄여서 부드럽게 코너링
  if (std::abs(target_angle) > (M_PI / 4.0)) {
    v = 0.05; 
  }

  // 곡률 Kappa = 2 * sin(alpha) / L_d, 각속도 W = V * Kappa
  double w = (2.0 * v * std::sin(target_angle)) / lookahead_dist;

  if (w > 1.5) w = 1.5;
  if (w < -1.5) w = -1.5;

  cmd_vel.linear.x = v;
  cmd_vel.angular.z = w;
  
  return true;
}

void PurePursuitControllerServer::prune_plan(nav_msgs::msg::Path & global_plan, double robot_x, double robot_y)
{
  if (global_plan.poses.empty()) return;

  double min_dist = 1e9;
  size_t closest_idx = 0;

  for (size_t i = 0; i < global_plan.poses.size(); ++i) {
    double dist = std::hypot(global_plan.poses[i].pose.position.x - robot_x, 
                             global_plan.poses[i].pose.position.y - robot_y);
    if (dist < min_dist) {
      min_dist = dist;
      closest_idx = i;
    }
  }
  global_plan.poses.erase(global_plan.poses.begin(), global_plan.poses.begin() + closest_idx);
}

geometry_msgs::msg::PoseStamped PurePursuitControllerServer::get_lookahead_point(
  const nav_msgs::msg::Path & global_plan, double robot_x, double robot_y, double lookahead_dist)
{
  if (global_plan.poses.empty()) {
    geometry_msgs::msg::PoseStamped dummy;
    return dummy;
  }

  for (size_t i = 0; i < global_plan.poses.size(); ++i) {
    double dist = std::hypot(global_plan.poses[i].pose.position.x - robot_x, 
                             global_plan.poses[i].pose.position.y - robot_y);
    // 내 위치에서 Lookahead Distance 만큼 떨어져 있는 점을 찾음
    if (dist >= lookahead_dist) {
      return global_plan.poses[i];
    }
  }

  return global_plan.poses.back();
}

}  // namespace controller
}  // namespace tb3_standalone_nav

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::NodeOptions options;
  auto node = std::make_shared<tb3_standalone_nav::controller::PurePursuitControllerServer>(options);
  rclcpp::spin(node->get_node_base_interface());
  rclcpp::shutdown();
  return 0;
}
