import { createClient } from '@supabase/supabase-js';

const TABLE = 'events';

let _client = null;

function getClient() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  }

  _client = createClient(url, key);
  return _client;
}

/**
 * 주어진 id 배열 중 DB에 이미 존재하는 id를 Set으로 반환한다.
 * @param {string[]} ids
 * @returns {Promise<Set<string>>}
 */
export async function getExistingIds(ids) {
  if (!ids.length) return new Set();

  try {
    const client = getClient();
    const { data, error } = await client
      .from(TABLE)
      .select('id')
      .in('id', ids);

    if (error) throw error;

    const existing = new Set((data ?? []).map((row) => row.id));
    console.log(`[db] ${existing.size} of ${ids.length} ids already exist in DB`);
    return existing;
  } catch (err) {
    console.error('[db] getExistingIds error:', err.message);
    throw err;
  }
}

/**
 * 이벤트 행 배열을 Supabase에 upsert한다. PK(id) 기준 중복 방지.
 * @param {Array<{id: string, name: string, image_url?: string, event_period?: string|null}>} rows
 * @returns {Promise<void>}
 */
export async function upsertEvents(rows) {
  if (!rows.length) {
    console.log('[db] No rows to upsert');
    return;
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(TABLE)
      .upsert(rows, { onConflict: 'id' });

    if (error) throw error;

    console.log(`[db] Upserted ${rows.length} rows`);
  } catch (err) {
    console.error('[db] upsertEvents error:', err.message);
    throw err;
  }
}
