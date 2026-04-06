#include <memory>
#include <string>
#include <thread>
#include <chrono>
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "behaviortree_cpp/bt_factory.h"
#include "tb3_standalone_nav/bt/bt_action_node.hpp"
#include "nav2_msgs/action/navigate_to_pose.hpp"
#include "nav2_msgs/action/compute_path_to_pose.hpp"
#include "nav2_msgs/action/follow_path.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "nav_msgs/msg/path.hpp"

// BT용 String 변환 헬퍼
namespace BT
{
template <>
inline geometry_msgs::msg::PoseStamped convertFromString(StringView str)
{
  auto parts = splitString(str, ';');
  if (parts.size() != 3) {
    throw RuntimeError("invalid input for PoseStamped");
  }
  geometry_msgs::msg::PoseStamped pose;
  pose.header.frame_id = "map";
  pose.pose.position.x = convertFromString<double>(parts[0]);
  pose.pose.position.y = convertFromString<double>(parts[1]);
  pose.pose.orientation.w = convertFromString<double>(parts[2]);
  return pose;
}
}  // namespace BT

namespace tb3_standalone_nav
{
namespace bt
{

using ComputePathToPose = nav2_msgs::action::ComputePathToPose;
using FollowPath = nav2_msgs::action::FollowPath;
using NavigateToPose = nav2_msgs::action::NavigateToPose;
using GoalHandleNavigateToPose = rclcpp_action::ServerGoalHandle<NavigateToPose>;

// --- A* Planner 호출용 BT 노드 ---
class ComputePathToPoseAction : public BtActionNode<ComputePathToPose>
{
public:
  ComputePathToPoseAction(const std::string & name, const BT::NodeConfig & config)
  : BtActionNode<ComputePathToPose>(name, "compute_path_to_pose", config) {}

  static BT::PortsList providedPorts() {
    return {BT::InputPort<geometry_msgs::msg::PoseStamped>("goal"),
            BT::OutputPort<nav_msgs::msg::Path>("path")};
  }

protected:
  void populate_goal(ComputePathToPose::Goal & goal) override {
    getInput("goal", goal.goal);
    goal.use_start = false; // 출발지는 TF로 자동 계산
  }

  void on_result(const rclcpp_action::ClientGoalHandle<ComputePathToPose>::WrappedResult & result) override {
    if (result.code == rclcpp_action::ResultCode::SUCCEEDED) {
       setOutput("path", result.result->path); 
    }
  }
};

// --- Controller 호출용 BT 노드 ---
class FollowPathAction : public BtActionNode<FollowPath>
{
public:
  FollowPathAction(const std::string & name, const BT::NodeConfig & config)
  : BtActionNode<FollowPath>(name, "follow_path", config) {}

  static BT::PortsList providedPorts() {
    return {BT::InputPort<nav_msgs::msg::Path>("path")};
  }

protected:
  void populate_goal(FollowPath::Goal & goal) override {
    nav_msgs::msg::Path path;
    if (getInput("path", path)) {
      goal.path = path;
    }
  }
};

// ==============================================================================
// 🎯 RViz의 명령을 받아서 BT를 실행하는 메인 네비게이터 클래스!
// ==============================================================================
class BtNavigatorNode : public rclcpp::Node
{
public:
  BtNavigatorNode() : Node("bt_navigator")
  {
    this->declare_parameter("bt_xml_filename", "");
    
    // RViz가 보내는 'navigate_to_pose' 액션을 받을 서버 생성
    action_server_ = rclcpp_action::create_server<NavigateToPose>(
      this, "navigate_to_pose",
      std::bind(&BtNavigatorNode::handle_goal, this, std::placeholders::_1, std::placeholders::_2),
      std::bind(&BtNavigatorNode::handle_cancel, this, std::placeholders::_1),
      std::bind(&BtNavigatorNode::handle_accepted, this, std::placeholders::_1)
    );
    
    RCLCPP_INFO(this->get_logger(), "🟢 BT Navigator Ready! (RViz에서 2D Nav Goal을 찍어주세요)");
  }

private:
  rclcpp_action::Server<NavigateToPose>::SharedPtr action_server_;

  rclcpp_action::GoalResponse handle_goal(
    const rclcpp_action::GoalUUID & /*uuid*/, std::shared_ptr<const NavigateToPose::Goal> /*goal*/)
  {
    RCLCPP_INFO(this->get_logger(), "🎯 RViz로부터 새로운 목적지를 수신했습니다!");
    return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
  }

  rclcpp_action::CancelResponse handle_cancel(const std::shared_ptr<GoalHandleNavigateToPose> /*goal_handle*/)
  {
    RCLCPP_INFO(this->get_logger(), "🛑 목적지 주행 취소 요청!");
    return rclcpp_action::CancelResponse::ACCEPT;
  }

  void handle_accepted(const std::shared_ptr<GoalHandleNavigateToPose> goal_handle)
  {
    // 수신 즉시 별도 스레드에서 행동 트리(BT) 실행
    std::thread{std::bind(&BtNavigatorNode::execute_bt, this, std::placeholders::_1), goal_handle}.detach();
  }

  void execute_bt(const std::shared_ptr<GoalHandleNavigateToPose> goal_handle)
  {
    BT::BehaviorTreeFactory factory;
    auto node_ptr = shared_from_this();

    factory.registerBuilder<ComputePathToPoseAction>("ComputePathToPose", 
      [node_ptr](const std::string& name, const BT::NodeConfig& config) {
        auto action_node = std::make_unique<ComputePathToPoseAction>(name, config);
        action_node->initialize(node_ptr);
        return action_node;
    });

    factory.registerBuilder<FollowPathAction>("FollowPath", 
      [node_ptr](const std::string& name, const BT::NodeConfig& config) {
        auto action_node = std::make_unique<FollowPathAction>(name, config);
        action_node->initialize(node_ptr);
        return action_node;
    });

    // Dummy recovery nodes
    BT::PortsList spin_ports = { BT::InputPort<std::string>("angle"), BT::InputPort<std::string>("spin_dist") };
    factory.registerSimpleAction("Spin",[](BT::TreeNode&){ return BT::NodeStatus::SUCCESS; }, spin_ports);
    
    BT::PortsList clear_ports = { BT::InputPort<std::string>("service_name") };
    factory.registerSimpleAction("ClearCostmap",[](BT::TreeNode&){ return BT::NodeStatus::SUCCESS; }, clear_ports);
    
    BT::PortsList backup_ports = { BT::InputPort<std::string>("distance"), BT::InputPort<std::string>("speed"), BT::InputPort<std::string>("backup_dist"), BT::InputPort<std::string>("backup_speed") };
    factory.registerSimpleAction("BackUp",[](BT::TreeNode&){ return BT::NodeStatus::SUCCESS; }, backup_ports);

    // 🚨 추가됨: 길이 막혔을 때 잠깐 멈춰서 기다리는 Wait 노드
    BT::PortsList wait_ports = { BT::InputPort<std::string>("wait_duration") };
    factory.registerSimpleAction("Wait", [node_ptr](BT::TreeNode& node){ 
      std::string duration_str;
      node.getInput("wait_duration", duration_str);
      RCLCPP_WARN(node_ptr->get_logger(), "⏳ 길이 막혔습니다! %s초 대기 후 새로운 경로를 찾습니다...", duration_str.c_str());
      
      // 1초 대기 효과
      rclcpp::sleep_for(std::chrono::seconds(1));
      return BT::NodeStatus::SUCCESS; 
    }, wait_ports);

    std::string xml_filepath = this->get_parameter("bt_xml_filename").as_string();
    auto tree = factory.createTreeFromFile(xml_filepath);
    auto blackboard = tree.rootBlackboard();

    // 🚨 핵심: RViz에서 찍은 목적지를 꺼내서 BT의 블랙보드(메모장)에 전달!
    auto goal_msg = goal_handle->get_goal();
    blackboard->set("goal", goal_msg->pose);

    auto result = std::make_shared<NavigateToPose::Result>();
    rclcpp::Rate rate(10);
    
    RCLCPP_INFO(this->get_logger(), "🚀 행동 트리(BT) 주행 시퀀스 시작!");
    
    while (rclcpp::ok()) {
      if (goal_handle->is_canceling()) {
        tree.haltTree();
        goal_handle->canceled(result);
        return;
      }

      BT::NodeStatus status = tree.tickExactlyOnce();

      if (status == BT::NodeStatus::SUCCESS) {
        RCLCPP_INFO(this->get_logger(), "✅ 행동 트리(BT) 성공! 로봇이 목적지에 도착했습니다.");
        goal_handle->succeed(result);
        return;
      } else if (status == BT::NodeStatus::FAILURE) {
        RCLCPP_ERROR(this->get_logger(), "❌ 행동 트리(BT) 최종 실패! (999번 재시도 후에도 길을 못 찾음)");
        goal_handle->abort(result);
        return;
      }
      rate.sleep();
    }
  }
};

}  // namespace bt
}  // namespace tb3_standalone_nav

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<tb3_standalone_nav::bt::BtNavigatorNode>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}
