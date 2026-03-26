# GMS Tracker

## What This Is

넥슨 GMS(Global MapleStory) 이벤트 API에서 상위 10개 이벤트를 자동 수집하고, GPT-4o-mini와 Google Cloud Vision OCR을 활용한 다중 계층 추출로 이벤트 기간을 파싱하여 Supabase에 적재하는 Node.js 자동화 파이프라인. GitHub Actions 스케줄로 정기 실행된다.

## Core Value

수동 개입 없이 GMS 이벤트 데이터를 항상 최신 상태로 DB에 유지한다.

## Requirements

### Validated

- ✓ GMS 이벤트 목록 자동 수집 (Nexon CMS API, category=events 상위 10개) — existing
- ✓ 중복 방지 upsert (Supabase, id PK 기준) — existing
- ✓ 다중 계층 이벤트 기간 추출 (HTML 텍스트 → GPT-4o-mini → OCR fallback) — existing
- ✓ Google Cloud Vision OCR 비용 통제 (이미지 최대 2장) — existing
- ✓ Supabase events 테이블 적재 (id, name, image_url, event_period) — existing
- ✓ GitHub Actions 스케줄 실행 — existing

### Active

- [ ] GMS 이벤트 상세 페이지 URL 생성 및 저장 (`gms_url`: id + name slugify로 구성)
- [ ] KMS 이벤트 링크 매칭 저장 (`kms_url`: GPT 한글 번역 → maplestory.nexon.com/News/Event 전체 순회 → 유사도 매칭)
- [ ] Supabase events 테이블에 `gms_url`, `kms_url` 컬럼 추가

### Out of Scope

- 알림/노티피케이션 시스템 — 현재 milestone 외
- 웹 대시보드 — 현재 milestone 외
- GMS 외 타 서버(KMS 직접 수집 등) 지원 — 현재 milestone 외

## Context

- **스택**: Node.js v24, ES Modules, pnpm, openai, @google-cloud/vision, @supabase/supabase-js
- **실행 환경**: WSL2 Ubuntu + GitHub Actions (정기 스케줄)
- **GMS URL 패턴**: `https://www.nexon.com/maplestory/news/events/{id}/{slug}` — slug는 name에서 영문자/숫자만 유지, 소문자, 공백→하이픈, 연속 하이픈 collapse
- **KMS 사이트**: `https://maplestory.nexon.com/News/Event` — 페이지네이션 있음, 전체 순회 필요
- **AI 모델**: gpt-4o-mini (기간 추출 + 한글 번역 + 유사도 매칭에 재사용)

## Constraints

- **Rate limit**: Nexon 정적 서버 보호를 위해 상세 API 호출 간 500ms throttle 필수
- **OCR 비용**: Google Vision API 호출은 이벤트당 최대 2장으로 제한
- **모듈 시스템**: ES Modules 유지 — CommonJS 혼용 금지
- **시크릿 관리**: API 키, GCP JSON 경로는 반드시 `.env`로 주입

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| slug 생성을 서버 사이드에서 직접 계산 | API에 URL 필드 없음, 패턴이 규칙적으로 확인됨 | — Pending |
| KMS 매칭에 GPT 번역 + 전체 페이지 순회 사용 | 이벤트명이 GMS(영문)/KMS(한글)로 다르므로 직접 매칭 불가 | — Pending |
| 기존 events 테이블에 컬럼 추가 (별도 테이블 X) | 단순한 1:1 관계, join 불필요 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-27 after initialization*
