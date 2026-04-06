/**
 * course-recommendation.js
 * AI 맞춤형 코스 생성 및 시각화 로직
 */

// 1. 선택된 코스 정보를 저장할 변수 (ID 혹은 전체 객체)
let selectedCourseId = null;
let currentAIRecommendedCourses = []; // AI가 생성한 코스들을 저장

// 2. 페이지 이동 유틸리티 함수
function navigateTo(page, params = {}) {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  const url = queryString ? `${page}?${queryString}` : page;
  window.location.href = url;
}

// 🔙 뒤로가기
function goBack() {
  window.location.href = "/survey.html";
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("AI 추천 페이지 로드 시작");
  fetchAIRecommendations(); // 페이지 로드 시 AI에게 코스 요청
});

/**
 * [핵심] 백엔드 API를 호출하여 AI 추천 코스를 가져오는 함수
 */
async function fetchAIRecommendations() {
  const container = document.getElementById("course-list");
  if (!container) return;

  // 1. 로딩 화면 표시
  container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 text-center">
        <div class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-4"></div>
        <p class="text-xl font-bold text-gray-700">AI 큐레이터가 코스를 설계 중입니다...</p>
        <p class="text-gray-500 mt-2">당신의 기분과 취향에 딱 맞는 작품을 고르고 있어요.</p>
    </div>
  `;

  // 2. sessionStorage에서 설문 데이터 읽기
  const surveyData = {
    age: sessionStorage.getItem("userAge"),
    gender: sessionStorage.getItem("userGender"),
    genre: sessionStorage.getItem("userGenre"),
    mood: sessionStorage.getItem("userMood")
  };

  try {
    // 3. 백엔드 API 호출
    const response = await fetch('/api/recommend-courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surveyData)
    });

    if (!response.ok) throw new Error("AI 추천 요청 실패");

    const aiCourses = await response.json();
    currentAIRecommendedCourses = aiCourses; // 전역 변수에 저장

    // 4. 받은 코스로 화면 그리기
    renderCourses(aiCourses);

  } catch (error) {
    console.error("추천 로드 오류:", error);
    container.innerHTML = `
      <div class="text-center py-20">
        <p class="text-red-500 font-bold">코스를 생성하는 중 오류가 발생했습니다.</p>
        <button onclick="location.reload()" class="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg">다시 시도</button>
      </div>
    `;
  }
}

/**
 * AI가 응답한 코스 데이터를 바탕으로 카드를 렌더링하는 함수
 */
function renderCourses(courses) {
  const container = document.getElementById("course-list");
  if (!container) return;

  container.innerHTML = ""; // 로딩 문구 제거

  courses.forEach((course, index) => {
    // 첫 번째 코스를 기본 선택값으로 설정
    if (index === 0) {
      selectedCourseId = course.id;
    }

    const div = document.createElement("div");
    
    // AI가 준 작품 리스트를 태그로 변환
    const artworkTags = course.artworks.map((name) => 
      `<span class="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm rounded-full font-medium">${name}</span>`
    ).join("");

    // 카드 스타일 (첫 번째 카드는 'BEST' 강조)
    const isFirst = index === 0;
    div.className = `p-6 rounded-xl border-2 cursor-pointer transition-all mb-4 course-card ${
      isFirst
        ? "border-blue-500 bg-blue-50 shadow-md selected-course"
        : "border-gray-200 bg-white hover:border-gray-300"
    }`;

    // 클릭 시 선택 로직
    div.onclick = () => {
      selectedCourseId = course.id;
      
      // 모든 카드 스타일 초기화
      document.querySelectorAll(".course-card").forEach((el) => {
        el.classList.remove("selected-course", "border-blue-500", "bg-blue-50", "shadow-lg");
        el.classList.add("border-gray-200", "bg-white");
        el.querySelector(".check-icon").classList.add("hidden");
      });

      // 선택된 카드 강조
      div.classList.add("selected-course", "border-blue-500", "bg-blue-50", "shadow-lg");
      div.classList.remove("border-gray-200", "bg-white");
      div.querySelector(".check-icon").classList.remove("hidden");
    };

    div.innerHTML = `
            <div class="flex items-start justify-between">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                        <h3 class="text-xl font-bold text-gray-800">${course.name}</h3>
                        ${isFirst ? '<span class="px-2 py-0.5 bg-blue-600 text-white text-xs rounded-full font-bold animate-pulse">BEST 추천</span>' : ""}
                    </div>
                    <p class="text-gray-600 mb-3 leading-relaxed">${course.description}</p>
                    <div class="flex flex-wrap gap-2">
                        ${artworkTags}
                    </div>
                </div>
                <i data-lucide="check-circle-2" class="check-icon text-blue-500 ml-4 ${isFirst ? "" : "hidden"} w-8 h-8 flex-shrink-0"></i>
            </div>
        `;
    container.appendChild(div);
  });

  if (window.lucide) lucide.createIcons();
}

/**
 * [핵심] 선택 완료 버튼 함수
 */
function selectCourse() {
  if (selectedCourseId) {
    // 선택된 코스의 정보를 찾아봅니다.
    const selectedCourse = currentAIRecommendedCourses.find(c => c.id === selectedCourseId);
    
    // AI가 생성한 코스이므로, guide.html에 코스 ID와 작품 리스트 정보를 넘깁니다.
    navigateTo("guide.html", {
      mode: "recommended-course",
      courseId: selectedCourseId,
      // AI 코스는 동적이므로 세션이나 파라미터로 작품 이름을 넘겨 가이드에서 인지하게 할 수 있습니다.
      progress: 0
    });

    // 가이드 페이지에서 AI 코스 작품들을 인식할 수 있도록 세션에 잠시 저장
    if (selectedCourse) {
        sessionStorage.setItem('currentAICourseArtworks', JSON.stringify(selectedCourse.artworks));
    }

  } else {
    alert("마음에 드는 코스를 선택해주세요!");
  }
}