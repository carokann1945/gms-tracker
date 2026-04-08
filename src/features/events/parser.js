const NEXON_BASE = "https://g.nexonstatic.com";

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
    if (src.startsWith("http://") || src.startsWith("https://")) {
      urls.push(src);
    } else {
      urls.push(`${NEXON_BASE}${src.startsWith("/") ? "" : "/"}${src}`);
    }
  }

  return urls;
}

/**
 * GMS 이벤트 상세 페이지 URL을 생성한다.
 * @param {string|number} id
 * @param {string} name
 * @returns {string}
 */
export function buildGmsUrl(id) {
  return `https://www.nexon.com/maplestory/news/events/${id}`;
}
