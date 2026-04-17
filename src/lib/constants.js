// nexon api 상세 조회를 순차 처리할 때 적용하는 요청 간 딜레이(ms)
export const THROTTLE_MS = 500;

// nexon 공지 전체인 news api 엔드포인트 주소
export const CMS_API_URL = "https://g.nexonstatic.com/maplestory/cms/v1/news";

// nexon api 베이스 주소
export const NEXON_BASE = "https://g.nexonstatic.com";

// 한번에 처리할 최대 이벤트 게시글 갯수
export const EVENT_LIMIT = 20;

// 한번에 처리할 최대 뉴스 갯수
export const NEWS_LIMIT = 15;

// news OCR fallback을 시도할 본문 최소 길이
export const NEWS_OCR_MIN_TEXT_LENGTH = 100;

// 글 하나당 OCR 처리할 최대 이미지 갯수
export const OCR_LIMIT = 50;

// 이벤트 테이블
export const TABLE = "events_v2";

// 논이벤트 테이블
export const NON_EVENTS_TABLE = "non_events_v2";

// 점검 테이블
export const MAINTENANCE_TABLE = "maintenance_v2";

// 뉴스 테이블
export const NEWS_TABLE = "news";
