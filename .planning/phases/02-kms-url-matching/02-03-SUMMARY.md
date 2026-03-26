---
plan: "02-03"
phase: "02"
status: complete
started: "2026-03-27"
completed: "2026-03-27"
---

# Plan 02-03 Summary: index.js 파이프라인 통합

## What Was Built

`index.js`에 `fetchKmsEventList()`와 `findKmsUrl()` 호출을 통합했다. Wave 1에서 구현된 fetcher와 matcher를 파이프라인에 연결하는 마지막 단계.

## Key Changes

### T1: import 추가
- `fetchKmsEventList`를 `./src/fetcher.js` import에 추가
- `findKmsUrl`을 `./src/matcher.js`에서 신규 import

### T2: fetchKmsEventList() 위치
- `newItems` 존재 확인 후, 4단계 루프 시작 전에 1회 호출
- `kmsList` 변수에 저장 (Pitfall 5 — 루프 내 중복 스크래핑 방지)
- 신규 이벤트가 없으면(`newItems.length === 0`) 조기 반환으로 KMS 스크래핑 자체가 호출되지 않음

### T3: findKmsUrl() 루프 내 통합
- `for (const detail of newDetails)` 루프 내부에서 `findKmsUrl(eventName, kmsList)` 호출
- 반환값을 `rows.push()`의 `kms_url` 필드에 포함 (null 포함 — upsert 정상 동작)

## Self-Check

- [x] fetchKmsEventList import 확인
- [x] findKmsUrl import 확인
- [x] fetchKmsEventList() 호출이 루프 외부 1회
- [x] fetchKmsEventList() 호출이 newItems.length 확인 이후
- [x] findKmsUrl(eventName, kmsList) 호출이 4단계 루프 내부
- [x] rows.push() 블록에 kms_url 필드 포함
- [x] 기존 파이프라인 구조(throttle, upsert, try-catch) 변경 없음

## Commits

- `feat(02-03): add fetchKmsEventList and findKmsUrl imports to index.js`
- `feat(02-03): call fetchKmsEventList() once before event loop`
- `feat(02-03): call findKmsUrl() per event and add kms_url to upsert row`

## key-files

### modified
- index.js
