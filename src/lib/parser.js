import { load } from "cheerio";

/**
 * HTML body에서 순수 텍스트만 추출한다. (1계층 파싱용)
 * @param {string} bodyHtml
 * @returns {string}
 */
export function extractBodyText(bodyHtml) {
  if (!bodyHtml) return "";
  const $ = load(bodyHtml);
  $("br").replaceWith(" ");
  return $("body").text().replace(/\s+/g, " ").trim();
}
