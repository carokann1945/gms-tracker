import { CMS_API_URL, NEWS_LIMIT } from "../../lib/constants.js";

function isEligibleNewsItem(item) {
  const isNews = item.category !== "events";
  return isNews;
}

/**
 * Nexon 뉴스 목록 API에서 Events 제외 상위 NEW_LIMIT개를 반환한다.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
export async function fetchNewsList() {
  try {
    const res = await fetch(CMS_API_URL);
    if (!res.ok) {
      throw new Error(
        `News list fetch failed: ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);
    const news = items.filter(isEligibleNewsItem).slice(0, NEWS_LIMIT);

    console.log(
      `[news | fetcher] fetched ${items.length} items, ${news.length} filtered`,
    );

    return news;
  } catch (err) {
    console.error("[news | fetcher] fetchNewsList error:", err.message);
    throw err;
  }
}
