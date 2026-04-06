#ifndef TB3_STANDALONE_NAV__PLANNER__A_STAR_PLANNER_SERVER_HPP_
#define TB3_STANDALONE_NAV__PLANNER__A_STAR_PLANNER_SERVER_HPP_

#include "nav_msgs/msg/occupancy_grid.hpp"
#include "sensor_msgs/msg/laser_scan.hpp" // 🚨 라이다 추가
#include <memory>
#include <vector>
#include <mutex>
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "nav2_msgs/action/compute_path_to_pose.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "nav_msgs/msg/path.hpp"
#include "tb3_standalone_nav/core/lifecycle_node_base.hpp"
#include "tb3_standalone_nav/costmap/costmap_2d.hpp"

#include "tf2_ros/buffer.h"
#include "tf2_ros/transform_listener.h"

namespace tb3_standalone_nav
{
namespace planner
{

using ComputePathToPose = nav2_msgs::action::ComputePathToPose;
using GoalHandleComputePathToPose = rclcpp_action::ServerGoalHandle<ComputePathToPose>;

class AStarPlannerServer : public core::LifecycleNodeBase
{
public:
  explicit AStarPlannerServer(const rclcpp::NodeOptions & options = rclcpp::NodeOptions());
  ~AStarPlannerServer() override = default;

protected:
  core::CallbackReturn on_configure(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_activate(const rclcpp_lifecycle::State & state) override;
  core::CallbackReturn on_deactivate(const rclcpp_lifecycle::State & state) override;

private:
  rclcpp_action::Server<ComputePathToPose>::SharedPtr action_server_;
  std::shared_ptr<costmap::Costmap2D> costmap_;
  std::mutex costmap_mutex_;

  std::shared_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;
  
  rclcpp::Subscription<nav_msgs::msg::OccupancyGrid>::SharedPtr map_sub_;
  rclcpp::Subscription<sensor_msgs::msg::LaserScan>::SharedPtr scan_sub_;

  // 🚨 정적 맵과 동적 라이다 관리를 위한 변수들
  std::vector<unsigned char> static_map_data_;
  sensor_msgs::msg::LaserScan::SharedPtr last_scan_;
  int map_width_ = 0, map_height_ = 0;
  double map_res_ = 0.05, map_origin_x_ = 0.0, map_origin_y_ = 0.0;

  void map_callback(const nav_msgs::msg::OccupancyGrid::SharedPtr msg);
  void scan_callback(const sensor_msgs::msg::LaserScan::SharedPtr msg);
  void build_dynamic_costmap(); // 동적 맵 생성 함수

  rclcpp_action::GoalResponse handle_goal(const rclcpp_action::GoalUUID & uuid, std::shared_ptr<const ComputePathToPose::Goal> goal);
  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleComputePathToPose> goal_handle);
  void handle_accepted(const std::shared_ptr<GoalHandleComputePathToPose> goal_handle);
  void execute(const std::shared_ptr<GoalHandleComputePathToPose> goal_handle);

  bool makePlan(const geometry_msgs::msg::PoseStamped & start, const geometry_msgs::msg::PoseStamped & goal, nav_msgs::msg::Path & plan);
};

}  // namespace planner
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__PLANNER__A_STAR_PLANNER_SERVER_HPP_
