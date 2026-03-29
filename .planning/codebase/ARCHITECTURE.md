# Architecture

_Last updated: 2026-03-30_

## Pattern Overview

**Overall:** Linear ETL pipeline — a single-shot script that runs to completion and exits. There is no server, no daemon, and no event loop; execution is triggered externally (cron / Docker run).

**Key Characteristics:**
- Sequential, top-to-bottom `async/await` flow inside a single `main()` function in `index.js`
- Stateless between runs — all persistence is in Supabase; idempotency is enforced via PK upsert
- Each module is a focused utility layer; `index.js` is the only orchestrator
- External API calls (Nexon GMS, Nexon KMS, OpenAI, Google Vision, Supabase) are isolated behind module boundaries with independent `try-catch` blocks so one failure does not abort the whole pipeline
- Cost control is built into the design: OCR is only invoked when text extraction fails (early-break), and at most 2 images are processed per event

---

## Pipeline Stages

### Stage 1 — Fetch GMS event list
- **Module:** `src/fetcher.js` → `fetchNewsList()`
- **Source:** `https://g.nexonstatic.com/maplestory/cms/v1/news`
- Filters for `category === "events"`, slices top 10
- Handles flexible API response shapes: bare array, `{ items: [] }`, or `{ data: [] }`
- Returns `Array<{id, ...rawFields}>`; re-throws on error (fatal)

### Stage 2 — Deduplication check
- **Module:** `src/db.js` → `getExistingIds(ids)`
- Queries the Supabase `events` table for which of the 10 IDs already exist
- Only items absent from DB continue through the pipeline (idempotency guarantee)
- **Module:** `src/db.js` → `getMaxSourceIndex()`
- Queries current max `source_index` value once; used to assign monotonically increasing indices to new rows
- `newItems[0]` (most recent in API order) receives `currentMax + length` (highest), so ordering by `source_index DESC` reflects recency

### Stage 3 — Fetch KMS event list (pre-loop, single load)
- **Module:** `src/fetcher.js` → `fetchKmsEventList()`
- Scrapes `https://maplestory.nexon.com/News/Event/Ongoing` (single page, `dt a[href]` selector)
- Scrapes `/Closed?page=N` (up to 20 pages, `dd.data em.event_listMt` selector, 500 ms throttle per page)
- HTML parsing via `cheerio`; loaded once before the per-event loop to avoid N redundant scraping runs
- Returns `Array<{id, name}>`; on error returns whatever was collected so far (graceful degradation)

### Stage 4 — Fetch GMS event detail (throttled)
- **Module:** `src/fetcher.js` → `fetchEventDetail(id)`
- Sequential loop with `sleep(500)` between calls to avoid Nexon CDN rate-limits
- **Source:** `https://g.nexonstatic.com/maplestory/cms/v1/news/{id}`
- Returns full event object including `body` (raw HTML), `name`/`title`, `imageThumbnail`; returns `null` on error (non-fatal, item skipped)

### Stage 5 — Multi-layer date extraction

#### Layer 1 — Text-based extraction (primary, cheaper path)
- **Module:** `src/parser.js` → `extractBodyText(bodyHtml)`
  - Loads HTML with `cheerio`, returns `$('body').text()` collapsed to single spaces
- **Module:** `src/ai.js` → `extractEventPeriodWithAI(text)`
  - Sends text to `gpt-4o-mini` with a fixed system prompt requesting `YYYY-MM-DD HH:MM (UTC) - YYYY-MM-DD HH:MM (UTC)` format
  - `temperature: 0`, `max_tokens: 100` — deterministic, minimal token spend
  - Returns `null` if response is `"not found"` or an error occurs
  - **Early break:** if a non-null period is returned here, OCR (Layer 2) is skipped entirely

#### Layer 2 — OCR fallback (only when Layer 1 returns null)
- **Module:** `src/parser.js` → `extractBodyImageUrls(bodyHtml)`
  - Regex-extracts `<img src="...">` values, resolves relative paths against `https://g.nexonstatic.com`
  - Only the first `OCR_LIMIT = 2` images are used (constant defined in `index.js`)
- **Module:** `src/ocr.js` → `extractTextFromImage(imageUrl)`
  - Calls `@google-cloud/vision` `ImageAnnotatorClient.textDetection()` per image URL
  - Returns `annotations[0].description` (full detected text block) or `''` on error (non-fatal)
- **Module:** `src/ai.js` → `extractEventPeriodWithAI(combinedOcrText)`
  - All OCR texts are joined with `\n\n` and sent in a single AI call (not one call per image)

### Stage 6 — KMS URL matching (per event)
- **Module:** `src/matcher.js` → `findKmsUrl(gmsEventName, kmsList)`
- Two sequential `gpt-4o-mini` calls per event:
  1. Translate GMS English event name to Korean
  2. Match the Korean name against the pre-loaded `kmsList` to find the best-fit KMS event ID
- Returns `https://maplestory.nexon.com/News/Event/{matchedId}` or `null`
- Guards against GPT returning `"id=1301"` or prose — a `/\d+/` regex extracts the bare numeric ID
- Always returns `https://maplestory.nexon.com/News/Event/{id}` form (not `/Closed/` path)

### Stage 7 — GMS URL construction
- **Module:** `src/parser.js` → `buildGmsUrl(id, name)`
- Strips non-alphanumeric characters from `name`, lowercases, hyphenates to form a URL slug
- Constructs `https://www.nexon.com/maplestory/news/events/{id}/{slug}`

### Stage 8 — Upsert to Supabase
- **Module:** `src/db.js` → `upsertEvents(rows)`
- Batch upserts all processed rows to the `events` table with `onConflict: 'id'`
- Row shape: `{ id, name, image_url, event_period, gms_url, kms_url, source_index }`

---

## Data Flow

```
Nexon GMS News API
       │
       ▼
fetchNewsList()            ← top 10 events, category=events
       │
       ▼
getExistingIds()           ← filter to new IDs only (Supabase read)
getMaxSourceIndex()        ← compute source_index base (Supabase read)
       │
       ▼
fetchKmsEventList()        ← load KMS events once (ongoing + ≤20 closed pages)
       │
       ▼
[for each new item, sequential with 500ms throttle]
  fetchEventDetail(id)     ← Nexon GMS detail API
       │
       ├── extractBodyText(html)
       │   extractEventPeriodWithAI(text)      ← gpt-4o-mini
       │        │
       │        ├── [found] ─────────────────────────────────┐
       │        │                                            │
       │        └── [null] → extractBodyImageUrls(html)      │
       │                     extractTextFromImage(url) × ≤2  │
       │                     ← Google Cloud Vision OCR       │
       │                     extractEventPeriodWithAI(ocr)   │
       │                     ← gpt-4o-mini                   │
       │                                                     │
       │   ◄────────────────────────────────────────────────┘
       │
       ├── findKmsUrl(name, kmsList)           ← gpt-4o-mini × 2 calls
       │   (translate GMS name → match KMS list)
       │
       └── buildGmsUrl(id, name)              ← pure, no I/O
              │
              ▼
         row assembled: { id, name, image_url, event_period,
                          gms_url, kms_url, source_index }
       │
       ▼
upsertEvents(rows)         ← Supabase batch upsert, onConflict='id'
```

---

## Error Handling Strategy

Each module uses an independent `try-catch` block. Fatality is determined by whether the error blocks deduplication or data persistence:

| Module | On Error | Effect |
|---|---|---|
| `src/fetcher.js` `fetchNewsList` | re-throws | Fatal — `main()` exits |
| `src/fetcher.js` `fetchEventDetail` | returns `null` | Non-fatal — item skipped |
| `src/fetcher.js` `fetchKmsEventList` | logs, returns partial list | Non-fatal — degraded matching |
| `src/db.js` `getExistingIds` | re-throws | Fatal — `main()` exits |
| `src/db.js` `getMaxSourceIndex` | re-throws | Fatal — `main()` exits |
| `src/db.js` `upsertEvents` | re-throws | Fatal — `main()` exits |
| `src/ai.js` `extractEventPeriodWithAI` | returns `null` | Non-fatal — period stays null |
| `src/matcher.js` `findKmsUrl` | returns `null` | Non-fatal — kms_url stays null |
| `src/ocr.js` `extractTextFromImage` | returns `''` | Non-fatal — image skipped |
| `src/parser.js` functions | no throws | Pure functions, return null/[] |

---

## Key Design Decisions

**Lazy Supabase and Vision client initialization (`getClient()` singleton in `src/db.js` and `src/ocr.js`):**
The SDK client is created on first call rather than at module load time. This avoids throwing at import if env vars are missing.

**KMS list loaded once, passed as argument to `findKmsUrl`:**
`fetchKmsEventList()` runs once before the per-event loop and its result is passed as a parameter. This prevents N redundant scraping runs (one per event) and makes `findKmsUrl` a pure-input function.

**`source_index` assignment (reverse order):**
`newItems[0]` is the most-recent event at the top of the GMS API response. It receives `currentMax + length` (highest value), so `ORDER BY source_index DESC` in Supabase reflects chronological recency.

**OCR cost control:**
`OCR_LIMIT = 2` in `index.js` caps Google Vision API calls per event. Combined with the Layer-1 early break, OCR is only reached for events whose body text contains no parseable dates.

**No build step / transpilation:**
`"type": "module"` in `package.json` enables native ES Modules. No TypeScript, no Babel, no bundler.

**Docker deployment:**
`Dockerfile` uses `node:24-slim`, installs only production dependencies via `pnpm install --frozen-lockfile --prod`, and runs `node index.js` as the sole container command. Designed for one-shot execution triggered by an external scheduler.

---

## Module Responsibilities

| Module | Responsibility |
|---|---|
| `index.js` | Pipeline orchestration, loop control, row assembly, constants |
| `src/fetcher.js` | All outbound HTTP to Nexon (GMS REST API + KMS HTML scraping) and `sleep()` utility |
| `src/parser.js` | Stateless HTML/text parsing: extract body text, extract image URLs, build GMS URL slug |
| `src/ai.js` | OpenAI client wrapper — single exported function for date period extraction via `gpt-4o-mini` |
| `src/matcher.js` | OpenAI client wrapper — two-step translate-then-match for KMS URL lookup via `gpt-4o-mini` |
| `src/ocr.js` | Google Cloud Vision wrapper — OCR text extraction from image URL |
| `src/db.js` | Supabase wrapper — read existing IDs, read max source_index, batch upsert |

No `src/` module imports from another `src/` module. All cross-module wiring is in `index.js`.

---

*Architecture analysis: 2026-03-30*
