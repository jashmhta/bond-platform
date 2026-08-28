/**
 * Free, 100%-accurate path for digital PDFs (CML/CMR downloads, e-Aadhaar):
 * reads the embedded text layer via pdf.js — no OCR needed.
 * Always rasterizes page 1 for the right-side preview; OCR only when the
 * text layer is missing (scanned PDF).
 */

export type PdfExtract = {
  text: string; // embedded text layer ("" when scanned)
  hasTextLayer: boolean;
  previewDataUrl: string; // page 1 as JPEG — for the preview pane
  ocrBytes: Uint8Array | null; // page-1 raster, only needed for scans
};

let workerReady = false;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerReady = true;
  }
  return pdfjs;
}

export async function extractPdf(file: File, minChars = 40): Promise<PdfExtract> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  let text = "";
  const pages = Math.min(doc.numPages, 4); // CMLs rarely exceed a few pages
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) {
        text += item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ");
      }
    }
    text += "\n";
  }
  text = text.replace(/[ \t]+\n/g, "\n").trim();

  // page-1 raster — doubles as preview and as OCR input for scans
  const page1 = await doc.getPage(1);
  const viewport = page1.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  let previewDataUrl = "";
  let ocrBytes: Uint8Array | null = null;
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page1.render({ canvas, canvasContext: ctx, viewport }).promise;
    /* preview MUST be a data URL — blob: URLs die with the tab and would
       silently vanish from the saved KYC (data-leak bug) */
    previewDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (blob) {
      ocrBytes = new Uint8Array(await blob.arrayBuffer());
    }
  }

  return { text, hasTextLayer: text.length >= minChars, previewDataUrl, ocrBytes };
}
