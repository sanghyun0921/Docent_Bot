#ifndef TB3_STANDALONE_NAV__BT__BT_ACTION_NODE_HPP_
#define TB3_STANDALONE_NAV__BT__BT_ACTION_NODE_HPP_

#include <memory>
#include <string>
#include "behaviortree_cpp/action_node.h"
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"

namespace tb3_standalone_nav
{
namespace bt
{

/**
 * @class BtActionNode
 * @brief Template wrapper converting a ROS 2 Action Client into a BT::ActionNodeBase.
 * Implements non-blocking execution yielding RUNNING status while Action runs.
 */
template<class ActionT>
class BtActionNode : public BT::ActionNodeBase
{
public:
  BtActionNode(const std::string & xml_tag_name, 
               const std::string & action_name,
               const BT::NodeConfig & conf)
  : BT::ActionNodeBase(xml_tag_name, conf), action_name_(action_name)
  {
  }

  static BT::PortsList providedPorts()
  {
    return {};
  }

  void initialize(rclcpp::Node::SharedPtr node)
  {
    node_ = node;
    action_client_ = rclcpp_action::create_client<ActionT>(node_, action_name_);
  }

  BT::NodeStatus tick() override
  {
    if (!action_client_) {
      return BT::NodeStatus::FAILURE;
    }

    if (status() == BT::NodeStatus::IDLE) {
      if (!action_client_->wait_for_action_server(std::chrono::seconds(5))) {
        RCLCPP_ERROR(node_->get_logger(), "Action server %s not available after waiting 5s", action_name_.c_str());
        return BT::NodeStatus::FAILURE;
      }
      typename ActionT::Goal goal;
      populate_goal(goal);
      
      auto send_goal_options = typename rclcpp_action::Client<ActionT>::SendGoalOptions();
      send_goal_options.result_callback =
        [this](const typename rclcpp_action::ClientGoalHandle<ActionT>::WrappedResult & result) {
          if (result.code == rclcpp_action::ResultCode::SUCCEEDED) {
            on_result(result);
            action_status_ = BT::NodeStatus::SUCCESS;
          } else {
            RCLCPP_ERROR(node_->get_logger(), "Action %s failed with code %d", action_name_.c_str(), static_cast<int>(result.code));
            action_status_ = BT::NodeStatus::FAILURE;
          }
        };

      goal_handle_future_ = action_client_->async_send_goal(goal, send_goal_options);
      action_status_ = BT::NodeStatus::RUNNING;
      return action_status_;
    }

    if (status() == BT::NodeStatus::RUNNING) {
      return action_status_;
    }

    return status();
  }

  void halt() override
  {
    if (status() == BT::NodeStatus::RUNNING) {
      if (action_client_ && goal_handle_future_.valid()) {
        auto goal_handle = goal_handle_future_.get();
        if (goal_handle) {
          action_client_->async_cancel_goal(goal_handle);
        }
      }
    }
    action_status_ = BT::NodeStatus::IDLE;
  }

protected:
  virtual void populate_goal(typename ActionT::Goal & goal) = 0;
  virtual void on_result(const typename rclcpp_action::ClientGoalHandle<ActionT>::WrappedResult & /*result*/) {}

  std::string action_name_;
  rclcpp::Node::SharedPtr node_;
  typename rclcpp_action::Client<ActionT>::SharedPtr action_client_;
  std::shared_future<typename rclcpp_action::ClientGoalHandle<ActionT>::SharedPtr> goal_handle_future_;
  BT::NodeStatus action_status_ = BT::NodeStatus::IDLE;
};

}  // namespace bt
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__BT__BT_ACTION_NODE_HPP_
