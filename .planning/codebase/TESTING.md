# Testing Patterns

## Summary

There are no automated tests in this codebase. No test framework, test files, or test configuration exist. Verification is done entirely by running the pipeline end-to-end and inspecting console output and Supabase records.

## Details

### Test Framework

**None.** No `jest`, `vitest`, `mocha`, or any other test runner is installed or configured.

- `package.json` has no `test` script
- No `jest.config.*`, `vitest.config.*`, or similar config files are present
- No `*.test.js`, `*.spec.js`, or `__tests__/` directories exist
- `coverage/` is listed in `.gitignore` (placeholder), but no coverage tooling is set up

### Test Files

No test files of any kind exist in the project.

### Manual Verification Approach

The pipeline can be verified manually by running:

```bash
pnpm run dev
# or
node index.js
```

**What to look for in console output:**

| Log line | What it confirms |
|---|---|
| `[fetcher] Fetched N news items, M events (top 10)` | Nexon API is reachable and returning events |
| `[db] X of Y ids already exist in DB` | Supabase connection works; deduplication is running |
| `[main] N new item(s) to process` | New events were found and will be processed |
| `[ocr] Running OCR on: <url>` | Google Vision API is being called |
| `[main] id=X → period="..."` | OCR + regex parsing succeeded for an event |
| `[main] id=X → period="not found"` | OCR ran but regex found no date range in that event's images |
| `[main] Done.` | Full pipeline completed without a fatal error |

After a run, verify results by querying the `events` table in Supabase directly.

### What Is Tested

**Nothing is automatically tested.** The codebase has no test coverage.

### Testable Units (Untested)

The following functions have no side effects and are straightforward to unit test if a framework were added:

**`extractBodyImageUrls(bodyHtml)`** in `src/parser.js`
- Parses `<img src>` from HTML string
- Handles relative vs absolute URLs
- Returns `[]` on empty input
- Pure function — no dependencies, no I/O

**`parseEventPeriod(text)`** in `src/parser.js`
- Applies a regex against OCR text
- Returns matched string or `null`
- Pure function — no dependencies, no I/O
- The regex is complex and handles OCR noise (variable whitespace, line breaks) — high value target for unit tests

**`sleep(ms)`** in `src/fetcher.js`
- Trivial Promise wrapper — low test priority

### Untested Integration Points

| Area | File | Risk |
|---|---|---|
| Nexon API response shape normalization (`data.items ?? data.data ?? []`) | `src/fetcher.js` | If API shape changes, events silently become 0 |
| Supabase upsert conflict resolution | `src/db.js` | Incorrect `onConflict` key would create duplicate rows |
| Google Vision `textAnnotations[0].description` path | `src/ocr.js` | API version change could shift response shape |
| OCR early-break logic | `index.js` | If `parseEventPeriod` returns a false positive, remaining images are skipped unnecessarily |

### How to Add Tests

If tests were to be added, the recommended approach given the existing stack:

1. Install `vitest` (ESM-native, no extra config needed for `"type": "module"` projects):
   ```bash
   pnpm add -D vitest
   ```

2. Add a `test` script to `package.json`:
   ```json
   "scripts": {
     "test": "vitest run",
     "test:watch": "vitest"
   }
   ```

3. Create test files co-located with source or in a `src/__tests__/` directory:
   - `src/__tests__/parser.test.js` — unit tests for `extractBodyImageUrls` and `parseEventPeriod` (no mocking needed)
   - `src/__tests__/fetcher.test.js` — tests for `fetchNewsList`/`fetchEventDetail` with mocked `fetch`
   - `src/__tests__/db.test.js` — tests for `getExistingIds`/`upsertEvents` with mocked Supabase client

4. Start with `src/parser.js` — both functions are pure and cover the most fragile logic (regex parsing of OCR output).

## Notes

- The `parseEventPeriod` regex in `src/parser.js` is the highest-value test target in the codebase. It handles OCR noise and date format variations and currently has zero coverage.
- The `.gitignore` includes `/coverage` — this was likely added proactively when the project was scaffolded, not because coverage was ever generated.
- No CI pipeline exists to run tests automatically even if they were written.
