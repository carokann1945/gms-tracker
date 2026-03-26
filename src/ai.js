import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT =
  '이 게임 이벤트 공지에서 시작일과 종료일(없을수도있음)을 찾아내서 ' +
  '`YYYY-MM-DD HH:MM (UTC) - YYYY-MM-DD HH:MM (UTC)` 또는 ' +
  '`YYYY-MM-DD HH:MM (UTC)` 포맷으로만 요약해 줘. 없으면 "not found"라고만 대답해.';

/**
 * 텍스트에서 GPT-4o-mini로 이벤트 기간을 추출한다.
 * @param {string} text
 * @returns {Promise<string | null>} 찾으면 정제된 날짜 문자열, 못 찾으면 null
 */
export async function extractEventPeriodWithAI(text) {
  if (!text) return null;
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: text },
      ],
      max_tokens: 100,
      temperature: 0,
    });
    const result = response.choices[0]?.message?.content?.trim() ?? '';
    if (!result || result.toLowerCase() === 'not found') return null;
    return result;
  } catch (err) {
    console.error('[ai] GPT call failed:', err.message);
    return null;
  }
}
