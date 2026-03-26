# Phase 1: Schema & GMS URL - Research

**Researched:** 2026-03-27
**Domain:** Supabase schema migration, URL slug generation, Node.js ES Modules pipeline
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| URL-01 | 각 이벤트의 GMS 공식 상세 페이지 URL을 `gms_url` 컬럼에 저장. 형식: `https://www.nexon.com/maplestory/news/events/{id}/{slug}` | buildGmsUrl() pattern documented; slug rules verified against 4 examples |
| URL-03 | Supabase `events` 테이블에 `gms_url` (text), `kms_url` (text, nullable) 컬럼 추가 | Supabase Dashboard migration method documented; ALTER TABLE SQL provided |
| PIPE-01 | 기존 이벤트 기간 추출 파이프라인(텍스트 → AI → OCR fallback)이 그대로 동작 | No changes to extraction logic; only the rows object gains two new fields |
| PIPE-02 | Nexon API 호출 간 500ms throttle이 유지 | THROTTLE_MS = 500 unchanged; no new API calls added in this phase |
| PIPE-03 | 신규 이벤트에만 처리가 수행 (idempotency 유지) | upsert onConflict:'id' unchanged; gms_url is derived from existing fields so re-runs are safe |
</phase_requirements>

---

## Summary

Phase 1 has two discrete deliverables: a DB schema migration adding two columns to the `events` table in Supabase, and a pure slug-generation function wired into the existing upsert flow.

The schema migration is a one-time DDL operation executed via the Supabase Dashboard SQL editor (no migration framework exists in this project). The columns `gms_url text` and `kms_url text` are both nullable at the DB level — `kms_url` intentionally so (populated in Phase 2), and `gms_url` not null for new rows but nullable in schema to avoid breaking any existing rows.

The slug function is a pure deterministic transformation of `(id, name)` with no external dependencies. It lives in `src/parser.js` alongside the existing HTML parsing utilities, exported as `buildGmsUrl`. The caller is `index.js`, which constructs the row object before calling `upsertEvents`.

**Primary recommendation:** Add `buildGmsUrl(id, name)` to `src/parser.js`; add `gms_url` to the row object in `index.js` step 4; run ALTER TABLE once in Supabase Dashboard.

---

## Project Constraints (from CLAUDE.md)

- **Module system:** ES Modules (`import`/`export`) — `"type": "module"` is in `package.json`. No CommonJS.
- **Package manager:** `pnpm` — use `pnpm install`, not `npm install`.
- **Runtime:** Node.js v18+ (v24.14.0 installed). Use built-in `fetch`, no HTTP library.
- **Async:** `async/await` everywhere; no `Promise.all` across Nexon API calls.
- **Error handling:** Independent `try-catch` per network boundary; AI failures return `null`, not throw.
- **Security:** No hardcoded secrets; all credentials via `process.env`. Check `.gitignore` includes `.env`, `google-credentials.json`.
- **Throttle:** 500ms minimum between Nexon detail API calls — must not be reduced.
- **Idempotency:** Upsert uses `onConflict: 'id'` — must remain unchanged.

---

## Standard Stack

### Core (already installed, no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.100.0 (pinned in lockfile) | DB client — upsert, select | Already in project, handles Auth and REST |
| No new library | — | Slug generation | Pure JS string ops, no library needed |

### No New Dependencies

This phase requires zero new npm packages. The slug algorithm is pure string manipulation. The Supabase migration is a one-off SQL command, not a programmatic migration.

**Installation:** none required.

**Version verification:** `@supabase/supabase-js` latest is `2.100.1` as of 2026-03-27. Project has `2.100.0` pinned in lockfile — no upgrade needed for this phase.

---

## Architecture Patterns

### Existing Project Structure (unchanged)

```
gms-tracker/
├── index.js              # Pipeline orchestrator — ADD gms_url to row object here
├── src/
│   ├── fetcher.js        # Nexon API (no changes)
│   ├── db.js             # Supabase client (no changes to code — schema migration is external)
│   ├── ocr.js            # Vision API (no changes)
│   ├── ai.js             # OpenAI (no changes)
│   └── parser.js         # ADD buildGmsUrl() export here
```

### Pattern 1: Pure Export Function in parser.js

**What:** Add a named export `buildGmsUrl(id, name)` to the existing `src/parser.js` module.
**When to use:** Any time the pipeline has `id` and `name` for an event.
**Rationale:** `parser.js` already owns text/slug transformations (`extractBodyText`, `extractBodyImageUrls`). This function is a pure deterministic transform — no I/O, no side effects. It belongs here.

**Slug algorithm (verified against 4 real GMS event examples):**

```javascript
// Source: phase requirements verified examples
export function buildGmsUrl(id, name) {
  const slug = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ') // keep only alphanumeric + space
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')            // spaces (one or more) -> single hyphen
    .replace(/-+/g, '-')             // collapse consecutive hyphens
    .replace(/^-|-$/g, '');          // strip leading/trailing hyphens

  return `https://www.nexon.com/maplestory/news/events/${id}/${slug}`;
}
```

**Verified examples:**

| Input name | Expected slug | Passes algorithm |
|------------|---------------|-----------------|
| "Monster Park Mayhem!" | `monster-park-mayhem` | YES |
| "Hero & Centichoro Punch King Coin Shops" | `hero-centichoro-punch-king-coin-shops` | YES |
| "[Update Feb 19] February 2026 Hot Weeks!" | `update-feb-19-february-2026-hot-weeks` | YES |
| "Goodbye, Victoria Cup!" | `goodbye-victoria-cup` | YES |

**Import update required in `index.js`:**

```javascript
// Before
import { extractBodyImageUrls, extractBodyText } from './src/parser.js';
// After
import { extractBodyImageUrls, extractBodyText, buildGmsUrl } from './src/parser.js';
```

### Pattern 2: Row Object Extension in index.js

**What:** Add `gms_url` field to the row object built in step 4 of `index.js`.
**Where:** Inside the `for (const detail of newDetails)` loop, just before `rows.push(...)`.

```javascript
// Source: current index.js step 4 rows.push() — extend the object
rows.push({
  id,
  name: detail.name ?? detail.title ?? '',
  image_url: detail.imageThumbnail ?? null,
  event_period,
  gms_url: buildGmsUrl(id, detail.name ?? detail.title ?? ''),
});
```

**Key:** `buildGmsUrl` uses the same name resolution (`detail.name ?? detail.title ?? ''`) that the `name` field already uses. This avoids divergence.

### Pattern 3: Supabase Schema Migration via Dashboard SQL Editor

**What:** One-time DDL to add two columns to the `events` table.
**When:** Before running the updated pipeline. Columns must exist before upsert writes to them.

```sql
-- Run in Supabase Dashboard > SQL Editor
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS gms_url text,
  ADD COLUMN IF NOT EXISTS kms_url text;
```

**Why `IF NOT EXISTS`:** Safe to re-run without error. Supabase's PostgreSQL supports this syntax.

**Why both nullable in schema:** `kms_url` will be `null` until Phase 2 fills it. `gms_url` will always be populated for new rows, but adding a NOT NULL constraint would require a default for existing rows, which is unnecessary complexity.

**No migration framework:** This project has no migration tool (no Prisma, no Flyway, no Supabase CLI migrations). The migration is a one-time manual SQL operation, documented as a task step.

### Anti-Patterns to Avoid

- **Do not add `gms_url` computation inside `db.js`:** The DB layer should remain a thin persistence wrapper. URL construction belongs in the domain/parser layer.
- **Do not add a new source file for buildGmsUrl:** The function is small (5 lines). A dedicated module would over-engineer.
- **Do not use a slug library (e.g., `slugify`):** The slug rules are fixed and verified. Adding a dependency for 5 lines of string ops violates project minimalism.
- **Do not alter `getExistingIds` or `upsertEvents` signatures:** The `upsertEvents` function already passes arbitrary row objects to Supabase — adding new fields to the row object is transparent. No signature change needed.
- **Do not add NOT NULL constraint to `gms_url`:** Existing rows have no value. Add nullable, populate going forward.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Supabase column add | Custom migration runner | Dashboard SQL Editor (one-off DDL) | No migration framework in project; ALTER TABLE IF NOT EXISTS is sufficient |
| Slug generation | Regex-heavy custom parser | The verified 4-step regex (see above) | Rules are simple and fully specified; no library needed |

**Key insight:** Both deliverables in this phase are minimal — no new infrastructure is needed. The slug is 5 lines of standard JS string ops; the migration is a single SQL statement.

---

## Common Pitfalls

### Pitfall 1: Column Does Not Exist at Upsert Time

**What goes wrong:** Upsert fails with Supabase error `column "gms_url" does not exist` if the migration runs after (or is forgotten before) the code deployment.
**Why it happens:** The Supabase JS client does not validate column names at startup; errors surface only on the first write.
**How to avoid:** Run the `ALTER TABLE` migration SQL in Supabase Dashboard **before** deploying or running the updated `index.js`.
**Warning signs:** `[db] upsertEvents error: column "gms_url" does not exist` in console output.

### Pitfall 2: Name Field Empty String Produces a Slug of Empty String

**What goes wrong:** If `detail.name ?? detail.title ?? ''` resolves to `''`, `buildGmsUrl` produces `https://www.nexon.com/maplestory/news/events/{id}/` (trailing slash, empty slug).
**Why it happens:** The API occasionally omits both `name` and `title` for malformed responses.
**How to avoid:** The existing null-safe pattern `detail.name ?? detail.title ?? ''` already handles this. An empty-string slug is technically valid (the URL resolves, though not usefully). No special guard is needed for Phase 1 — the behavior matches how `name` is already handled.
**Warning signs:** A row in Supabase where `gms_url` ends in `/{id}/` with no slug segment.

### Pitfall 3: Upsert Overwrites kms_url with null on Re-Run

**What goes wrong:** After Phase 2 populates `kms_url`, a re-run of the pipeline on an existing event (should be blocked by dedup, but relevant if idempotency is bypassed) would upsert `{ ..., gms_url: '...', kms_url: undefined }` — Supabase may write `null` over a populated value.
**Why it happens:** The row object built in `index.js` does not include `kms_url`. Supabase `upsert` by default replaces all specified columns.
**How to avoid:** The existing dedup logic (`getExistingIds` + filter) prevents re-processing of existing events — this pitfall does not arise in normal operation. If it ever does, the correct fix is to not include `kms_url` in the upsert row (which the current approach already does by omission — Supabase only updates columns present in the object).
**Warning signs:** Unexpected `null` values in `kms_url` column after a pipeline run.

### Pitfall 4: `replace(/[^a-zA-Z0-9 ]/g, ' ')` vs `replace(/[^a-zA-Z0-9 ]/g, '')`

**What goes wrong:** Replacing non-alphanumeric chars with `''` (empty) instead of `' '` (space) would cause adjacent words to merge. E.g., `"Hero & Centichoro"` → `"HeroCentichoro"` → `"herocentichoro"` (wrong) instead of `"hero-centichoro"` (correct).
**Why it happens:** The replacement character matters: use a space so the subsequent `\s+` → `-` step can split correctly.
**How to avoid:** Use `' '` as the replacement in the first `.replace()` call, not `''`.
**Warning signs:** Test the "[Update Feb 19]" example — brackets removed with `''` would merge "Update" and "Feb".

---

## Code Examples

### Complete buildGmsUrl Implementation

```javascript
// Source: phase requirements, verified against 4 confirmed GMS URL examples
/**
 * GMS 이벤트 상세 페이지 URL을 생성한다.
 * @param {string|number} id
 * @param {string} name
 * @returns {string}
 */
export function buildGmsUrl(id, name) {
  const slug = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ') // non-alphanumeric (except space) → space
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')            // runs of whitespace → single hyphen
    .replace(/-+/g, '-')             // collapse consecutive hyphens (redundant but safe)
    .replace(/^-|-$/g, '');          // strip leading/trailing hyphens

  return `https://www.nexon.com/maplestory/news/events/${id}/${slug}`;
}
```

### Row Object with gms_url (index.js step 4)

```javascript
// Source: existing index.js rows.push() block — extend with gms_url
const eventName = detail.name ?? detail.title ?? '';
rows.push({
  id,
  name: eventName,
  image_url: detail.imageThumbnail ?? null,
  event_period,
  gms_url: buildGmsUrl(id, eventName),
});
```

### Supabase Migration SQL

```sql
-- Run once in Supabase Dashboard > SQL Editor
-- Safe to re-run (IF NOT EXISTS)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS gms_url text,
  ADD COLUMN IF NOT EXISTS kms_url text;
```

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond already-installed packages; migration is a UI operation in Supabase Dashboard).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual DB column management | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | Always valid in PostgreSQL | Idempotent DDL — safe to run in docs or CI |
| Separate slug library (slugify, speakingurl) | Native JS string ops | — | No dependency needed for fixed rules |

**Deprecated/outdated:**
- None relevant to this phase.

---

## Open Questions

1. **Supabase upsert behavior for omitted columns**
   - What we know: Supabase `.upsert()` with `onConflict: 'id'` only updates columns present in the row object. Columns absent from the object are not touched.
   - What's unclear: The exact Supabase JS v2 behavior for `undefined` vs missing key in the row object. Official docs and library source confirm omitted keys are not sent in the request body.
   - Recommendation: Omit `kms_url` from the row object entirely (do not set it to `undefined` or `null`). This guarantees Phase 2's `kms_url` values are never overwritten by Phase 1 re-runs. CONFIDENCE: HIGH (Supabase JS client serializes only present keys).

2. **Existing rows after migration**
   - What we know: After `ALTER TABLE ADD COLUMN`, existing rows will have `gms_url = null` and `kms_url = null`.
   - What's unclear: Whether backfilling existing rows is required as part of this phase.
   - Recommendation: No backfill needed for Phase 1. The pipeline processes only top-10 new events going forward. The phase success criteria only requires correct `gms_url` for rows inserted after this phase runs.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `src/parser.js`, `src/db.js`, `index.js` — existing exports and row shape confirmed
- `package.json` — `"type": "module"` confirmed, ES Modules verified
- Phase requirements examples — 4 slug examples verified against algorithm manually
- PostgreSQL documentation — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` syntax is standard PostgreSQL
- `npm view @supabase/supabase-js version` — confirmed `2.100.1` latest, project has `2.100.0`

### Secondary (MEDIUM confidence)
- Supabase JS client behavior for partial upsert (omitted columns not overwritten) — consistent with standard REST PATCH semantics and library source behavior

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; existing stack fully audited from source
- Architecture: HIGH — implementation locations confirmed from code reading; patterns verified against requirements examples
- Pitfalls: HIGH — derived from direct code analysis (upsert shape, dedup flow) and slug algorithm edge cases
- Migration approach: HIGH — `ALTER TABLE IF NOT EXISTS` is idiomatic PostgreSQL; no migration framework exists in this project

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable domain — Supabase JS API, PostgreSQL DDL)
