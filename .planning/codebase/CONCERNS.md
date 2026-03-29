# Concerns & Risks

_Last updated: 2026-03-30_

---

## Security

**`google-credentials.json` physically present in project root:**
- Issue: The GCP service account key file exists at `/home/carokann/projects/gms-tracker/google-credentials.json` (2,335 bytes) alongside source code.
- Files: `google-credentials.json`, `.gitignore` (line 10)
- Current mitigation: Listed in `.gitignore` and NOT committed to git history (verified). `.dockerignore` also excludes it (line 3).
- Risk: A single `git add .` mistake, a future collaborator not inheriting the `.gitignore`, or any tooling that copies the project directory could expose the service account key. Once committed, removal from git history requires a force-push or `git filter-repo`.
- Recommendation: Move the file outside the project root entirely — e.g., `~/.config/gcp/gms-tracker-key.json` — and update `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to point there. Alternatively use GCP Workload Identity or Secret Manager.

**`SUPABASE_SERVICE_ROLE_KEY` bypasses all Row Level Security:**
- Issue: `src/db.js` line 11 reads `SUPABASE_SERVICE_ROLE_KEY`, which grants unrestricted database access and ignores any RLS policies on the `events` table.
- Files: `src/db.js`
- Current mitigation: `.env` is gitignored and not committed.
- Risk: Accidental secret exposure (leaked `.env`, shared terminal history, Docker image built without proper exclusion) grants an attacker full read/write on the Supabase project. The `anon` key with RLS would be a safer option for this read-heavy pipeline.

**No URL validation before sending images to Google Vision API:**
- Issue: `src/ocr.js` line 22 passes `imageUrl` directly to `client.textDetection(imageUrl)` with no domain or scheme validation.
- Files: `src/ocr.js`, `src/parser.js`
- Risk: If the upstream Nexon API were ever compromised and returned a crafted image URL (SSRF vector or billing amplification), arbitrary URLs would be submitted to the Vision API at the project's billing cost. Low probability given Nexon's static CDN, but zero defense-in-depth.
- Fix approach: Validate that the URL hostname ends with `nexonstatic.com` or `nexon.com` before calling `textDetection`.

**`OPENAI_API_KEY` missing from `.env.example`:**
- Issue: `.env.example` lists `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` but omits `OPENAI_API_KEY`, which is now required by both `src/ai.js` and `src/matcher.js`.
- Files: `.env.example`, `src/ai.js` line 3, `src/matcher.js` line 3
- Risk: A new developer following `.env.example` will start the pipeline, reach the first AI call, and get an opaque `AuthenticationError` from the OpenAI SDK rather than a clear startup-time failure.
- Fix approach: Add `OPENAI_API_KEY=your-openai-api-key` to `.env.example`. Add startup-time env validation in `index.js`.

---

## Reliability

**No retry logic on any external call:**
- Issue: All four external services — Nexon CMS API, KMS scraping, Supabase, Google Vision, OpenAI — have zero retry logic. Any transient failure (timeout, 503, DNS blip) produces either a silent null or a full `process.exit(1)`.
- Files: `src/fetcher.js`, `src/db.js`, `src/ocr.js`, `src/ai.js`, `src/matcher.js`
- Impact: A 1-second Nexon CDN blip kills the entire run. The next scheduled run may skip those items if they drop out of the top 10 by then.
- Fix approach: Wrap each network call in a simple retry loop (3 attempts, exponential backoff starting at 1 second). The `fetcher.js` pattern is most critical.

**`fetchNewsList` throws on failure — kills the entire run:**
- Issue: `src/fetcher.js` catch block re-throws; `index.js` line 100 catches at top level and calls `process.exit(1)`.
- Files: `src/fetcher.js` lines 88-91, `index.js` line 100
- Impact: A temporary Nexon API outage silently aborts the pipeline. For a cron job, there is no alerting and the run is lost.

**`fetchEventDetail` failure silently drops items permanently:**
- Issue: `src/fetcher.js` `fetchEventDetail` returns `null` on any error. `index.js` line 48 filters null results out of `newDetails`.
- Files: `src/fetcher.js` lines 147-149, `index.js` lines 47-50
- Impact: If a detail fetch fails due to a transient error, the item is never in the DB. On the next run, its `id` will still appear in the top 10 and will be treated as "new" again, giving it another attempt — this is actually acceptable behavior, but the failure is invisible in logs. No count of dropped vs. processed items is reported.

**`getExistingIds` and `upsertEvents` throw on DB failure — no graceful fallback:**
- Issue: Both DB functions re-throw on Supabase error.
- Files: `src/db.js` lines 42-44, lines 87-89
- Impact: A Supabase outage or misconfigured credentials causes `process.exit(1)` immediately, even if the Nexon data was fully fetched and ready to be stored.

**No distinction between "OCR failed" and "no date found" in DB:**
- Issue: `src/ocr.js` returns `''` on Vision API error; `extractEventPeriodWithAI` on empty input returns `null`; the DB record stores `event_period = null` in both cases.
- Files: `src/ocr.js` line 27, `src/ai.js` line 16, `index.js` line 59
- Impact: Cannot distinguish in the DB whether a null `event_period` means "the event genuinely had no dates" vs "OCR or AI call failed". Prevents building a retry mechanism targeting only failed OCR rows.

**Concurrent execution produces duplicate API billing:**
- Issue: No execution lock or mutex. Two simultaneous runs (e.g., overlapping cron triggers) both see the same `getExistingIds` snapshot and both run OCR and AI on the same items.
- Files: `index.js` (orchestrator has no concurrency guard)
- Impact: Duplicate Google Vision and OpenAI API charges. The upsert is idempotent so no data corruption, but billing is doubled.

---

## Cost (OCR & AI)

**`matcher.js` makes 2 OpenAI calls per new event item, always:**
- Issue: `src/matcher.js` `findKmsUrl()` calls `gpt-4o-mini` twice per event — once to translate the GMS name to Korean, once to match against the KMS list.
- Files: `src/matcher.js` lines 16-47
- Impact: With up to 10 new items per run and 2 AI calls per item just for KMS matching (plus up to 2 more for date extraction), a run with 10 new events makes up to 40 OpenAI API calls. No budget cap or circuit-breaker exists.

**KMS `listText` grows unboundedly as the KMS event archive grows:**
- Issue: `src/matcher.js` line 33 concatenates every scraped KMS event into a single string passed as user message content to GPT.
- Files: `src/matcher.js` lines 33-34
- Impact: The KMS event archive grows over time. At 20 pages × ~20 events = ~400 events, the list text is large and eats into the `max_tokens` budget and increases per-call cost. No truncation or pagination of the list is applied.

**OCR cost partially controlled but no per-run cap:**
- Issue: `OCR_LIMIT = 2` in `index.js` caps images per event, but there is no cap on total Vision API calls per run.
- Files: `index.js` line 10
- Impact: Up to 10 new events × 2 images = 20 Vision API calls per run. For monthly scheduled runs this is negligible, but for daily runs the cost accumulates.

**No caching of KMS event list across runs:**
- Issue: `fetchKmsEventList()` scrapes up to 21 pages of the KMS website on every single pipeline run, making up to 21 HTTP requests to `maplestory.nexon.com`.
- Files: `src/fetcher.js` lines 101-131
- Impact: Over time, this generates significant traffic to Nexon's KMS servers. It also adds ~10 seconds (20 pages × 500ms throttle) to every run regardless of whether any new GMS events exist.

---

## IP Blocking / Rate Limiting

**KMS scraping up to 20 pages per run with 500ms throttle only:**
- Issue: Every run scrapes `https://maplestory.nexon.com/News/Event/Closed?page=N` for up to 20 pages with a 500ms delay between each.
- Files: `src/fetcher.js` lines 114-124
- Impact: The 500ms throttle is the sole protection against triggering Nexon's WAF or IP rate limiter. This is stated as "안전 범위" in the comment, but it is not verified. Aggressive WAF rules, shared IP environments (cloud NAT), or a future policy change could trigger a block.
- Risk: If the KMS scraping IP is blocked, `fetchKmsEventList` catches the error and returns a partial list — meaning `kms_url` silently becomes `null` for affected events with no alerting.

**`fetchNewsList` sends no User-Agent header:**
- Issue: `fetchKmsPage` in `src/fetcher.js` sends a custom `User-Agent` header (line 15), but `fetchNewsList` (line 73) uses a bare `fetch(NEWS_LIST_URL)` with no headers.
- Files: `src/fetcher.js` lines 71-92
- Impact: The Nexon CMS API may apply different rate-limiting behavior to requests without a User-Agent. Inconsistent header usage makes behavior harder to reason about. If the API returns a blank or error response without `!res.ok`, the item count would silently drop to zero.

**No exponential backoff on 429 responses:**
- Issue: If Nexon returns HTTP 429 (Too Many Requests) on either the list API or detail API calls, the error is treated the same as any other failure (re-throw for list, null for detail).
- Files: `src/fetcher.js` lines 88-91, lines 147-149
- Impact: The pipeline makes no attempt to honor `Retry-After` headers or back off, meaning the next scheduled run will hit the same rate limit.

---

## Technical Debt

**No startup-time environment validation:**
- Issue: Required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`) are validated lazily — only when each module is first invoked.
- Files: `src/db.js` lines 13-15, `src/ai.js` line 3, `src/ocr.js` line 8, `src/matcher.js` line 3
- Impact: A misconfigured deployment fails mid-pipeline after some API calls have already been made (including billed OCR/AI calls), rather than failing fast at startup.
- Fix approach: Add a `validateEnv()` function called at the top of `main()` that checks all four vars and throws immediately if any are missing.

**No schema validation on Nexon API responses:**
- Issue: `fetchNewsList` and `fetchEventDetail` check only `res.ok`, not the shape of the JSON body.
- Files: `src/fetcher.js` lines 77-84, lines 143-146
- Impact: If Nexon changes the response envelope (e.g., renames `items` to `list`), the filter silently returns 0 events with no error logged. The pipeline reports "No event items found" and exits normally — indistinguishable from a real zero-events scenario.

**Field name assumptions on detail API are undocumented:**
- Issue: `index.js` line 80 tries `detail.name ?? detail.title ?? ''`, and line 81 uses `detail.imageThumbnail ?? null` with no fallback.
- Files: `index.js` lines 80-81
- Impact: `imageThumbnail` has no fallback — a renamed field silently produces `null` image URLs for all new events.

**`matcher.js` GPT response parsing is fragile:**
- Issue: `src/matcher.js` line 54 extracts the matched KMS event id with `matchResult.match(/\d+/)?.[0]`. If GPT returns a response containing digits in the explanation (e.g., "There are 3 possible matches, the best is 1301"), this regex picks the first number found (`3`), not the intended ID.
- Files: `src/matcher.js` line 54
- Impact: KMS URL could be silently set to a wrong event page. No validation is done to check that the extracted ID actually exists in the `kmsList`.

**`buildGmsUrl` slug generation is not verified against actual URL structure:**
- Issue: `src/parser.js` `buildGmsUrl` generates a URL slug by lowercasing and hyphenating the event name. Nexon's actual event page URLs may not follow this pattern (special characters, different slugging logic).
- Files: `src/parser.js` lines 47-57
- Impact: Generated `gms_url` values may be 404s. There is no HTTP validation of the constructed URLs.

**`package.json` has only a `dev` script for production use:**
- Issue: `package.json` line 6 defines `"dev": "node index.js"` as the only script. The Dockerfile CMD runs `node index.js` directly, bypassing npm scripts entirely.
- Files: `package.json`, `Dockerfile` line 17
- Impact: No semantic distinction between development and production invocation. No `start` script for convention-compliant container orchestration.

**`NEWS_LIST_URL` and `NEWS_DETAIL_URL` are identical constants:**
- Issue: `src/fetcher.js` lines 3-4 define two separate constants that hold the same base URL string.
- Files: `src/fetcher.js` lines 3-4
- Impact: Minor dead code / misleading naming. The distinction suggests there could be different base URLs, but both always point to the same endpoint.

**`sleep()` utility is exported from `fetcher.js` but conceptually misplaced:**
- Issue: `sleep` is a generic utility with no coupling to fetching, but is exported from `src/fetcher.js` and imported into `index.js`.
- Files: `src/fetcher.js` line 63, `index.js` line 2
- Impact: Minor organizational debt. If a second consumer needs `sleep`, it must import from `fetcher.js`, creating a confusing dependency.

---

## Test Coverage Gaps

**Zero test files exist in the project:**
- Issue: No `.test.js`, `.spec.js`, or test framework configuration exists anywhere in the project.
- Files: Entire `src/` directory
- Impact: All logic paths are untested. Regression is only detectable by running the full pipeline end-to-end against live services.

**`parseEventPeriod` / AI prompt is the highest-risk untested logic:**
- Issue: The AI prompt in `src/ai.js` and the fallback OCR logic in `index.js` lines 65-75 are the core value of the pipeline. The date extraction format string (`YYYY-MM-DD HH:MM (UTC) - ...`) is defined as a freeform string with no parsing validation on the output.
- Files: `src/ai.js`, `index.js` lines 61-75
- Risk: AI output format drift (GPT model update, prompt interpretation change) would silently produce malformed `event_period` strings in the DB. No unit test validates that the output matches the expected format before it is stored.

**`matcher.js` KMS matching is untested:**
- Issue: `findKmsUrl` involves two GPT calls and regex extraction of the result. No tests cover the happy path, the "null" fallback, or the digit-extraction ambiguity.
- Files: `src/matcher.js`
- Risk: Wrong or null `kms_url` values in the DB with no automated detection.

**HTML parsing logic in `fetcher.js` and `parser.js` is untested:**
- Issue: `parseOngoingEvents`, `parseClosedEvents`, `extractBodyImageUrls`, and `extractBodyText` all operate on real HTML that could change without notice.
- Files: `src/fetcher.js` lines 29-60, `src/parser.js` lines 10-38
- Risk: A KMS page HTML structure change would silently produce empty results. No snapshot or fixture tests exist to catch regressions.

---

## Operational Risks

**No alerting or monitoring on pipeline failure:**
- Issue: The pipeline logs to stdout/stderr only. There is no error notification (email, Slack, webhook) on `process.exit(1)` or on prolonged `event_period = null` rates.
- Files: `index.js` line 101
- Impact: Silent failures can go undetected until a user notices the DB is stale.

**No health check or last-run timestamp in DB:**
- Issue: There is no table, row, or metadata tracking when the pipeline last ran successfully.
- Impact: No way to detect if the scheduled trigger (cron/Cloud Scheduler) stopped firing or if runs are consistently failing.

**Dockerfile copies entire working directory including planning docs:**
- Issue: `Dockerfile` line 13 does `COPY . .` after source files, which copies `.planning/`, `CLAUDE.md`, `pnpm-lock.yaml`, and any other files not in `.dockerignore`.
- Files: `Dockerfile` line 13, `.dockerignore`
- Impact: Docker image is larger than necessary. `.dockerignore` does not exclude `.planning/` or `CLAUDE.md`. Not a security risk (no secrets), but increases image size and layer rebuilds.

---

*Concerns audit: 2026-03-30*
