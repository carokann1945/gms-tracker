import { getClient } from "../../lib/supabase.js";
import { MAINTENANCE_TABLE } from "../../lib/constants.js";

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

    const existing = new Set((data ?? []).map((row) => String(row.id)));
    console.log(
      `[maintenance | repository] ${existing.size} of ${ids.length} ids already exist in ${MAINTENANCE_TABLE}`,
    );
    return existing;
  } catch (err) {
    console.error(
      "[maintenance | repository] getExistingMaintenanceIds error:",
      err.message,
    );
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
    console.log("[maintenance | repository] no rows to upsert");
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(MAINTENANCE_TABLE)
      .upsert(rows, { onConflict: "id" });

    if (error) throw error;

    console.log(`[maintenance | repository] upserted ${rows.length} rows`);
  } catch (err) {
    console.error(
      "[maintenance | repository] upsertMaintenance error:",
      err.message,
    );
    throw err;
  }
}
