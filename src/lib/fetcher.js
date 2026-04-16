import { NEXON_BASE, CMS_API_URL } from "./constants.js";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toAbsoluteCmsUrl(url) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${NEXON_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function fetchDetail(id) {
  try {
    const res = await fetch(`${CMS_API_URL}/${id}`);
    if (!res.ok)
      throw new Error(`Detail fetch failed for id=${id}: ${res.status}`);
    const data = await res.json();
    return {
      id: String(data.id ?? id),
      name: data.name ?? data.title ?? "",
      liveDate: data.liveDate ?? data.live_date ?? null,
      body: data.body ?? "",
      imageThumbnail: toAbsoluteCmsUrl(
        data.imageThumbnail ?? data.image_thumbnail ?? null,
      ),
      category: data.category ?? null,
    };
  } catch (err) {
    console.error(`[fetcher] fetchDetail error (id=${id}):`, err.message);
    return null;
  }
}
