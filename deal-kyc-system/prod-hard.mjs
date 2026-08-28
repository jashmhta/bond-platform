import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto("https://deal-kyc-system.vercel.app/kyc/new", { waitUntil: "networkidle" });
await page.locator('input[type="file"]').first().setInputFiles("/tmp/opencode/pan-real.jpg");
const panInput = page.locator("input.uppercase").first();
let pan = "";
for (let i = 0; i < 75; i++) {
  pan = await panInput.inputValue().catch(() => "");
  if (pan) break;
  await page.waitForTimeout(1000);
}
console.log("PROD PAN field:", pan || "— (failed)");
await page.screenshot({ path: "/tmp/opencode/kyc-prod2.png" });
await browser.close();
process.exit(pan === "BCPPS4682C" ? 0 : 1);
