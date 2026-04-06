/**
 * listening.js - 실시간 텍스트 피드백 완벽 복구 버전
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new Recognition();

// [음성 인식 설정]
recognition.lang = "ko-KR";
recognition.interimResults = true; // 사용자가 말하는 도중 결과를 계속 던져줌
recognition.continuous = false;

// [상태 관리 변수]
let isHandlingCommand = false;

// [ROS 연결 설정]
const ROBOT_IP = '192.168.0.21';
const ros = new ROSLIB.Ros({ url: `ws://${ROBOT_IP}:9090` });

// URL 파라미터 및 초기 정보
const params = new URLSearchParams(window.location.search);
const fromPage = params.get("from") || "index";
const currentProgress = parseInt(params.get("progress") || "0");
const currentMode = params.get("mode") || "all-artworks";
const currentCourseId = params.get("courseId") || "";
const currentTitle = params.get("title") || "";

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  setupHelpText();
  startListening();
});

function robotSpeak(text) {
  const speakTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/robot_speak',
    messageType: 'std_msgs/msg/String'
  });
  speakTopic.publish(new ROSLIB.Message({ data: text }));
}

async function publishHomeCommand() {
  try {
    const res = await fetch('/api/load-map');
    const data = await res.json();
    const homeObj = data.objects.find(obj => obj.type === 'home');
    if (homeObj) {
      const goalTopic = new ROSLIB.Topic({ ros: ros, name: '/goal_pose', messageType: 'geometry_msgs/msg/PoseStamped' });
      const msg = new ROSLIB.Message({
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        pose: { position: { x: homeObj.ros_x, y: homeObj.ros_y, z: 0.0 }, orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } }
      });
      goalTopic.publish(msg);
    }
  } catch (e) { console.error(e); }
}

/**
 * 상태별 UI 업데이트 함수 (핵심 수정 부분)
 */
function updateUI(state) {
  const container = document.getElementById("listening-icon-container");
  const title = document.getElementById("listening-title");
  const status = document.getElementById("listening-status");
  const result = document.getElementById("listening-result");
  const retryBtn = document.getElementById("retry-btn");

  if (state === "listening") {
    container.className = "p-8 rounded-full bg-red-500 animate-pulse shadow-lg";
    title.textContent = "명령 듣는 중...";
    status.classList.remove("hidden");
    // ★ 실시간 텍스트를 보여주기 위해 "listening" 상태에서도 result의 hidden을 제거합니다.
    result.classList.remove("hidden");
    retryBtn.classList.add("hidden");
  } else if (state === "thinking") {
    container.className = "p-8 rounded-full bg-yellow-500 shadow-lg";
    title.textContent = "생각 중...";
    status.classList.add("hidden");
    result.classList.remove("hidden");
  } else if (state === "success") {
    container.className = "p-8 rounded-full bg-blue-500 shadow-lg";
    title.textContent = "답변 완료";
    status.classList.add("hidden");
    result.classList.remove("hidden");
    retryBtn.classList.remove("hidden");
  } else if (state === "error") {
    container.className = "p-8 rounded-full bg-gray-400 shadow-lg";
    title.textContent = "잘 들리지 않아요";
    status.classList.add("hidden");
    retryBtn.classList.remove("hidden");
  }
  if (window.lucide) lucide.createIcons();
}

function startListening() {
  if (isHandlingCommand) return;
  try {
    document.getElementById("recognized-text").textContent = "";
    document.getElementById("action-msg").textContent = "";
    recognition.start();
    updateUI("listening");
  } catch (e) { console.log("Restarting..."); }
}

/**
 * 음성 인식 결과 이벤트
 */
recognition.onresult = (event) => {
  if (isHandlingCommand) return;

  let interimTranscript = '';
  let finalTranscript = '';

  for (let i = event.resultIndex; i < event.results.length; ++i) {
    const transcript = event.results[i][0].transcript;
    if (event.results[i].isFinal) {
      finalTranscript += transcript;
    } else {
      interimTranscript += transcript;
    }
  }

  // 실시간으로 화면에 텍스트 업데이트
  const recognizedTextEl = document.getElementById("recognized-text");
  if (recognizedTextEl) {
    // 사용자가 말하는 도중에는 interimTranscript가 보이고, 확정되면 finalTranscript가 보임
    recognizedTextEl.textContent = finalTranscript || interimTranscript;
  }

  // 문장이 최종 확정(isFinal)되면 처리 로직 실행
  if (finalTranscript.trim().length > 0) {
    isHandlingCommand = true;
    recognition.stop();
    handleCommand(finalTranscript.trim());
  }
};

recognition.onerror = (e) => {
  if (!isHandlingCommand) {
    isHandlingCommand = false;
    updateUI("error");
  }
};

/**
 * 명령어 처리 및 AI 답변 요청
 */
async function handleCommand(text) {
  const actionMsg = document.getElementById("action-msg");
  const selectedIdFromUrl = params.get("selectedId"); // URL에서 넘어온 선택된 코스 ID
  updateUI("thinking");
  actionMsg.textContent = "제미나이가 답변을 생성하고 있습니다...";

  if (fromPage === "list") {
    const cleanText = text.replace(/\s/g, ""); // 공백 제거 후 비교

    // (1) 뒤로가기 / 목록 닫기
    if (text.includes("뒤로") || text.includes("이전") || text.includes("취소") || text.includes("목록")) {
      const cid = params.get("courseId") || "";
      const prog = params.get("progress") || 0;
      robotSpeak("작품 목록을 닫고 이전 화면으로 돌아갑니다.");
      setTimeout(() => {
        if (cid && cid !== "null") {
          location.href = `guide.html?mode=specific-artwork&courseId=${cid}&progress=${prog}`;
        } else {
          location.href = "/";
        }
      }, 1000);
      return; // ★ 여기서 종료하여 아래 AI 로직 실행 방지
    }

    // (2) 작품 이름 매칭 (ART_DATA 활용)
    if (typeof ART_DATA !== 'undefined') {
      let matchedArt = ART_DATA.find(a => cleanText.includes(a.title.replace(/\s/g, "")));
      if (matchedArt) {
        const artIdx = ART_DATA.findIndex(a => a.id === matchedArt.id);
        robotSpeak(`${matchedArt.title} 안내를 시작합니다.`);
        updateUI("success");
        setTimeout(() => {
          location.href = `guide.html?mode=specific-artwork&progress=${artIdx}&courseId=${currentCourseId}`;
        }, 1200);
        return; // ★ 매칭 성공 시 즉시 종료 (AI 답변 방지)
      }
    }
  }

  if (fromPage === "recommendation") {
    // 1. 뒤로가기 로직 (독립적인 블록으로 분리)
    if (text.includes("뒤로") || text.includes("이전") || text.includes("취소")) {
      const msg = "설문 화면으로 돌아갑니다.";
      actionMsg.textContent = msg;
      robotSpeak(msg);
      setTimeout(() => {
        location.href = "survey.html";
      }, 1200);
      return;
    }

    if (text.includes("선택 완료") || text.includes("완료") || text.includes("시작") || text.includes("출발")) {
      if (!selectedIdFromUrl || selectedIdFromUrl === "null" || selectedIdFromUrl === "") {
        const msg = "코스가 선택되지 않았습니다. 화면에서 코스를 먼저 클릭한 후 말씀해 주세요.";
        actionMsg.textContent = msg;
        robotSpeak(msg);
        setTimeout(() => updateUI("success"), 2000);
        return;
      }

      // 정상 이동 처리
      const msg = "선택하신 코스로 안내를 시작합니다. 첫 번째 작품으로 이동할게요.";
      actionMsg.textContent = msg;
      robotSpeak(msg);

      setTimeout(() => {
        // guide.html로 이동 (모드와 코스ID, 진행도 전달)
        location.href = `guide.html?mode=recommended-course&courseId=${selectedIdFromUrl}&progress=0`;
      }, 1500);
      return;
    }

    if (text.includes("뒤로") || text.includes("이전") || text.includes("취소")) {
      robotSpeak("이전 화면으로 돌아갑니다.");
      setTimeout(() => history.back(), 1000);
      return;
    }
  }
  // [즉각 이동 명령어 처리]
  if (fromPage === "survey") {
    // 1. 뒤로가기 및 메인 이동 명령
    if (text.includes("뒤로") || text.includes("이전") || text.includes("취소")) {
      const msg = "이전 화면으로 돌아갑니다.";
      actionMsg.textContent = msg;
      robotSpeak(msg);
      setTimeout(() => { location.href = "/"; }, 1200);
      return;
    }

    if (text.includes("메인") || text.includes("홈") || text.includes("처음")) {
      const msg = "메인 화면으로 이동합니다.";
      actionMsg.textContent = msg;
      robotSpeak(msg);
      setTimeout(() => { location.href = "/"; }, 1200);
      return;
    }

  
    // 2. 설문 항목 선택 (정규식 패턴 추출)
    let age = text.match(/10대|20대|30대|40대|50대|60대/)?.[0];
    let gender = text.match(/남성|여성/)?.[0];
    let genre = text.match(/인상주의|현대미술|표현주의|추상화|사실주의|초현실주의/)?.[0];
    let mood = text.match(/힐링|에너지|안정|즐거움/)?.[0]; // 기분 추가

    if (age || gender || genre || mood) {
      const msg = "항목을 선택했습니다. 설문에 반영할게요.";
      actionMsg.textContent = msg;
      robotSpeak(msg);

      // 현재 URL의 파라미터를 가져와서 새로 선택한 것만 업데이트 (기존 선택 유지)
      const currentParams = new URLSearchParams(window.location.search);
      if (age) currentParams.set("age", age);
      if (gender) currentParams.set("gender", gender);
      if (genre) currentParams.set("genre", genre);
      if (mood) currentParams.set("mood", mood);

      setTimeout(() => {
        // 수정된 파라미터와 함께 설문 페이지로 다시 이동
        location.replace(`/survey.html?${currentParams.toString()}`);
      }, 1200);
      return;
    }

    // 3. 설문 완료 및 제출 (추천 페이지 이동)
    if (text.includes("완료") || text.includes("제출") || text.includes("결과") || text.includes("다음")) {
      const msg = "설문을 완료했습니다. 맞춤 코스를 분석합니다.";
      actionMsg.textContent = msg;
      robotSpeak(msg);

      // 추천 페이지로 넘어가기 전, 현재 URL에 있는 파라미터들을 sessionStorage에 저장해야 
      // 추천 엔진이 정상 작동합니다. (선택사항: survey.js에서 처리하므로 이동만 해도 됨)
      setTimeout(() => {
        location.href = "/course-recommendation.html";
      }, 1500);
      return;
    }
  }

  if (text.includes("추천") || text.includes("설문") || text.includes("코스")) {
    const msg = "설문 페이지로 이동합니다.";
    actionMsg.textContent = msg;
    robotSpeak(msg);
    setTimeout(() => { location.href = "survey.html"; }, 1500);
    return;
  }

  if (text.includes("전체") || text.includes("투어") || (text.includes("안내") && text.includes("시작"))) {
    const msg = "전체 안내를 시작합니다.";
    actionMsg.textContent = msg;
    robotSpeak(msg);
    setTimeout(() => { location.href = "guide.html?mode=all-artworks&progress=0"; }, 1500);
    return;
  }
  if (text.includes("목록") || text.includes("리스트") || text.includes("특정")) {
    const msg = "작품 목록으로 이동합니다.";
    actionMsg.textContent = msg;
    robotSpeak(msg);
    setTimeout(() => { location.href = "artwork-list.html"; }, 1500);
    return;
  }

  if (fromPage === "index" && (text.includes("대기") || text.includes("위치"))) {
    updateUI("success");
    const msg = "알겠습니다. 대기 위치로 이동합니다.";
    actionMsg.textContent = msg;
    robotSpeak(msg);
    publishHomeCommand();
    setTimeout(() => { location.href = "/"; }, 2500);
    return;
  }

   
  // [AI 답변 요청]
  try {
    let promptMessage = text;
    if (fromPage === "guide" && currentTitle) {
      promptMessage = `사용자는 지금 '${currentTitle}' 작품을 보고 있어. 질문: ${text}`;
    }

    const response = await fetch("/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: promptMessage }),
    });
    const data = await response.json();

    // UI 상태를 즉시 '답변 완료'로 변경
    updateUI("success");
    document.getElementById("recognized-text").textContent = data.reply;
    actionMsg.textContent = "도슨트 로봇이 답변을 완료했습니다.";

    // 로봇 TTS 출력
    robotSpeak(data.reply);

    // 답변 중 잠금 유지 후 해제
    setTimeout(() => {
      isHandlingCommand = false;
    }, 7000);

  } catch (e) {
    actionMsg.textContent = "서버 연결에 실패했습니다.";
    updateUI("error");
    isHandlingCommand = false;
  }

  if (fromPage === "list") {
    
    // 1. 뒤로가기 명령 (가이드 중이면 가이드로, 아니면 메인으로)
    if (text.includes("뒤로") || text.includes("이전") || text.includes("취소")) {
      const cid = params.get("courseId");
      const prog = params.get("progress") || 0;
      const msg = "이전 화면으로 돌아갑니다.";
      
      actionMsg.textContent = msg;
      robotSpeak(msg);
      
      setTimeout(() => {
        if (cid && cid !== "null" && cid !== "") {
          // 가이드 투어 도중 목록으로 온 경우 -> 보던 작품으로 복귀
          location.href = `guide.html?courseId=${cid}&progress=${prog}`;
        } else {
          // 메인에서 목록으로 온 경우 -> 메인으로 이동
          location.href = "/";
        }
      }, 1000);
      return;
    }

    // 2. 작품 이름으로 선택하기 (예: "별이 빛나는 밤 선택해줘")
    // data.js의 mockArtworks 리스트에서 사용자가 말한 제목이 포함되어 있는지 확인
    let matchedArt = mockArtworks.find(a => text.includes(a.title));
    
    if (matchedArt) {
      // 해당 작품의 인덱스(순번) 찾기
      const artIdx = mockArtworks.findIndex(a => a.id === matchedArt.id);
      const msg = `${matchedArt.title} 작품을 선택하셨습니다. 안내를 시작합니다.`;
      
      actionMsg.textContent = msg;
      robotSpeak(msg);
      
      setTimeout(() => {
        // 선택한 작품을 기준으로 guide.html 이동
        location.href = `guide.html?mode=specific-artwork&progress=${artIdx}`;
      }, 1500);
      return;
    }
  }
}

function setupHelpText() {
  const helpList = document.getElementById("help-list");
  let html = `<li>• "메인 화면으로 가줘"</li>`;
  if (fromPage === "guide") {
    html += `<li>• "다음 작품 보여줘"</li><li>• "안내 종료"</li><li>• "이 작가는 누구야?"</li>`;
  } else if (fromPage === "index") {
    html += `<li>• "작품 추천해줘"</li><li>• "대기 위치로 이동"</li>`;
  }
  helpList.innerHTML = html;
}

function retryListening() {
  isHandlingCommand = false;
  startListening();
}

function goBack() {
  window.history.back();
}