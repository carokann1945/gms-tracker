const WEEKDAY_PATTERN =
  "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";

const HOT_WEEK_DATE_RE = new RegExp(
  `\\b(?:${WEEKDAY_PATTERN}),\\s+(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2}),\\s+(\\d{4})\\b`,
  "g",
);

const HOT_WEEK_BOX_RE = /hot week box\s*-/i;

const MERGED_DATE_BOUNDARY_RE = new RegExp(
  `(\\d{4})(?=(?:${WEEKDAY_PATTERN}),\\s+)`,
  "g",
);

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

export function isHotWeekNotice(name, bodyText = "") {
  const normalizedName = name?.toLowerCase() ?? "";
  if (normalizedName.includes("hot week")) return true;
  return HOT_WEEK_BOX_RE.test(bodyText);
}

function normalizeHotWeekText(bodyText) {
  return (bodyText ?? "")
    .replace(MERGED_DATE_BOUNDARY_RE, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseHotWeekDates(name, bodyText) {
  if (!isHotWeekNotice(name, bodyText)) return null;

  const normalizedText = normalizeHotWeekText(bodyText);
  if (!normalizedText) return null;

  const dates = [];
  const seen = new Set();

  for (const match of normalizedText.matchAll(HOT_WEEK_DATE_RE)) {
    const [, monthStr, dayStr, yearStr] = match;
    const month = MONTHS[monthStr];
    const day = Number(dayStr);
    const year = Number(yearStr);

    if (month === undefined) continue;

    const key = `${year}-${month}-${day}`;
    if (seen.has(key)) continue;
    seen.add(key);

    dates.push({ year, month, day });
  }

  if (dates.length < 2) return null;

  const first = dates[0];
  const last = dates[dates.length - 1];

  return {
    start_at: new Date(
      Date.UTC(first.year, first.month, first.day, 0, 0, 0),
    ).toISOString(),
    end_at: new Date(
      Date.UTC(last.year, last.month, last.day, 23, 59, 0),
    ).toISOString(),
  };
}
