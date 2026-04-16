import { NEXON_BASE } from "../../lib/constants.js";

/**
 * 저장 대상 여부를 판단한다.
 * [Completed], Scheduled, Unscheduled로 시작하지 않는 항목만 뉴스임
 * @param {string} name
 * @returns {boolean}
 */
export function isNewsItem(name) {
  const lowerName = (name ?? "").toLowerCase();
  return (
    !lowerName.startsWith("scheduled") &&
    !lowerName.startsWith("unscheduled") &&
    !lowerName.startsWith("[completed]")
  );
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
 * GMS 뉴스 상세 URL을 생성한다.
 * @param {string|number} id
 * @param {string} category
 * @returns {string}
 */
export function buildNewsUrl(id, category) {
  return `https://www.nexon.com/maplestory/news/${category}/${id}`;
}
