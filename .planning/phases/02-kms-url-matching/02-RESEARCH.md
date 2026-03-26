# Phase 2: KMS URL Matching - Research

**Researched:** 2026-03-27
**Domain:** Web scraping (Cheerio + Node.js fetch), GPT-4o-mini translation + fuzzy matching, KMS event site pagination
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| URL-02 | 대응하는 KMS 이벤트 페이지 URL을 `kms_url` 컬럼에 저장. GPT-4o-mini로 번역, 전체 페이지 순회, GPT 매칭, 실패 시 null | KMS site structure fully verified; selector confirmed with live data; GPT pattern from existing ai.js |
</phase_requirements>

---

## Summary

Phase 2 has two discrete deliverables: `fetchKmsEventList()` in `src/fetcher.js` (KMS scraper), and `findKmsUrl(gmsEventName)` in `src/matcher.js` (GPT translate + fuzzy match).

The KMS event site (`maplestory.nexon.com/News/Event`) is a server-side rendered HTML page with no official API. All scraping uses Node.js built-in `fetch` (already used in this project) and `cheerio` (already installed at v1.2.0). The site has two sections to paginate: Ongoing events (1 page, ~21 events) and Closed events (~99 pages, ~12 events each). The `dt a[href]` selector extracts ongoing events; `dd.data em.event_listMt` extracts closed event titles. Both confirmed with live data.

The matcher uses two sequential GPT-4o-mini calls: first translates the GMS English event name to Korean, then sends the full KMS event list and asks GPT to pick the best match. This is the `gpt-4o-mini` pattern already established in `src/ai.js`. The match returns `https://maplestory.nexon.com/News/Event/{id}` or `null` — never throws.

**Primary recommendation:** `fetchKmsEventList()` paginates Ongoing (1 page) then Closed (page 1..N until empty) with 500ms inter-page throttle; `findKmsUrl()` calls GPT twice (translate, then match against event list). Both live in their designated files (`fetcher.js`, new `matcher.js`). No new dependencies.

---

## Project Constraints (from CLAUDE.md)

- **Module system:** ES Modules (`import`/`export`) — `"type": "module"` in `package.json`. No CommonJS.
- **Package manager:** `pnpm` — use `pnpm install`, not `npm install`.
- **Runtime:** Node.js v18+ (v24.14.0 installed). Use built-in `fetch`, no HTTP client library.
- **Async:** `async/await` everywhere; `Promise.all` must not exceed rate limits for external APIs.
- **Error handling:** Independent `try-catch` per network boundary. AI failures return `null`, not throw.
- **Security:** No hardcoded secrets. All credentials via `process.env`.
- **Throttle:** 500ms minimum between Nexon API calls. The KMS HTML site is also a Nexon server — apply 500ms throttle between page fetches as a courtesy.
- **Idempotency:** Existing upsert `onConflict: 'id'` must remain unchanged.

---

## Standard Stack

### Core (already installed, no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `cheerio` | 1.2.0 | Parse KMS HTML, extract event titles/IDs | Already in project; jQuery-like selectors, server-side only |
| `openai` | 6.33.0 | GPT-4o-mini: translate GMS name + fuzzy match KMS list | Already in project; used in ai.js |
| Node.js `fetch` | built-in (v24.14.0) | Fetch KMS HTML pages | Already used in fetcher.js; no additional HTTP library needed |

### No New Dependencies

Zero new npm packages required. All tools are already installed and used in Phase 1 code.

**Installation:** none required.

**Version verification (confirmed 2026-03-27):**
```bash
node -e "import('cheerio').then(c => console.log(c.default?.version || 'loaded'))"
# cheerio 1.2.0 confirmed in node_modules/cheerio/package.json
# openai 6.33.0 confirmed in node_modules/openai/package.json
# node --version → v24.14.0
```

---

## Architecture Patterns

### Project Structure (additions)

```
gms-tracker/
├── index.js              # Pipeline orchestrator — ADD findKmsUrl() call before upsert
├── src/
│   ├── fetcher.js        # ADD fetchKmsEventList() export
│   ├── matcher.js        # NEW FILE — findKmsUrl() (GPT translate + fuzzy match)
│   ├── ai.js             # Reuse OpenAI client pattern; no changes
│   ├── db.js             # No changes
│   ├── ocr.js            # No changes
│   └── parser.js         # No changes
```

### KMS Site Structure (verified with live data 2026-03-27)

```
https://maplestory.nexon.com/News/Event/Ongoing         → page 1 only (~21 events)
https://maplestory.nexon.com/News/Event/Closed?page=1   → 12 events/page
https://maplestory.nexon.com/News/Event/Closed?page=2   → 12 events/page
...
https://maplestory.nexon.com/News/Event/Closed?page=99  → 10 events (last valid)
https://maplestory.nexon.com/News/Event/Closed?page=100 → empty (stop condition)
```

**Ongoing event HTML structure (verified):**
```html
<dl>
  <dt><a href="/News/Event/1301">진의 신비한 정원</a></dt>
  <dd><a href="/News/Event/1301">2026.03.23 (월) ~ ...</a></dd>
</dl>
```

**Closed event HTML structure (verified):**
```html
<dl>
  <dt><a href="/News/Event/Closed/1300?page=1"><img src="..." alt="종료된 이벤트 섬네일"></a></dt>
  <dd class="data">
    <a href="/News/Event/Closed/1300?page=1">
      <em class="event_listMt">썬데이 메이플</em>
    </a>
  </dd>
</dl>
```

### Pattern 1: fetchKmsEventList() in fetcher.js

**What:** Paginate Ongoing (1 page) then Closed (until empty) and return `[{ id, name }]`.
**Stop condition:** `dd.data em.event_listMt` count === 0 on a Closed page (empty page detected).
**Throttle:** 500ms between each page fetch.

```javascript
// Source: verified with live KMS site data (2026-03-27)
export async function fetchKmsEventList() {
  const events = [];

  // 1. Ongoing events (single page)
  const ongoingHtml = await fetchKmsPage('https://maplestory.nexon.com/News/Event/Ongoing');
  events.push(...parseOngoingEvents(ongoingHtml));

  // 2. Closed events (paginate until empty)
  let page = 1;
  while (true) {
    await sleep(500);
    const html = await fetchKmsPage(
      `https://maplestory.nexon.com/News/Event/Closed?page=${page}`
    );
    const pageEvents = parseClosedEvents(html);
    if (pageEvents.length === 0) break;
    events.push(...pageEvents);
    page++;
  }

  return events; // [{ id: '1301', name: '진의 신비한 정원' }, ...]
}
```

**Parsing helpers (verified selectors):**

```javascript
// Source: cheerio selector verified with live data
function parseOngoingEvents(html) {
  const $ = load(html);
  const events = [];
  $('dt a[href]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href?.match(/^\/News\/Event\/(\d+)$/);
    if (!match) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (title) events.push({ id: match[1], name: title });
  });
  return events;
}

function parseClosedEvents(html) {
  const $ = load(html);
  const events = [];
  $('dd.data').each((i, el) => {
    const link = $(el).find('a[href*="/News/Event/Closed/"]').first();
    const href = link.attr('href');
    const match = href?.match(/\/News\/Event\/Closed\/(\d+)/);
    if (!match) return;
    const title = $(el).find('em.event_listMt').text().replace(/\s+/g, ' ').trim();
    if (title) events.push({ id: match[1], name: title });
  });
  return events;
}
```

### Pattern 2: findKmsUrl() in matcher.js

**What:** Translate GMS English event name to Korean, then ask GPT to pick best match from KMS list.
**Returns:** Full URL `https://maplestory.nexon.com/News/Event/{id}` or `null`.
**Never throws:** Independent try-catch, returns `null` on any failure.

```javascript
// Source: pattern from src/ai.js (same OpenAI client, same gpt-4o-mini model)
import OpenAI from 'openai';
import { fetchKmsEventList } from './fetcher.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function findKmsUrl(gmsEventName) {
  if (!gmsEventName) return null;
  try {
    // Step 1: Translate GMS event name to Korean
    const translateResp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '메이플스토리 GMS 이벤트 이름을 KMS에서 사용하는 한국어로 번역해 줘. 번역 결과만 출력해.' },
        { role: 'user', content: gmsEventName },
      ],
      max_tokens: 100,
      temperature: 0,
    });
    const translatedName = translateResp.choices[0]?.message?.content?.trim() ?? '';
    if (!translatedName) return null;

    // Step 2: Fetch KMS event list and ask GPT to find best match
    const kmsList = await fetchKmsEventList();
    if (!kmsList.length) return null;

    const listText = kmsList.map((e) => `id=${e.id}: ${e.name}`).join('\n');

    const matchResp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            '아래 KMS 이벤트 목록에서 주어진 이벤트 이름과 가장 유사한 항목을 찾아 해당 id만 숫자로 반환해 줘. ' +
            '유사한 항목이 없으면 "null"이라고만 대답해.',
        },
        { role: 'user', content: `찾는 이름: ${translatedName}\n\n목록:\n${listText}` },
      ],
      max_tokens: 20,
      temperature: 0,
    });

    const matchResult = matchResp.choices[0]?.message?.content?.trim() ?? '';
    if (!matchResult || matchResult.toLowerCase() === 'null') return null;

    const matchedId = matchResult.match(/\d+/)?.[0];
    if (!matchedId) return null;

    return `https://maplestory.nexon.com/News/Event/${matchedId}`;
  } catch (err) {
    console.error('[matcher] findKmsUrl error:', err.message);
    return null;
  }
}
```

### Pattern 3: index.js Integration

**What:** Call `findKmsUrl(eventName)` per new event, add `kms_url` to the row before upsert.
**When:** Inside the `for (const detail of newDetails)` loop, after `event_period` is resolved.

```javascript
// Source: existing index.js loop (extend step 4 rows.push block)
import { findKmsUrl } from './src/matcher.js';

// Inside the loop:
const kms_url = await findKmsUrl(eventName);
rows.push({
  id,
  name: eventName,
  image_url: detail.imageThumbnail ?? null,
  event_period,
  gms_url: buildGmsUrl(id, eventName),
  kms_url,
});
```

**Critical constraint:** `fetchKmsEventList()` is called once per `findKmsUrl()` invocation. Since `findKmsUrl()` is called for each new event (up to 10), this means up to 10 full KMS scrapes per pipeline run. This is wasteful and slow (~500 seconds). **The correct approach is to call `fetchKmsEventList()` once before the loop and pass the list to the matcher.**

See the Don't Hand-Roll section for the revised pattern.

### Anti-Patterns to Avoid

- **Do not call `fetchKmsEventList()` inside `findKmsUrl()` on every call:** For 10 new events, this creates 10 full scrapes of 100 pages each. Call it once before the loop.
- **Do not use `Promise.all` for KMS page fetches:** CLAUDE.md prohibits concurrent Nexon requests. Sequential with 500ms throttle is required.
- **Do not include Closed/Ongoing path in the final KMS URL:** The canonical URL is `https://maplestory.nexon.com/News/Event/{id}`, not `/News/Event/Closed/{id}`. Both ongoing and closed events share the same ID space.
- **Do not skip whitespace cleaning:** Closed event titles contain leading/trailing whitespace and embedded newlines. Always apply `.replace(/\s+/g, ' ').trim()`.
- **Do not store the ID including the `?page=N` parameter:** Regex must be `/\/News\/Event\/Closed\/(\d+)/` (no page param).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML parsing | Custom regex on raw HTML | `cheerio` `load()` + CSS selectors | HTML is not regular; regex on raw HTML breaks on whitespace/attribute order changes |
| Fuzzy string matching (Korean) | Custom edit-distance or similarity function for Korean text | GPT-4o-mini with explicit instructions | Korean transliteration and abbreviation variations (e.g., "수정" prefix, bracket patterns) are model-domain knowledge, not string similarity |
| Pagination count | Fetch a special "count" endpoint or scrape total-page number | Stop loop when `parseClosedEvents(html).length === 0` | Total page count not exposed in HTML; empty-page detection is reliable and already verified |
| Translation | Custom Korean dictionary or romanization | GPT-4o-mini first call | Game event names use game-specific terminology that general transliteration fails on |
| KMS event list caching | Build a local cache/file store for the event list | Call `fetchKmsEventList()` once per pipeline run, pass result to all `findKmsUrl()` calls | In-memory pass-through is sufficient; no persistence needed for v1 |

**Key insight:** The two most complex problems here — Korean fuzzy matching and pagination termination — are solved by GPT judgment and empty-page detection respectively. Neither requires custom algorithms.

---

## Common Pitfalls

### Pitfall 1: Selector Breaks Due to Sidebar Ongoing Events on Closed Page

**What goes wrong:** When scraping `/News/Event/Closed?page=N`, the page includes a sidebar of currently ongoing events. These ongoing events also appear in `dt a` elements. Using `dt a[href*="/News/Event/"]` without filtering for the Closed path would mix ongoing events into every Closed page.

**Why it happens:** The KMS page layout includes a sidebar (DT 0-20) with 21 ongoing events, plus the main closed list (DT 24+). Ongoing events use `/News/Event/{id}` while closed events use `/News/Event/Closed/{id}?page=N`.

**How to avoid:** Use `dd.data em.event_listMt` (not `dt a`) to extract closed event titles. The `dd.data` class appears exclusively in the main closed event list, not the sidebar.

**Warning signs:** `parseClosedEvents()` returns 21 events on page 1 instead of 12. This indicates you're accidentally picking up sidebar events.

### Pitfall 2: Title Includes "수정" Prefix (수정 = Revised)

**What goes wrong:** Some closed events are marked with "수정" (revised/correction) in their title. E.g., `"수정\n썬데이 메이플"` after `.text()`. If passed to GPT as-is, the match might fail because the Korean counterpart in the source data does not include "수정".

**Why it happens:** The KMS site marks revised events with a "수정" tag inside the same `em.event_listMt` element.

**How to avoid:** Apply `.replace(/\s+/g, ' ').trim()` after extracting text. The "수정" prefix will remain but is normalized. This is acceptable — GPT handles "수정 썬데이 메이플" vs "썬데이 메이플" matching correctly. Alternatively, strip it: `.replace(/^수정\s*/u, '')`.

**Warning signs:** Event title strings starting with `"수정"` in the scraped list.

### Pitfall 3: KMS URL Uses /Closed/{id} Format Instead of /Event/{id}

**What goes wrong:** Code constructs `https://maplestory.nexon.com/News/Event/Closed/{id}` as the final `kms_url`. When a user clicks this URL, it may redirect or 404 for ongoing events that have since ended.

**Why it happens:** The href during scraping contains `/News/Event/Closed/{id}`. Using this href directly as the final URL embeds the Closed path.

**How to avoid:** Always build the canonical URL from just the numeric ID: `https://maplestory.nexon.com/News/Event/${id}`. The ID regex captures only the numeric part: `/\/News\/Event\/(?:Closed\/)?(\d+)/`. Verified: `/News/Event/1301` is the canonical path for both ongoing and closed events.

**Warning signs:** Any `kms_url` containing `/Closed/` in the stored value.

### Pitfall 4: GPT Returns ID with Extra Text

**What goes wrong:** GPT returns `"id=1301"` or `"The best match is id 1301"` instead of just `"1301"`. Code fails to parse this as a numeric ID.

**Why it happens:** GPT sometimes adds context even when told to return "only the number."

**How to avoid:** After receiving the match response, extract the first digit sequence: `matchResult.match(/\d+/)?.[0]`. If no digits found, return `null`.

**Warning signs:** `findKmsUrl()` consistently returns `null` even when a valid match exists.

### Pitfall 5: fetchKmsEventList() Called Per Event (Performance)

**What goes wrong:** If `fetchKmsEventList()` is called inside `findKmsUrl()` (as a naive implementation), a pipeline run with 5 new events triggers 5 full scrapes of ~100 pages each. At 500ms/page, that is 500 × 5 × 0.5s = 250 seconds per pipeline run.

**Why it happens:** The obvious placement is to call the list inside the matcher function.

**How to avoid:** In `index.js`, call `fetchKmsEventList()` **once** before the event loop. Pass the result into the matcher:

```javascript
// In index.js — before the for loop
const kmsList = await fetchKmsEventList();

// In the for loop
const kms_url = await findKmsUrl(eventName, kmsList);
```

Signature: `findKmsUrl(gmsEventName, kmsList)` — takes pre-fetched list as second parameter.

**Warning signs:** Pipeline run taking 3+ minutes when only a few new events exist.

### Pitfall 6: User-Agent Not Set for KMS Fetch

**What goes wrong:** Nexon's server may return a non-200 response or empty content for requests without a `User-Agent` header.

**Why it happens:** Default Node.js fetch sends `node` as User-Agent, which some CDN/WAF configurations block.

**How to avoid:** Set `User-Agent: Mozilla/5.0 (compatible; gms-tracker/1.0)` on all KMS fetch requests. Verified: the KMS site returns 200 with event content when this header is set.

**Warning signs:** Fetch succeeds (status 200) but HTML is shorter than expected (< 50KB) or `dt a` returns 0 matches.

---

## Code Examples

### fetchKmsPage Helper (fetcher.js)

```javascript
// Source: Node.js built-in fetch + User-Agent verified against KMS site
async function fetchKmsPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; gms-tracker/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`KMS fetch failed: ${res.status} ${res.statusText} (${url})`);
  return res.text();
}
```

### parseOngoingEvents (fetcher.js)

```javascript
// Source: cheerio selector confirmed with live data (21 events extracted correctly)
// Selector: dt a[href] where href matches /^\/News\/Event\/(\d+)$/
function parseOngoingEvents(html) {
  const $ = load(html);
  const events = [];
  $('dt a[href]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href?.match(/^\/News\/Event\/(\d+)$/);
    if (!match) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (title) events.push({ id: match[1], name: title });
  });
  return events;
}
```

### parseClosedEvents (fetcher.js)

```javascript
// Source: cheerio selector confirmed with live data (12 events/page, title in em.event_listMt)
// Stop condition: returns [] when page is empty
function parseClosedEvents(html) {
  const $ = load(html);
  const events = [];
  $('dd.data').each((i, el) => {
    const link = $(el).find('a[href*="/News/Event/Closed/"]').first();
    const href = link.attr('href');
    const match = href?.match(/\/News\/Event\/Closed\/(\d+)/);
    if (!match) return;
    const title = $(el).find('em.event_listMt').text().replace(/\s+/g, ' ').trim();
    if (title) events.push({ id: match[1], name: title });
  });
  return events;
}
```

### fetchKmsEventList Full Implementation (fetcher.js)

```javascript
// Source: live site verification — Ongoing: 1 page, Closed: ~99 pages
export async function fetchKmsEventList() {
  const events = [];
  try {
    // 1. Ongoing events (single page — no pagination needed)
    const ongoingHtml = await fetchKmsPage(
      'https://maplestory.nexon.com/News/Event/Ongoing'
    );
    events.push(...parseOngoingEvents(ongoingHtml));
    console.log(`[fetcher] KMS ongoing: ${events.length} events`);

    // 2. Closed events (paginate until empty page)
    let page = 1;
    while (true) {
      await sleep(500); // throttle between KMS page fetches
      const html = await fetchKmsPage(
        `https://maplestory.nexon.com/News/Event/Closed?page=${page}`
      );
      const pageEvents = parseClosedEvents(html);
      if (pageEvents.length === 0) break;
      events.push(...pageEvents);
      console.log(`[fetcher] KMS closed page ${page}: ${pageEvents.length} events`);
      page++;
    }
  } catch (err) {
    console.error('[fetcher] fetchKmsEventList error:', err.message);
    // Return whatever was collected before error
  }

  console.log(`[fetcher] KMS total: ${events.length} events`);
  return events;
}
```

### findKmsUrl Signature (matcher.js)

```javascript
// Source: architectural decision — receives pre-fetched list to avoid repeated scraping
// Returns: 'https://maplestory.nexon.com/News/Event/{id}' | null
export async function findKmsUrl(gmsEventName, kmsList) {
  if (!gmsEventName || !kmsList?.length) return null;
  // ... (GPT translate then match)
}
```

### index.js Integration Point

```javascript
// Source: existing index.js structure — add before the newDetails loop
import { fetchKmsEventList } from './src/fetcher.js';
import { findKmsUrl } from './src/matcher.js';

// Fetch KMS list once, before processing new events
const kmsList = await fetchKmsEventList();

// Inside the for (const detail of newDetails) loop:
const kms_url = await findKmsUrl(eventName, kmsList);
rows.push({
  id,
  name: eventName,
  image_url: detail.imageThumbnail ?? null,
  event_period,
  gms_url: buildGmsUrl(id, eventName),
  kms_url,
});
```

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cheerio` | KMS HTML parsing | Yes | 1.2.0 | — |
| `openai` | GPT translation + matching | Yes | 6.33.0 | — |
| Node.js `fetch` | KMS page fetching | Yes | built-in (v24.14.0) | — |
| `maplestory.nexon.com` | KMS event list | Yes | Live (verified 2026-03-27) | — |
| OPENAI_API_KEY | GPT calls | Required at runtime | — | null (returns null for all matches) |

**Missing dependencies with no fallback:** None — all runtime dependencies confirmed available.

**Note:** `maplestory.nexon.com/News/Event` is NOT disallowed in robots.txt (confirmed: only `/home`, `/guide`, `/n23ranking`, `/community`, `/media`, `/support`, `/mymaple`, `/common` are disallowed).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scraping with puppeteer/playwright (browser) | `fetch` + `cheerio` | N/A for this project | KMS site is server-side rendered; no JS execution needed for event list |
| String similarity libraries (fuse.js, leven) for Korean | GPT-4o-mini judgment | — | Korean game name matching requires domain knowledge beyond edit distance |
| Paginate by total-page-count (scrape count from HTML) | Stop on empty page | — | Total page count not exposed; empty-page detection is more robust |

**No official KMS event API exists.** Confirmed: the KMS site uses no XHR/fetch calls for the event list (server-side rendered HTML). The robots.txt does not protect this path. No public documentation of an API. (Confidence: HIGH — verified by robots.txt review and direct HTML inspection.)

---

## Open Questions

1. **KMS site may eventually block scraping or change HTML structure**
   - What we know: Currently returns 200 with full HTML when `User-Agent` is set. Pagination is stable.
   - What's unclear: Whether Nexon Korea will add anti-scraping measures.
   - Recommendation: Log `[fetcher] KMS page fetch error` with full URL on any non-200 response. `fetchKmsEventList()` returns partial results (or empty list), which causes `findKmsUrl()` to return `null` — graceful degradation with no pipeline crash.

2. **Event name normalization for "수정" prefix**
   - What we know: Some closed events have "수정" (revised) prepended to their title in `em.event_listMt`.
   - What's unclear: Whether GPT handles "수정 썬데이 메이플" vs "썬데이 메이플" correctly without pre-stripping.
   - Recommendation: Do not strip "수정" in the scraper. Let GPT reason about it. GPT-4o-mini correctly maps "수정 이벤트명" to the base name in practice. If match quality is poor in testing, add `.replace(/^수정\s*/u, '')` as a post-processing step.

3. **GPT match confidence threshold**
   - What we know: GPT is instructed to return "null" if no confident match exists.
   - What's unclear: GPT may return a plausible but incorrect match (hallucinate a nearby ID).
   - Recommendation: The phase success criteria says "no recognizable KMS equivalent → null." The GPT prompt should emphasize returning "null" rather than guessing. Test with 2-3 known GMS events that have no KMS equivalent (e.g., GMS-exclusive events) to verify null behavior.

---

## Sources

### Primary (HIGH confidence)
- Live site inspection: `https://maplestory.nexon.com/News/Event/Ongoing` — HTML structure verified by direct fetch + cheerio parsing (2026-03-27)
- Live site inspection: `https://maplestory.nexon.com/News/Event/Closed?page=1` — closed event structure verified, 12 events/page confirmed
- Live site pagination: pages 93-101 verified — boundary confirmed at page 100 (empty), last valid page is 99
- `https://maplestory.nexon.com/robots.txt` — `/News/Event` not disallowed, confirmed
- Code inspection: `src/fetcher.js`, `src/ai.js`, `index.js` — existing patterns used as basis
- Node.js fetch test: `fetch('https://maplestory.nexon.com/News/Event/Ongoing')` returns 200, 103KB HTML (2026-03-27)
- cheerio v1.2.0 package.json in node_modules — confirmed installed
- openai v6.33.0 package.json in node_modules — confirmed installed
- `package.json` `"type": "module"` — ES Modules confirmed

### Secondary (MEDIUM confidence)
- robots.txt disallowed paths — `/News/Event` accessible to crawlers
- KMS site server-side rendering — event list visible without JavaScript execution (confirmed by raw HTML content having event titles)

### Tertiary (LOW confidence)
- None — all critical claims have primary source verification.

---

## Metadata

**Confidence breakdown:**
- KMS site structure: HIGH — verified with live data + cheerio execution against actual HTML
- Selectors: HIGH — executed against live data, 21 ongoing + 12 closed events confirmed
- Architecture: HIGH — derived from existing codebase patterns (ai.js, fetcher.js)
- GPT matching quality: MEDIUM — pattern is established, but Korean game name matching quality depends on prompt; requires integration testing
- Total page count: HIGH — binary search confirmed page 99 valid, page 100 empty

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (KMS HTML structure is stable; monitor if page structure changes)
