/* Florence-2 OCR via transformers.js (WebGPU). Free, on-device, cached after first load.
   Hard timeout: if the model can't load within TIMEOUT_MS the session permanently falls
   back to tesseract — OCR must never hang. */

type Prog = (msg: string, pct?: number) => void;

const MODEL_ID = "onnx-community/Florence-2-base-ft";
const LOAD_TIMEOUT_MS = 20000;

let instance: Promise<{ generate: (blob: Blob) => Promise<string> } | null> | null = null;
let disabled = false;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as unknown as { gpu?: unknown }).gpu;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
      .catch(() => { clearTimeout(t); resolve(null); });
  });
}

async function loadOnce(): Promise<{ generate: (blob: Blob) => Promise<string> } | null> {
  try {
    const T = (await import("@huggingface/transformers")) as unknown as Record<string, any>;
    const model = await T.Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: { embed_tokens: "fp16", vision_encoder: "fp16", encoder_model: "q4", decoder_model_merged: "q4" },
      device: "webgpu",
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === "progress" && typeof p.progress === "number") {
          onProgress?.(
            `Loading neural engine — ${Math.max(2, Math.min(60, Math.round(p.progress)))}% (one-time, cached)`,
            Math.max(2, Math.min(60, Math.round(p.progress)))
          );
        }
      },
    });
    const processor = await T.AutoProcessor.from_pretrained(MODEL_ID);
    const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID);
    const generate = async (blob: Blob): Promise<string> => {
      const image = await T.RawImage.fromBlob(blob);
      const inputs = await processor(image, "<OCR>");
      const ids = await model.generate({ ...inputs, max_new_tokens: 768 });
      const dims = inputs.input_ids?.dims;
      const start = Array.isArray(dims) ? dims[dims.length - 1] : 0;
      const sliced = typeof ids.slice === "function" && start ? ids.slice(null, [start, null]) : ids;
      const decoded = tokenizer.batch_decode(sliced, { skip_special_tokens: true });
      return String(decoded?.[0] ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
    };
    return { generate };
  } catch (e) {
    console.warn("Florence-2 unavailable — using tesseract:", e);
    return null;
  }
}

let onProgress: Prog | null = null;
export function setFlorenceProgress(p: Prog | null) {
  onProgress = p;
}

export async function ensureFlorence(onProgress2?: Prog): Promise<boolean> {
  if (disabled || !hasWebGPU()) return false;
  if (onProgress2) onProgress = onProgress2;
  if (!instance) {
    instance = withTimeout(loadOnce(), LOAD_TIMEOUT_MS).then((v) => {
      if (v === null) disabled = true; // never try again this session
      return v;
    });
  }
  return (await instance) !== null;
}

export async function florenceOcr(pngBytes: Uint8Array, onProgress2?: Prog): Promise<string | null> {
  const ready = await ensureFlorence(onProgress2);
  if (!ready) return null;
  const inst = await instance!;
  try {
    const blob = new Blob([pngBytes.slice().buffer as ArrayBuffer], { type: "image/png" });
    const text = await inst!.generate(blob);
    return text.length > 3 ? text : null;
  } catch (e) {
    console.warn("florenceOcr failed — using tesseract:", e);
    return null;
  }
}
