import { gemini, GEMINI_MODEL } from "../../lib/ai.js";

function buildMaintenancePeriodPrompt({ liveDate, content }) {
  return `
You are extracting the maintenance window from a MapleStory maintenance notice.

Rules:
1. Find the "Times:" section in the content.
2. Extract the start and end times.
3. Multiple timezones are listed — use the entry with an explicit UTC offset (e.g. "(UTC -7)") to convert to UTC. Prefer PDT/PST if no explicit UTC entry exists.
4. Handle cross-midnight end times correctly (e.g. "4:00 AM April 10" when start is April 9).
5. Use liveDate to infer the year if not stated.
6. Return JSON only.

liveDate: ${liveDate}

Return exactly:
{"valid":true,"start_at":"...","end_at":"...","reason":null}
or
{"valid":false,"start_at":null,"end_at":null,"reason":"..."}

Content:
${content}
`.trim();
}

export async function extractMaintenanceTimesWithAI({ liveDate, content }) {
  if (!liveDate || !content) return null;

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildMaintenancePeriodPrompt({ liveDate, content }),
      config: {
        systemInstruction: "Return JSON only.",
        temperature: 0,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
      },
    });

    const result = response.text;
    if (!result) return null;

    const parsed = JSON.parse(result);

    if (!parsed.valid) {
      console.log(
        `[maintenance | ai] invalid maintenance times: ${parsed.reason ?? "unknown reason"}`,
      );
      return null;
    }

    if (
      typeof parsed.start_at !== "string" ||
      typeof parsed.end_at !== "string"
    ) {
      console.error(
        "[maintenance | ai] invalid maintenance JSON shape:",
        parsed,
      );
      return null;
    }

    return {
      start_at: parsed.start_at,
      end_at: parsed.end_at,
    };
  } catch (err) {
    console.error("[maintenance | ai] AI call failed:", err.message);
    return null;
  }
}
