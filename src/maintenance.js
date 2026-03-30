import { fetchMaintenanceList, fetchEventDetail, sleep } from './fetcher.js';
import {
  getExistingMaintenanceIds,
  getMaxMaintenanceSourceIndex,
  upsertMaintenance,
} from './db.js';
import { extractBodyText } from './parser.js';

const THROTTLE_MS = 500;

const MONTHS = {
  January: 0, February: 1, March: 2, April: 3,
  May: 4, June: 5, July: 6, August: 7,
  September: 8, October: 9, November: 10, December: 11,
};

// extractBodyText()는 whitespace를 모두 space 1개로 collapse하므로
// "Times: Thursday, March 26, 2026 PDT (UTC -7): 5:00 AM - 11:00 PM" 형태가 됨
// UTC offset이 명시되지 않은 경우(e.g. "PST: 5:00 AM") TZ_OFFSET_MAP으로 fallback
const TZ_OFFSET_MAP = {
  PST: -8, PDT: -7,
  EST: -5, EDT: -4,
  MST: -7, MDT: -6,
  CST: -6, CDT: -5,
};

// 캡처 그룹: (monthStr)(dayStr)(yearStr)(tzAbbr)(offsetStr?)(startTimeStr)(endTimeStr?)
const TIMES_RE =
  /Times:\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})\s+(\w+)(?:\s*\(UTC\s*([+-]?\d+)\))?:\s+(\d{1,2}:\d{2}\s+[AP]M)(?:\s+-\s+(\d{1,2}:\d{2}\s+[AP]M))?/i;

/**
 * 저장 대상 여부를 판단한다.
 * "Scheduled" 또는 "Unscheduled"로 시작하는 항목만 점검 공지.
 * "V "로 시작하는 항목(버전 업데이트 등)은 제외.
 * @param {string} name
 * @returns {boolean}
 */
function isMaintenanceItem(name) {
  return name.startsWith('Scheduled') || name.startsWith('Unscheduled');
}

/**
 * maintenance 상세 페이지 URL을 생성한다.
 * buildGmsUrl과 동일한 slug 알고리즘, path만 /maintenance/.
 * @param {string|number} id
 * @param {string} name
 * @returns {string}
 */
function buildMaintenanceUrl(id, name) {
  const slug = name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `https://www.nexon.com/maplestory/news/maintenance/${id}/${slug}`;
}

/**
 * 12시간제 시간 문자열을 {hour, minutes}로 파싱한다.
 * "5:00 AM" → {hour:5, minutes:0}, "11:00 PM" → {hour:23, minutes:0}
 * @param {string} timeStr
 * @returns {{hour: number, minutes: number} | null}
 */
function parseTime12(timeStr) {
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s+([AP]M)/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'AM' && hour === 12) hour = 0;       // 12 AM → 자정(0시)
  else if (period === 'PM' && hour !== 12) hour += 12; // PM → 24시간제 변환
  return { hour, minutes };
}

/**
 * body 텍스트에서 "Times:" 블록을 찾아 start/end UTC ISO 문자열을 반환한다.
 * UTC offset이 텍스트에 명시되어 있으므로 외부 라이브러리 불필요.
 * cross-midnight 자동 처리: 23:00 PDT(UTC-7) + 7h = 30:00 → Date()가 다음날로 롤오버.
 * @param {string} bodyText
 * @returns {{start: string|null, end: string|null}}
 */
function parseMaintenanceTimes(bodyText) {
  if (!bodyText) return { start_at: null, end_at: null };

  const m = bodyText.match(TIMES_RE);
  if (!m) return { start_at: null, end_at: null };

  const [, monthStr, dayStr, yearStr, tzAbbr, offsetStr, startTimeStr, endTimeStr] = m;

  const month = MONTHS[monthStr];
  if (month === undefined) return { start_at: null, end_at: null };

  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);

  // UTC offset: 텍스트 명시값 우선, 없으면 timezone 약어로 fallback
  let offsetHours;
  if (offsetStr !== undefined) {
    offsetHours = parseInt(offsetStr, 10);
  } else {
    offsetHours = TZ_OFFSET_MAP[tzAbbr?.toUpperCase()];
    if (offsetHours === undefined) return { start_at: null, end_at: null };
  }

  const startTime = parseTime12(startTimeStr.trim());
  if (!startTime) return { start_at: null, end_at: null };

  const baseDayMs = Date.UTC(year, month, day);
  const startMs = baseDayMs + (startTime.hour - offsetHours) * 3_600_000 + startTime.minutes * 60_000;

  let end_at = null;
  if (endTimeStr) {
    const endTime = parseTime12(endTimeStr.trim());
    if (endTime) {
      const endMs = baseDayMs + (endTime.hour - offsetHours) * 3_600_000 + endTime.minutes * 60_000;
      end_at = new Date(endMs).toISOString();
    }
  }

  return {
    start_at: new Date(startMs).toISOString(),
    end_at,
  };
}

/**
 * maintenance 전용 파이프라인을 실행한다.
 * events 파이프라인과 동일한 구조: 목록 fetch → name 필터 → dedup → 상세 fetch → 파싱 → upsert.
 * OCR/AI 없이 body 텍스트의 "Times:" 블록을 정규식으로 파싱.
 * @returns {Promise<void>}
 */
export async function runMaintenancePipeline() {
  // 1. maintenance 목록 상위 5개 가져오기
  const top5 = await fetchMaintenanceList();
  if (!top5.length) {
    console.log('[maintenance] No maintenance items found.');
    return;
  }

  // 2. name 필터: "Scheduled" 또는 "Unscheduled"로 시작하는 항목만 저장 대상
  const candidates = top5.filter((item) => isMaintenanceItem(item.name ?? ''));
  if (!candidates.length) {
    console.log('[maintenance] No eligible maintenance items after name filter.');
    return;
  }

  // 3. DB에 이미 있는 id 확인 → 신규 항목만 추출
  const ids = candidates.map((item) => String(item.id));
  const existingIds = await getExistingMaintenanceIds(ids);
  const newItems = candidates.filter((item) => !existingIds.has(String(item.id)));

  if (!newItems.length) {
    console.log('[maintenance] No new maintenance items to process.');
    return;
  }

  console.log(`[maintenance] ${newItems.length} new item(s) to process`);

  // 전역 단조 증가 source_index: 신규 항목에 DB 현재 최댓값 이후 번호 부여
  // newItems[0](최신) → currentMax + length (최고값), newItems[last] → currentMax + 1
  const currentMax = await getMaxMaintenanceSourceIndex();
  const sourceIndexMap = new Map(
    newItems.map((item, i) => [String(item.id), currentMax + newItems.length - i])
  );

  // 4. 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const rows = [];
  for (const item of newItems) {
    await sleep(THROTTLE_MS);
    try {
      const detail = await fetchEventDetail(item.id);
      if (!detail) continue;

      const id = String(detail.id);
      const name = detail.name ?? detail.title ?? '';
      const bodyText = extractBodyText(detail.body ?? '');
      const { start_at, end_at } = parseMaintenanceTimes(bodyText);

      console.log(`[maintenance] id=${id} → start_at="${start_at ?? 'not found'}" end_at="${end_at ?? 'not found'}"`);

      rows.push({
        id,
        name,
        start_at,
        end_at,
        url: buildMaintenanceUrl(id, name),
        source_index: sourceIndexMap.get(id) ?? null,
      });
    } catch (err) {
      console.error(`[maintenance] Failed to process id=${item.id}:`, err.message);
    }
  }

  // 5. Supabase에 upsert
  await upsertMaintenance(rows);

  console.log('[maintenance] Done.');
}
