# gms-tracker

GMS 뉴스에서 이벤트/점검 기간을 추출해 Supabase에 적재하는 Node.js 파이프라인. 이벤트는 OpenAI 기반 기간 추출 후 실패 시 OCR fallback을 쓰고, 일부는 KMS URL도 매칭한다.

## 실행

- `pnpm install`
- `pnpm run dev`

## 필수 환경변수

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`

## 동작 요약

- `index.js`: 이벤트 파이프라인 후 점검 파이프라인 실행. 한쪽 실패가 다른 쪽을 막지 않음.
- `src/pipeline/events.js`: `events` + `isMSCW !== true` 상위 6개만 처리, 기존 `events_v2`/`non_events_v2` id 제외 후 상세를 500ms 간격으로 조회.
- 이벤트 기간은 본문 텍스트를 먼저 AI로 파싱하고, 실패하면 이미지 최대 n장 OCR 후 다시 AI로 파싱.
- 성공한 이벤트는 `events_v2`, 실패한 항목은 `non_events_v2`에 upsert.
- `src/maintenance.js`: `maintenance` 상위 5개 중 `Scheduled`/`Unscheduled`만 처리하고, 본문 `Times:`를 UTC로 변환해 `maintenance`에 upsert.
- 이벤트 저장 시 `gms_url`을 만들고, 필요 시 KMS 목록 스크래핑 + AI 재랭킹으로 `kms_url`도 저장.

## 수정 원칙

- 외부 API 호출 간 throttle(`500ms`) 유지.
- 시크릿/경로는 하드코딩하지 않음.
- 파싱 실패는 전체 중단보다 `null`/skip 쪽으로 처리.
- DB 쓰기는 `upsert`와 기존 id 조회 흐름을 유지.
