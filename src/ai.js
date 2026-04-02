import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildEventPeriodPrompt({ liveDate, content }) {
  return `
You are extracting the single representative event period from a MapleStory event notice.

Rules:
1. Extract only the FIRST valid start/end pair that appears in the content.
2. Use the provided liveDate to infer omitted year values.
3. Use only UTC as the final output timezone.
4. If UTC is present, use UTC.
5. If UTC is not present but PDT/PST is present, use that timezone and convert to UTC.
6. Ignore all other parallel timezones such as CET, CEST, AEDT, AEST, etc.
7. If the start date has no explicit time or uses phrases like "after maintenance", set start time to 00:00 UTC.
8. If the end date exists but has no explicit time, set end time to 23:59 UTC.
9. If the end date is missing, or says "ongoing", or "until further notice", return invalid.
10. Return JSON only.

liveDate: ${liveDate}

Return exactly:
{"valid":true,"start_at":"...","end_at":"...","reason":null}
or
{"valid":false,"start_at":null,"end_at":null,"reason":"..."}

Content:
${content}
`.trim();
}

export async function extractEventPeriodWithAI({ liveDate, content }) {
  if (!liveDate || !content) return null;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: "Return JSON only." },
        {
          role: "user",
          content: buildEventPeriodPrompt({ liveDate, content }),
        },
      ],
    });

    const result = response.choices[0]?.message?.content?.trim();
    if (!result) return null;

    const parsed = JSON.parse(result);

    if (!parsed.valid) {
      console.log(
        `[ai] invalid event period: ${parsed.reason ?? "unknown reason"}`,
      );
      return null;
    }

    if (
      typeof parsed.start_at !== "string" ||
      typeof parsed.end_at !== "string"
    ) {
      console.error("[ai] invalid JSON shape:", parsed);
      return null;
    }

    return {
      start_at: parsed.start_at,
      end_at: parsed.end_at,
    };
  } catch (err) {
    console.error("[ai] GPT call failed:", err.message);
    return null;
  }
}
