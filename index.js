import 'dotenv/config';
import { fetchNewsList, fetchEventDetail, sleep, fetchKmsEventList } from './src/fetcher.js';
import { findKmsUrl } from './src/matcher.js';
import { getExistingIds, upsertEvents } from './src/db.js';
import { extractTextFromImage } from './src/ocr.js';
import { extractBodyImageUrls, extractBodyText, buildGmsUrl } from './src/parser.js';
import { extractEventPeriodWithAI } from './src/ai.js';

const THROTTLE_MS = 500;
const OCR_LIMIT = 2;

async function main() {
  // 1. 이벤트 목록 상위 10개 가져오기
  const top10 = await fetchNewsList();
  if (!top10.length) {
    console.log('[main] No event items found. Exiting.');
    return;
  }

  // 2. DB에 이미 있는 id 확인 → 신규 항목만 추출
  const ids = top10.map((item) => String(item.id));
  const existingIds = await getExistingIds(ids);
  const newItems = top10.filter((item) => !existingIds.has(String(item.id)));

  if (!newItems.length) {
    console.log('[main] No new items to process. Exiting.');
    return;
  }

  console.log(`[main] ${newItems.length} new item(s) to process`);

  // ★ KMS 이벤트 목록을 루프 전 1회 로드
  const kmsList = await fetchKmsEventList();

  // 3. 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const newDetails = [];
  for (const item of newItems) {
    await sleep(THROTTLE_MS);
    try {
      const detail = await fetchEventDetail(item.id);
      if (detail) newDetails.push(detail);
    } catch (err) {
      console.error(`[main] Failed to fetch detail for id=${item.id}:`, err.message);
    }
  }

  // 4. 각 이벤트마다 다중 계층 추출로 날짜 파싱
  const rows = [];
  for (const detail of newDetails) {
    const id = String(detail.id);
    const bodyHtml = detail.body ?? '';
    let event_period = null;

    // 1계층: HTML 텍스트 → AI 정제 1차 시도
    const bodyText = extractBodyText(bodyHtml);
    event_period = await extractEventPeriodWithAI(bodyText);

    if (!event_period) {
      // 2계층: 이미지 상위 2장 OCR 텍스트를 합쳐서 AI에 1회만 질의
      const candidates = extractBodyImageUrls(bodyHtml).slice(0, OCR_LIMIT);
      const ocrTexts = [];
      for (const imageUrl of candidates) {
        const ocrText = await extractTextFromImage(imageUrl);
        if (ocrText) ocrTexts.push(ocrText);
      }
      if (ocrTexts.length) {
        event_period = await extractEventPeriodWithAI(ocrTexts.join('\n\n'));
      }
    }

    console.log(`[main] id=${id} → period="${event_period ?? 'not found'}"`);

    const eventName = detail.name ?? detail.title ?? '';
    const kms_url = await findKmsUrl(eventName, kmsList);

    rows.push({
      id,
      name: eventName,
      image_url: detail.imageThumbnail ?? null,
      event_period,
      gms_url: buildGmsUrl(id, eventName),
      kms_url,
    });
  }

  // 5. Supabase에 upsert
  await upsertEvents(rows);

  console.log('[main] Done.');
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
