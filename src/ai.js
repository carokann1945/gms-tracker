import OpenAI from "openai";
import { GoogleGenAI, Type } from "@google/genai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = "gemini-2.5-flash";

const useGemini = process.env.AI_PROVIDER === "gemini";

function buildEventSummaryPrompt({ name, liveDate, content }) {
  return `
You are an expert MapleStory event summarizer and translator.

[TARGET EVENT]
- Name: ${name}
${liveDate ? `- Live Date: ${liveDate}` : ""}

[OUTPUT FORMAT]
You must respond with a strictly valid JSON object containing exactly two keys: "summary" and "translation".

Both keys are REQUIRED.
Do not omit either key.
Do not add any extra keys.
Do not output any text before or after the JSON.

⚠️ IMPORTANT JSON RULE ⚠️
To maximize readability, you MUST use "\\n\\n" inside the JSON string to create line breaks and separate paragraphs.

━━━━━━━━━━━━━━━━━━━━━━━
[GLOBAL RULES]
- **TIME CONVERSION**: You MUST convert ALL dates and times mentioned in the content (e.g., UTC, PST, PDT) to Korean Standard Time (KST, UTC+9).
- Format the converted times naturally in Korean, for example: "2026년 4월 15일 오전 9시". Do not output original UTC times.

━━━━━━━━━━━━━━━━━━━━━━━
[SUMMARY RULES]
The "summary" string must be highly readable Markdown text that naturally explains the event.

1. Do NOT write a one-line summary. Start directly with the main explanation.
2. Include ALL core information: "Who can participate", "What you need to do", and "What you can get".
3. **EXTREME READABILITY**:
   - Write in a natural, conversational Korean tone (e.g., "~할 수 있습니다.", "~하는 방식입니다.").
   - Do NOT write a massive wall of text. You MUST press Enter (use "\\n\\n") to separate sentences or concepts.
   - Separate "Participation Conditions", "How to Play", and "Rewards" into their own distinct paragraphs.
   - Use **bold text** strategically to highlight important numbers, item names, or rules.
   - Use simple bullet points (-) ONLY when listing multiple key rewards cleanly.

━━━━━━━━━━━━━━━━━━━━━━━
[TRANSLATION RULES]
The "translation" string must be a Korean translation of the provided content, optimized for reading speed and clarity.

1. **General Content**: For event duration, conditions, and how to play, preserve all details, notes, and warnings. NO omissions here.
2. **EXCEPTION - COMPACT REWARDS**: You MUST summarize the "Event Rewards" (이벤트 보상) section extremely compactly to save processing time.
   - Omit repetitive boilerplate text like "월드 내 교환 가능" (Tradeable within world) or exact expiration dates/times (e.g., "2026년 4월 15일 만료") UNLESS it is a highly unique or critical restriction.
   - Only translate the Core Item Name and Quantity (e.g., "3회: 메이플스토리 x 원펀맨 가구 상자 I").
   - Strip out long descriptions of what the items do (e.g., skip the explanation of what a 'Karma Bright Cube' does) unless it's a completely new, event-specific mechanic.
3. **EXTREME READABILITY**:
   - Convert unstructured text/HTML into beautiful, well-structured Markdown.
   - Use appropriate Markdown headings (###, ####) to create a clear visual hierarchy.
   - Use bullet points (-) and line breaks ("\\n\\n") generously to prevent text walls.
   - If the original content is already in Korean, refine and restructure it into highly readable Markdown without losing any core information.

━━━━━━━━━━━━━━━━━━━━━━━
[CONTENT TO PROCESS]
${content}
`.trim();
}

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

export async function generateEventSummaryWithAI({ name, liveDate, content }) {
  if (!name || !content) return null;

  try {
    let result;

    if (useGemini) {
      const response = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildEventSummaryPrompt({ name, liveDate, content }),
        config: {
          systemInstruction: "Return JSON only.",
          temperature: 0.2,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              translation: { type: Type.STRING },
            },
            required: ["summary", "translation"],
          },
        },
      });
      result = response.text;
    } else {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "event_summary",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                translation: { type: "string" },
              },
              required: ["summary", "translation"],
              additionalProperties: false,
            },
          },
        },
        temperature: 0.2,
        max_tokens: 16384,
        messages: [
          { role: "system", content: "Return JSON only." },
          {
            role: "user",
            content: buildEventSummaryPrompt({ name, liveDate, content }),
          },
        ],
      });
      result = response.choices[0]?.message?.content?.trim();
    }

    if (!result) return null;

    const parsed = JSON.parse(result);

    if (
      typeof parsed.summary !== "string" ||
      typeof parsed.translation !== "string"
    ) {
      console.error("[ai] invalid summary JSON shape:", parsed);
      return null;
    }

    return `## 요약\n\n${parsed.summary}\n\n## 전체 번역\n\n${parsed.translation}`;
  } catch (err) {
    console.error("[ai] summary GPT call failed:", err.message);
    return null;
  }
}

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
    let result;

    if (useGemini) {
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
      result = response.text;
    } else {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1000,
        messages: [
          { role: "system", content: "Return JSON only." },
          {
            role: "user",
            content: buildMaintenancePeriodPrompt({ liveDate, content }),
          },
        ],
      });
      result = response.choices[0]?.message?.content?.trim();
    }

    if (!result) return null;

    const parsed = JSON.parse(result);

    if (!parsed.valid) {
      console.log(
        `[ai] invalid maintenance times: ${parsed.reason ?? "unknown reason"}`,
      );
      return null;
    }

    if (
      typeof parsed.start_at !== "string" ||
      typeof parsed.end_at !== "string"
    ) {
      console.error("[ai] invalid maintenance JSON shape:", parsed);
      return null;
    }

    return {
      start_at: parsed.start_at,
      end_at: parsed.end_at,
    };
  } catch (err) {
    console.error("[ai] maintenance AI call failed:", err.message);
    return null;
  }
}

export async function extractEventPeriodWithAI({ liveDate, content }) {
  if (!liveDate || !content) return null;

  try {
    let result;

    if (useGemini) {
      const response = await gemini.models.generateContent({
        model: GEMINI_MODEL,
        contents: buildEventPeriodPrompt({ liveDate, content }),
        config: {
          systemInstruction: "Return JSON only.",
          temperature: 0,
          maxOutputTokens: 65536,
          responseMimeType: "application/json",
        },
      });
      result = response.text;
    } else {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1000,
        messages: [
          { role: "system", content: "Return JSON only." },
          {
            role: "user",
            content: buildEventPeriodPrompt({ liveDate, content }),
          },
        ],
      });
      result = response.choices[0]?.message?.content?.trim();
    }

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
