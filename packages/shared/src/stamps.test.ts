/**
 * Step 3 — authored stamps, flatness budget, no orphan detail pixels.
 * Run: pnpm exec tsx packages/shared/src/stamps.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  top2ColorShare,
  detailOrphanCount,
} from "./graphics-analysis.js";
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
const stampsPath = join(ROOT, "tools/stamps.ts");
const palettePath = join(ROOT, "tools/palette.ts");
const genPath = join(ROOT, "tools/gen-tileset.ts");

ok("stamps.ts exists", existsSync(stampsPath));
const paletteSrc = readFileSync(palettePath, "utf8");
const genSrc = readFileSync(genPath, "utf8");
const stampsSrc = readFileSync(stampsPath, "utf8");

// stamp library ≤ 12
{
  const m = paletteSrc.match(/export const STAMPS[\s\S]*?= \[([\s\S]*?)\];/);
  const names = m ? [...m[1]!.matchAll(/name:\s*"([^"]+)"/g)].map((x) => x[1]) : [];
  ok("stamp library size ≤ 12", names.length > 0 && names.length <= 12, `got ${names.length}: ${names.join(",")}`);
}

// no 70-pixel scatter loops / hash % 19 noise in gen-tileset
ok("no 70-iter scatter loop", !/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*70/.test(genSrc));
ok("no % 19 hash noise", !/%\s*19/.test(genSrc));
ok("no % 17 hash noise", !/%\s*17/.test(genSrc));
ok("uses placeStamps / paintGroundWithStamps", /placeStamps|paintGroundWithStamps/.test(genSrc));
ok("stamps enforce min spacing ≥ 3", /STAMP_MIN_SPACING\s*=\s*3/.test(stampsSrc));
ok("stamps enforce edge margin ≥ 2", /STAMP_EDGE_MARGIN\s*=\s*2/.test(stampsSrc));

const GROUND_TILES = [
  Tile.GRASS,
  Tile.GRASS2,
  Tile.GRASS3,
  Tile.GRASS4,
  Tile.DIRT_PATH,
  Tile.DIRT_PATH2,
  Tile.DIRT_PATH3,
  Tile.STONE_ROAD,
  Tile.STONE_ROAD2,
  Tile.STONE_ROAD3,
  Tile.MARBLE_FLOOR,
  Tile.MARBLE_FLOOR2,
  Tile.MARBLE_FLOOR3,
  Tile.SAND,
  Tile.SAND2,
  Tile.SAND3,
  Tile.ROCK_GROUND,
  Tile.ROCK_GROUND2,
  Tile.SNOW,
  Tile.FLOOR_WOOD,
];

const img = await loadImage(tilesetPath);
const cols = TILESET_COLS;
const T = TILE_SIZE;

function sampleTile(tileIndex: number): Uint8ClampedArray {
  const sx = (tileIndex % cols) * T;
  const sy = Math.floor(tileIndex / cols) * T;
  const c = createCanvas(T, T);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, T, T, 0, 0, T, T);
  return ctx.getImageData(0, 0, T, T).data;
}

let flatFails = 0;
let orphanFails = 0;
for (const id of GROUND_TILES) {
  const data = sampleTile(id);
  const share = top2ColorShare(data);
  const orphans = detailOrphanCount(data, T, T);
  if (share < 0.8) {
    flatFails++;
    lines.push(`FAIL  flatness tile ${id} — top2=${share.toFixed(3)}`);
    failed++;
  } else {
    passed++;
    lines.push(`PASS  flatness tile ${id} — top2=${share.toFixed(3)}`);
  }
  if (orphans > 0) {
    orphanFails++;
    lines.push(`FAIL  orphans tile ${id} — count=${orphans}`);
    failed++;
  } else {
    passed++;
    lines.push(`PASS  orphans tile ${id} — 0`);
  }
}
ok("all ground tiles meet flatness", flatFails === 0, `${flatFails} failed`);
ok("all ground tiles orphan-free", orphanFails === 0, `${orphanFails} failed`);

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
