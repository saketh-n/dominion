/**
 * Step 5 — props use ≥3 distinct ramp values; outline + contact shadow present.
 * Run: pnpm exec tsx packages/shared/src/props-shading.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { distinctRgbCount } from "./graphics-analysis.js";
import { Tile, TILESET_COLS } from "./tiles.js";
import { TILE_SIZE } from "./constants.js";
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

const OBJECTS = [
  Tile.PILLAR,
  Tile.COLUMN_BASE,
  Tile.STATUE_BASE,
  Tile.STATUE_TOP,
  Tile.AMPHORA,
  Tile.TABLE,
  Tile.BOULDER,
  Tile.BUSH,
  Tile.TREE_TRUNK,
  Tile.BANNER,
  Tile.BED,
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const genSrc = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
const preview = join(ROOT, "preview/tileset-preview.png");

ok("contact sheet exists", existsSync(preview));
ok("gen uses dropShadow", /\bdropShadow\s*\(/.test(genSrc));
ok("gen uses contactShadow", /\bcontactShadow\s*\(/.test(genSrc));
ok("gen uses applySelectiveOutline", /\bapplySelectiveOutline\s*\(/.test(genSrc));
// outline uses ramp darkest / ink, not pure black #000
ok(
  "outline not pure black hex in STYLE",
  !/outline:\s*"#000000"/.test(readFileSync(join(ROOT, "tools/pixel.ts"), "utf8"))
);

const img = await loadImage(join(ROOT, "apps/client/public/assets/tileset.png"));
const cols = TILESET_COLS;
const T = TILE_SIZE;

function sample(id: number) {
  const sx = (id % cols) * T;
  const sy = Math.floor(id / cols) * T;
  const c = createCanvas(T, T);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, T, T, 0, 0, T, T);
  return ctx.getImageData(0, 0, T, T).data;
}

for (const id of OBJECTS) {
  const n = distinctRgbCount(sample(id));
  ok(`object ${id} uses ≥ 3 colors`, n >= 3, `got ${n}`);
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
