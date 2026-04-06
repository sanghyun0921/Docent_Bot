/**
 * START OF FILE: analytics.js
 * 기능: 실시간 통계 요약(인기작, 혼잡도) 반영 및 차트 시각화
 */

document.addEventListener("DOMContentLoaded", function () {
  // 페이지 로드 시 데이터 가져오기 시작
  fetchAnalyticsData();
});

/**
 * [유틸리티] 초(seconds)를 "Xh Ym" 또는 "Xm Ys" 형식으로 변환
 */
function formatTimeDisplay(totalSeconds) {
  if (!totalSeconds || totalSeconds < 1) return "0s";
  
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

/**
 * 서버 API에서 데이터를 가져와 화면과 차트를 업데이트하는 메인 함수
 */
async function fetchAnalyticsData() {
  try {
    const response = await fetch("/api/analytics");
    const data = await response.json();

    if (data.status !== "success") {
      console.error("API Error:", data.message);
      return;
    }

    // 1. 상단 요약 카드 업데이트
    
    // 카드 1: 오늘 총 관람객 수
    document.getElementById("total-visitor-val").innerText = 
      (data.daily_total_visitors || 0).toLocaleString() + "명";

    const artworks = data.artworks;

    if (artworks && artworks.length > 0) {
      // 카드 2: 누적 관람 시간 1위 작품
      const sortedByTime = [...artworks].sort((a, b) => b.total_time - a.total_time);
      const bestArt = sortedByTime[0];
      document.getElementById("best-engagement-art").innerText = bestArt.name;
      document.getElementById("best-engagement-time").innerText = 
        `누적 ${formatTimeDisplay(bestArt.total_time)} 감상 중`;

      // 카드 3: 최근 1시간 인기작 (Trending) - 서버 데이터 연동
      document.getElementById("trending-art-val").innerText = data.trending_art || "집계 중";
      document.getElementById("trending-count").innerText = 
        `최근 1시간 ${data.trending_count || 0}명 방문`;

      // 카드 4: 미술관 혼잡도 - 서버 데이터 연동
      document.getElementById("congestion-level-val").innerText = data.congestion_level || "데이터 없음";
      document.getElementById("recent-total-visitors").innerText = 
        `최근 1시간 총 ${data.recent_total || 0}명 이용`;

      // 2. 차트 초기화
      initVisitorPieChart(artworks);
      initTimeBarChart(artworks);
    }

    // 업데이트 시간 표시
    const updateTimeEl = document.getElementById("last-update-time");
    if (updateTimeEl) {
      updateTimeEl.innerText = "최근 업데이트: " + new Date().toLocaleTimeString();
    }

  } catch (error) {
    console.error("데이터 로드 중 오류 발생:", error);
  }
}

/**
 * 차트 1: 작품별 관람객 수 비중 (Pie Chart)
 */
function initVisitorPieChart(artworks) {
  const ctx = document.getElementById("visitorChart").getContext("2d");
  
  if (window.myPieChart) window.myPieChart.destroy();

  window.myPieChart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: artworks.map(a => a.name),
      datasets: [{
        data: artworks.map(a => a.visitors),
        backgroundColor: [
          "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", 
          "#f59e0b", "#06b6d4", "#7c3aed", "#64748b"
        ],
        borderWidth: 2,
        borderColor: "#1a1f2e"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#9ca3af", padding: 20, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${val}명 (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

/**
 * 차트 2: 작품별 누적 관람 시간 비교 (Horizontal Bar Chart)
 */
function initTimeBarChart(artworks) {
  const ctx = document.getElementById("timeBarChart").getContext("2d");
  
  if (window.myBarChart) window.myBarChart.destroy();

  window.myBarChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: artworks.map(a => a.name),
      datasets: [{
        label: "누적 관람 시간(분)",
        // X축 막대 길이를 위해 초를 분 단위로 환산
        data: artworks.map(a => (a.total_time / 60).toFixed(1)),
        backgroundColor: "rgba(59, 130, 246, 0.7)",
        hoverBackgroundColor: "#3b82f6",
        borderRadius: 6,
      }]
    },
    options: {
      indexAxis: 'y', // 가로 막대 차트
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: '분(minutes)', color: '#9ca3af' },
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#9ca3af" }
        },
        y: {
          ticks: { color: "#ffffff", font: { weight: 'bold' } },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              // 툴팁에서는 다시 '1h 23m' 형식으로 상세히 보여줌
              const totalSeconds = artworks[context.dataIndex].total_time;
              return ` 누적 감상 시간: ${formatTimeDisplay(totalSeconds)}`;
            }
          }
        }
      }
    }
  });
}