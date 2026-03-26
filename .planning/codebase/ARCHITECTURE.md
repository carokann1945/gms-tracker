# Architecture

**Analysis Date:** 2026-03-26

## Summary

A single-process Node.js pipeline that fetches MapleStory GMS event listings from the Nexon CMS API, deduplicates against Supabase, OCR-scans event images via Google Cloud Vision to extract event periods, and upserts structured rows back to Supabase.

## Details

### Pattern Overview

**Overall:** Linear ETL pipeline — Extract → Transform → Load, orchestrated imperatively in a single `main()` function.

**Key Characteristics:**
- No scheduling built-in; designed to be triggered externally (cron, manual run)
- Strictly sequential per-item processing (no parallelism) to respect Nexon rate limits
- Early-exit optimizations at multiple stages (no new items → exit; date found → skip remaining images)
- Lazy singleton pattern for external service clients (`_client` variable in `db.js` and `ocr.js`)

---

### High-Level Data Flow

```
Nexon CMS API (news list)
        │
        ▼
  fetchNewsList()         → filters category="events", keeps top 10
        │
        ▼
  getExistingIds()        → queries Supabase for already-stored ids
        │
        ▼
  [filter: new ids only]
        │
        ▼
  fetchEventDetail(id)    → one API call per new item, 500ms throttle between calls
        │
        ▼
  extractBodyImageUrls()  → regex parse of HTML body to get <img src> URLs
        │
        ▼
  extractTextFromImage()  → Google Cloud Vision OCR, max 2 images per event
        │
        ▼
  parseEventPeriod()      → regex match for date range string from OCR text
        │
        ▼
  upsertEvents()          → Supabase upsert on conflict by id
```

---

### Pipeline Steps (in `index.js`)

**Step 1 — Fetch event list:**
- Calls `fetchNewsList()` from `src/fetcher.js`
- Returns top 10 events with `category === 'events'`
- Exits early if result is empty

**Step 2 — Deduplicate:**
- Extracts `id` strings from the list
- Calls `getExistingIds(ids)` from `src/db.js` which does a `.select('id').in('id', ids)` query
- Filters list to only items not already in DB
- Exits early if nothing new

**Step 3 — Fetch details with throttle:**
- Iterates `newItems` sequentially with `await sleep(500)` before each call
- Calls `fetchEventDetail(id)` from `src/fetcher.js` per item
- Null results (failed fetches) are silently dropped

**Step 4 — OCR and parse:**
- For each detail, calls `extractBodyImageUrls(detail.body)` from `src/parser.js` to get image URLs from HTML
- Takes at most the first 2 URLs (`OCR_LIMIT = 2`)
- For each candidate image URL, calls `extractTextFromImage(url)` from `src/ocr.js`
- Calls `parseEventPeriod(text)` from `src/parser.js` on the returned text
- Breaks out of the image loop as soon as a match is found (early return)
- If neither image yields a date, `event_period` is `null`

**Step 5 — Persist:**
- Collects rows of shape `{ id, name, image_url, event_period }`
- Calls `upsertEvents(rows)` from `src/db.js`
- Uses Supabase `.upsert(..., { onConflict: 'id' })`

---

### Module Responsibilities

**`index.js` — Orchestrator:**
- Owns the full pipeline sequence
- Defines constants `THROTTLE_MS = 500` and `OCR_LIMIT = 2`
- All cross-module coordination happens here
- Top-level error boundary via `.catch()` with `process.exit(1)`

**`src/fetcher.js` — Nexon API client:**
- Exports: `fetchNewsList()`, `fetchEventDetail(id)`, `sleep(ms)`
- Uses Node.js built-in `fetch` (no HTTP library)
- Handles flexible API response shapes: bare array, `{ items: [] }`, or `{ data: [] }`
- `fetchEventDetail` returns `null` on error (non-fatal); `fetchNewsList` re-throws (fatal)

**`src/db.js` — Supabase client:**
- Exports: `getExistingIds(ids)`, `upsertEvents(rows)`
- Lazy singleton `getClient()` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from env
- `getExistingIds` throws on error (fatal — pipeline cannot proceed without dedup)
- `upsertEvents` throws on error (fatal — data must not be silently lost)
- Target table: `events`

**`src/ocr.js` — Google Cloud Vision client:**
- Exports: `extractTextFromImage(imageUrl)`
- Lazy singleton `getClient()` uses `GOOGLE_APPLICATION_CREDENTIALS` env var automatically
- Returns `''` (empty string) on failure — non-fatal, OCR errors do not stop the pipeline
- Extracts `textAnnotations[0].description` which contains the full detected text block

**`src/parser.js` — Text/HTML parsing utilities:**
- Exports: `extractBodyImageUrls(bodyHtml)`, `parseEventPeriod(text)`
- `extractBodyImageUrls`: regex-based HTML `<img src>` extractor; resolves relative URLs against `https://g.nexonstatic.com`
- `parseEventPeriod`: matches pattern `M/D/YYYY (Day) ... - M/D/YYYY (Day) ...`; normalizes whitespace/newlines from OCR; returns `null` if no match

---

### Error Handling Strategy

Each module uses independent `try-catch` blocks. Fatality is determined by whether the error blocks deduplication or data persistence:

| Module | On Error | Effect |
|---|---|---|
| `fetcher.js` `fetchNewsList` | re-throws | Fatal — main exits |
| `fetcher.js` `fetchEventDetail` | returns `null` | Non-fatal — item skipped |
| `db.js` `getExistingIds` | re-throws | Fatal — main exits |
| `db.js` `upsertEvents` | re-throws | Fatal — main exits |
| `ocr.js` `extractTextFromImage` | returns `''` | Non-fatal — period stays null |
| `parser.js` functions | no throws | Pure functions, return null/[] |

---

### Notable Design Decisions

- **No build step:** ES Modules used natively in Node.js (`"type": "module"` in `package.json`). No TypeScript, no bundler.
- **Lazy singletons:** Both `db.js` and `ocr.js` initialize their SDK clients only on first call, avoiding startup errors when credentials are missing but not yet needed.
- **Null-safe field access:** `detail.name ?? detail.title ?? ''` and `detail.imageThumbnail ?? null` handle varying API response shapes gracefully.
- **Idempotent upsert:** Using `onConflict: 'id'` means re-running the pipeline for existing items is safe.
- **OCR cost control:** Hard-coded `OCR_LIMIT = 2` in `index.js` caps Google Vision API calls per event.

## Notes

- The `sleep()` utility is exported from `fetcher.js` but is only consumed in `index.js`. It could reasonably live in a `utils.js` module if the project grows.
- `NEWS_LIST_URL` and `NEWS_DETAIL_URL` in `fetcher.js` are defined as separate constants but currently hold the same base URL string.
- No retry logic exists on any API call. A transient network failure on `fetchNewsList` or any Supabase call will fail the entire run.
- There is no scheduling mechanism in the codebase. The pipeline must be invoked externally (e.g., cron job, CI schedule).
