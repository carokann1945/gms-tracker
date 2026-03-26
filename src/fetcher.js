import { load } from 'cheerio';

const NEWS_LIST_URL = 'https://g.nexonstatic.com/maplestory/cms/v1/news';
const NEWS_DETAIL_URL = 'https://g.nexonstatic.com/maplestory/cms/v1/news';

/**
 * KMS 이벤트 페이지 HTML을 fetch하여 텍스트로 반환한다.
 * User-Agent 헤더 없으면 Nexon CDN/WAF가 빈 HTML을 반환할 수 있으므로 반드시 포함.
 * @param {string} url
 * @returns {Promise<string>}
 */
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

/**
 * KMS Ongoing 이벤트 페이지 HTML을 파싱하여 이벤트 목록을 반환한다.
 * 셀렉터: dt a[href] — /News/Event/{id} 패턴만 매칭 (Closed 링크 및 내비게이션 제외).
 * @param {string} html
 * @returns {Array<{id: string, name: string}>}
 */
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

/**
 * KMS Closed 이벤트 페이지 HTML을 파싱하여 이벤트 목록을 반환한다.
 * 셀렉터: dd.data em.event_listMt — 사이드바 Ongoing 이벤트 혼입 방지.
 * dt a 셀렉터는 Closed 페이지 사이드바(21개)를 혼합시키므로 사용 금지 (Pitfall 1).
 * @param {string} html
 * @returns {Array<{id: string, name: string}>}
 */
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Nexon 뉴스 목록 API에서 이벤트 카테고리 상위 10개를 반환한다.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
export async function fetchNewsList() {
  try {
    const res = await fetch(NEWS_LIST_URL);
    if (!res.ok) {
      throw new Error(`News list fetch failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();

    // API 응답 구조에 따라 items 배열 추출 (배열이거나 { items: [] } 형태)
    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);

    const events = items
      .filter((item) => item.category === 'events')
      .slice(0, 10);

    console.log(`[fetcher] Fetched ${items.length} news items, ${events.length} events (top 10)`);
    return events;
  } catch (err) {
    console.error('[fetcher] fetchNewsList error:', err.message);
    throw err;
  }
}

/**
 * KMS 이벤트 전체 목록을 스크래핑하여 반환한다.
 * Ongoing 이벤트(단일 페이지) + Closed 이벤트(페이지네이션, 최대 20페이지)를 합산.
 * GMS는 KMS 대비 ~6개월 지연이므로 최대 20페이지(~1-2년치)까지 조회한다.
 * 에러 발생 시 throw하지 않고 그 시점까지 수집된 배열을 반환한다.
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchKmsEventList() {
  const events = [];
  try {
    // 1. Ongoing events (단일 페이지 — 페이지네이션 불필요)
    const ongoingHtml = await fetchKmsPage(
      'https://maplestory.nexon.com/News/Event/Ongoing'
    );
    events.push(...parseOngoingEvents(ongoingHtml));
    console.log(`[fetcher] KMS ongoing: ${events.length} events`);

    // 2. Closed events (빈 페이지 감지 또는 최대 20페이지 도달 시 중단)
    // 20페이지 × 500ms throttle = ~10초, IP 차단 안전 범위
    let page = 1;
    while (page <= 20) {
      await sleep(500); // Nexon 서버 보호용 throttle
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
    // 에러 이전까지 수집된 이벤트 반환 (graceful degradation)
  }

  console.log(`[fetcher] KMS total: ${events.length} events`);
  return events;
}

/**
 * 단일 이벤트 상세 API를 호출하여 상세 데이터를 반환한다.
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function fetchEventDetail(id) {
  try {
    const res = await fetch(`${NEWS_DETAIL_URL}/${id}`);
    if (!res.ok) {
      throw new Error(`Detail fetch failed for id=${id}: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`[fetcher] fetchEventDetail error (id=${id}):`, err.message);
    return null;
  }
}
