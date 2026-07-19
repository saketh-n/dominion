/**
 * Screenshots the running game with Playwright.
 * Usage: tsx tools/screenshot.ts <url> <outfile> [waitMs] [keys...]
 * Keys are pressed-and-held sequences like "ArrowDown:1500" (hold 1.5s).
 */
import { chromium } from "playwright";

const [url = "http://localhost:5175", out = "preview/game.png", waitMs = "2500", ...keys] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));
await page.goto(url);
await page.waitForTimeout(Number(waitMs));

for (const spec of keys) {
  const [key, holdMs = "300"] = spec.split(":");
  await page.keyboard.down(key);
  await page.waitForTimeout(Number(holdMs));
  await page.keyboard.up(key);
  await page.waitForTimeout(150);
}

await page.screenshot({ path: out });
if (errors.length) {
  console.log("PAGE ERRORS:");
  for (const e of errors.slice(0, 10)) console.log("  " + e.slice(0, 300));
}
console.log(`screenshot -> ${out}`);
await browser.close();
