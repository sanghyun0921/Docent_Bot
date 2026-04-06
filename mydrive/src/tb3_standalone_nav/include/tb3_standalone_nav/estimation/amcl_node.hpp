#ifndef TB3_STANDALONE_NAV__ESTIMATION__AMCL_NODE_HPP_
#define TB3_STANDALONE_NAV__ESTIMATION__AMCL_NODE_HPP_

#include "rclcpp_lifecycle/lifecycle_publisher.hpp"
#include "rclcpp/rclcpp.hpp"
#include "geometry_msgs/msg/pose_with_covariance_stamped.hpp"
#include "geometry_msgs/msg/pose_array.hpp"
#include "sensor_msgs/msg/laser_scan.hpp"
#include "nav_msgs/msg/occupancy_grid.hpp"
#include "nav_msgs/msg/odometry.hpp"

#include "tf2_ros/transform_broadcaster.h"
#include "tf2_ros/transform_listener.h"
#include "tf2_ros/buffer.h"

#include "tb3_standalone_nav/core/lifecycle_node_base.hpp"

#include <vector>
#include <random>
#include <mutex>

namespace tb3_standalone_nav
{
namespace estimation
{

struct Particle {
  double x;
  double y;
  double theta;
  double weight;
};

class AMCLNode : public core::LifecycleNodeBase
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  explicit AMCLNode(const rclcpp::NodeOptions & options = rclcpp::NodeOptions());

  TB3_STANDALONE_NAV_PUBLIC
  ~AMCLNode() override = default;

protected:
  core::CallbackReturn on_configure(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_activate(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_deactivate(const rclcpp_lifecycle::State & state) override;

private:
  void initial_pose_callback(const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg);
  void map_callback(const nav_msgs::msg::OccupancyGrid::SharedPtr msg);
  void scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg);
  
  void initialize_particles(double x, double y, double theta);
  void predict(double dx, double dy, double dtheta);
  void update_weights(const sensor_msgs::msg::LaserScan::SharedPtr & scan);
  void resample();
  void publish_particles_and_tf();
  
  double compute_laser_weight(const Particle & p, const sensor_msgs::msg::LaserScan::SharedPtr & scan);
  int get_map_cost(double x, double y);

  // Subscriptions & Publishers
  rclcpp::Subscription<geometry_msgs::msg::PoseWithCovarianceStamped>::SharedPtr initial_pose_sub_;
  rclcpp::Subscription<nav_msgs::msg::OccupancyGrid>::SharedPtr map_sub_;
  rclcpp::Subscription<sensor_msgs::msg::LaserScan>::SharedPtr scan_sub_;
  std::shared_ptr<rclcpp_lifecycle::LifecyclePublisher<geometry_msgs::msg::PoseArray>> particle_pub_;

  // TF2
  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;
  std::shared_ptr<tf2_ros::TransformBroadcaster> tf_broadcaster_;

  // State
  std::mutex mutex_;
  bool initialized_ = false;
  nav_msgs::msg::OccupancyGrid::SharedPtr map_;
  std::vector<Particle> particles_;
  
  rclcpp::Time last_scan_time_;
  rclcpp::Time latest_scan_stamp_;
  double last_odom_x_ = 0.0;
  double last_odom_y_ = 0.0;
  double last_odom_theta_ = 0.0;
  bool first_odom_ = true;

  // 🚨 [추가됨] 라이다 센서 위치 오프셋 변수들
  bool laser_offset_initialized_ = false;
  double laser_x_offset_ = 0.0;
  double laser_y_offset_ = 0.0;
  double laser_theta_offset_ = 0.0;

  // Parameters
  int num_particles_ = 200;
  double alpha1_ = 0.2; // noise in x from x
  double alpha2_ = 0.2; // noise in y from y
  double alpha3_ = 0.2; // noise in theta from theta
  double laser_max_range_ = 3.5;
  double z_hit_ = 0.95;
  double z_rand_ = 0.05;
  double sigma_hit_ = 0.2;
};

}  // namespace estimation
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__ESTIMATION__AMCL_NODE_HPP_
