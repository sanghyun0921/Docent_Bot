from flask import Flask, render_template, request, jsonify
import google.generativeai as genai
import yaml
import os
import pymysql
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func
import paramiko
from datetime import datetime, timedelta
import json
import uuid
import subprocess
import time
from PIL import Image
import glob
import shutil  # 파일 복사용 (에러 발생 지점)
from flask import jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# --- 1. 제미나이 API 설정 ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel("gemini-3.1-flash-lite-preview")

SYSTEM_PROMPT = """
너는 미술관의 지능형 도슨트 로봇이야. 인사나 자기소개는 생략하고 질문에 대한 본론만 2-3문장 이내로 간결하게 답변해.

1. 작품 목록 안내 규칙 (내부 정보): 
   - 사용자가 "이 미술관" 혹은 "여기"에 어떤 작품이 있는지 물을 때만 제공된 [전시 목록] 데이터에 있는 작품 이름을 전부 정확히 나열해줘.

2. 외부 예술 지식 답변 규칙 (외부 정보):
   - 사용자가 전시되지 않은 작품이나 작가의 다른 행보에 대해 물으면 네 지식을 바탕으로 친절하게 답변해줘. 구체적인 작품명을 언급하며 설명하는 것을 권장해.

3. 인기 및 통계 정보 활용: 
   - 사용자가 "가장 인기 있는 게 뭐야?" 등 인기에 대해 직접 물었을 때만 실시간 통계 데이터를 답변에 포함해.

4. 총 관람객 수 답변 규칙 (필수):
   - 사용자가 "총 관람객 수", "누적 인원" 등을 물으면, 제공된 데이터의 [누적 총 관람객 수] 수치를 확인하여 "저희 미술관에는 지금까지 총 O명이 방문해 주셨습니다"와 같이 정확한 숫자를 포함해 답변해줘.

5. 공통 규칙:
   - 이동 명령 시에는 동작 수행에 대한 짧은 확답만 해. 도슨트답게 전문적이면서 상냥한 어조를 유지해.
"""

# --- 2. MySQL 데이터베이스 설정 ---
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DB_URI", "sqlite:///museum_db.sqlite"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

ROBOT_IP = os.environ.get("ROBOT_IP", "127.0.0.1")
ROBOT_USER = os.environ.get("ROBOT_USER", "pi")
ROBOT_PW = os.environ.get("ROBOT_PW", "")

# 설정값
REMOTE_PC_IP = os.environ.get("REMOTE_PC_IP", "127.0.0.1")
REMOTE_PC_USER = os.environ.get("REMOTE_PC_USER", "teamone")
REMOTE_PC_PW = os.environ.get("REMOTE_PC_PW", "")
REMOTE_TARGET_DIR = os.environ.get("REMOTE_TARGET_DIR", "/home/teamone")

# SLAM 프로세스 관리를 위한 전역 변수
slam_process = None


# [테이블 1] 요약 통계
class ArtworkStats(db.Model):
    __tablename__ = "artwork_stats"
    id = db.Column(db.Integer, primary_key=True)
    artwork_name = db.Column(db.String(100), unique=True, nullable=False)
    visitor_count = db.Column(db.Integer, default=0)
    total_duration = db.Column(db.Float, default=0.0)


# [테이블 2] 총 방문자 수
class TotalVisitorStats(db.Model):
    __tablename__ = "total_visitor_stats"
    id = db.Column(db.Integer, primary_key=True)
    total_count = db.Column(db.Integer, default=0)


# [테이블 3] 상세 방문 로그 (실시간 트렌드 분석용)
class VisitLog(db.Model):
    __tablename__ = "visit_log"
    id = db.Column(db.Integer, primary_key=True)
    artwork_name = db.Column(db.String(100))
    visitor_count = db.Column(db.Integer)
    duration = db.Column(db.Float)
    age = db.Column(db.String(20))
    gender = db.Column(db.String(20))
    timestamp = db.Column(db.DateTime, default=datetime.now)


with app.app_context():
    db.create_all()
    if TotalVisitorStats.query.count() == 0:
        db.session.add(TotalVisitorStats(total_count=0))
    if ArtworkStats.query.count() == 0:
        initial_artworks = [
            "별이 빛나는 밤",
            "절규",
            "게르니카",
            "진주 귀걸이를 한 소녀",
            "기억의 지속",
            "수련",
            "컴포지션 VIII",
            "이삭 줍는 사람들",
        ]
        for art in initial_artworks:
            db.session.add(
                ArtworkStats(artwork_name=art, visitor_count=0, total_duration=0.0)
            )
    db.session.commit()


# [신규] 로봇 점유 상태 관리 테이블
class RobotLock(db.Model):
    __tablename__ = "robot_lock"
    id = db.Column(db.Integer, primary_key=True)
    is_locked = db.Column(db.Boolean, default=False)
    current_user_token = db.Column(db.String(100), nullable=True)  # 점유자 식별값
    last_heartbeat = db.Column(db.DateTime, default=datetime.now)


# 초기화 시 레코드 생성 (없을 경우)
with app.app_context():
    db.create_all()
    if RobotLock.query.count() == 0:
        db.session.add(RobotLock(is_locked=False))
        db.session.commit()


# --- 3. 실시간 분석 유틸리티 ---
def get_museum_context_data():
    """제미나이 대화 및 분석 페이지용 실시간 지표 계산"""
    now = datetime.now()
    one_hour_ago = now - timedelta(hours=1)

    # 1. 부동의 인기 1위 (전체 누적)
    all_time_top = ArtworkStats.query.order_by(
        ArtworkStats.visitor_count.desc()
    ).first()

    # 2. 실시간 트렌딩 (최근 1시간 내 방문자 합계 1위)
    trending = (
        db.session.query(VisitLog.artwork_name, func.sum(VisitLog.visitor_count))
        .filter(VisitLog.timestamp >= one_hour_ago)
        .group_by(VisitLog.artwork_name)
        .order_by(func.sum(VisitLog.visitor_count).desc())
        .first()
    )

    # 3. 혼잡도 분석 (최근 1시간 총 방문 인원)
    recent_total = (
        db.session.query(func.sum(VisitLog.visitor_count))
        .filter(VisitLog.timestamp >= one_hour_ago)
        .scalar()
        or 0
    )
    if recent_total > 40:
        congestion = "북적거림"
    elif recent_total > 20:
        congestion = "적당함"
    else:
        congestion = "여유로움"

    return {
        "all_time_top": all_time_top.artwork_name if all_time_top else "없음",
        "all_time_count": all_time_top.visitor_count if all_time_top else 0,
        "trending_art": trending[0] if trending else "현재 집계 중",
        "trending_count": int(trending[1]) if trending else 0,
        "congestion_level": congestion,
        "recent_total": int(recent_total),
    }


# --- 4. API 및 라우팅 ---


@app.route("/ask", methods=["POST"])
def ask():
    data = request.json
    user_message = data.get("message", "")

    # 실시간 지표 계산
    ctx = get_museum_context_data()

    # DB에서 총 관람객 수 가져오기 (TotalVisitorStats 테이블)
    total_stats = TotalVisitorStats.query.first()
    total_v = total_stats.total_count if total_stats else 0

    # 전체 작품 이름 리스트 생성
    all_stats = ArtworkStats.query.all()
    artwork_names = [s.artwork_name for s in all_stats]
    artwork_list_str = ", ".join(artwork_names)

    # 제미나이에게 전달할 상황 정보(Context) 구성
    museum_info = f"""
    [현재 미술관 데이터]
    - 누적 총 관람객 수: {total_v}명
    - 전체 누적 인기 1위: {ctx['all_time_top']} (총 {ctx['all_time_count']}명 방문)
    - 실시간(최근 1시간) 인기 1위: {ctx['trending_art']} ({ctx['trending_count']}명 관람 중)
    - 현재 미술관 혼잡도: {ctx['congestion_level']} (최근 1시간 총 {ctx['recent_total']}명 방문)
    - 전시된 전체 작품 목록(총 8점): {artwork_list_str}
    """

    full_prompt = f"{SYSTEM_PROMPT}\n{museum_info}\n사용자 질문: {user_message}"

    try:
        response = model.generate_content(full_prompt)
        return jsonify({"reply": response.text})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"reply": "통계 정보를 불러오는 중 문제가 발생했습니다."})


@app.route("/api/analytics", methods=["GET"])
def get_analytics():
    try:
        artwork_stats = ArtworkStats.query.all()
        total_stats = TotalVisitorStats.query.first()
        ctx = get_museum_context_data()  # 실시간 지표 포함

        artworks_list = []
        for s in artwork_stats:
            artworks_list.append(
                {
                    "name": s.artwork_name,
                    "visitors": s.visitor_count,
                    "total_time": s.total_duration,
                }
            )

        return jsonify(
            {
                "status": "success",
                "artworks": artworks_list,
                "daily_total_visitors": total_stats.total_count if total_stats else 0,
                # 실시간 카드용 데이터 추가
                "trending_art": ctx["trending_art"],
                "trending_count": ctx["trending_count"],
                "congestion_level": ctx["congestion_level"],
                "recent_total": ctx["recent_total"],
            }
        )
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/analytics/record", methods=["POST"])
def record_analytics():
    try:
        data = request.json
        name, dur, cnt = (
            data.get("artwork_name"),
            float(data.get("duration", 0)),
            int(data.get("count", 0)),
        )
        age, gen = data.get("age", "알 수 없음"), data.get("gender", "알 수 없음")

        stat = ArtworkStats.query.filter_by(artwork_name=name).first()
        if stat:
            if cnt > 0:
                stat.visitor_count += cnt
            if dur > 0:
                stat.total_duration += dur
            # 상세 로그 쌓기
            db.session.add(
                VisitLog(
                    artwork_name=name,
                    visitor_count=cnt,
                    duration=dur,
                    age=age,
                    gender=gen,
                )
            )
            db.session.commit()
            return jsonify({"status": "success"})
        return jsonify({"status": "error"}), 404
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error"}), 500


@app.route("/api/robot/lock", methods=["POST"])
def manage_lock():
    data = request.json
    action = data.get("action")
    user_token = data.get("user_token")

    lock_info = RobotLock.query.first()
    now = datetime.now()

    # 1. 점유 시작
    if action == "start":
        # 다른 사람이 사용 중이고, 마지막 신호가 30초 이내라면 거절
        if lock_info.is_locked and lock_info.current_user_token != user_token:
            if now - lock_info.last_heartbeat < timedelta(seconds=15):
                return jsonify(
                    {"status": "busy", "message": "다른 관람객이 사용 중입니다."}
                )

        # 새 사용자가 점유하거나, 시간 초과된 로봇을 가로챔
        lock_info.is_locked = True
        lock_info.current_user_token = user_token
        lock_info.last_heartbeat = now
        db.session.commit()
        return jsonify({"status": "success"})

    # 2. 가이드 종료 (점유 해제 - 이 부분이 중요!)
    elif action == "stop":
        # 본인이 종료하거나, 관리자가 강제로 풀 때
        lock_info.is_locked = False
        lock_info.current_user_token = None
        # 다음 사람이 즉시 쓸 수 있도록 하트비트 시간을 1시간 전으로 초기화
        lock_info.last_heartbeat = now - timedelta(hours=1)
        db.session.commit()
        return jsonify({"status": "success"})

    # 3. 생존 신고
    elif action == "heartbeat":
        if lock_info.current_user_token == user_token:
            lock_info.last_heartbeat = now
            db.session.commit()
            return jsonify({"status": "success"})
        return jsonify({"status": "error", "message": "권한이 없습니다."}), 403

    return jsonify({"status": "error"}), 400


# (기존 페이지 라우팅 생략 - 동일 유지)
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/survey.html")
def survey():
    return render_template("survey.html")


@app.route("/artwork-list.html")
def artwork_list():
    return render_template("artwork-list.html")


@app.route("/course-recommendation.html")
def course_recommendation():
    return render_template("course-recommendation.html")


@app.route("/api/recommend-courses", methods=["POST"])
def recommend_courses():
    try:
        data = request.json
        user_age = data.get("age")
        user_gender = data.get("gender")
        user_genre = data.get("genre")
        user_mood = data.get("mood")

        # 1. DB에서 실제 작품 리스트 가져오기 (전시 중인 것만 추천하기 위함)
        all_artworks = ArtworkStats.query.all()
        # AI가 참고할 수 있게 이름들만 리스트로 만듭니다.
        artwork_names = [art.artwork_name for art in all_artworks]

        # 2. 제미나이 전용 프롬프트 작성 (AI 큐레이터 페르소나 부여)
        prompt = f"""
        너는 미술관의 수석 큐레이터이자 관람객의 마음을 읽는 도슨트 로봇이야.
        사용자의 설문 결과와 미술관의 실제 작품 목록을 바탕으로 '맞춤형 관람 코스 4개'를 추천해줘.

        [사용자 정보]
        - 연령대: {user_age}
        - 성별: {user_gender}
        - 선호 장르: {user_genre}
        - 오늘의 기분/목적: {user_mood}

        [미술관 실제 보유 작품 리스트]
        {artwork_names}

        [지시 사항]
        1. 총 4개의 관람 코스를 생성해줘.
        2. 각 코스 제목은 사용자의 '기분'과 '장르'를 반영해 감성적이고 매력적으로 지어줘. 
           (예: [파스텔톤의 낭만과 빛] 코스, [강렬한 자아와 해방] 코스)
        3. 각 코스 설명은 사용자의 연령대와 성별에 맞춘 말투로 다정하게 작성해줘.
        4. 각 코스에 포함될 작품은 반드시 위에 제공된 [실제 보유 작품 리스트] 내에서만 2~3개를 골라줘. 없는 작품을 지어내지마.
        5. 결과는 반드시 아래의 JSON 형식으로만 출력해줘. 다른 설명은 하지마.

        JSON 형식:
        [
          {{
            "id": "course-1",
            "name": "코스 제목1",
            "description": "코스에 대한 감성적인 설명",
            "artworks": ["작품명1", "작품명2"]
          }},
          ... (총 4개)
        ]
        """

        # 3. 제미나이 답변 생성
        response = model.generate_content(prompt)

        # AI 응답에서 JSON 데이터만 추출 (마크다운 기호 제거)
        clean_json = response.text.replace("```json", "").replace("```", "").strip()
        recommended_courses = json.loads(clean_json)

        return jsonify(recommended_courses)

    except Exception as e:
        print(f"AI 추천 생성 중 에러 발생: {e}")
        # 에러 발생 시 기본 코스라도 보여줄 수 있도록 처리 (옵션)
        return jsonify({"error": "추천 실패", "message": str(e)}), 500


@app.route("/guide.html")
def guide():
    return render_template("guide.html")


@app.route("/listening.html")
def listening():
    return render_template("listening.html")


@app.route("/admin")
def admin_dashboard():
    return render_template("dashboard.html")


@app.route("/analytics")
def admin_analytics():
    return render_template("analytics.html")


@app.route("/map-editor")
def admin_map_editor():
    return render_template("map-editor.html")


@app.route("/slam")
def admin_slam():
    return render_template("slam.html")


@app.route("/api/robot/volume", methods=["POST"])
def set_robot_volume():
    data = request.json
    volume = data.get("volume", 75)
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(ROBOT_IP, username=ROBOT_USER, password=ROBOT_PW, timeout=2.0)
        ssh.exec_command(f"amixer -c 1 sset 'PCM' {volume}%")
        ssh.close()
        return jsonify({"status": "success"})
    except:
        return jsonify({"status": "error"}), 500


@app.route("/api/record-visitor-count", methods=["POST"])
def record_visitor_count():
    data = request.json
    count_str = data.get("count", "1")
    increment = 4 if count_str == "4+" else int(count_str)
    stats = TotalVisitorStats.query.first()
    if stats:
        stats.total_count += increment
        db.session.commit()
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 500


# app.py 내 load_combined_map 함수 수정
@app.route("/api/load-map", methods=["GET"])
def load_combined_map():
    # 기본값 설정
    result = {
        "objects": [],
        "origin": [0.0, 0.0, 0.0],
        "resolution": 0.05,
        "map_height": 0,
        "map_image_url": "/static/maps/art_gallery.png" 
    }
    
    # 1. map.yaml 읽기 (SLAM에서 저장한 최신 파일 확인)
    map_yaml_path = os.path.join(app.root_path, "map.yaml")
    if os.path.exists(map_yaml_path):
        with open(map_yaml_path, "r", encoding="utf-8") as f:
            map_info = yaml.safe_load(f)
            if map_info:
                result["origin"] = map_info.get("origin", [0.0, 0.0, 0.0])
                result["resolution"] = map_info.get("resolution", 0.05)
                
                # YAML에 적힌 이미지 파일명 가져오기 (pgm -> png)
                yaml_image = map_info.get("image", "art_gallery.png")
                display_image = yaml_image.replace(".pgm", ".png")
                
                # 실제 이미지 파일 경로 확인
                img_path = os.path.join(app.root_path, "static", "maps", display_image)
                if os.path.exists(img_path):
                    with Image.open(img_path) as img:
                        result["map_height"] = img.height # 픽셀 높이 추출
                    result["map_image_url"] = f"/static/maps/{display_image}"

    # 2. objects.yaml 읽기 (작품 위치 정보)
    obj_yaml_path = os.path.join(app.root_path, "objects.yaml")
    if os.path.exists(obj_yaml_path):
        with open(obj_yaml_path, "r", encoding="utf-8") as f:
            obj_data = yaml.safe_load(f)
            # 파일 내용이 {'objects': [...]} 형태인지 확인
            if obj_data and "objects" in obj_data:
                result["objects"] = obj_data["objects"]
            elif isinstance(obj_data, list):
                result["objects"] = obj_data

    return jsonify(result)

# --- [1] 맵 에디터용 객체 정보(YAML) 저장 ---
@app.route("/api/save-map", methods=["POST"])
def save_map_objects():
    try:
        data = request.json
        # 데이터에서 객체 정보만 추출하여 objects.yaml에 저장
        # 클라이언트(JS)에서 { "objects": [...] } 형태로 보낸다고 가정합니다.
        path = os.path.join(app.root_path, "objects.yaml")

        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True)

        return jsonify(
            {
                "status": "success",
                "message": "객체 정보가 objects.yaml에 저장되었습니다.",
            }
        )
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/slam/save_map_file", methods=["POST"])
def save_slam_map_process():
    data = request.json
    filename = data.get("filename", "map")

    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(REMOTE_PC_IP, username=REMOTE_PC_USER, password=REMOTE_PC_PW)

        # 1. 맵 저장 명령어 실행 (QoS 옵션 포함)
        save_cmd = (
            f"bash -c 'source /opt/ros/humble/setup.bash && "
            f"export ROS_DOMAIN_ID=99 && "
            f"ros2 run nav2_map_server map_saver_cli -f {REMOTE_TARGET_DIR}/{filename} "
            f"--ros-args -p save_map_timeout:=10.0 -p map_subscribe_transient_local:=true'"
        )

        stdin, stdout, stderr = ssh.exec_command(save_cmd)
        exit_status = stdout.channel.recv_exit_status()

        if exit_status != 0:
            err = stderr.read().decode()
            ssh.close()
            return jsonify({"status": "error", "message": f"맵 저장 실패: {err}"}), 500

        # 2. 파일 전송 (SFTP)
        sftp = ssh.open_sftp()
        local_map_dir = os.path.join(app.root_path, "static", "maps")
        if not os.path.exists(local_map_dir):
            os.makedirs(local_map_dir)

        # 원격지 파일 경로
        remote_pgm = f"{REMOTE_TARGET_DIR}/{filename}.pgm"
        remote_yaml = f"{REMOTE_TARGET_DIR}/{filename}.yaml"

        # 로컬 저장 경로 (사용자가 입력한 이름 그대로 저장)
        local_pgm = os.path.join(local_map_dir, f"{filename}.pgm")
        local_yaml = os.path.join(local_map_dir, f"{filename}.yaml")
        local_png = os.path.join(local_map_dir, f"{filename}.png")

        sftp.get(remote_pgm, local_pgm)
        sftp.get(remote_yaml, local_yaml)
        sftp.close()
        ssh.close()

        # 3. PGM을 PNG로 변환 (사용자 정의 이름으로 저장)
        with Image.open(local_pgm) as img:
            img.save(local_png)

        # 4. [핵심] 시스템 기본 맵 파일(art_gallery.png, map.yaml)로 복사 (shutil 사용)
        # 이렇게 해야 저장 즉시 대시보드와 에디터에 반영됩니다.
        shutil.copyfile(local_png, os.path.join(local_map_dir, "art_gallery.png"))
        shutil.copyfile(local_yaml, os.path.join(app.root_path, "map.yaml"))

        return jsonify(
            {
                "status": "success",
                "message": f"맵 '{filename}' 저장 및 전체 시스템 동기화 완료!",
            }
        )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/robot/reset_odom", methods=["POST"])
def reset_robot_odom():
    try:
        # 로봇(TurtleBot) IP 설정 (전역 변수 재사용 또는 환경 변수에서 로드)
        local_ROBOT_IP = os.environ.get("ROBOT_IP", "127.0.0.1")
        local_ROBOT_USER = os.environ.get("ROBOT_USER", "pi")
        local_ROBOT_PW = os.environ.get("ROBOT_PW", "")

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(local_ROBOT_IP, username=local_ROBOT_USER, password=local_ROBOT_PW, timeout=5.0)
        
        # ROS 2 토픽 발행을 통해 오도메트리 리셋 명령 전송
        # (주의: 사용 중인 로봇 설정에 따라 토픽명이 다를 수 있으나 보통 빈 메시지로 리셋을 유도합니다)
        cmd = "bash -c 'source /opt/ros/humble/setup.bash && ros2 topic pub -1 /reset_odom std_msgs/msg/Empty {}'"
        
        ssh.exec_command(cmd)
        ssh.close()
        
        return jsonify({"status": "success", "message": "로봇 하드웨어 오도메트리 리셋 명령 전송 완료"})
    except Exception as e:
        print(f"Odom Reset Error: {e}")
        # 하드웨어 연결 실패 시에도 소프트웨어 오프셋은 작동할 수 있도록 success를 보낼 수도 있지만,
        # 여기서는 정확한 상태 전달을 위해 error를 반환합니다.
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/slam/start", methods=["POST"])
def start_slam_process():
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(REMOTE_PC_IP, username=REMOTE_PC_USER, password=REMOTE_PC_PW)
        # 사용자의 DOMAIN_ID 99 적용
        cmd = (
            "bash -c 'source /opt/ros/humble/setup.bash && "
            "export TURTLEBOT3_MODEL=waffle_pi && "
            "export ROS_DOMAIN_ID=99 && "
            "nohup ros2 launch turtlebot3_cartographer cartographer.launch.py > /dev/null 2>&1 &'"
        )
        ssh.exec_command(cmd)
        ssh.close()
        return jsonify({"status": "success", "message": "SLAM 시작 명령을 보냈습니다."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/slam/stop", methods=["POST"])
def stop_slam():
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(REMOTE_PC_IP, username=REMOTE_PC_USER, password=REMOTE_PC_PW)

        # [수정] ROS 2 런처와 관련된 모든 프로세스를 트리 구조로 찾아 강제 종료 (-9)
        # cartographer 뿐만 아니라 ros2 launch 자체를 타겟팅합니다.
        kill_cmd = (
            "pkill -9 -f cartographer && "
            "pkill -9 -f occupancy_grid && "
            "pkill -9 -f ros2"
        )
        ssh.exec_command(kill_cmd)
        ssh.close()
        return jsonify(
            {"status": "success", "message": "SLAM 프로세스가 강제 종료되었습니다."}
        )
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/slam/list_maps", methods=["GET"])
def get_slam_map_list():
    try:
        map_dir = os.path.join(app.root_path, "static", "maps")
        if not os.path.exists(map_dir):
            os.makedirs(map_dir)
        # .yaml 파일들을 찾아 파일명만 추출
        files = glob.glob(os.path.join(map_dir, "*.yaml"))
        map_list = [os.path.basename(f).replace(".yaml", "") for f in files]
        return jsonify({"status": "success", "maps": map_list})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# --- [추가 2] 프리셋 맵 적용하기 (복사) ---
@app.route("/api/slam/load_preset", methods=["POST"])
def load_preset():
    data = request.json
    filename = data.get("filename")

    try:
        map_dir = os.path.join(app.root_path, "static", "maps")
        src_png = os.path.join(map_dir, f"{filename}.png")
        src_yaml = os.path.join(map_dir, f"{filename}.yaml")

        # 현재 시스템에서 사용하는 파일명으로 복사 (덮어쓰기)
        dest_png = os.path.join(map_dir, "art_gallery.png")
        dest_yaml = os.path.join(app.root_path, "map.yaml")

        if os.path.exists(src_png) and os.path.exists(src_yaml):
            shutil.copyfile(src_png, dest_png)
            shutil.copyfile(src_yaml, dest_yaml)
            return jsonify(
                {
                    "status": "success",
                    "message": f"'{filename}' 프리셋이 적용되었습니다.",
                }
            )
        else:
            return (
                jsonify({"status": "error", "message": "파일을 찾을 수 없습니다."}),
                404,
            )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/api/slam/delete_preset", methods=["POST"])
def delete_preset():
    data = request.json
    filename = data.get("filename")
    
    if not filename:
        return jsonify({"status": "error", "message": "파일명이 누락되었습니다."}), 400

    try:
        # 1. 원격 PC (teamone) 파일 삭제
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        # REMOTE_PC_IP, REMOTE_PC_USER, REMOTE_PC_PW 등은 기존 app.py에 정의된 변수 사용
        ssh.connect(REMOTE_PC_IP, username=REMOTE_PC_USER, password=REMOTE_PC_PW, timeout=5.0)
        
        # .yaml과 .pgm 파일 삭제 (rm -f 를 사용하여 파일이 없어도 에러 무시)
        remote_del_cmd = f"rm -f {REMOTE_TARGET_DIR}/{filename}.yaml {REMOTE_TARGET_DIR}/{filename}.pgm"
        ssh.exec_command(remote_del_cmd)
        ssh.close()
        
        # 2. 로컬 (웹 서버 static/maps) 파일 삭제
        map_dir = os.path.join(app.root_path, "static", "maps")
        # 저장 시 생성되었던 모든 확장자 제거
        extensions = ['.yaml', '.png', '.pgm']
        for ext in extensions:
            file_path = os.path.join(map_dir, f"{filename}{ext}")
            if os.path.exists(file_path):
                os.remove(file_path)
                
        return jsonify({
            "status": "success", 
            "message": f"'{filename}' 프리셋이 원격 PC 및 서버에서 모두 삭제되었습니다."
        })

    except Exception as e:
        print(f"삭제 중 오류 발생: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# [수정] 맵 저장 시 프리셋 목록에 남기기 위해 파일명 그대로 저장하도록 변경
# save_slam_map_process 내부 SFTP get 부분을 수정하세요
# sftp.get(remote_pgm, f"{local_map_dir}/{filename}.pgm")
# sftp.get(remote_yaml, f"{local_map_dir}/{filename}.yaml")
# 변환 후 저장할 때도
# img.save(f"{local_map_dir}/{filename}.png")

# --- 가상 로봇 관리를 위한 전역 변수 ---
virtual_robots = {}
v_robot_counter = 0

# [API] 가상 로봇 목록 조회, 추가 및 전체 삭제
@app.route('/api/robots/virtual', methods=['GET', 'POST', 'DELETE'])
def handle_virtual_robots():
    global virtual_robots, v_robot_counter
    
    if request.method == 'POST':
        v_robot_counter += 1
        r_id = f"V-{v_robot_counter}"
        virtual_robots[r_id] = {
            "id": r_id,
            "name": f"가상 로봇 {v_robot_counter}호",
            "x": 0.0, "y": 0.0, "theta": 0.0,
            "speed": 0.2, "status": "idle"
        }
        return jsonify(virtual_robots[r_id])

    elif request.method == 'DELETE':
        virtual_robots = {}
        v_robot_counter = 0
        return jsonify({"status": "success"})

    return jsonify(virtual_robots)

# [API] 가상 로봇 상태 업데이트
@app.route('/api/robots/virtual/<r_id>/update', methods=['POST'])
def update_virtual_robot(r_id):
    if r_id in virtual_robots:
        virtual_robots[r_id].update(request.json)
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 404

# [API] 개별 삭제
@app.route('/api/robots/virtual/<r_id>', methods=['DELETE'])
def delete_virtual_robot(r_id):
    if r_id in virtual_robots:
        del virtual_robots[r_id]
        return jsonify({"status": "success"})
    return jsonify({"status": "error"}), 404


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
