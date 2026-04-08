import { getClient } from "../../lib/supabase.js";

const TABLE = "events_v2";
const NON_EVENTS_TABLE = "non_events_v2";

/**
 * 주어진 id 배열 중 events_v2에 이미 존재하는 항목을 Map<id, name>으로 반환한다.
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
export async function getExistingEventMap(ids) {
  if (!ids.length) return new Map();

  try {
    const client = getClient();
    const { data, error } = await client
      .from(TABLE)
      .select("id, name")
      .in("id", ids);

    if (error) throw error;

    const existing = new Map(
      (data ?? []).map((row) => [String(row.id), row.name ?? ""]),
    );
    console.log(
      `[db] ${existing.size} of ${ids.length} ids already exist in events_v2`,
    );
    return existing;
  } catch (err) {
    console.error("[db] getExistingEventMap error:", err.message);
    throw err;
  }
}

// non event에 존재하는지
export async function getExistingNonEventIds(ids) {
  if (!ids.length) return new Set();

  try {
    const client = getClient();
    const { data, error } = await client
      .from(NON_EVENTS_TABLE)
      .select("id")
      .in("id", ids);

    if (error) throw error;

    const existing = new Set((data ?? []).map((row) => String(row.id)));
    console.log(
      `[db] ${existing.size} of ${ids.length} ids already exist in non_events_v2`,
    );

    return existing;
  } catch (err) {
    console.error("[db] getExistingNonEventIds error:", err.message);
    throw err;
  }
}

export async function getProcessed(ids) {
  const [eventMap, nonEventSet] = await Promise.all([
    getExistingEventMap(ids),
    getExistingNonEventIds(ids),
  ]);

  return { eventMap, nonEventSet };
}

export async function upsertEvents(rows) {
  if (!rows.length) {
    console.log("[db] No rows to upsert");
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    console.log(`[db] Upserted ${rows.length} rows`);
  } catch (err) {
    console.error("[db] upsertEvents error:", err.message);
    throw err;
  }
}

// 이벤트 아닌것들 db에 저장
/**
 * @param {Array<{id: string, name: string}>} rows
 */
export async function upsertNonEvents(rows) {
  if (!rows.length) {
    console.log("[db] No non-event rows to upsert");
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(NON_EVENTS_TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    console.log(`[db] Upserted ${rows.length} non-event rows`);
  } catch (err) {
    console.error("[db] upsertNonEvents error:", err.message);
    throw err;
  }
}
