import { getClient } from "../../lib/supabase.js";
import { NEWS_TABLE } from "../../lib/constants.js";

/**
 * 주어진 id 배열 중 news 테이블에 이미 존재하는 항목을 Map<id, {name, live_date}>로 반환한다.
 * @param {string[]} ids
 * @returns {Promise<Map<string, {name: string, live_date: string | null}>>}
 */
export async function getExistingNewsMap(ids) {
  if (!ids.length) return new Map();

  try {
    const client = getClient();
    const { data, error } = await client
      .from(NEWS_TABLE)
      .select("id, name, live_date")
      .in("id", ids);

    if (error) throw error;

    const existing = new Map(
      (data ?? []).map((row) => [
        String(row.id),
        { name: row.name ?? "", live_date: row.live_date ?? null },
      ]),
    );
    console.log(
      `[news | repository] ${existing.size} of ${ids.length} ids already exist in ${NEWS_TABLE}`,
    );
    return existing;
  } catch (err) {
    console.error("[news | repository] getExistingNewsMap error:", err.message);
    throw err;
  }
}

export async function getProcessed(ids) {
  return await getExistingNewsMap(ids);
}

export async function upsertNews(rows) {
  if (!rows.length) {
    console.log("[news | repository] No rows to upsert");
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(NEWS_TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    console.log(`[news | repository] upserted ${rows.length} rows`);
  } catch (err) {
    console.error("[news | repository] upsertNews error:", err.message);
    throw err;
  }
}
