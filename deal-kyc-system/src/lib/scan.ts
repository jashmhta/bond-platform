import { parseDocument, ocrImage, ocrImagePaddle, type OcrKind } from "./ocr";
import { paddleAvailable } from "./paddle-ocr";
import { florenceOcr, hasWebGPU } from "./vlm";

type CRITICAL_KIND = "pan" | "aadhaar" | "cheque" | "cml";
const CRITICAL: Record<CRITICAL_KIND, string> = { pan: "panNumber", aadhaar: "aadhaarNumber", cheque: "ifsc", cml: "dpId" };

export type ScanResult = {
  ok: boolean;
  fields: Record<string, string>;
  engine: "paddle" | "neural" | "tesseract" | "none";
  error?: string;
};

const ENGINE_TIMEOUT_MS = 150000;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(null); });
  });

export async function scanImage(
  kind: OcrKind,
  bytes: Uint8Array,
  onStage?: (msg: string, pct?: number) => void
): Promise<ScanResult> {
  /* 1 · PaddleOCR PP-OCRv4 — best open-source accuracy for ID cards, on-device WASM */
  if (paddleAvailable()) {
    onStage?.("Loading PP-OCRv4 engine — first scan ~30MB, one-time (cached after)…", 5);
    const res = await withTimeout(
      ocrImagePaddle(bytes, kind, (p) => onStage?.("Scanning (PP-OCRv4)…", Math.max(8, Math.min(90, p)))),
      ENGINE_TIMEOUT_MS
    );
    if (res && res.ok && res.fields[CRITICAL[kind]]) {
      onStage?.("Scanned — verify the fields", 96);
      return { ok: true, fields: res.fields, engine: "paddle" };
    }
    onStage?.("Refining with tesseract…", 55);
    const t = await ocrImage(bytes, kind, (p) => onStage?.("Refining with tesseract…", 55 + p * 0.25));
    if (res && Object.keys(res.fields).length) {
      const merged = { ...res.fields, ...t.fields };
      const engine = t.fields[CRITICAL[kind]] ? "tesseract" : "paddle";
      return { ok: Object.keys(merged).length > 0, fields: merged, engine };
    }
    if (t.ok) return { ...t, engine: "tesseract" };
  }

  /* 2 · Florence-2 neural (WebGPU devices) */
  if (hasWebGPU()) {
    onStage?.("Loading neural OCR (first scan ~300MB, cached after)…", 5);
    const florenceReady = await withTimeout(florenceOcr(bytes, (m, pct) =>
      onStage?.(`Neural: ${m}`, Math.max(5, Math.min(55, pct ?? 0)))
    ), 25000);
    if (florenceReady) {
      onStage?.("Neural scan running…", 60);
      const fields = parseDocument(kind, florenceReady);
      if (Object.keys(fields).length > 0 && fields[CRITICAL[kind]]) {
        return { ok: true, fields, engine: "neural" };
      }
    }
  }

  /* 3 · tesseract fallback */
  onStage?.("Reading document…", 5);
  const t = await ocrImage(bytes, kind, (p) => onStage?.("Reading document…", p));
  return { ...t, engine: t.ok ? "tesseract" : "none" };
}
