---
phase: 02-kms-url-matching
plan: "02-02"
subsystem: api
tags: [openai, gpt-4o-mini, matcher, kms, url-matching]

# Dependency graph
requires:
  - phase: 02-kms-url-matching
    provides: fetchKmsEventList() returning { id, name }[] array for kmsList parameter
provides:
  - findKmsUrl(gmsEventName, kmsList) in src/matcher.js — GPT-based GMS→KMS event URL matching
affects:
  - 02-03-index-integration (imports findKmsUrl to wire into pipeline)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OpenAI client singleton reuse pattern from src/ai.js applied to src/matcher.js"
    - "Two-stage GPT pipeline: translate (GMS EN → KMS KR) then match (KR name → KMS event ID)"
    - "Regex digit extraction from GPT response to guard against verbose output (matchResult.match(/\\d+/))"

key-files:
  created:
    - src/matcher.js
  modified: []

key-decisions:
  - "kmsList passed as parameter (not fetched internally) to prevent 10x redundant KMS scraping per pipeline run"
  - "Two GPT calls per event: translate then match — avoids direct KR↔EN string comparison which is unreliable for game event names"
  - "matchResult.match(/\\d+/)?.[0] extracts numeric ID defensively from GPT verbose responses"
  - "URL format /News/Event/{id} used (not Closed path) per Pitfall 3 constraint"

patterns-established:
  - "Pattern: GPT-safe null return — all failure paths return null, never throw"
  - "Pattern: input guard before any network call — falsy gmsEventName or empty kmsList exits immediately"

requirements-completed: []

# Metrics
duration: 1min
completed: 2026-03-26
---

# Phase 02 Plan 02: findKmsUrl() 구현 Summary

**GPT-4o-mini 2단계 파이프라인(GMS 영문→KMS 한글 번역 후 목록 유사도 매칭)으로 KMS 이벤트 URL을 반환하는 src/matcher.js 신규 생성**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-26T19:53:21Z
- **Completed:** 2026-03-26T19:54:30Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- `src/matcher.js` 신규 생성 — `findKmsUrl(gmsEventName, kmsList)` named export 구현
- GPT-4o-mini 2단계 호출: (1) GMS 이벤트명 한국어 번역, (2) KMS 목록에서 최적 매칭 ID 탐색
- Pitfall 3/4/5 방지 패턴 모두 적용 (URL 형식, ID 추출, fetchKmsEventList 미호출)
- 모든 실패 케이스(falsy 입력, GPT 에러, "null" 응답, 숫자 없는 응답)에서 null 반환

## Task Commits

Each task was committed atomically:

1. **T1+T2: src/matcher.js 생성 및 에러 처리 검증** - `ec36a5f` (feat)

## Files Created/Modified
- `src/matcher.js` - findKmsUrl() 구현. GMS 이벤트명을 GPT로 번역 후 KMS 목록에서 유사도 매칭하여 https://maplestory.nexon.com/News/Event/{id} URL 반환

## Decisions Made
- kmsList를 파라미터로 받도록 설계 — 내부에서 fetchKmsEventList() 호출 시 10개 이벤트 처리 시 KMS 전체 스크래핑 10회 발생(~500초) 방지
- src/ai.js의 OpenAI 클라이언트 싱글턴 패턴 그대로 재사용 — 새 패턴 도입 없이 일관성 유지

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `findKmsUrl(gmsEventName, kmsList)` 준비 완료 — 02-03 index.js 통합 플랜에서 import 가능
- 선제 조건: 02-01의 `fetchKmsEventList()` 결과를 호출자(index.js)가 1회만 로드하여 `kmsList`로 전달해야 함

---
*Phase: 02-kms-url-matching*
*Completed: 2026-03-26*
