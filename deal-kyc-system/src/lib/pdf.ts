import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { LOGO_PNG_BASE64 } from "./logo-data";
import { amountInWords } from "./words";

export const COMPANY = {
  name: "BINARYBONDS PRIVATE LIMITED",
  nameParts: ["BINARYBONDS", "PRIVATE LIMITED"],
  tagline: "FIXED INCOME / PRIVATE MARKETS",
  pan: "AALCB3429N",
  cin: "U67100MH2023PTC396840",
  email: "COMPLIANCE@BINARYBONDS.IN",
  altEmail: "shray@binarycapital.in",
  phone: "7738056127",
  regdAdd: "A-702, Itus Dinanath Chs Ltd Sahyog Nagar, Ambivali Opp. Kokilaben Hospital, Andheri West, Mumbai - 400053",
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
  dealDateLong: string;       // "27 AUGUST 2026"
  side: "SELL" | "BUY";
  clientName: string;
  pan: string;
  clientAddress?: string;
  security: string;
  isin: string;
  paymentDates: string;
  maturity: string;
  price: string;
  cleanPrice: string;
  yieldPct: string;
  totalFaceValue: string;
  units: string;
  principal: string;
  accrued: string;
  interestDays: string;
  stampDuty: string;
  dealAmount: string;
  total: string;
  dpName: string;
  dpId: string;
  clientId: string;
  bankName: string;
  bankIfsc: string;
  bankAccountNo: string;
};

/* ---- design tokens ---- */
const C_BG     = rgb(0.984, 0.980, 0.969); // #FBFAF7 warm cream
const C_NAVY   = rgb(0.075, 0.184, 0.263); // #132F43 dark navy
const C_GOLD   = rgb(0.722, 0.537, 0.243); // #B8893E brand gold
const C_GOLD_T = rgb(0.961, 0.918, 0.839); // #F5EAD6 gold tint
const C_GREY   = rgb(0.361, 0.408, 0.447); // #5C6872 secondary text
const C_WHITE  = rgb(1, 1, 1);
const C_RULE   = rgb(0.851, 0.871, 0.875); // #D9DEDF light grey rule
const C_GOLD_L = rgb(0.871, 0.784, 0.639); // light gold for table borders

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const RIGHT = PAGE_W - M;
const CW = RIGHT - M; // content width

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function buildDealPdf(d: DealPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const R = (n: number) => Math.round(n * 100) / 100;

  /* background */
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C_BG });

  /* ================= HEADER ================= */
  let logoImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  let logoW = 0, logoH = 0;
  try {
    logoImg = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
    logoW = 34;
    logoH = logoImg.height * (logoW / logoImg.width);
  } catch { logoImg = null; }

  /* company name baseline */
  const nameSize = 16;
  const nameY = PAGE_H - 58;
  const tagY = nameY - 14;
  const nameX = M + (logoImg ? logoW + 14 : 0);

  /* logo: vertically centered on the full name + tagline block */
  const blockTop = nameY + nameSize * 0.75;   // visual top of name text
  const blockBot = tagY - 2;                  // visual bottom of tagline
  const logoY = (blockTop + blockBot) / 2 - logoH / 2;
  if (logoImg) page.drawImage(logoImg, { x: M, y: logoY, width: logoW, height: logoH });

  /* company name */
  const n1W = bold.widthOfTextAtSize(COMPANY.nameParts[0], nameSize);
  page.drawText(COMPANY.nameParts[0], { x: nameX, y: nameY, size: nameSize, font: bold, color: C_NAVY });
  page.drawText(COMPANY.nameParts[1], { x: nameX + n1W + 5, y: nameY, size: nameSize, font: bold, color: C_GOLD });

  /* tagline below, left-aligned with name */
  page.drawText(COMPANY.tagline, { x: nameX, y: tagY, size: 7, font: bold, color: C_GOLD });

  /* right: DEAL CONFIRMATION + date — top-right corner */
  const dcTxt = "DEAL CONFIRMATION";
  page.drawText(dcTxt, { x: RIGHT - bold.widthOfTextAtSize(dcTxt, 8), y: nameY + 5, size: 8, font: bold, color: C_GOLD });
  const dtLong = d.dealDateLong.toUpperCase();
  page.drawText(dtLong, { x: RIGHT - bold.widthOfTextAtSize(dtLong, 8), y: nameY - 7, size: 8, font: bold, color: C_NAVY });

  /* gold rule — below tagline with comfortable spacing */
  const ruleY = tagY - 14;
  page.drawLine({ start: { x: M, y: ruleY }, end: { x: RIGHT, y: ruleY }, thickness: 1.2, color: C_GOLD });

  /* ================= REF + DATE ================= */
  let y = ruleY - 22;
  page.drawText("Deal Ref No.:", { x: M, y, size: 8.5, font, color: C_GREY });
  page.drawText(d.refNo, { x: M + 60, y, size: 9.5, font: bold, color: C_NAVY });
  const dtLbl = "Date";
  const dtVal = d.dealDateDash;
  page.drawText(dtLbl, { x: RIGHT - 110, y, size: 8.5, font, color: C_GREY });
  page.drawText(dtVal, { x: RIGHT - bold.widthOfTextAtSize(dtVal, 9.5), y, size: 9.5, font: bold, color: C_NAVY });

  /* ================= ISSUED TO + STATUS BOX ================= */
  y -= 22;
  const issuedLbl = "ISSUED TO";
  page.drawText(issuedLbl, { x: M, y, size: 7, font: bold, color: C_GOLD });

  /* status box (right) */
  const boxW = 260, boxH = 62;
  const boxX = RIGHT - boxW;
  const boxY = y - 8;
  page.drawRectangle({ x: boxX, y: boxY - boxH + 14, width: boxW, height: boxH, color: C_GOLD_T, borderColor: C_GOLD_T, borderWidth: 0, });
  const statusLbl = "TRANSACTION STATUS";
  page.drawText(statusLbl, { x: boxX + 12, y: boxY - 2, size: 6.5, font: bold, color: C_GOLD });
  const sideTxt = `OUTRIGHT ${d.side}`;
  page.drawText(sideTxt, { x: boxX + 12, y: boxY - 16, size: 13, font: bold, color: C_NAVY });
  const confTxt = `We confirm the ${d.side === "SELL" ? "sell" : "buy"} of the following security, the details of which are given below:`;
  const confLines = wrap(confTxt, font, 7.5, boxW - 24);
  confLines.forEach((line, i) => {
    page.drawText(line, { x: boxX + 12, y: boxY - 28 - i * 9, size: 7.5, font, color: C_GREY });
  });

  /* client name + PAN on same line */
  y -= 14;
  const nameTxt = `${/^MR\.|^MRS\.|^MS\.|^M\/S\./i.test(d.clientName) ? "" : "Mr. "}${d.clientName},`;
  page.drawText(nameTxt.slice(0, 55), { x: M, y, size: 9.5, font: bold, color: C_NAVY });
  const panLblX = M + Math.min(bold.widthOfTextAtSize(nameTxt.slice(0, 55), 9.5) + 12, 280);
  page.drawText("PAN", { x: panLblX, y, size: 7, font: bold, color: C_GOLD });
  page.drawText(d.pan, { x: panLblX + 22, y, size: 9, font: bold, color: C_NAVY });

  /* address */
  const addrLines = wrap(d.clientAddress || "", font, 8, CW - 300).slice(0, 4);
  for (const al of addrLines) {
    y -= 11;
    page.drawText(al, { x: M, y, size: 8, font, color: C_GREY });
  }

  /* ================= SECTION 01: TRANSACTION DETAILS ================= */
  y -= 22;
  const s1Num = "01 / TRANSACTION DETAILS";
  const s1Title = "Security and consideration";
  page.drawText(s1Num, { x: M, y, size: 7, font: bold, color: C_GOLD });
  page.drawText(s1Title, { x: M + bold.widthOfTextAtSize(s1Num, 7) + 12, y, size: 11, font: bold, color: C_NAVY });

  /* transaction table */
  y -= 10;
  const tableTop = y;
  const rowH = 17;
  const labelX = M + 10;
  const valueX = M + 130;
  const rows: Array<{ label: string; value: string; right?: string; bold?: boolean; sub?: string }> = [
    { label: "OUR", value: `OUTRIGHT ${d.side}`, bold: true },
    { label: "SECURITY", value: d.security, bold: true },
    { label: "ISIN", value: d.isin || "—" },
    { label: "INTEREST PAYMENT DATES", value: d.paymentDates || "MONTHLY", bold: true },
    { label: "MATURITY DATE", value: d.maturity || "—" },
    { label: "PRICE", value: d.cleanPrice ? `Rs. ${d.cleanPrice}` : `Rs. ${d.price}`, right: `YIELD: ${d.yieldPct || "—"} (YTM)` },
    { label: "TOTAL FACE VALUE", value: `Rs. ${d.totalFaceValue}`, right: `NO OF UNITS: ${d.units}` },
    { label: "PRINCIPAL AMOUNT", value: `Rs. ${d.principal}` },
    { label: "ACCRUED INTEREST", value: `Rs. ${d.accrued}`, right: `INTEREST DAYS : ${d.interestDays} (DAYS)` },
    { label: "TOTAL", value: `Rs. ${d.dealAmount || d.total}`, bold: true },
    { label: "STAMP DUTY", value: `Rs. ${d.stampDuty || "0.00"}`, sub: "(to be paid by buyer)" },
  ];
  const tableRowH = rows.length * rowH + 8;

  /* table border */
  page.drawRectangle({ x: M, y: tableTop - tableRowH, width: CW, height: tableRowH, borderColor: C_GOLD_L, borderWidth: 0.7, color: C_WHITE });

  let ty = tableTop;
  for (const row of rows) {
    ty -= rowH;
    /* horizontal rule between rows */
    if (row !== rows[rows.length - 1]) {
      page.drawLine({ start: { x: M + 1, y: ty }, end: { x: RIGHT - 1, y: ty }, thickness: 0.4, color: C_GOLD_L });
    }
    /* label */
    page.drawText(row.label, { x: labelX, y: ty + 5, size: 6.8, font: bold, color: C_GREY });
    if ("sub" in row && row.sub) {
      page.drawText(row.sub, { x: labelX, y: ty + 5 - 8, size: 6.2, font, color: C_GREY });
    }
    /* value */
    const valFont = row.bold ? bold : font;
    page.drawText(row.value, { x: valueX, y: ty + 5, size: 8, font: valFont, color: C_NAVY });
    /* right-aligned */
    if (row.right) {
      page.drawText(row.right, { x: RIGHT - 10 - bold.widthOfTextAtSize(row.right, 7.5), y: ty + 5, size: 7.5, font: bold, color: C_NAVY });
    }
  }

  /* ================= TOTAL CONSIDERATION BAR (dark navy) ================= */
  ty -= 6;
  const tcBarH = 32;
  page.drawRectangle({ x: M, y: ty - tcBarH, width: CW, height: tcBarH, color: C_NAVY });
  const tcLbl = "TOTAL CONSIDERATION";
  page.drawText(tcLbl, { x: labelX, y: ty - 13, size: 6.5, font: bold, color: rgb(0.65, 0.75, 0.82) });
  const tcVal = `Rs. ${d.total}`;
  page.drawText(tcVal, { x: valueX, y: ty - 14, size: 13, font: bold, color: C_WHITE });
  const tcNum = Number(d.total.replace(/[^0-9.]/g, "")) || 0;
  const tcWords = wrap(`(${amountInWords(tcNum)})`, bold, 6.5, CW - valueX - 120)[0] || "";
  page.drawText(tcWords, { x: valueX, y: ty - 25, size: 6.5, font: bold, color: rgb(0.65, 0.75, 0.82) });
  /* yield on right */
  if (d.yieldPct) {
    const yldTxt = `YIELD ${d.yieldPct} (YTM)`;
    page.drawText(yldTxt, { x: RIGHT - 10 - bold.widthOfTextAtSize(yldTxt, 7.5), y: ty - 13, size: 7.5, font: bold, color: C_GOLD });
  }

  y = ty - tcBarH - 20;

  /* ================= SECTION 02 + 03: TWO-COLUMN ================= */
  const colW = (CW - 16) / 2;
  const col2X = M + colW + 16;

  /* section headings */
  page.drawText("02 / SETTLEMENT", { x: M, y, size: 7, font: bold, color: C_GOLD });
  page.drawText("Execution and settlement", { x: M + bold.widthOfTextAtSize("02 / SETTLEMENT", 7) + 10, y, size: 10, font: bold, color: C_NAVY });
  page.drawText("03 / CLIENT DETAILS", { x: col2X, y, size: 7, font: bold, color: C_GOLD });
  page.drawText("Settlement account", { x: col2X + bold.widthOfTextAtSize("03 / CLIENT DETAILS", 7) + 10, y, size: 10, font: bold, color: C_NAVY });

  y -= 12;
  const colTop = y;

  /* left: settlement rows */
  const settleRows: Array<[string, string, boolean?]> = [
    ["DEAL DATE", d.dealDateSlash],
    ["VALUE DATE", d.dealDateSlash],
    ["MARKET TYPE", "BSE T+0", true],
    ["SETTLEMENT MODE", SETTLEMENT.mode, true],
    ["SETTLEMENT DETAILS", `BENEFICIARY:- ${SETTLEMENT.beneficiary}`],
    ["", `BANK :- ${SETTLEMENT.bank}`],
    ["", `A/C NO :- ${SETTLEMENT.accountNo}  IFSC :- ${SETTLEMENT.ifsc}`],
    ["", `BRANCH :- ${SETTLEMENT.branch}`],
    ["PAYMENT IN FAVOR OF", SETTLEMENT.paymentInFavorOf, true],
  ];
  let sy = colTop;
  for (const [lbl, val, isBold] of settleRows) {
    if (lbl) page.drawText(lbl, { x: M, y: sy, size: 6.8, font: bold, color: C_GREY });
    page.drawText(val, { x: M + 85, y: sy, size: 7, font: isBold ? bold : font, color: C_NAVY });
    sy -= 13;
  }

  /* right: client detail rows */
  const clientRows: Array<[string, string]> = [
    ["DP NAME", d.dpName || "—"],
    ["DP ID", d.dpId || "—"],
    ["CLIENT ID", d.clientId || "—"],
    ["BANK NAME", d.bankName || "—"],
    ["IFSC CODE", d.bankIfsc || "—"],
    ["BANK A/C NO", d.bankAccountNo || "—"],
  ];
  let cy = colTop;
  for (const [lbl, val] of clientRows) {
    page.drawText(lbl, { x: col2X, y: cy, size: 6.8, font: bold, color: C_GREY });
    page.drawText(val, { x: col2X + 70, y: cy, size: 7.5, font: bold, color: C_NAVY });
    cy -= 13;
  }

  y = Math.min(sy, cy) - 8;

  /* ================= SIGNATURE BAR (gold tinted, single line) ================= */
  const sigBarH = 26;
  page.drawRectangle({ x: M, y: y - sigBarH, width: CW, height: sigBarH, color: C_GOLD_T });
  const sigMid = y - sigBarH / 2 - 3;

  /* SELLER: left half */
  let sx = M + 12;
  page.drawText("SELLER", { x: sx, y: sigMid, size: 6, font: bold, color: C_GOLD });
  sx += bold.widthOfTextAtSize("SELLER", 6) + 6;
  page.drawText("For", { x: sx, y: sigMid, size: 7.5, font, color: C_NAVY });
  sx += font.widthOfTextAtSize("For", 7.5) + 3;
  const coName = "BINARYBONDS PRIVATE LIMITED,";
  page.drawText(coName, { x: sx, y: sigMid, size: 7.5, font: bold, color: C_NAVY });
  sx += bold.widthOfTextAtSize(coName, 7.5) + 6;
  page.drawText("PAN", { x: sx, y: sigMid, size: 6, font: bold, color: C_GOLD });
  page.drawText(COMPANY.pan, { x: sx + bold.widthOfTextAtSize("PAN", 6) + 3, y: sigMid, size: 7, font: bold, color: C_NAVY });

  /* BUYER: right half, starts well past seller */
  const bx0 = M + CW * 0.58;
  let bx = bx0;
  page.drawText("BUYER", { x: bx, y: sigMid, size: 6, font: bold, color: C_GOLD });
  bx += bold.widthOfTextAtSize("BUYER", 6) + 6;
  const buyerName = d.clientName.toUpperCase().slice(0, 32);
  page.drawText(buyerName, { x: bx, y: sigMid, size: 7.5, font: bold, color: C_NAVY });
  bx += bold.widthOfTextAtSize(buyerName, 7.5) + 6;
  page.drawText("PAN", { x: bx, y: sigMid, size: 6, font: bold, color: C_GOLD });
  bx += bold.widthOfTextAtSize("PAN", 6) + 3;
  page.drawText(d.pan, { x: bx, y: sigMid, size: 7, font: bold, color: C_NAVY });

  y = y - sigBarH - 14;

  /* ================= SECTION 04: ACKNOWLEDGEMENT ================= */
  page.drawText("04 / ACKNOWLEDGEMENT", { x: M, y, size: 7, font: bold, color: C_GOLD });
  y -= 14;

  const ACK_PARAS = [
    "I/We, the undersigned, do hereby expressly acknowledge, agree, and confirm that the foregoing transaction has been executed by me/us voluntarily, of my/our own free will and without any inducement, coercion, solicitation, or undue influence from your end or any of your representatives.",
    "I/We further acknowledge that prior to making any investment and/or subscribing to the aforementioned securities, I/we have carefully read, reviewed, and fully understood all relevant transaction-related documents, including but not limited to the offer document, instrument description, term sheet, security features, statutory filings, issuer-related disclosures, credit rating letters, rating rationales, and any other materials as may be applicable.",
    "I/We fully comprehend and accept the various risks associated with investing in or subscribing to the said securities, including Credit Risk, Market Risk, Default Risk, Counterparty Risk, Liquidity Risk, Instrument-Specific Risk, Interest Rate Risk, Reinvestment Risk, Regulatory and Legal Risk, and any other risks inherent in the trading or holding of bonds and/or other fixed income securities.",
    "I/We further understand and agree that BinaryBonds shall bear no responsibility or liability whatsoever for any default, whether partial or complete, in the payment of interest and/or principal amount by the issuer of the said securities.",
    "For any further clarification or additional information required in relation to the above, I/we shall contact the relevant team at:",
  ];
  const ackLevels = [
    { ack: 6.9, lead: 8.3, gap: 1.4 },
    { ack: 6.6, lead: 7.9, gap: 1.4 },
    { ack: 6.4, lead: 7.7, gap: 1.4 },
    { ack: 6.0, lead: 7.2, gap: 1.2 },
  ];
  /* pick the largest size that fits above the CG notice */
  let chosenAck = ackLevels[ackLevels.length - 1];
  for (const L of ackLevels) {
    let totalH = 0;
    for (const para of ACK_PARAS) {
      totalH += wrap(para, font, L.ack, CW).length * L.lead + L.gap;
    }
    if (y - totalH >= 110) { chosenAck = L; break; }
  }
  const { ack: ackSize, lead: ackLead, gap: ackGap } = chosenAck;
  for (const para of ACK_PARAS) {
    for (const line of wrap(para, font, ackSize, CW)) {
      page.drawText(line, { x: M, y, size: ackSize, font, color: C_GREY });
      y -= ackLead;
    }
    y -= ackGap;
  }
  /* contact email in bold */
  page.drawText(`${COMPANY.email.toLowerCase()} / ${COMPANY.altEmail}`, { x: M, y, size: ackSize, font: bold, color: C_NAVY });
  y -= 8;

  /* ================= CG NOTICE BAR (gold tinted) ================= */
  const cgBarH = 18;
  page.drawRectangle({ x: M, y: y - cgBarH, width: CW, height: cgBarH, color: C_GOLD_T });
  const cgTxt = "(THIS IS A COMPUTER-GENERATED DEAL CONFIRMATION AND DOES NOT REQUIRE SIGNATURE)";
  page.drawText(cgTxt, {
    x: (PAGE_W - bold.widthOfTextAtSize(cgTxt, 7.5)) / 2,
    y: y - cgBarH / 2 - 3,
    size: 7.5, font: bold, color: C_NAVY,
  });

  /* ================= FOOTER ================= */
  const footRuleY = y - cgBarH - 10;
  page.drawLine({ start: { x: M, y: footRuleY }, end: { x: RIGHT, y: footRuleY }, thickness: 1, color: C_GOLD });

  /* left: Regd Add */
  page.drawText("Regd. Add:", { x: M, y: footRuleY - 14, size: 7.5, font: bold, color: C_NAVY });
  const footAddr = wrap(COMPANY.regdAdd, font, 7, 280)[0] || "";
  page.drawText(footAddr, { x: M + 52, y: footRuleY - 14, size: 7, font, color: C_GREY });

  /* right: PAGE 01 / 01 */
  const pgTxt = "PAGE 01 / 01";
  page.drawText(pgTxt, { x: RIGHT - bold.widthOfTextAtSize(pgTxt, 7), y: footRuleY - 14, size: 7, font: bold, color: C_GOLD });

  /* center: CIN */
  const cinTxt = `CIN: ${COMPANY.cin}`;
  page.drawText(cinTxt, { x: (PAGE_W - font.widthOfTextAtSize(cinTxt, 7.5)) / 2, y: footRuleY - 26, size: 7.5, font, color: C_GREY });

  /* email + call centered */
  const emailTxt = `Email: ${COMPANY.email.toLowerCase()}  ·  Call: ${COMPANY.phone}`;
  page.drawText(emailTxt, { x: (PAGE_W - font.widthOfTextAtSize(emailTxt, 7.5)) / 2, y: footRuleY - 38, size: 7.5, font, color: C_GREY });

  return pdf.save();
}
