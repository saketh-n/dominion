/**
 * Robust: boot wait → walk BFS path to temple door → enter → screenshot interior.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { join } from "path";

const CLIENT = process.env.CLIENT_URL || "http://localhost:5175";
const OUT = process.env.SCRATCH || ".";
const PATH = JSON.parse(readFileSync(join(OUT, "temple-path.json"), "utf8"));

const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
page.on("pageerror", (e) => errors.push(String(e)));

async function waitReady(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await page.evaluate(
        () =>
          typeof window.__dominionStep === "function" &&
          window.__dominionPos &&
          window.__dominionPos.place === "world"
      );
      if (ok) return true;
    } catch {
      /* context destroyed */
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function pos() {
  try {
    return await page.evaluate(() => window.__dominionPos);
  } catch {
    return null;
  }
}

async function step(d) {
  try {
    return await page.evaluate((dir) => window.__dominionStep?.(dir) ?? false, d);
  } catch {
    return false;
  }
}

console.log("goto", CLIENT);
await page.goto(CLIENT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
if (!(await waitReady())) {
  console.error("world not ready");
  process.exit(1);
}
await page.waitForTimeout(800);
// dismiss any accidental menu
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(200);

let p = await pos();
console.log("start", p);

// Follow path; if stuck, re-BFS is out of band — just nudge
for (let i = 0; i < PATH.length; i++) {
  p = await pos();
  if (!p) {
    console.warn("lost pos at", i);
    if (!(await waitReady(5000))) break;
    continue;
  }
  if (p.place === "interior") {
    console.log("already interior mid-path");
    break;
  }
  // if already at/near door, stop path
  if (p.x === 511 && p.y <= 490) {
    console.log("near door early", p);
    break;
  }
  const d = PATH[i];
  let moved = await step(d);
  await page.waitForTimeout(moved ? 220 : 80);
  if (!moved) {
    await page.waitForTimeout(120);
    moved = await step(d);
    await page.waitForTimeout(moved ? 220 : 40);
  }
}

p = await pos();
console.log("after path", p);

// Walk onto door if needed
for (let n = 0; n < 12; n++) {
  p = await pos();
  if (!p || p.place === "interior") break;
  if (p.x === 511 && p.y === 489) break;
  let d;
  if (p.x < 511) d = 3;
  else if (p.x > 511) d = 2;
  else if (p.y > 489) d = 1;
  else d = 0;
  await step(d);
  await page.waitForTimeout(230);
}

p = await pos();
console.log("at door", p);

if (p?.place !== "interior") {
  // E confirm from south or on door
  await page.evaluate(() => window.__dominionEnter?.());
  await page.waitForTimeout(500);
  // also step north onto door
  await step(1);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__dominionEnter?.());
  try {
    await page.waitForFunction(() => window.__dominionPos?.place === "interior", null, {
      timeout: 5000,
    });
  } catch {
    await page.keyboard.press("e");
    await page.waitForTimeout(800);
  }
}

await page.waitForTimeout(600);
p = await pos();
console.log("interior pos", p);
const interiorPath = join(OUT, "interior.png");
const livePath = join(OUT, "live-interior.png");
await page.screenshot({ path: interiorPath, type: "png" });
copyFileSync(interiorPath, livePath);

// Start menu while inside
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
const menuText = await page.evaluate(() => document.getElementById("game-menus")?.innerText ?? "");
await page.screenshot({ path: join(OUT, "interior-menu.png"), type: "png" });

const result = {
  errors,
  interiorPos: p,
  menuText: menuText.slice(0, 300),
  entered: p?.place === "interior",
  nameOk: /temple|Temple|Grand/i.test(p?.interiorName ?? ""),
  menuOk: /Party|Bag|Settings/.test(menuText),
};
writeFileSync(join(OUT, "interior-capture.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(result.entered ? 0 : 2);
