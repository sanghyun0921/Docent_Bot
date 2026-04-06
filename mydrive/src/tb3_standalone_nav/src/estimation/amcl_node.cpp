#include "tb3_standalone_nav/estimation/amcl_node.hpp"
#include "geometry_msgs/msg/transform_stamped.hpp"
#include "tf2/utils.h"
#include "tf2_geometry_msgs/tf2_geometry_msgs.hpp"
#include <cmath>
#include <algorithm>

namespace tb3_standalone_nav
{
namespace estimation
{

AMCLNode::AMCLNode(const rclcpp::NodeOptions & options)
: core::LifecycleNodeBase("amcl_node", options)
{
  this->declare_parameter("num_particles", 250);
  this->get_parameter("num_particles", num_particles_);

  this->declare_parameter("laser_max_range", 3.5);
  this->declare_parameter("z_hit", 0.9);
  this->declare_parameter("z_rand", 0.1);
  this->declare_parameter("alpha1", 0.2); 
  this->declare_parameter("alpha2", 0.2); 
  this->declare_parameter("alpha3", 0.2); 

  this->get_parameter("laser_max_range", laser_max_range_);
  this->get_parameter("z_hit", z_hit_);
  this->get_parameter("z_rand", z_rand_);
  this->get_parameter("alpha1", alpha1_);
  this->get_parameter("alpha2", alpha2_);
  this->get_parameter("alpha3", alpha3_);
}

core::CallbackReturn AMCLNode::on_configure(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_configure(state);

  tf_buffer_ = std::make_shared<tf2_ros::Buffer>(this->get_clock());
  tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);
  tf_broadcaster_ = std::make_shared<tf2_ros::TransformBroadcaster>(this);

  auto qos = rclcpp::QoS(rclcpp::KeepLast(1)).transient_local();

  initial_pose_sub_ = this->create_subscription<geometry_msgs::msg::PoseWithCovarianceStamped>(
    "initialpose", 10, std::bind(&AMCLNode::initial_pose_callback, this, std::placeholders::_1));

  map_sub_ = this->create_subscription<nav_msgs::msg::OccupancyGrid>(
    "map", qos, std::bind(&AMCLNode::map_callback, this, std::placeholders::_1));

  scan_sub_ = this->create_subscription<sensor_msgs::msg::LaserScan>(
    "scan", 10, std::bind(&AMCLNode::scan_callback, this, std::placeholders::_1));

  particle_pub_ = this->create_publisher<geometry_msgs::msg::PoseArray>("particle_cloud", 10);

  return core::CallbackReturn::SUCCESS;
}

core::CallbackReturn AMCLNode::on_activate(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_activate(state);
  particle_pub_->on_activate();
  RCLCPP_INFO(this->get_logger(), "AMCL Custom Particle Filter Activated. Waiting for map and initialpose...");
  return core::CallbackReturn::SUCCESS;
}

core::CallbackReturn AMCLNode::on_deactivate(const rclcpp_lifecycle::State & state)
{
  core::LifecycleNodeBase::on_deactivate(state);
  particle_pub_->on_deactivate();
  return core::CallbackReturn::SUCCESS;
}

void AMCLNode::map_callback(const nav_msgs::msg::OccupancyGrid::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(mutex_);
  map_ = msg;
  RCLCPP_INFO(this->get_logger(), "Map received! Resolution: %.3f", map_->info.resolution);
}

void AMCLNode::initial_pose_callback(const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(mutex_);
  double start_x = msg->pose.pose.position.x;
  double start_y = msg->pose.pose.position.y;
  double start_theta = tf2::getYaw(msg->pose.pose.orientation);

  initialize_particles(start_x, start_y, start_theta);
  initialized_ = true;
  first_odom_ = true;
  
  last_scan_time_ = this->now();
  latest_scan_stamp_ = msg->header.stamp;
  
  RCLCPP_INFO(this->get_logger(), "Initial pose set to x:%.2f y:%.2f th:%.2f. Particles scattered.", start_x, start_y, start_theta);
  publish_particles_and_tf();
}

void AMCLNode::initialize_particles(double x, double y, double theta)
{
  particles_.clear();
  std::random_device rd;
  std::mt19937 gen(rd());
  std::normal_distribution<> d_x(x, 0.2); 
  std::normal_distribution<> d_y(y, 0.2); 
  std::normal_distribution<> d_th(theta, 0.1); 

  double initial_weight = 1.0 / num_particles_;
  for (int i = 0; i < num_particles_; ++i) {
    Particle p;
    p.x = d_x(gen);
    p.y = d_y(gen);
    p.theta = d_th(gen);
    p.weight = initial_weight;
    particles_.push_back(p);
  }
}

void AMCLNode::scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg)
{
  std::lock_guard<std::mutex> lock(mutex_);
  
  if (!initialized_ || !map_) {
    return;
  }
  
  latest_scan_stamp_ = msg->header.stamp;

  // 라이다 오프셋 1회 초기화
  if (!laser_offset_initialized_) {
    try {
      geometry_msgs::msg::TransformStamped base_to_scan = 
          tf_buffer_->lookupTransform("base_footprint", msg->header.frame_id, tf2::TimePointZero);
      laser_x_offset_ = base_to_scan.transform.translation.x;
      laser_y_offset_ = base_to_scan.transform.translation.y;
      laser_theta_offset_ = tf2::getYaw(base_to_scan.transform.rotation);
      laser_offset_initialized_ = true;
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 1000, "Waiting for base->scan TF...");
      return;
    }
  }

  // Odom 데이터 가져오기 (시간 캐시 에러 방지를 위해 TimePointZero 사용)
  geometry_msgs::msg::TransformStamped odom_to_base;
  try {
    odom_to_base = tf_buffer_->lookupTransform("odom", "base_footprint", tf2::TimePointZero);
  } catch (const tf2::TransformException & ex) {
    RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 1000, "Waiting for odom TF...");
    return;
  }

  double current_odom_x = odom_to_base.transform.translation.x;
  double current_odom_y = odom_to_base.transform.translation.y;
  double current_odom_theta = tf2::getYaw(odom_to_base.transform.rotation);

  if (first_odom_) {
    last_odom_x_ = current_odom_x;
    last_odom_y_ = current_odom_y;
    last_odom_theta_ = current_odom_theta;
    first_odom_ = false;
    return;
  }

  // 누적 이동 거리 계산
  double dx_odom = current_odom_x - last_odom_x_;
  double dy_odom = current_odom_y - last_odom_y_;
  double dtheta_odom = current_odom_theta - last_odom_theta_;

  // 각도 Wrap-around 방어
  while (dtheta_odom > M_PI) dtheta_odom -= 2.0 * M_PI;
  while (dtheta_odom < -M_PI) dtheta_odom += 2.0 * M_PI;

  // 🚨[핵심 버그 수정]: 5cm, 5도 이상 움직이지 않았다면 아무것도 안 하고 return (last_odom 업데이트 X!!)
  if (std::abs(dx_odom) < 0.05 && std::abs(dy_odom) < 0.05 && std::abs(dtheta_odom) < 0.08) {
    if ((this->now() - last_scan_time_).seconds() > 0.5) {
      publish_particles_and_tf(); // 가만히 있어도 0.5초마다 TF는 쏴줍니다.
      last_scan_time_ = this->now();
    }
    return;
  }

  // 🚨 로봇이 확실히 이동했을 때만 파티클을 굴리고 last_odom_x_를 업데이트합니다.
  double cos_last = std::cos(last_odom_theta_);
  double sin_last = std::sin(last_odom_theta_);
  double d_fwd = dx_odom * cos_last + dy_odom * sin_last;
  double d_side = -dx_odom * sin_last + dy_odom * cos_last;

  last_odom_x_ = current_odom_x;
  last_odom_y_ = current_odom_y;
  last_odom_theta_ = current_odom_theta;
  
  last_scan_time_ = this->now();

  predict(d_fwd, d_side, dtheta_odom);
  update_weights(msg);
  resample();
  publish_particles_and_tf();
}

void AMCLNode::predict(double d_fwd, double d_side, double dtheta)
{
  std::random_device rd;
  std::mt19937 gen(rd());

  double std_fwd = std::abs(d_fwd) * alpha1_ + std::abs(dtheta) * alpha2_;
  double std_side = std::abs(d_side) * alpha1_ + std::abs(dtheta) * alpha2_;
  double std_th = std::abs(dtheta) * alpha3_ + std::abs(d_fwd) * alpha1_;

  std::normal_distribution<> noise_fwd(0.0, std_fwd + 0.01);
  std::normal_distribution<> noise_side(0.0, std_side + 0.01);
  std::normal_distribution<> noise_th(0.0, std_th + 0.02);

  for (auto & p : particles_) {
    double n_fwd = d_fwd + noise_fwd(gen);
    double n_side = d_side + noise_side(gen);
    double n_th = dtheta + noise_th(gen);

    p.x += n_fwd * std::cos(p.theta) - n_side * std::sin(p.theta);
    p.y += n_fwd * std::sin(p.theta) + n_side * std::cos(p.theta);
    p.theta += n_th;
    
    p.theta = std::atan2(std::sin(p.theta), std::cos(p.theta));
  }
}

void AMCLNode::update_weights(const sensor_msgs::msg::LaserScan::SharedPtr & scan)
{
  double total_weight = 0.0;
  for (auto & p : particles_) {
    p.weight = compute_laser_weight(p, scan);
    
    // 파티클의 우열을 가리기 위해 점수를 제곱하여 좋은 파티클을 부각시킴
    p.weight = std::pow(p.weight, 2); 
    total_weight += p.weight;
  }

  if (total_weight > 0.0) {
    for (auto & p : particles_) p.weight /= total_weight;
  } else {
    double uniform_w = 1.0 / num_particles_;
    for (auto & p : particles_) p.weight = uniform_w;
  }
}

double AMCLNode::compute_laser_weight(const Particle & p, const sensor_msgs::msg::LaserScan::SharedPtr & scan)
{
  double weight = 0.0; 
  int beam_skip = 5; // 점 데이터를 더 촘촘하게 검사
  int valid_beams = 0;

  double laser_x = p.x + laser_x_offset_ * std::cos(p.theta) - laser_y_offset_ * std::sin(p.theta);
  double laser_y = p.y + laser_x_offset_ * std::sin(p.theta) + laser_y_offset_ * std::cos(p.theta);
  double laser_theta = p.theta + laser_theta_offset_;

  for (size_t i = 0; i < scan->ranges.size(); i += beam_skip) {
    double r = scan->ranges[i];
    if (r < scan->range_min || r > laser_max_range_ || std::isinf(r) || std::isnan(r)) {
      continue; 
    }
    valid_beams++;

    double angle = laser_theta + scan->angle_min + i * scan->angle_increment;
    double beam_x = laser_x + r * std::cos(angle);
    double beam_y = laser_y + r * std::sin(angle);

    int cost = get_map_cost(beam_x, beam_y);
    double score = 0.01; 
    
    // 덧셈 모델용 점수 부여 로직 (벽에 맞으면 고득점!)
    if (cost > 80) {
      score = 5.0; 
    } else if (cost == -1) {
      score = 0.1; 
    } else {
      bool near_wall = false;
      bool mid_wall = false;
      
      for(int dy = -1; dy <= 1; ++dy) {
        for(int dx = -1; dx <= 1; ++dx) {
           if (get_map_cost(beam_x + dx*0.05, beam_y + dy*0.05) > 80) {
             near_wall = true; break;
           }
        }
        if(near_wall) break;
      }
      
      if (near_wall) {
        score = 2.0; 
      } else {
        for(int dy = -2; dy <= 2; ++dy) {
          for(int dx = -2; dx <= 2; ++dx) {
             if (get_map_cost(beam_x + dx*0.05, beam_y + dy*0.05) > 80) {
               mid_wall = true; break;
             }
          }
          if(mid_wall) break;
        }
        if (mid_wall) score = 0.5; 
      }
    }
    weight += score; 
  }
  
  if (valid_beams == 0) return 1e-5; 
  return weight;
}

int AMCLNode::get_map_cost(double x, double y)
{
  if (!map_) return -1;
  double res = map_->info.resolution;
  double ox = map_->info.origin.position.x;
  double oy = map_->info.origin.position.y;

  int mx = static_cast<int>((x - ox) / res);
  int my = static_cast<int>((y - oy) / res);

  if (mx < 0 || mx >= static_cast<int>(map_->info.width) || my < 0 || my >= static_cast<int>(map_->info.height)) {
    return -1;
  }

  int index = my * map_->info.width + mx;
  return map_->data[index];
}

void AMCLNode::resample()
{
  std::vector<Particle> new_particles;
  new_particles.reserve(num_particles_);

  std::vector<double> weights;
  for (const auto & p : particles_) weights.push_back(p.weight);

  std::random_device rd;
  std::mt19937 gen(rd());
  std::discrete_distribution<> dist(weights.begin(), weights.end());

  for (int i = 0; i < num_particles_; ++i) {
    int idx = dist(gen);
    new_particles.push_back(particles_[idx]);
    new_particles.back().weight = 1.0 / num_particles_; 
  }

  particles_ = new_particles;
}

void AMCLNode::publish_particles_and_tf()
{
  if (particles_.empty()) return;

  geometry_msgs::msg::PoseArray cloud;
  cloud.header.stamp = this->now();
  cloud.header.frame_id = "map";

  double sum_x = 0.0, sum_y = 0.0;
  double sum_sin = 0.0, sum_cos = 0.0;

  for (const auto & p : particles_) {
    geometry_msgs::msg::Pose pose;
    pose.position.x = p.x;
    pose.position.y = p.y;
    tf2::Quaternion q;
    q.setRPY(0.0, 0.0, p.theta);
    pose.orientation.x = q.x();
    pose.orientation.y = q.y();
    pose.orientation.z = q.z();
    pose.orientation.w = q.w();
    cloud.poses.push_back(pose);

    sum_x += p.x;
    sum_y += p.y;
    sum_sin += std::sin(p.theta);
    sum_cos += std::cos(p.theta);
  }
  
  particle_pub_->publish(cloud);

  double mean_x = sum_x / num_particles_;
  double mean_y = sum_y / num_particles_;
  double mean_theta = std::atan2(sum_sin / num_particles_, sum_cos / num_particles_);

  geometry_msgs::msg::TransformStamped odom_to_base;
  try {
    odom_to_base = tf_buffer_->lookupTransform("odom", "base_footprint", tf2::TimePointZero);
  } catch (const tf2::TransformException & ex) {
    return; 
  }

  tf2::Transform tf_map_to_base;
  tf_map_to_base.setOrigin(tf2::Vector3(mean_x, mean_y, 0.0));
  tf2::Quaternion q_base;
  q_base.setRPY(0.0, 0.0, mean_theta);
  tf_map_to_base.setRotation(q_base);

  tf2::Transform tf_odom_to_base;
  tf2::fromMsg(odom_to_base.transform, tf_odom_to_base);

  tf2::Transform tf_map_to_odom = tf_map_to_base * tf_odom_to_base.inverse();

  geometry_msgs::msg::TransformStamped t;
  t.header.stamp = this->now();
  t.header.frame_id = "map";
  t.child_frame_id = "odom";
  t.transform = tf2::toMsg(tf_map_to_odom);

  tf_broadcaster_->sendTransform(t);
}

}  // namespace estimation
}  // namespace tb3_standalone_nav

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::NodeOptions options;
  auto node = std::make_shared<tb3_standalone_nav::estimation::AMCLNode>(options);
  
  // 생명주기 노드(LifecycleNode)는 이렇게 spin을 돌려주어야 합니다.
  rclcpp::spin(node->get_node_base_interface());
  
  rclcpp::shutdown();
  return 0;
}
