# Coding Conventions

## Summary

This is a single-pipeline Node.js script using ES Modules throughout. Code is organized into focused single-responsibility modules with consistent `async/await` patterns and per-boundary `try-catch` error handling.

## Details

### Module System

**ES Modules (ESM)** — enforced by `"type": "module"` in `package.json`.

All files use `import`/`export` syntax:
- Named exports only — no default exports used for functions
- Side-effect imports for env loading: `import 'dotenv/config'` in `index.js`
- File extensions are required on all local imports (e.g., `'./src/fetcher.js'`)

### Async Patterns

**`async/await` exclusively.** No raw `.then()/.catch()` chaining anywhere in the codebase.

Sequential async loops are used deliberately over `Promise.all` to respect external API rate limits:

```js
// src/fetcher.js — sequential throttled calls
for (const item of newItems) {
  await sleep(THROTTLE_MS);
  const detail = await fetchEventDetail(item.id);
}
```

The `sleep` utility is a plain Promise wrapper in `src/fetcher.js`:

```js
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Error Handling

Each network boundary has its own independent `try-catch`. Errors are logged and either re-thrown (fatal path) or swallowed with a safe fallback (non-fatal path):

**Re-throw pattern** — used when failure should halt the pipeline (e.g., DB unavailable):
```js
// src/db.js
} catch (err) {
  console.error('[db] getExistingIds error:', err.message);
  throw err;
}
```

**Null-return pattern** — used when a single item failing should not stop the pipeline:
```js
// src/fetcher.js
} catch (err) {
  console.error(`[fetcher] fetchEventDetail error (id=${id}):`, err.message);
  return null;
}
```

**Empty-string pattern** — used in OCR so a bad image URL doesn't break the loop:
```js
// src/ocr.js
} catch (err) {
  console.error(`[ocr] extractTextFromImage error (url=${imageUrl}):`, err.message);
  return '';
}
```

Fatal top-level errors are caught in `index.js`:
```js
main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
```

### Naming Conventions

**Files:** `camelCase.js` for all source modules (`fetcher.js`, `parser.js`, `ocr.js`, `db.js`)

**Functions:** `camelCase` verbs — `fetchNewsList`, `fetchEventDetail`, `extractTextFromImage`, `extractBodyImageUrls`, `parseEventPeriod`, `getExistingIds`, `upsertEvents`

**Constants:** `UPPER_SNAKE_CASE` — `THROTTLE_MS`, `OCR_LIMIT`, `TABLE`, `NEWS_LIST_URL`, `NEWS_DETAIL_URL`, `NEXON_BASE`

**Private/module-level singletons:** prefixed with underscore — `_client` (used in both `src/db.js` and `src/ocr.js`)

**Variables:** `camelCase` — `newItems`, `existingIds`, `bodyUrls`, `event_period` (exception: DB row fields use `snake_case` to match Supabase column names)

### Code Style Observations

**JSDoc comments on every exported function.** All public functions in `src/` have `@param` and `@returns` annotations.

**Inline comments** are used for non-obvious logic (e.g., explaining API response shape normalization, regex pattern intent, relative URL handling).

**Lazy singleton pattern** for expensive clients (Supabase, Google Vision):
```js
let _client = null;
function getClient() {
  if (_client) return _client;
  _client = createClient(url, key);
  return _client;
}
```

**Guard clauses** at function entry to avoid deep nesting:
```js
if (!ids.length) return new Set();
if (!rows.length) { console.log(...); return; }
if (!bodyHtml) return [];
if (!text) return null;
```

**Nullish coalescing** used throughout for safe defaults: `data.items ?? data.data ?? []`, `detail.name ?? detail.title ?? ''`, `annotations[0]?.description ?? ''`

**Log prefix pattern:** every `console.log` and `console.error` call is prefixed with the module name in brackets: `[main]`, `[fetcher]`, `[db]`, `[ocr]`.

### Constants Placement

Module-level constants are declared at the top of each file. Pipeline-wide constants (`THROTTLE_MS`, `OCR_LIMIT`) are declared at the top of `index.js` and are not exported — they are not shared across modules.

## Notes

- No linter config (`.eslintrc`, `biome.json`, etc.) is present. Code style is consistent but unenforced by tooling.
- No formatter config (`.prettierrc`, etc.) is present.
- `snake_case` is used for DB row field names (`event_period`, `image_url`) to match Supabase column conventions, which is an intentional exception to the otherwise camelCase variable naming.
- The `.npmrc` file exists but its contents should not be read (may contain auth tokens).
