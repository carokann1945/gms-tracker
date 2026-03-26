넥슨 메이플스토리 이벤트 API(https://g.nexonstatic.com/maplestory/cms/v1/news) 데이터를 수집하고, OpenAI GPT 및 Google Cloud Vision OCR을 활용한 '다중 계층 추출' 방식으로 비정형 이벤트 기간을 파싱하여 Supabase에 적재하는 Node.js 기반 자동화 파이프라인.

# 환경 및 도구

- **OS**: WSL2 Ubuntu
- **Runtime**: Node.js v18 이상 (내장 `fetch` API 사용)
- **Package Manager**: `pnpm`
- **주요 라이브러리**: `openai`, `@google-cloud/vision`, `cheerio`, `@supabase/supabase-js`, `dotenv`

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
3. **다중 계층 추출 (Multi-layered Extraction) 및 AI 정제**
   - **1계층 (텍스트 기반):** 상세 API 응답의 본문(`body`) HTML에서 `cheerio`를 통해 순수 텍스트만 추출.
   - **1차 AI 요청:** 본문 텍스트를 `gpt-4o-mini` 모델에게 전달하여 이벤트 기간을 `YYYY-MM-DD HH:MM (UTC) - YYYY-MM-DD HH:MM (UTC)` 포맷으로 요약하도록 요청. 기간 발견 시 즉시 OCR 단계를 스킵하고 4단계(DB 적재)로 이동(Early Break).
   - **2계층 (OCR 기반 Fallback):** 텍스트 기반 시도에서 기간을 찾지 못한(`not found`) 경우에만, 본문 내 **맨 위에서부터 최대 2장까지만** 이미지를 Google Vision API로 호출하여 OCR 수행 (비용 통제).
   - **2차 AI 요청:** OCR로 추출된 텍스트 덩어리를 다시 `gpt-4o-mini` 모델에게 위와 동일한 포맷으로 요약하도록 요청.
   - 최종적으로 텍스트와 이미지 모두에서 기간을 찾지 못한 경우 `null` 처리.
4. **DB 적재**
   - AI가 정제하여 통일된 포맷(`YYYY-MM-DD...`)의 데이터(`id`, `name`, `event_period`, `image_url` 등)를 Supabase 테이블에 저장.
   - PK(`id`) 기준 `upsert`를 사용하여 중복 방지.

# 코딩 컨벤션 및 에러 처리 (정석 가이드)

- **모듈 시스템**: ES Modules (`import`/`export`) 또는 CommonJS 중 프로젝트 설정에 맞게 일관성 유지.
- **비동기 처리**: `async/await`를 기본으로 사용하며, `Promise.all` 사용 시 외부 API Rate Limit을 초과하지 않도록 주의할 것.
- **에러 핸들링**: Nexon API 페칭, Supabase 통신, Google Vision API 호출, OpenAI API 호출 등 각 네트워크 경계마다 독립적인 `try-catch` 블록을 작성하여 특정 단계의 에러가 전체 파이프라인을 중단시키지 않도록 구성. 특히 AI 파싱 실패 시 `not found`를 리턴하도록 안전장치 마련.
- **보안**: 서비스 계정 키(GCP JSON) 경로, OpenAI API Key, Supabase 인증 정보는 하드코딩하지 않고 반드시 `process.env`를 통해 주입. `.gitignore`에 해당 시크릿 파일 및 폴더(`node_modules`, `google-credentials.json`, `.env`)가 등록되어 있는지 주기적으로 확인.
