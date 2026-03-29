# Testing Patterns

_Last updated: 2026-03-30_

## Test Framework

**None.** No test runner, assertion library, or coverage tool is installed or configured.

- `package.json` has no `test` script and no test-related `devDependencies`
- No `jest.config.*`, `vitest.config.*`, `mocha`, or similar config files exist
- `/coverage` is listed in `.gitignore` as a placeholder, but no coverage tooling is set up
- No CI pipeline exists to run tests automatically (GitHub Actions workflow file was deleted per commit history)

## Test Files

No test files exist anywhere in the project. Glob search for `*.test.*` and `*.spec.*` returns zero results in the project source.

## Run Commands

```bash
# No test command exists. The only runnable script is:
pnpm run dev    # executes the full pipeline via node index.js
```

## Manual Verification Approach

The pipeline is verified by running it end-to-end and inspecting console output and the Supabase `events` table:

```bash
node index.js
```

| Log line | What it confirms |
|---|---|
| `[fetcher] Fetched N news items, M events (top 10)` | Nexon API is reachable |
| `[db] X of Y ids already exist in DB` | Supabase connection works; dedup running |
| `[main] N new item(s) to process` | New events were found |
| `[ocr] Running OCR on: <url>` | Google Vision API is being called |
| `[main] id=X → period="..."` | AI extraction succeeded for an event |
| `[main] id=X → period="not found"` | All extraction layers failed for an event |
| `[db] Upserted N rows` | Data was written to Supabase |
| `[main] Done.` | Full pipeline completed without a fatal error |

## Test Coverage Gaps

### High Priority — Pure Functions with Complex Logic

**`extractBodyText(bodyHtml)`** in `src/parser.js`
- Strips HTML and collapses whitespace from Nexon event bodies
- Pure function, no dependencies, no I/O
- Risk: whitespace normalization edge cases could cause AI to miss date strings

**`extractBodyImageUrls(bodyHtml)`** in `src/parser.js`
- Extracts `<img src>` values and resolves relative URLs against `https://g.nexonstatic.com`
- Pure function, no dependencies, no I/O
- Risk: relative URL construction has manual string logic that could silently produce broken URLs

**`buildGmsUrl(id, name)`** in `src/parser.js`
- Converts event names to URL slugs via regex chain
- Pure function, no dependencies
- Risk: character stripping regex has several chained replacements — edge cases (Unicode, all-symbol names) are untested

### High Priority — Response Shape Assumptions

**`fetchNewsList()`** in `src/fetcher.js`
- Normalises API response with `Array.isArray(data) ? data : (data.items ?? data.data ?? [])`
- If Nexon changes their API response envelope, events silently become `[]` with no error

**`fetchEventDetail(id)`** in `src/fetcher.js`
- Returns raw API object; callers access `detail.name ?? detail.title ?? ''` and `detail.imageThumbnail`
- Shape is undocumented — field renames would produce silent `undefined` data in DB

### Medium Priority — AI Result Parsing

**`extractEventPeriodWithAI(text)`** in `src/ai.js`
- GPT response is accepted as-is if it does not equal `"not found"`
- No format validation — a malformed GPT response (e.g. extra prose) is stored verbatim in `event_period`

**`findKmsUrl(gmsEventName, kmsList)`** in `src/matcher.js`
- GPT can return `"id=1301"` or prose; `matchResult.match(/\d+/)?.[0]` extracts the first digit sequence
- Risk: ambiguous GPT output could match the wrong numeric ID

### Low Priority — Singleton Clients

**`getClient()`** in `src/db.js` and `src/ocr.js`
- Lazy singleton pattern initialises on first call
- Missing env vars throw at runtime — could be caught in a startup validation test

## Testable Units (If Tests Were Added)

The pure functions in `src/parser.js` have zero external dependencies and can be unit tested without any mocking:

```js
// Hypothetical test structure (vitest syntax)
import { extractBodyImageUrls, buildGmsUrl, extractBodyText } from '../src/parser.js';

describe('extractBodyImageUrls', () => {
  it('returns absolute URLs unchanged', () => { ... });
  it('prepends NEXON_BASE to relative paths', () => { ... });
  it('returns [] for empty input', () => { ... });
});

describe('buildGmsUrl', () => {
  it('slugifies event name and includes id', () => { ... });
  it('collapses multiple spaces and hyphens', () => { ... });
});
```

Functions requiring mocking (`fetchNewsList`, `getExistingIds`, `upsertEvents`, `extractTextFromImage`, `extractEventPeriodWithAI`) would need their external clients (native `fetch`, Supabase client, GCP Vision client, OpenAI client) replaced with test doubles.

## How to Add Tests

If tests are to be added, the recommended setup for this ESM project:

1. Install vitest (ESM-native, zero config for `"type": "module"` projects):
   ```bash
   pnpm add -D vitest
   ```

2. Add scripts to `package.json`:
   ```json
   "scripts": {
     "test": "vitest run",
     "test:watch": "vitest",
     "test:coverage": "vitest run --coverage"
   }
   ```

3. Create test files co-located or under `src/__tests__/`:
   - `src/__tests__/parser.test.js` — unit tests for `extractBodyImageUrls`, `extractBodyText`, `buildGmsUrl` (no mocking needed; highest priority)
   - `src/__tests__/fetcher.test.js` — tests for `fetchNewsList`/`fetchEventDetail` with mocked global `fetch`
   - `src/__tests__/db.test.js` — tests for `getExistingIds`/`upsertEvents` with mocked Supabase client
   - `src/__tests__/ai.test.js` — tests for `extractEventPeriodWithAI` with mocked OpenAI client

4. Start with `src/parser.js` — all three functions are pure, cover real slug/URL logic, and require no test infrastructure.

---

_Testing analysis: 2026-03-30_
