import { fetchNewsList, fetchEventDetail, sleep } from "../fetcher.js";
import { getProcessedIds, upsertEvents, upsertNonEvents } from "../db.js";
import {
  extractBodyText,
  extractBodyImageUrls,
  buildGmsUrl,
} from "../parser.js";
import { extractTextFromImage } from "../ocr.js";
import { extractEventPeriodWithAI, generateEventSummaryWithAI } from "../ai.js";
import { isHotWeekNotice, parseHotWeekDates } from "../domain/hotWeek.js";

const THROTTLE_MS = 500;
const OCR_LIMIT = 30;
const EVENT_LIMIT = 10;

function isEligibleEventItem(item) {
  const isEvent = item.category === "events";
  const isAllowedMode = item.isMSCW === false || item.isMSCW == null;
  return isEvent && isAllowedMode;
}

function shouldSkipKmsMatch(name) {
  const normalizedName = name?.toLowerCase() ?? "";
  return (
    normalizedName.includes("miracle") || normalizedName.includes("hot week")
  );
}

async function extractEventPeriod({ liveDate, name, bodyHtml, bodyText }) {
  const hotWeek = isHotWeekNotice(name, bodyText);

  if (hotWeek) {
    const parsed = parseHotWeekDates(name, bodyText);

    if (parsed?.start_at && parsed?.end_at) {
      return { ...parsed, summary_input: bodyText || null };
    }
  }

  if (liveDate && bodyText) {
    const parsed = await extractEventPeriodWithAI({
      liveDate,
      content: bodyText,
    });

    if (parsed?.start_at && parsed?.end_at) {
      return { ...parsed, summary_input: bodyText };
    }
  }

  if (liveDate) {
    const imageUrls = extractBodyImageUrls(bodyHtml).slice(0, OCR_LIMIT);
    const ocrTexts = [];

    for (const url of imageUrls) {
      const text = await extractTextFromImage(url);
      if (text) ocrTexts.push(text);
    }

    if (ocrTexts.length) {
      const ocrContent = ocrTexts.join("\n\n");
      const parsed = await extractEventPeriodWithAI({
        liveDate,
        content: ocrContent,
      });

      if (parsed?.start_at && parsed?.end_at) {
        return { ...parsed, summary_input: ocrContent };
      }
    }
  }

  return null;
}

export async function runEventsPipeline() {
  const items = await fetchNewsList();
  const candidates = items.filter(isEligibleEventItem).slice(0, EVENT_LIMIT);

  if (!candidates.length) {
    console.log("[events] No event items found.");
    return;
  }

  const ids = candidates.map((item) => String(item.id));
  const processedIds = await getProcessedIds(ids);
  const newItems = candidates.filter(
    (item) => !processedIds.has(String(item.id)),
  );

  if (!newItems.length) {
    console.log("[events] No new items to process.");
    return;
  }

  console.log(`[events] ${newItems.length} new item(s) to process`);

  const eventRows = [];
  const nonEventRows = [];

  for (const item of newItems) {
    await sleep(THROTTLE_MS);

    const detail = await fetchEventDetail(item.id);
    if (!detail) continue;

    const id = String(detail.id);
    const name = detail.name ?? "";
    const liveDate = detail.liveDate ?? null;
    const bodyHtml = detail.body ?? "";
    const bodyText = extractBodyText(bodyHtml);
    const imageThumbnail = detail.imageThumbnail ?? null;

    const parsed = await extractEventPeriod({
      liveDate,
      name,
      bodyHtml,
      bodyText,
    });

    if (parsed?.start_at && parsed?.end_at) {
      const gms_url = buildGmsUrl(id, name);

      const summary = parsed.summary_input
        ? await generateEventSummaryWithAI({
            name,
            liveDate,
            content: parsed.summary_input,
          })
        : null;

      eventRows.push({
        id,
        name,
        live_date: liveDate,
        image_thumbnail: imageThumbnail,
        start_at: parsed.start_at,
        end_at: parsed.end_at,
        gms_url,
        summary,
      });

      console.log(
        `[events] id=${id} → start_at="${parsed.start_at}" end_at="${parsed.end_at}"`,
      );
      continue;
    }

    nonEventRows.push({
      id,
      name,
    });

    console.log(`[events] id=${id} → saved as non-event`);
  }

  await upsertEvents(eventRows);
  await upsertNonEvents(nonEventRows);
}
