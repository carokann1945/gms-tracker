import { fetchEventDetail, sleep } from "../../lib/fetcher.js";
import { fetchMaintenanceList } from "./fetcher.js";
import { extractBodyText } from "../../lib/parser.js";
import { getExistingMaintenanceIds, upsertMaintenance } from "./repository.js";
import {
  parseMaintenanceTimes,
  isMaintenanceItem,
  buildMaintenanceUrl,
} from "./parser.js";
import { extractMaintenanceTimesWithAI } from "./ai.js";

const THROTTLE_MS = 500;

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
    console.log("[maintenance] No maintenance items found.");
    return;
  }

  // 2. name 필터: "Scheduled" 또는 "Unscheduled"로 시작하는 항목만 저장 대상
  const candidates = top5.filter((item) => isMaintenanceItem(item.name ?? ""));
  if (!candidates.length) {
    console.log(
      "[maintenance] No eligible maintenance items after name filter.",
    );
    return;
  }

  // 3. DB에 이미 있는 id 확인 → 신규 항목만 추출
  const ids = candidates.map((item) => String(item.id));
  const existingIds = await getExistingMaintenanceIds(ids);
  const newItems = candidates.filter(
    (item) => !existingIds.has(String(item.id)),
  );

  if (!newItems.length) {
    console.log("[maintenance] No new maintenance items to process.");
    return;
  }

  console.log(`[maintenance] ${newItems.length} new item(s) to process`);

  // 4. 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const rows = [];
  for (const item of newItems) {
    await sleep(THROTTLE_MS);
    try {
      const detail = await fetchEventDetail(item.id);
      if (!detail) continue;

      const id = String(detail.id);
      const name = detail.name;
      const bodyText = extractBodyText(detail.body);

      // LLM 1차 파싱, 실패 시 regex fallback
      let times = await extractMaintenanceTimesWithAI({
        liveDate: detail.liveDate,
        content: bodyText,
      });
      if (!times) {
        times = parseMaintenanceTimes(bodyText);
      }
      const { start_at, end_at } = times;

      console.log(
        `[maintenance] id=${id} → start_at="${start_at ?? "not found"}" end_at="${end_at ?? "not found"}"`,
      );

      rows.push({
        id,
        name,
        start_at,
        end_at,
        url: buildMaintenanceUrl(id),
        live_date: detail.liveDate ?? null,
      });
    } catch (err) {
      console.error(
        `[maintenance] Failed to process id=${item.id}:`,
        err.message,
      );
    }
  }

  // 5. Supabase에 upsert
  await upsertMaintenance(rows);

  console.log("[maintenance] Done.");
}
