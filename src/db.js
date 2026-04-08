import { createClient } from "@supabase/supabase-js";

const TABLE = "events_v2";
const NON_EVENTS_TABLE = "non_events_v2";
const MAINTENANCE_TABLE = "maintenance_v2";

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
 *   kms_url?: string|null,
 *   summary?: string|null
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
 * maintenance_v2 행 배열을 Supabase에 upsert한다. PK(id) 기준 중복 방지.
 * @param {Array<{id: string, name: string, start_at: string|null, end_at: string|null, url: string, live_date: string|null}>} rows
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
