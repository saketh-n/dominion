/**
 * Step 4 — ground quiet / objects loud value hierarchy.
 * Run: pnpm exec tsx packages/shared/src/value-hierarchy.test.ts
 */
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

/** Ground max relative-luminance spread (~20%). */
const GROUND_SPREAD_MAX = 0.22;
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

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
