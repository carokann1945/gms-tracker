import { CMS_API_URL, EVENT_LIMIT } from "../../lib/constants.js";

function isEligibleEventItem(item) {
  const isEvent = item.category === "events";
  const isAllowedMode = item.isMSCW === false || item.isMSCW == null;
  return isEvent && isAllowedMode;
}

/**
 * Nexon 뉴스 목록 API에서 GMS 이벤트 상위 EVENT_LIMIT개를 반환한다.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
export async function fetchEventsList() {
  try {
    const res = await fetch(CMS_API_URL);
    if (!res.ok) {
      throw new Error(
        `Events list fetch failed: ${res.status} ${res.statusText}`,
      );
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);

    const events = items.filter(isEligibleEventItem).slice(0, EVENT_LIMIT);

    console.log(
      `[events | fetcher] fetched ${items.length} items, ${events.length} filtered`,
    );

    return events;
  } catch (err) {
    console.error("[events | fetcher] fetchEventsList error:", err.message);
    throw err;
  }
}
