/**
 * START OF FILE: guide.js
 * 기능: 도슨트 안내 페이지, 실시간 미니맵 동기화, 점유 유지, 음성 인터랙션 (SLAM 동기화 버전)
 */

// --- [1. 전역 변수 및 설정] ---
const mockArtworks = ART_DATA;
const mockCourses = COURSE_DATA;

let isExiting = false;
let MAP_META = {
    originX: 0.0,
    originY: 0.0,
    resolution: 0.05,
    mapHeight: 0
};

let currentCourseId = null;
let currentProgress = 0;
let mode = "all-artworks";
let currentArtworkList = [];

// ROS 관련
let ros = null;
let targetCoords = { x: null, y: null };
let isArrived = false;
let globalVolume = 0.75;
let speakTopic = null;

// [통계 및 점유 관리]
let stayStartTime = null;
const user_token = sessionStorage.getItem('user_token');
let heartbeatInterval = null;

// 지도 렌더링
let mapCanvas, mapCtx;
let slamMapImg = new Image();
let isMapLoaded = false;
let mapData = { objects: [] };
let mapOffsetX = 0;
let mapOffsetY = 0;
let currentMapScale = 1;

// AI 대화
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isProcessing = false;

// --- [2. 초기화 및 이벤트] ---
document.addEventListener("DOMContentLoaded", () => {
    currentCourseId = getQueryParam("courseId");
    currentProgress = parseInt(getQueryParam("progress") || "0");
    mode = getQueryParam("mode") || "all-artworks";

    startHeartbeat();

    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.onresult = (event) => {
            if (isProcessing) return;

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

            const transcriptDisplay = document.getElementById("voice-transcript");
            if (transcriptDisplay) {
                transcriptDisplay.classList.remove("hidden");
                transcriptDisplay.textContent = finalTranscript || interimTranscript;
            }

            if (finalTranscript !== '') {
                console.log("🎤 최종 인식 문장:", finalTranscript);
                isProcessing = true;
                handleVoiceCommand(finalTranscript.trim());
            }
        };
        recognition.onstart = () => {
            const mic = document.getElementById("voice-mic-icon");
            if (mic) mic.classList.add("animate-pulse");
        };
        recognition.onend = () => {
            const mic = document.getElementById("voice-mic-icon");
            if (mic) mic.classList.remove("animate-pulse");
        };
        recognition.onerror = () => { isProcessing = false; stopVoiceCommand(); };
    }

    initRosConnection();
    initMap();
    initGuide();
});

// --- [3. SLAM 맵 동기화 및 렌더링] ---
function initMap() {
    mapCanvas = document.getElementById('mapCanvas');
    mapCtx = mapCanvas.getContext('2d');

    fetch('/api/load-map')
        .then(res => res.json())
        .then(data => {
            console.log("Guide Map Meta Loaded:", data);
            MAP_META.originX = data.origin[0];
            MAP_META.originY = data.origin[1];
            MAP_META.resolution = data.resolution;
            MAP_META.mapHeight = data.map_height;
            // [수정1] objects.yaml에 새로 저장된 객체 포함하여 mapData 갱신
            mapData = data;

            slamMapImg.onload = () => {
                isMapLoaded = true;
                drawMap();
                // [수정1] 이미지 로드 완료 후 mapData가 이미 있으므로 마커 즉시 렌더링
                renderMarkers();
            };
            slamMapImg.src = data.map_image_url + "?t=" + new Date().getTime();
        });
}

function drawMap() {
    const container = document.getElementById('map-container');
    if (!container || !slamMapImg.complete) return;

    mapCanvas.width = container.clientWidth;
    mapCanvas.height = container.clientHeight;

    currentMapScale = Math.min(mapCanvas.width / slamMapImg.width, mapCanvas.height / slamMapImg.height);

    const drawW = slamMapImg.width * currentMapScale;
    const drawH = slamMapImg.height * currentMapScale;
    mapOffsetX = (mapCanvas.width - drawW) / 2;
    mapOffsetY = (mapCanvas.height - drawH) / 2;

    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapCtx.imageSmoothingEnabled = false;
    mapCtx.drawImage(slamMapImg, mapOffsetX, mapOffsetY, drawW, drawH);

    renderMarkers();
}

function renderMarkers() {
    const container = document.getElementById('objectsContainer');
    if (!container || !mapData.objects) return;
    container.innerHTML = '';

    // 현재 안내 중인 작품 데이터 가져오기
    const currentArt = currentArtworkList[currentProgress];
    
    // [중요] 강조 대상 확인 로직: objects.yaml의 name과 현재 안내중인 객체의 name(또는 title) 비교
    const currentTargetName = currentArt?.name || currentArt?.title;

    mapData.objects.forEach(obj => {
        // 현재 이 객체가 로봇이 가고 있는 목표인지 확인
        const isTarget = (currentTargetName && obj.name === currentTargetName && obj.type === 'artwork');

        // 좌표 계산 (ROS 미터 -> 픽셀)
        const imgX = (obj.ros_x - MAP_META.originX) / MAP_META.resolution;
        const imgY = MAP_META.mapHeight - ((obj.ros_y - MAP_META.originY) / MAP_META.resolution);

        const el = document.createElement('div');
        el.className = `map-object ${obj.type}-marker ${isTarget ? 'current-target-marker' : ''}`;
        el.style.left = (imgX * currentMapScale) + mapOffsetX + 'px';
        el.style.top = (imgY * currentMapScale) + mapOffsetY + 'px';

        if (obj.type === 'artwork') {
            // 1. data.js(mockArtworks)에서 이미지 검색
            const artInfo = mockArtworks.find(a => a.title === obj.name);

            let contentHtml = '';
            if (artInfo && artInfo.imageUrl) {
                // 이미지가 있는 경우: 이미지 표시
                contentHtml = `<img src="${artInfo.imageUrl}" class="artwork-thumb">`;
            } else {
                // 이미지가 없는 경우: 이름과 작가명 표시
                contentHtml = `
                    <div class="artwork-thumb-text-box">
                        <div class="thumb-name">${obj.name}</div>
                        <div class="thumb-artist">${obj.artist || '작가 미상'}</div>
                    </div>`;
            }

            // HTML 구성: active-target과 target-pin이 isTarget 상태에 따라 확실히 붙도록 설정
            el.innerHTML = `
                <div class="artwork-icon-wrapper ${isTarget ? 'active-target' : ''}">
                    ${contentHtml}
                    ${isTarget ? `
                        <div class="target-pin">
                            <i data-lucide="map-pin"></i>
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            // 특수 목적지 스타일 (H, i, C)
            if (obj.type === 'home') el.innerText = 'H';
            else if (obj.type === 'desk') el.innerText = 'i';
            else if (obj.type === 'charge') el.innerText = 'C';
        }
        container.appendChild(el);
    });
    
    // Lucide 아이콘(핀 등) 재생성
    if (window.lucide) lucide.createIcons();
}


function initRosConnection() {
    ros = new ROSLIB.Ros({ url: 'ws://192.168.0.21:9090' });

    ros.on('connection', () => {
        speakTopic = new ROSLIB.Topic({ ros: ros, name: '/robot_speak', messageType: 'std_msgs/msg/String' });

        const volumeTopic = new ROSLIB.Topic({ ros: ros, name: '/robot_volume', messageType: 'std_msgs/msg/Int32' });
        volumeTopic.subscribe((m) => { globalVolume = m.data / 100.0; });

        const amclTopic = new ROSLIB.Topic({
            ros: ros,
            name: '/amcl_pose',
            messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped'
        });

        amclTopic.subscribe((message) => {
            updateRobotMarkerUI(message.pose.pose);

            if (isExiting || isArrived || targetCoords.x === null) return;

            const dist = Math.sqrt(
                Math.pow(targetCoords.x - message.pose.pose.position.x, 2) +
                Math.pow(targetCoords.y - message.pose.pose.position.y, 2)
            );

            if (dist <= 0.5) handleArrival();
        });
    });
}

function updateRobotMarkerUI(pose) {
    const marker = document.getElementById('robot-marker');
    if (!marker || !isMapLoaded || MAP_META.mapHeight === 0) return;
    marker.style.display = 'block';

    const imgX = (pose.position.x - MAP_META.originX) / MAP_META.resolution;
    const imgY = MAP_META.mapHeight - ((pose.position.y - MAP_META.originY) / MAP_META.resolution);

    marker.style.left = (imgX * currentMapScale) + mapOffsetX + 'px';
    marker.style.top = (imgY * currentMapScale) + mapOffsetY + 'px';

    const q = pose.orientation;
    const theta = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    marker.style.transform = `rotate(${-theta * 180 / Math.PI + 90}deg)`;
}

window.addEventListener('resize', drawMap);

// --- [4. 점유 및 통계 로직] ---
function startHeartbeat() {
    if (!user_token) return;
    heartbeatInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/robot/lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: "heartbeat", user_token: user_token })
            });
            const data = await res.json();
            if (data.status !== "success") {
                clearInterval(heartbeatInterval);
                alert("세션이 만료되었습니다.");
                window.location.href = '/';
            }
        } catch (e) { console.error("Heartbeat Error", e); }
    }, 5000);
}

async function recordArrival(artworkName) {
    let visitorCount = sessionStorage.getItem('visitorCount') || "1";
    visitorCount = (visitorCount === "4+") ? 4 : parseInt(visitorCount);
    const age = sessionStorage.getItem('userAge') || "알 수 없음";
    const gen = sessionStorage.getItem('userGender') || "알 수 없음";
    try {
        await fetch('/api/analytics/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artwork_name: artworkName, count: visitorCount, duration: 0, age: age, gender: gen })
        });
    } catch (e) { console.error("Record Arrival Error", e); }
}

async function sendStayData() {
    if (!stayStartTime || !isArrived) return;
    const dur = (Date.now() - stayStartTime) / 1000;
    const art = currentArtworkList[currentProgress];
    const age = sessionStorage.getItem('userAge') || "알 수 없음";
    const gen = sessionStorage.getItem('userGender') || "알 수 없음";
    try {
        await fetch('/api/analytics/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artwork_name: art.title, count: 0, duration: dur, age: age, gender: gen })
        });
    } catch (e) { console.error("Stay Data Error", e); }
    stayStartTime = null;
    isArrived = false;
}

// --- [5. 안내 로직] ---
async function handleArrival() {
    if (isExiting || isArrived) return;
    isArrived = true;
    stayStartTime = Date.now();

    // 현재 안내 중인 작품 정보
    const art = currentArtworkList[currentProgress];

    // UI 업데이트
    const statusEl = document.getElementById("arrival-status");
    if (statusEl) {
        statusEl.textContent = "도착 완료";
        statusEl.className = "px-6 py-2 rounded-full text-lg font-bold bg-green-100 text-green-700";
    }

    // 1. 작품명/작가명 표시 (objects.yaml 데이터 우선)
    const titleEl = document.getElementById("artwork-title");
    if (titleEl) titleEl.textContent = art.title || art.name;
    const artistEl = document.getElementById("artwork-artist");
    if (artistEl) artistEl.textContent = `${art.artist || '작가 미상'} · ${art.year || ''}`;

    const infoBox = document.getElementById("artwork-info-box");
    if (infoBox) infoBox.style.opacity = "1";

    // 2. 설명문 결정 (data.js의 description이 없으면 objects.yaml의 desc 사용)
    const finalDescription = art.description || art.desc || "작품 설명이 등록되지 않았습니다.";

    // 통계 기록
    await recordArrival(art.title);

    // 3. 음성 안내 (TTS)
    const ttsText = `작품에 도착했습니다. 안내를 시작합니다. ${finalDescription}`;
    speakDescription(ttsText);
}

// guide.js 내 initGuide 함수를 아래 내용으로 교체하세요.

function initGuide() {
    const checkData = setInterval(() => {
        // 맵 데이터(objects.yaml)가 로드될 때까지 대기
        if (mapData && mapData.objects && mapData.objects.length > 0) {
            clearInterval(checkData);

            // [핵심 수정] 안내 리스트 생성 로직
            // 1. 기준은 무조건 화면 데이터(mockArtworks)로 잡습니다.
            // 2. 여기에 objects.yaml에 저장된 좌표(ros_x, ros_y, yaw)를 합칩니다.
            
            const artworkObjects = mapData.objects.filter(o => o.type === 'artwork');

            if (mode === "all-artworks" || mode === "specific-artwork") {
                // data.js의 리스트를 순회하며 YAML에서 같은 이름을 가진 좌표를 찾아 합침
                currentArtworkList = mockArtworks.map(art => {
                    const yamlPos = artworkObjects.find(obj => obj.name === art.title);
                    if (yamlPos) {
                        return { ...art, ...yamlPos }; // 좌표 데이터 병합
                    }
                    return art;
                }).filter(art => art.ros_x !== undefined); // 지도에 좌표가 설정된 작품만 추출

                // 만약 에디터에서만 추가하고 data.js에는 없는 작품이 있다면 뒤에 추가 (선택 사항)
                artworkObjects.forEach(obj => {
                    if (!currentArtworkList.find(a => a.title === obj.name)) {
                        currentArtworkList.push(obj);
                    }
                });
            } else if (mode === "recommended-course") {
                // AI 추천 코스 모드
                const aiArtNames = JSON.parse(sessionStorage.getItem('currentAICourseArtworks'));
                if (aiArtNames) {
                    currentArtworkList = aiArtNames.map(name => {
                        const artData = mockArtworks.find(a => a.title === name);
                        const yamlPos = artworkObjects.find(obj => obj.name === name);
                        return { ...(artData || {}), ...(yamlPos || {}), title: name };
                    }).filter(art => art.ros_x !== undefined);
                }
            }

            // 현재 진행 순서(currentProgress)에 맞는 작품 정보 추출
            const art = currentArtworkList[currentProgress];
            
            if (art) {
                // 목표 위치로 이동 명령 (이름이 정확히 매칭됨)
                moveToArtwork(art.title || art.name);
            } else {
                console.error("해당 순서에 안내할 작품 데이터가 없습니다.");
            }
            
            // UI 업데이트 (버튼 표시 여부)
            const nextBtn = document.getElementById("next-btn");
            if (nextBtn) nextBtn.style.display = (currentProgress >= currentArtworkList.length - 1) ? "none" : "flex";
            
            // 마커 다시 그리기
            renderMarkers();
        }
    }, 100);
}

const art = currentArtworkList[currentProgress];
if (art) {
    const statusEl = document.getElementById("arrival-status");
    if (statusEl) statusEl.textContent = "작품으로 이동 중...";
    const infoBox = document.getElementById("artwork-info-box");
    if (infoBox) infoBox.style.opacity = "0";
    moveToArtwork(art.title);
}
const nextBtn = document.getElementById("next-btn");
if (nextBtn) nextBtn.style.display = (currentProgress >= currentArtworkList.length - 1) ? "none" : "flex";



// ★ [핵심 수정] yaw → quaternion 변환 후 목표 방향까지 포함해 goal 전송
function yawToQuaternion(yaw) {
    return {
        x: 0.0,
        y: 0.0,
        z: Math.sin(yaw / 2),
        w: Math.cos(yaw / 2)
    };
}

function moveToArtwork(artworkName) {
    const checkData = setInterval(() => {
        if (mapData && mapData.objects.length > 0) {
            clearInterval(checkData);
            const obj = mapData.objects.find(o => o.type === 'artwork' && o.name === artworkName);
            if (obj) {
                targetCoords = { x: obj.ros_x, y: obj.ros_y };

                // objects.yaml에 yaw가 있으면 사용, 없으면 0.0 (동쪽) 기본값
                const yaw = (obj.yaw !== undefined && obj.yaw !== null) ? parseFloat(obj.yaw) : 0.0;
                const orientation = yawToQuaternion(yaw);

                console.log(`📍 이동 목표: ${artworkName} | X: ${obj.ros_x}, Y: ${obj.ros_y} | yaw: ${yaw}rad (${(yaw * 180 / Math.PI).toFixed(1)}°)`);

                const goalTopic = new ROSLIB.Topic({
                    ros: ros,
                    name: '/goal_pose',
                    messageType: 'geometry_msgs/msg/PoseStamped'
                });
                goalTopic.publish(new ROSLIB.Message({
                    header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
                    pose: {
                        position: { x: obj.ros_x, y: obj.ros_y, z: 0.0 },
                        orientation: orientation  // ★ yaw 적용된 방향
                    }
                }));
            }
        }
    }, 500);
}

function speakDescription(text) {
    if (globalVolume <= 0 || !speakTopic) return;
    speakTopic.publish(new ROSLIB.Message({ data: text }));
}

// --- [6. 음성 제어 로직] ---
function startVoiceCommand() {
    if (!recognition) return alert("마이크를 지원하지 않습니다.");
    isProcessing = false;
    const panel = document.getElementById("voice-status-panel");
    if (panel) panel.classList.remove("hidden");
    const statusText = document.getElementById("voice-status-text");
    if (statusText) statusText.textContent = "듣고 있습니다. 말씀해 주세요!";
    const transcriptDisplay = document.getElementById("voice-transcript");
    if (transcriptDisplay) transcriptDisplay.textContent = "";
    try {
        recognition.stop();
        setTimeout(() => { recognition.start(); }, 200);
    } catch (e) { }
}

window.stopVoiceCommand = function () {
    isProcessing = false;
    const panel = document.getElementById("voice-status-panel");
    if (panel) panel.classList.add("hidden");
    speakDescription("그만");
    try { recognition.stop(); } catch (e) { }
};

async function handleVoiceCommand(text) {
    const statusText = document.getElementById("voice-status-text");

    if (text.includes("그만") || text.includes("멈춰") || text.includes("중단")) {
        speakDescription("그만");
        if (statusText) statusText.textContent = "설명을 중단합니다.";
        setTimeout(() => { stopVoiceCommand(); }, 1000);
        return;
    }

    if (text.includes("다음")) { stopVoiceCommand(); await nextArtwork(); return; }
    if (text.includes("이전") || text.includes("뒤로")) { stopVoiceCommand(); await goBack(); return; }

    if (text.includes("특정 작품 선택") || text.includes("작품 목록") || text.includes("리스트")) {
        if (statusText) statusText.textContent = "작품 목록으로 이동합니다.";
        speakDescription("그만");
        setTimeout(async () => { await goToArtworkList(); }, 1000);
        return;
    }

    if (text.includes("안내 종료") || text.includes("가이드 종료") || text.includes("종료")) {
        if (statusText) statusText.textContent = "안내를 종료하고 로봇이 복귀합니다.";
        speakDescription("그만");
        setTimeout(async () => { await exitGuide(); }, 1000);
        return;
    }

    if (statusText) statusText.textContent = "AI 답변을 생성 중입니다...";
    try {
        const currentArt = currentArtworkList[currentProgress];
        const response = await fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `작품:'${currentArt.title}'. 질문:${text}` })
        });
        const data = await response.json();
        speakDescription(data.reply);
        if (statusText) statusText.textContent = "답변 완료";
        setTimeout(() => { stopVoiceCommand(); }, (data.reply.length * 200) + 2000);
    } catch (err) {
        console.error("AI Error:", err);
        stopVoiceCommand();
    }
}

// --- [7. 이동 및 보조 함수] ---
async function exitGuide() {
    if (isExiting) return;
    isExiting = true;

    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    speakDescription("그만");

    setTimeout(() => {
        speakDescription("안내를 종료합니다. 로봇 대기 위치로 돌아갑니다.");
    }, 300);

    try {
        await fetch('/api/robot/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: "stop", user_token: user_token })
        });
    } catch (e) { console.error("점유 해제 실패", e); }

    await sendStayData();

    // 홈 위치도 yaw 포함해서 이동
    try {
        const mapRes = await fetch('/api/load-map');
        const mapDataRes = await mapRes.json();
        const homeObj = mapDataRes.objects.find(obj => obj.type === 'home');

        if (homeObj) {
            const yaw = (homeObj.yaw !== undefined && homeObj.yaw !== null) ? parseFloat(homeObj.yaw) : 0.0;
            const orientation = yawToQuaternion(yaw);

            const goalTopic = new ROSLIB.Topic({
                ros: ros,
                name: '/goal_pose',
                messageType: 'geometry_msgs/msg/PoseStamped'
            });
            goalTopic.publish(new ROSLIB.Message({
                header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
                pose: {
                    position: { x: homeObj.ros_x, y: homeObj.ros_y, z: 0.0 },
                    orientation: orientation
                }
            }));
        }
    } catch (err) { console.error("맵 로드 실패:", err); }

    setTimeout(() => {
        window.location.href = '/';
    }, 1500);
}

async function nextArtwork() {
    await sendStayData();
    if (currentProgress < currentArtworkList.length - 1) {
        window.location.href = `/guide.html?mode=${mode}&courseId=${currentCourseId || ""}&progress=${currentProgress + 1}`;
    }
}

async function goBack() {
    await sendStayData();
    if (currentProgress > 0) {
        window.location.href = `/guide.html?mode=${mode}&courseId=${currentCourseId || ""}&progress=${currentProgress - 1}`;
    } else {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        try {
            await fetch('/api/robot/lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: "stop", user_token: user_token })
            });
        } catch (e) { }
        location.href = (mode === 'recommended-course') ? '/course-recommendation.html' : '/';
    }
}

async function goToArtworkList() {
    await sendStayData();
    window.location.href = `/artwork-list.html?courseId=${currentCourseId || ""}&progress=${currentProgress}`;
}

function getQueryParam(p) {
    return new URLSearchParams(window.location.search).get(p);
}