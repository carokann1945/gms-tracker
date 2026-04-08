const CMS_API_URL = "https://g.nexonstatic.com/maplestory/cms/v1/news";
const EVENT_LIMIT = 20;

function isEligibleEventItem(item) {
  const isEvent = item.category === "events";
  const isAllowedMode = item.isMSCW === false || item.isMSCW == null;
  return isEvent && isAllowedMode;
}

/**
 * Nexon 뉴스 목록 API에서 GMS 이벤트 대상 상위 20개를 반환한다.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
export async function fetchEventsList() {
  try {
    const res = await fetch(CMS_API_URL);
    if (!res.ok) {
      throw new Error(
        `Event list fetch failed: ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);

    const events = items.filter(isEligibleEventItem).slice(0, EVENT_LIMIT);

    console.log(
      `[fetcher] Fetched ${items.length} news items, ${events.length} event items`,
    );

    return events;
  } catch (err) {
    console.error("[fetcher] fetchEventList error:", err.message);
    throw err;
  }
}
