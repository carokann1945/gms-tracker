# External Integrations

## Summary

Three external services are used: Nexon's static CMS API (unauthenticated, read-only), Google Cloud Vision API (service account auth, OCR), and Supabase (service role key auth, read/write). No webhooks or outgoing callbacks exist.

## Details

### 1. Nexon MapleStory CMS API

**Purpose:** Source of event data — provides the news list and per-event detail.

**Authentication:** None. Unauthenticated public HTTP GET requests via Node.js built-in `fetch`.

**Endpoints:**

| Endpoint | Method | Used in | Purpose |
|----------|--------|---------|---------|
| `https://g.nexonstatic.com/maplestory/cms/v1/news` | GET | `src/fetcher.js:fetchNewsList()` | Fetch full news list |
| `https://g.nexonstatic.com/maplestory/cms/v1/news/{id}` | GET | `src/fetcher.js:fetchEventDetail()` | Fetch single event detail |

**Data flowing in (from API):**

- News list: array or `{ items: [] }` or `{ data: [] }` — contains items with `id`, `category`, and other metadata. Items are filtered to `category === "events"`, top 10 kept.
- Event detail: object with fields `id`, `name`, `title` (fallback), `imageThumbnail`, `body` (HTML string containing `<img>` tags).

**Data flowing out (to API):** None. Read-only.

**Rate limits / constraints:**

- No official rate limit documented, but the pipeline enforces a **500ms minimum delay** between each detail API call (`THROTTLE_MS = 500` in `index.js`) to avoid triggering IP bans on Nexon's static servers.
- Detail calls are made **sequentially** (not in parallel) via a `for` loop with `await sleep(THROTTLE_MS)`.
- Error handling: `fetchNewsList()` rethrows on failure (halts pipeline); `fetchEventDetail()` returns `null` on failure (pipeline continues without that item).

---

### 2. Google Cloud Vision API

**Purpose:** OCR text extraction from event banner images to find event period dates.

**Authentication:** Service account key file. The GCP SDK reads the path from `GOOGLE_APPLICATION_CREDENTIALS` environment variable automatically (Application Default Credentials). The key file is `google-credentials.json` at project root (gitignored).

**SDK:** `@google-cloud/vision` v4.3.3 — `ImageAnnotatorClient` instantiated lazily (singleton) in `src/ocr.js`.

**API call:**

```javascript
const [result] = await client.textDetection(imageUrl);
const annotations = result.textAnnotations ?? [];
return annotations[0]?.description ?? '';
```

`textDetection()` is called with a public image URL directly — no local download required.

**Data flowing in (from API):** `textAnnotations` array; `annotations[0].description` is the full concatenated OCR text of the image.

**Data flowing out (to API):** The public image URL string from Nexon's static CDN.

**Rate limits / constraints:**

- Hard limit of **max 2 Vision API calls per event post** (`OCR_LIMIT = 2` in `index.js`). Images beyond the first 2 in a post's `body` HTML are skipped entirely.
- **Early exit:** If a valid event period is parsed from the first image, the second image is skipped — Vision API is never called for it.
- Error handling: `extractTextFromImage()` catches all errors and returns `''` (empty string), so a Vision API failure does not halt the pipeline. The event is saved with `event_period: null`.

**Cost implications:** Maximum 2 API calls per new event item, only for items not already in the DB.

---

### 3. Supabase

**Purpose:** Persistent storage for processed event data. Also used for idempotency checks before API calls.

**Authentication:** Service role key (`SUPABASE_SERVICE_ROLE_KEY`) — bypasses Row Level Security. Configured via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Client created with `createClient(url, key)` from `@supabase/supabase-js`.

**SDK:** `@supabase/supabase-js` v2.100.0 — `SupabaseClient` instantiated lazily (singleton) in `src/db.js`.

**Table:** `events`

**Operations:**

| Operation | Function | Query |
|-----------|----------|-------|
| Read existing IDs | `getExistingIds(ids)` in `src/db.js` | `.from('events').select('id').in('id', ids)` |
| Write new/updated events | `upsertEvents(rows)` in `src/db.js` | `.from('events').upsert(rows, { onConflict: 'id' })` |

**Schema (inferred from upsert payload):**

| Column | Type | Source |
|--------|------|--------|
| `id` | string (PK) | Nexon event `id` (cast to string) |
| `name` | string | `detail.name ?? detail.title ?? ''` |
| `image_url` | string or null | `detail.imageThumbnail ?? null` |
| `event_period` | string or null | Parsed from OCR text, or `null` if not found |

**Data flowing in (from Supabase):** Set of existing `id` strings for deduplication.

**Data flowing out (to Supabase):** Array of event row objects with `id`, `name`, `image_url`, `event_period`.

**Error handling:** Both `getExistingIds()` and `upsertEvents()` rethrow on Supabase errors — these halt the pipeline, since they are critical operations.

---

### Image URLs (Nexon CDN — indirect integration)

The `body` HTML from Nexon event detail responses contains `<img src="...">` tags. `src/parser.js:extractBodyImageUrls()` extracts these URLs. They may be:

- Absolute URLs (passed through as-is)
- Relative paths (prefixed with `https://g.nexonstatic.com`)

These image URLs are passed directly to Google Vision API's `textDetection()`. No local download or caching occurs.

## Notes

- The Nexon API base URL (`https://g.nexonstatic.com/maplestory/cms/v1/news`) is defined twice identically in `src/fetcher.js` as `NEWS_LIST_URL` and `NEWS_DETAIL_URL` — these could be consolidated to a single constant.
- `SUPABASE_SERVICE_ROLE_KEY` grants full database access bypassing RLS. This is intentional for a server-side pipeline but means the key must be protected carefully.
- There is no retry logic on any external call. A transient network failure on Nexon detail fetch returns `null` and silently skips that event. A failure on Supabase or the initial Nexon list fetch halts the entire run.
- No monitoring, alerting, or structured logging integration exists. All observability is via `console.log` / `console.error`.
- `.env` is gitignored; `google-credentials.json` is also gitignored. Both must be provisioned manually on any new environment.

---

*Integration audit: 2026-03-26*
