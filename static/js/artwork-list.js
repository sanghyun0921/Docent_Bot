/**
 * 1. 데이터 저장소 (외부 data.js 의존성 제거)
 */
const mockArtworks = ART_DATA;
const mockCourses = COURSE_DATA;
/**
 * 2. 공통 유틸리티 함수 (외부 script.js 의존성 제거)
 */
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function navigateTo(page, params = {}) {
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
    const url = queryString ? `${page}?${queryString}` : page;
    window.location.href = url;
}

function goBack() {
    const courseId = getQueryParam('courseId');
    const progress = getQueryParam('progress');

    // 만약 URL에 courseId가 있다면, 가이드 페이지에서 넘어온 것이므로 가이드로 복귀
    if (courseId && courseId !== "null" && courseId !== "") {
        navigateTo('guide.html', {
            courseId: courseId,
            progress: progress || 0
        });
    } 
    // 그 외의 경우(메인에서 바로 온 경우 등)는 메인 화면으로 이동
    else {
        location.href = '/';
    }
}
/**
 * 3. 페이지 전용 로직
 */
let selectedArtworkId = null;

document.addEventListener('DOMContentLoaded', () => {
    // 1. URL 파라미터 읽기
    const searchKeyword = getQueryParam('search') || '';
    
    // 2. 검색창에 검색어 채우기
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = searchKeyword;
        // 3. 검색어가 있으면 해당 목록만 렌더링, 없으면 전체 렌더링
        renderList(searchKeyword);
        
        // 실시간 입력 이벤트 유지
        searchInput.addEventListener('input', (e) => {
            renderList(e.target.value);
        });
    } else {
        renderList('');
    }

    if (window.lucide) lucide.createIcons();
});

function renderList(filter = '') {
    const container = document.getElementById('artwork-list');
    if (!container) return;

    container.innerHTML = '';
    
    // 필터링 로직 (공백 제거 및 대소문자 무시)
    const searchTerm = filter.trim().toLowerCase();
    const filtered = mockArtworks.filter(a => 
        a.title.toLowerCase().includes(searchTerm) || 
        a.artist.toLowerCase().includes(searchTerm) || 
        a.genre.toLowerCase().includes(searchTerm)
    );

    // 검색 결과가 없을 때
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                <i data-lucide="search-x" class="w-16 h-16 mb-4"></i>
                <p class="text-xl">검색 결과가 없습니다.</p>
                <p class="text-sm">다른 키워드로 검색해보세요.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // 목록 생성
    filtered.forEach(art => {
        const div = document.createElement('div');
        div.className = "p-6 rounded-xl border-2 cursor-pointer transition-all border-gray-200 hover:border-gray-300 hover:shadow-md bg-white";
        
        div.onclick = () => {
            // 모든 항목 선택 해제 스타일
            document.querySelectorAll('#artwork-list > div').forEach(el => {
                el.classList.remove('border-blue-500', 'bg-blue-50', 'shadow-lg');
                el.classList.add('border-gray-200');
                const check = el.querySelector('.check-icon');
                if (check) check.style.display = 'none';
            });
            // 현재 클릭한 항목 선택 스타일
            div.classList.remove('border-gray-200');
            div.classList.add('border-blue-500', 'bg-blue-50', 'shadow-lg');
            const currentCheck = div.querySelector('.check-icon');
            if (currentCheck) currentCheck.style.display = 'block';
            
            selectedArtworkId = art.id;
        };

        div.innerHTML = `
            <div class="flex gap-4 items-center">
                <img src="${art.imageUrl}" alt="${art.title}" class="w-24 h-24 object-cover rounded-lg flex-shrink-0" />
                <div class="flex-1">
                    <h3 class="text-xl font-bold text-gray-800 mb-1">${art.title}</h3>
                    <p class="text-gray-600 mb-2">${art.artist} · ${art.year}</p>
                    <span class="inline-block px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm rounded-full">${art.genre}</span>
                </div>
                <i data-lucide="check-circle-2" class="check-icon text-blue-500 hidden w-8 h-8 flex-shrink-0"></i>
            </div>
        `;
        container.appendChild(div);
    });

    if (window.lucide) lucide.createIcons();
}

function selectArtwork() {
    if (selectedArtworkId) {
        // 주소창에 넘어온 파라미터를 읽습니다 (guide에서 넘겨준 것들)
        const courseId = getQueryParam('courseId');
        const progress = getQueryParam('progress');
        
        const artIndex = mockArtworks.findIndex(a => a.id === selectedArtworkId);
        
        // 다시 가이드로 돌아갈 때 정보를 유지합니다.
        navigateTo('guide.html', { 
            mode: 'specific-artwork', 
            progress: artIndex,
            courseId: courseId || ''
        });
    } else {
        alert('작품을 리스트에서 클릭하여 선택해주세요!');
    }
}