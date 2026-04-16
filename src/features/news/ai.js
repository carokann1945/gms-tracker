import { gemini, GEMINI_MODEL } from "../../lib/ai.js";

function buildNewsPrompt({ name, liveDate, content }) {
  return `
You are an expert MapleStory news editor and summarizer.

[TARGET NEWS]
- Name: ${name}
${liveDate ? `- Live Date: ${liveDate}` : ""}

[OUTPUT FORMAT]
You must respond with a strictly valid JSON object containing exactly one key: "summary".

The key is REQUIRED.
Do not omit it.
Do not add any extra keys.
Do not output any text before or after the JSON.

⚠️ IMPORTANT JSON RULE ⚠️
To maximize readability, you MUST use "\\n\\n" inside the JSON string to create line breaks and separate paragraphs.

━━━━━━━━━━━━━━━━━━━━━━━
[PRIMARY GOAL]
Your job is NOT to translate the full article.
Your job is to produce the best possible Korean summary for Korean MapleStory users.

Focus on:
- what this notice is mainly about
- what actually changed or was announced
- what users should pay attention to
- what impact this has in practice

━━━━━━━━━━━━━━━━━━━━━━━
[GLOBAL RULES]
- **TIME CONVERSION**: You MUST convert ALL dates and times mentioned in the content (e.g., UTC, PST, PDT) to Korean Standard Time (KST, UTC+9).
- Format converted times naturally in Korean, for example: "2026년 4월 15일 오전 9시".
- Do not output original UTC/PST/PDT times unless absolutely necessary for disambiguation.
- Ignore repetitive boilerplate, legal disclaimers, generic promo copy, and low-value repeated reminders unless they materially affect users.

━━━━━━━━━━━━━━━━━━━━━━━
[SUMMARY RULES]
The "summary" string must be highly readable Markdown text written in Korean.

1. Start directly with the main point. Do not write a one-line teaser.
2. Include the full core meaning of the notice, but compress low-priority details aggressively.
3. Prioritize high-signal information in this order:
   - Main topic or purpose
   - Important changes / announcements
   - Dates, schedule, eligibility, affected users
   - Required actions / cautions
   - Practical impact / takeaway
4. If the notice contains long repetitive sections, tables, reward lists, or boilerplate:
   - summarize them compactly
   - keep only the information users actually need
   - do not mechanically restate every repeated line
5. If multiple changes are announced, group related items together instead of repeating the original structure.
6. If some details are uncertain, do not invent missing facts.

━━━━━━━━━━━━━━━━━━━━━━━
[READABILITY RULES]
- Write in natural, clear, professional Korean tone.
- Avoid giant walls of text.
- Separate distinct ideas with "\\n\\n".
- Use **bold text** for important names, dates, systems, or warnings.
- Use simple bullet points (-) only when listing multiple important items is clearer than prose.
- Organize the summary so a user can scan it quickly.

━━━━━━━━━━━━━━━━━━━━━━━
[CONTENT HANDLING RULES]
- Do NOT produce a full translation.
- Do NOT preserve the original paragraph order if a different structure is clearer.
- Do NOT include trivial filler details unless they change meaning.
- If the content is already messy or repetitive, rewrite it into a cleaner Korean summary.
- If there are patch-note-like sections, combine related points into compact grouped explanations.
- If there are event/reward-like lists inside the news, summarize them briefly unless they are the main point of the notice.

━━━━━━━━━━━━━━━━━━━━━━━
[IDEAL SUMMARY SHAPE]
The summary should usually cover:
- what this notice is
- what changed
- when it matters
- who is affected
- what users should do or know now

━━━━━━━━━━━━━━━━━━━━━━━
[CONTENT TO PROCESS]
${content}
`.trim();
}

export async function generateNewsTranslationWithAI({
  name,
  liveDate,
  content,
}) {
  if (!name || !content) return null;

  try {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildNewsPrompt({ name, liveDate, content }),
      config: {
        systemInstruction: "Return JSON only.",
        temperature: 0.2,
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
        },
      },
    });
    const result = response.text;

    if (!result) return null;

    const parsed = JSON.parse(result);

    if (typeof parsed.summary !== "string") {
      console.error("[news | ai] invalid translation JSON shape:", parsed);
      return null;
    }

    return `## 요약\n\n${parsed.summary}`;
  } catch (err) {
    console.error("[news | ai] AI call failed:", err.message);
    return null;
  }
}
