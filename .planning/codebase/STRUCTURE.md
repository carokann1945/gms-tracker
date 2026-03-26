# Codebase Structure

**Analysis Date:** 2026-03-26

## Summary

A flat, minimal Node.js project with a single entry point at the root and four focused source modules under `src/`. There are no subdirectories within `src/`.

## Details

### Directory Layout

```
gms-tracker/
├── index.js                  # Pipeline orchestrator — main entry point
├── package.json              # Project metadata, ESM config, dependencies
├── pnpm-lock.yaml            # Lockfile (committed)
├── .env                      # Runtime secrets (gitignored)
├── .env.example              # Template showing required env var names
├── .gitignore                # Excludes .env, credentials, node_modules
├── .npmrc                    # pnpm config
├── google-credentials.json   # GCP service account key (gitignored)
├── CLAUDE.md                 # Project instructions for Claude Code
├── src/
│   ├── fetcher.js            # Nexon CMS API client + sleep utility
│   ├── db.js                 # Supabase client (read + write)
│   ├── ocr.js                # Google Cloud Vision OCR wrapper
│   └── parser.js             # HTML image extractor + date regex parser
├── node_modules/             # Installed dependencies (gitignored)
└── .planning/
    └── codebase/             # GSD analysis documents
```

---

### Directory Purposes

**Root (`/`):**
- Purpose: Entry point and project configuration
- Contains: `index.js` orchestrator, `package.json`, lockfile, env files, credential file
- Key files: `index.js` (run this to execute the pipeline)

**`src/`:**
- Purpose: All business logic, split by external service boundary
- Contains: Four `.js` modules, one per integration or parsing concern
- Key files: `fetcher.js`, `db.js`, `ocr.js`, `parser.js`
- Module system: ES Modules (`import`/`export`), enabled by `"type": "module"` in `package.json`

**`.planning/codebase/`:**
- Purpose: GSD mapper output — architecture and convention reference documents
- Generated: Yes (by GSD mapper agent)
- Committed: Yes

---

### Key File Locations

**Entry Point:**
- `/home/carokann/projects/gms-tracker/index.js`: Full pipeline orchestrator, defines `main()`, constants `THROTTLE_MS` and `OCR_LIMIT`

**Source Modules:**
- `/home/carokann/projects/gms-tracker/src/fetcher.js`: Nexon API calls and `sleep()` helper
- `/home/carokann/projects/gms-tracker/src/db.js`: Supabase `getExistingIds` and `upsertEvents`
- `/home/carokann/projects/gms-tracker/src/ocr.js`: Google Vision `extractTextFromImage`
- `/home/carokann/projects/gms-tracker/src/parser.js`: `extractBodyImageUrls` and `parseEventPeriod`

**Configuration:**
- `/home/carokann/projects/gms-tracker/package.json`: Declares `"type": "module"`, `pnpm run dev` script, three dependencies
- `/home/carokann/projects/gms-tracker/.env.example`: Documents the three required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`)

---

### Module Boundaries

Each `src/` module maps to exactly one external service or concern:

| File | Boundary | Exports |
|---|---|---|
| `src/fetcher.js` | Nexon CMS API (HTTP) | `fetchNewsList`, `fetchEventDetail`, `sleep` |
| `src/db.js` | Supabase (PostgreSQL) | `getExistingIds`, `upsertEvents` |
| `src/ocr.js` | Google Cloud Vision API | `extractTextFromImage` |
| `src/parser.js` | Pure text/HTML parsing (no I/O) | `extractBodyImageUrls`, `parseEventPeriod` |

`index.js` imports from all four and owns the orchestration. No `src/` module imports from another `src/` module.

---

### Naming Conventions

**Files:**
- `camelCase.js` for source modules: `fetcher.js`, `parser.js`
- Single responsibility per file, named after the service or operation

**Functions:**
- Verb-noun pattern: `fetchNewsList`, `fetchEventDetail`, `getExistingIds`, `upsertEvents`, `extractTextFromImage`, `extractBodyImageUrls`, `parseEventPeriod`
- Private helpers use underscore-prefixed variables: `_client`

**Variables:**
- `SCREAMING_SNAKE_CASE` for module-level constants: `NEWS_LIST_URL`, `TABLE`, `THROTTLE_MS`, `OCR_LIMIT`
- `camelCase` for local variables

---

### Where to Add New Code

**New external service integration:**
- Create `src/{serviceName}.js` following the lazy-singleton pattern in `src/db.js` or `src/ocr.js`
- Export named async functions
- Import and call from `index.js`

**New parsing/transformation logic:**
- Add to `src/parser.js` if it is pure text/HTML manipulation with no I/O
- Export as a named function

**New pipeline step:**
- Add the step inside `main()` in `index.js` in sequence order
- Keep constants (`THROTTLE_MS`, limits) at the top of `index.js`

**New configuration values:**
- Add to `.env.example` with a placeholder value
- Read via `process.env.VAR_NAME` at the point of use (no central config module exists)

**Tests (not currently present):**
- Would conventionally go in a `tests/` or `__tests__/` directory at root, or co-located as `src/parser.test.js`
- `src/parser.js` is the best candidate for unit tests (pure functions, no I/O)

---

### Special Directories / Files

**`google-credentials.json` (root):**
- GCP service account JSON key
- Listed in `.gitignore` — must not be committed
- Referenced by `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to its absolute path

**`.env` (root):**
- Runtime secrets file
- Listed in `.gitignore`
- Required for all three external service connections

**`node_modules/` (root):**
- Managed by `pnpm`
- Gitignored
- Contains: `@google-cloud/vision`, `@supabase/supabase-js`, `dotenv`

## Notes

- There is no `src/utils.js` or shared helper module. The `sleep()` function lives in `src/fetcher.js` despite being a general utility; if the project grows, extracting it to a dedicated utils module would improve clarity.
- No `tests/` directory exists. The project has zero test files.
- No `config/` directory; configuration is entirely handled by environment variables loaded via `dotenv` at process start (`import 'dotenv/config'` in `index.js`).
- The `.planning/` directory is not referenced by any application code and is purely for GSD tooling.
