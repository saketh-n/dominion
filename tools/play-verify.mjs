/**
 * Playwright verification of the live client at http://localhost:5175
 * Asserts: no page errors, canvas 960×640, non-blank paint (via screenshot),
 * arrow-key movement changes the rendered view.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// optional sharp-less PNG decode via pure buffer scan of playwright screenshots
// Playwright PNGs are standard; use a tiny decoder through canvas if available,
// else compare raw PNG bytes + pixel stats via pngjs if present.

const CLIENT = process.env.CLIENT_URL || "http://localhost:5175";
const OUT = process.env.SCRATCH || "/tmp/dominion-play";
mkdirSync(OUT, { recursive: true });

function pngStats(path) {
  // Minimal PNG IHDR + filter-scan using built-in: spawn python for reliability
  return null;
}

async function analyzePng(path) {
  // Use dynamic import of 'playwright' buffer — decode with ImageData via page is heavy.
  // Prefer child_process python3 with PIL which we already used successfully.
  const { execFileSync } = await import("node:child_process");
  const script = `
from PIL import Image
import json, sys
im = Image.open(sys.argv[1]).convert("RGB")
w,h = im.size
px = im.load()
bg = (20, 18, 26)
non = tot = 0
acc = 0
samples = []
for y in range(0, h, 4):
    for x in range(0, w, 4):
        r,g,b = px[x,y]
        tot += 1
        if abs(r-bg[0])>12 or abs(g-bg[1])>12 or abs(b-bg[2])>12:
            non += 1
        acc = (acc * 33 + r + g*3 + b*7) & 0xFFFFFFFF
for (x,y) in [(0,0),(w//2,h//2),(w-1,h-1),(100,100)]:
    samples.append(list(px[x,y]))
print(json.dumps({"w":w,"h":h,"non":non,"tot":tot,"fill": non/tot if tot else 0, "hash": acc, "samples": samples}))
`;
  const out = execFileSync("python3", ["-c", script, path], { encoding: "utf8" });
  return JSON.parse(out);
}

const errors = [];
const logs = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });

page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  logs.push(`[${msg.type()}] ${msg.text()}`);
});

console.log("loading", CLIENT);
await page.goto(CLIENT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
// Boot connect + preload world assets + first paint
await page.waitForTimeout(5000);

// Ensure chat/party mounted (world scene)
await page.waitForFunction(
  () => document.getElementById("chat-ui") && document.getElementById("party-hud"),
  null,
  { timeout: 15000 }
).catch(() => {});

const canvasBox = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  return c
    ? { width: c.width, height: c.height, cssW: c.clientWidth, cssH: c.clientHeight }
    : null;
});

const beforePath = join(OUT, "play-before.png");
await page.screenshot({ path: beforePath, type: "png" });
const before = await analyzePng(beforePath);
console.log("before", before);

// Hold arrows to walk
for (const key of ["ArrowRight", "ArrowDown", "ArrowRight", "ArrowUp"]) {
  await page.keyboard.down(key);
  await page.waitForTimeout(900);
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
}

const afterPath = join(OUT, "play.png");
await page.screenshot({ path: afterPath, type: "png" });
const after = await analyzePng(afterPath);
console.log("after", after);

const ui = await page.evaluate(() => ({
  chat: !!document.getElementById("chat-ui"),
  party: !!document.getElementById("party-hud"),
  statusText: document.body.innerText.slice(0, 200),
}));

const okSize = canvasBox && canvasBox.width === 960 && canvasBox.height === 640;
const okFill = before.fill > 0.5 && after.fill > 0.5;
const okMove = before.hash !== after.hash;
const okErrors = errors.length === 0;
const okUi = ui.chat && ui.party;

const result = {
  url: CLIENT,
  errors,
  canvasBox,
  before,
  after,
  ui,
  pass: {
    okSize,
    okFill,
    okMove,
    okErrors,
    okUi,
    all: !!(okSize && okFill && okMove && okErrors && okUi),
  },
  screenshots: { before: beforePath, after: afterPath },
  logTail: logs.slice(-30),
};

writeFileSync(join(OUT, "play-result.json"), JSON.stringify(result, null, 2));
console.log("pass", result.pass);
console.log("errors", errors);

await browser.close();
if (!result.pass.all) {
  console.error("PLAYWRIGHT VERIFICATION FAILED");
  process.exit(1);
}
console.log("PLAYWRIGHT VERIFICATION PASSED");
