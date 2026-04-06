cmake_minimum_required(VERSION 3.8)
project(tb3_standalone_nav)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_lifecycle REQUIRED)
find_package(lifecycle_msgs REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(nav_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(behaviortree_cpp REQUIRED)
find_package(nav2_msgs REQUIRED)

include_directories(include)

# =========================================================
# Core Library: Lifecycle Base Nodes & Costmap
# =========================================================
add_library(tb3_standalone_core SHARED
  src/core/lifecycle_node_base.cpp
  src/costmap/costmap_2d.cpp
  src/costmap/edt.cpp
  src/costmap/dynamic_obstacle_layer.cpp
)
target_include_directories(tb3_standalone_core PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  $<INSTALL_INTERFACE:include>
)
ament_target_dependencies(tb3_standalone_core
  rclcpp
  rclcpp_lifecycle
)

# =========================================================
# Executables
# =========================================================

# A* Planner Action Server
add_executable(a_star_planner_server src/planner/a_star_planner_server.cpp)
target_link_libraries(a_star_planner_server tb3_standalone_core)
ament_target_dependencies(a_star_planner_server rclcpp rclcpp_lifecycle rclcpp_action nav2_msgs geometry_msgs nav_msgs tf2 tf2_ros tf2_geometry_msgs nav_msgs sensor_msgs)

# Pure Pursuit Controller Action Server
add_executable(pure_pursuit_controller_server src/controller/pure_pursuit_controller_server.cpp)
target_link_libraries(pure_pursuit_controller_server tb3_standalone_core)
ament_target_dependencies(pure_pursuit_controller_server rclcpp rclcpp_lifecycle rclcpp_action nav2_msgs geometry_msgs nav_msgs sensor_msgs tf2 tf2_ros tf2_geometry_msgs)

# Estimation Nodes (AMCL)
add_executable(amcl_node src/estimation/amcl_node.cpp)
target_link_libraries(amcl_node tb3_standalone_core)
ament_target_dependencies(amcl_node rclcpp rclcpp_lifecycle sensor_msgs nav_msgs geometry_msgs tf2_ros tf2_geometry_msgs)

# BT Navigator
add_executable(bt_navigator src/bt/bt_navigator.cpp)
target_link_libraries(bt_navigator tb3_standalone_core)
ament_target_dependencies(bt_navigator rclcpp rclcpp_action nav2_msgs behaviortree_cpp)

# Lifecycle Manager
add_executable(lifecycle_manager_node src/core/lifecycle_manager_node.cpp)
ament_target_dependencies(lifecycle_manager_node rclcpp lifecycle_msgs)

# Install includes, libraries, and executables
install(DIRECTORY include/ DESTINATION include)
install(DIRECTORY behavior_trees/ DESTINATION share/${PROJECT_NAME}/behavior_trees)
install(DIRECTORY launch/ DESTINATION share/${PROJECT_NAME}/launch)

install(TARGETS tb3_standalone_core
  ARCHIVE DESTINATION lib
  LIBRARY DESTINATION lib
  RUNTIME DESTINATION bin
)

install(TARGETS
  a_star_planner_server
  pure_pursuit_controller_server
  amcl_node
  bt_navigator
  lifecycle_manager_node
  DESTINATION lib/${PROJECT_NAME}
)

ament_package()
