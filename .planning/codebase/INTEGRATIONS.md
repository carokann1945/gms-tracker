# External Integrations

_Last updated: 2026-03-30_

## APIs & External Services

### 1. Nexon MapleStory GMS CMS API

**Purpose:** Primary event data source — provides the news list and per-event HTML detail.

**Authentication:** None — unauthenticated public HTTP GET via Node.js native `fetch`.

**File:** `src/fetcher.js`

**Endpoints:**

| Endpoint | Method | Function | Purpose |
|---|---|---|---|
| `https://g.nexonstatic.com/maplestory/cms/v1/news` | GET | `fetchNewsList()` | Fetch full news list; filter to `category === "events"`, take top 10 |
| `https://g.nexonstatic.com/maplestory/cms/v1/news/{id}` | GET | `fetchEventDetail(id)` | Fetch single event detail with `body` HTML and `imageThumbnail` |

**Response shape (news list):**
```
Array<item> | { items: Array<item> } | { data: Array<item> }
```
Items are filtered by `item.category === 'events'`, capped at 10.

**Response shape (event detail):**
```
{ id, name, title, imageThumbnail, body }
```
- `body`: raw HTML string containing event content and `<img>` tags
- `name ?? title` used as event name fallback

**Throttling:**
- Detail calls are made **sequentially** in a `for` loop with `await sleep(500)` before each call
- `THROTTLE_MS = 500` (defined in `index.js`)
- Purpose: protect Nexon static server from IP banning

**Error handling:**
- `fetchNewsList()` — rethrows on failure (halts pipeline)
- `fetchEventDetail(id)` — catches and returns `null` (pipeline continues without that item)

---

### 2. Nexon MapleStory KMS Website (Web Scraping)

**Purpose:** Source of KMS (Korean MapleStory) event URLs for GMS-KMS matching.

**Authentication:** None — unauthenticated GET with spoofed `User-Agent` header to bypass Nexon CDN/WAF.

**File:** `src/fetcher.js`

**Endpoints scraped:**

| URL | Parser function | Notes |
|---|---|---|
| `https://maplestory.nexon.com/News/Event/Ongoing` | `parseOngoingEvents(html)` | Single page; selects `dt a[href]` matching `/News/Event/{id}` |
| `https://maplestory.nexon.com/News/Event/Closed?page={n}` | `parseClosedEvents(html)` | Paginated up to 20 pages; selects `dd.data em.event_listMt` + `a[href*="/News/Event/Closed/"]` |

**Request headers:**
```javascript
{
  'User-Agent': 'Mozilla/5.0 (compatible; gms-tracker/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
}
```

**Throttling:**
- 500ms `sleep` between each Closed-events page request
- Maximum 20 pages crawled per run (~10 seconds total for closed pages)

**Error handling:**
- `fetchKmsEventList()` catches errors gracefully — returns events collected up to point of failure (no rethrow)

**Output:** `Array<{ id: string, name: string }>` passed to `src/matcher.js:findKmsUrl()`

---

### 3. OpenAI API (GPT-4o-mini)

**Purpose:** (a) Extract structured event period from text/OCR content. (b) Translate GMS event names to Korean and fuzzy-match against KMS event list.

**Authentication:** `OPENAI_API_KEY` environment variable, passed directly to `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`.

**SDK:** `openai` `^6.33.0` — `client.chat.completions.create()`

**Files:** `src/ai.js`, `src/matcher.js`

**Call patterns:**

**A. Event period extraction** (`src/ai.js:extractEventPeriodWithAI(text)`):
```javascript
client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: '<Korean prompt requesting YYYY-MM-DD HH:MM (UTC) format>' },
    { role: 'user', content: text },
  ],
  max_tokens: 100,
  temperature: 0,
})
```
- Returns: parsed date string, or `null` if response is `"not found"`
- Called up to twice per event (once for body text, once for OCR text if first fails)

**B. KMS name translation** (`src/matcher.js:findKmsUrl()` — Step 1):
```javascript
client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: '<prompt: translate GMS event name to Korean KMS name>' },
    { role: 'user', content: gmsEventName },
  ],
  max_tokens: 100,
  temperature: 0,
})
```

**C. KMS event list matching** (`src/matcher.js:findKmsUrl()` — Step 2):
```javascript
client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: '<prompt: find best-match id from list, return id number or "null">' },
    { role: 'user', content: `찾는 이름: ${translatedName}\n\n목록:\n${listText}` },
  ],
  max_tokens: 20,
  temperature: 0,
})
```
- Response parsed with `/\d+/` regex to extract numeric ID from potentially verbose GPT output

**Total OpenAI calls per new event item:**
- Minimum: 3 (period from text + KMS translate + KMS match)
- Maximum: 4 (period from text fails → period from OCR + KMS translate + KMS match)
- KMS matching skipped if `gmsEventName` is empty or `kmsList` is empty

**Error handling:**
- All three functions catch errors and return `null` — OpenAI failure never halts the pipeline

---

### 4. Google Cloud Vision API

**Purpose:** OCR fallback — extract text from event banner images when HTML body text yields no event period.

**Authentication:** Service account key file. Path provided via `GOOGLE_APPLICATION_CREDENTIALS` env var. Consumed automatically by GCP SDK (Application Default Credentials mechanism). Key file: `google-credentials.json` at project root (gitignored).

**SDK:** `@google-cloud/vision` `^4.3.2` — `ImageAnnotatorClient` instantiated lazily (singleton pattern) in `src/ocr.js`.

**File:** `src/ocr.js`

**API call:**
```javascript
const [result] = await client.textDetection(imageUrl);
const annotations = result.textAnnotations ?? [];
return annotations[0]?.description ?? '';
```
- Called with a **public image URL** directly — no local image download required
- `annotations[0].description` is the full concatenated OCR text block

**Cost controls:**
- Hard limit: `OCR_LIMIT = 2` max Vision API calls per event (defined in `index.js`)
- Only called when the 1st-layer text extraction returns no period (early-break pattern)
- Image URLs come from `<img>` tags in event `body` HTML, extracted by `src/parser.js:extractBodyImageUrls()`

**Error handling:**
- `extractTextFromImage()` catches all errors, returns `''` (empty string)
- A Vision API failure results in `event_period: null` for that event — pipeline continues

---

## Data Storage

### Supabase (PostgreSQL)

**Purpose:** Persistent event store — deduplication source and final write target.

**Authentication:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` environment variables. Service role key bypasses Row Level Security (intentional for server-side pipeline). Client validated at first use — throws immediately if either var is missing.

**SDK:** `@supabase/supabase-js` `^2.49.4` (resolved `2.100.0`) — lazy singleton in `src/db.js`.

**File:** `src/db.js`

**Table:** `events`

**Operations:**

| Function | Query | Purpose |
|---|---|---|
| `getProcessedIds(ids)` | `.from('events').select('id').in('id', ids)` + `.from('non_events').select('id').in('id', ids)` | Returns `Set<string>` of already-processed IDs for deduplication |
| `upsertEvents(rows)` | `.from('events').upsert(rows, { onConflict: 'id' })` | Inserts or updates event rows; PK conflict on `id` |

**Schema (inferred from upsert payload in `index.js`):**

| Column | Type | Source |
|---|---|---|
| `id` | string (PK) | Nexon event ID (cast to string) |
| `name` | string | `detail.name ?? detail.title ?? ''` |
| `live_date` | string or null | `detail.liveDate ?? null` |
| `image_thumbnail` | string or null | `detail.imageThumbnail ?? null` |
| `start_at` | string | Parsed event start datetime |
| `end_at` | string | Parsed event end datetime |
| `gms_url` | string | Built by `src/parser.js:buildGmsUrl(id, name)` → `https://www.nexon.com/maplestory/news/events/{id}/{slug}` |
| `kms_url` | string or null | `https://maplestory.nexon.com/News/Event/{matchedId}` or `null` |

**Error handling:**
- `getProcessedIds()` and `upsertEvents()` both rethrow on Supabase errors — these halt the pipeline (critical path)

---

## File Storage

Local filesystem only. No cloud file storage (S3, GCS buckets, etc.).
- `.gitignore` lists `temp/`, `downloads/`, `uploads/` — these directories are not created by current code but are pre-emptively excluded

---

## Authentication & Identity

No user authentication. This is a server-side automation pipeline with no HTTP interface. All auth is service-to-service via environment-injected keys.

---

## Monitoring & Observability

**Error tracking:** None — no Sentry, Datadog, or equivalent.

**Logging:** `console.log` / `console.error` only — structured with `[module]` prefixes (e.g. `[main]`, `[fetcher]`, `[db]`, `[ocr]`, `[ai]`, `[matcher]`).

---

## CI/CD & Deployment

**Containerisation:** `Dockerfile` present — `node:24-slim` base, `pnpm` via corepack, production deps only.

**CI pipeline:** GitHub Actions workflows were deleted (per commit `e38377d`). No active CI/CD pipeline.

**Scheduling:** Not defined within the codebase — intended to be triggered by an external scheduler (cron job, cloud scheduler, etc.).

---

## Webhooks & Callbacks

**Incoming:** None — no HTTP server, no webhook endpoints.

**Outgoing:** None — no callbacks or event emissions to external systems.

---

## Environment Configuration Summary

Required env vars (all must be present in `.env` at project root):

| Variable | Service | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Full DB access key — keep secret |
| `OPENAI_API_KEY` | OpenAI | API key for GPT-4o-mini calls |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Cloud Vision | Absolute path to `google-credentials.json` |

Secrets location: `.env` file (gitignored) + `google-credentials.json` (gitignored, present at project root).

---

_Integration audit: 2026-03-30_
