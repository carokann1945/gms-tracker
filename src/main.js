import "dotenv/config";
import { runMaintenancePipeline } from "./features/maintenance/pipeline.js";
import { runEventsPipeline } from "./features/events/pipeline.js";
import { runNewsPipeline } from "./features/news/pipeline.js";

async function main() {
  // 이벤트 파이프라인 실행
  try {
    await runEventsPipeline();
  } catch (err) {
    console.error("[main] events pipeline failed:", err.message);
  }

  // 점검 파이프라인 실행 (이벤트가 실패해도 실행됨)
  try {
    await runMaintenancePipeline();
  } catch (err) {
    console.error("[main] maintenance pipeline failed:", err.message);
  }

  try {
    await runNewsPipeline();
  } catch (err) {
    console.error("[main] news pipeline failed:", err.message);
  }

  console.log("[main] all pipelines finished.");
}

main().catch((err) => {
  console.error("[main] fatal error:", err);
  process.exit(1);
});
