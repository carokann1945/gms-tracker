import { load } from "cheerio";

const NEXON_BASE = "https://g.nexonstatic.com";

/**
 * HTML body에서 순수 텍스트만 추출한다. (1계층 파싱용)
 * @param {string} bodyHtml
 * @returns {string}
 */
export function extractBodyText(bodyHtml) {
  if (!bodyHtml) return "";
  const $ = load(bodyHtml);
  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * HTML body에서 첫 번째 h2 텍스트를 추출한다.
 * 비어 있거나 h2가 없으면 null을 반환한다.
 * @param {string} bodyHtml
 * @returns {string|null}
 */
export function extractFirstH2Text(bodyHtml) {
  if (!bodyHtml) return null;

  const $ = load(bodyHtml);
  const firstH2 = $("h2").first();

  if (!firstH2.length) return null;

  const text = firstH2.text().replace(/\s+/g, " ").trim();
  return text || null;
}

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
export function buildGmsUrl(id, name) {
  return `https://www.nexon.com/maplestory/news/events/${id}`;
}
