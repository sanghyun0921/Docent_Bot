/**
 * START OF FILE: dashboard.js
 * 기능: 실시간 상태 감지, 배터리 부족 안내, YOLO 인식 영상 출력, 목적지 동기화, 수동 조작, 맵 렌더링 (SLAM 동기화 버전)
 */

// --- [1. 전역 변수 및 설정] ---
let MAP_META = {
    originX: 0.0,
    originY: 0.0,
    resolution: 0.05,
    mapHeight: 0
};
const MAP_SCALE = 8.0; // 에디터와 동일하게 이미지 대비 8배 확대 고정

let isManualActive = false;
let robotStatus = 'idle';
let currentTargetPose = null; 
const rosIP = "192.168.0.21";
const ros = new ROSLIB.Ros({ url: `ws://${rosIP}:9090` });

let globalIssue = false;
let isChargingState = false; 
let lastAlertTime = 0;
let robotPose = { x: 0, y: 0, theta: 0, active: false };

let emergencyInterval = null;
let batteryChargeTriggered = false; 
let hasSpokenLowBattery = false; 

let lastVoltage = 0; 
let currentMaxSpeed = 0.20; 
let volumeApiTimer = null; 

// 맵 이미지 객체 (중복 선언 방지를 위해 let 사용)
let slamMapImg = new Image();
let isMapLoaded = false;
let mapData = { objects: [] };

// --- [2. ROS 토픽 정의] ---
const volumeTopic = new ROSLIB.Topic({ ros: ros, name: '/robot_volume', messageType: 'std_msgs/msg/Int32' });
const speakTopic = new ROSLIB.Topic({ ros: ros, name: '/robot_speak', messageType: 'std_msgs/msg/String' });
const goalPoseTopic = new ROSLIB.Topic({ ros: ros, name: '/goal_pose', messageType: 'geometry_msgs/msg/PoseStamped' });
const cmdVel = new ROSLIB.Topic({ ros: ros, name: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist' });
const imageTopic = new ROSLIB.Topic({
    ros: ros,
    name: '/detection_image/compressed',
    messageType: 'sensor_msgs/msg/CompressedImage',
    throttle_rate: 250 // [핵심] 최소 100ms(0.1초) 간격으로만 메시지를 받음 (초당 10프레임)
});

let virtualRobots = {}; 
window.selectedVRobotId = null;

// ROS 연결 모니터링
ros.on('connection', () => { 
    const statusEl = document.getElementById('ros-status');
    if(statusEl) { statusEl.innerText = "(ROS: Connected)"; statusEl.style.color = "#10b981"; }
});
ros.on('close', () => { 
    const statusEl = document.getElementById('ros-status');
    if(statusEl) { statusEl.innerText = "(ROS: Disconnected)"; statusEl.style.color = "gray"; }
    // [수정2] 탭 전환(visibility change)으로 인한 일시적 disconnect 시 화살표를 숨기지 않음
    // 실제 연결 끊김 시에만 active false 처리하되 마커는 마지막 위치 유지
    if (!document.hidden) {
        robotPose.active = false;
        updateRobotMarker();
    }
});

// [수정2] 탭에서 돌아올 때 ROS 재연결 시도
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        // 탭 복귀 시 연결 상태 확인 후 필요하면 재연결
        if (ros.isConnected === false) {
            try { ros.connect(`ws://${rosIP}:9090`); } catch(e) {}
        }
        // 마지막으로 알려진 위치가 있으면 마커 다시 표시
        if (robotPose.x !== 0 || robotPose.y !== 0) {
            robotPose.active = true;
            updateRobotMarker();
        }
    }
});

// --- [3. 좌표 변환 핵심 함수 (SLAM 동기화)] ---
function rosToPixel(rosX, rosY) {
    if (MAP_META.mapHeight === 0) return { pxX: 0, pxY: 0 };
    
    // 1. ROS 미터 -> 이미지 원본 픽셀 좌표
    let imgX = (rosX - MAP_META.originX) / MAP_META.resolution;
    let imgY = MAP_META.mapHeight - ((rosY - MAP_META.originY) / MAP_META.resolution);
    
    // 2. 원본 픽셀 -> 화면 표시 픽셀 (MAP_SCALE 적용)
    return {
        pxX: imgX * MAP_SCALE,
        pxY: imgY * MAP_SCALE
    };
}

// --- [4. 맵 및 데이터 로드 로직] ---
function loadMapSettings() {
    fetch('/api/load-map')
        .then(res => res.json())
        .then(data => {
            console.log("Dashboard Map Meta Loaded:", data);
            MAP_META.originX = data.origin[0];
            MAP_META.originY = data.origin[1];
            MAP_META.resolution = data.resolution;
            MAP_META.mapHeight = data.map_height;
            
            mapData = data;
            // 서버에서 준 이미지 경로에 타임스탬프를 붙여 로드 (캐시 방지)
            slamMapImg.src = data.map_image_url + "?t=" + new Date().getTime();
        });
}

slamMapImg.onload = () => { 
    isMapLoaded = true; 
    setupMapLayout(); 
    if(mapData && mapData.objects) renderObjects(); 
};

function setupMapLayout() {
    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const wrapper = document.getElementById('map-wrapper');

    canvas.width = slamMapImg.width * MAP_SCALE; 
    canvas.height = slamMapImg.height * MAP_SCALE;
    wrapper.style.width = canvas.width + 'px'; 
    wrapper.style.height = canvas.height + 'px';

    ctx.imageSmoothingEnabled = false; 
    ctx.drawImage(slamMapImg, 0, 0, canvas.width, canvas.height);
    calculateFit();
}

function calculateFit() {
    const parent = document.getElementById('map-parent');
    const canvas = document.getElementById('mapCanvas');
    const wrapper = document.getElementById('map-wrapper');
    if (!parent || !canvas) return;
    const scale = Math.min((parent.clientWidth - 60) / canvas.width, (parent.clientHeight - 60) / canvas.height);
    wrapper.style.transform = `scale(${scale})`;
}

function renderObjects() {
    const container = document.getElementById('objectsContainer');
    if (!container || !mapData || !mapData.objects) return;
    
    container.innerHTML = '';
    mapData.objects.forEach(obj => {
        const pos = rosToPixel(obj.ros_x, obj.ros_y); // 기존 위치 계산 유지
        const el = document.createElement('div');
        
        // 맵 에디터와 동일한 클래스 구조 적용
        el.className = `map-object ${obj.type}-object`;
        el.style.left = pos.pxX + 'px';
        el.style.top = pos.pxY + 'px';

        // 아이콘 및 텍스트 설정 (맵 에디터의 addObject 로직 복제)
        let iconSvg = '';
        let subText = obj.artist ? `<div class="object-sub">${obj.artist}</div>` : '';

        switch(obj.type) {
            case 'artwork':
                iconSvg = '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
                break;
            case 'desk':
                iconSvg = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
                break;
            case 'home':
                iconSvg = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
                break;
            case 'charge':
                iconSvg = '<svg class="icon" viewBox="0 0 24 24"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect><line x1="23" y1="19" x2="19" y2="19"></line></svg>';
                break;
        }

        el.innerHTML = `
            ${iconSvg}
            <div class="object-label">${obj.name || obj.type}</div>
            ${subText}
        `;
        
        container.appendChild(el);
    });
}

function updateRobotMarker() {
    const marker = document.getElementById('robot-marker');
    if (!robotPose.active || !isMapLoaded || MAP_META.mapHeight === 0) return;
    marker.style.display = 'block';
    
    const pos = rosToPixel(robotPose.x, robotPose.y);
    marker.style.left = pos.pxX + 'px'; 
    marker.style.top = pos.pxY + 'px';
    marker.style.transform = `rotate(${-robotPose.theta * 180 / Math.PI + 90}deg)`;
}

// --- [5. 실시간 상태 및 센서 구독] ---
function determineStatus(isMoving) {
    if (robotStatus === 'emergency' || robotStatus === 'goal_reached') return;
    let newStatus = 'idle';
    if (isChargingState) newStatus = 'charging';
    else if (isManualActive) newStatus = 'manual';
    else if (currentTargetPose) {
        const dist = Math.sqrt(Math.pow(currentTargetPose.x - robotPose.x, 2) + Math.pow(currentTargetPose.y - robotPose.y, 2));
        if (dist < 0.5) {
            robotStatus = 'goal_reached';
            currentTargetPose = null;
            updateStatusUI();
            setTimeout(() => { if(robotStatus === 'goal_reached') { robotStatus = 'idle'; updateStatusUI(); } }, 4000);
            return;
        }
        newStatus = isMoving ? 'driving' : 'navigating';
    } 
    else if (isMoving) newStatus = 'driving';
    else newStatus = 'idle';

    if (robotStatus !== newStatus) {
        robotStatus = newStatus;
        updateStatusUI();
    }
}

// --- [가상 로봇(Virtual Robot) 관리 로직] ---

/** [API] 가상 로봇 추가 */
async function addVirtualRobot() {
    try {
        await fetch('/api/robots/virtual', { method: 'POST', headers: {'Content-Type': 'application/json'} });
        updateVirtualFleet(); 
    } catch (e) { console.error("가상 로봇 추가 실패"); }
}

/** [API] 목록 동기화 */
async function updateVirtualFleet() {
    try {
        const res = await fetch('/api/robots/virtual');
        const serverRobots = await res.json();
        
        // 로컬 데이터 동기화
        Object.keys(virtualRobots).forEach(id => { if (!serverRobots[id]) delete virtualRobots[id]; });
        Object.keys(serverRobots).forEach(id => {
            if (!virtualRobots[id] || !virtualRobots[id].driveInterval) virtualRobots[id] = serverRobots[id];
        });
        
        renderVirtualListUI();      
        renderVirtualMarkersOnMap(); 
    } catch (e) { console.error("Fleet Sync Error"); }
}

/** [UI] 가상 로봇 리스트 렌더링 (사이드바) */
function renderVirtualListUI() {
    const container = document.getElementById('virtual-robot-list');
    if (!container) return;
    const robots = Object.values(virtualRobots);
    if (robots.length === 0) {
        container.innerHTML = '<p style="color: #64748b; font-size: 12px; text-align: center; padding: 20px;">가상 로봇을 추가해주세요.</p>';
        return;
    }
    container.innerHTML = '';
    robots.forEach(robot => {
        const isSelected = window.selectedVRobotId === robot.id;
        const div = document.createElement('div');
        div.className = `v-robot-item ${isSelected ? 'active' : ''} ${robot.status === 'driving' ? 'driving' : ''}`;
        div.onclick = () => { window.selectedVRobotId = robot.id; renderVirtualListUI(); renderVirtualMarkersOnMap(); };
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: bold; font-size: 13px; color: ${isSelected ? '#fbbf24' : '#10b981'};">
                    ${isSelected ? '▶' : '●'} ${robot.id}
                </span>
                <button onclick="event.stopPropagation(); removeVirtualRobot('${robot.id}')" class="btn-v-delete">✕</button>
            </div>
            <div style="font-size: 10px; color: #9ca3af; margin-top: 5px;">상태: ${robot.status}</div>
            <input type="range" min="0.1" max="0.5" step="0.05" value="${robot.speed}" 
                   onclick="event.stopPropagation()"
                   oninput="updateVRobotOnServer('${robot.id}', {speed: parseFloat(this.value)})"
                   style="width:100%; accent-color:#10b981; height:4px; margin-top:5px;">
        `;
        container.appendChild(div);
    });
}

/** [Map] 가상 로봇 마커 렌더링 (지도 위) */
function renderVirtualMarkersOnMap() {
    document.querySelectorAll('.v-robot-marker').forEach(m => m.remove());
    if (!isMapLoaded || MAP_META.mapHeight === 0) return;

    Object.values(virtualRobots).forEach(robot => {
        const marker = document.createElement('div');
        marker.className = `v-robot-marker ${window.selectedVRobotId === robot.id ? 'selected-v-robot' : ''}`;
        
        // 실제 로봇과 동일한 정밀 좌표 변환식(rosToPixel) 사용
        const pos = rosToPixel(robot.x, robot.y);
        
        marker.style.left = pos.pxX + 'px';
        marker.style.top = pos.pxY + 'px';
        marker.style.transform = `rotate(${-robot.theta * 180 / Math.PI + 90}deg)`;
        marker.innerHTML = `<div class="v-robot-label">${robot.id}</div><div class="robot-arrow"></div>`;
        marker.onclick = (e) => { e.stopPropagation(); window.selectedVRobotId = robot.id; renderVirtualListUI(); renderVirtualMarkersOnMap(); };
        document.getElementById('map-wrapper').appendChild(marker);
    });
}

/** [Drive] 가상 로봇 주행 시뮬레이션 */
function startVRobotDriving(id, tx, ty) {
    const robot = virtualRobots[id];
    if (!robot) return;
    if (robot.driveInterval) clearInterval(robot.driveInterval);
    
    updateVRobotOnServer(id, { status: 'driving', target_x: tx, target_y: ty });
    robot.driveInterval = setInterval(() => {
        const dx = tx - robot.x, dy = ty - robot.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < 0.05) {
            clearInterval(robot.driveInterval);
            robot.status = 'idle'; robot.driveInterval = null;
            updateVRobotOnServer(id, {x: tx, y: ty, theta: robot.theta, status: 'idle'});
            renderVirtualMarkersOnMap();
        } else {
            const step = robot.speed * 0.05; 
            const ratio = step / dist;
            robot.x += dx * ratio;
            robot.y += dy * ratio;
            robot.theta = Math.atan2(dy, dx);
            renderVirtualMarkersOnMap();
            if (Math.random() < 0.1) updateVRobotOnServer(id, {x: robot.x, y: robot.y, theta: robot.theta});
        }
    }, 50);
}

/** [API] 업데이트 전송 */
async function updateVRobotOnServer(id, data) {
    await fetch(`/api/robots/virtual/${id}/update`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data)
    });
    if (virtualRobots[id]) Object.assign(virtualRobots[id], data);
}

/** [API] 가상 로봇 개별/전체 삭제 */
async function removeVirtualRobot(id) {
    if (!confirm(`${id}를 삭제하시겠습니까?`)) return;
    await fetch(`/api/robots/virtual/${id}`, { method: 'DELETE' });
    if (window.selectedVRobotId === id) window.selectedVRobotId = null;
    updateVirtualFleet();
}

async function clearVirtualRobots() {
    if (!confirm("모든 가상 로봇을 삭제하시겠습니까?")) return;
    await fetch('/api/robots/virtual', { method: 'DELETE' });
    virtualRobots = {}; window.selectedVRobotId = null;
    updateVirtualFleet();
}

const amclTopic = new ROSLIB.Topic({ ros: ros, name: '/amcl_pose', messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped' });
amclTopic.subscribe(function(message) {
    robotPose.x = message.pose.pose.position.x;
    robotPose.y = message.pose.pose.position.y;
    robotPose.theta = Math.atan2(2 * (message.pose.pose.orientation.w * message.pose.pose.orientation.z + message.pose.pose.orientation.x * message.pose.pose.orientation.y), 1 - 2 * (message.pose.pose.orientation.y * message.pose.pose.orientation.y + message.pose.pose.orientation.z * message.pose.pose.orientation.z));
    robotPose.active = true;
    updateRobotMarker();
});

const odomTopic = new ROSLIB.Topic({ ros: ros, name: '/odom', messageType: 'nav_msgs/msg/Odometry' });
odomTopic.subscribe(function(message) {
    const vx = message.twist.twist.linear.x;
    const vth = message.twist.twist.angular.z;
    const moving = Math.abs(vx) > 0.01 || Math.abs(vth) > 0.01;
    determineStatus(moving);
});

const batteryTopic = new ROSLIB.Topic({ ros: ros, name: '/battery_state', messageType: 'sensor_msgs/msg/BatteryState' });
let latestBatteryMsg = null;
batteryTopic.subscribe(function(message) { latestBatteryMsg = message; });

setInterval(function() {
    if (!latestBatteryMsg) return;
    let currentVoltage = latestBatteryMsg.voltage;
    let rawPercentage = latestBatteryMsg.percentage;
    let batteryPercent = rawPercentage <= 1.0 ? Math.round(rawPercentage * 100) : Math.round(rawPercentage);
    if (lastVoltage > 0) {
        if (currentVoltage >= lastVoltage + 0.1) isChargingState = true;
        else if (currentVoltage < lastVoltage - 0.05) isChargingState = false;
    }
    lastVoltage = currentVoltage;
    document.getElementById('top-battery-val').innerText = batteryPercent + "%";
    document.getElementById('robot-battery-list').innerText = batteryPercent + "%";

    if (batteryPercent <= 35 && !isChargingState && !batteryChargeTriggered) {
        batteryChargeTriggered = true; 
        if (!hasSpokenLowBattery) {
            speakTopic.publish(new ROSLIB.Message({ data: "배터리가 부족합니다. 충전소로 이동합니다." }));
            hasSpokenLowBattery = true;
        }
        setIssueState(true, `배터리 부족(${batteryPercent}%). 충전 위치로 자동 이동합니다.`);
        goToChargeStation();
    } else if (batteryPercent > 40) {
        batteryChargeTriggered = false; hasSpokenLowBattery = false; 
    }
    refreshTopCards();
}, 3000);

imageTopic.subscribe(function (message) {
    const imgElement = document.getElementById('camera-feed');
    // 브라우저 캐시 문제를 방지하기 위해 base64 데이터를 즉시 교체
    imgElement.src = "data:image/jpeg;base64," + message.data;
    
    // 로딩 문구 숨기기
    const loadingMsg = document.getElementById('camera-loading');
    if (loadingMsg) loadingMsg.style.display = 'none';
    imgElement.style.display = 'block';
});

// --- [6. 제어 기능] ---
// [수정3] yaw → quaternion 변환 헬퍼 함수 (guide.js와 동일)
function yawToQuaternion(yaw) {
    return {
        x: 0.0,
        y: 0.0,
        z: Math.sin(yaw / 2),
        w: Math.cos(yaw / 2)
    };
}

function returnToHome() {
    const homeObj = mapData.objects.find(obj => obj.type === 'home');
    if (!homeObj) return;
    currentTargetPose = { x: homeObj.ros_x, y: homeObj.ros_y };
    // [수정3] yaw가 objects.yaml에 저장되어 있으면 적용, 없으면 기본값 0.0
    const yaw = (homeObj.yaw !== undefined && homeObj.yaw !== null) ? parseFloat(homeObj.yaw) : 0.0;
    const orientation = yawToQuaternion(yaw);
    goalPoseTopic.publish(new ROSLIB.Message({
        header: { frame_id: 'map' },
        pose: { position: { x: homeObj.ros_x, y: homeObj.ros_y, z: 0.0 }, orientation: orientation }
    }));
    robotStatus = 'navigating'; updateStatusUI(); 
}

function goToChargeStation() {
    const chargeObj = mapData.objects.find(obj => obj.type === 'charge');
    if (chargeObj) {
        currentTargetPose = { x: chargeObj.ros_x, y: chargeObj.ros_y };
        // [수정3] yaw 적용
        const yaw = (chargeObj.yaw !== undefined && chargeObj.yaw !== null) ? parseFloat(chargeObj.yaw) : 0.0;
        const orientation = yawToQuaternion(yaw);
        goalPoseTopic.publish(new ROSLIB.Message({
            header: { frame_id: 'map' },
            pose: { position: { x: chargeObj.ros_x, y: chargeObj.ros_y, z: 0.0 }, orientation: orientation }
        }));
        robotStatus = 'navigating'; updateStatusUI();
    }
}

function emergencyStop() {
    robotStatus = 'emergency'; currentTargetPose = null;
    setIssueState(true, "비상 정지가 활성화되었습니다!");
    updateStatusUI();
    if (teleopInterval) { clearInterval(teleopInterval); teleopInterval = null; }
    if (emergencyInterval) clearInterval(emergencyInterval);
    emergencyInterval = setInterval(() => {
        cmdVel.publish(new ROSLIB.Message({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }));
    }, 50); 
}

const keys = { w: false, a: false, s: false, d: false };
let teleopInterval = null;

window.toggleManualControl = function() {
    isManualActive = !isManualActive;
    const btn = document.getElementById('manual-control-btn');
    const guide = document.getElementById('keyboard-guide');
    if (isManualActive) {
        robotStatus = 'manual'; btn.classList.add('btn-manual-active');
        guide.style.display = "block";
        if (!teleopInterval) teleopInterval = setInterval(publishTeleop, 100);
    } else {
        robotStatus = 'idle'; btn.classList.remove('btn-manual-active');
        guide.style.display = "none"; 
        if (teleopInterval) { clearInterval(teleopInterval); teleopInterval = null; }
        cmdVel.publish(new ROSLIB.Message({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } }));
        keys.w = keys.a = keys.s = keys.d = false;
    }
    updateStatusUI();
};

window.addEventListener('keydown', (e) => {
    if (!isManualActive) return;
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) keys[key] = true;
});
window.addEventListener('keyup', (e) => {
    if (!isManualActive) return;
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd'].includes(key)) keys[key] = false;
});

function publishTeleop() {
    let linear = 0, angular = 0;
    if (keys.w) linear = currentMaxSpeed;
    if (keys.s) linear = -currentMaxSpeed;
    if (keys.a) angular = 0.7;
    if (keys.d) angular = -0.7;
    cmdVel.publish(new ROSLIB.Message({ linear: { x: linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: angular } }));
}

window.updateMaxSpeed = function() {
    const speedInput = document.getElementById('maxSpeed');
    currentMaxSpeed = parseFloat(speedInput.value);
    document.getElementById('guide-speed-val').innerText = currentMaxSpeed.toFixed(2);
};

window.updateVolumeSlider = function() {
    const volInput = document.getElementById('speakerVolume');
    const volValue = parseInt(volInput.value);
    document.getElementById('volumeDisplay').innerText = volValue + "%";
    volumeTopic.publish(new ROSLIB.Message({ data: volValue }));
    clearTimeout(volumeApiTimer);
    volumeApiTimer = setTimeout(() => {
        fetch('/api/robot/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume: volValue }) });
        localStorage.setItem('robotVolume', volValue);
    }, 200);
};

window.resetSettings = function() {
    document.getElementById('maxSpeed').value = 0.20; updateMaxSpeed();
    document.getElementById('speakerVolume').value = 75; updateVolumeSlider();
};

function updateStatusUI() {
    const ind = document.getElementById('robot-indicator');
    const txt = document.getElementById('robot-status-text');
    let color = "#10b981", label = "Idle";
    switch(robotStatus) {
        case 'driving': color = "#3b82f6"; label = "Driving"; break;
        case 'charging': color = "#f59e0b"; label = "Charging"; break;
        case 'goal_reached': color = "#10b981"; label = "Goal Reached"; break;
        case 'emergency': color = "#ef4444"; label = "Emergency"; break;
        case 'navigating': color = "#6366f1"; label = "Navigating"; break;
        case 'manual': color = "#ef4444"; label = "Manual"; break;
    }
    if(ind) ind.style.backgroundColor = color;
    if(txt) { txt.innerText = label; txt.style.color = color; }
    refreshTopCards();
}

function showAlert(msg, overrideCooldown = false) {
    const now = Date.now();
    if (!overrideCooldown && now - lastAlertTime < 10000) return; 
    lastAlertTime = now;
    const alertBox = document.getElementById('issue-alert');
    const alertMsg = document.getElementById('alert-message');
    if(alertBox) {
        alertBox.style.backgroundColor = (msg.includes("이동") || msg.includes("정상") || msg.includes("해제")) ? "#3b82f6" : "#ef4444"; 
        alertMsg.innerText = msg;
        alertBox.style.display = 'block';
        setTimeout(() => { alertBox.style.display = 'none'; }, 5000);
    }
}

function refreshTopCards() {
    let valActive = 0, valCharging = 0, valIssue = 0;
    if (globalIssue || robotStatus === 'emergency') valIssue = 1; 
    if (isChargingState) valCharging = 1; 
    if (!valIssue && !isChargingState) valActive = 1;
    if(document.getElementById('top-active-val')) document.getElementById('top-active-val').innerText = valActive;
    if(document.getElementById('top-charging-val')) document.getElementById('top-charging-val').innerText = valCharging;
    if(document.getElementById('top-issue-val')) document.getElementById('top-issue-val').innerText = valIssue;
}

function setIssueState(hasIssue, msg = null) {
    globalIssue = hasIssue;
    if (hasIssue && msg) showAlert(msg, true);
    refreshTopCards();
}

// --- [가상 로봇 목적지 설정을 위한 지도 클릭 이벤트] ---
document.getElementById('map-wrapper').addEventListener('click', function(e) {
    // 가상 로봇이 선택되지 않았거나 맵 메타데이터가 없으면 무시
    if (!window.selectedVRobotId || !isMapLoaded || MAP_META.mapHeight === 0) return;

    const rect = this.getBoundingClientRect();
    // 1. 화면 클릭 좌표 -> Wrapper 내부 픽셀 좌표
    const pxX = (e.clientX - rect.left) / (rect.width / (slamMapImg.width * MAP_SCALE));
    const pxY = (e.clientY - rect.top) / (rect.height / (slamMapImg.height * MAP_SCALE));

    // 2. 픽셀 좌표 -> ROS 미터 좌표 역산 (rosToPixel의 반대 과정)
    const imgX = pxX / MAP_SCALE;
    const imgY = pxY / MAP_SCALE;
    
    const rosX = (imgX * MAP_META.resolution) + MAP_META.originX;
    const rosY = ((MAP_META.mapHeight - imgY) * MAP_META.resolution) + MAP_META.originY;

    // 3. 해당 가상 로봇 주행 시작
    startVRobotDriving(window.selectedVRobotId, rosX, rosY);
});

window.addEventListener('resize', calculateFit);

window.onload = () => {
    updateMaxSpeed(); 
    const savedVol = localStorage.getItem('robotVolume') || 75;
    const volInput = document.getElementById('speakerVolume');
    if (volInput) { volInput.value = savedVol; updateVolumeSlider(); }
    setInterval(() => { if(document.getElementById('current-time')) document.getElementById('current-time').textContent = new Date().toLocaleString(); }, 1000);
    
    loadMapSettings(); 
    updateStatusUI();

    // --- [추가] 가상 로봇 초기화 및 주기적 동기화 ---
    updateVirtualFleet();
    setInterval(updateVirtualFleet, 2000); // 2초마다 서버와 상태 동기화
};