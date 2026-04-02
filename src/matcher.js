import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHORTLIST_LIMIT = 7;

function normalizeText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9가-힣]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactForMatch(value = "") {
  return normalizeForMatch(value).replace(/\s+/g, "");
}

function tokenizeForMatch(value = "") {
  return normalizeForMatch(value).split(" ").filter(Boolean);
}

function buildCandidates(primaryName, firstHeading) {
  const seen = new Set();

  return [
    { index: 0, source: "name", text: primaryName },
    { index: 1, source: "h2", text: firstHeading },
  ]
    .map((candidate) => ({
      index: candidate.index,
      source: candidate.source,
      text: normalizeText(candidate.text ?? ""),
    }))
    .filter((candidate) => {
      if (!candidate.text) return false;

      const key = candidate.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function translateCandidates(candidates) {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          '입력된 GMS 이벤트 이름 후보마다 translated와 pronounced를 만들어 JSON만 반환해. ' +
          'translated는 KMS 공지에서 실제 사용할 법한 한국어 표기다. 고유명사를 의역하지 말고, 확신이 낮으면 원문을 유지해. ' +
          'pronounced는 영문 고유명사의 한글 발음 표기다. ' +
          '형식: {"items":[{"index":0,"source":"name","original":"...","translated":"...","pronounced":"..."}]}',
      },
      {
        role: "user",
        content: JSON.stringify({ candidates }),
      },
    ],
    max_tokens: 300,
    temperature: 0,
  });

  const payload = JSON.parse(
    response.choices[0]?.message?.content?.trim() ?? "{}",
  );

  if (!Array.isArray(payload.items)) return [];

  return payload.items
    .map((item) => ({
      index: Number(item.index),
      source: item.source === "h2" ? "h2" : "name",
      original: normalizeText(item.original ?? ""),
      translated: normalizeText(item.translated ?? ""),
      pronounced: normalizeText(item.pronounced ?? ""),
    }))
    .filter((item) => Number.isInteger(item.index));
}

function buildCandidateVariants(candidates, translatedItems) {
  const itemMap = new Map(translatedItems.map((item) => [item.index, item]));

  return candidates.map((candidate) => {
    const translatedItem = itemMap.get(candidate.index);

    return {
      index: candidate.index,
      source: candidate.source,
      original: candidate.text,
      translated: translatedItem?.translated ?? "",
      pronounced: translatedItem?.pronounced ?? "",
    };
  });
}

function collectForms(candidateVariant) {
  const seen = new Set();

  return [
    { kind: "original", text: candidateVariant.original },
    { kind: "pronounced", text: candidateVariant.pronounced },
    { kind: "translated", text: candidateVariant.translated },
  ].filter((form) => {
    const normalized = normalizeForMatch(form.text);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function scoreFormAgainstTitle(formText, titleText) {
  const normalizedForm = normalizeForMatch(formText);
  const normalizedTitle = normalizeForMatch(titleText);
  const compactForm = compactForMatch(formText);
  const compactTitle = compactForMatch(titleText);

  if (!normalizedForm || !normalizedTitle) return 0;
  if (compactForm === compactTitle) return 120;

  let score = 0;

  if (
    compactForm.length >= 3 &&
    (compactTitle.includes(compactForm) || compactForm.includes(compactTitle))
  ) {
    score += compactForm.length >= 6 ? 60 : 35;
  }

  const titleTokens = [...new Set(tokenizeForMatch(titleText))];

  for (const token of [...new Set(tokenizeForMatch(formText))]) {
    if (token.length < 2) continue;

    if (titleTokens.includes(token)) {
      score += token.length >= 5 ? 18 : 10;
      continue;
    }

    if (
      token.length >= 3 &&
      titleTokens.some(
        (titleToken) => titleToken.includes(token) || token.includes(titleToken),
      )
    ) {
      score += 6;
    }
  }

  return score;
}

function scoreKmsCandidates(kmsList, candidateVariants) {
  return kmsList
    .map((event) => {
      let originalScore = 0;
      let pronouncedScore = 0;
      let translatedScore = 0;

      for (const candidateVariant of candidateVariants) {
        for (const form of collectForms(candidateVariant)) {
          const score = scoreFormAgainstTitle(form.text, event.name);

          if (form.kind === "original") originalScore += score;
          if (form.kind === "pronounced") pronouncedScore += score;
          if (form.kind === "translated") translatedScore += score;
        }
      }

      return {
        ...event,
        originalScore,
        pronouncedScore,
        translatedScore,
        totalScore: originalScore + pronouncedScore + translatedScore,
      };
    })
    .filter((event) => event.totalScore > 0)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.originalScore !== a.originalScore) {
        return b.originalScore - a.originalScore;
      }
      if (b.pronouncedScore !== a.pronouncedScore) {
        return b.pronouncedScore - a.pronouncedScore;
      }
      if (b.translatedScore !== a.translatedScore) {
        return b.translatedScore - a.translatedScore;
      }
      return Number(a.id) - Number(b.id);
    })
    .slice(0, SHORTLIST_LIMIT);
}

async function rerankShortlist(candidateVariants, shortlist) {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          '너는 MapleStory GMS 공지와 KMS 이벤트 제목을 매칭하는 랭커다. ' +
          '후보 힌트에는 영문 원문(original), 한국어 번역(translated), 영문 한글 발음(pronounced)이 함께 들어 있다. ' +
          '고유명사, 브랜드명, 시즌 이벤트 표기를 우선 보고 가장 적합한 KMS id 하나만 고른다. ' +
          '단일 KMS 이벤트로 보기 어렵거나 확신이 낮으면 {"id":null}을 반환한다. ' +
          'Return JSON only. The JSON response must be exactly {"id":"..."} or {"id":null}.',
      },
      {
        role: "user",
        content:
          'Return JSON only. JSON format: {"id":"1234"} or {"id":null}.\n\n' +
          JSON.stringify(
            {
              candidates: candidateVariants,
              shortlist,
              return_format: { id: "string|null" },
            },
            null,
            2,
          ),
      },
    ],
    max_tokens: 80,
    temperature: 0,
  });

  const payload = JSON.parse(
    response.choices[0]?.message?.content?.trim() ?? "{}",
  );

  if (typeof payload.id === "string" || typeof payload.id === "number") {
    return String(payload.id);
  }

  return null;
}

/**
 * GMS 이벤트 이름과 본문 첫 h2를 함께 사용해 대응하는 KMS 이벤트 URL을 반환한다.
 * @param {{
 *   primaryName: string,
 *   firstHeading?: string|null,
 *   kmsList: { id: string, name: string }[],
 * }} params
 * @returns {Promise<string|null>}
 */
export async function findKmsUrl({
  primaryName,
  firstHeading = null,
  kmsList,
}) {
  const candidates = buildCandidates(primaryName, firstHeading);
  if (!candidates.length || !kmsList?.length) return null;

  try {
    const translatedItems = await translateCandidates(candidates);
    const candidateVariants = buildCandidateVariants(candidates, translatedItems);
    const shortlist = scoreKmsCandidates(kmsList, candidateVariants);

    if (!shortlist.length) return null;

    const matchedId = await rerankShortlist(candidateVariants, shortlist);
    if (!matchedId) return null;

    return `https://maplestory.nexon.com/News/Event/${matchedId}`;
  } catch (err) {
    console.error("[matcher] findKmsUrl error:", err.message);
    return null;
  }
}
