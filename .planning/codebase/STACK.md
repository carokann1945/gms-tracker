# Technology Stack

## Summary

Node.js automation pipeline using ES Modules, managed with pnpm. No build step — runs directly with `node index.js`. Three production dependencies cover database, OCR, and environment configuration.

## Details

### Runtime

- **Node.js**: v24.14.0 (required: v18+ for native `fetch` API)
- **Module system**: ES Modules (`"type": "module"` in `package.json`) — all files use `import`/`export`

### Package Manager

- **pnpm**: v10.32.1
- Lockfile: `pnpm-lock.yaml` (lockfileVersion `9.0`) — present and committed
- Notable config: `.npmrc` sets `approve-builds[]=protobufjs` (required for `@google-cloud/vision` native build step)

### Scripts

| Command | What it does |
|---------|-------------|
| `pnpm run dev` | Runs `node index.js` — main pipeline entry point |
| `pnpm install` | Installs all dependencies |

No build, compile, lint, or test scripts are defined.

### Dependencies

| Package | Resolved Version | Purpose |
|---------|-----------------|---------|
| `@google-cloud/vision` | `4.3.3` | Google Cloud Vision API SDK — used in `src/ocr.js` for `textDetection()` OCR calls |
| `@supabase/supabase-js` | `2.100.0` | Supabase JS client — used in `src/db.js` for `select`, `upsert` operations |
| `dotenv` | `16.6.1` | Loads `.env` file into `process.env` at startup via `import 'dotenv/config'` in `index.js` |

No dev dependencies. No test framework. No linter or formatter configured.

### Environment Variables

Defined in `.env` (gitignored). Template in `.env.example`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key — full DB access |
| `GOOGLE_APPLICATION_CREDENTIALS` | Yes | Absolute path to GCP service account JSON key file |

The Supabase client in `src/db.js` throws immediately at runtime if either `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing. The Google Vision client in `src/ocr.js` reads `GOOGLE_APPLICATION_CREDENTIALS` automatically via the GCP SDK's Application Default Credentials mechanism.

### Key Constants (runtime config)

Defined in `index.js`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `THROTTLE_MS` | `500` | Minimum delay (ms) between Nexon detail API calls |
| `OCR_LIMIT` | `2` | Max images per event post to send to Vision API |

### File Structure

```
gms-tracker/
├── index.js              # Entry point — orchestrates the full pipeline
├── src/
│   ├── fetcher.js        # Nexon CMS API calls (list + detail) and sleep utility
│   ├── db.js             # Supabase client, getExistingIds(), upsertEvents()
│   ├── ocr.js            # Google Vision client, extractTextFromImage()
│   └── parser.js         # HTML image URL extraction, event period regex parsing
├── package.json
├── pnpm-lock.yaml
├── .npmrc
├── .env.example
└── google-credentials.json  # GCP service account key (gitignored)
```

## Notes

- No TypeScript — plain JavaScript with JSDoc annotations for type hints.
- No test framework is present. There are no `*.test.js` or `*.spec.js` files.
- `google-credentials.json` exists at project root and is gitignored. `GOOGLE_APPLICATION_CREDENTIALS` in `.env` must point to its absolute path.
- The `protobufjs` build approval in `.npmrc` is required because `@google-cloud/vision` depends on it and pnpm's security defaults block install-time build scripts.
- `@supabase/supabase-js` resolved to `2.100.0` despite `^2.49.4` specifier — the lockfile pins this resolved version.

---

*Stack analysis: 2026-03-26*
