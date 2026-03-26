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
