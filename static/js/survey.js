/**
 * 페이지 이동 유틸
 */
function navigateTo(page, params = {}) {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  const url = queryString ? `${page}?${queryString}` : page;
  window.location.href = url;
}

/**
 * 🔙 뒤로가기
 */
function goBack() {
  location.href = "/";
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition;

if (Recognition) {
  recognition = new Recognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = false;
}

function startVoiceInSurvey() {
  if (!recognition) return alert("이 브라우저는 음성 인식을 지원하지 않습니다.");

  document.getElementById('voice-overlay').classList.remove('hidden');
  recognition.start();

  recognition.onresult = (event) => {
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


    const preview = document.getElementById('voice-preview');
    preview.textContent = finalTranscript || interimTranscript;

    if (finalTranscript) {
      handleSurveyVoiceCommand(finalTranscript);
    }
  };
}

// [핵심] 사용자의 말이 끝나서 인식이 자동으로 멈췄을 때 호출됨
recognition.onend = () => {
  console.log("음성 인식 자동 종료");

  // 너무 빨리 닫히면 인지하기 어려우므로 1초 뒤에 UI 숨김
  setTimeout(() => {
    const overlay = document.getElementById('voice-overlay');
    if (!overlay.classList.contains('hidden')) {
      stopVoiceInSurvey();
    }
  }, 1000);
};

recognition.onerror = (event) => {
  console.error("음성 인식 에러:", event.error);
  stopVoiceInSurvey();
};


function stopVoiceInSurvey() {
  recognition.stop();
  document.getElementById('voice-overlay').classList.add('hidden');
}

function handleSurveyVoiceCommand(text) {
  // 1. 선택 항목 매칭 및 자동 클릭
  const options = [
    "10대", "20대", "30대", "40대", "50대", "60대",
    "남성", "여성",
    "인상주의", "현대미술", "표현주의", "추상화", "사실주의", "초현실주의",
    "힐링", "에너지", "안정", "즐거움"
  ];

  options.forEach(opt => {
    if (text.includes(opt)) {
      // 해당 값을 가진 라디오 버튼을 찾아 클릭 이벤트 발생
      const radio = document.querySelector(`input[value="${opt}"]`);
      if (radio) {
        radio.click(); // 화면에서 실제로 체크됨

         const label = radio.closest('label');
                if (label) {
                    label.classList.add('ring-4', 'ring-blue-400', 'bg-blue-50');
                    setTimeout(() => {
                        label.classList.remove('ring-4', 'ring-blue-400', 'bg-blue-50');
                    }, 800);
                }
        // 시각적 피드백을 위해 부모 요소(Label)에 잠시 효과 주기
        radio.parentElement.classList.add('ring-4', 'ring-blue-300');
        setTimeout(() => radio.parentElement.classList.remove('ring-4', 'ring-blue-300'), 500);
      }
    }
  });

  // 2. 제출 명령
  if (text.includes("완료") || text.includes("제출") || text.includes("확인") || text.includes("다음")) {
        setTimeout(() => submitSurvey(), 500);
    }
}

/**
 * 초기화 및 자동 선택 로직
 */
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  const params = new URLSearchParams(window.location.search);
  const fields = ["age", "gender", "genre", "mood"];

  fields.forEach((field) => {
    const value = params.get(field);
    if (value) {
      // 1. 화면의 라디오 버튼 체크
      const radio = document.querySelector(`input[name="${field}"][value="${value}"]`);
      if (radio) {
        radio.checked = true;
        // 2. [추가] 음성으로 넘어왔을 때 세션에도 즉시 저장 (추천 로직 동기화)
        const storageKey = 'user' + field.charAt(0).toUpperCase() + field.slice(1); // userAge, userGender 등
        sessionStorage.setItem(storageKey, value);
      }
    }
  });
});


/**
 * 설문 제출
 */
function submitSurvey() {
  const age = document.querySelector('input[name="age"]:checked');
  const gender = document.querySelector('input[name="gender"]:checked');
  const genre = document.querySelector('input[name="genre"]:checked');
  const mood = document.querySelector('input[name="mood"]:checked'); // 추가됨

  // 모든 항목이 선택되었는지 검사
  if (age && gender && genre && mood) {
    // [핵심] 모든 데이터를 sessionStorage에 개별 저장 (AI 추천 시 사용)
    sessionStorage.setItem('userAge', age.value);
    sessionStorage.setItem('userGender', gender.value);
    sessionStorage.setItem('userGenre', genre.value);
    sessionStorage.setItem('userMood', mood.value); // 기분 데이터 저장

    // 추천 페이지로 이동
    navigateTo('course-recommendation.html');
  } else {
    alert('모든 항목을 선택해주세요 (나이, 성별, 장르, 기분)');
  }
}