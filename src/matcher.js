import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * GMS 이벤트 이름에 대응하는 KMS 이벤트 페이지 URL을 반환한다.
 * @param {string} gmsEventName - GMS 영문 이벤트 이름
 * @param {{ id: string, name: string }[]} kmsList - fetchKmsEventList()의 반환값
 * @returns {Promise<string|null>} KMS URL 또는 null
 */
export async function findKmsUrl(gmsEventName, kmsList) {
  if (!gmsEventName || !kmsList?.length) return null;

  try {
    // Step 1: GMS 이벤트 이름을 한국어로 번역
    const translateResp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '메이플스토리 GMS 이벤트 이름을 KMS에서 사용하는 한국어로 번역해 줘. 번역 결과만 출력해.',
        },
        { role: 'user', content: gmsEventName },
      ],
      max_tokens: 100,
      temperature: 0,
    });

    const translatedName = translateResp.choices[0]?.message?.content?.trim() ?? '';
    if (!translatedName) return null;

    // Step 2: KMS 이벤트 목록에서 GPT로 최적 매칭 ID 탐색
    const listText = kmsList.map((e) => `id=${e.id}: ${e.name}`).join('\n');

    const matchResp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            '아래 KMS 이벤트 목록에서 주어진 이벤트 이름과 가장 유사한 항목을 찾아 해당 id만 숫자로 반환해 줘. ' +
            '유사한 항목이 없으면 "null"이라고만 대답해.',
        },
        { role: 'user', content: `찾는 이름: ${translatedName}\n\n목록:\n${listText}` },
      ],
      max_tokens: 20,
      temperature: 0,
    });

    const matchResult = matchResp.choices[0]?.message?.content?.trim() ?? '';
    if (!matchResult || matchResult.toLowerCase() === 'null') return null;

    // Pitfall 4 방지: GPT가 "id=1301" 또는 "The best match is 1301"처럼 반환할 수 있음
    const matchedId = matchResult.match(/\d+/)?.[0];
    if (!matchedId) return null;

    // Pitfall 3 방지: 최종 URL은 반드시 /News/Event/{id} 형식 (Closed 경로 아님)
    return `https://maplestory.nexon.com/News/Event/${matchedId}`;
  } catch (err) {
    console.error('[matcher] findKmsUrl error:', err.message);
    return null;
  }
}
