const MONTHS = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

// extractBodyText()는 whitespace를 모두 space 1개로 collapse하므로
// "Times: Thursday, March 26, 2026 PDT (UTC -7): 5:00 AM - 11:00 PM" 형태가 됨
// UTC offset이 명시되지 않은 경우(e.g. "PST: 5:00 AM") TZ_OFFSET_MAP으로 fallback
const TZ_OFFSET_MAP = {
  PST: -8,
  PDT: -7,
  EST: -5,
  EDT: -4,
  MST: -7,
  MDT: -6,
  CST: -6,
  CDT: -5,
};

const TIMES_RE =
  /Times:\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})\s+(\w+)(?:\s*\(UTC\s*([+-]?\d+)\))?:\s+(\d{1,2}:\d{2}\s+[AP]M)(?:\s+-\s+(\d{1,2}:\d{2}\s+[AP]M)(?:\s+(\w+)\s+(\d{1,2}))?)?/i;

/**
 * 저장 대상 여부를 판단한다.
 * "Scheduled" 또는 "Unscheduled"로 시작하는 항목만 점검 공지.
 * @param {string} name
 * @returns {boolean}
 */
export function isMaintenanceItem(name) {
  const lowerName = (name ?? "").toLowerCase();
  return (
    lowerName.startsWith("scheduled") || lowerName.startsWith("unscheduled")
  );
  // return !lowerName.startsWith("v");
}

/**
 * maintenance 상세 페이지 URL을 생성한다.
 * buildGmsUrl과 동일한 slug 알고리즘, path만 /maintenance/.
 * @param {string|number} id
 * @returns {string}
 */
export function buildMaintenanceUrl(id) {
  return `https://www.nexon.com/maplestory/news/maintenance/${id}`;
}

/**
 * 12시간제 시간 문자열을 {hour, minutes}로 파싱한다.
 * "5:00 AM" → {hour:5, minutes:0}, "11:00 PM" → {hour:23, minutes:0}
 * @param {string} timeStr
 * @returns {{hour: number, minutes: number} | null}
 */
export function parseTime12(timeStr) {
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s+([AP]M)/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "AM" && hour === 12)
    hour = 0; // 12 AM → 자정(0시)
  else if (period === "PM" && hour !== 12) hour += 12; // PM → 24시간제 변환
  return { hour, minutes };
}

/**
 * body 텍스트에서 "Times:" 블록을 찾아 start/end UTC ISO 문자열을 반환한다.
 * UTC offset이 텍스트에 명시되어 있으므로 외부 라이브러리 불필요.
 * cross-midnight 자동 처리: 23:00 PDT(UTC-7) + 7h = 30:00 → Date()가 다음날로 롤오버.
 * @param {string} bodyText
 * @returns {{start: string|null, end: string|null}}
 */
export function parseMaintenanceTimes(bodyText) {
  if (!bodyText) return { start_at: null, end_at: null };

  const m = bodyText.match(TIMES_RE);
  if (!m) return { start_at: null, end_at: null };

  const [
    ,
    monthStr,
    dayStr,
    yearStr,
    tzAbbr,
    offsetStr,
    startTimeStr,
    endTimeStr,
    endMonthStr,
    endDayStr,
  ] = m;

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
  const startMs =
    baseDayMs +
    (startTime.hour - offsetHours) * 3_600_000 +
    startTime.minutes * 60_000;

  let end_at = null;
  if (endTimeStr) {
    const endTime = parseTime12(endTimeStr.trim());
    if (endTime) {
      let endBaseDayMs = baseDayMs;
      if (endMonthStr && endDayStr) {
        const endMonth = MONTHS[endMonthStr];
        const endDay = parseInt(endDayStr, 10);
        if (endMonth !== undefined) {
          endBaseDayMs = Date.UTC(year, endMonth, endDay);
          // 연말 롤오버: 12/31 시작 → 1/1 종료 케이스 대응
          if (endBaseDayMs < baseDayMs) {
            endBaseDayMs = Date.UTC(year + 1, endMonth, endDay);
          }
        }
      }
      const endMs =
        endBaseDayMs +
        (endTime.hour - offsetHours) * 3_600_000 +
        endTime.minutes * 60_000;
      end_at = new Date(endMs).toISOString();
    }
  }

  return {
    start_at: new Date(startMs).toISOString(),
    end_at,
  };
}
