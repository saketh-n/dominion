/**
 * Step 2 — global palette ≤48 unique colors in shipped tileset.png.
 * Run: pnpm exec tsx packages/shared/src/palette.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { countUniqueColors } from "./graphics-analysis.js";

let passed = 0;
let failed = 0;
const lines: string[] = [];

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    lines.push(`PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    lines.push(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
const genPath = join(ROOT, "tools/gen-tileset.ts");
const palettePath = join(ROOT, "tools/palette.ts");
const pixelPath = join(ROOT, "tools/pixel.ts");

ok("tileset.png exists", existsSync(tilesetPath));
ok("palette.ts exists", existsSync(palettePath));

const genSrc = readFileSync(genPath, "utf8");
const pixelSrc = readFileSync(pixelPath, "utf8");
const paletteSrc = readFileSync(palettePath, "utf8");

// Strip comments then require no paint-time mix/shade/desaturate calls
const genCode = genSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");
ok(
  "gen-tileset has no mix( calls",
  !/\bmix\s*\(/.test(genCode),
  "painters must only select ramp entries"
);
ok(
  "gen-tileset has no shade( calls",
  !/\bshade\s*\(/.test(genCode)
);
ok(
  "gen-tileset has no desaturate( calls",
  !/\bdesaturate\s*\(/.test(genCode)
);
// applyDirectionalLight / applyDesaturate mutate pixels — ban from gen-tileset paint path
ok(
  "gen-tileset does not call applyDirectionalLight",
  !/\bapplyDirectionalLight\s*\(/.test(genSrc)
);
ok(
  "gen-tileset does not call applyDesaturate",
  !/\bapplyDesaturate\s*\(/.test(genSrc)
);
// paintBlobTransition must not synthesize RGB (edge darken removed)
ok(
  "paintBlobTransition has no RGB multiply darken",
  !/d\[i\]\s*=\s*Math\.round\(d\[i\]\s*\*\s*0\./.test(pixelSrc)
);

ok("palette declares ≤48 colors check", /GLOBAL_PALETTE_LIST/.test(paletteSrc));

const img = await loadImage(tilesetPath);
const c = createCanvas(img.width, img.height);
const ctx = c.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.drawImage(img, 0, 0);
const data = ctx.getImageData(0, 0, img.width, img.height).data;
const n = countUniqueColors(data);
ok("tileset unique colors ≤ 48", n <= 48, `got ${n}`);
ok("tileset has some colors", n >= 8, `got ${n}`);

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed (unique=${n})`);
if (failed > 0) process.exit(1);
