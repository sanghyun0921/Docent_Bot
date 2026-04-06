#include <chrono>
#include <memory>
#include <string>
#include <vector>

#include "rclcpp/rclcpp.hpp"
#include "lifecycle_msgs/srv/change_state.hpp"
#include "lifecycle_msgs/msg/transition.hpp"

using namespace std::chrono_literals;

namespace tb3_standalone_nav
{
namespace core
{

class LifecycleManager : public rclcpp::Node
{
public:
  LifecycleManager() : Node("lifecycle_manager")
  {
    // Launch 파일에서 넘어오는 파라미터를 받을 준비를 합니다.
    this->declare_parameter("autostart", true);
    this->declare_parameter("node_names", std::vector<std::string>{});
  }

  void startup()
  {
    bool autostart = this->get_parameter("autostart").as_bool();
    std::vector<std::string> managed_nodes = this->get_parameter("node_names").as_string_array();

    if (!autostart || managed_nodes.empty()) {
      RCLCPP_WARN(this->get_logger(), "Autostart가 꺼져 있거나 켤 노드 목록이 비어있습니다.");
      return;
    }

    RCLCPP_INFO(this->get_logger(), "🚀 매니저가 생명주기(Lifecycle) 노드들을 켜기 시작합니다...");

    // Launch 파일로 동시에 실행되므로, 다른 서버 노드들이 완전히 켜질 때까지 2초 대기
    rclcpp::sleep_for(2s);

    // 1단계: 모든 노드를 Unconfigured -> Inactive (Configure) 상태로 변경
    for (const auto & node : managed_nodes) {
      change_state(node, lifecycle_msgs::msg::Transition::TRANSITION_CONFIGURE);
    }

    // 2단계: 모든 노드를 Inactive -> Active 상태로 변경
    for (const auto & node : managed_nodes) {
      change_state(node, lifecycle_msgs::msg::Transition::TRANSITION_ACTIVATE);
    }

    RCLCPP_INFO(this->get_logger(), "✅ 모든 서버가 완벽하게 ACTIVE 상태로 켜졌습니다! (주행 준비 완료)");
  }

private:
  bool change_state(const std::string & node_name, uint8_t transition_id)
  {
    auto client = this->create_client<lifecycle_msgs::srv::ChangeState>(node_name + "/change_state");

    while (!client->wait_for_service(2s)) {
      if (!rclcpp::ok()) return false;
      RCLCPP_INFO(this->get_logger(), "⏳ [%s] 서비스가 준비되기를 기다리는 중...", node_name.c_str());
    }

    auto request = std::make_shared<lifecycle_msgs::srv::ChangeState::Request>();
    request->transition.id = transition_id;

    auto result_future = client->async_send_request(request);
    
    if (rclcpp::spin_until_future_complete(this->get_node_base_interface(), result_future) ==
        rclcpp::FutureReturnCode::SUCCESS)
    {
      auto result = result_future.get();
      if (result->success) {
        std::string state_str = (transition_id == lifecycle_msgs::msg::Transition::TRANSITION_CONFIGURE) ? "Configured" : "Activated";
        RCLCPP_INFO(this->get_logger(), "  -> [%s] 상태 변경 완료: %s", node_name.c_str(), state_str.c_str());
        return true;
      }
    }
    
    RCLCPP_ERROR(this->get_logger(), "  -> [%s] 상태 변경 실패!", node_name.c_str());
    return false;
  }
};

}  // namespace core
}  // namespace tb3_standalone_nav

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto manager = std::make_shared<tb3_standalone_nav::core::LifecycleManager>();
  
  // 노드가 Spin(무한 루프)하기 전에 startup()을 먼저 실행하여 모든 서버를 깨웁니다.
  manager->startup();
  
  // 모든 서버를 성공적으로 깨운 후, 매니저도 시스템에 상주합니다.
  rclcpp::spin(manager);
  rclcpp::shutdown();
  return 0;
}
