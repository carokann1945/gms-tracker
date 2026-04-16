import { load } from "cheerio";

/**
 * HTML body에서 순수 텍스트만 추출한다. (1계층 파싱용)
 * @param {string} bodyHtml
 * @returns {string}
 */
export function extractMaintenanceBodyText(bodyHtml) {
  if (!bodyHtml) return "";
  const $ = load(bodyHtml);
  $("br").replaceWith(" ");
  return $("body").text().replace(/\s+/g, " ").trim();
}

/**
 * HTML body에서 순수 텍스트만 추출한다. (1계층 파싱용)
 * 문단 구조는 줄바꿈을 이용해서 유지한다.
 * @param {string} bodyHtml
 * @returns {string}
 */
export function extractBodyText(bodyHtml) {
  if (!bodyHtml) return "";

  const $ = load(bodyHtml);

  $("script, style, noscript, iframe").remove();
  $("br").replaceWith("\n");

  $("p, li, h1, h2, h3, h4, h5, h6").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });

  $("div").each((_, el) => {
    const hasDirectText = $(el)
      .contents()
      .toArray()
      .some((node) => node.type === "text" && node.data.trim());

    if (hasDirectText) {
      $(el).prepend("\n").append("\n");
    }
  });

  return $.root()
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
