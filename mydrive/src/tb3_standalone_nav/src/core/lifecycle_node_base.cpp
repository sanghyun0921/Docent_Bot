#include "tb3_standalone_nav/core/lifecycle_node_base.hpp"

namespace tb3_standalone_nav
{
namespace core
{

LifecycleNodeBase::LifecycleNodeBase(
  const std::string & node_name, 
  const rclcpp::NodeOptions & options)
: rclcpp_lifecycle::LifecycleNode(node_name, options)
{
  RCLCPP_INFO(get_logger(), "Lifecycle Node '%s' initialized in Unconfigured state.", node_name.c_str());
}

LifecycleNodeBase::~LifecycleNodeBase()
{
  RCLCPP_INFO(get_logger(), "Lifecycle Node '%s' destroyed.", get_name());
}

CallbackReturn LifecycleNodeBase::on_configure(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_INFO(get_logger(), "Configuring...");
  // Subclasses will allocate memory and setup publishers/subscribers here
  return CallbackReturn::SUCCESS;
}

CallbackReturn LifecycleNodeBase::on_activate(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_INFO(get_logger(), "Activating...");
  // Subclasses will activate publishers here
  return CallbackReturn::SUCCESS;
}

CallbackReturn LifecycleNodeBase::on_deactivate(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_INFO(get_logger(), "Deactivating...");
  // Subclasses will deactivate execution loops here
  return CallbackReturn::SUCCESS;
}

CallbackReturn LifecycleNodeBase::on_cleanup(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_INFO(get_logger(), "Cleaning up...");
  // Subclasses will release allocated resources here
  return CallbackReturn::SUCCESS;
}

CallbackReturn LifecycleNodeBase::on_shutdown(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_INFO(get_logger(), "Shutting down...");
  return CallbackReturn::SUCCESS;
}

CallbackReturn LifecycleNodeBase::on_error(const rclcpp_lifecycle::State & /*state*/)
{
  RCLCPP_FATAL(get_logger(), "Lifecycle node transitioned into error state.");
  return CallbackReturn::SUCCESS;
}

}  // namespace core
}  // namespace tb3_standalone_nav
