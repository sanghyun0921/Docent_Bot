#include "tb3_standalone_nav/planner/a_star_planner_server.hpp"
#include <thread>
#include <queue>
#include <cmath>
#include <utility>
#include "tf2_geometry_msgs/tf2_geometry_msgs.hpp"
#include "tf2/utils.h"

namespace tb3_standalone_nav
{
namespace planner
{

AStarPlannerServer::AStarPlannerServer(const rclcpp::NodeOptions & options)
: core::LifecycleNodeBase("a_star_planner_server", options)
{
  costmap_ = std::make_shared<costmap::Costmap2D>(200, 200, 0.05, -5.0, -5.0);
}

core::CallbackReturn AStarPlannerServer::on_configure(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_configure(state);
  
  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(this->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

  action_server_ = rclcpp_action::create_server<ComputePathToPose>(
    this, "compute_path_to_pose",
    std::bind(&AStarPlannerServer::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
    std::bind(&AStarPlannerServer::handle_cancel, this, std::placeholders::_1),
    std::bind(&AStarPlannerServer::handle_accepted, this, std::placeholders::_1));
    
  rclcpp::QoS map_qos(rclcpp::KeepLast(1));
  map_qos.transient_local(); 
  map_sub_ = this->create_subscription<nav_msgs::msg::OccupancyGrid>(
    "map", map_qos, std::bind(&AStarPlannerServer::map_callback, this, std::placeholders::_1));

  scan_sub_ = this->create_subscription<sensor_msgs::msg::LaserScan>(
    "scan", 10, std::bind(&AStarPlannerServer::scan_callback, this, std::placeholders::_1));

  return core::CallbackReturn::SUCCESS;
}

void AStarPlannerServer::scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(costmap_mutex_);
  last_scan_ = msg; 
}

void AStarPlannerServer::map_callback(const nav_msgs::msg::OccupancyGrid::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(costmap_mutex_);
  
  map_width_ = msg->info.width;
  map_height_ = msg->info.height;
  map_res_ = msg->info.resolution;
  map_origin_x_ = msg->info.origin.position.x;
  map_origin_y_ = msg->info.origin.position.y;

  costmap_ = std::make_shared<costmap::Costmap2D>(map_width_, map_height_, map_res_, map_origin_x_, map_origin_y_);

  static_map_data_.assign(map_width_ * map_height_, 0);

  for (int y = 0; y < map_height_; ++y) {
    for (int x = 0; x < map_width_; ++x) {
      int index = x + (y * map_width_);
      int8_t map_data = msg->data[index];
      if (map_data == 100) static_map_data_[index] = 254; 
      else if (map_data == -1) static_map_data_[index] = 255; 
      else static_map_data_[index] = 0; 
    }
  }
  RCLCPP_INFO(this->get_logger(), "🗺️ 정적 지도 수신 완료! 이제 실시간 장애물도 반영하여 팽창합니다.");
}

void AStarPlannerServer::build_dynamic_costmap()
{
  if (static_map_data_.empty()) return;

  std::vector<unsigned char> temp_map = static_map_data_;

  if (last_scan_) {
    geometry_msgs::msg::TransformStamped scan_to_map;
    try {
      scan_to_map = tf_buffer_->lookupTransform("map", last_scan_->header.frame_id, tf2::TimePointZero);
      for (size_t i = 0; i < last_scan_->ranges.size(); i += 3) {
        double r = last_scan_->ranges[i];
        if (r > 0.15 && r < 3.5) { 
          double angle = last_scan_->angle_min + i * last_scan_->angle_increment;
          geometry_msgs::msg::Point pt, pt_map;
          pt.x = r * std::cos(angle);
          pt.y = r * std::sin(angle);
          pt.z = 0.0;
          
          tf2::doTransform(pt, pt_map, scan_to_map);
          
          unsigned int mx, my;
          if (costmap_->worldToMap(pt_map.x, pt_map.y, mx, my)) {
            temp_map[my * map_width_ + mx] = 254;
          }
        }
      }
    } catch (...) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 1000, "동적 맵 생성을 위한 TF 대기 중...");
    }
  }

  for (int y = 0; y < map_height_; ++y) {
    for (int x = 0; x < map_width_; ++x) {
      costmap_->setCost(x, y, 0); 
    }
  }

  // 🚨 수정 1: 팽창 반경을 기존 0.3m -> 0.60m 로 무려 2배 늘렸습니다!
  // 이제 상자가 떨어지면 상자 주변 0.6m 전체가 시뻘건 위험 구역이 됩니다.
  int inflation_radius_cells = std::ceil(0.60 / map_res_); 

  for (int y = 0; y < map_height_; ++y) {
    for (int x = 0; x < map_width_; ++x) {
      if (temp_map[y * map_width_ + x] == 254) {
        costmap_->setCost(x, y, 254);
        
        for (int dy = -inflation_radius_cells; dy <= inflation_radius_cells; ++dy) {
          for (int dx = -inflation_radius_cells; dx <= inflation_radius_cells; ++dx) {
            double dist = std::hypot(dx, dy);
            if (dist <= inflation_radius_cells) {
              int nx = x + dx;
              int ny = y + dy;
              if (nx >= 0 && nx < map_width_ && ny >= 0 && ny < map_height_) {
                int n_idx = ny * map_width_ + nx;
                if (temp_map[n_idx] != 254 && temp_map[n_idx] != 255) {
                  unsigned char inf_cost = static_cast<unsigned char>(253.0 * (1.0 - (dist / (inflation_radius_cells + 1.0))));
                  if (inf_cost > costmap_->getCost(nx, ny)) {
                    costmap_->setCost(nx, ny, inf_cost);
                  }
                }
              }
            }
          }
        }
      } else if (costmap_->getCost(x, y) == 0 && temp_map[y * map_width_ + x] == 255) {
         costmap_->setCost(x, y, 255);
      }
    }
  }
}

core::CallbackReturn AStarPlannerServer::on_activate(const rclcpp_lifecycle::State & state) {
  core::LifecycleNodeBase::on_activate(state); return core::CallbackReturn::SUCCESS;
}
core::CallbackReturn AStarPlannerServer::on_deactivate(const rclcpp_lifecycle::State & state) {
  core::LifecycleNodeBase::on_deactivate(state); return core::CallbackReturn::SUCCESS;
}
rclcpp_action::GoalResponse AStarPlannerServer::handle_goal(const rclcpp_action::GoalUUID & /*uuid*/, std::shared_ptr<const ComputePathToPose::Goal> /*goal*/) {
  return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
}
rclcpp_action::CancelResponse AStarPlannerServer::handle_cancel(const std::shared_ptr<GoalHandleComputePathToPose> /*goal_handle*/) {
  return rclcpp_action::CancelResponse::ACCEPT;
}
void AStarPlannerServer::handle_accepted(const std::shared_ptr<GoalHandleComputePathToPose> goal_handle) {
  std::thread{std::bind(&AStarPlannerServer::execute, this, std::placeholders::_1), goal_handle}.detach();
}

void AStarPlannerServer::execute(const std::shared_ptr<GoalHandleComputePathToPose> goal_handle)
{
  RCLCPP_INFO(this->get_logger(), "🧠 A* 경로 탐색 시작 (실시간 장애물 회피 고려 중...)");
  auto result = std::make_shared<ComputePathToPose::Result>();
  auto action_goal = goal_handle->get_goal();
  nav_msgs::msg::Path plan;
  geometry_msgs::msg::PoseStamped start_pose;

  if (action_goal->use_start) {
    start_pose = action_goal->start;
  } else {
    try {
      auto transform = tf_buffer_->lookupTransform("map", "base_footprint", tf2::TimePointZero);
      start_pose.header.frame_id = "map";
      start_pose.header.stamp = this->now();
      start_pose.pose.position.x = transform.transform.translation.x;
      start_pose.pose.position.y = transform.transform.translation.y;
      start_pose.pose.position.z = transform.transform.translation.z;
      start_pose.pose.orientation = transform.transform.rotation;
    } catch (...) {
      goal_handle->abort(result);
      return;
    }
  }
  
  if (makePlan(start_pose, action_goal->goal, plan)) {
    RCLCPP_INFO(this->get_logger(), "✅ 안전하고 '크게' 우회하는 새로운 경로 생성 완료!");
    result->path = plan;
    goal_handle->succeed(result);
  } else {
    goal_handle->abort(result);
  }
}

bool AStarPlannerServer::makePlan(const geometry_msgs::msg::PoseStamped & start, const geometry_msgs::msg::PoseStamped & goal, nav_msgs::msg::Path & plan)
{
  std::lock_guard<std::mutex> lock(costmap_mutex_);

  build_dynamic_costmap();

  plan.header.stamp = this->now();
  plan.header.frame_id = "map";

  unsigned int mx_start, my_start, mx_goal, my_goal;
  if (!costmap_->worldToMap(start.pose.position.x, start.pose.position.y, mx_start, my_start) ||
      !costmap_->worldToMap(goal.pose.position.x, goal.pose.position.y, mx_goal, my_goal)) {
    return false;
  }

  int size_x = costmap_->getSizeInCellsX();
  int size_y = costmap_->getSizeInCellsY();
  int total_cells = size_x * size_y;

  std::vector<double> g_score(total_cells, 1e9);
  std::vector<int> came_from(total_cells, -1);

  auto heuristic = [&](int x1, int y1, int x2, int y2) {
    return std::hypot(x1 - x2, y1 - y2);
  };

  struct Node {
    int index;
    double f_score;
    bool operator>(const Node& other) const { return f_score > other.f_score; }
  };

  std::priority_queue<Node, std::vector<Node>, std::greater<Node>> open_set;

  int start_idx = my_start * size_x + mx_start;
  int goal_idx = my_goal * size_x + mx_goal;

  g_score[start_idx] = 0.0;
  open_set.push({start_idx, heuristic(mx_start, my_start, mx_goal, my_goal)});

  int dx[] = {-1, 0, 1, -1, 1, -1, 0, 1};
  int dy[] = {-1, -1, -1, 0, 0, 1, 1, 1};
  double cost[] = {1.414, 1.0, 1.414, 1.0, 1.0, 1.414, 1.0, 1.414};

  bool found = false;

  while (!open_set.empty()) {
    int curr = open_set.top().index;
    open_set.pop();

    if (curr == goal_idx) { found = true; break; }

    int cx = curr % size_x;
    int cy = curr / size_x;

    for (int i = 0; i < 8; ++i) {
      int nx = cx + dx[i];
      int ny = cy + dy[i];

      if (nx >= 0 && nx < size_x && ny >= 0 && ny < size_y) {
        int neighbor = ny * size_x + nx;
        unsigned char c_val = costmap_->getCost(nx, ny);

        if (c_val == 254) continue; 

        // 🚨 수정 2: 장애물 근처 페널티를 기존 80점에서 500점으로 핵폭탄급 상향!
        // A*는 단 1칸이라도 장애물 근처로 가느니, 차라리 25미터(500칸)를 돌아가는 게 낫다고 판단하게 됩니다.
        double penalty = (c_val / 253.0) * 500.0; 
        double tentative_g = g_score[curr] + cost[i] + penalty;

        if (tentative_g < g_score[neighbor]) {
          came_from[neighbor] = curr;
          g_score[neighbor] = tentative_g;
          double f = tentative_g + heuristic(nx, ny, mx_goal, my_goal);
          open_set.push({neighbor, f});
        }
      }
    }
  }

  if (found) {
    std::vector<int> path_indices;
    int curr = goal_idx;
    while (curr != -1) {
      path_indices.push_back(curr);
      curr = came_from[curr];
    }
    std::reverse(path_indices.begin(), path_indices.end());

    std::vector<std::pair<double, double>> smooth_path(path_indices.size());
    for (size_t i = 0; i < path_indices.size(); ++i) {
      double wx, wy;
      costmap_->mapToWorld(path_indices[i] % size_x, path_indices[i] / size_x, wx, wy);
      smooth_path[i] = {wx, wy};
    }

    if (smooth_path.size() > 2) {
      std::vector<std::pair<double, double>> new_path = smooth_path;
      double beta = 0.3; 
      for (int iter = 0; iter < 10; ++iter) { 
        for (size_t i = 1; i < smooth_path.size() - 1; ++i) {
          new_path[i].first += beta * (new_path[i-1].first + new_path[i+1].first - 2.0 * new_path[i].first);
          new_path[i].second += beta * (new_path[i-1].second + new_path[i+1].second - 2.0 * new_path[i].second);
        }
      }
      smooth_path = new_path;
    }

    for (size_t i = 0; i < smooth_path.size(); ++i) {
      geometry_msgs::msg::PoseStamped pose;
      pose.header = plan.header;
      pose.pose.position.x = smooth_path[i].first;
      pose.pose.position.y = smooth_path[i].second;
      plan.poses.push_back(pose);
    }
    return true;
  }
  return false;
}

}  // namespace planner
}  // namespace tb3_standalone_nav

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::NodeOptions options;
  auto node = std::make_shared<tb3_standalone_nav::planner::AStarPlannerServer>(options);
  rclcpp::spin(node->get_node_base_interface());
  rclcpp::shutdown();
  return 0;
}
