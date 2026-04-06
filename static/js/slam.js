/**
 * slam.js - 로봇 중심 실시간 맵핑, 인터랙션, 프리셋 관리 및 강력한 프로세스 제어 통합본
 */

const ros = new ROSLIB.Ros({ url: 'ws://192.168.0.21:9090' });
let mapData = null;
let scanData = null;
let robotPose = { x: 0, y: 0, theta: 0 };
let currentMaxSpeed = 0.10;
let lastMapTime = Date.now();
let mapReceivedOnce = false; // 맵 수신 확인용 플래그
let yaw_offset = 0;

const mapImageCanvas = document.createElement('canvas');
const mapImageCtx = mapImageCanvas.getContext('2d');
let isMapImageReady = false;

// --- [보정 설정값] ---
window.ROBOT_ANGLE_FIX = 0; 
window.LIDAR_ANGLE_FIX = 0; 

// Rviz style Viewport state
let view = {
    zoom: 30.0, // 줌 초기값을 조금 더 키움 (맵이 잘 보이게)
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false, 
    isPanning: false,   
    lastMouse: { x: 0, y: 0 }
};

const canvas = document.getElementById('slamCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('slam-canvas-container');

// ROS Topics 정의
const mapTopic = new ROSLIB.Topic({ ros, name: '/map', messageType: 'nav_msgs/OccupancyGrid' });
const scanTopic = new ROSLIB.Topic({ ros, name: '/scan', messageType: 'sensor_msgs/LaserScan' });
const odomTopic = new ROSLIB.Topic({ ros, name: '/odom', messageType: 'nav_msgs/Odometry' });
const cmdVel = new ROSLIB.Topic({ ros, name: '/cmd_vel', messageType: 'geometry_msgs/Twist' });

/**
 * 1. 데이터 처리 콜백 함수 (재사용 가능하도록 분리)
 */

function handleMapData(m) {
    if (!m || !m.info) return;

    const now = Date.now();
    const timeDiff = now - lastMapTime;
    if (timeDiff > 0) {
        document.getElementById('map-hz').innerText = (1000 / timeDiff).toFixed(1);
    }
    lastMapTime = now;
    mapData = m;

    document.getElementById('map-w').innerText = m.info.width;
    document.getElementById('map-h').innerText = m.info.height;

    // 가상 캔버스에 맵 이미지 미리 그리기
    mapImageCanvas.width = m.info.width;
    mapImageCanvas.height = m.info.height;
    const imgData = mapImageCtx.createImageData(m.info.width, m.info.height);

    for (let i = 0; i < m.data.length; i++) {
        const val = m.data[i];
        const idx = i * 4;
        let c;
        if (val === -1) c = 50;       // Unknown
        else if (val === 0) c = 255;  // Free
        else c = 0;                   // Occupied (Wall)
        
        imgData.data[idx] = imgData.data[idx+1] = imgData.data[idx+2] = c;
        imgData.data[idx+3] = 255; 
    }
    mapImageCtx.putImageData(imgData, 0, 0);
    isMapImageReady = true;
}

function handleScanData(m) {
    scanData = m;
}

/**
 * 2. 실시간 렌더링 루프 (North-Up, 로봇 중심 뷰)
 */

function resetRobotHeading() {
    if (!confirm("현재 로봇이 바라보는 방향을 정면(0도)으로 설정하시겠습니까?")) return;

    addLog("로봇 방향 영점 조절 중...");

    fetch('/api/robot/reset_odom', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(async (response) => {
        if (!response.ok) {
            // 서버에서 404나 500 에러가 났을 경우
            const errorData = await response.text(); // json이 아닐 수 있으므로 text로 받음
            throw new Error(`서버 응답 오류 (${response.status})`);
        }
        return response.json();
    })
    .then(d => {
        // [소프트웨어 보정] 서버 명령 성공 여부와 상관없이 현재 웹 화면의 각도를 0으로 맞춤
        yaw_offset = -robotPose.theta; 
        
        document.getElementById('rob-th').innerText = "0.0";
        addLog("✅ 영점 조절 완료: 현재 위치를 기준으로 좌표가 보정되었습니다.");
        alert("방향 영점 조절이 완료되었습니다.");
    })
    .catch(err => {
        console.error("영점 조절 API 호출 실패:", err);
        // API가 없더라도 웹 화면에서라도 맞추고 싶다면 아래 줄 주석 해제
        // yaw_offset = -robotPose.theta; 
        addLog("❌ 영점 조절 실패 (서버 연결 확인 필요)");
        alert("영점 조절 실패: " + err.message);
    });
}


/**
 * 2. 실시간 렌더링 루프
 */
function render() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2 + view.offsetX;
    const centerY = canvas.height / 2 + view.offsetY;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(view.zoom, -view.zoom); // ROS 좌표계 동기화
    ctx.rotate(view.rotation);
    ctx.translate(-robotPose.x, -robotPose.y);

    // [맵 그리기]
    if (isMapImageReady && mapData) {
        const info = mapData.info;
        ctx.save();
        ctx.translate(info.origin.position.x, info.origin.position.y);
        ctx.scale(info.resolution, info.resolution);
        ctx.drawImage(mapImageCanvas, 0, 0);
        ctx.restore();
    }

    // [라이다 그리기]
    if (scanData) {
        ctx.fillStyle = "red";
        for (let i = 0; i < scanData.ranges.length; i++) {
            const r = scanData.ranges[i];
            if (r < scanData.range_min || r > scanData.range_max) continue;
            const angle = scanData.angle_min + (i * scanData.angle_increment) + robotPose.theta + yaw_offset + window.LIDAR_ANGLE_FIX;
            const lx = robotPose.x + r * Math.cos(angle);
            const ly = robotPose.y + r * Math.sin(angle);
            ctx.fillRect(lx - 0.02, ly - 0.02, 0.04, 0.04);
        }
    }

    // [로봇 화살표 그리기]
    ctx.save();
    ctx.translate(robotPose.x, robotPose.y);
    ctx.rotate(robotPose.theta + yaw_offset + window.ROBOT_ANGLE_FIX);
    ctx.beginPath();
    ctx.moveTo(0.3, 0); ctx.lineTo(-0.15, 0.15); ctx.lineTo(-0.15, -0.15); ctx.closePath();
    ctx.fillStyle = "#3b82f6"; ctx.fill();
    ctx.strokeStyle = "white"; ctx.lineWidth = 0.03; ctx.stroke();
    ctx.restore();

    ctx.restore();
    requestAnimationFrame(render);
}

/**
 * 3. 마우스 인터랙션
 */
container.addEventListener('wheel', e => {
    e.preventDefault();
    view.zoom *= e.deltaY > 0 ? 0.9 : 1.1;
});

container.addEventListener('mousedown', e => {
    if (e.button === 0) view.isDragging = true; 
    if (e.button === 1) view.isPanning = true;   
    view.lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mousemove', e => {
    if (!view.isDragging && !view.isPanning) return;
    const dx = e.clientX - view.lastMouse.x;
    const dy = e.clientY - view.lastMouse.y;
    if (view.isDragging) view.rotation += dx * 0.01;
    if (view.isPanning) { view.offsetX += dx; view.offsetY += dy; }
    view.lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseup', () => { view.isDragging = view.isPanning = false; });

/**
 * 4. 수동 조작 및 [입력 방지 로직]
 */
const keys = { w: false, a: false, s: false, d: false, x: false };

window.addEventListener('keydown', e => {
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return; 

    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) {
        keys[k] = true;
        updateKeyUI();
        sendMoveCommand();
    }
});

window.addEventListener('keyup', e => {
    const activeTag = document.activeElement.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

    const k = e.key.toLowerCase();
    if (keys.hasOwnProperty(k)) keys[k] = false;
    updateKeyUI();
});

function updateKeyUI() {
    for (let k in keys) {
        const el = document.getElementById(`key-${k}`);
        if (el) keys[k] ? el.classList.add('active') : el.classList.remove('active');
    }
}

function sendMoveCommand() {
    let lin = 0, ang = 0;
    if (keys.w) lin = currentMaxSpeed;
    if (keys.s) lin = -currentMaxSpeed;
    if (keys.a) ang = 0.6;
    if (keys.d) ang = -0.6;
    if (keys.x) { lin = 0; ang = 0; }
    cmdVel.publish(new ROSLIB.Message({ linear: { x: lin, y: 0, z: 0 }, angular: { x: 0, y: 0, z: ang } }));
}

function updateSlamSpeed() {
    currentMaxSpeed = parseFloat(document.getElementById('slam-speed').value);
    document.getElementById('speed-display').innerText = currentMaxSpeed.toFixed(2) + " m/s";
}

/**
 * 5. SLAM 프로세스 제어 (구독 해제/재구독 로직 포함)
 */
function addLog(msg) {
    const logBox = document.getElementById('slam-logs');
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div><span class="log-time">[${time}]</span> ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// [수정] 버튼을 눌렀을 때만 구독 시작
function startSlam() {
    addLog("SLAM 프로세스를 시작합니다...");
    
    // 맵과 스캔 데이터 구독 시작
    mapTopic.subscribe(handleMapData);
    scanTopic.subscribe(handleScanData);

    fetch('/api/slam/start', { method: 'POST' })
    .then(r => r.json()).then(d => {
        addLog(d.message);
        document.getElementById('ros-status').innerText = "(ROS: Connected)";
        document.getElementById('ros-status').style.color = "#10b981";
    });
}

function stopSlam() {
    if(!confirm("SLAM을 중단하시겠습니까? 현재까지의 맵 데이터가 화면에서 사라집니다.")) return;
    
    addLog("SLAM 프로세스를 종료하는 중...");

    // [핵심] 1. 토픽 구독을 즉시 해지하여 화면 업데이트 차단
    mapTopic.unsubscribe();
    scanTopic.unsubscribe();
    
    // [핵심] 2. 데이터를 즉시 비워 잔상 제거
    mapData = null;
    scanData = null;

    fetch('/api/slam/stop', { method: 'POST' })
    .then(r => r.json()).then(d => {
        addLog(d.message);
        
        // UI 숫자 초기화
        document.getElementById('map-w').innerText = "0";
        document.getElementById('map-h').innerText = "0";
        document.getElementById('map-hz').innerText = "0";
        document.getElementById('ros-status').innerText = "(SLAM Stopped)";
        document.getElementById('ros-status').style.color = "gray";

        alert(d.message);
    });
}

function saveSlamMap() {
    const name = document.getElementById('map-filename').value;
    if (!name) return alert("저장할 파일 이름을 입력해주세요.");

    addLog(`맵 저장 요청: ${name}...`);
    fetch('/api/slam/save_map_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name })
    })
    .then(r => r.json()).then(d => {
        addLog(d.message);
        if (d.status === "success") {
            alert("저장 및 시스템 적용 완료!");
            refreshMapPresets();
        }
    });
}

/**
 * 6. 맵 프리셋 관리
 */
function refreshMapPresets() {
    fetch('/api/slam/list_maps')
    .then(r => r.json())
    .then(data => {
        const select = document.getElementById('map-presets');
        if (!select) return;
        while (select.options.length > 1) select.remove(1);
        data.maps.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            select.appendChild(opt);
        });
        addLog("맵 프리셋 목록을 갱신했습니다.");
    });
}

function loadSelectedPreset() {
    const filename = document.getElementById('map-presets').value;
    if (!filename) return alert("불러올 프리셋을 선택해주세요.");

    if (!confirm(`'${filename}' 맵을 시스템 전체에 적용하시겠습니까?`)) return;

    fetch('/api/slam/load_preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
    })
    .then(r => r.json())
    .then(d => {
        if (d.status === "success") {
            alert(d.message);
            location.reload(); 
        }
    });
}

function refreshMapPresets() {
    fetch('/api/slam/list_maps')
    .then(r => r.json())
    .then(data => {
        const select = document.getElementById('map-presets');
        if (!select) return;
        while (select.options.length > 1) select.remove(1);
        data.maps.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = name;
            select.appendChild(opt);
        });
    });
}

function deleteSelectedPreset() {
    const filename = document.getElementById('map-presets').value;
    if (!filename) return alert("삭제할 프리셋을 선택해주세요.");

    if (!confirm(`'${filename}' 맵 프리셋을 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;

    fetch('/api/slam/delete_preset', {
        method: 'POST', // 또는 DELETE (백엔드 설계에 따름)
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename })
    })
    .then(r => r.json())
    .then(d => {
        alert(d.message);
        refreshMapPresets(); // 목록 갱신
    })
    .catch(err => alert("삭제 실패: " + err));
}


/**
 * 7. 초기화 및 상시 데이터 구독
 */
document.addEventListener('DOMContentLoaded', () => {
    mapTopic.subscribe(handleMapData); // 맵 데이터 수신 시 전용 함수 호출
    scanTopic.subscribe(m => { scanData = m; });
    odomTopic.subscribe(m => {
        robotPose.x = m.pose.pose.position.x;
        robotPose.y = m.pose.pose.position.y;
        const q = m.pose.pose.orientation;
        robotPose.theta = Math.atan2(2*(q.w*q.z + q.x*q.y), 1-2*(q.y*q.y + q.z*q.z));
        
        document.getElementById('rob-x').innerText = robotPose.x.toFixed(2);
        document.getElementById('rob-y').innerText = robotPose.y.toFixed(2);
        document.getElementById('rob-th').innerText = ((robotPose.theta + yaw_offset) * 180 / Math.PI).toFixed(1);
    });
    
    refreshMapPresets();
    requestAnimationFrame(render);
});

ros.on('connection', () => {
    document.getElementById('ros-status').innerText = "(ROS: Connected)";
    document.getElementById('ros-status').style.color = "#10b981";
});