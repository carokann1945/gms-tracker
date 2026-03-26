import 'dotenv/config';
import { fetchNewsList, fetchEventDetail, sleep } from './src/fetcher.js';
import { getExistingIds, upsertEvents } from './src/db.js';
import { extractTextFromImage } from './src/ocr.js';
import { extractBodyImageUrls, extractBodyText } from './src/parser.js';
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

  // 3. 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const newDetails = [];
  for (const item of newItems) {
    await sleep(THROTTLE_MS);
    const detail = await fetchEventDetail(item.id);
    if (detail) {
      newDetails.push(detail);
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
      // 2계층: 이미지 상위 2장 OCR → AI 정제 2차 시도
      const candidates = extractBodyImageUrls(bodyHtml).slice(0, OCR_LIMIT);
      for (const imageUrl of candidates) {
        const ocrText = await extractTextFromImage(imageUrl);
        event_period = await extractEventPeriodWithAI(ocrText);
        if (event_period) break;
      }
    }

    console.log(`[main] id=${id} → period="${event_period ?? 'not found'}"`);

    rows.push({
      id,
      name: detail.name ?? detail.title ?? '',
      image_url: detail.imageThumbnail ?? null,
      event_period,
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
