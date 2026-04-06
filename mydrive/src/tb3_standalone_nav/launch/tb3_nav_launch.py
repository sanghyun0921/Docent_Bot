import os
import launch
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import TimerAction, DeclareLaunchArgument

def generate_launch_description():
    pkg_dir = get_package_share_directory('tb3_standalone_nav')
    bt_xml_path = os.path.join(pkg_dir, 'behavior_trees', 'navigate_to_pose.xml')

    use_sim_time = launch.substitutions.LaunchConfiguration('use_sim_time', default='false')

    map_yaml_path = '/home/shcho/mydrivesim/src/tb3_standalone_nav/src/map/my_map.yaml'

    map_server_node = Node(
        package='nav2_map_server',
        executable='map_server',
        name='map_server',
        output='screen',
        parameters=[
            {'use_sim_time': use_sim_time},
            {'yaml_filename': map_yaml_path}
        ]
    )
    
    amcl_node = Node(
        package='tb3_standalone_nav',
        executable='amcl_node',
        name='amcl_node',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}]
    )
    
    planner_node = Node(
        package='tb3_standalone_nav',
        executable='a_star_planner_server',
        name='a_star_planner_server',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}]
    )
    
    controller_node = Node(
        package='tb3_standalone_nav',
        executable='pure_pursuit_controller_server',
        name='pure_pursuit_controller_server',
        output='screen',
        parameters=[{'use_sim_time': use_sim_time}]
    )

    # 🚨 Lifecycle 관리 대상 노드 이름 (매니저에게 파라미터로 전달됨)
    lifecycle_nodes =['map_server', 'amcl_node', 'a_star_planner_server', 'pure_pursuit_controller_server']

    lifecycle_manager_node = Node(
        package='tb3_standalone_nav',
        executable='lifecycle_manager_node',
        name='lifecycle_manager',
        output='screen',
        parameters=[
            {'use_sim_time': use_sim_time},
            {'autostart': True},
            {'node_names': lifecycle_nodes}
        ]
    )
    
    bt_navigator_node = Node(
        package='tb3_standalone_nav',
        executable='bt_navigator',
        name='bt_navigator',
        output='screen',
        parameters=[{'bt_xml_filename': bt_xml_path, 'use_sim_time': use_sim_time}]
    )

    delayed_bt_navigator = TimerAction(
        period=10.0,
        actions=[bt_navigator_node]
    )

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false', description='Use simulation (Gazebo) clock if true'),
        map_server_node,
        amcl_node,
        planner_node,
        controller_node,
        lifecycle_manager_node,
        delayed_bt_navigator
    ])
