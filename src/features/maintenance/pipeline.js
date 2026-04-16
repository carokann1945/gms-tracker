import { fetchDetail, sleep } from "../../lib/fetcher.js";
import { fetchMaintenanceList } from "./fetcher.js";
import { extractMaintenanceBodyText } from "../../lib/parser.js";
import { getExistingMaintenanceIds, upsertMaintenance } from "./repository.js";
import {
  parseMaintenanceTimes,
  isMaintenanceItem,
  buildMaintenanceUrl,
} from "./parser.js";
import { extractMaintenanceTimesWithAI } from "./ai.js";
import { THROTTLE_MS } from "../../lib/constants.js";

/**
 * maintenance 전용 파이프라인을 실행
 * @returns {Promise<void>}
 */
export async function runMaintenancePipeline() {
  // maintenance 목록 상위 N개 가져오기
  const top5 = await fetchMaintenanceList();
  if (!top5.length) {
    console.log("[maintenance | pipeline] no items found.");
    return;
  }

  // name 필터: "Scheduled" 또는 "Unscheduled"로 시작하는 항목만 저장 대상
  const candidates = top5.filter((item) => isMaintenanceItem(item.name ?? ""));
  if (!candidates.length) {
    console.log(
      "[maintenance | pipeline] no eligible items after name filter.",
    );
    return;
  }

  // DB에 이미 있는 id 확인 → 신규 항목만 추출
  const ids = candidates.map((item) => String(item.id));
  const existingIds = await getExistingMaintenanceIds(ids);
  const newItems = candidates.filter(
    (item) => !existingIds.has(String(item.id)),
  );

  if (!newItems.length) {
    console.log("[maintenance | pipeline] No new items to process.");
    return;
  }

  console.log(
    `[maintenance | pipeline] ${newItems.length} new items to process`,
  );

  // 신규 항목 상세 API 순차 호출 (0.5초 throttle)
  const rows = [];

  for (const item of newItems) {
    await sleep(THROTTLE_MS);
    try {
      const detail = await fetchDetail(item.id);
      if (!detail) continue;

      const id = String(detail.id);
      const name = detail.name;
      const bodyText = extractMaintenanceBodyText(detail.body);

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
        `[maintenance | pipeline] id=${id} → start_at="${start_at ?? "not found"}" end_at="${end_at ?? "not found"}"`,
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
        `[maintenance | pipeline] failed to process id=${item.id}:`,
        err.message,
      );
    }
  }

  // Supabase에 upsert
  await upsertMaintenance(rows);

  console.log("[maintenance | pipeline] done.");
}
