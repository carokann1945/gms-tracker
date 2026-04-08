import vision from '@google-cloud/vision';

let _client = null;

function getClient() {
  if (_client) return _client;
  // GOOGLE_APPLICATION_CREDENTIALS 환경변수를 자동으로 참조한다.
  _client = new vision.ImageAnnotatorClient();
  return _client;
}

/**
 * 이미지 URL에서 텍스트를 OCR로 추출한다.
 * 실패 시 빈 문자열을 반환하여 파이프라인이 계속 진행된다.
 * @param {string} imageUrl
 * @returns {Promise<string>}
 */
export async function extractTextFromImage(imageUrl) {
  try {
    console.log(`[ocr] Running OCR on: ${imageUrl}`);
    const client = getClient();
    const [result] = await client.textDetection(imageUrl);
    const annotations = result.textAnnotations ?? [];
    return annotations[0]?.description ?? '';
  } catch (err) {
    console.error(`[ocr] extractTextFromImage error (url=${imageUrl}):`, err.message);
    return '';
  }
}
