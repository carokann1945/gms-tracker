# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

---

## Milestone: v1.0 — URL Columns

**Shipped:** 2026-03-27
**Phases:** 2 | **Plans:** 5

### What Was Built

- Supabase `events` table extended with `gms_url` (text) and `kms_url` (text, nullable) columns via manual DDL
- `buildGmsUrl(id, name)` in `src/parser.js` — pure JS slug generation, wired into pipeline upsert
- `fetchKmsEventList()` in `src/fetcher.js` — scrapes KMS Ongoing + Closed events (max 20 pages, 500ms throttle, User-Agent header required)
- `findKmsUrl(gmsEventName, kmsList)` in `src/matcher.js` — GPT-4o-mini 2-step translate→match pipeline, all failure paths return null
- `index.js` integration — KMS list fetched once before loop, both `gms_url` and `kms_url` added to upsert rows

### What Worked

- **Parameter design**: Passing `kmsList` as a parameter to `findKmsUrl()` instead of fetching internally eliminated 10× redundant KMS scraping — clean architectural separation
- **Bounded pagination**: Switching from `while(true)` to `while(page <= 20)` was identified proactively as a domain-rule override, not discovered at runtime
- **GPT null-safety**: All failure paths in matcher return null rather than throwing — pipeline never blocked by KMS match failures

### What Was Inefficient

- **VERIFICATION.md skipped**: Neither phase produced a formal VERIFICATION.md — all requirements remained in "partial" state at audit time. The code was correct but the process artifacts were incomplete
- **REQUIREMENTS.md traceability stale**: URL-02 was mapped to Phase 1 in REQUIREMENTS.md but actually implemented in Phase 2 — traceability table drifted from roadmap early and was not corrected
- **Schema not in VCS**: Supabase DDL was run manually with no SQL migration file, making URL-03 unverifiable except by user self-report

### Patterns Established

- **GPT-safe null return**: All AI-dependent functions wrap in try/catch and return null on any failure — never propagate errors up the pipeline
- **KMS scraping requires User-Agent**: Nexon CDN/WAF returns empty HTML without `User-Agent: Mozilla/5.0 (compatible; gms-tracker/1.0)` header
- **Closed events selector**: `dd.data em.event_listMt` avoids sidebar Ongoing event contamination; `dt a` selector mixes in 21 sidebar items (Pitfall 1)

### Key Lessons

1. Write VERIFICATION.md during execution, not after — the code evidence is clearer when the phase is fresh
2. Fix REQUIREMENTS.md traceability at the point of deviation, not at audit time
3. Add SQL migration files alongside Supabase Dashboard DDL — manual-only changes break independent verification

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 2 | 5 | First milestone — baseline established |

### Top Lessons (Verified Across Milestones)

1. (Accumulates with future milestones)
