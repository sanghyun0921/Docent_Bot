#pp_test.py
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist, PoseStamped, PoseWithCovarianceStamped
from rclpy.qos import qos_profile_sensor_data
from nav_msgs.msg import Path, OccupancyGrid
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String
from math import atan2, hypot, pi, cos, sin
import numpy as np
import heapq
import time

# 상태 상수
STATE_IDLE = 0
STATE_DRIVING = 1
STATE_BLOCKED = 2
STATE_REPLANNING = 3

# 튜닝 파라미터
INFLATION_RADIUS = 0.35
BASE_LOOKAHEAD = 0.4
MAX_LOOKAHEAD = 0.9
MIN_LOOKAHEAD = 0.25
MAX_SPEED = 0.22
MIN_SPEED = 0.05
REPLAN_COOLDOWN = 1.5

# Theta* Node
class ThetaNode:
    def __init__(self, x, y, g=0.0, h=0.0, parent=None):
        self.x, self.y = x, y
        self.g, self.h = g, h
        self.f = g + h
        self.parent = parent

    def __lt__(self, other):
        return self.f < other.f

# Theta* Planner
class ThetaStarPlanner:
    def __init__(self, grid: OccupancyGrid):
        self.map = grid
        self.res = grid.info.resolution
        self.w = grid.info.width
        self.h = grid.info.height
        self.origin = grid.info.origin
        self.grid = self.inflate()

    def world_to_map(self, x, y):
        mx = int((x - self.origin.position.x) / self.res)
        my = int((y - self.origin.position.y) / self.res)
        return mx, my

    def map_to_world(self, mx, my):
        wx = mx * self.res + self.origin.position.x
        wy = my * self.res + self.origin.position.y
        return wx, wy

    def inflate(self):
        raw = np.array(self.map.data).reshape(self.h, self.w)
        inflated = raw.copy()
        r = int(INFLATION_RADIUS / self.res)
        for y in range(self.h):
            for x in range(self.w):
                if raw[y, x] > 50:
                    for dy in range(-r, r+1):
                        for dx in range(-r, r+1):
                            nx, ny = x+dx, y+dy
                            if 0 <= nx < self.w and 0 <= ny < self.h:
                                inflated[ny, nx] = 100
        return inflated

    def line_of_sight(self, n1, n2):
        x0, y0 = n1.x, n1.y
        x1, y1 = n2.x, n2.y
        dx, dy = abs(x1-x0), abs(y1-y0)
        sx = 1 if x1 > x0 else -1
        sy = 1 if y1 > y0 else -1
        err = dx - dy
        while True:
            if self.grid[y0, x0] > 50:
                return False
            if (x0, y0) == (x1, y1):
                return True
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def plan(self, start, goal):
        sx, sy = self.world_to_map(*start)
        gx, gy = self.world_to_map(*goal)

        open_set = []
        start_node = ThetaNode(sx, sy)
        heapq.heappush(open_set, start_node)
        closed = set()

        while open_set:
            curr = heapq.heappop(open_set)
            if (curr.x, curr.y) == (gx, gy):
                return self.reconstruct(curr)

            closed.add((curr.x, curr.y))

            for dx, dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,1),(-1,1),(1,-1)]:
                nx, ny = curr.x+dx, curr.y+dy
                if not (0 <= nx < self.w and 0 <= ny < self.h):
                    continue
                if self.grid[ny, nx] > 50:
                    continue
                if (nx, ny) in closed:
                    continue

                neighbor = ThetaNode(nx, ny)
                parent = curr.parent if curr.parent and self.line_of_sight(curr.parent, neighbor) else curr
                g = parent.g + hypot(nx-parent.x, ny-parent.y)
                h = hypot(gx-nx, gy-ny)
                neighbor.g = g
                neighbor.h = h
                neighbor.f = g + h
                neighbor.parent = parent
                heapq.heappush(open_set, neighbor)
        return None

    def reconstruct(self, node):
        path = []
        while node:
            path.append(self.map_to_world(node.x, node.y))
            node = node.parent
        return path[::-1]

# Main Driver Node
class CustomDriver(Node):
    def __init__(self):
        super().__init__('custom_theta_star_driver')

        self.state = STATE_IDLE
        self.curr_x = self.curr_y = self.curr_yaw = 0.0
        self.goal = None
        self.path = []
        self.path_idx = 0
        self.last_replan = 0.0

        self.planner = None
        self.scan = None

        self.pub_cmd = self.create_publisher(Twist, '/cmd_vel', 10)
        self.pub_path = self.create_publisher(Path, '/planned_path', 10)

        self.pub_arrival = self.create_publisher(String, '/arrival_status', 10)

        self.create_subscription(OccupancyGrid, '/map', self.cb_map, 10)
        self.create_subscription(PoseWithCovarianceStamped, '/amcl_pose', self.cb_pose, 10)
        self.create_subscription(PoseStamped, '/goal_pose', self.cb_goal, 10)
        self.create_subscription(LaserScan, '/scan', self.cb_scan, qos_profile_sensor_data)

        self.create_timer(0.05, self.loop)

    # Callbacks
    def cb_map(self, msg):
        self.planner = ThetaStarPlanner(msg)

    def cb_pose(self, msg):
        self.curr_x = msg.pose.pose.position.x
        self.curr_y = msg.pose.pose.position.y
        q = msg.pose.pose.orientation
        self.curr_yaw = atan2(2*(q.w*q.z), 1-2*(q.z*q.z))

    def cb_goal(self, msg):
        self.goal = msg
        self.replan()

    def cb_scan(self, msg):
        self.scan = msg

    # Core Loop
    def loop(self):
        if self.state != STATE_DRIVING or not self.path:
            return
        
        dist = hypot(self.goal.pose.position.x - self.curr_x, 
                     self.goal.pose.position.y - self.curr_y)
        self.get_logger().info(f"남은 거리: {dist:.3f} m")

        if self.goal_reached():
            self.stop()
            self.state = STATE_IDLE

            self.get_logger().info("목표 도착 완료! AI 검사 요청 신호를 보냅니다.")
            msg = String()
            msg.data = "arrived"
            self.pub_arrival.publish(msg)
            return

        if self.detect_blockage():
            if time.time() - self.last_replan > REPLAN_COOLDOWN:
                self.replan()
            return

        self.pure_pursuit()

    # Planner
    def replan(self):
        if not self.planner or not self.goal:
            return
        self.path = self.planner.plan(
            (self.curr_x, self.curr_y),
            (self.goal.pose.position.x, self.goal.pose.position.y)
        )
        if not self.path:
            self.state = STATE_IDLE
            return
        self.path_idx = 0
        self.last_replan = time.time()
        self.state = STATE_DRIVING

    # Adaptive Pure Pursuit
    def pure_pursuit(self):
        curvature = abs(self.compute_alpha())
        lookahead = np.clip(
            BASE_LOOKAHEAD / (curvature + 0.1),
            MIN_LOOKAHEAD, MAX_LOOKAHEAD
        )

        target = self.path[-1]
        for i in range(self.path_idx, len(self.path)):
            if hypot(self.path[i][0]-self.curr_x,
                     self.path[i][1]-self.curr_y) > lookahead:
                target = self.path[i]
                self.path_idx = i
                break

        alpha = atan2(target[1]-self.curr_y, target[0]-self.curr_x) - self.curr_yaw
        alpha = (alpha + pi) % (2*pi) - pi

        twist = Twist()
        twist.linear.x = max(MIN_SPEED, MAX_SPEED * (1 - curvature))
        twist.angular.z = np.clip(2.0 * alpha, -1.5, 1.5)
        self.pub_cmd.publish(twist)

    def compute_alpha(self):
        tx, ty = self.path[min(self.path_idx, len(self.path)-1)]
        return atan2(ty-self.curr_y, tx-self.curr_x) - self.curr_yaw

    # Utilities
    def detect_blockage(self):
        if not self.scan:
            return False
        for i, r in enumerate(self.scan.ranges):
            if r < 0.4:
                angle = self.scan.angle_min + i * self.scan.angle_increment
                if abs(angle) < 0.5:
                    return True
        return False

    def goal_reached(self):
        dx = self.goal.pose.position.x - self.curr_x
        dy = self.goal.pose.position.y - self.curr_y
        return hypot(dx, dy) < 0.5

    def stop(self):
        self.pub_cmd.publish(Twist())

def main():
    rclpy.init()
    node = CustomDriver()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()