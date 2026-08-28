/**
 * BinaryBonds OCR engine v2 — geometry-aware, client-side (tesseract.js).
 *
 * Why v2: regex-over-plain-text breaks on real card photos (jumbled line
 * order, merged lines, Hindi noise). v2 reconstructs visual lines from word
 * bounding boxes and applies positional rules the way production KYC systems do:
 *   PAN  → number token → name = closest alphabetic line BELOW it (largest font
 *          wins), DOB = first date pattern anywhere (space-tolerant)
 *   Aadhaar → number (12-digit), name = line above DOB/year line, DOB/YOB,
 *          address = labeled block or PIN-anchored
 *   Cheque → IFSC / A/c / bank      CML → DP/BO/DP-name/holder/mobile/email/address
 * Falls back to plain-text parsing for digital PDFs (no geometry there).
 */

export type OcrKind = "pan" | "aadhaar" | "cheque" | "cml";

export type OcrResult = {
  ok: boolean;
  fields: Record<string, string>;
  rawText?: string;
  error?: string;
};

type Box = { x0: number; y0: number; x1: number; y1: number };
type OWord = { t: string; conf: number } & Box;
export type OLine = { words: OWord[]; text: string; height: number } & Box;

type TesseractWorker = {
  recognize: (image: unknown, opts?: unknown, output?: unknown) => Promise<{
    data: { text: string; blocks?: unknown };
  }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return (await createWorker("eng")) as unknown as TesseractWorker;
    })();
  }
  return workerPromise;
}

export function isOcrable(file: { type?: string }): boolean {
  return /^image\//.test(file.type || "");
}

export async function ocrImage(
  file: File | Blob | Uint8Array,
  kind: OcrKind,
  onProgress?: (pct: number) => void
): Promise<OcrResult> {
  const mime = (file as { type?: string }).type || "image/jpeg";
  if (!/^image\//.test(mime) && !(file instanceof Uint8Array)) {
    return { ok: false, fields: {}, error: "OCR reads images (JPG/PNG). Type details manually for PDFs." };
  }
  try {
    const worker = await getWorker();
    if (onProgress) onProgress(5);
    const img = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());

    await worker.setParameters({ tessedit_pageseg_mode: "3" });
    const res = await worker.recognize(img, {}, { blocks: true, text: true });
    if (onProgress) onProgress(80);
    let text: string = res.data.text || "";
    const lines = toLines(res.data.blocks);
    let fields = lines.length
      ? parseStructured(kind, lines, text)
      : parseDocument(kind, text);

    const needsSecond =
      (kind === "pan" && !fields.panNumber) ||
      (kind === "aadhaar" && !fields.aadhaarNumber);
    if (needsSecond) {
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
      });
      const res2 = await worker.recognize(img, {}, { blocks: true, text: true });
      await worker.setParameters({ tessedit_char_whitelist: "" });
      const lines2 = toLines(res2.data.blocks);
      const f2 = lines2.length
        ? parseStructured(kind, lines2, res2.data.text || "")
        : parseDocument(kind, res2.data.text || "");
      fields = { ...f2, ...fields };
      text = `${text}\n${res2.data.text || ""}`;
    }

    if (onProgress) onProgress(100);
    return { ok: true, fields, rawText: text };
  } catch (e: unknown) {
    return { ok: false, fields: {}, error: e instanceof Error ? e.message : "OCR failed" };
  }
}

/* ================= geometry: words → visual lines ================= */

type RawBlock = {
  paragraphs?: {
    lines?: { words?: { text?: string; confidence?: number; bbox?: Box }[] }[];
  }[];
};

export function toLines(blocks: unknown): OLine[] {
  const words: OWord[] = [];
  for (const b of (blocks as RawBlock[]) ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          const t = (w.text ?? "").trim().toUpperCase();
          if (!t) continue;
          if ((w.confidence ?? 0) < 28) continue;
          if (!w.bbox) continue;
          words.push({ t, conf: w.confidence ?? 0, ...w.bbox });
        }
      }
    }
  }
  if (!words.length) return [];

  words.sort((a, b) => a.y0 - b.y0);
  const lines: OLine[] = [];
  for (const w of words) {
    const wm = (w.y0 + w.y1) / 2;
    const wh = w.y1 - w.y0;
    let target: OLine | undefined;
    for (const L of lines) {
      const lm = (L.y0 + L.y1) / 2;
      const h = Math.max(wh, L.height);
      if (Math.abs(wm - lm) <= h * 0.6) {
        target = L;
        break;
      }
    }
    if (target) {
      target.words.push(w);
      target.x0 = Math.min(target.x0, w.x0);
      target.y0 = Math.min(target.y0, w.y0);
      target.x1 = Math.max(target.x1, w.x1);
      target.y1 = Math.max(target.y1, w.y1);
    } else {
      lines.push({ words: [w], text: "", height: wh, ...structuredClone({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }) });
    }
  }
  for (const L of lines) {
    L.words.sort((a, b) => a.x0 - b.x0);
    L.text = L.words.map((w) => w.t).join(" ");
    L.height =
      L.words.reduce((a, w) => a + (w.y1 - w.y0), 0) / L.words.length;
  }
  lines.sort((a, b) => a.y0 - b.y0);
  return lines;
}

/* ================= shared helpers ================= */

const NOISE = new Set([
  "INCOME", "TAX", "DEPARTMENT", "GOVT", "GOVERNMENT", "INDIA", "PERMANENT",
  "ACCOUNT", "NUMBER", "CARD", "DATE", "BIRTH", "DOB", "SIGNATURE", "AADHAAR",
  "AADHAR", "UNIQUE", "IDENTIFICATION", "AUTHORITY", "UIDAI", "MALE", "FEMALE",
  "TRANSGENDER", "CHEQUE", "PAYEE", "ONLY", "CDSL", "NSDL", "DEPOSITORY",
  "PARTICIPANT", "HOLDER", "FIRST", "SOLE", "SECOND", "JOINT", "CLIENT",
  "MASTER", "STATEMENT", "DEMAT", "STATUS", "MR", "MRS", "MS", "FATHER",
  "FATHERS", "NAME", "NOMINATION", "EMAIL", "MOBILE", "PHONE", "TEL", "ADDRESS",
  "PIN", "OF", "THE", "AND", "DEPT", "CODE", "आयकर", "विभाग",
]);

function isPersonWord(w: string): boolean {
  if (!/^[A-Za-z][A-Za-z.]*$/.test(w)) return false; // purely alphabetic tokens only
  return !NOISE.has(w.toUpperCase());
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s|\/|-)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** dd-mm-yyyy (space/comma tolerant) → yyyy-mm-dd, else "" */
function normDate(s: string): string {
  const m = s.replace(/(\d)\s*([\/\-.])\s*(\d)/g, "$1$2$3").match(/\b(\d{2})[\/\-.](\d{2})[\/\-.](19|20\d{2})\b/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

function findDateInLines(lines: OLine[]): string {
  for (const L of lines) {
    const joined = L.text.replace(/(\d)\s*([\/\-.])\s*(\d)/g, "$1$2$3").replace(/\s+/g, " ");
    const m = joined.match(/(\d{2})\s*[\/\-.]\s*(\d{2})\s*[\/\-.]\s*((?:19|20)\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return "";
}

function findYearInLines(lines: OLine[]): string {
  for (const L of lines) {
    if (/DOB|BIRTH|जन्म|YOJ|YOB|YEAR/i.test(L.text)) {
      const y = L.text.match(/\b((?:19|20)\d{2})\b/);
      if (y) return y[1];
    }
  }
  return "";
}

/* ================= PAN misread correction ================= */

const DIGIT_TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };
const LETTER_TO_DIGIT: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", T: "7", S: "5", B: "8", Z: "2", G: "6", A: "4" };

export function correctPanLike(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{10}$/.test(t)) return null;
  const first5 = t.slice(0, 5).split("").map((c) => (/[0-9]/.test(c) ? DIGIT_TO_LETTER[c] ?? c : c)).join("");
  const mid4 = t.slice(5, 9).split("").map((c) => (/[A-Z]/.test(c) ? LETTER_TO_DIGIT[c] ?? c : c)).join("");
  const last = /[0-9]/.test(t[9]) ? DIGIT_TO_LETTER[t[9]] ?? "" : t[9];
  const fixed = first5 + mid4 + last;
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(fixed) ? fixed : null;
}

function extractPanFromLines(lines: OLine[]): { pan?: string; line?: OLine } {
  for (const L of lines) {
    for (const w of L.words) {
      const solid = w.t.replace(/[^A-Z0-9]/g, "");
      if (/^[A-Z]{5}\d{4}[A-Z]$/.test(solid)) return { pan: solid, line: L };
    }
  }
  // second chance: 10-char alnum tokens that correct into a PAN
  for (const L of lines) {
    for (const w of L.words) {
      const solid = w.t.replace(/[^A-Z0-9]/g, "");
      if (solid.length === 10 && /\d/.test(solid)) {
        const fixed = correctPanLike(solid);
        if (fixed) return { pan: fixed, line: L };
      }
    }
  }
  return {};
}

function extractPanFromText(text: string): string | undefined {
  const up = text.toUpperCase();
  const direct = up.match(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  if (direct) return direct[0];
  for (const line of up.split(/\r?\n/)) {
    const solid = line.replace(/[^A-Z0-9]/g, "");
    if (solid.length < 10 || solid.length > 13) continue;
    for (let i = 0; i + 10 <= solid.length; i++) {
      const fixed = correctPanLike(solid.slice(i, i + 10));
      if (fixed) return fixed;
    }
  }
  return undefined;
}

/* ================= name selection (geometric) ================= */

/* Improved: try multiple strategies to find the name */
function tryNameStrategies(lines: OLine[], panLine?: OLine): string | null {
  // Never treat father/guardian/signature lines as the holder name
  const NON_HOLDER = /\bFATHERS?\b|\bGUARDIAN\b|^\s*DOB\s*:?|DATE\s+OF\s+BIRTH|SIGNATURE|\bCARETAKER\b|\bNOMINEE\b/i;
  if (Array.isArray(lines) && lines.length && lines[0] && typeof lines[0] === "object") {
    lines = lines.filter((L) => !NON_HOLDER.test(L.text));
  }
  // Strategy 1: pickNameBelowPan (geometry-based)
  const geo = pickNameBelowPan(lines, panLine);
  if (geo) return geo;
  // Strategy 2: labeledName with various label/skip combos
  for (const label of [/\bNAME\b/i, /\b(NAME|NAAM)\b/i, /FIRST\s+HOLDER/i, /HOLDER\s+NAME/i]) {
    for (const skip of [/FATHER/i, /GUARDIAN/i, /SIGNATURE/i, /^$/]) {
      const labeled = labeledName(lines, label, skip);
      if (labeled) return labeled;
    }
  }
  // Strategy 3: scanNameLines with relaxed exclude
  const relaxedExclude = /INCOME|TAX|DEPARTMENT|GOVT|GOVERNMENT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|DATE|BIRTH|DOB|SIGNATURE|AADHAAR|AADHAR|UNIQUE|IDENTIFICATION|AUTHORITY|UIDAI|MALE|FEMALE|TRANSGENDER|CHEQUE|PAYEE|ONLY|CDSL|NSDL|DEPOSITORY|PARTICIPANT|HOLDER|FIRST|SOLE|SECOND|JOINT|CLIENT|MASTER|STATEMENT|DEMAT|STATUS|MR|MRS|MS|FATHER|FATHERS|NOMINATION|EMAIL|MOBILE|PHONE|TEL|ADDRESS|PIN|OF|THE|AND|CODE|आयकर|विभाग/i;
  const scanned = scanNameLines(lines, relaxedExclude);
  if (scanned) return scanned;
  // Strategy 4: try all lines, pick the longest alphabetic line that looks like a name
  let best: string | null = null;
  let bestScore = 0;
  for (const L of lines) {
    if (/FATHERS?\s*NAME|GUARDIAN|DOB|DATE OF BIRTH|BIRTH|SIGNATURE/i.test(L.text)) continue;
    const score = (L.text.match(/[A-Za-z]/g) || []).length;
    if (score > bestScore && score >= 4) {
      const candidate = lineNameCandidate(L);
      if (candidate) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  if (best) return best;
  return null;
}

function lineNameCandidate(L: OLine): string | null {
  const words = L.words.map((w) => w.t).filter(isPersonWord);
  if (words.length < 1 || words.length > 6) return null;
  const joined = words.join(" ").replace(/[^A-Za-z ]/g, " ").trim();
  if (!/^[A-Za-z]/.test(joined) || joined.replace(/ /g, "").length < 3) return null;
  return titleCase(joined);
}

function pickNameBelowPan(lines: OLine[], panLine?: OLine): string | null {
  if (!panLine) return null;
  const below = lines
    .filter((L) => L.y0 >= panLine.y1 - panLine.height * 1 && L.y0 <= panLine.y1 + panLine.height * 5) // widened vertical range
    .filter((L) => !/FATHER|DOB|DATE|BIRTH|SIGNATURE|जन्म|पिता/i.test(L.text))
    .filter((L) => !/\d{2}[\/\-.]\d{2}/.test(L.text))
    .sort((a, b) => b.height - a.height);
  for (const L of below) {
    const c = lineNameCandidate(L);
    if (c) return c;
  }
  return null;
}
function labeledName(lines: OLine[] | string[], label: RegExp, skip: RegExp): string | null {
  const asLines: OLine[] =
    Array.isArray(lines) && typeof lines[0] === "string"
      ? (lines as string[]).map((t) => ({ words: t.split(/\s+/).map((t2) => ({ t: t2.toUpperCase(), conf: 100, x0: 0, y0: 0, x1: 0, y1: 0 })), text: String(t).toUpperCase(), height: 10, x0: 0, y0: 0, x1: 0, y1: 0 }))
      : (lines as OLine[]);
  for (let i = 0; i < asLines.length; i++) {
    if (!label.test(asLines[i].text) || skip.test(asLines[i].text)) continue;
    const rest = asLines[i].text.replace(label, " ");
    const restLine: OLine = { ...asLines[i], text: rest, words: rest.split(/\s+/).filter(Boolean).map((t) => ({ t, conf: 100, x0: 0, y0: 0, x1: 0, y1: 0 })) };
    const c = lineNameCandidate(restLine) || (asLines[i + 1] ? lineNameCandidate(asLines[i + 1]) : null);
    if (c) return c;
  }
  return null;
}

function scanNameLines(lines: OLine[], exclude: RegExp): string | null {
  for (const L of lines) {
    if (exclude.test(L.text)) continue;
    const c = lineNameCandidate(L);
    if (c) return c;
  }
  return null;
}

/* ================= structured parsers (geometry) ================= */

export function parseStructured(kind: OcrKind, lines: OLine[], rawText: string): Record<string, string> {
  if (kind === "pan") return parsePanStructured(lines, rawText);
  if (kind === "aadhaar") return parseAadhaarStructured(lines, rawText);
  return parseDocument(kind, rawText); // cheque/cml stay text-based
}

function parsePanStructured(lines: OLine[], rawText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const { pan, line: panLine } = extractPanFromLines(lines);
  if (pan) out.panNumber = pan;

  // DOB: date pattern anywhere (space-tolerant), else year near a DOB label
  let dob = findDateInLines(lines);
  if (!dob) {
    const norm = rawText.replace(/(\d)\s*([\/\-.])\s*(\d)/g, "$1$2$3");
    const m = norm.match(/\b(\d{2})[\/\-.](\d{2})[\/\-.]((?:19|20)\d{2})\b/);
    if (m) dob = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (dob) out.dob = dob;

  const name = tryNameStrategies(lines) || 
    pickNameBelowPan(lines, panLine) ||
    labeledName(lines, /\bNAME\b/i, /FATHER/i) ||
    scanNameLines(
      lines,
      /INCOME|TAX|DEPARTMENT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|DATE|BIRTH|SIGNATURE|FATHER|\d/i
    );
  if (name) out.holderName = name.toUpperCase();
  return out;
}

function parseAadhaarStructured(lines: OLine[], rawText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grouped = rawText.match(/(?<!\d)(\d{4}) (\d{4}) (\d{4})(?!\d)/);
  const solid = rawText.match(/(?<!\d)\d{12}(?!\d)/);
  if (grouped) out.aadhaarNumber = grouped[0].replace(/\s/g, "");
  else if (solid) out.aadhaarNumber = solid[0];

  let dob = findDateInLines(lines);
  if (!dob) {
    const y = findYearInLines(lines) || (rawText.match(/\b(VID|YOB)\b/i) ? "" : "");
    if (y) out.yob = y;
  }
  if (dob) out.dob = dob;

  // name: line above the DOB/year line, else label, else largest clean line
  let name: string | null = null;
  const dobLineIdx = lines.findIndex((L) => /DOB|BIRTH|जन्म|\d{2}[\/\-.]\d{2}[\/\-.](19|20)\d{2}/i.test(L.text));
  if (dobLineIdx > 0) {
    for (let i = dobLineIdx - 1; i >= Math.max(0, dobLineIdx - 2); i--) {
      name = lineNameCandidate(lines[i]);
      if (name) break;
    }
  }
  name =
    name ||
    labeledName(lines, /\b(NAME|NAAM)\b/i, /FATHER|GUARDIAN|सन|CARE/i) ||
    scanNameLines(lines.filter((L) => !/\d{4}|VID|UIDAI|GOVERNMENT|INDIA|AADHAAR/i.test(L.text)), /^$/);
  if (name) out.holderName = name.toUpperCase();

  const addr = extractAddress(rawText);
  if (addr) out.address = addr;
  return out;
}

function devRatio(t: string): number {
  const letters = t.replace(/[^\w\u0900-\u097F]/g, "");
  if (!letters) return 0;
  const dev = t.replace(/[^\u0900-\u097F]/g, "");
  return dev.length / letters.length;
}

function tidyAddress(addr: string): string {
  // bilingual cards print Hindi + English twins — keep the Latin side only
  const segs = addr
    .split(", ")
    .map((x) => x.trim())
    .filter((seg) => seg.length > 1 && devRatio(seg) < 0.4);
  return segs.length ? segs.join(", ") : "";
}

function tidyAddressRaw(addr: string): string {
  return addr
    .replace(/\b(MOBILE|MOB|EMAIL|E-MAIL|PHONE|TEL|VID|UIDAI|GOVERNMENT OF INDIA|DOB|DOBI|जन्म)\b[^,]*/gi, "")
    .replace(/[^\w/,\-#. ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(, )+/g, ", ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/** keep the Latin line when a Devanagari twin duplicates it */
export function dedupeHindi(lines: string[]): string[] {
  const isDev = (t: string) => /[\u0900-\u097F]/.test(t);
  const norm = (t: string) => t.replace(/[^A-Z0-9 ]/gi, "").toUpperCase().replace(/\s+/g, " ").trim();
  const seenLatin = new Set(lines.filter((l) => !isDev(l)).map(norm));
  return lines.filter((l) => !(isDev(l) && norm(l).length > 2 && [...seenLatin].some((x) => x.length > 2)));
}

function extractAddress(rawText: string): string {
  const HEADER=/\b(GOVERNMENT( OF)?|भारत सरकार|UIDAI|आधार|AADHAARA?)\b/i;
  const rawLines = dedupeHindi(rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const STOP = /\b(MOBILE|MOB|EMAIL|PHONE|TEL|VID|DOB|DOBI|UIDAI|SAVING|CURRENT|ACCT|IMPORTANT|HELP|WWW|GOVERNMENT|INDIA|AADHAAR|आधार)\b/i;
  const startIdx = rawLines.findIndex((l) => /\bADDRESS\b|पता|पत्ता|इस ओर/i.test(l));
  if (startIdx >= 0) {
    const parts: string[] = [];
    for (let i = startIdx; i < rawLines.length && parts.length < 7; i++) {
      if (i > startIdx && STOP.test(rawLines[i])) break;
      const l = rawLines[i]
        .replace(/^.*?\bADDRESS\b\s*:?\s*/i, "")
        .replace(/^.*?पत्ता\s*:?\s*/, "")
        .replace(/^.*?पता\s*:?\s*/, "")
        .replace(/^.*?इस ओर का पता\s*:?\s*/, "")
        .trim();
      if (!l || /^[-|>]+$/.test(l)) continue;
      parts.push(l);
      if (/\b\d{6}\b/.test(l)) break;
    }
    const joined = tidyAddress(parts.join(", "));
    return joined.length > 8 ? joined.slice(0, 300) : "";
  }
  const pinIdx = rawLines.findIndex((l) => /\b\d{6}\b/.test(l) && !/^\d{12}$/.test(l.replace(/\s/g, "")) && !/^\d{16}$/.test(l.replace(/\s/g, "")));
  if (pinIdx > 0) {
    // walk up from the PIN collecting address lines; stop at personal/noise lines
    const DOBISH = /\b\d{2}[\/\-.]\d{2}[\/\-.](?:19|20)\d{2}\b|\bDOB\b|\bYOJ|\bYOB\b|\bVID\b|\bMOBILE\b/i;
    const parts: string[] = [rawLines[pinIdx]];
    for (let i = pinIdx - 1; i >= 0 && parts.length < 7; i--) {
      const l = rawLines[i];
      if (!l || l.length < 3) break;
      if (DOBISH.test(l)) break;
      if (/^(?:GOVERNMENT|INDIA|UIDAI|AADHAAR|भारत|सरकार)/i.test(l)) break;
      if ((l.replace(/[^A-Za-z\u0900-\u097F]/g, "").length < 3) && !/,/.test(l)) break;
      parts.unshift(l);
    }
    const joined = tidyAddress(parts.join(", "));
    return joined.length > 8 ? joined.slice(0, 300) : "";
  }
  return "";
}

/* ================= text-only parsers (digital PDFs) ================= */

/** parse DOB from free text: dd/mm/yyyy OR yyyy-mm-dd (space tolerant) → [y, m, d] */
function parseDobFromText(text: string): string[] | null {
  const norm = text.replace(/(\d)\s*([\/\-.])\s*(\d)/g, "$1$2$3");
  const dm = norm.match(/\b(\d{2})[\/\-.]?(\d{2})[\/\-]?((?:19|20)\d{2})\b/);
  if (dm) return [dm[3], dm[2], dm[1]];
  const im = norm.match(/\b((?:19|20)\d{2})[\/\-.]?(\d{2})[\/\-]?(\d{2})\b/);
  if (im) return [im[1], im[2], im[3]];
  return null;
}

function parsePanText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pan = extractPanFromText(text);
  if (pan) out.panNumber = pan;
  const d = parseDobFromText(text);
  if (d) out.dob = `${d[0]}-${d[1]}-${d[2]}`;
  const lines: OLine[] = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 2)
    .map((t) => ({
      words: t.toUpperCase().split(/\s+/).filter(Boolean).map((w) => ({ t: w, conf: 100, x0: 0, y0: 0, x1: 0, y1: 0 })),
      text: t.toUpperCase(),
      height: 10, x0: 0, y0: 0, x1: 0, y1: 0,
    }));
  const name = tryNameStrategies(lines) || 
    labeledName(lines, /\bNAME\b/i, /FATHER/i) ||
    scanNameLines(
      lines.filter((l) => !(pan && l.text.replace(/\s/g, "").includes(pan))),
      /INCOME|TAX|DEPARTMENT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|DATE|BIRTH|SIGNATURE|FATHER|\d/i
    );
  if (name) out.holderName = name.toUpperCase();
  return out;
}

function parseAadhaarText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grouped = text.match(/(?<!\d)(\d{4}) (\d{4}) (\d{4})(?!\d)/);
  const solid = text.match(/(?<!\d)\d{12}(?!\d)/);
  if (grouped) out.aadhaarNumber = grouped[0].replace(/\s/g, "");
  else if (solid) out.aadhaarNumber = solid[0];
  const d = parseDobFromText(text);
  if (d) out.dob = `${d[0]}-${d[1]}-${d[2]}`;
  else {
    const y = text.match(/\b(YOB|YEAR OF BIRTH)\b\s*:?\s*((?:19|20)\d{2})/i) || text.match(/\b((?:19|20)\d{2})\b/);
    if (y) out.yob = y[y.length - 1];
  }
  const lines: OLine[] = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 2)
    .map((t) => ({
      words: t.toUpperCase().split(/\s+/).filter(Boolean).map((w) => ({ t: w, conf: 100, x0: 0, y0: 0, x1: 0, y1: 0 })),
      text: t.toUpperCase(),
      height: 10, x0: 0, y0: 0, x1: 0, y1: 0,
    }));
  let name: string | null = null;
  const dobLineIdx = lines.findIndex((L) => /DOB|BIRTH|जन्म|\d{2}[\/\-.]\d{2}[\/\-.](19|20)\d{2}|\b(19|20)\d{2}\b/i.test(L.text));
  if (dobLineIdx > 0) {
    for (let i = dobLineIdx - 1; i >= Math.max(0, dobLineIdx - 2); i--) {
      name = lineNameCandidate(lines[i]);
      if (name) break;
    }
  }
  name =
    name ||
    labeledName(lines, /\b(NAME|NAAM)\b/i, /FATHER|GUARDIAN/i) ||
    scanNameLines(lines.filter((L) => !/\d{4}|VID|UIDAI|GOVERNMENT|INDIA|AADHAAR/i.test(L.text)), /^$/);
  if (name) out.holderName = name.toUpperCase();
  const addr = extractAddress(text);
  if (addr) out.address = addr;
  return out;
}

const BANKS = [
  "HDFC BANK", "ICICI BANK", "STATE BANK OF INDIA", "AXIS BANK", "KOTAK MAHINDRA",
  "PUNJAB NATIONAL BANK", "BANK OF BARODA", "CANARA BANK", "UNION BANK OF INDIA",
  "IDFC FIRST BANK", "INDUSIND BANK", "YES BANK", "FEDERAL BANK", "RBL BANK",
  "BANDHAN BANK", "AU SMALL FINANCE BANK", "CENTRAL BANK OF INDIA", "INDIAN BANK",
  "INDIAN OVERSEAS BANK", "UCO BANK", "BANK OF INDIA", "IDBI BANK", "CITIBANK",
  "HSBC", "STANDARD CHARTERED", "DBS BANK", "SOUTH INDIAN BANK", "KARNATAKA BANK",
];

/* first-4 IFSC chars → bank name (reliable fallback when OCR misses the printed name) */
const IFSC_BANK: Record<string, string> = {
  HDFC: "HDFC BANK", ICIC: "ICICI BANK", SBIN: "STATE BANK OF INDIA", UTIB: "AXIS BANK",
  KKBK: "KOTAK MAHINDRA BANK", PUNB: "PUNJAB NATIONAL BANK", BARB: "BANK OF BARODA",
  CNRB: "CANARA BANK", UBIN: "UNION BANK OF INDIA", IDFB: "IDFC FIRST BANK",
  INDB: "INDUSIND BANK", YESB: "YES BANK", FDRL: "FEDERAL BANK", RATN: "RBL BANK",
  BDBL: "BANDHAN BANK", AUBL: "AU SMALL FINANCE BANK", CBIN: "CENTRAL BANK OF INDIA",
  IDIB: "INDIAN BANK", IOBA: "INDIAN OVERSEAS BANK", UCBA: "UCO BANK", BKID: "BANK OF INDIA",
  IBKL: "IDBI BANK", CITI: "CITIBANK", HSBC: "HSBC", SCBL: "STANDARD CHARTERED",
  DBSS: "DBS BANK", TMBL: "TAMILNAD MERCANTILE BANK", KARB: "KARNATAKA BANK",
  JSFB: "JANA SMALL FINANCE BANK", ESFB: "EQUITAS SMALL FINANCE BANK", NSDL: "NSDL",
  SIBL: "SOUTH INDIAN BANK",
};

/** fix classic OCR swaps inside an IFSC candidate: 5th char must be 0 */
/** fix classic OCR swaps inside an IFSC-like run: 5th char must be 0 */
function cleanIfsc(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = c.match(/^[A-Z]{4}[O0Q][A-Z0-9]{6}$/);
  if (!m) return null;
  return c.slice(0, 4) + "0" + c.slice(5);
}

function parseChequeText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const up = text.toUpperCase();
  const lines = up.split(/\r?\n/);

  /* ---- IFSC: per-line, space-tolerant, gated to kill false positives ---- */
  let ifsc: string | null = null;
  for (const ln of lines) {
    const flat = ln.replace(/[^A-Z0-9]/g, "");
    for (const cand of flat.match(/[A-Z]{4}[O0Q][A-Z0-9]{6}/g) || []) {
      const fixed = cleanIfsc(cand);
      if (!fixed) continue;
      const tail = fixed.slice(5);
      const digitsInTail = (tail.match(/\d/g) || []).length;
      const knownBank = !!IFSC_BANK[fixed.slice(0, 4)];
      const labelled = /IFSC|NEFT|RTGS/.test(ln);
      if (knownBank || labelled || digitsInTail >= 4) {
        // letter↔digit fixes in the numeric tail
        ifsc = fixed.slice(0, 5) +
          fixed.slice(5).replace(/O/g, "0").replace(/[Il]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6");
        break;
      }
    }
    if (ifsc) break;
  }
  if (ifsc) out.ifsc = ifsc;

  /* ---- account number: per-line consecutive group joins, scored ---- */
  type Run = { r: string; score: number };
  const runs: Run[] = [];
  for (const ln of lines) {
    const groups = ln.match(/\d{2,}/g) || [];
    if (!groups.length) continue;
    const ctx =
      (/A\.?\/?.?C|ACCT|ACCOUNT/.test(ln) ? 25 : 0) -
      (/IFSC|CHEQUE|CHEQUE|PAY\b|MICR|DRAWN|DATE|\bRS\b/.test(ln) ? 40 : 0);
    // consecutive joins
    for (let i = 0; i < groups.length; i++) {
      let acc = "";
      for (let j = i; j < groups.length; j++) {
        acc += groups[j];
        if (acc.length > 18) break;
        if (acc.length >= 9 && /^\d+$/.test(acc)) {
          if (!(ifsc && acc.includes(ifsc.slice(4)))) runs.push({ r: acc, score: acc.length * 2 + ctx });
        }
      }
    }
  }
  const acct = runs.sort((x, y) => y.score - x.score)[0]?.r;
  if (acct) out.accountNo = acct;

  /* ---- bank name ---- */
  for (const bank of BANKS) {
    if (up.includes(bank)) { out.bankName = bank; break; }
  }
  if (!out.bankName && ifsc) out.bankName = IFSC_BANK[ifsc.slice(0, 4)] ?? "";
  if (!out.bankName) {
    const line = lines.find((l) => /\bBANK\b/.test(l) && l.length < 42);
    if (line) out.bankName = line.trim().replace(/[^A-Z &]/g, "").trim();
  }
  return out;
}

function parseCmlText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const up = text.toUpperCase();
  const nsdlDp = up.match(/\bIN\d{6}\b/);
  const cdslDp = up.match(/\b12\d{6}\b/);
  if (nsdlDp) out.dpId = nsdlDp[0];
  else if (cdslDp) out.dpId = cdslDp[0];
  const bo16 = up.match(/(?<!\d)\d{16}(?!\d)/);
  const labeledClient = up.match(/CLIENT\s*(?:ID|NO)\s*[:=]?\s*(\d{8})/i);
  if (labeledClient) out.clientId = labeledClient[1];
  else if (bo16) out.clientId = bo16[0].slice(-8);
  const dpNameLine = up
    .split(/\r?\n/)
    .find((l) => /DP\s*NAME\s*[:=]|DEPOSITARY\s*PARTICIPANT\s*NAME|DEPOSITORY\s*PARTICIPANT\s*NAME/i.test(l));
  if (dpNameLine) {
    const nm = dpNameLine.replace(/^.*?(DP\s*NAME|DEPOSITARY\s*PARTICIPANT\s*NAME|DEPOSITORY\s*PARTICIPANT\s*NAME)\s*:?\s*/i, "")
      .replace(/^NAME\s*:?\s*/i, "").trim();
    if (/^(STATEMENT|CLIENT|MASTER|LIST)$/i.test(nm) || nm.length < 4) {
      // fall through — not a name
    } else if (nm) out.dpName = titleCase(nm.toLowerCase());
  }
  const lines: OLine[] = up
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 2)
    .map((t) => ({
      words: t.split(/\s+/).filter(Boolean).map((w) => ({ t: w, conf: 100, x0: 0, y0: 0, x1: 0, y1: 0 })),
      text: t, height: 10, x0: 0, y0: 0, x1: 0, y1: 0,
    }));
  const holder =
    labeledName(lines, /(FIRST|SOLE|SECOND)\s+(HOLDER|APPLICANT|ACCOUNT\s*HOLDER)/i, /FATHER/i) ||
    labeledName(lines, /\bNAME\b/i, /FATHER/i) ||
    scanNameLines(lines, /CDSL|NSDL|DP\s|CLIENT|MASTER|STATEMENT|\d{8,}/i);
  if (holder) out.holderName = holder.toUpperCase();

  const mobile =
    text.match(/(?:MOBIL?E|MOB|PHONE|TEL)[^\d]{0,6}((?<!\d)[6-9]\d{9}(?!\d))/i) ||
    text.match(/(?<!\d)[6-9]\d{9}(?!\d)/);
  if (mobile) out.mobileNo = mobile[1] ?? mobile[0];
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.\-]+/);
  if (email) out.email = email[0].toLowerCase();

  const rawLines = text.split(/\r?\n/);
  const startIdx = rawLines.findIndex((l) => /\bADDRESS\b/i.test(l));
  const from = startIdx >= 0 ? startIdx : rawLines.findIndex((l) => /HOLDER|NAME/i.test(l));
  if (from >= 0) {
    const parts: string[] = [];
    for (let i = from; i < rawLines.length && parts.length < 6; i++) {
      const l = rawLines[i].replace(/^.*?\bADDRESS\b\s*:?\s*/i, "").trim();
      if (!l || /^(EMAIL|MOBILE|PHONE|TEL|DP\s)/i.test(l)) continue;
      parts.push(l.replace(/\b(EMAIL|MOBILE|PHONE|TEL)\b.*$/i, "").trim());
      if (/\b\d{6}\b/.test(l)) break;
    }
    const addr = parts.join(", ").replace(/,\s*,/g, ",").replace(/^,\s*/, "").trim();
    if (addr.length > 8) out.address = addr.slice(0, 300);
  }
  return out;
}

export function parseDocument(kind: OcrKind, rawText: string): Record<string, string> {
  switch (kind) {
    case "pan":
      return parsePanText(rawText);
    case "aadhaar":
      return parseAadhaarText(rawText);
    case "cheque":
      return parseChequeText(rawText);
    case "cml":
      return parseCmlText(rawText);
    default:
      return {};
  }
}

/* ================= PaddleOCR bridge (PP-OCRv4 via @gutenye/ocr-browser) ================= */
import { paddleOcr } from "./paddle-ocr";

export async function ocrImagePaddle(
  bytes: Uint8Array,
  kind: OcrKind,
  onProgress?: (pct: number) => void
): Promise<OcrResult> {
  onProgress?.(10);
  const res = await paddleOcr(bytes);
  if (!res) return { ok: false, fields: {}, error: "PaddleOCR unavailable" };
  if (res.error && !res.lines.length) return { ok: false, fields: {}, error: res.error };
  onProgress?.(70);
  // one word per detected line, box from the paddle frame — parseStructured regroups
  const pseudo = res.lines.map((l) => ({
    paragraphs: [
      { lines: [{ words: [{ text: l.text, confidence: Math.round(l.score * 100), bbox: l.box }] }] },
    ],
  }));
  const lines = toLines(pseudo);
  const text = res.lines.map((l) => l.text).join("\n");
  const fields = lines.length ? parseStructured(kind, lines, text) : parseDocument(kind, text);
  onProgress?.(95);
  return { ok: Object.keys(fields).length > 0, fields, rawText: text };
}
