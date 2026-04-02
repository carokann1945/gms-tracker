import { createClient } from "@supabase/supabase-js";

const TABLE = "events_v2";
const NON_EVENTS_TABLE = "non_events_v2";
const MAINTENANCE_TABLE = "maintenance";

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env",
    );
  }

  _client = createClient(url, key);
  return _client;
}

/**
 * 주어진 id 배열 중 DB에 이미 존재하는 id를 Set으로 반환한다.
 * @param {string[]} ids
 * @returns {Promise<Set<string>>}
 */
export async function getExistingEventIds(ids) {
  if (!ids.length) return new Set();

  try {
    const client = getClient();
    const { data, error } = await client.from(TABLE).select("id").in("id", ids);

    if (error) throw error;

    const existing = new Set((data ?? []).map((row) => row.id));
    console.log(
      `[db] ${existing.size} of ${ids.length} ids already exist in DB`,
    );
    return existing;
  } catch (err) {
    console.error("[db] getExistingEventIds error:", err.message);
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

    return new Set((data ?? []).map((row) => row.id));
  } catch (err) {
    console.error("[db] getExistingNonEventIds error:", err.message);
    throw err;
  }
}

// 익시스팅 논이벤트 합치기
export async function getProcessedIds(ids) {
  const [eventIds, nonEventIds] = await Promise.all([
    getExistingEventIds(ids),
    getExistingNonEventIds(ids),
  ]);

  return new Set([...eventIds, ...nonEventIds]);
}

/**
 * 이벤트 행 배열을 Supabase에 upsert한다. PK(id) 기준 중복 방지.
 * @param {Array<{
 *   id: string,
 *   name: string,
 *   live_date?: string|null,
 *   image_thumbnail?: string|null,
 *   start_at?: string|null,
 *   end_at?: string|null,
 *   gms_url?: string|null,
 *   kms_url?: string|null
 * }>} rows
 */
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

/**
 * 주어진 id 배열 중 maintenance 테이블에 이미 존재하는 id를 Set으로 반환한다.
 * @param {string[]} ids
 * @returns {Promise<Set<string>>}
 */
export async function getExistingMaintenanceIds(ids) {
  if (!ids.length) return new Set();

  try {
    const client = getClient();
    const { data, error } = await client
      .from(MAINTENANCE_TABLE)
      .select("id")
      .in("id", ids);

    if (error) throw error;

    const existing = new Set((data ?? []).map((row) => row.id));
    console.log(
      `[db] ${existing.size} of ${ids.length} maintenance ids already exist in DB`,
    );
    return existing;
  } catch (err) {
    console.error("[db] getExistingMaintenanceIds error:", err.message);
    throw err;
  }
}

/**
 * 현재 maintenance 테이블의 source_index 최댓값을 반환한다. 데이터 없으면 0 반환.
 * @returns {Promise<number>}
 */
export async function getMaxMaintenanceSourceIndex() {
  try {
    const client = getClient();
    const { data, error } = await client
      .from(MAINTENANCE_TABLE)
      .select("source_index")
      .order("source_index", { ascending: false })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.source_index ?? 0;
  } catch (err) {
    console.error("[db] getMaxMaintenanceSourceIndex error:", err.message);
    throw err;
  }
}

/**
 * maintenance 행 배열을 Supabase에 upsert한다. PK(id) 기준 중복 방지.
 * @param {Array<{id: string, name: string, start_at: string|null, end_at: string|null, url: string, source_index: number|null}>} rows
 * @returns {Promise<void>}
 */
export async function upsertMaintenance(rows) {
  if (!rows.length) {
    console.log("[db] No maintenance rows to upsert");
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(MAINTENANCE_TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    console.log(`[db] Upserted ${rows.length} maintenance rows`);
  } catch (err) {
    console.error("[db] upsertMaintenance error:", err.message);
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
