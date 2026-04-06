/**
 * [중앙 집중 데이터 관리]
 * WikiArt 및 Google Art Project의 외부 허용용 이미지 서버 주소를 사용합니다.
 */

const ART_DATA = [
    { 
        id: '1', 
        title: '별이 빛나는 밤', 
        artist: '빈센트 반 고흐', 
        year: '1889', 
        genre: '인상주의', 
        description: '고흐가 요양원에서 밤하늘을 보며 그린 걸작입니다. 소용돌이치는 하늘은 그의 불안한 내면과 예술적 열정을 보여줍니다.', 
        imageUrl: '/static/image/TheStarryNight.png', 
        location: { x: 1.0, y: 2.0 }
    },
    { 
        id: '2', 
        title: '절규', 
        artist: '에드바르 뭉크', 
        year: '1893', 
        genre: '표현주의', 
        description: '현대인의 불안과 고독을 강렬한 색채와 곡선으로 표현했습니다. 뭉크의 개인적인 경험이 녹아있는 표현주의의 상징적인 작품입니다.', 
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg/330px-Edvard_Munch%2C_1893%2C_The_Scream%2C_oil%2C_tempera_and_pastel_on_cardboard%2C_91_x_73_cm%2C_National_Gallery_of_Norway.jpg',
        location: { x: 2.5, y: 2.0 }
    },
    { 
        id: '3', 
        title: '게르니카', 
        artist: '파블로 피카소', 
        year: '1937', 
        genre: '현대미술', 
        description: '스페인 내전 당시 게르니카 마을이 폭격당한 비극을 고발한 반전 작품입니다. 입체주의 기법을 통해 전쟁의 참혹함을 보여줍니다.', 
        imageUrl: '/static/image/Guernica.png',
        location: { x: 4.0, y: 2.0 }
    },
    { 
        id: '4', 
        title: '진주 귀걸이를 한 소녀', 
        artist: '요하네스 베르메르', 
        year: '1665', 
        genre: '사실주의', 
        description: '북유럽의 모나리자라고도 불립니다. 미지의 소녀가 뒤를 돌아보는 순간을 빛의 마술사 베르메르가 섬세하게 포착했습니다.', 
        imageUrl: '/static/image/jinju.png',
        location: { x: 5.5, y: 2.0 }
    },
    { 
        id: '5', 
        title: '기억의 지속', 
        artist: '살바도르 달리', 
        year: '1931', 
        genre: '초현실주의', 
        description: '녹아내리는 시계들은 시간의 주관성을 의미합니다. 달리의 무의식과 꿈의 세계를 초현실주의 기법으로 그려냈습니다.', 
        imageUrl: 'https://uploads6.wikiart.org/images/salvador-dali/the-persistence-of-memory-1931.jpg',
        location: { x: 1.0, y: 4.5 }
    },
    { 
        id: '6', 
        title: '수련', 
        artist: '클로드 모네', 
        year: '1906', 
        genre: '인상주의', 
        description: '빛의 변화에 따라 시시각각 변하는 수련 연못을 그렸습니다. 형태보다 빛과 색채에 집중한 인상주의의 정수입니다.', 
        imageUrl: 'https://uploads4.wikiart.org/images/claude-monet/water-lilies-1.jpg',
        location: { x: 2.5, y: 4.5 }
    },
    { 
        id: '7', 
        title: '컴포지션 VIII', 
        artist: '바실리 칸딘스키', 
        year: '1923', 
        genre: '추상화', 
        description: '기하학적 형태와 색채로 음악적 리듬을 표현한 추상미술의 선구작입니다.', 
        imageUrl: 'https://uploads8.wikiart.org/images/wassily-kandinsky/composition-viii-1923.jpg',
        location: { x: 4.0, y: 4.5 }
    },
    { 
        id: '8', 
        title: '이삭 줍는 사람들', 
        artist: '장 프랑수아 밀레', 
        year: '1857', 
        genre: '사실주의', 
        description: '농민의 고단하지만 숭고한 노동을 따뜻한 시선으로 담아낸 사실주의의 걸작입니다.', 
        imageUrl: 'https://uploads6.wikiart.org/images/jean-francois-millet/the-gleaners-1857.jpg',
        location: { x: 5.5, y: 4.5 }
    }
];

const COURSE_DATA = [
    { id: 'course-1', name: '인상주의 여행', targetGenre: '인상주의', artworks: ['1', '6'], description: '빛과 색채의 아름다움을 탐험하는 인상주의 작품들' },
    { id: 'course-2', name: '감정의 표현', targetGenre: '표현주의', artworks: ['2', '3'], description: '인간의 내면을 강렬하게 표현한 표현주의 작품들' },
    { id: 'course-3', name: '현실을 넘어서', targetGenre: '초현실주의', artworks: ['5', '7'], description: '상상력과 무의식의 세계를 그린 초현실주의 작품들' },
    { id: 'course-4', name: '사실의 아름다움', targetGenre: '사실주의', artworks: ['4', '8'], description: '있는 그대로의 세계를 섬세하게 담아낸 사실주의 걸작' },
    { id: 'course-5', name: '현대미술의 세계', targetGenre: '현대미술', artworks: ['3', '5'], description: '피카소와 달리를 통해 보는 파격적인 현대미술의 흐름' },
    { id: 'course-6', name: '리듬과 추상', targetGenre: '추상화', artworks: ['7', '1'], description: '대상을 넘어선 순수한 형태와 색채의 리듬' },
    { id: 'course-7', name: '베스트 컬렉션', targetGenre: '모두', artworks: ['1', '2', '5', '4'], description: '미술관에서 가장 사랑받는 대표 작품 모음' }
];