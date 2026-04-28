import { fetchNewsList } from "./fetcher.js";
import { getExistingNewsMap, upsertNews } from "./repository.js";
import { isNewsItem, extractBodyImageUrls, buildNewsUrl } from "./parser.js";
import { generateNewsTranslationWithAI } from "./ai.js";
import { extractBodyText } from "../../lib/parser.js";
import { fetchDetail, sleep } from "../../lib/fetcher.js";
import { extractTextFromImage } from "../../lib/ocr.js";
import {
  THROTTLE_MS,
  OCR_LIMIT,
  NEWS_OCR_MIN_TEXT_LENGTH,
} from "../../lib/constants.js";

function isSameLiveDate(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

async function resolveNewsContent({ bodyHtml, bodyText }) {
  const normalizedBodyText = bodyText.trim();

  if (normalizedBodyText.length >= NEWS_OCR_MIN_TEXT_LENGTH) {
    return normalizedBodyText;
  }

  const imageUrls = extractBodyImageUrls(bodyHtml).slice(0, OCR_LIMIT);
  if (!imageUrls.length) {
    return normalizedBodyText;
  }

  console.log(
    `[news | pipeline] body text too short (${normalizedBodyText.length}), trying OCR fallback`,
  );

  const ocrTexts = [];

  for (const url of imageUrls) {
    const text = (await extractTextFromImage(url)).trim();
    if (text) ocrTexts.push(text);
  }

  if (ocrTexts.length) {
    return ocrTexts.join("\n\n");
  }

  console.log("[news | pipeline] OCR fallback returned no usable text");
  return normalizedBodyText;
}

// 파이프라인
export async function runNewsPipeline() {
  // news 목록 상위 NEWS_LIMIT개 가져오기
  const tops = await fetchNewsList();
  if (!tops.length) {
    console.log("[news | pipeline] no eligible items after filter.");
    return;
  }

  // name 필터: maintenance 중 [Completed], Scheduled, Unscheduled로 시작하지 않는 항목만 저장 대상
  const candidates = tops.filter((item) => isNewsItem(item.name ?? ""));
  if (!candidates.length) {
    console.log("[news | pipeline] no eligible items after name filter.");
    return;
  }

  // DB에 이미 있는 항목 조회 -> 신규/이름 변경/liveDate 변경 시에만 재처리
  const ids = candidates.map((item) => String(item.id));
  const existingMap = await getExistingNewsMap(ids);
  const newItems = candidates.filter((item) => {
    const stored = existingMap.get(String(item.id));
    if (!stored) return true;
    if (stored.name !== item.name) return true;
    return !isSameLiveDate(stored.live_date, item.liveDate);
  });

  if (!newItems.length) {
    console.log("[news | pipeline] no new items to process.");
    return;
  }

  console.log(`[news | pipeline] ${newItems.length} new items to process`);

  // 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const rows = [];

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
    const category = detail.category ?? "update";
    const url = buildNewsUrl(id, category);
    const content = await resolveNewsContent({ bodyHtml, bodyText });
    const isMSCW = detail.isMSCW;

    // 번역본 생성
    const translation = await generateNewsTranslationWithAI({
      name,
      liveDate,
      content,
    });

    rows.push({
      id,
      name,
      live_date: liveDate,
      image_thumbnail: imageThumbnail,
      url,
      translation,
      is_mscw: isMSCW,
    });

    console.log(`[news | pipeline] id=${id} : saved`);
  }

  await upsertNews(rows);
}
