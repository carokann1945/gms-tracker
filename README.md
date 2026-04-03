# gms-tracker

`gms-tracker`는 GMS(MapleStory Global) 뉴스에서 이벤트와 점검 정보를 수집하고, 기간 파싱 및 요약을 거쳐 Supabase에 적재하는 단발성 Node.js 워커입니다. 메인 실행 진입점은 `index.js`이며, 실행 한 번으로 이벤트 파이프라인과 점검 파이프라인을 순차 처리합니다.

이 저장소는 웹 애플리케이션이 아니라 배치성 데이터 수집기입니다. 실행 시 외부 API 호출과 DB 쓰기가 실제로 발생하므로, 로컬 실행 전 환경변수와 대상 Supabase 테이블을 먼저 준비해야 합니다.

## 핵심 특성

- Node.js ESM 기반 단일 워커
- `pnpm` 기반 의존성 관리
- Nexon CMS 뉴스 API 및 HTML 본문 파싱
- 이벤트 기간 추출용 AI 파싱
- 텍스트 파싱 실패 시 Google Cloud Vision OCR fallback
- Supabase `upsert` 기반 idempotent 적재
- 이벤트와 점검 파이프라인을 분리하되 같은 프로세스에서 순차 실행

## 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 런타임 | Node.js (`type: module`) |
| 패키지 매니저 | `pnpm` |
| 뉴스 수집 | 내장 `fetch`, Nexon CMS API |
| HTML 파싱 | `cheerio` |
| 이벤트 기간 추출 / 요약 | OpenAI 또는 Gemini |
| OCR | Google Cloud Vision |
| 저장소 | Supabase |
| 컨테이너 | Docker (`node:24-slim`) |

## 실행 모델

메인 실행 흐름은 다음과 같습니다.

1. `index.js`에서 환경변수를 로드합니다.
2. `src/pipeline/events.js`의 이벤트 파이프라인을 실행합니다.
3. 이벤트 파이프라인이 실패해도 `src/maintenance.js`의 점검 파이프라인을 이어서 실행합니다.
4. 두 파이프라인이 끝나면 프로세스가 종료됩니다.

즉, 이 프로젝트는 장기 실행 서버가 아니라 외부 스케줄러에서 주기적으로 호출하기 좋은 배치 작업 구조입니다. 저장소 내부에는 크론, 큐, 배포 자동화 설정이 포함되어 있지 않습니다.

## 빠른 시작

### 1. 의존성 설치

```bash
pnpm install
```

### 2. 환경변수 파일 준비

```bash
cp .env.example .env
```

`.env`를 실제 값으로 채운 뒤 실행합니다.

### 3. 로컬 실행

```bash
pnpm run dev
```

`package.json`에 정의된 스크립트는 현재 아래 하나입니다.

```json
{
  "scripts": {
    "dev": "node index.js"
  }
}
```

### 4. Docker 실행

이미지 빌드:

```bash
docker build -t gms-tracker .
```

컨테이너 실행:

```bash
docker run --rm --env-file .env gms-tracker
```

`GOOGLE_APPLICATION_CREDENTIALS`를 컨테이너에서 사용할 경우, 컨테이너 내부 경로와 자격 증명 파일 마운트를 함께 맞춰줘야 합니다.

## 환경변수 계약

아래 값들은 현재 코드 기준으로 필요한 입력 계약입니다.

| 변수 | 필수 여부 | 설명 |
| --- | --- | --- |
| `SUPABASE_URL` | 필수 | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | Supabase 쓰기용 서비스 롤 키 |
| `GOOGLE_APPLICATION_CREDENTIALS` | 권장 | 이벤트 본문 텍스트 파싱 실패 시 사용하는 OCR fallback용 GCP 서비스 계정 JSON 절대 경로 |
| `OPENAI_API_KEY` | 기본 필수 | `AI_PROVIDER`가 `gemini`가 아닐 때 사용 |
| `GEMINI_API_KEY` | 조건부 필수 | `AI_PROVIDER=gemini`일 때 사용 |
| `AI_PROVIDER` | 선택 | `gemini`면 Gemini 사용, 그 외 값은 OpenAI 경로로 동작 |

샘플 파일은 `.env.example`에 있습니다.

기본 동작상 `AI_PROVIDER`가 `gemini`가 아니면 OpenAI 경로를 탑니다. 별도 기본값 상수는 없지만, 실질적인 기본 제공자는 OpenAI입니다.

## 아키텍처

### 이벤트 파이프라인

이벤트 처리는 `src/pipeline/events.js`를 중심으로 동작합니다.

1. `src/fetcher.js`에서 Nexon 뉴스 목록을 조회합니다.
2. `category === "events"` 이고 `isMSCW !== true` 인 항목만 후보로 사용합니다.
3. 상위 20개(`EVENT_LIMIT`)만 대상으로 삼습니다.
4. `src/db.js`에서 `events_v2`와 `non_events_v2`에 이미 존재하는 `id`를 합쳐 중복을 제거합니다.
5. 신규 항목만 500ms 간격으로 상세 조회합니다.
6. HTML 본문에서 순수 텍스트를 추출한 뒤 AI로 기간을 파싱합니다.
7. 기간 파싱이 실패하면 본문 이미지 URL을 최대 30장까지 추출하고 OCR을 돌린 뒤, OCR 텍스트로 다시 AI 기간 파싱을 시도합니다.
8. 기간 추출에 성공하면 AI로 이벤트 요약/번역을 생성해 `events_v2`에 upsert 합니다.
9. 끝까지 기간을 추출하지 못하면 `non_events_v2`에 기록합니다.

세부 구현 포인트:

- Hot Week 계열 공지는 `src/domain/hotWeek.js`에서 전용 규칙으로 먼저 처리합니다.
- GMS 상세 페이지 URL은 `gms_url`로 저장합니다.
- 파싱 실패는 전체 배치 실패보다 개별 항목 skip 쪽으로 처리합니다.

### 점검 파이프라인

점검 처리는 `src/maintenance.js`를 중심으로 동작합니다.

1. 뉴스 목록에서 `category === "maintenance"` 인 항목 중 상위 5개만 조회합니다.
2. 제목이 `Scheduled` 또는 `Unscheduled`로 시작하는 항목만 유지합니다.
3. 이미 `maintenance` 테이블에 존재하는 `id`를 제외합니다.
4. 신규 항목만 500ms 간격으로 상세 조회합니다.
5. 본문 텍스트의 `Times:` 블록을 정규식으로 파싱합니다.
6. `PDT`, `PST` 또는 명시된 `UTC` 오프셋을 이용해 UTC ISO 문자열로 변환합니다.
7. 결과를 `maintenance` 테이블에 upsert 합니다.

이 파이프라인은 이벤트와 달리 OCR이나 생성형 AI를 사용하지 않습니다. 점검 공지의 시간 표현이 비교적 정형화돼 있다는 전제에서 정규식 기반으로 처리합니다.

## 저장 대상 테이블

이 저장소에는 SQL 스키마 파일이 포함되어 있지 않지만, 현재 코드가 기대하는 출력 계약은 아래와 같습니다.

### `events_v2`

이벤트 기간을 정상적으로 추출한 항목이 저장됩니다.

주요 컬럼:

- `id`: 원본 공지 ID, upsert 충돌 기준
- `name`: 공지 제목
- `live_date`: 원본 공지 게시 시각
- `image_thumbnail`: 썸네일 URL
- `start_at`: 추출된 이벤트 시작 시각 UTC ISO 문자열
- `end_at`: 추출된 이벤트 종료 시각 UTC ISO 문자열
- `gms_url`: GMS 공지 URL
- `summary`: AI가 생성한 요약 및 전체 번역 Markdown

### `non_events_v2`

이벤트 카테고리였지만 기간을 끝내 추출하지 못한 항목이 저장됩니다.

주요 컬럼:

- `id`
- `name`

이 테이블은 재처리 방지용 dedup 저장소 역할도 함께 합니다.

### `maintenance`

점검 공지가 저장됩니다.

주요 컬럼:

- `id`
- `name`
- `start_at`
- `end_at`
- `url`
- `source_index`

`source_index`는 신규 점검 항목에 대해 단조 증가하도록 부여됩니다.

## 주요 모듈

| 파일 | 역할 |
| --- | --- |
| `index.js` | 전체 배치 진입점 |
| `src/fetcher.js` | Nexon API/페이지 조회 |
| `src/parser.js` | HTML 본문 텍스트 및 이미지 URL 추출 |
| `src/ai.js` | 이벤트 기간 파싱, 요약/번역 생성 |
| `src/ocr.js` | Google Vision OCR 래퍼 |
| `src/db.js` | Supabase 조회 및 upsert |
| `src/pipeline/events.js` | 이벤트 파이프라인 |
| `src/maintenance.js` | 점검 파이프라인 |

## 운영 특성

- 모든 외부 상세 호출은 500ms throttle을 둡니다.
- DB 쓰기는 `upsert` 기반이라 동일 `id`에 대해 재실행이 안전한 편입니다.
- 개별 항목의 파싱 실패는 가능한 한 전체 배치를 중단시키지 않도록 설계되어 있습니다.
- 이벤트 파이프라인은 `텍스트 AI 파싱 -> OCR -> AI 재시도` 순서의 fallback 체인을 가집니다.
- 메인 실행은 한 번 돌고 종료되므로, 주기 실행이 필요하면 외부 스케줄러가 별도로 필요합니다.

## 주의사항과 한계

- 현재 저장소에는 테스트 스크립트가 없습니다.
- 현재 저장소에는 공식 SQL 마이그레이션이나 스키마 정의 파일이 없습니다. Supabase 테이블은 별도로 준비되어 있어야 합니다.
- `pnpm run dev`는 읽기 전용 검사 명령이 아니라 실제 외부 API 호출과 DB 쓰기를 수행합니다.
- `src/matcher.js`, `fetchKmsEventList()` 등 KMS 관련 코드가 저장소에 존재하지만 현재 메인 실행 흐름에는 연결되어 있지 않습니다. README는 이를 활성 기능으로 간주하지 않습니다.
- `src/config.js`는 현재 비어 있으며, 런타임 구성의 진실원은 환경변수와 각 모듈 내부 구현입니다.

## 개발 참고

- 이벤트 기간 파싱은 AI 응답을 JSON 형태로 강제하고, 실패 시 `null` 처리로 흐릅니다.
- 점검 시간 파싱은 본문 텍스트 정규식에 강하게 의존하므로 공지 포맷 변화에 민감할 수 있습니다.
- OCR은 Google Cloud Vision 클라이언트의 기본 자격 증명 해석 방식에 의존합니다.

현재 기준으로 가장 빠른 확인 경로는 `.env` 준비 후 `pnpm run dev`를 실행하고, 콘솔 로그와 Supabase 적재 결과를 함께 보는 방식입니다.
