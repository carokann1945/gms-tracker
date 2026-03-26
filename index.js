import 'dotenv/config';
import { fetchNewsList, fetchEventDetail, sleep } from './src/fetcher.js';
import { getExistingIds, upsertEvents } from './src/db.js';
import { extractTextFromImage } from './src/ocr.js';
import { extractBodyImageUrls, parseEventPeriod } from './src/parser.js';

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

  // 4. 상위 2개 항목에만 OCR 수행, 나머지는 event_period = null
  const ocrTargetIds = new Set(
    newDetails.slice(0, OCR_LIMIT).map((d) => String(d.id))
  );

  const rows = [];
  for (const detail of newDetails) {
    const id = String(detail.id);
    const isOcrTarget = ocrTargetIds.has(id);

    let event_period = null;

    if (isOcrTarget) {
      const bodyUrls = extractBodyImageUrls(detail.body ?? '');
      // body 이미지가 없으면 썸네일로 대체
      const imageUrl = bodyUrls[0] ?? detail.imageThumbnail ?? null;

      if (imageUrl) {
        const text = await extractTextFromImage(imageUrl);
        event_period = parseEventPeriod(text);
        console.log(
          `[main] id=${id} → period="${event_period ?? 'not found'}"`
        );
      } else {
        console.log(`[main] id=${id} → no image available for OCR`);
      }
    } else {
      console.log(`[main] id=${id} → OCR skipped (over limit)`);
    }

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
