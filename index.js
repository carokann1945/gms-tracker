import "dotenv/config";
import { runEventsPipeline } from "./src/pipeline/events.js";
import { runMaintenancePipeline } from "./src/maintenance.js";

async function main() {
  // 이벤트 파이프라인 실행
  try {
    await runEventsPipeline();
  } catch (err) {
    console.error("[main] Events Pipeline failed:", err.message);
  }

  // 점검 파이프라인 실행 (이벤트가 실패해도 실행됨)
  try {
    await runMaintenancePipeline();
  } catch (err) {
    console.error("[main] Maintenance Pipeline failed:", err.message);
  }

  console.log("[main] All pipelines finished.");
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
