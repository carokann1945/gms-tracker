# gms-tracker

GMS 뉴스에서 이벤트와 점검 정보를 수집해 Supabase에 적재하는 단발성 Node.js 워커다. 현재 메인 실행 경로는 `src/main.js`이며, 이벤트와 점검 모두 `AI_PROVIDER`에 따라 OpenAI 또는 Gemini를 사용한다. 이벤트 기간 추출이 실패하면 OCR fallback을 사용한다.

## 실행

- `pnpm install`
- `pnpm run dev`

현재 `dev` 스크립트와 Docker 기본 실행 명령은 모두 `node src/main.js`다.

## 필수 환경변수

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS` — 이벤트 OCR fallback 사용 시 필요
- `OPENAI_API_KEY` — `AI_PROVIDER=gemini`가 아닐 때 사용
- `GEMINI_API_KEY` — `AI_PROVIDER=gemini`일 때 사용
- `AI_PROVIDER` — `gemini`면 Gemini, 그 외 값은 OpenAI 경로로 동작

## 현재 동작 요약

- `src/main.js`: 이벤트 파이프라인 실행 후 점검 파이프라인을 실행한다. 한쪽 실패가 다른 쪽 실행을 막지 않는다.
- `src/features/events/fetcher.js`: `category === "events"` 이고 `isMSCW === false || isMSCW == null` 인 항목 중 현재 상위 20개만 처리 대상으로 반환한다.
- 이벤트 dedup은 `events_test`와 `non_events_test`를 함께 본다. `non_events_test`에 있는 항목은 무조건 스킵하고, `events_test`에 있는 항목은 같은 `id`라도 `name`이 바뀌면 다시 처리한다.
- 이벤트 기간은 Hot Week 전용 규칙을 먼저 적용하고, 그다음 본문 텍스트를 AI로 파싱한다. 실패하면 본문 이미지 최대 30장을 OCR 한 뒤 다시 AI로 파싱한다.
- 기간 추출에 성공한 이벤트는 `events_test`에 `gms_url`, `summary`, `image_thumbnail`, `live_date`를 포함해 upsert하고, 끝까지 실패한 항목은 `non_events_test`에 upsert한다.
- `summary`는 AI가 생성한 `## 요약` + `## 전체 번역` Markdown 문자열이다.
- `src/features/maintenance/fetcher.js`: `maintenance` 카테고리 상위 5개를 조회한다.
- `src/features/maintenance/pipeline.js`: 제목이 `Scheduled` 또는 `Unscheduled` 계열로 시작하는 항목만 처리한다.
- 점검 시간은 AI로 먼저 파싱하고, 실패하면 `Times:` 블록을 정규식으로 다시 파싱한다.
- 점검 결과는 `maintenance_test`에 `id`, `name`, `start_at`, `end_at`, `url`, `live_date` 형태로 upsert한다. 시간 파싱이 실패하면 `start_at`/`end_at`은 `null`일 수 있다.

## 공용 모듈

- `src/lib/fetcher.js` — `fetchEventDetail`, `sleep`
- `src/lib/parser.js` — `extractBodyText`
- `src/lib/ai.js` — OpenAI/Gemini 클라이언트 및 공용 설정
- `src/lib/supabase.js` — Supabase 클라이언트 생성
- `src/lib/ocr.js` — Google Vision OCR 래퍼, 현재는 이벤트 파이프라인에서만 사용

## 수정 원칙

- 외부 상세 호출 간 throttle(`500ms`)을 유지한다.
- 시크릿과 자격 증명 경로는 하드코딩하지 않는다.
- 파싱 실패는 가능한 한 전체 중단보다 `null` 또는 skip으로 처리한다.
- DB 쓰기는 `upsert` 기반 흐름을 유지한다.
- 문서는 현재 활성 코드 경로와 현재 테이블명을 기준으로 유지한다.
