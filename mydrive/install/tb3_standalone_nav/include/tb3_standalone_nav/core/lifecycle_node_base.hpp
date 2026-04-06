#ifndef TB3_STANDALONE_NAV__CORE__LIFECYCLE_NODE_BASE_HPP_
#define TB3_STANDALONE_NAV__CORE__LIFECYCLE_NODE_BASE_HPP_

#include <string>
#include "rclcpp/rclcpp.hpp"
#include "rclcpp_lifecycle/lifecycle_node.hpp"
#include "tb3_standalone_nav/visibility_control.h"

namespace tb3_standalone_nav
{
namespace core
{

using CallbackReturn = rclcpp_lifecycle::node_interfaces::LifecycleNodeInterface::CallbackReturn;

/**
 * @class LifecycleNodeBase
 * @brief Base class for all managed lifecycle nodes in the standalone navigation architecture.
 * Ensures deterministic booting and consistent state transition behaviors.
 */
class LifecycleNodeBase : public rclcpp_lifecycle::LifecycleNode
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  explicit LifecycleNodeBase(const std::string & node_name, const rclcpp::NodeOptions & options = rclcpp::NodeOptions());

  TB3_STANDALONE_NAV_PUBLIC
  virtual ~LifecycleNodeBase();

protected:
  // Lifecycle Transition Callbacks to be overridden by subclasses implementation
  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_configure(const rclcpp_lifecycle::State & state) override;

  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_activate(const rclcpp_lifecycle::State & state) override;

  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_deactivate(const rclcpp_lifecycle::State & state) override;

  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_cleanup(const rclcpp_lifecycle::State & state) override;

  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_shutdown(const rclcpp_lifecycle::State & state) override;

  TB3_STANDALONE_NAV_PUBLIC
  virtual CallbackReturn on_error(const rclcpp_lifecycle::State & state) override;
};

}  // namespace core
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__CORE__LIFECYCLE_NODE_BASE_HPP_
