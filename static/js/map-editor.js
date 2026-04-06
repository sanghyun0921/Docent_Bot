// map-editor.js
let currentMapMeta = {
    originX: 0.0,
    originY: 0.0,
    resolution: 0.05
};
const MAP_SCALE = 8.0;

// --- ROS 2 연결 ---
const rosIP = "192.168.0.21";
const ros = new ROSLIB.Ros({ url: `ws://${rosIP}:9090` });
let robotPose = { x: 0, y: 0, theta: 0, active: false };

ros.on('connection', () => {
    document.getElementById('ros-status').innerText = "(ROS: Connected)";
    document.getElementById('ros-status').style.color = "#10b981";
});
ros.on('close', () => {
    document.getElementById('ros-status').innerText = "(ROS: Disconnected)";
    document.getElementById('ros-status').style.color = "gray";
    // [수정2] 탭 전환 시 일시적 disconnect는 화살표 숨기지 않음
    if (!document.hidden) {
        robotPose.active = false;
        updateRobotMarker();
    }
});

// [수정2] 탭에서 돌아올 때 ROS 재연결 시도
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        if (ros.isConnected === false) {
            try { ros.connect(`ws://${rosIP}:9090`); } catch(e) {}
        }
        // 마지막 알려진 위치 있으면 마커 복원
        if (robotPose.x !== 0 || robotPose.y !== 0) {
            robotPose.active = true;
            updateRobotMarker();
        }
    }
});

const initialPoseTopic = new ROSLIB.Topic({ ros: ros, name: '/initialpose', messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped' });
const goalPoseTopic = new ROSLIB.Topic({ ros: ros, name: '/goal_pose', messageType: 'geometry_msgs/msg/PoseStamped' });
const amclPoseTopic = new ROSLIB.Topic({ ros: ros, name: '/amcl_pose', messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped' });

function getYawFromQuaternion(q) {
    const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
    const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
    return Math.atan2(siny_cosp, cosy_cosp);
}

function createQuaternion(yaw) {
    return { x: 0.0, y: 0.0, z: Math.sin(yaw / 2.0), w: Math.cos(yaw / 2.0) };
}

amclPoseTopic.subscribe(function (message) {
    robotPose.x = message.pose.pose.position.x;
    robotPose.y = message.pose.pose.position.y;
    robotPose.theta = getYawFromQuaternion(message.pose.pose.orientation);
    robotPose.active = true;
    updateRobotMarker();
});

// --- 캔버스 및 상태 변수 ---
const GRID_SIZE = 20;
let selectedTool = null;
let isDragging = false, dragTarget = null, dragOffset = { x: 0, y: 0 };
let dragStartX = 0, dragStartY = 0, isClick = false;
let isPoseDragging = false, poseStartPx = { x: 0, y: 0 };

// ★ 방향 설정 전용 상태 변수
let isYawDragging = false;
let yawDragTarget = null;
let yawStartPx = { x: 0, y: 0 };

const container = document.getElementById('canvasContainer');
const objectsContainer = document.getElementById('objectsContainer');
const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const snap = (val) => Math.round(val / GRID_SIZE) * GRID_SIZE;

const slamMapImg = new Image();
slamMapImg.src = '/static/maps/art_gallery.png';
let isMapLoaded = false;

slamMapImg.onload = () => {
    isMapLoaded = true;
    canvas.width = slamMapImg.width * MAP_SCALE;
    canvas.height = slamMapImg.height * MAP_SCALE;
    container.style.width = canvas.width + 'px';
    container.style.height = canvas.height + 'px';
    drawGrid();
    loadMap();
};

function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (isMapLoaded) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(slamMapImg, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#1a1f2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < canvas.width; x += GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
}

// --- 좌표 변환 ---
function rawPxToRos(rawX, rawY) {
    const H = slamMapImg.naturalHeight;
    let orig_img_x = rawX / MAP_SCALE;
    let orig_img_y = rawY / MAP_SCALE;
    let ros_x = (orig_img_x * currentMapMeta.resolution) + currentMapMeta.originX;
    let ros_y = ((H - orig_img_y) * currentMapMeta.resolution) + currentMapMeta.originY;
    return {
        ros_x: parseFloat(ros_x.toFixed(3)),
        ros_y: parseFloat(ros_y.toFixed(3))
    };
}

function rosToRawPx(rosX, rosY) {
    const H = slamMapImg.naturalHeight;
    let orig_img_x = (rosX - currentMapMeta.originX) / currentMapMeta.resolution;
    let orig_img_y = H - ((rosY - currentMapMeta.originY) / currentMapMeta.resolution);
    return {
        px_x: orig_img_x * MAP_SCALE,
        px_y: orig_img_y * MAP_SCALE
    };
}

function getRosCoord(px_left, px_top) {
    return rawPxToRos(px_left + 40, px_top + 25);
}

function updateRobotMarker() {
    const marker = document.getElementById('robot-marker');
    if (!robotPose.active || !isMapLoaded) { marker.style.display = 'none'; return; }
    marker.style.display = 'block';
    const screenPos = rosToRawPx(robotPose.x, robotPose.y);
    const deg = robotPose.theta * (180 / Math.PI);
    const screen_deg = -deg + 90;
    marker.style.left = screenPos.px_x + 'px';
    marker.style.top = screenPos.px_y + 'px';
    marker.style.transform = `rotate(${screen_deg}deg)`;
}

// --- 도구 선택 ---
function selectTool(tool) {
    selectedTool = tool;
    document.getElementById('infoPanel').style.display = 'none';
    document.querySelectorAll('.tool-button').forEach(b => b.classList.remove('active'));
    if (tool === null) {
        document.querySelector('.tool-button[onclick="selectTool(null)"]').classList.add('active');
    } else {
        const sel = tool === 'delete' ? '.delete-tool'
                  : tool === 'set_yaw' ? '.set_yaw'
                  : `.${tool}`;
        const btn = document.querySelector(`.tool-button${sel}`);
        if (btn) btn.classList.add('active');
    }
}

// ★ 방향 화살표를 캔버스에 그리는 함수
function drawYawArrow(startX, startY, endX, endY, color = '#f59e0b') {
    drawGrid();
    // 기존 오브젝트 다시 그리기
    document.querySelectorAll('.map-object').forEach(el => {
        // (오브젝트들은 DOM이므로 캔버스와 별개, drawGrid만 다시 그리면 됨)
    });

    const dx = endX - startX;
    const dy = endY - startY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    // 화살표 선
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // 화살표 머리
    const angle = Math.atan2(dy, dx);
    const arrowLen = 15;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowLen * Math.cos(angle - 0.4), endY - arrowLen * Math.sin(angle - 0.4));
    ctx.lineTo(endX - arrowLen * Math.cos(angle + 0.4), endY - arrowLen * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();

    // 각도 텍스트
    const yaw = Math.atan2(-dy, dx);
    const deg = (yaw * 180 / Math.PI).toFixed(1);
    ctx.fillStyle = 'black';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${deg}°`, endX + 8, endY - 8);

    ctx.restore();
}

// --- 마우스 이벤트 ---
container.addEventListener('mousedown', (e) => {
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // [초기 위치 추정] 드래그 시작
    if (selectedTool === 'initial_pose') {
        isPoseDragging = true;
        poseStartPx = { x: rawX, y: rawY };
        return;
    }

    // [목적지 이동 명령] 즉시 전송 (자유 클릭 목적지이므로 yaw=0 기본값 사용)
    if (selectedTool === 'goal_pose') {
        const coords = rawPxToRos(rawX, rawY);
        const msg = new ROSLIB.Message({
            header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
            pose: {
                position: { x: coords.ros_x, y: coords.ros_y, z: 0.0 },
                orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
            }
        });
        goalPoseTopic.publish(msg);
        alert(`🚩 이동 명령: (X: ${coords.ros_x}, Y: ${coords.ros_y})`);
        selectTool(null);
        return;
    }

    // ★ [방향 설정] 오브젝트 클릭 후 드래그로 yaw 설정
    if (selectedTool === 'set_yaw') {
        const targetObject = e.target.closest('.map-object');
        if (targetObject) {
            isYawDragging = true;
            yawDragTarget = targetObject;
            // 오브젝트 중심 좌표 계산
            const objLeft = parseInt(targetObject.style.left) + 40;
            const objTop = parseInt(targetObject.style.top) + 25;
            yawStartPx = { x: objLeft, y: objTop };
        } else {
            alert('방향을 설정할 오브젝트를 클릭해주세요.');
        }
        return;
    }

    const targetObject = e.target.closest('.map-object');
    if (!targetObject) document.getElementById('infoPanel').style.display = 'none';
    if (selectedTool === 'delete') { if (targetObject) targetObject.remove(); return; }

    if (targetObject) {
        isDragging = true;
        dragTarget = targetObject;
        dragOffset.x = rawX - parseInt(dragTarget.style.left);
        dragOffset.y = rawY - parseInt(dragTarget.style.top);
        dragStartX = rawX;
        dragStartY = rawY;
        isClick = true;
        return;
    }

    if (selectedTool && selectedTool !== 'delete') {
        if (selectedTool === 'artwork') {
            window.lastClickPos = { x: snap(rawX), y: snap(rawY) };
            document.getElementById('artworkDialog').style.display = 'flex';
        } else {
            addObject(selectedTool, snap(rawX), snap(rawY));
        }
    }
});

container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // [초기 위치 드래그 시각화]
    if (isPoseDragging) {
        drawGrid();
        ctx.beginPath();
        ctx.moveTo(poseStartPx.x, poseStartPx.y);
        ctx.lineTo(rawX, rawY);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rawX, rawY, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        return;
    }

    // ★ [방향 설정 드래그 시각화] 노란색 화살표
    if (isYawDragging && yawDragTarget) {
        drawYawArrow(yawStartPx.x, yawStartPx.y, rawX, rawY, '#f59e0b');
        return;
    }

    if (!isDragging || !dragTarget) return;
    if (Math.abs(rawX - dragStartX) > 5 || Math.abs(rawY - dragStartY) > 5) isClick = false;
    dragTarget.style.left = snap(rawX - dragOffset.x) + 'px';
    dragTarget.style.top = snap(rawY - dragOffset.y) + 'px';
});

window.addEventListener('mouseup', (e) => {
    const rect = container.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;

    // [초기 위치 방향 설정 완료]
    if (isPoseDragging) {
        isPoseDragging = false;
        drawGrid();
        const startRos = rawPxToRos(poseStartPx.x, poseStartPx.y);
        const dx = rawX - poseStartPx.x;
        const dy = rawY - poseStartPx.y;
        let theta = Math.atan2(-dy, dx);
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) theta = 0.0;

        const msg = new ROSLIB.Message({
            header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
            pose: {
                pose: {
                    position: { x: startRos.ros_x, y: startRos.ros_y, z: 0.0 },
                    orientation: createQuaternion(theta)
                },
                covariance: [0.25, 0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.068]
            }
        });
        initialPoseTopic.publish(msg);
        alert(`📍 초기 위치 설정 완료`);
        selectTool(null);
        return;
    }

    // ★ [방향 설정 완료] yaw 계산 후 오브젝트에 저장
    if (isYawDragging && yawDragTarget) {
        isYawDragging = false;
        drawGrid();

        const dx = rawX - yawStartPx.x;
        const dy = rawY - yawStartPx.y;

        // 드래그 거리가 너무 짧으면 취소
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
            yawDragTarget = null;
            return;
        }

        const yaw = Math.atan2(-dy, dx); // Y축 반전 보정
        yawDragTarget.dataset.yaw = yaw.toFixed(4);

        // ★ 오브젝트에 방향 표시 배지 업데이트
        const deg = (yaw * 180 / Math.PI).toFixed(1);
        let yawBadge = yawDragTarget.querySelector('.yaw-badge');
        if (!yawBadge) {
            yawBadge = document.createElement('div');
            yawBadge.className = 'yaw-badge';
            yawBadge.style.cssText = 'font-size:9px; color:#f59e0b; font-weight:bold; pointer-events:none; text-shadow:1px 1px 2px black;';
            yawDragTarget.appendChild(yawBadge);
        }
        yawBadge.textContent = `↗ ${deg}°`;

        const name = yawDragTarget.dataset.name || yawDragTarget.querySelector('.object-label')?.innerText || '오브젝트';
        alert(`🧭 [${name}] 방향 설정 완료\nyaw: ${yaw.toFixed(4)} rad (${deg}°)\n\n맵 저장(YAML) 버튼을 눌러 저장하세요.`);

        yawDragTarget = null;
        return;
    }

    if (isDragging && dragTarget && isClick && selectedTool === null) {
        const px_left = parseInt(dragTarget.style.left);
        const px_top = parseInt(dragTarget.style.top);
        const coords = getRosCoord(px_left, px_top);
        document.getElementById('infoName').innerText = dragTarget.dataset.type === 'artwork'
            ? dragTarget.dataset.name
            : dragTarget.querySelector('.object-label')?.innerText.trim() || '';
        document.getElementById('infoRosX').innerText = coords.ros_x;
        document.getElementById('infoRosY').innerText = coords.ros_y;

        // ★ yaw 정보도 패널에 표시
        const yawVal = dragTarget.dataset.yaw;
        const infoPanel = document.getElementById('infoPanel');
        let yawRow = document.getElementById('infoYawRow');
        if (!yawRow) {
            yawRow = document.createElement('div');
            yawRow.id = 'infoYawRow';
            yawRow.className = 'info-row';
            infoPanel.appendChild(yawRow);
        }
        if (yawVal !== undefined) {
            const deg = (parseFloat(yawVal) * 180 / Math.PI).toFixed(1);
            yawRow.innerHTML = `방향 (yaw): <span class="info-val" style="color:#f59e0b;">${parseFloat(yawVal).toFixed(4)} rad (${deg}°)</span>`;
        } else {
            yawRow.innerHTML = `방향 (yaw): <span class="info-val" style="color:#6b7280;">미설정 (0.0)</span>`;
        }

        document.getElementById('infoPanel').style.display = 'block';
    }
    isDragging = false;
    dragTarget = null;
});

// --- 객체 관리 ---
function addObject(type, x, y, data = {}) {
    const el = document.createElement('div');
    el.className = `map-object ${type}-object`;
    el.dataset.type = type;
    el.style.left = (x - 40) + 'px';
    el.style.top = (y - 25) + 'px';

    // ★ yaw 데이터가 있으면 dataset에 저장
    if (data.yaw !== undefined && data.yaw !== null) {
        el.dataset.yaw = parseFloat(data.yaw).toFixed(4);
    }

    let iconSvg = '', labelText = '', subText = '', yawBadge = '';

    // ★ yaw 배지 생성 (저장된 방향이 있을 때)
    if (data.yaw !== undefined && data.yaw !== null) {
        const deg = (parseFloat(data.yaw) * 180 / Math.PI).toFixed(1);
        yawBadge = `<div class="yaw-badge" style="font-size:9px; color:#f59e0b; font-weight:bold; pointer-events:none; text-shadow:1px 1px 2px black;">↗ ${deg}°</div>`;
    }

    switch (type) {
        case 'artwork':
            iconSvg = '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
            labelText = data.title || '미술품';
            subText = data.artist ? `<div class="object-sub">${data.artist}</div>` : '';
            el.dataset.name = labelText;
            el.dataset.artist = data.artist || "";
            el.dataset.desc = data.desc || "";
            break;
        case 'desk':
            iconSvg = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
            labelText = '안내데스크';
            break;
        case 'home':
            iconSvg = '<svg class="icon" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
            labelText = '로봇 홈';
            break;
        case 'charge':
            iconSvg = '<svg class="icon" viewBox="0 0 24 24"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect><line x1="23" y1="19" x2="19" y2="19"></line></svg>';
            labelText = '충전위치';
            break;
    }
    el.innerHTML = `${iconSvg}<div class="object-label">${labelText}</div>${subText}${yawBadge}`;
    objectsContainer.appendChild(el);
}

function submitArtwork() {
    const t = document.getElementById('artTitle').value;
    const a = document.getElementById('artArtist').value;
    const d = document.getElementById('artDesc').value;
    if (t) {
        addObject('artwork', window.lastClickPos.x + 40, window.lastClickPos.y + 25, { title: t, artist: a, desc: d });
        closeDialog();
    }
}

function closeDialog() {
    document.getElementById('artworkDialog').style.display = 'none';
}

// ★ [핵심] saveMap - yaw 포함해서 저장
function saveMap() {
    const objects = [];
    document.querySelectorAll('.map-object').forEach(el => {
        const item = {
            type: el.dataset.type,
            x: parseInt(el.style.left),
            y: parseInt(el.style.top),
            name: el.dataset.type === 'artwork'
                ? el.dataset.name
                : el.querySelector('.object-label')?.innerText || '',
            artist: el.dataset.artist || "",
            desc: el.dataset.desc || "",
            yaw: (el.dataset.yaw !== undefined && el.dataset.yaw !== '')
                ? parseFloat(el.dataset.yaw)
                : 0.0   // ★ yaw 저장 (없으면 0.0)
        };
        const coords = getRosCoord(item.x, item.y);
        item.ros_x = coords.ros_x;
        item.ros_y = coords.ros_y;
        objects.push(item);
    });
    fetch('/api/save-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objects })
    }).then(() => alert('맵 저장 완료! (yaw 방향 포함)'));
}

async function loadMap() {
    const res = await fetch('/api/load-map');
    const data = await res.json();

    if (data.origin) {
        currentMapMeta.originX = data.origin[0];
        currentMapMeta.originY = data.origin[1];
        currentMapMeta.resolution = data.resolution;
        console.log("Map Metadata Updated:", currentMapMeta);
    }

    if (data.objects) {
        objectsContainer.innerHTML = '';
        data.objects.forEach(obj => {
            const screenPos = rosToRawPx(obj.ros_x, obj.ros_y);
            addObject(obj.type, screenPos.px_x, screenPos.px_y, {
                title: obj.name,
                artist: obj.artist,
                desc: obj.desc,
                yaw: obj.yaw   // ★ yaw도 불러오기
            });
        });
    }
}

// selectTool 함수를 래핑해서 배너 토글 추가
const _originalSelectTool = selectTool;
selectTool = function(tool) {
    _originalSelectTool(tool);
    const banner = document.getElementById('yaw-guide-banner');
    const canvasContainer = document.getElementById('canvasContainer');
    if (tool === 'set_yaw') {
        banner.style.display = 'block';
        canvasContainer.classList.add('yaw-mode');
    } else {
        banner.style.display = 'none';
        canvasContainer.classList.remove('yaw-mode');
    }
};