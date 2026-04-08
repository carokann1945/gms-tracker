const CMS_API_URL = "https://g.nexonstatic.com/maplestory/cms/v1/news";

/**
 * Nexon 뉴스 목록 API에서 maintenance 카테고리 상위 5개를 반환한다.
 * @returns {Promise<Array<{id: string, [key: string]: any}>>}
 */
export async function fetchMaintenanceList() {
  try {
    const res = await fetch(CMS_API_URL);
    if (!res.ok) {
      throw new Error(
        `Maintenance list fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const data = await res.json();

    const items = Array.isArray(data) ? data : (data.items ?? data.data ?? []);

    const maintenance = items
      .filter((item) => item.category === "maintenance")
      .slice(0, 5);

    console.log(
      `[fetcher] Fetched ${items.length} news items, ${maintenance.length} maintenance (top 5)`,
    );
    return maintenance;
  } catch (err) {
    console.error("[fetcher] fetchMaintenanceList error:", err.message);
    throw err;
  }
}
