# Concerns

**Analysis Date:** 2026-03-26

## Summary

A small, single-entry-point pipeline (`index.js`) that is broadly well-structured for a personal automation project, but carries several production-readiness gaps: credential files live beside source code with only `.gitignore` as the safety net, error handling lets failures silently drop data, and the OCR date-parsing regex is brittle against real-world OCR output variation.

---

## Security

**`google-credentials.json` stored in project root — .gitignore only:**
- The GCP service account key file is present at `/home/carokann/projects/gms-tracker/google-credentials.json` (2,335 bytes).
- It is listed in `.gitignore` (line 10) and is NOT currently committed, but it sits beside `index.js` in the working tree.
- Risk: a single `git add .` mistake, a misconfigured git hook, or a future collaborator cloning and re-adding the file would expose the key in git history.
- Recommendation: move the file outside the project directory entirely (e.g., `~/.config/gcp/`) and point `GOOGLE_APPLICATION_CREDENTIALS` at that path, or use Workload Identity / Secret Manager.

**`SUPABASE_SERVICE_ROLE_KEY` used instead of anon key:**
- `src/db.js` line 11 uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses Row Level Security entirely).
- For a server-side-only script run on a trusted machine this is acceptable, but any accidental exposure of the key grants full database access with no RLS protection.
- The `.env` file is also gitignored (confirmed not committed), but the same "one bad commit" risk applies.

**No validation of image URLs before passing to Google Vision:**
- `src/ocr.js` line 22 passes `imageUrl` directly to `client.textDetection(imageUrl)` without sanitizing or validating that the URL is a Nexon CDN domain.
- If the upstream API were ever compromised and returned a crafted URL, arbitrary URLs would be sent to the Vision API at the project's billing cost.

---

## Reliability

**`fetchNewsList` throws on failure — kills the entire run:**
- `src/fetcher.js` lines 29-32: the catch block re-throws the error.
- `index.js` line 71 catches it at the top level and calls `process.exit(1)`.
- If the Nexon list API is temporarily unavailable, the run aborts with no retry. For a scheduled job (cron/Cloud Scheduler) this means silent skips until the next scheduled run.

**`fetchEventDetail` silently returns `null` on failure:**
- `src/fetcher.js` lines 49-51: the catch returns `null`, and `index.js` line 35 filters it out.
- A 429 rate-limit or 5xx error on a detail call causes that event to be permanently skipped (it will appear in `existingIds` on the next run because it was in `top10` — wait, it won't, because it was never upserted). Actually the item is simply dropped silently with no log of how many were dropped vs processed.
- The log on line 28 says "N new items to process" but there is no final count of how many were actually upserted vs dropped due to detail-fetch failures.

**`getExistingIds` throws on DB failure — kills the entire run:**
- `src/db.js` lines 43-44: the catch re-throws.
- A Supabase outage or misconfigured credentials causes the process to exit(1) immediately after the list fetch, meaning 0 items are processed even if most detail APIs would succeed.

**OCR failures degrade silently to `null` event_period:**
- `src/ocr.js` lines 25-28: Vision API failures return `''`, which causes `parseEventPeriod` to return `null`.
- There is no distinction in the DB or logs between "no date found in image" and "OCR call failed" — both are recorded as `event_period = null`.

**No retry logic anywhere:**
- Transient network errors (DNS blip, timeout, 503) on any of the three external services (Nexon API, Supabase, Google Vision) cause either a silent null or a full abort, with no exponential backoff or retry.

---

## Scalability

**Hard-coded `top10` limit may miss events during backfill:**
- `src/fetcher.js` line 25: `.slice(0, 10)` is applied before the DB dedup check.
- If more than 10 new events are published simultaneously (e.g., maintenance patch with many events), only the top 10 are ever considered; the rest are invisible to the pipeline.

**Sequential OCR with no concurrency:**
- `index.js` lines 49-52: each OCR call is `await`ed serially inside a `for` loop.
- At scale (many new events), this is slow. Each Vision API call adds latency before the next event is processed. Not a problem today with max 10 events, but would matter with larger windows.

**Single-process, single-run design:**
- The script has no locking mechanism. Running two instances simultaneously (e.g., overlapping cron executions) could both see the same `existingIds` snapshot and attempt to upsert the same rows. The upsert is idempotent on the DB side, but OCR API calls would be duplicated and billed twice.

---

## Technical Debt

**`parser.js` regex is brittle against OCR noise:**
- `src/parser.js` lines 42-43: the regex `(\d{1,2}\/\d{1,2}\/\d{4})\s*\([A-Za-z]{3}\)[\s\S]*?-\s*...` expects a specific `M/D/YYYY (DDD)` date format with an ASCII hyphen as range separator.
- OCR frequently produces: en-dashes (`–`) or em-dashes (`—`) instead of hyphens, misread digits (`l` for `1`, `O` for `0`), and extra line breaks mid-date.
- The `[\s\S]*?` between the first date and the hyphen is non-greedy but unbounded — a very long body of text between two dates could produce unexpected matches.

**Field name assumptions on detail API response are fragile:**
- `index.js` line 59: `detail.name ?? detail.title ?? ''` — two possible field names are tried without documentation.
- `index.js` line 60: `detail.imageThumbnail ?? null` — single field name assumed with no fallback.
- If the Nexon API changes field names (e.g., `thumbnailUrl`), `image_url` will silently become `null` for all new events with no error or warning.

**No schema validation on API responses:**
- Neither `fetchNewsList` nor `fetchEventDetail` validates the shape of the returned JSON beyond checking `res.ok`.
- A Nexon API change (new response envelope, renamed `items` key) would cause the filter to silently return 0 events. The comment on `src/fetcher.js` line 21 (`// API 응답 구조에 따라 items 배열 추출`) acknowledges this uncertainty.

**`db.js` uses `SUPABASE_SERVICE_ROLE_KEY` env var name — no startup validation:**
- The `getClient()` function in `src/db.js` only validates env vars at first call, not at startup.
- If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, the error surfaces mid-pipeline (after the Nexon API and detail calls have already run), wasting throttle time.

**No tests:**
- Zero test files in the project. `parseEventPeriod` in `src/parser.js` is the most logic-dense function and the most likely to silently fail on new OCR output formats, but it has no unit tests.

**`package.json` has no `start` script, only `dev`:**
- `package.json` line 6: only `"dev": "node index.js"` is defined.
- In production (cron job, Cloud Run job), `pnpm run dev` is a misleading command name for a scheduled production task.

---

## Notes

**`google-credentials.json` filename is hardcoded nowhere — uses env var correctly:**
- The file path is referenced only via `GOOGLE_APPLICATION_CREDENTIALS` in `.env`, which is the correct approach for the Google SDK. The file's presence in the project root is a convenience choice, not a code defect.

**`.gitignore` is well-configured:**
- Both `.env` and `google-credentials.json` are explicitly listed in `.gitignore` (lines 6 and 10). Neither file appears in the committed git history (verified). The risk is purely operational (accidental future commit), not a current leaked-secret situation.

**Throttle is applied before the detail call, not after:**
- `index.js` line 33: `await sleep(THROTTLE_MS)` runs before `fetchEventDetail`, meaning the first item also waits 500ms unnecessarily. Minor inefficiency, not a bug.

---

*Concerns audit: 2026-03-26*
