# Coding Conventions

_Last updated: 2026-03-30_

## Module System

**Type:** ES Modules (ESM), enforced by `"type": "module"` in `package.json`.

All `.js` files use `import`/`export` syntax throughout. Named exports only — no default exports from `src/` modules.

**Import style:**
```js
import 'dotenv/config';                             // side-effect import for env loading
import { load } from 'cheerio';                     // named import from package
import { createClient } from '@supabase/supabase-js';
import vision from '@google-cloud/vision';          // default import (third-party SDK)
```

**Export style** (`src/fetcher.js`, `src/db.js`, `src/parser.js`, `src/ai.js`, `src/ocr.js`, `src/matcher.js`):
```js
export async function fetchNewsList() { ... }
export async function getExistingIds(ids) { ... }
export function sleep(ms) { ... }
```

All local imports include explicit `.js` extensions, required by Node.js ESM:
```js
import { fetchNewsList, fetchEventDetail, sleep, fetchKmsEventList } from './src/fetcher.js';
```

No path aliases. All imports are bare package names or relative paths.

## Async Patterns

All async operations use `async/await`. No raw `.then()/.catch()` chaining anywhere.

`Promise.all` is deliberately avoided to respect external API rate limits. Sequential loops with explicit `sleep()` throttle are used instead:

```js
// index.js — sequential throttled fetch loop
for (const item of newItems) {
  await sleep(THROTTLE_MS);
  try {
    const detail = await fetchEventDetail(item.id);
    if (detail) newDetails.push(detail);
  } catch (err) {
    console.error(`[main] Failed to fetch detail for id=${item.id}:`, err.message);
  }
}
```

**`sleep` utility** (`src/fetcher.js`):
```js
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Early-exit pattern** — when Layer 1 text extraction succeeds, the OCR branch is skipped entirely:
```js
event_period = await extractEventPeriodWithAI(bodyText);
if (!event_period) {
  // only then enter OCR fallback branch
}
```

## Error Handling

Each network boundary has an independent `try/catch`. Errors are logged with a `[module]` prefix and the function either rethrows (fatal path) or returns a safe fallback (non-fatal path).

**Rethrow pattern** — used in `src/db.js` where DB failure should halt the pipeline:
```js
} catch (err) {
  console.error('[db] getExistingIds error:', err.message);
  throw err;
}
```

**Null-return pattern** — used in `src/ai.js` and `src/matcher.js` where per-item failure must not stop the run:
```js
// src/ai.js
} catch (err) {
  console.error('[ai] GPT call failed:', err.message);
  return null;
}
```

**Empty-string pattern** — used in `src/ocr.js` so a bad image URL does not break the loop:
```js
} catch (err) {
  console.error(`[ocr] extractTextFromImage error (url=${imageUrl}):`, err.message);
  return '';
}
```

**Graceful degradation** — `src/fetcher.js`'s `fetchKmsEventList` returns however many events it collected before an error, rather than throwing:
```js
} catch (err) {
  console.error('[fetcher] fetchKmsEventList error:', err.message);
  // 에러 이전까지 수집된 이벤트 반환 (graceful degradation)
}
return events;
```

**Fatal top-level catch** in `index.js`:
```js
main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
```

**Guard clauses** at function entry prevent deep nesting:
```js
if (!ids.length) return new Set();
if (!rows.length) { console.log('[db] No rows to upsert'); return; }
if (!bodyHtml) return [];
if (!text) return null;
```

## Naming Conventions

**Files:** `camelCase.js` for all modules in `src/` (`ai.js`, `db.js`, `fetcher.js`, `matcher.js`, `ocr.js`, `parser.js`).

**Functions:** `camelCase` verbs — `fetchNewsList`, `fetchEventDetail`, `fetchKmsEventList`, `extractTextFromImage`, `extractBodyText`, `extractBodyImageUrls`, `extractEventPeriodWithAI`, `buildGmsUrl`, `findKmsUrl`, `getExistingIds`, `getMaxSourceIndex`, `upsertEvents`, `parseOngoingEvents`, `parseClosedEvents`.

**Constants:** `UPPER_SNAKE_CASE` at module scope — `THROTTLE_MS`, `OCR_LIMIT`, `NEWS_LIST_URL`, `NEWS_DETAIL_URL`, `NEXON_BASE`, `TABLE`, `PROMPT`.

**Variables:** `camelCase` — `newItems`, `existingIds`, `bodyHtml`, `event_period` (exception: DB row field names use `snake_case` to match Supabase column names: `event_period`, `image_url`, `gms_url`, `kms_url`, `source_index`).

**Private module-level singletons:** prefixed with underscore — `_client` in both `src/db.js` and `src/ocr.js`.
```js
let _client = null;
function getClient() {
  if (_client) return _client;
  _client = createClient(url, key);
  return _client;
}
```

## Console Logging

All log calls include a bracketed module prefix as the first token. No third-party logging library is used.

| Module | Prefix |
|---|---|
| `index.js` | `[main]` |
| `src/ai.js` | `[ai]` |
| `src/db.js` | `[db]` |
| `src/fetcher.js` | `[fetcher]` |
| `src/matcher.js` | `[matcher]` |
| `src/ocr.js` | `[ocr]` |

`console.log` for progress, `console.error` for errors. Only `err.message` is logged, never the full error object with stack in normal flow.

## JSDoc Comments

All exported functions have JSDoc blocks with `@param` and `@returns`. Internal helpers (`parseOngoingEvents`, `parseClosedEvents`, `getClient`) also carry JSDoc.

```js
/**
 * Brief description.
 * @param {string} text
 * @returns {Promise<string | null>} 찾으면 정제된 날짜 문자열, 못 찾으면 null
 */
export async function extractEventPeriodWithAI(text) { ... }
```

Inline comments explain non-obvious decisions, pitfalls, and API quirks (e.g., `// Pitfall 3 방지:`, `// User-Agent 헤더 없으면 Nexon CDN/WAF가 빈 HTML을 반환할 수 있으므로 반드시 포함.`).

## Code Style

No linter or formatter config files are present (no `.eslintrc`, `biome.json`, `.prettierrc`). Style is consistent by convention:

- 2-space indentation
- Single quotes for strings
- Trailing commas in multiline arrays/objects
- Nullish coalescing for safe defaults: `data.items ?? data.data ?? []`, `detail.name ?? detail.title ?? ''`, `annotations[0]?.description ?? ''`
- Optional chaining for nested property access: `response.choices[0]?.message?.content?.trim()`
- Blank lines between logical sections within functions

## Environment Variable Usage

All secrets and configuration are injected via `process.env`. No hardcoded values.

**Required env vars:**

| Variable | Used in | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | `src/ai.js`, `src/matcher.js` | OpenAI client init |
| `SUPABASE_URL` | `src/db.js` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/db.js` | Supabase auth key |
| `GOOGLE_APPLICATION_CREDENTIALS` | `src/ocr.js` (implicit, read by GCP SDK) | Absolute path to GCP service account JSON |

`dotenv/config` is loaded as a side-effect import at the top of `index.js`:
```js
import 'dotenv/config';
```

Missing required vars throw explicitly at client construction time, not silently at first use:
```js
if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
}
```

## Security Patterns

- `.env`, `google-credentials.json`, and `*.pem` are listed in `.gitignore`
- GCP credentials are read by the SDK via `GOOGLE_APPLICATION_CREDENTIALS` env var; application code never reads the JSON file directly
- Error logs emit only `err.message`, never full objects that might contain tokens or request bodies
- `google-credentials.json` exists at the project root but is gitignored

---

_Convention analysis: 2026-03-30_
