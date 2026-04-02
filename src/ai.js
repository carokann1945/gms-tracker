import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

Valid example:
{
  "summary": "...\n\n**이벤트 요약**\n* **섹션 이름**: 행동 → 보상",
  "translation": "..."
}

Invalid examples:
{
  "summary": "..."
}

{
  "translation": "..."
}

{
  "summary": { "text": "..." },
  "translation": "..."
}

━━━━━━━━━━━━━━━━━━━━━━━
[SUMMARY RULES]
The "summary" string must be highly readable and strictly follow this Markdown structure:

**한줄 요약**
(Write exactly ONE short, punchy sentence summarizing the core update or event in natural Korean.)

**이벤트 요약**
(Write the event summary as natural, flowing paragraphs. Do NOT use rigid section headers like '* **[섹션 이름]**'.)

- Explain "Who can participate", "What you need to do", and "What you can get" naturally, weaving them together in a conversational yet highly informative tone.
- Just write it like a human summarizing an event. For example: "이번 이벤트는 101레벨 이상 유저들이 참여할 수 있으며, 매일 레벨 범위 몬스터를 처치해 출석 체크를 하는 방식입니다. 꾸준히 참여하면 성장에 필요한 다양한 아이템과 함께 한정판 코디 보상을 얻을 수 있습니다."
- Avoid robotic listing. 
- You may use simple bullet points (-) ONLY IF you need to list a few key core rewards, but the main explanation must be human-like paragraphs.

━━━━━━━━━━━━━━━━━━━━━━━
[TRANSLATION RULES]
The "translation" string must be a FULL, 100% complete Korean translation of the provided content.

- NO omissions, NO summarization. Preserve all details, conditions, dates, notes, and warnings.
- Convert HTML/UI elements into clean, structured Markdown.
- Use appropriate Markdown headings (###, ####), bullet points, and Markdown tables to maximize readability.
- Keep reward tables and structures visually clean.
- If the original content is already in Korean, refine and restructure it into highly readable Markdown without losing any information.

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
      max_tokens: 8000,
      messages: [
        { role: "system", content: "Return JSON only." },
        {
          role: "user",
          content: buildEventSummaryPrompt({ name, liveDate, content }),
        },
      ],
    });

    const result = response.choices[0]?.message?.content?.trim();
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

export async function extractEventPeriodWithAI({ liveDate, content }) {
  if (!liveDate || !content) return null;

  try {
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
