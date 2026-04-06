# AI 스마트 미술관 도슨트 로봇 🤖

ROS 2 (Humble) 기반의 TurtleBot3와 Google Gemini AI를 활용하여, 미술관 방문객에게 맞춤형 작품 해설을 제공하고 안내하는 웹 기반 스마트 도슨트 시스템입니다.

## 🌟 주요 기능
* **지능형 AI 도슨트**: Google Gemini API를 활용하여 관람객의 질문에 미술 작품 정보를 자연스럽게 대답합니다.
* **맞춤형 코스 추천**: 사용자의 연령대, 성별, 기분 등을 설문조사하여 개인 맞춤형 전시 관람 코스를 추천합니다.
* **웹 기반 로봇 제어 및 SLAM/내비게이션 관리**: 
  * 원격지(Remote PC) 및 로봇(TurtleBot3)에 SSH 접근을 통해 SLAM 프로세스를 시작/종료하고 맵을 웹에서 저장합니다.
  * 저장된 맵(PGM/YAML)을 웹 대시보드에서 실시간으로 확인하고 오브젝트(작품) 위치를 편집할 수 있습니다.
* **실시간 통계 및 대시보드 (Admin)**: 
  * 누적 관람객 수, 작품별 체류 시간, 실시간 인기 트렌드 및 미술관 혼잡도를 시각적으로 보여줍니다.

## 🛠️ 기술 스택
* **Backend**: Python, Flask, Flask-SQLAlchemy, paramiko (SSH 통신)
* **Database**: MySQL (PyMySQL)
* **AI API**: Google Generative AI (Gemini 3.1 Flash-Lite)
* **Frontend**: HTML/CSS, Vanilla JS, ROSLIB.js
* **Robotics**: ROS 2 Humble, TurtleBot3 Waffle Pi, Cartographer, Nav2(reference) 

## ⚙️ 설치 및 실행 방법

### 1. 가상환경 설정 및 패키지 설치
```bash
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 2. 환경 변수 설정
프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 아래의 설정값을 본인의 환경에 맞게 기입합니다. (참고: `.env.example` 파일을 복사하여 사용하세요.)

```ini
# .env 예시
GEMINI_API_KEY=당신의_제미나이_API_키
DB_URI=mysql+pymysql://newuser:1234@192.168.0.7:3306/museum_db
ROBOT_IP=192.168.0.21
ROBOT_USER=pi
ROBOT_PW=1234
REMOTE_PC_IP=192.168.0.29
REMOTE_PC_USER=teamone
REMOTE_PC_PW=1234
REMOTE_TARGET_DIR=/home/teamone
```

### 3. 데이터베이스 세팅
앱이 실행될 때 `app.py` 내부에서 DB 파일과 테이블을 자동 생성합니다. `.env` 파일에 기록된 `DB_URI` 경로 (MySQL Server)가 켜져 있어야 합니다.

### 4. 서버 실행
```bash
python app.py
```
서버 구동 후, http://localhost:5000 (또는 환경에 따라 지정된 IP/포트)로 접속하여 메인 웹 화면을 확인할 수 있습니다.

## 🤖 로봇 및 ROS 2 실행 명령어 모음
웹서버와 별개로 원격 PC와 로봇에서 실행해야 하는 주요 ROS 2 명령어들입니다. (터미널에서 직접 실행하거나 웹 대시보드를 통해 실행)

**[리모트 PC]**
* 네비게이션 실행: `ros2 launch turtlebot3_navigation2 navigation2.launch.py map:=/home/teamone/art_gallery.yaml`
* 자율주행 커스텀 노드: `ros2 launch tb3_standalone_nav tb3_nav_launch.py`

**[로봇(TurtleBot3)]**
* 브링업: `ros2 launch turtlebot3_bringup robot.launch.py`
* 웹소켓: `ros2 launch rosbridge_server rosbridge_websocket_launch.xml`
* 카메라 노드: `ros2 run v4l2_camera v4l2_camera_node --ros-args -p image_size:="[320, 240]" -p time_per_frame:="[1, 10]"`
* TTS 노드: `python3 robot_tts.py`

## 🔒 보안
* 이 프로젝트는 `.gitignore`를 통해 `.env` 파일을 관리합니다. `.env` 파일에 포함된 비밀번호 및 API 키가 깃허브 등에 유출되지 않도록 주의하세요.

-----------------------------------------------------------------------------------------------------------------
AI Smart Museum Docent Robot 🤖
A web-based smart docent system that utilizes a ROS 2 (Humble)-based TurtleBot3 and Google Gemini AI to provide personalized artwork commentary and guidance to museum visitors.

🌟 Key Features
Intelligent AI Docent: Utilizes the Google Gemini API to naturally answer visitors' questions and provide information about the artworks.

Personalized Course Recommendation: Recommends personalized exhibition viewing courses based on a survey of the user's age group, gender, mood, etc.

Web-based Robot Control and SLAM/Navigation Management:

Starts/stops the SLAM process and saves the map via the web through SSH access to the Remote PC and the robot (TurtleBot3).

Monitors the saved map (PGM/YAML) in real-time on the web dashboard and allows editing of object (artwork) locations.

Real-time Statistics and Dashboard (Admin):

Visually displays the cumulative number of visitors, stay time per artwork, real-time popular trends, and museum congestion.

🛠️ Tech Stack
Backend: Python, Flask, Flask-SQLAlchemy, paramiko (SSH Communication)

Database: MySQL (PyMySQL)

AI API: Google Generative AI (Gemini 3.1 Flash-Lite)

Frontend: HTML/CSS, Vanilla JS, ROSLIB.js

Robotics: ROS 2 Humble, TurtleBot3 Waffle Pi, Cartographer, Nav2(reference)

⚙️ Installation and Execution Guide
1. Virtual Environment Setup & Package Installation
Bash
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
2. Environment Variables Configuration
Create a .env file in the project root directory and fill in the configuration values below according to your environment. (Note: You can copy the .env.example file.)

Ini, TOML
# .env Example
GEMINI_API_KEY=your_gemini_api_key
DB_URI=mysql+pymysql://newuser:1234@192.168.0.7:3306/museum_db
ROBOT_IP=192.168.0.21
ROBOT_USER=pi
ROBOT_PW=1234
REMOTE_PC_IP=192.168.0.29
REMOTE_PC_USER=teamone
REMOTE_PC_PW=1234
REMOTE_TARGET_DIR=/home/teamone
3. Database Setup
The DB file and tables are automatically generated within app.py when the app is executed. The MySQL Server specified in the DB_URI path in the .env file must be running.

4. Run the Server
Bash
python app.py
After running the server, you can access the main web screen by navigating to http://localhost:5000 (or the designated IP/port for your environment).

🤖 Robot and ROS 2 Command Reference
These are the primary ROS 2 commands that need to be executed on the Remote PC and the robot separately from the web server. (Run directly in the terminal or execute via the web dashboard).

[Remote PC]

Run Navigation: ros2 launch turtlebot3_navigation2 navigation2.launch.py map:=/home/teamone/art_gallery.yaml

Autonomous Driving Custom Node: ros2 launch tb3_standalone_nav tb3_nav_launch.py

[Robot (TurtleBot3)]

Bringup: ros2 launch turtlebot3_bringup robot.launch.py

WebSocket: ros2 launch rosbridge_server rosbridge_websocket_launch.xml

Camera Node: ros2 run v4l2_camera v4l2_camera_node --ros-args -p image_size:="[320, 240]" -p time_per_frame:="[1, 10]"

TTS Node: python3 robot_tts.py

🔒 Security
This project manages the .env file through .gitignore. Please be careful not to leak the passwords and API keys contained in the .env file to GitHub or elsewhere.
