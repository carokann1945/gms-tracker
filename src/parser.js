const NEXON_BASE = 'https://g.nexonstatic.com';

/**
 * HTML body에서 <img src="..."> URL을 추출하여 절대 경로로 반환한다.
 * @param {string} bodyHtml
 * @returns {string[]}
 */
export function extractBodyImageUrls(bodyHtml) {
  if (!bodyHtml) return [];

  const imgRegex = /<img[^>]+src="([^"]+)"/gi;
  const urls = [];
  let match;

  while ((match = imgRegex.exec(bodyHtml)) !== null) {
    const src = match[1];
    // 상대 경로면 Nexon 도메인을 앞에 붙인다.
    if (src.startsWith('http://') || src.startsWith('https://')) {
      urls.push(src);
    } else {
      urls.push(`${NEXON_BASE}${src.startsWith('/') ? '' : '/'}${src}`);
    }
  }

  return urls;
}

/**
 * OCR로 추출된 텍스트에서 이벤트 기간을 파싱한다.
 *
 * 대상 포맷 예시 (공백 유무, 줄바꿈 등 OCR 결과에 따라 유동적):
 *   3/18/2026 (Wed) after maintenance - 4/14/2026 (Tue) 11:59 PM UTC
 *   3/18/2026(Wed)after maintenance - 4/14/2026(Tue)11:59 PM UTC
 *
 * @param {string} text
 * @returns {string | null}
 */
export function parseEventPeriod(text) {
  if (!text) return null;

  // 날짜와 괄호 사이 공백 허용 (\s*), 줄바꿈도 허용 ([\s\S]*? non-greedy)
  const periodRegex =
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*\([A-Za-z]{3}\)[\s\S]*?-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*\([A-Za-z]{3}\)[^\n]*/i;

  const match = text.match(periodRegex);
  if (!match) return null;

  // 줄바꿈을 공백으로 정리하여 한 줄로 반환
  return match[0].replace(/\s+/g, ' ').trim();
}
