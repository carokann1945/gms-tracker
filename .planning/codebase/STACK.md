# Technology Stack

_Last updated: 2026-03-30_

## Languages

**Primary:**
- JavaScript (ES2022+) — all source files in `src/` and `index.js`
- Module system: ES Modules (`"type": "module"` in `package.json`) — all files use `import`/`export`

**No TypeScript** — no `tsconfig.json` or `.ts` files. JSDoc annotations used for type hints only.

## Runtime

**Environment:**
- Node.js 24 (production base image in `Dockerfile`: `node:24-slim`)
- Node.js v18+ minimum (required for native `fetch` API, per `CLAUDE.md`)
- No `.nvmrc` or `.node-version` file present

**Built-in APIs used:**
- `fetch` (Node 18+ native — no `node-fetch` polyfill)
- `setTimeout` (wrapped in `sleep()` utility in `src/fetcher.js`)

## Package Manager

**Tool:** `pnpm` (activated via `corepack` in Docker: `corepack enable && corepack prepare pnpm@latest --activate`)
- Lockfile: `pnpm-lock.yaml` — present and committed
- Install command: `pnpm install`
- Docker install flags: `--frozen-lockfile --prod` (reproducible, production-only)
- Notable config: `.npmrc` sets `approve-builds[]=protobufjs` — required because `@google-cloud/vision` depends on `protobufjs` and pnpm's security defaults block install-time build scripts

## Frameworks

**Core:**
- None — plain Node.js pipeline script. No web framework (no Express, Fastify, Hono, etc.)
- Execution model: single-run process (`node index.js`), not a persistent server

**Build/Dev:**
- No build step — source runs directly without transpilation
- No transpiler (Babel, esbuild, tsc, etc.)
- No hot-reload tooling (nodemon, tsx, etc.)

**Testing:**
- No test framework — no `jest.config.*`, `vitest.config.*`, or `*.test.js` / `*.spec.js` files

## Key Dependencies

All dependencies are production-only — no `devDependencies` block in `package.json`.

| Package | Specifier | Resolved | Purpose |
|---|---|---|---|
| `openai` | `^6.33.0` | latest compatible | OpenAI GPT-4o-mini client — event period extraction (`src/ai.js`) and KMS name translation + matching (`src/matcher.js`) |
| `@google-cloud/vision` | `^4.3.2` | `4.3.3` | Google Cloud Vision `ImageAnnotatorClient` — OCR text extraction from event images (`src/ocr.js`) |
| `@supabase/supabase-js` | `^2.49.4` | `2.100.0` | Supabase JS client — DB idempotency checks and upsert (`src/db.js`) |
| `cheerio` | `^1.2.0` | latest compatible | Server-side HTML parsing — body text extraction and KMS page scraping (`src/parser.js`, `src/fetcher.js`) |
| `dotenv` | `^16.4.7` | `16.6.1` | Loads `.env` file into `process.env` at startup — imported as `'dotenv/config'` in `index.js` |

## Configuration

**Environment:**
- Loaded via `import 'dotenv/config'` at top of `index.js`
- `.env` file required at project root (gitignored — listed in `.gitignore`)
- No `.env.example` file detected to document required variables

**Required env vars (inferred from source):**

| Variable | Consumed by | Notes |
|---|---|---|
| `SUPABASE_URL` | `src/db.js:getClient()` | Throws at runtime if absent |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/db.js:getClient()` | Throws at runtime if absent; bypasses RLS |
| `OPENAI_API_KEY` | `src/ai.js`, `src/matcher.js` | Passed directly to `new OpenAI({ apiKey })` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `src/ocr.js` | Absolute path to GCP service account JSON; consumed automatically by GCP SDK (Application Default Credentials) |

**GCP credentials file:**
- `google-credentials.json` — service account key, present at project root, gitignored

**Runtime constants** (defined in `index.js`):

| Constant | Value | Purpose |
|---|---|---|
| `THROTTLE_MS` | `500` | Minimum delay (ms) between Nexon detail API calls |
| `OCR_LIMIT` | `2` | Max images per event post sent to Vision API |

**Build:**
- `Dockerfile` — only containerisation artifact; no separate build config files
- No `.dockerignore` detected

## Platform Requirements

**Development:**
- WSL2 Ubuntu (per `CLAUDE.md`)
- Node.js v18+
- `pnpm` (install via `corepack enable`)
- `.env` file with all four required vars
- `google-credentials.json` GCP service account key at project root (path set in `GOOGLE_APPLICATION_CREDENTIALS`)

**Production:**
- Docker container from `Dockerfile` (`node:24-slim`)
- Entry command: `node index.js`
- All secrets injected at container runtime as environment variables
- No HTTP server, no exposed ports — designed to be invoked by an external scheduler (cron, CI, cloud scheduler)

---

_Stack analysis: 2026-03-30_
