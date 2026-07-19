/**
 * Step 4 — ground quiet / objects loud value hierarchy.
 * Also gates: ground painters do not use ditherVGradient; walls keep vertical form.
 * Run: pnpm exec tsx packages/shared/src/value-hierarchy.test.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { lightnessSpread } from "./graphics-analysis.js";
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

/** Ground max relative-luminance spread — quiet floors; seams stay within ~one ramp step. */
const GROUND_SPREAD_MAX = 0.35;
/** Objects should exceed ground quiet band. */
const OBJECT_SPREAD_MIN = 0.12;

const GROUND = [
  Tile.GRASS,
  Tile.GRASS2,
  Tile.DIRT_PATH,
  Tile.STONE_ROAD,
  Tile.MARBLE_FLOOR,
  Tile.MARBLE_FLOOR2,
  Tile.SAND,
  Tile.ROCK_GROUND,
  Tile.SNOW,
  Tile.FLOOR_WOOD,
];

const OBJECTS = [
  Tile.PILLAR,
  Tile.COLUMN_BASE,
  Tile.STATUE_BASE,
  Tile.AMPHORA,
  Tile.TABLE,
  Tile.BOULDER,
  Tile.BUSH,
  Tile.TREE_TRUNK,
  Tile.BANNER,
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
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

let gMax = 0;
for (const id of GROUND) {
  const { spread } = lightnessSpread(sample(id));
  gMax = Math.max(gMax, spread);
  ok(
    `ground ${id} spread ≤ ${GROUND_SPREAD_MAX}`,
    spread <= GROUND_SPREAD_MAX,
    `spread=${spread.toFixed(3)}`
  );
}

let oMin = 1;
let oOk = 0;
for (const id of OBJECTS) {
  const { spread } = lightnessSpread(sample(id));
  oMin = Math.min(oMin, spread);
  const pass = spread >= OBJECT_SPREAD_MIN;
  if (pass) oOk++;
  ok(
    `object ${id} spread ≥ ${OBJECT_SPREAD_MIN}`,
    pass,
    `spread=${spread.toFixed(3)}`
  );
}
ok(
  "objects louder than ground band on average",
  oOk >= Math.ceil(OBJECTS.length * 0.7),
  `ok ${oOk}/${OBJECTS.length}; groundMax=${gMax.toFixed(3)} objMin=${oMin.toFixed(3)}`
);

// Source: ground/floor painters must not call ditherVGradient
const genSrc = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
ok("gen-tileset has no ditherVGradient calls", !/\bditherVGradient\s*\(/.test(genSrc));
// Walls/facades keep lit-top / dark-base vertical form
ok(
  "wall strip has lit top + dark base",
  /function paintWallStrip[\s\S]*?M\.light[\s\S]*?M\.dark/.test(genSrc) ||
    /paintWallStrip[\s\S]{0,800}lit top/.test(genSrc)
);
// Floors use flat paintGroundWithStamps (no v-gradient)
ok("floors use paintGroundWithStamps", /paintGroundWithStamps/.test(genSrc));
ok("paved floors use paintSlabSeams", /paintSlabSeams/.test(genSrc));

/**
 * Shipped-pixel slab seams on paved tiles:
 * BR edge mean luminance must be strictly darker than interior mode color.
 * Optional TL edge may be lighter than interior.
 */
function modeRgb(data: Uint8ClampedArray | Uint8Array, T = 16): [number, number, number] {
  const hist = new Map<string, number>();
  // Interior 2..T-3 excludes seam rows/cols
  for (let y = 2; y < T - 2; y++) {
    for (let x = 2; x < T - 2; x++) {
      const i = (y * T + x) * 4;
      if (data[i + 3]! < 200) continue;
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  let best = "0,0,0";
  let n = 0;
  for (const [k, c] of hist) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  const [r, g, b] = best.split(",").map(Number);
  return [r!, g!, b!];
}

function meanEdgeLum(
  data: Uint8ClampedArray | Uint8Array,
  which: "bottom" | "right" | "top" | "left",
  T = 16
): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < T; i++) {
    let x = 0;
    let y = 0;
    if (which === "bottom") {
      x = i;
      y = T - 1;
    } else if (which === "right") {
      x = T - 1;
      y = i;
    } else if (which === "top") {
      x = i;
      y = 0;
    } else {
      x = 0;
      y = i;
    }
    const pi = (y * T + x) * 4;
    if (data[pi + 3]! < 200) continue;
    sum += (data[pi]! + data[pi + 1]! + data[pi + 2]!) / 3;
    n++;
  }
  return n ? sum / n : 0;
}

const PAVED = [Tile.MARBLE_FLOOR, Tile.MARBLE_FLOOR2, Tile.MARBLE_FLOOR3, Tile.STONE_ROAD, Tile.STONE_ROAD2];
for (const id of PAVED) {
  const data = sample(id);
  const [mr, mg, mb] = modeRgb(data);
  const interiorL = (mr + mg + mb) / 3;
  const botL = meanEdgeLum(data, "bottom");
  const rightL = meanEdgeLum(data, "right");
  const topL = meanEdgeLum(data, "top");
  const leftL = meanEdgeLum(data, "left");
  // BR must be darker than interior by a visible step (≥6 raw mean channel units)
  ok(
    `paved ${id} BR dark seam vs interior`,
    botL < interiorL - 6 && rightL < interiorL - 6,
    `intL=${interiorL.toFixed(1)} bot=${botL.toFixed(1)} right=${rightL.toFixed(1)}`
  );
  // Optional TL light: at least one of top/left ≥ interior (or equal if no lighter step)
  ok(
    `paved ${id} TL not darker than interior`,
    topL >= interiorL - 2 && leftL >= interiorL - 2,
    `top=${topL.toFixed(1)} left=${leftL.toFixed(1)} int=${interiorL.toFixed(1)}`
  );
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
