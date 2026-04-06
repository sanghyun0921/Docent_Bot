import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan, CompressedImage
from std_msgs.msg import String
from geometry_msgs.msg import Twist
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
import cv2
import numpy as np
from ultralytics import YOLO
import time

class PersonGuardNode(Node):
    def __init__(self):
        super().__init__('person_guard_node')
        
        # 모델 로드 (CPU 최적화)
        self.model = YOLO('yolov8n.pt')
        self.get_logger().info("YOLOv8 지연 방지 모드 시작")

        # [핵심] 지연 방지 QoS 설정: 최신 프레임 1개만 유지하고 나머지는 즉시 삭제
        qos_profile = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1
        )

        # 구독자 (QoS 적용)
        self.scan_sub = self.create_subscription(LaserScan, '/scan', self.scan_callback, qos_profile)
        self.img_sub = self.create_subscription(CompressedImage, '/image_raw/compressed', self.image_callback, qos_profile)
        
        # 발행자
        self.speak_pub = self.create_publisher(String, '/robot_speak', 10)
        self.detection_img_pub = self.create_publisher(CompressedImage, '/detection_image/compressed', qos_profile)
        self.cmd_vel_pub = self.create_publisher(Twist, '/cmd_vel', 10)
        
        # 상태 변수
        self.latest_image = None
        self.last_speak_time = 0.0
        self.min_dist_front = 10.0
        self.is_processing = False  # 분석 중 플래그 (지연 방지용)

    def image_callback(self, msg):
        # 1. 지연 방지: 이미 분석 중이면 현재 프레임은 무시하고 버림
        if self.is_processing:
            return
        
        self.is_processing = True

        try:
            # 2. 이미지 디코딩
            np_arr = np.frombuffer(msg.data, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if img is None:
                self.is_processing = False
                return

            # 3. 해상도 축소 (속도 향상을 위해 320x240 고정)
            img = cv2.resize(img, (320, 240))

            # 4. YOLO 추론 (imgsz=224로 줄여 연산량 대폭 감소)
            results = self.model.predict(img, classes=[0], conf=0.4, verbose=False, imgsz=224)
            
            person_detected = False
            annotated_img = img.copy()

            for result in results:
                if len(result.boxes) > 0:
                    person_detected = True
                    annotated_img = result.plot()

            # 5. 분석 이미지 발행 (JPEG 품질을 30으로 낮춰 네트워크 전송 지연 방지)
            publish_msg = CompressedImage()
            publish_msg.header = msg.header
            publish_msg.format = "jpeg"
            _, buffer = cv2.imencode('.jpg', annotated_img, [int(cv2.IMWRITE_JPEG_QUALITY), 10])
            publish_msg.data = buffer.tobytes()
            self.detection_img_pub.publish(publish_msg)

            # 6. 사람 감지 및 거리 조건 확인 (35cm 미만)
            if person_detected and self.min_dist_front < 0.35:
                self.stop_robot() # 로봇 정지
                
                current_time = time.time()
                if current_time - self.last_speak_time > 5.0:
                    self.get_logger().warn(f"!!! 감지: 정지 및 안내 !!! 거리: {self.min_dist_front:.2f}m")
                    
                    speech_msg = String()
                    speech_msg.data = "잠시 지나갈게요 길을 비켜주세요"
                    self.speak_pub.publish(speech_msg)
                    self.last_speak_time = current_time

        finally:
            # 7. 분석 완료 후 플래그 해제
            self.is_processing = False

    def stop_robot(self):
        """속도 0 명령 전송"""
        stop_msg = Twist()
        # 모든 값이 0.0으로 초기화된 Twist
        self.cmd_vel_pub.publish(stop_msg)

    def scan_callback(self, msg):
        # 정면 30도 범위 (0~15도, 345~359도)
        front_ranges = msg.ranges[0:15] + msg.ranges[345:360]
        valid_ranges = [r for r in front_ranges if r > 0.05 and not np.isinf(r)]
        if valid_ranges:
            self.min_dist_front = min(valid_ranges)

def main():
    rclpy.init()
    node = PersonGuardNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()