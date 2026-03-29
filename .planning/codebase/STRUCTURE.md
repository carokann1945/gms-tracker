# Codebase Structure

_Last updated: 2026-03-30_

## Directory Layout

```
gms-tracker/
├── index.js                  # Pipeline orchestrator — sole entry point
├── package.json              # ESM config ("type":"module"), pnpm run dev, deps
├── pnpm-lock.yaml            # Lockfile (committed)
├── Dockerfile                # node:24-slim image, prod-only install, CMD node index.js
├── .env                      # Runtime secrets (gitignored)
├── .env.example              # Template: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_APPLICATION_CREDENTIALS
├── .gitignore                # Excludes .env, google-credentials.json, node_modules, .claude/
├── .npmrc                    # pnpm config
├── .claudeignore             # Files excluded from Claude context
├── google-credentials.json   # GCP service account key (gitignored)
├── CLAUDE.md                 # Project instructions for Claude Code
├── src/
│   ├── fetcher.js            # Nexon CMS API + KMS scraper + sleep()
│   ├── parser.js             # Stateless HTML/text utilities (no I/O)
│   ├── ai.js                 # OpenAI wrapper — event period extraction
│   ├── matcher.js            # OpenAI wrapper — GMS→KMS URL matching
│   ├── ocr.js                # Google Cloud Vision wrapper — OCR
│   └── db.js                 # Supabase wrapper — read/write events table
├── node_modules/             # Managed by pnpm (gitignored)
└── .planning/
    ├── PROJECT.md
    ├── REQUIREMENTS.md
    ├── ROADMAP.md
    ├── STATE.md
    ├── config.json
    ├── phases/               # Per-phase plan and summary files
    └── codebase/             # GSD mapper output documents
```

---

## Directory Purposes

**Root (`/`):**
- Purpose: Entry point and all project configuration
- Contains: `index.js` orchestrator, manifests, Docker config, env templates, credential file
- Key files: `index.js` (the only file you ever run)

**`src/`:**
- Purpose: All business logic, one file per external-service or parsing boundary
- Contains: Six `.js` ES Module files
- Module system: ES Modules (`import`/`export`), enabled by `"type": "module"` in `package.json`
- No subdirectories; no `src/` module imports another `src/` module

**`.planning/`:**
- Purpose: GSD tooling — project planning docs and codebase analysis
- Not referenced by any application code
- Committed to git

---

## Key File Locations

**Entry Point:**
- `/home/carokann/projects/gms-tracker/index.js`
  - Defines `main()` which runs all 8 pipeline stages sequentially
  - Defines constants `THROTTLE_MS = 500` and `OCR_LIMIT = 2`
  - Top-level `.catch()` calls `process.exit(1)` on fatal error

**Source Modules:**
- `/home/carokann/projects/gms-tracker/src/fetcher.js`
  - Exports: `fetchNewsList`, `fetchEventDetail`, `fetchKmsEventList`, `sleep`
  - Uses Node.js built-in `fetch`; `cheerio` for KMS HTML parsing
- `/home/carokann/projects/gms-tracker/src/parser.js`
  - Exports: `extractBodyText`, `extractBodyImageUrls`, `buildGmsUrl`
  - Pure functions, no I/O, no async
- `/home/carokann/projects/gms-tracker/src/ai.js`
  - Exports: `extractEventPeriodWithAI`
  - OpenAI singleton; `gpt-4o-mini`, `temperature: 0`, `max_tokens: 100`
- `/home/carokann/projects/gms-tracker/src/matcher.js`
  - Exports: `findKmsUrl`
  - OpenAI; two sequential `gpt-4o-mini` calls (translate + match)
- `/home/carokann/projects/gms-tracker/src/ocr.js`
  - Exports: `extractTextFromImage`
  - Google Cloud Vision singleton via `GOOGLE_APPLICATION_CREDENTIALS` env var
- `/home/carokann/projects/gms-tracker/src/db.js`
  - Exports: `getExistingIds`, `getMaxSourceIndex`, `upsertEvents`
  - Supabase singleton; target table: `events`

**Configuration:**
- `/home/carokann/projects/gms-tracker/package.json` — declares `"type": "module"`, `"dev": "node index.js"`, all five dependencies
- `/home/carokann/projects/gms-tracker/.env.example` — documents the three required env vars
- `/home/carokann/projects/gms-tracker/Dockerfile` — production container definition

---

## Module Boundaries

Each `src/` module maps to exactly one external service or concern:

| File | Boundary | Exports |
|---|---|---|
| `src/fetcher.js` | Nexon CMS REST API + KMS HTML scraping | `fetchNewsList`, `fetchEventDetail`, `fetchKmsEventList`, `sleep` |
| `src/parser.js` | Pure HTML/text parsing (no I/O) | `extractBodyText`, `extractBodyImageUrls`, `buildGmsUrl` |
| `src/ai.js` | OpenAI API — date extraction | `extractEventPeriodWithAI` |
| `src/matcher.js` | OpenAI API — KMS URL matching | `findKmsUrl` |
| `src/ocr.js` | Google Cloud Vision API | `extractTextFromImage` |
| `src/db.js` | Supabase (PostgreSQL) | `getExistingIds`, `getMaxSourceIndex`, `upsertEvents` |

`index.js` imports from all six modules; no `src/` module imports from another `src/` module.

---

## Naming Conventions

**Files:**
- `camelCase.js` for all source modules: `fetcher.js`, `parser.js`, `matcher.js`
- Named after the service or operation, single responsibility per file

**Functions:**
- Verb-noun pattern: `fetchNewsList`, `fetchEventDetail`, `getExistingIds`, `upsertEvents`, `extractTextFromImage`, `extractBodyImageUrls`, `buildGmsUrl`, `findKmsUrl`
- Private helpers use underscore prefix: `_client`, `fetchKmsPage`, `parseOngoingEvents`, `parseClosedEvents`

**Variables:**
- `SCREAMING_SNAKE_CASE` for module-level constants: `NEWS_LIST_URL`, `TABLE`, `THROTTLE_MS`, `OCR_LIMIT`, `NEXON_BASE`
- `camelCase` for local variables and function parameters

---

## Where to Add New Code

**New external service integration:**
- Create `/home/carokann/projects/gms-tracker/src/{serviceName}.js`
- Follow the lazy-singleton `getClient()` pattern from `src/db.js` or `src/ocr.js`
- Export named async functions
- Import and call from `index.js` at the appropriate stage in `main()`

**New parsing or transformation logic (no I/O):**
- Add to `/home/carokann/projects/gms-tracker/src/parser.js` as a new named export
- Keep functions pure (no side effects, no network calls)

**New pipeline step:**
- Add inside `main()` in `index.js` at the correct sequence position
- Define any new limits/thresholds as constants at the top of `index.js` alongside `THROTTLE_MS` and `OCR_LIMIT`

**New environment variable:**
- Read via `process.env.VAR_NAME` at the point of use in the relevant module
- Add a placeholder entry to `.env.example`
- No central config module exists; env vars are read at call time

**Tests (not currently present):**
- Would go in `/home/carokann/projects/gms-tracker/tests/` or co-located as `src/parser.test.js`
- `src/parser.js` is the best first target (pure functions, no I/O, no mocking needed)

---

## Special Files

**`google-credentials.json` (root):**
- GCP service account JSON key
- Listed in `.gitignore` — must not be committed
- Path is referenced by `GOOGLE_APPLICATION_CREDENTIALS` env var
- Required at runtime for `src/ocr.js`

**`.env` (root):**
- Runtime secrets; gitignored
- Required for Supabase and (indirectly) Google Vision connections

**`Dockerfile` (root):**
- Builds `node:24-slim` image
- Copies `package.json` + `pnpm-lock.yaml` first for layer cache efficiency
- Installs production-only dependencies: `pnpm install --frozen-lockfile --prod`
- `CMD ["node", "index.js"]` — one-shot execution, container exits after pipeline completes

**`pnpm-lock.yaml` (root):**
- Committed lockfile; use `pnpm install --frozen-lockfile` in CI/Docker to ensure reproducible installs

---

*Structure analysis: 2026-03-30*
