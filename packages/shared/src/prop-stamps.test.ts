/**
 * Phase A — stamp footprint == collision bits written;
 * every solid tile has non-empty ground-level art.
 * Run: pnpm exec tsx packages/shared/src/prop-stamps.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ALL_PROP_STAMPS,
  applyPropStamp,
  footprintMatchesCollision,
  stampSolidHasGroundArt,
  stampFootprint,
  STAMP_COLUMN_3,
  STAMP_FOUNTAIN_2X2,
  STAMP_STATUE,
  mergeLayerScanCollision,
  type StampLayers,
} from "./prop-stamps.js";
import { Tile, SOLID_TILES, TILESET_COLS } from "./tiles.js";
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

// --- unit: every catalog stamp footprint == collision written ---
{
  const W = 32;
  const H = 32;
  for (const stamp of ALL_PROP_STAMPS) {
    const layers: StampLayers = {
      width: W,
      height: H,
      ground: new Uint16Array(W * H),
      deco: new Uint16Array(W * H),
      overhead: new Uint16Array(W * H),
      collision: new Uint8Array(W * H),
    };
    const ax = 16;
    const ay = 16;
    const res = applyPropStamp(layers, stamp, ax, ay);
    ok(`${stamp.id} apply ok`, res.ok);
    ok(`${stamp.id} footprint==collision`, footprintMatchesCollision(res), `decl=${res.declaredFootprint.length} wrote=${res.writtenCollision.length}`);
    ok(`${stamp.id} solid has ground art`, stampSolidHasGroundArt(stamp));
    // collision bits exactly match footprint cells
    const fp = stampFootprint(stamp);
    for (const c of fp) {
      const i = (ay + c.dy) * W + (ax + c.dx);
      ok(`${stamp.id} coll@${c.dx},${c.dy}`, layers.collision[i] === 1);
    }
    // no collision outside footprint for pure stamp apply
    let extra = 0;
    for (let i = 0; i < W * H; i++) {
      if (!layers.collision[i]) continue;
      const x = i % W;
      const y = (i / W) | 0;
      const dx = x - ax;
      const dy = y - ay;
      if (!fp.some((f) => f.dx === dx && f.dy === dy)) extra++;
    }
    ok(`${stamp.id} no extra collision`, extra === 0, `extra=${extra}`);
  }
}

// Fountain solid = rim ring only (4 cells)
{
  const fp = stampFootprint(STAMP_FOUNTAIN_2X2);
  ok("fountain footprint is 4 rim cells", fp.length === 4, `got ${fp.length}`);
  ok(
    "fountain all cells solid on deco",
    STAMP_FOUNTAIN_2X2.cells.every((c) => c.solid && c.layer === "deco")
  );
}

// Column: only base solid; shaft/top overhead non-solid
{
  const solids = STAMP_COLUMN_3.cells.filter((c) => c.solid);
  const overs = STAMP_COLUMN_3.cells.filter((c) => c.layer === "overhead");
  ok("column one solid cell (base)", solids.length === 1 && solids[0]!.tile === Tile.COLUMN_BASE);
  ok("column shaft is COLUMN_SHAFT not T_COL_MID", overs.some((c) => c.tile === Tile.COLUMN_SHAFT));
  ok("COLUMN_SHAFT not in SOLID_TILES", !SOLID_TILES.has(Tile.COLUMN_SHAFT));
  ok("T_COL_MID still solid (wall-engaged)", SOLID_TILES.has(Tile.T_COL_MID));
}

// Overhead-only must never be sole blocking representation
{
  ok(
    "no stamp solid is overhead-only",
    ALL_PROP_STAMPS.every((s) =>
      s.cells.filter((c) => c.solid).every((c) => c.layer !== "overhead")
    )
  );
}

// mergeLayerScanCollision ignores overhead solids
{
  const W = 8;
  const H = 8;
  const layers: StampLayers = {
    width: W,
    height: H,
    ground: new Uint16Array(W * H),
    deco: new Uint16Array(W * H),
    overhead: new Uint16Array(W * H),
    collision: new Uint8Array(W * H),
  };
  layers.overhead[3] = Tile.COLUMN_SHAFT;
  layers.overhead[4] = Tile.COLUMN_TOP;
  layers.deco[10] = Tile.COLUMN_BASE;
  mergeLayerScanCollision(layers);
  ok("overhead shaft alone does not collide", layers.collision[3] === 0);
  ok("overhead capital alone does not collide", layers.collision[4] === 0);
  ok("deco base does collide via layer scan", layers.collision[10] === 1);
}

// Solid tile ground-level art non-empty in tileset (sample solid props)
{
  const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
  ok("tileset exists for solid-art check", existsSync(tilesetPath));
  if (existsSync(tilesetPath)) {
    const img = await loadImage(tilesetPath);
    const cols = TILESET_COLS;
    const T = TILE_SIZE;
    const solidIds = [
      Tile.COLUMN_BASE,
      Tile.STATUE_BASE,
      Tile.FOUNTAIN_NW,
      Tile.FOUNTAIN_NE,
      Tile.FOUNTAIN_SW,
      Tile.FOUNTAIN_SE,
      Tile.CRATE,
      Tile.BENCH,
      Tile.PLANTER,
      Tile.PILLAR,
      Tile.POOL_COPING,
      Tile.LEDGE_FACE,
    ];
    for (const id of solidIds) {
      const sx = (id % cols) * T;
      const sy = Math.floor(id / cols) * T;
      const c = createCanvas(T, T);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, sx, sy, T, T, 0, 0, T, T);
      const data = ctx.getImageData(0, 0, T, T).data;
      let opaque = 0;
      let leftCol = 0;
      let rightCol = 0;
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const a = data[(y * T + x) * 4 + 3]!;
          if (a >= 40) {
            opaque++;
            if (x <= 1) leftCol++;
            if (x >= T - 2) rightCol++;
          }
        }
      }
      ok(`solid tile ${id} non-empty art`, opaque >= 16, `opaque=${opaque}`);
      // base art fills solid tile width (edge pixels present on props that are full-width)
      if (
        id === Tile.COLUMN_BASE ||
        id === Tile.FOUNTAIN_NW ||
        id === Tile.FOUNTAIN_NE ||
        id === Tile.FOUNTAIN_SW ||
        id === Tile.FOUNTAIN_SE ||
        id === Tile.POOL_COPING ||
        id === Tile.LEDGE_FACE
      ) {
        ok(
          `solid tile ${id} fills width (edge art)`,
          leftCol > 0 && rightCol > 0,
          `L=${leftCol} R=${rightCol}`
        );
      }
    }
  }
}

// gen-map uses stamp apply path
{
  const genMap = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");
  ok("gen-map imports applyPropStamp", /applyPropStamp/.test(genMap));
  ok("gen-map uses STAMP_COLUMN_3", /STAMP_COLUMN_3/.test(genMap));
  ok("gen-map uses STAMP_FOUNTAIN_2X2", /STAMP_FOUNTAIN_2X2/.test(genMap));
  ok("gen-map mergeLayerScanCollision", /mergeLayerScanCollision/.test(genMap));
}

// Statue stamp ok
ok("statue solid has ground art", stampSolidHasGroundArt(STAMP_STATUE));

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
