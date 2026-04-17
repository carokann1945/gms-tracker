import { fetchEventsList } from "./fetcher.js";
import { getProcessed, upsertEvents, upsertNonEvents } from "./repository.js";
import { extractBodyImageUrls, buildEventsUrl } from "./parser.js";
import { extractEventPeriodWithAI, generateEventSummaryWithAI } from "./ai.js";
import { isHotWeekNotice, parseHotWeekDates } from "./hotWeek.js";
import { extractBodyText } from "../../lib/parser.js";
import { fetchDetail, sleep } from "../../lib/fetcher.js";
import { extractTextFromImage } from "../../lib/ocr.js";
import { THROTTLE_MS, OCR_LIMIT } from "../../lib/constants.js";

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
  const candidates = await fetchEventsList();

  if (!candidates.length) {
    console.log("[events | pipeline] no event items found.");
    return;
  }

  const ids = candidates.map((item) => String(item.id));
  const { eventMap, nonEventSet } = await getProcessed(ids);
  const newItems = candidates.filter((item) => {
    const id = String(item.id);
    if (nonEventSet.has(id)) return false;
    const storedName = eventMap.get(id);
    return storedName === undefined || storedName !== item.name;
  });

  if (!newItems.length) {
    console.log("[events | pipeline] no new items to process.");
    return;
  }

  console.log(`[events | pipeline] ${newItems.length} new items to process`);

  const eventRows = [];
  const nonEventRows = [];

  for (const item of newItems) {
    await sleep(THROTTLE_MS);

    const detail = await fetchDetail(item.id);
    if (!detail) continue;

    const id = String(detail.id);
    const name = detail.name ?? "";
    const liveDate = detail.liveDate ?? null;
    const bodyHtml = detail.body ?? "";
    const bodyText = extractBodyText(bodyHtml);
    const imageThumbnail = detail.imageThumbnail ?? null;
    const isMSCW = detail.isMSCW;

    const parsed = await extractEventPeriod({
      liveDate,
      name,
      bodyHtml,
      bodyText,
    });

    if (parsed?.start_at && parsed?.end_at) {
      const gms_url = buildEventsUrl(id);

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
        is_mscw: isMSCW,
      });

      console.log(
        `[events | pipeline] id=${id} → start_at="${parsed.start_at}" end_at="${parsed.end_at}"`,
      );
      continue;
    }

    nonEventRows.push({
      id,
      name,
    });

    console.log(`[events | pipeline] id=${id} → saved as non-event`);
  }

  await upsertEvents(eventRows);
  await upsertNonEvents(nonEventRows);
}
