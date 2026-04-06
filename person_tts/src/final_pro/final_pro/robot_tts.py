import rclpy
from rclpy.node import Node
from rclpy.callback_groups import ReentrantCallbackGroup
from rclpy.executors import MultiThreadedExecutor
from std_msgs.msg import String, Int32
from gtts import gTTS
import os
import subprocess
import time

# 웹의 data.js 내용을 파이썬 딕셔너리로 동기화
ART_DATA = {
    "별이 빛나는 밤": {
        "artist": "빈센트 반 고흐",
        "year": "1889",
        "genre": "인상주의",
        "description": "고흐가 요양원에서 밤하늘을 보며 그린 걸작입니다. 소용돌이치는 하늘은 그의 불안한 내면과 예술적 열정을 보여줍니다."
    },
    "절규": {
        "artist": "에드바르 뭉크",
        "year": "1893",
        "genre": "표현주의",
        "description": "현대인의 불안과 고독을 강렬한 색채와 곡선으로 표현했습니다. 뭉크의 개인적인 경험이 녹아있는 표현주의의 상징적인 작품입니다."
    },
    "게르니카": {
        "artist": "파블로 피카소",
        "year": "1937",
        "genre": "현대미술",
        "description": "스페인 내전 당시 게르니카 마을이 폭격당한 비극을 고발한 반전 작품입니다. 입체주의 기법을 통해 전쟁의 참혹함을 보여줍니다."
    },
    "진주 귀걸이를 한 소녀": {
        "artist": "요하네스 베르메르",
        "year": "1665",
        "genre": "사실주의",
        "description": "북유럽의 모나리자라고도 불립니다. 미지의 소녀가 뒤를 돌아보는 순간을 빛의 마술사 베르메르가 섬세하게 포착했습니다."
    },
    "기억의 지속": {
        "artist": "살바도르 달리",
        "year": "1931",
        "genre": "초현실주의",
        "description": "녹아내리는 시계들은 시간의 주관성을 의미합니다. 달리의 무의식과 꿈의 세계를 초현실주의 기법으로 그려냈습니다."
    },
    "수련": {
        "artist": "클로드 모네",
        "year": "1906",
        "genre": "인상주의",
        "description": "빛의 변화에 따라 시시각각 변하는 수련 연못을 그렸습니다. 형태보다 빛과 색채에 집중한 인상주의의 정수입니다."
    },
    "컴포지션 VIII": {
        "artist": "바실리 칸딘스키",
        "year": "1923",
        "genre": "추상화",
        "description": "기하학적 형태와 색채로 음악적 리듬을 표현한 추상미술의 선구작입니다."
    },
    "이삭 줍는 사람들": {
        "artist": "장 프랑수아 밀레",
        "year": "1857",
        "genre": "사실주의",
        "description": "농민의 고단하지만 숭고한 노동을 따뜻한 시선으로 담아낸 사실주의의 걸작입니다."
    }
}

class RobotTTSNode(Node):
    def __init__(self):
        super().__init__('robot_tts_node')
        
        # 중복 실행 및 중단 명령 처리를 위해 ReentrantCallbackGroup 사용
        self.group = ReentrantCallbackGroup()
        
        self.sub_speak = self.create_subscription(String, '/robot_speak', self.speak_callback, 10, callback_group=self.group)
        self.sub_vol = self.create_subscription(Int32, '/robot_volume', self.vol_callback, 10, callback_group=self.group)
        
        self.is_speaking = False
        self.x = None  # subprocess 프로세스를 담을 변수
        
        self.get_logger().info('🎙️ 터틀봇 전문 큐레이터 모드 가동 (중단 키워드: "그만")')

    def speak_callback(self, msg):
        received_text = msg.data.strip()

        # --- [그만] 키워드 처리: 최우선 실행 ---
        if received_text == "그만":
            if self.x is not None:
                self.x.terminate()  # mpg123 프로세스 강제 종료
                self.x = None
                self.get_logger().info('🛑 사용자의 요청으로 설명을 중단합니다.')
            self.is_speaking = False
            return

        # 이미 말하는 중이면 새로운 설명 시작 안 함 (중단 명령 제외)
        if self.is_speaking:
            if self.x and self.x.poll() is None:
                return 
            else:
                self.is_speaking = False

        if received_text in ART_DATA:
            self.is_speaking = True
            art = ART_DATA[received_text]
            intro = "작품에 도착했습니다 지금부터 작품을 설명드리겠습니다. "
            body = f"지금 보시는 작품은 {art['year']}년에 완성된 {art['artist']}의 {art['genre']} 작품, {received_text} 입니다. {art['description']} "
            outro = "설명이 끝났습니다, 질문이 있으시면 터틀봇과 대화하기를 눌러 질문해주세요 질문이 없으시다면 다음 작품으로 이동을 음성명령을 내리시거나 스마트폰 화면에 다음작품이동을 눌러주세요"
            speech_text = intro + body + outro
        else:
            speech_text = received_text

        self.get_logger().info(f'\n[출력 음성]: {speech_text}\n')
        
        try:
            tts = gTTS(text=speech_text, lang='ko')
            tts.save("curator_voice.mp3")

            # subprocess.run 대신 Popen을 사용하여 비차단(Non-blocking)으로 실행
            self.x = subprocess.Popen(["mpg123", "-a", "hw:1,0", "-q", "curator_voice.mp3"])
            
            # 프로세스가 끝날 때까지 기다리되, 다른 스레드에서 self.x가 None이 되면 즉시 탈출
            while self.x and self.x.poll() is None:
                time.sleep(0.1) # CPU 점유율 방지
                
        except Exception as e:
            self.get_logger().error(f'음성 출력 에러: {e}')
        finally:
            self.is_speaking = False
            self.x = None

    def vol_callback(self, msg):
        volume = msg.data
        os.system(f"amixer sset 'Master' {volume}%")
        self.get_logger().info(f'🔊 볼륨 조절: {volume}%')

def main(args=None):
    rclpy.init(args=args)
    node = RobotTTSNode()
    
    # 멀티스레드 실행기 사용 필수 (말하는 중에도 중단 명령 콜백을 받아야 함)
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()