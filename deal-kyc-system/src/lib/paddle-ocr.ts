/* PP-OCRv4 (PaddleOCR) running fully on-device via onnxruntime-web.
 * Pipeline: DB-text detection → axis-aligned boxes → per-line crop → CTC recognition.
 * Models self-hosted at /models (16MB, HTTP-cached). WASM runtime at /onnx.
 * Handles tilt/blur/low-light far better than tesseract on ID cards. */

type OrtSession = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
};

type OrtModule = {
  InferenceSession: {
    create: (uri: string, opts?: Record<string, unknown>) => Promise<OrtSession>;
  };
  env: { wasm: { wasmPaths: string; numThreads: number } };
};

type PaddleTextLine = { text: string; score: number; frame: { top: number; left: number; width: number; height: number } };

let ortP: Promise<OrtModule | null> | null = null;
let detS: Promise<OrtSession | null> | null = null;
let recS: Promise<OrtSession | null> | null = null;
let keysP: Promise<string[] | null> | null = null;
let disabled = false;

export function paddleAvailable(): boolean {
  return typeof window !== "undefined" && !disabled;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(null); });
  });
}

async function getOrt(): Promise<OrtModule | null> {
  if (!ortP) {
    ortP = (async () => {
      const ort = (await import("onnxruntime-web")) as unknown as OrtModule;
      ort.env.wasm.wasmPaths = "/onnx/";
      ort.env.wasm.numThreads = 1; // no COOP/COEP headers → single thread
      return ort;
    })();
  }
  return ortP;
}

const DET_MODEL = "/models/ch_PP-OCRv4_det_infer.onnx";
const REC_MODEL = "/models/ch_PP-OCRv4_rec_infer.onnx";

async function getDet(): Promise<OrtSession | null> {
  if (!detS) {
    detS = (async () => {
      const ort = await getOrt();
      if (!ort) return null;
      return ort.InferenceSession.create(DET_MODEL, { executionProviders: ["wasm"] });
    })();
  }
  return detS;
}

async function getRec(): Promise<OrtSession | null> {
  if (!recS) {
    recS = (async () => {
      const ort = await getOrt();
      if (!ort) return null;
      return ort.InferenceSession.create(REC_MODEL, { executionProviders: ["wasm"] });
    })();
  }
  return recS;
}

async function getKeys(): Promise<string[] | null> {
  if (!keysP) {
    keysP = (async () => {
      const r = await fetch("/models/ppocr_keys_v1.txt");
      if (!r.ok) return null;
      return (await r.text()).split("\n").map((l) => l.replace(/\r$/, ""));
    })();
  }
  return keysP;
}

export async function ensurePaddle(): Promise<boolean> {
  if (disabled) return false;
  const [ort, det, rec, keys] = await Promise.all([getOrt(), getDet(), getRec(), getKeys()]);
  if (!ort) console.warn("[paddle] onnxruntime-web failed to load");
  else if (!det) console.warn("[paddle] det model failed");
  else if (!rec) console.warn("[paddle] rec model failed");
  else if (!keys) console.warn("[paddle] dictionary failed");
  if (!ort || !det || !rec || !keys) { disabled = true; return false; }
  return true;
}

/* ---------- image helpers ---------- */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(bin);
}

async function decodeToCanvas(bytes: Uint8Array): Promise<{ ctx: CanvasRenderingContext2D; w: number; h: number } | null> {
  try {
    const b64 = bytesToBase64(bytes);
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    // upscale tiny images (helps recognition), cap huge ones
    const scale = Math.min(Math.max(1, 900 / Math.max(w, h)), 3);
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cw, ch);
    return { ctx, w: cw, h: ch };
  } catch {
    return null;
  }
}

function round32(n: number): number {
  return Math.max(32, Math.round(n / 32) * 32);
}

/* ---------- detection ---------- */

type Box = { x0: number; y0: number; x1: number; y1: number; score: number };

async function detectBoxes(ctx: CanvasRenderingContext2D, w: number, h: number): Promise<Box[]> {
  const ort = await getOrt();
  const det = await getDet();
  if (!ort || !det) return [];
  const rw = round32(Math.min(w, 960));
  const rh = round32((h * rw) / w);
  const tmp = document.createElement("canvas");
  tmp.width = rw; tmp.height = rh;
  const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
  tctx.drawImage(ctx.canvas, 0, 0, rw, rh);
  const px = tctx.getImageData(0, 0, rw, rh).data;

  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const input = new Float32Array(3 * rw * rh);
  for (let i = 0; i < rw * rh; i++) {
    input[i] = (px[i * 4] / 255 - mean[0]) / std[0];
    input[rw * rh + i] = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
    input[2 * rw * rh + i] = (px[i * 4 + 2] / 255 - mean[2]) / std[2];
  }
  const { Tensor } = await import("onnxruntime-web");
  const feed: Record<string, unknown> = {};
  feed[det.inputNames[0]] = new Tensor("float32", input, [1, 3, rh, rw]);
  const out = await det.run(feed);
  const prob = out[det.outputNames[0]].data as Float32Array;
  const pw = out[det.outputNames[0]].dims[3] ?? rw;

  /* connected components on the probability map */
  const TH = 0.35;
  const visited = new Uint8Array(prob.length);
  const boxes: Box[] = [];
  const stack: number[] = [];
  const scaleX = w / pw, scaleY = h / (out[det.outputNames[0]].dims[2] ?? rh);
  for (let i = 0; i < prob.length; i++) {
    if (visited[i] || prob[i] < TH) continue;
    stack.length = 0; stack.push(i); visited[i] = 1;
    let minX = pw, minY = prob.length / pw, maxX = 0, maxY = 0, sum = 0, n = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const y = (p / pw) | 0, x = p % pw;
      if (prob[p] < TH) continue;
      sum += prob[p]; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const d of [-1, 1, -pw, pw]) {
        const q = p + d;
        if (q < 0 || q >= prob.length || visited[q] || prob[q] < TH) continue;
        if ((d === -1 && x === 0) || (d === 1 && x === pw - 1)) continue;
        visited[q] = 1; stack.push(q);
      }
    }
    if (n < 12) continue;
    const bw = (maxX - minX + 1) * scaleX, bh = (maxY - minY + 1) * scaleY;
    if (bh < 8 || bw < 6) continue;
    const score = sum / n;
    if (score < 0.5) continue;
    // inflate 30% h margin for recognition crop
    const vy = bh * 0.3, vx = bw * 0.08;
    boxes.push({
      x0: Math.max(0, minX * scaleX - vx),
      y0: Math.max(0, minY * scaleY - vy),
      x1: Math.min(w, maxX * scaleX + vx),
      y1: Math.min(h, maxY * scaleY + vy),
      score,
    });
  }
  boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x1);
  return boxes;
}

/* ---------- recognition (CTC) ---------- */

async function recognizeCrop(src: CanvasRenderingContext2D, b: Box): Promise<{ text: string; score: number }> {
  const ort = await getOrt();
  const rec = await getRec();
  const keys = await getKeys();
  if (!ort || !rec || !keys) return { text: "", score: 0 };
  const bw = Math.max(2, Math.round(b.x1 - b.x0));
  const bh = Math.max(2, Math.round(b.y1 - b.y0));
  const crop = document.createElement("canvas");
  crop.width = bw; crop.height = bh;
  crop.getContext("2d", { willReadFrequently: true })!.drawImage(src.canvas, b.x0, b.y0, bw, bh, 0, 0, bw, bh);
  const targetH = 48;
  const targetW = Math.min(960, Math.max(48, Math.round((bw / bh) * targetH)));
  const rs = document.createElement("canvas");
  rs.width = targetW; rs.height = targetH;
  const rctx = rs.getContext("2d", { willReadFrequently: true })!;
  rctx.imageSmoothingEnabled = true;
  rctx.drawImage(crop, 0, 0, targetW, targetH);
  const px = rctx.getImageData(0, 0, targetW, targetH).data;
  const input = new Float32Array(3 * targetH * targetW);
  for (let i = 0; i < targetH * targetW; i++) {
    input[i] = (px[i * 4] / 255 - 0.5) / 0.5;
    input[targetH * targetW + i] = (px[i * 4 + 1] / 255 - 0.5) / 0.5;
    input[2 * targetH * targetW + i] = (px[i * 4 + 2] / 255 - 0.5) / 0.5;
  }
  const { Tensor } = await import("onnxruntime-web");
  const feed: Record<string, unknown> = {};
  feed[rec.inputNames[0]] = new Tensor("float32", input, [1, 3, targetH, targetW]);
  const out = await rec.run(feed);
  const o = out[rec.outputNames[0]];
  const dims = o.dims; // [1, seq, classes]
  const seq = dims[1], classes = dims[2];
  const data = o.data as Float32Array;
  let last = -1, text = "", scoreSum = 0, cnt = 0;
  for (let t = 0; t < seq; t++) {
    let best = -1, bestv = -Infinity;
    for (let c = 0; c < classes; c++) {
      const v = data[t * classes + c];
      if (v > bestv) { bestv = v; best = c; }
    }
    if (best !== 0 && best !== last) {
      if (best - 1 < keys.length) text += keys[best - 1] === undefined ? "" : keys[best - 1];
      else text += " ";
      // softmax over classes for the chosen index
      let expSum = 0;
      for (let c = 0; c < classes; c++) expSum += Math.exp(data[t * classes + c] - bestv);
      scoreSum += 1 / (1 + expSum);
      cnt++;
    }
    last = best;
  }
  return { text: text.trim(), score: cnt ? scoreSum / cnt : 0 };
}

/* ---------- public API ---------- */

export type PaddleLine = {
  text: string;
  score: number;
  box: { x0: number; y0: number; x1: number; y1: number };
};

export async function paddleOcr(bytes: Uint8Array): Promise<{ lines: PaddleLine[]; error?: string } | null> {
  const ok = await ensurePaddle();
  if (!ok) return null;
  const img = await decodeToCanvas(bytes);
  if (!img) { console.warn("[paddle] decode failed"); return { lines: [], error: "Could not decode image" }; }
  const boxes = await detectBoxes(img.ctx, img.w, img.h).catch((e) => { console.warn("[paddle] det error:", String(e).slice(0, 160)); return []; });
  if (!boxes.length) return { lines: [] };
  const lines: PaddleLine[] = [];
  for (const b of boxes) {
    const r = await recognizeCrop(img.ctx, b).catch((e) => { console.warn("[paddle] rec error:", String(e).slice(0, 160)); return { text: "", score: 0 }; });
    if (r.text && r.text.trim().length > 0) {
      lines.push({ text: r.text.trim(), score: r.score, box: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } });
    }
  }
  return { lines };
}
