---
plan: "01-02"
status: "complete"
completed: "2026-03-27"
commits:
  - "16b1c8c"
key-files:
  created: []
  modified:
    - "src/parser.js"
    - "index.js"
---

# Summary: 01-02 buildGmsUrl 구현 및 파이프라인 통합

## What was built

`src/parser.js`에 `buildGmsUrl(id, name)` named export 추가.
`index.js`의 import와 rows.push 블록에 통합 — Supabase upsert 시 `gms_url` 필드 저장.

## Technical approach

- slug 알고리즘: non-alphanumeric 제거 → lowercase → trim → whitespace→hyphen → 연속 hyphen 축소 → 앞뒤 hyphen 제거
- `eventName` 변수 도입으로 `name`/`gms_url` 동일 표현식 공유
- 외부 라이브러리 없음, 순수 JS 5줄

## Self-Check: PASSED

- [x] `buildGmsUrl` named export 존재 (src/parser.js)
- [x] slug 4개 검증 예시 모두 통과
- [x] index.js import에 buildGmsUrl 추가
- [x] rows.push에 gms_url 필드 포함
- [x] kms_url 필드 row 객체에 없음
