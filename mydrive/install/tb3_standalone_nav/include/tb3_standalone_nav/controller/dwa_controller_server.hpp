#ifndef TB3_STANDALONE_NAV__CONTROLLER__PURE_PURSUIT_CONTROLLER_SERVER_HPP_
#define TB3_STANDALONE_NAV__CONTROLLER__PURE_PURSUIT_CONTROLLER_SERVER_HPP_

#include <memory>
#include <vector>
#include <cmath>
#include <utility>
#include <mutex>

#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "nav2_msgs/action/follow_path.hpp"
#include "geometry_msgs/msg/twist.hpp"
#include "nav_msgs/msg/path.hpp"
#include "sensor_msgs/msg/laser_scan.hpp" 
#include "tf2_ros/buffer.h"
#include "tf2_ros/transform_listener.h"

#include "tb3_standalone_nav/core/lifecycle_node_base.hpp"

namespace tb3_standalone_nav
{
namespace controller
{

using FollowPath = nav2_msgs::action::FollowPath;
using GoalHandleFollowPath = rclcpp_action::ServerGoalHandle<FollowPath>;

class PurePursuitControllerServer : public core::LifecycleNodeBase
{
public:
  explicit PurePursuitControllerServer(const rclcpp::NodeOptions & options = rclcpp::NodeOptions());
  ~PurePursuitControllerServer() override = default;

protected:
  core::CallbackReturn on_configure(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_activate(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_deactivate(const rclcpp_lifecycle::State & state) override;

private:
  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID & uuid, std::shared_ptr<const FollowPath::Goal> goal);
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleFollowPath> goal_handle);
  void handle_accepted(const std::shared_ptr<GoalHandleFollowPath> goal_handle);
  void execute(const std::shared_ptr<GoalHandleFollowPath> goal_handle);

  // Pure Pursuit 핵심 알고리즘
  bool computeVelocityCommands(const nav_msgs::msg::Path & global_plan, geometry_msgs::msg::Twist & cmd_vel, double robot_x, double robot_y, double robot_theta);

  void prune_plan(nav_msgs::msg::Path & global_plan, double robot_x, double robot_y);
  geometry_msgs::msg::PoseStamped get_lookahead_point(const nav_msgs::msg::Path & global_plan, double robot_x, double robot_y, double lookahead_dist);
  void scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg);

  rclcpp_action::Server<FollowPath>::SharedPtr action_server_;
  std::shared_ptr<rclcpp_lifecycle::LifecyclePublisher<geometry_msgs::msg::Twist>> cmd_vel_pub_;

  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;

  rclcpp::Subscription<sensor_msgs::msg::LaserScan>::SharedPtr scan_sub_;
  
  std::vector<std::pair<double, double>> obstacles_;
  std::mutex obs_mutex_;
  std::mutex thread_mutex_;
  std::shared_ptr<GoalHandleFollowPath> active_goal_;
};

}  // namespace controller
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__CONTROLLER__PURE_PURSUIT_CONTROLLER_SERVER_HPP_
