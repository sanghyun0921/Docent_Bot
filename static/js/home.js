/**
 * 메인 화면 전용 로직
 */

document.addEventListener('DOMContentLoaded', () => {
    // 아이콘 초기화
    if (window.lucide) {
        lucide.createIcons();
    }
});

/**
 * 로봇 부르기 버튼
 */
function summonRobot() {
    alert('로봇을 부르는 중입니다...');
    // 실제 로봇 API 연동 코드가 이곳에 들어갈 수 있습니다.
}

/**
 * 대기위치 이동 버튼
 */
function moveToStandby() {
    alert('대기위치로 이동 중...');
    
}