import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { LOGO_PNG_BASE64 } from "./logo-data";
import { amountInWords } from "./words";

export const COMPANY = {
  name: "BINARYBONDS PRIVATE LIMITED",
  pan: "AALCB3429N",
  cin: "U67100MH2023PTC396840",
  email: "COMPLIANCE@BINARYBONDS.IN",
  altEmail: "shray@binarycapital.in",
  phone: "7738056127",
  regdAdd:
    "A-702 Itus Dinanath Chs Ltd Sahyog Nagar, Ambivali Opp. Kokilaben Hospital, Andheri West, Mumbai, Maharashtra, India, 400053",
};

export const SETTLEMENT = {
  mode: "BSE CLEARING CORPORATION",
  paymentInFavorOf: "BSE CLEARING CORPORATION",
  beneficiary: "BSE CLEARING CORPORATION",
  bank: "RESERVE BANK OF INDIA",
  accountNo: "8715962",
  ifsc: "BSE0000001",
  branch: "FORT, MUMBAI",
};

export type DealPdfData = {
  refNo: string;
  dealDateDash: string;
  dealDateSlash: string;
  side: "SELL" | "BUY";
  /* client identity */
  clientName: string;
  pan: string;
  clientAddress?: string;
  dobLabel?: string;
  ucc?: string;
  mobile?: string;
  email?: string;
  fatherName?: string;
  /* bank */
  bankName?: string;
  bankIfsc?: string;
  bankAccountNo?: string;
  /* demat */
  dpId: string;
  clientId: string;
  dpName: string;
  boId?: string;
  nomineeName?: string;
  occupation?: string;
  /* transaction */
  security: string;
  isin: string;
  paymentDates: string;
  maturity: string;
  price: string;
  cleanPrice: string;   // clean price per Rs.100 face, 3dp — the reference format
  yieldPct: string;
  totalFaceValue: string;
  units: string;
  principal: string;
  accrued: string;
  interestDays: string;
  stampDuty: string;
  dealAmount: string;   // principal + accrued (TOTAL row, before stamp)
  total: string;        // total consideration = dealAmount + stamp
};

const INK = rgb(0.06, 0.06, 0.07);
const GREY = rgb(0.38, 0.38, 0.43);
const BLUE = rgb(0.06, 0.29, 0.62);         // total-consideration accent
const BLUE_TINT = rgb(0.914, 0.937, 0.976); // row shading behind the blue accent
const GOLD = rgb(0.66, 0.49, 0.11);         // deep gold — rules, bands, accents
const GOLD_TINT = rgb(0.972, 0.945, 0.872); // warm gold band fill
const GOLD_LINE = rgb(0.83, 0.72, 0.45);    // light gold rules
const LINE = rgb(0.1, 0.1, 0.12);
const SOFT = rgb(0.55, 0.55, 0.6);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const LABEL_X = M + 6;
const VALUE_X = M + 158;
const RIGHT_EDGE = PAGE_W - M;

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) cur = test;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

type CellLine = {
  text: string;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  right?: boolean;
};

type Row = {
  label: string[];
  lines: CellLine[];
  labelColor?: ReturnType<typeof rgb>;
  gap?: boolean; // extra visual separation above this row
};

export async function buildDealPdf(d: DealPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /* ================= centered watermark (behind everything) ================= */
  try {
    const wm = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
    const wmSize = 300;
    page.drawImage(wm, {
      x: (PAGE_W - wmSize) / 2,
      y: (PAGE_H - wmSize) / 2 + 40,
      width: wmSize,
      height: wmSize,
      opacity: 0.055,
    });
  } catch {
    /* watermark is decorative — skip if the logo can't embed */
  }

  /* ================= letterhead (centered: logo + name as one unit) ================= */
  let logoImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  let logoW = 0, logoH = 0;
  try {
    logoImg = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
    logoW = 40;
    logoH = logoImg.height * (logoW / logoImg.width);
  } catch {
    logoImg = null;
  }
  const nameW = bold.widthOfTextAtSize(COMPANY.name, 15.5);
  const unitW = (logoImg ? logoW + 12 : 0) + nameW;
  const unitX = (PAGE_W - unitW) / 2;
  const logoTop = PAGE_H - M - 12;
  if (logoImg) page.drawImage(logoImg, { x: unitX, y: logoTop - logoH, width: logoW, height: logoH });
  page.drawText(COMPANY.name, {
    x: unitX + (logoImg ? logoW + 12 : 0), y: logoTop - logoH / 2 - 5.5, size: 15.5, font: bold, color: INK,
  });
  const headRuleY = logoTop - logoH - 10;
  page.drawLine({
    start: { x: M, y: headRuleY }, end: { x: RIGHT_EDGE, y: headRuleY },
    thickness: 1.6, color: GOLD,
  });

  let y = headRuleY - 16;

  /* ================= ref + date ================= */
  page.drawText(`Deal Ref No.: ${d.refNo}`, { x: LABEL_X, y, size: 9.5, font: bold, color: INK });
  const dateTxt = `Date: ${d.dealDateDash}`;
  page.drawText(dateTxt, {
    x: RIGHT_EDGE - font.widthOfTextAtSize(dateTxt, 9.5), y, size: 9.5, font: bold, color: INK,
  });

  /* ================= To block (with full address) ================= */
  y -= 17;
  page.drawText("To,", { x: LABEL_X, y, size: 9.5, font, color: INK });
  y -= 13;
  const nameLine = `${/^MR\.|^MRS\.|^MS\.|^M\/S\./i.test(d.clientName) ? "" : "Mr. "}${d.clientName},`;
  page.drawText(nameLine.slice(0, 90), { x: LABEL_X, y, size: 9.5, font: bold, color: INK });

  const addrLines = wrap(d.clientAddress || "", font, 8.6, RIGHT_EDGE - LABEL_X - 30).slice(0, 2);
  for (const al of addrLines) {
    y -= 11;
    page.drawText(al, { x: LABEL_X + 2, y, size: 8.6, font, color: GREY });
  }
  y -= 12;
  if (d.pan) page.drawText(`PAN: ${d.pan}`, { x: LABEL_X, y, size: 8.6, font, color: INK });

  y -= 16;
  page.drawText(
    `We confirm the ${d.side === "SELL" ? "sell" : "buy"} of the following security, the details of which are given below:`,
    { x: LABEL_X, y, size: 9.5, font: bold, color: INK }
  );

  /* ================= client detail strip (sits fully below the intro) ================= */
  const dpRows: Array<[string, string]> = [
    ["DP NAME", d.dpName || "—"],
    ["DP ID", d.dpId || "—"],
    ["CLIENT ID", d.clientId || "—"],
  ];
  const bankRows: Array<[string, string]> = [
    ["BANK NAME", d.bankName || "—"],
    ["IFSC CODE", d.bankIfsc || "—"],
    ["BANK A/C NO", d.bankAccountNo || "—"],
  ];
  /* personal rows render only when filled — never blank on the letterhead */
  const personalAll: Array<[string, string]> = [
    ["FATHER'S NAME", d.fatherName || ""],
    ["OCCUPATION", d.occupation || ""],
    ["NOMINEE", d.nomineeName || ""],
  ];
  const personal = personalAll.filter(([, v]) => String(v).trim() !== "");
  const cdRows: Array<[string, string]> = [...dpRows, ...personal, ...bankRows];
  const cdSize = 8;
  const cdLead = 11.2;
  const cdColW = (RIGHT_EDGE - M - 12) / 2;
  /* strict reference layout: LEFT = DP details (+ personal when filled), RIGHT = bank */
  const cdLeft: Array<[string, string]> = [...dpRows, ...personal];
  const cdRight: Array<[string, string]> = [...bankRows];
  const cdRowCount = Math.max(cdLeft.length, cdRight.length);
  const stripH = 12 /* header */ + cdRowCount * cdLead + 7 /* bottom pad */;
  /* drawn AFTER the transaction table (drawStrip below) — client details follow the deal terms */

  const drawStrip = (stripTop: number) => {
    const stripBot = stripTop - stripH;
    page.drawRectangle({
      x: M, y: stripBot, width: RIGHT_EDGE - M, height: stripH,
      borderColor: GOLD_LINE, borderWidth: 0.8, color: rgb(0.996, 0.99, 0.975),
    });
    page.drawRectangle({
      x: M, y: stripTop - 12, width: RIGHT_EDGE - M, height: 12,
      color: rgb(0.93, 0.925, 0.915),
    });
    page.drawText("CLIENT DETAILS", { x: LABEL_X, y: stripTop - 8.8, size: 7.2, font: bold, color: rgb(0.25, 0.24, 0.22) });
    page.drawLine({                                    // column divider
      start: { x: M + 8 + cdColW, y: stripBot + 4 }, end: { x: M + 8 + cdColW, y: stripTop - 13 },
      thickness: 0.5, color: GOLD_LINE,
    });
    const drawCd = (col: number) => (r: [string, string], ri: number) => {
      const ry = stripTop - 20.5 - ri * cdLead;
      page.drawText(r[0], { x: M + 8 + col * cdColW, y: ry, size: 7, font, color: SOFT });
      const valX = M + 96 + col * cdColW;
      const maxW = cdColW - 104;
      let v = r[1];
      let vSize = cdSize;
      if (bold.widthOfTextAtSize(v, vSize) > maxW) vSize = 7.2;           // shrink long names first
      while (v && bold.widthOfTextAtSize(v, vSize) > maxW) v = v.slice(0, -2);
      if (v !== r[1] && v) v += "…";
      page.drawText(v || "—", { x: valX, y: ry, size: vSize, font: bold, color: INK });
    };
    cdLeft.forEach(drawCd(0));
    cdRight.forEach(drawCd(1));
  };

  /* ================= transaction table (auto-fit typography) ================= */
  const money = (v: string) => `Rs. ${v}`;

  const buildRows = (bodySize: number): Row[] => [
    { label: ["OUR"], lines: [{ text: `OUTRIGHT ${d.side}`, font: bold, size: bodySize }] },
    { label: ["SECURITY"], lines: wrap(d.security, bold, bodySize, RIGHT_EDGE - VALUE_X - 8).map((t) => ({ text: t, font: bold, size: bodySize })) },
    { label: ["ISIN"], lines: [{ text: d.isin || "—", font, size: bodySize }] },
    { label: ["INTEREST PAYMENT DATES"], lines: [{ text: d.paymentDates || "MONTHLY", font: bold, size: bodySize }] },
    { label: ["MATURITY DATE"], lines: [{ text: d.maturity || "—", font, size: bodySize }] },
    {
      label: ["PRICE"],
      lines: [
        { text: d.cleanPrice ? money(d.cleanPrice) : money(d.price), font, size: bodySize },
        { text: `YIELD: ${d.yieldPct || "—"} (YTM)`, font: bold, size: bodySize, right: true },
      ],
    },
    {
      label: ["TOTAL FACE VALUE"],
      lines: [
        { text: money(d.totalFaceValue), font, size: bodySize },
        { text: `NO OF UNITS: ${d.units}`, font: bold, size: bodySize, right: true },
      ],
    },
    { label: ["PRINCIPAL AMOUNT"], lines: [{ text: money(d.principal), font, size: bodySize }] },
    {
      label: ["ACCRUED INTEREST"],
      lines: [
        { text: money(d.accrued), font, size: bodySize },
        { text: `INTEREST DAYS : ${d.interestDays} (DAYS)`, font: bold, size: bodySize, right: true },
      ],
    },
    { label: ["TOTAL"], lines: [{ text: money(d.dealAmount || d.total), font: bold, size: bodySize }] },
    {
      label: ["STAMP DUTY", "(to be paid by buyer)"],
      lines: [
        { text: money(d.stampDuty || "0.00"), font, size: bodySize },
        { text: "(To be retained by Exchange)", font, size: bodySize },
      ],
    },
    {
      label: ["TOTAL CONSIDERATION"],
      labelColor: BLUE,
      lines: [
        { text: money(d.total), font: bold, size: bodySize, color: BLUE },
        ...wrap(`(${amountInWords(Number(String(d.total).replace(/,/g, "")) || 0)})`, bold, Math.max(bodySize - 0.6, 7.2), RIGHT_EDGE - VALUE_X - 8)
          .map((t) => ({ text: t, font: bold, size: Math.max(bodySize - 0.6, 7.2), color: BLUE }) as CellLine),
      ],
    },
    { label: ["DEAL DATE"], lines: [{ text: d.dealDateSlash, font, size: bodySize }] },
    { label: ["VALUE DATE"], lines: [{ text: d.dealDateSlash, font, size: bodySize }] },
    { label: ["MARKET TYPE"], lines: [{ text: `BSE T+0`, font: bold, size: bodySize }] },
    { label: ["SETTLEMENT MODE"], lines: [{ text: SETTLEMENT.mode, font: bold, size: bodySize }] },
    {
      label: ["SETTLEMENT DETAILS"],
      lines: [
        { text: `BENEFICIARY:- ${SETTLEMENT.beneficiary}`, font, size: bodySize - 0.6 },
        { text: `BANK :- ${SETTLEMENT.bank}   A/C NO :- ${SETTLEMENT.accountNo}   IFSC :- ${SETTLEMENT.ifsc}`, font, size: bodySize - 0.6 },
        { text: `BRANCH :- ${SETTLEMENT.branch}`, font, size: bodySize - 0.6 },
      ],
    },
    { label: ["PAYMENT IN FAVOR OF"], lines: [{ text: SETTLEMENT.paymentInFavorOf, font: bold, size: bodySize }] },
  ];

  const ACK_PARAS = [
    "I/We, the undersigned, do hereby expressly acknowledge, agree, and confirm that the foregoing transaction has been executed by me/us voluntarily, of my/our own free will and without any inducement, coercion, solicitation, or undue influence from your end or any of your representatives.",
    "I/We further acknowledge that prior to making any investment and/or subscribing to the aforementioned securities, I/we have carefully read, reviewed, and fully understood all relevant transaction-related documents, including but not limited to the offer document, instrument description, term sheet, security features, statutory filings, issuer-related disclosures, credit rating letters, rating rationales, and any other materials as may be applicable.",
    "I/We fully comprehend and accept the various risks associated with investing in or subscribing to the said securities, including Credit Risk, Market Risk, Default Risk, Counterparty Risk, Liquidity Risk, Instrument-Specific Risk, Interest Rate Risk, Reinvestment Risk, Regulatory and Legal Risk, and any other risks inherent in the trading or holding of bonds and/or other fixed income securities.",
    "I/We further understand and agree that BinaryBonds shall bear no responsibility or liability whatsoever for any default, whether partial or complete, in the payment of interest and/or principal amount by the issuer of the said securities.",
    "For any further clarification or additional information required in relation to the above, I/we shall contact the relevant team at:",
    `${COMPANY.email.toLowerCase()} / ${COMPANY.altEmail}`,
  ];

  /* typography ladder: try normal → compact → dense until table + full ack fit above the footer */
  const LEVELS = [
    { body: 8.8, pad: 3,   ack: 6.9, lead: 8.3, gap: 1.4 },
    { body: 8.4, pad: 2.8, ack: 6.6, lead: 7.9, gap: 1.4 },
    { body: 8.3, pad: 2.5, ack: 6.4, lead: 7.7, gap: 1.4 },
    { body: 7.9, pad: 2.2, ack: 6.0, lead: 7.2, gap: 1.2 },
  ];
  const bandH = 15;
  const SIG_BLOCK = 48;  // For/name (16) + PAN row (20) + gap (12)
  const CG_ZONE = 20;
  const FLOOR = 116;     // ack must end above the CG notice zone

  let chosen = LEVELS[LEVELS.length - 1];
  let rows: Row[] = [];
  let heights: number[] = [];
  for (const L of LEVELS) {
    rows = buildRows(L.body);
    heights = rows.map((r) => {
      const labelH = r.label.length * (L.body - 0.5);
      const valH = r.lines.reduce((acc, l, i) => acc + (l.right && i > 0 ? 0 : L.body + 3.2), 0);
      return Math.max(labelH, valH) + L.pad * 2;
    });
    const tableH = bandH + heights.reduce((a2, b2) => a2 + b2, 0);
    const ackLines = ACK_PARAS.reduce((acc, t) => acc + wrap(t, font, L.ack, RIGHT_EDGE - M).length, 0);
    const ackH = ackLines * L.lead + (ACK_PARAS.length - 1) * L.gap;
    /* vertical stack: table → client strip → signatures → ack → CG notice */
    if (y - 10 - tableH - 10 - stripH - 12 - SIG_BLOCK - 12 - ackH - CG_ZONE >= FLOOR) { chosen = L; break; }
    chosen = L;
  }

  const { body: bodySize, pad: padY, ack: ackSize, lead, gap } = chosen;

  const tableTop = y - 10;
  const tableBottom = tableTop - bandH - heights.reduce((a2, b2) => a2 + b2, 0);

  page.drawRectangle({
    x: M, y: tableBottom, width: RIGHT_EDGE - M, height: tableTop - tableBottom,
    borderColor: LINE, borderWidth: 0.9,
  });
  page.drawRectangle({
    x: M, y: tableTop - bandH, width: RIGHT_EDGE - M, height: bandH,
    color: GOLD_TINT,
  });
  page.drawText("TRANSACTION DETAILS", {
    x: LABEL_X, y: tableTop - bandH + 4.5, size: 7.4, font: bold, color: GOLD,
  });
  page.drawLine({ start: { x: M, y: tableTop - bandH }, end: { x: RIGHT_EDGE, y: tableTop - bandH }, thickness: 0.9, color: GOLD_LINE });

  const totalIdx = rows.findIndex((r) => r.label[0] === "TOTAL" && r.lines[0].text.startsWith("Rs."));
  const tcIdx = rows.findIndex((r) => r.label[0] === "TOTAL CONSIDERATION");

  let ry = tableTop - bandH;
  rows.forEach((r, i) => {
    const h = heights[i];
    ry -= h;
    if (i === totalIdx) page.drawRectangle({ x: M, y: ry, width: RIGHT_EDGE - M, height: h, color: GOLD_TINT });
    if (i === tcIdx) page.drawRectangle({ x: M, y: ry, width: RIGHT_EDGE - M, height: h, color: BLUE_TINT });
    if (i < rows.length - 1) {
      page.drawLine({ start: { x: M, y: ry }, end: { x: RIGHT_EDGE, y: ry }, thickness: 0.55, color: rgb(0.78, 0.78, 0.8) });
    }
    r.label.forEach((lt, li) => {
      page.drawText(lt, {
        x: LABEL_X, y: ry + h - padY - 8 - li * (bodySize + 2.2),
        size: Math.min(bodySize - 0.8, 8), font: bold, color: r.labelColor ?? INK,
      });
    });
    const vx = ry + h - padY - 8;
    r.lines.forEach((l, li) => {
      if (l.right) {
        page.drawText(l.text, {
          x: RIGHT_EDGE - 6 - l.font.widthOfTextAtSize(l.text, l.size),
          y: vx, size: l.size, font: l.font, color: l.color ?? INK,
        });
      } else {
        page.drawText(l.text, {
          x: VALUE_X + 6, y: vx - li * (bodySize + 3.2), size: l.size, font: l.font, color: l.color ?? INK,
        });
      }
    });
  });
  page.drawLine({ start: { x: VALUE_X, y: tableTop - bandH }, end: { x: VALUE_X, y: tableBottom }, thickness: 0.7, color: rgb(0.75, 0.75, 0.78) });

  /* ================= client detail strip — DP left, bank right — after the table ================= */
  drawStrip(tableBottom - 10);
  const stripBottom = tableBottom - 10 - stripH;

  /* ================= signature blocks ================= */
  let sy = stripBottom - 16;
  page.drawText("For", { x: LABEL_X, y: sy, size: 9.5, font, color: INK });
  page.drawText(COMPANY.name, { x: LABEL_X + 20, y: sy, size: 9.5, font: bold, color: INK });
  page.drawText(",", { x: LABEL_X + 20 + bold.widthOfTextAtSize(COMPANY.name, 9.5), y: sy, size: 9.5, font, color: INK });
  const clientTxt = d.clientName.toUpperCase().slice(0, 46);
  page.drawText(clientTxt, {
    x: RIGHT_EDGE - bold.widthOfTextAtSize(clientTxt, 9.5), y: sy, size: 9.5, font: bold, color: INK,
  });
  sy -= 20;
  const coPan = `PAN: ${COMPANY.pan}`;
  page.drawText(coPan, { x: LABEL_X, y: sy, size: 9, font: bold, color: INK });
  const clPan = `PAN: ${d.pan}`;
  page.drawText(clPan, {
    x: RIGHT_EDGE - bold.widthOfTextAtSize(clPan, 9), y: sy, size: 9, font: bold, color: INK,
  });

  /* ================= acknowledgment — always complete ================= */
  sy -= 12;
  for (const para of ACK_PARAS) {
    for (const line of wrap(para, font, ackSize, RIGHT_EDGE - M)) {
      page.drawText(line, { x: M, y: sy, size: ackSize, font, color: GREY });
      sy -= lead;
    }
    sy -= gap;
  }

  /* CG notice is a fixed footer element — structurally impossible to overlap the ack */

  /* ================= footer (fixed) ================= */
  page.drawLine({ start: { x: M, y: 112 }, end: { x: RIGHT_EDGE, y: 112 }, thickness: 1.4, color: GOLD });
  const center = (text: string, yy: number, f: PDFFont, s: number, c = INK) =>
    page.drawText(text, { x: (PAGE_W - f.widthOfTextAtSize(text, s)) / 2, y: yy, size: s, font: f, color: c });
  const cgText = "(THIS IS A COMPUTER-GENERATED DEAL CONFIRMATION AND DOES NOT REQUIRE SIGNATURE)";
  center(cgText, 101, bold, 8.6, INK);

  center("Regd. Add:", 86, bold, 8.4);


  const footAddrLines = wrap(COMPANY.regdAdd, font, 8, RIGHT_EDGE - M - 60);
  footAddrLines.forEach((line, i) => center(line, 76 - i * 9.2, font, 8, GREY));
  const afterAddr = 76 - footAddrLines.length * 9.2 + 2;   // first free line under the address block
  center(`CIN: ${COMPANY.cin}`, afterAddr, font, 8, GREY);
  center(`Email: ${COMPANY.email.toLowerCase()}  ·  Call: ${COMPANY.phone}`, afterAddr - 11, font, 8, GREY);

  return pdf.save();
}
