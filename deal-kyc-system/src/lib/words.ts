const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}

function upTo999(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let s = "";
  if (h) s += `${ONES[h]} Hundred`;
  if (rest) s += (s ? " " : "") + twoDigits(rest);
  return s;
}

/** Integer → Indian-system words: crore / lakh / thousand / hundred. */
export function indianWords(num: number): string {
  let n = Math.floor(Math.abs(num));
  if (n === 0) return "Zero";
  if (n >= 1e9) return String(n); // beyond typical deal sizes — fall back to digits
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;

  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} ${thousand === 1 ? "Thousand" : "Thousand"}`);
  if (n) parts.push(upTo999(n));
  return parts.join(" ");
}

/**
 * 404148.05 → "Four Lakhs Four Thousand One Hundred Forty Eight and Paise Five Only"
 * Matches the BinaryBonds letterhead house style.
 */
export function amountInWords(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const rounded = Math.round(Math.abs(safe) * 100) / 100;
  const int = Math.floor(rounded);
  const paise = Math.round((rounded - int) * 100);
  let s = indianWords(int);
  if (paise > 0) s += ` and Paise ${twoDigits(paise)}`;
  return `${s} Only`;
}
