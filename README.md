# gms-tracker

`gms-tracker`는 GMS(MapleStory Global) 뉴스에서 이벤트와 점검 공지를 수집해 Supabase에 적재하는 단발성 Node.js 워커입니다. 현재 메인 진입점은 `src/main.js`이며, 한 번 실행할 때 이벤트 파이프라인과 점검 파이프라인을 순차 처리합니다.

이 저장소는 웹 애플리케이션이 아니라 배치성 데이터 수집기입니다. `pnpm dev`를 실행하면 실제 외부 API 호출과 DB 쓰기가 발생하므로, 로컬 실행 전 환경변수와 대상 Supabase 테이블을 먼저 준비해야 합니다.

## 핵심 특성

- Node.js ESM 기반 단일 워커
- `pnpm` 기반 의존성 관리
- Nexon CMS 뉴스 API 및 HTML 본문 파싱
- 이벤트 기간 추출용 AI 파싱
- 점검 시간 추출용 AI 1차 파싱 + 정규식 fallback
- 이벤트 본문 텍스트 파싱 실패 시 Google Cloud Vision OCR fallback
- Hot Week 계열 공지 전용 규칙 파싱
- Supabase `upsert` 기반 적재

## 기술 스택

| 영역                  | 사용 기술                   |
| --------------------- | --------------------------- |
| 런타임                | Node.js (`type: module`)    |
| 패키지 매니저         | `pnpm`                      |
| 뉴스 수집             | 내장 `fetch`, Nexon CMS API |
| HTML 파싱             | `cheerio`                   |
| 이벤트/점검 시간 추출 | Gemini                      |
| OCR                   | Google Cloud Vision         |
| 저장소                | Supabase                    |
| 컨테이너              | Docker (`node:24-slim`)     |

## 실행 모델

메인 실행 흐름은 다음과 같습니다.

1. `src/main.js`에서 `dotenv/config`를 로드합니다.
2. `src/features/events/pipeline.js`의 이벤트 파이프라인을 실행합니다.
3. 이벤트 파이프라인이 실패해도 `src/features/maintenance/pipeline.js`의 점검 파이프라인을 이어서 실행합니다.
4. 두 파이프라인이 끝나면 프로세스가 종료됩니다.

즉, 이 프로젝트는 장기 실행 서버가 아니라 외부 스케줄러에서 주기적으로 호출하기 좋은 배치 작업 구조입니다.

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

현재 `package.json` 스크립트는 아래와 같습니다.

```json
{
  "scripts": {
    "dev": "node src/main.js"
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

현재 Docker 기본 실행 명령도 `node src/main.js`입니다.

`GOOGLE_APPLICATION_CREDENTIALS`를 컨테이너에서 사용할 경우, 자격 증명 파일을 컨테이너 내부로 마운트하고 환경변수 경로도 컨테이너 기준으로 맞춰야 합니다.

## 환경변수 계약

현재 코드 기준으로 필요한 입력은 아래와 같습니다.

| 변수                             | 필수 여부 | 설명                                            |
| -------------------------------- | --------- | ----------------------------------------------- |
| `SUPABASE_URL`                   | 필수      | Supabase 프로젝트 URL                           |
| `SUPABASE_SERVICE_ROLE_KEY`      | 필수      | Supabase 쓰기용 서비스 롤 키                    |
| `GOOGLE_APPLICATION_CREDENTIALS` | 권장      | 이벤트 OCR fallback용 GCP 서비스 계정 JSON 경로 |
| `GEMINI_API_KEY`                 | 필수      | 날짜 파싱, 한글 번역에 사용                     |

## 아키텍처

### 공용 모듈

현재 활성 `lib` 모듈은 아래와 같습니다.

- `src/lib/fetcher.js`: `fetchEventDetail`, `sleep`
- `src/lib/parser.js`: `extractBodyText`
- `src/lib/ai.js`: Gemini 클라이언트 및 공용 설정
- `src/lib/supabase.js`: Supabase 클라이언트 생성
- `src/lib/ocr.js`: Google Vision OCR 래퍼, 현재는 이벤트 파이프라인에서만 사용

### 이벤트 파이프라인

이벤트 처리는 `src/features/events/pipeline.js`를 중심으로 동작합니다.

1. `src/features/events/fetcher.js`에서 뉴스 목록을 조회합니다.
2. `category === "events"` 이고 `isMSCW === false || isMSCW == null` 인 항목만 후보로 사용합니다.
3. 현재 설정값 기준으로 상위 2개(`EVENT_LIMIT = 20`)만 대상으로 삼습니다.
4. `src/features/events/repository.js`에서 `events_test`와 `non_events_test`의 기존 레코드를 조회합니다.
5. `non_events_test`에 있는 항목은 제외합니다.
6. `events_test`에 있는 항목은 같은 `id`라도 `name`이 바뀌었을 때만 다시 처리합니다.
7. 신규 항목만 500ms 간격으로 상세 조회합니다.
8. HTML 본문에서 순수 텍스트를 추출한 뒤 `src/features/events/hotWeek.js` 규칙을 먼저 적용합니다.
9. Hot Week 규칙으로 못 풀면 본문 텍스트를 AI에 보내 기간을 파싱합니다.
10. 텍스트 파싱이 실패하면 `src/features/events/parser.js`에서 본문 이미지 URL을 뽑고, `src/lib/ocr.js`로 OCR을 수행한 뒤 OCR 텍스트로 다시 AI 파싱을 시도합니다.
11. 기간 추출에 성공하면 AI로 요약/전체 번역 Markdown을 생성해 `events_test`에 upsert 합니다.
12. 끝까지 기간을 추출하지 못하면 `non_events_test`에 upsert 합니다.

세부 구현 포인트:

- 이벤트 URL은 `https://www.nexon.com/maplestory/news/events/{id}` 형태의 `gms_url`로 저장합니다.
- 요약은 `## 요약`과 `## 전체 번역` 섹션을 합친 Markdown 문자열로 저장됩니다.
- OCR은 이벤트 파이프라인에서만 사용됩니다.

### 점검 파이프라인

점검 처리는 `src/features/maintenance/pipeline.js`를 중심으로 동작합니다.

1. `src/features/maintenance/fetcher.js`에서 `maintenance` 카테고리 상위 5개를 조회합니다.
2. 제목이 `Scheduled` 또는 `Unscheduled` 계열로 시작하는 항목만 유지합니다.
3. `src/features/maintenance/repository.js`에서 `maintenance_test`에 이미 존재하는 `id`를 제외합니다.
4. 신규 항목만 500ms 간격으로 상세 조회합니다.
5. 본문 텍스트를 추출한 뒤 AI로 점검 시간(`Times:` 블록)을 먼저 파싱합니다.
6. AI 파싱이 실패하면 `src/features/maintenance/parser.js`의 정규식으로 다시 파싱합니다.
7. 파싱 결과와 함께 `maintenance_test`에 upsert 합니다.

세부 구현 포인트:

- 점검 URL은 `https://www.nexon.com/maplestory/news/maintenance/{id}` 형태로 저장됩니다.
- 시간 파싱이 완전히 실패해도 현재 구현은 `start_at`, `end_at`이 `null`인 상태로 row를 저장할 수 있습니다.

## 저장 대상 테이블

현재 코드가 실제로 쓰는 테이블은 테스트 테이블입니다.

### `events_test`

이벤트 기간을 정상적으로 추출한 항목이 저장됩니다.

주요 컬럼:

- `id`
- `name`
- `live_date`
- `image_thumbnail`
- `start_at`
- `end_at`
- `gms_url`
- `summary`

### `non_events_test`

이벤트 카테고리였지만 기간을 끝내 추출하지 못한 항목이 저장됩니다.

주요 컬럼:

- `id`
- `name`

### `maintenance_test`

점검 공지가 저장됩니다.

주요 컬럼:

- `id`
- `name`
- `start_at`
- `end_at`
- `url`
- `live_date`

## 주요 모듈

| 파일                                     | 역할                                 |
| ---------------------------------------- | ------------------------------------ |
| `src/main.js`                            | 전체 배치 진입점                     |
| `src/lib/fetcher.js`                     | 공용 상세 조회 및 throttle           |
| `src/lib/parser.js`                      | 공용 본문 텍스트 추출                |
| `src/lib/ai.js`                          | 공용 AI 클라이언트 설정              |
| `src/lib/supabase.js`                    | 공용 Supabase 클라이언트             |
| `src/lib/ocr.js`                         | 공용 OCR 래퍼                        |
| `src/features/events/pipeline.js`        | 이벤트 파이프라인                    |
| `src/features/events/fetcher.js`         | 이벤트 목록 조회 및 필터             |
| `src/features/events/parser.js`          | 이벤트 이미지 URL 추출, GMS URL 생성 |
| `src/features/events/hotWeek.js`         | Hot Week 날짜 전용 파서              |
| `src/features/events/repository.js`      | 이벤트 테이블 조회 및 upsert         |
| `src/features/events/ai.js`              | 이벤트 기간 파싱, 요약 생성          |
| `src/features/maintenance/pipeline.js`   | 점검 파이프라인                      |
| `src/features/maintenance/fetcher.js`    | 점검 목록 조회                       |
| `src/features/maintenance/parser.js`     | 점검 정규식 파싱 및 URL 생성         |
| `src/features/maintenance/repository.js` | 점검 테이블 조회 및 upsert           |
| `src/features/maintenance/ai.js`         | 점검 시간 AI 파싱                    |

## 운영 특성

- 상세 API 호출은 각 항목마다 500ms throttle을 둡니다.
- DB 쓰기는 모두 `upsert` 기반이라 동일 `id` 재실행에 비교적 안전합니다.
- 이벤트 파이프라인은 `Hot Week 규칙 -> 본문 AI 파싱 -> OCR -> AI 재시도` 순서의 fallback 체인을 가집니다.
- 점검 파이프라인은 `AI 파싱 -> 정규식 fallback` 순서로 동작합니다.
- 한쪽 파이프라인 실패가 다른 쪽 실행을 막지 않습니다.

## 주의사항과 한계

- 현재 저장소에는 테스트 스크립트가 없습니다.
- 현재 저장소에는 공식 SQL 마이그레이션이나 스키마 정의 파일이 없습니다. Supabase 테이블은 별도로 준비되어 있어야 합니다.
- `pnpm run dev`는 읽기 전용 검사 명령이 아니라 실제 외부 API 호출과 DB 쓰기를 수행합니다.
- 현재 문서는 현재 활성 코드 경로 기준으로 작성되어 있으며, 테스트 테이블 사용도 현재 상태를 그대로 반영합니다.

## Change log

- live_date가 바뀌면 재처리하도록 변경
