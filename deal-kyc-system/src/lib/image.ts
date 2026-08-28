/**
 * Client-side image prep for uploads + OCR.
 *  - optimizeImage(): mild version for storage/preview (downscale + JPEG)
 *  - prepForOcr(): grayscale + contrast-stretch + smart scaling for tesseract
 *    (real card photos are low-contrast; sparse text needs ~1100px+ width)
 */

async function toCanvas(file: File | Blob, maxEdge: number, minEdge: number): Promise<HTMLCanvasElement | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const longest = Math.max(bitmap.width, bitmap.height);
  let scale = Math.min(1, maxEdge / longest);
  const shortestAfter = Math.min(bitmap.width, bitmap.height) * scale;
  if (shortestAfter < minEdge) scale = Math.min(3, minEdge / shortestAfter);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("readback failed"));
    r.readAsDataURL(blob);
  });
}

/** Mild version — stored with the client record and shown as preview. */
export async function optimizeImage(
  file: File,
  maxEdge = 2000,
  quality = 0.9
): Promise<{ dataUrl: string; bytes: Uint8Array } | null> {
  if (!/^image\//.test(file.type)) return null;
  const canvas = await toCanvas(file, maxEdge, 0);
  if (!canvas) return null;
  const blob = await canvasToBlob(canvas, "image/jpeg", quality);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = await blobToDataUrl(blob);
  return { dataUrl, bytes };
}

/** OCR version — grayscale + percentile contrast stretch, min width for sparse text. */
export async function prepForOcr(file: File | Blob): Promise<Uint8Array | null> {
  const canvas = await toCanvas(file, 2600, 1100);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const gray = new Uint8Array(d.length / 4);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
  }
  // percentile stretch (2%..98%) — normalizes harsh lighting/shadow
  const hist = new Uint32Array(256);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / range)) | 0;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const blob = await canvasToBlob(canvas, "image/png", 1); // png keeps binarized edges crisp
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
