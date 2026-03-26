# 프로젝트 개요

넥슨 메이플스토리 이벤트 API(https://g.nexonstatic.com/maplestory/cms/v1/news) 데이터를 수집하고, Google Cloud Vision API의 OCR을 통해 이벤트 기간을 파싱하여 Supabase에 적재하는 Node.js 기반 자동화 파이프라인.

# 환경 및 도구

- **OS**: WSL2 Ubuntu
- **Runtime**: Node.js v18 이상 (내장 `fetch` API 사용)
- **Package Manager**: `pnpm`
- **주요 라이브러리**: `@google-cloud/vision`, `@supabase/supabase-js`, `dotenv`

# 주요 명령어

- **의존성 설치**: `pnpm install`
- **스크립트 실행 (개발)**: `pnpm run dev` (또는 `node index.js`)
- **환경 변수 설정**: 프로젝트 루트에 `.env` 파일 생성 필수

# 핵심 워크플로우 및 제약 사항

1. **데이터 페칭 및 필터링**
   - 뉴스 목록 API 호출 후 `category === "events"` 항목만 필터링.
   - 필터링된 배열의 맨 위에서부터 **상위 10개**만 추출.
2. **중복 검증 (Idempotency)**
   - 추출한 10개의 `id`를 Supabase DB와 대조.
   - DB에 없는 **신규 id**에 대해서만 상세 API(https://g.nexonstatic.com/maplestory/cms/v1/news/{id}) 호출.
   - 넥슨 정적 서버 보호 및 IP 차단 방지를 위해 상세 API 호출 간 0.5초 이상의 지연(Throttling) 필수.
3. **비용 최적화 및 OCR 파싱**
   - 획득한 신규 상세 데이터 중 **상위 최대 2개**의 이미지만 Google Vision API를 호출하여 텍스트 추출. (비용 통제 목적)
   - 추출된 텍스트에서 정규표현식을 사용해 날짜/시간 파싱. 나머지 항목의 기간은 `null` 처리.
4. **DB 적재**
   - 파싱 완료된 데이터(`id`, `name`, `event_period`, `image_url` 등)를 Supabase 테이블에 저장.
   - PK(`id`) 기준 `upsert`를 사용하여 중복 방지.

# 코딩 컨벤션 및 에러 처리 (정석 가이드)

- **모듈 시스템**: ES Modules (`import`/`export`) 또는 CommonJS 중 프로젝트 설정에 맞게 일관성 유지.
- **비동기 처리**: `async/await`를 기본으로 사용하며, `Promise.all` 사용 시 외부 API Rate Limit을 초과하지 않도록 주의할 것.
- **에러 핸들링**: Nexon API 페칭, Supabase 통신, Google Vision API 호출 등 각 네트워크 경계마다 독립적인 `try-catch` 블록을 작성하여 특정 단계의 에러가 전체 파이프라인을 중단시키지 않도록 구성.
- **보안**: 서비스 계정 키(GCP JSON) 경로 및 Supabase 인증 정보는 하드코딩하지 않고 반드시 `process.env`를 통해 주입.
