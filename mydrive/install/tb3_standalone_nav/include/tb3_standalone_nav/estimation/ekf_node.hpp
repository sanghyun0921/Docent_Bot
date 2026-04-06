#ifndef TB3_STANDALONE_NAV__ESTIMATION__EKF_NODE_HPP_
#define TB3_STANDALONE_NAV__ESTIMATION__EKF_NODE_HPP_

#include "tb3_standalone_nav/core/lifecycle_node_base.hpp"
#include "nav_msgs/msg/odometry.hpp"
#include "sensor_msgs/msg/imu.hpp"

namespace tb3_standalone_nav
{
namespace estimation
{

/**
 * @class EKFNode
 * @brief Left as a placeholder. Real TB3 bringup already handles odom -> base_footprint.
 */
class EKFNode : public core::LifecycleNodeBase
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  explicit EKFNode(const rclcpp::NodeOptions & options = rclcpp::NodeOptions());

  TB3_STANDALONE_NAV_PUBLIC
  ~EKFNode() override = default;

protected:
  core::CallbackReturn on_configure(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_activate(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_deactivate(const rclcpp_lifecycle::State & state) override;

private:
  void odom_callback(const nav_msgs::msg::Odometry::SharedPtr msg);
  void imu_callback(const sensor_msgs::msg::Imu::SharedPtr msg);

  rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr odom_sub_;
  rclcpp::Subscription<sensor_msgs::msg::Imu>::SharedPtr imu_sub_;
  
  // EKF state variables
  double x_, y_, theta_, v_, w_;
};

}  // namespace estimation
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__ESTIMATION__EKF_NODE_HPP_
