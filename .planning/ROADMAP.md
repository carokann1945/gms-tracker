# Roadmap: GMS Tracker — URL Columns Milestone

**Milestone:** Add `gms_url` and `kms_url` to the events pipeline
**Granularity:** Coarse
**Coverage:** 6/6 v1 requirements mapped

---

## Phases

- [ ] **Phase 1: Schema & GMS URL** — Add DB columns and wire GMS URL generation into the upsert
- [ ] **Phase 2: KMS URL Matching** — Translate GMS event name to Korean, scrape KMS event list, GPT-match, store URL

---

## Phase Details

## Phase 1: Schema & GMS URL

**Goal:** The pipeline stores a correct `gms_url` for every new event and the DB schema is ready for both URL columns.

**Plans:**
- 1.1 DB schema migration — Add `gms_url` (text) and `kms_url` (text, nullable) columns to the Supabase `events` table
- 1.2 GMS URL generation — Implement `buildGmsUrl(id, name)` slug logic in `src/parser.js` and include `gms_url` in every upsert row

**Requirements covered:** URL-01, URL-03, PIPE-01, PIPE-02, PIPE-03

**Success criteria:**
- [ ] Running the pipeline on a fresh event produces a row in Supabase where `gms_url` matches `https://www.nexon.com/maplestory/news/events/{id}/{slug}` exactly
- [ ] Slug contains only lowercase alphanumerics and single hyphens (no consecutive hyphens, no trailing hyphens)
- [ ] Re-running the pipeline on an already-stored event does not create a duplicate row and does not overwrite `kms_url` with an incorrect value
- [ ] The existing `event_period` extraction (text → GPT → OCR fallback) still produces correct output alongside the new URL fields
- [ ] Nexon detail API calls still have at least 500ms delay between them

---

## Phase 2: KMS URL Matching

**Goal:** The pipeline finds and stores the matching KMS event URL for each new GMS event, falling back to `null` when no confident match is found.

**Plans:**
- 2.1 KMS scraper — Implement `fetchKmsEventList()` in `src/fetcher.js` to paginate through all pages of `maplestory.nexon.com/News/Event` and return `[{ id, name }]`
- 2.2 GPT translation + match — Implement `findKmsUrl(gmsEventName)` in `src/matcher.js`: translate name to Korean via GPT-4o-mini, call `fetchKmsEventList()`, ask GPT to pick the best match, return full KMS URL or `null`

**Requirements covered:** URL-02

**Success criteria:**
- [ ] For a GMS event with a known KMS counterpart, the stored `kms_url` is a valid URL of the form `https://maplestory.nexon.com/News/Event/{id}`
- [ ] For a GMS event with no recognizable KMS equivalent, `kms_url` is stored as `null` (no error thrown, pipeline completes)
- [ ] The KMS scraper traverses all available pages before returning (not just the first page)
- [ ] A full pipeline run with both URL fields completes without exceeding the Nexon 500ms throttle constraint

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema & GMS URL | 0/2 | Not started | - |
| 2. KMS URL Matching | 0/2 | Not started | - |

---

## Requirement Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| URL-01 | Phase 1 | Pending |
| URL-02 | Phase 2 | Pending |
| URL-03 | Phase 1 | Pending |
| PIPE-01 | Phase 1 | Pending |
| PIPE-02 | Phase 1 | Pending |
| PIPE-03 | Phase 1 | Pending |

**Coverage: 6/6 v1 requirements mapped. No orphans.**

---

*Roadmap created: 2026-03-27*
