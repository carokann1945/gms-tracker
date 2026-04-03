# gms-tracker

GMS 뉴스에서 이벤트와 점검 정보를 수집해 Supabase에 적재하는 단발성 Node.js 워커. 이벤트는 `AI_PROVIDER`에 따라 OpenAI 또는 Gemini로 기간을 추출하고, 텍스트 파싱이 실패하면 OCR fallback을 사용한다.

## 실행

- `pnpm install`
- `pnpm run dev`

## 필수 환경변수

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS` — OCR fallback 사용 시 필요
- `OPENAI_API_KEY` — `AI_PROVIDER=gemini`가 아닐 때 사용
- `GEMINI_API_KEY` — `AI_PROVIDER=gemini`일 때 사용
- `AI_PROVIDER` — `gemini`면 Gemini, 그 외 값은 OpenAI 경로로 동작

## 동작 요약

- `index.js`: 이벤트 파이프라인 실행 후 점검 파이프라인을 실행한다. 한쪽 실패가 다른 쪽 실행을 막지 않는다.
- `src/pipeline/events.js`: `category === "events"` 이고 `isMSCW !== true` 인 항목 중 상위 20개만 처리한다.
- 이벤트 dedup은 `events_v2`와 `non_events_v2`를 함께 본다. `non_events_v2`에 있는 항목은 스킵하고, `events_v2`에 있는 항목은 같은 `id`라도 `name`이 바뀌면 다시 처리한다.
- 이벤트 기간은 Hot Week 전용 규칙을 먼저 적용하고, 그다음 본문 텍스트를 AI로 파싱한다. 실패하면 본문 이미지 최대 30장을 OCR 한 뒤 다시 AI로 파싱한다.
- 기간 추출에 성공한 이벤트는 `events_v2`에 `gms_url`과 `summary`를 포함해 upsert하고, 끝까지 실패한 항목은 `non_events_v2`에 upsert한다.
- `src/maintenance.js`: `maintenance` 상위 5개 중 제목이 `Scheduled` 또는 `Unscheduled`로 시작하는 항목만 처리하고, 본문 `Times:`를 UTC로 변환해 `maintenance`에 upsert한다.
- KMS 관련 스크래핑과 매칭 코드는 저장소에 남아 있지만 현재 메인 이벤트 파이프라인에는 연결되어 있지 않다.

## 수정 원칙

- 외부 API 호출 간 throttle(`500ms`)를 유지한다.
- 시크릿과 자격 증명 경로는 하드코딩하지 않는다.
- 파싱 실패는 가능한 한 전체 중단보다 `null` 또는 skip으로 처리한다.
- DB 쓰기는 `upsert` 기반 흐름을 유지한다.
