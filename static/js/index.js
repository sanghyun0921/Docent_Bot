/**
 * 1. ROS 연결 설정 (기존 유지)
 */
const ros = new ROSLIB.Ros({ url: 'ws://192.168.0.21:9090' }); 

ros.on('connection', () => { console.log('ROS Connected'); });
ros.on('error', (error) => { console.log('ROS Error :', error); });
ros.on('close', () => { console.log('ROS Connection Closed'); });

const goalPoseTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/goal_pose',
    messageType: 'geometry_msgs/msg/PoseStamped'
});

/**
 * 2. 공통 유틸리티 함수 (기존 유지)
 */
function navigateTo(page, params = {}) {
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    const url = queryString ? `${page}?${queryString}` : page;
    window.location.href = url;
}

/**
 * [추가] 로봇 점유 관리 기능
 */

// 사용자 고유 토큰 발급 (브라우저 세션당 1개)
if (!sessionStorage.getItem('user_token')) {
    sessionStorage.setItem('user_token', 'user_' + Math.random().toString(36).substr(2, 9));
}
const user_token = sessionStorage.getItem('user_token');

/**
 * 서버에 로봇 사용 가능 여부를 확인하고 이동하는 함수
 */
async function tryStartGuide(page, params = {}) {
    try {
        const response = await fetch('/api/robot/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: "start", 
                user_token: user_token 
            })
        });
        const data = await response.json();

        if (data.status === "success") {
            // 점유 성공 -> 페이지 이동
            navigateTo(page, params);
        } else {
            // 다른 사람 사용 중 -> 알림 팝업
            showBusyModal();
        }
    } catch (error) {
        console.error("점유 상태 확인 실패:", error);
        alert("서버 연결에 문제가 발생했습니다.");
    }
}

// 사용 중 팝업 제어
function showBusyModal() {
    const modal = document.getElementById('busy-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeBusyModal() {
    const modal = document.getElementById('busy-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * 3. 페이지 초기화 및 기존 팝업 로직 (기존 유지)
 */
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide) {
        lucide.createIcons();
    }

    // 세션에 인원수 기록이 없으면 팝업 띄우기
    if (!sessionStorage.getItem('visitorCount')) {
        showVisitorModal();
    }
});

function showVisitorModal() {
    const modal = document.getElementById('visitor-modal');
    const card = document.getElementById('modal-card');
    if (modal && card) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            card.classList.remove('scale-95', 'opacity-0');
            card.classList.add('scale-100', 'opacity-100');
        }, 10);
    }
}

function closeVisitorModal() {
    const modal = document.getElementById('visitor-modal');
    if (modal) modal.classList.add('hidden');
}

async function selectVisitorCount(count) {
    sessionStorage.setItem('visitorCount', count);
    try {
        const response = await fetch('/api/record-visitor-count', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count: count })
        });
        const result = await response.json();
        console.log("통계 기록 성공:", result);
    } catch (error) {
        console.error("통계 서버 전송 실패:", error);
    }
    closeVisitorModal();
}

/**
 * 4. 대기위치 이동 함수 (기존 유지하되 점유 체크 추가)
 */
async function checkAndMoveToStandby() {
    // 이동 명령도 로봇을 조작하는 것이므로 점유 확인 필요
    try {
        const response = await fetch('/api/robot/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "start", user_token: user_token })
        });
        const data = await response.json();

        if (data.status === "success") {
            moveToStandby(); // 기존 함수 호출
        } else {
            showBusyModal();
        }
    } catch (e) {
        alert("서버 연결 오류");
    }
}

async function moveToStandby() {
    try {
        const response = await fetch('/api/load-map');
        const data = await response.json();
        
        if (!data || !data.objects) {
            alert('맵 데이터를 불러올 수 없습니다.');
            return;
        }

        const homeObj = data.objects.find(obj => obj.type === 'home');

        if (homeObj) {
            const poseMsg = new ROSLIB.Message({
                header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
                pose: {
                    position: { x: homeObj.ros_x, y: homeObj.ros_y, z: 0.0 },
                    orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
                }
            });
            
            goalPoseTopic.publish(poseMsg);
            alert(`로봇이 대기위치(홈)로 이동을 시작합니다.`);
            
        } else {
            alert('맵 데이터에 "로봇 홈"이 설정되어 있지 않습니다.');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('이동 명령 중 오류가 발생했습니다.');
    }
}