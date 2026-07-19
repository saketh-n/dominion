/**
 * Composes a sample scene from the generated tileset so structures
 * (house, temple, wall, fountain, trees) can be judged in context.
 * Output: preview/scene-preview.png (3x scale)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";
import {
  Tile,
  TILESET_COLS,
  TILE_SIZE,
  TerrainKind,
  selectAutotileIndex,
  baseTileForTerrain,
  variantCountForTerrain,
  transitionTileIndex,
} from "../packages/shared/src/index.js";
import { makeCanvas, scaleCanvas } from "./pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = TILE_SIZE;
const W = 28;
const H = 18;

const G = Tile.GRASS;
const G2 = Tile.GRASS2;
const G3 = Tile.GRASS3;
const G4 = Tile.GRASS4;

// terrain-kind grid → autotiled ground (shows blob transitions)
const kinds: TerrainKind[][] = [];
for (let y = 0; y < H; y++) {
  const row: TerrainKind[] = [];
  for (let x = 0; x < W; x++) row.push(TerrainKind.GRASS);
  kinds.push(row);
}
function fillKind(x0: number, y0: number, x1: number, y1: number, k: TerrainKind) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) kinds[y][x] = k;
}

// --- pond, top-right, ringed by sand ---
fillKind(22, 0, 27, 4, TerrainKind.SAND);
fillKind(23, 0, 27, 2, TerrainKind.WATER);

// --- dirt path + stone road ---
fillKind(12, 0, 13, 8, TerrainKind.DIRT);
for (let y = 9; y <= 10; y++) for (let x = 0; x < W; x++) kinds[y][x] = TerrainKind.STONE;

// --- marble plaza (larger continuous field for slab-seam / banding checks) ---
fillKind(12, 10, 27, 14, TerrainKind.MARBLE);
fillKind(14, 11, 27, 14, TerrainKind.MARBLE);

// bake autotile
const ground: number[][] = [];
for (let y = 0; y < H; y++) {
  const row: number[] = [];
  for (let x = 0; x < W; x++) {
    const nbs: TerrainKind[] = [
      kinds[Math.max(0, y - 1)][x],
      kinds[y][Math.min(W - 1, x + 1)],
      kinds[Math.min(H - 1, y + 1)][x],
      kinds[y][Math.max(0, x - 1)],
      kinds[Math.max(0, y - 1)][Math.min(W - 1, x + 1)],
      kinds[Math.min(H - 1, y + 1)][Math.min(W - 1, x + 1)],
      kinds[Math.min(H - 1, y + 1)][Math.max(0, x - 1)],
      kinds[Math.max(0, y - 1)][Math.max(0, x - 1)],
    ];
    row.push(
      selectAutotileIndex(kinds[y][x], nbs, {
        baseTile: baseTileForTerrain,
        transitionTile: transitionTileIndex,
        variantUnit: ((x * 17 + y * 31) % 100) / 100,
        variantCount: variantCountForTerrain,
      })
    );
  }
  ground.push(row);
}

const deco: number[][] = Array.from({ length: H }, () => Array(W).fill(0));
const over: number[][] = Array.from({ length: H }, () => Array(W).fill(0));

function fillGround(x0: number, y0: number, x1: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ground[y][x] = t;
}

// scatter decals on grass
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (kinds[y][x] !== TerrainKind.GRASS) continue;
    if ((x * 13 + y * 7) % 11 === 0) deco[y][x] = Tile.DECAL_TUFT;
    else if ((x * 5 + y * 3) % 17 === 0) deco[y][x] = Tile.DECAL_PEBBLES;
  }
}

// --- tall grass patch, left ---
for (let y = 8; y <= 10; y++) for (let x = 0; x <= 4; x++) deco[y][x] = Tile.TALL_GRASS;

// fountain 2x2 at plaza center
deco[12][20] = Tile.FOUNTAIN_NW;
deco[12][21] = Tile.FOUNTAIN_NE;
deco[13][20] = Tile.FOUNTAIN_SW;
deco[13][21] = Tile.FOUNTAIN_SE;

// statue + flanking pillars on plaza
deco[13][16] = Tile.STATUE_BASE;
over[12][16] = Tile.STATUE_TOP;
deco[13][24] = Tile.PILLAR;
deco[11][18] = Tile.PILLAR;

// --- Greco-Roman house (5 wide x 4 tall), center ---
const hx = 15;
const hy = 4;
const roofTop = [Tile.H_ROOF_NW, Tile.H_ROOF_N, Tile.H_ROOF_N, Tile.H_ROOF_N, Tile.H_ROOF_NE];
const roofBot = [Tile.H_ROOF_W, Tile.H_ROOF_M, Tile.H_ROOF_M, Tile.H_ROOF_M, Tile.H_ROOF_E];
const wallRow = [Tile.H_WALL_COL, Tile.H_WALL_WIN, Tile.H_WALL, Tile.H_WALL_WIN, Tile.H_WALL_COL];
const doorRow = [Tile.H_WALL, Tile.H_WALL, Tile.H_DOOR, Tile.H_WALL, Tile.H_WALL];
for (let i = 0; i < 5; i++) {
  deco[hy][hx + i] = roofTop[i];
  deco[hy + 1][hx + i] = roofBot[i];
  deco[hy + 2][hx + i] = wallRow[i];
  deco[hy + 3][hx + i] = doorRow[i];
}

// --- temple (7 wide), left — multi-tile facade with door + 3-tall columns ---
const tx = 2;
const ty = 0;
for (let i = 0; i < 7; i++) deco[ty + 1][tx + i] = Tile.T_FRIEZE;
deco[ty][tx + 2] = Tile.T_PED_W;
deco[ty][tx + 3] = Tile.T_PED_M;
deco[ty][tx + 4] = Tile.T_PED_E;
for (let i = 0; i < 7; i++) {
  const col = i % 2 === 0;
  deco[ty + 2][tx + i] = col ? Tile.T_COL_TOP : Tile.T_CELLA;
  deco[ty + 3][tx + i] = col ? Tile.T_COL_MID : Tile.T_CELLA;
  if (i === 3) deco[ty + 4][tx + i] = Tile.H_DOOR;
  else if (col) deco[ty + 4][tx + i] = Tile.T_COL_MID;
  else deco[ty + 4][tx + i] = Tile.H_WALL;
  deco[ty + 5][tx + i] = Tile.T_STEPS;
}
// shadowed cella behind the colonnade
for (let i = 0; i < 7; i++) {
  fillGround(tx + i, ty + 2, tx + i, ty + 4, Tile.T_FLOOR);
}
// pool terrace ledge + stairs near pond
fillGround(22, 3, 27, 3, Tile.CLIFF_TOP);
fillGround(22, 4, 27, 4, Tile.CLIFF_FACE);
fillGround(24, 4, 25, 4, Tile.T_STEPS);

// --- city wall along the bottom (3 tall: crenellation + 2 body courses), with gate ---
for (let x = 0; x < W; x++) {
  deco[15][x] = Tile.W_TOP;
  deco[16][x] = Tile.W_BODY;
  deco[17][x] = Tile.W_BODY;
}
deco[17][8] = Tile.W_GATE_L;
deco[17][9] = Tile.W_GATE_OPEN;
deco[16][9] = Tile.W_GATE_TOP;
deco[17][10] = Tile.W_GATE_R;

// --- trees ---
for (const [tx2, ty2] of [
  [10, 3],
  [24, 6],
  [26, 7],
  [7, 7],
  [0, 2],
  [1, 5],
]) {
  deco[ty2][tx2] = Tile.TREE_TRUNK;
  over[ty2 - 1][tx2] = Tile.TREE_CANOPY;
}

// --- flowers, bushes, boulders ---
deco[6][10] = Tile.FLOWERS_RED;
deco[7][11] = Tile.FLOWERS_GOLD;
deco[5][21] = Tile.BUSH;
deco[6][20] = Tile.FLOWERS_RED;
deco[12][26] = Tile.FLOWERS_GOLD;
deco[8][8] = Tile.BOULDER;
deco[11][14] = Tile.FLOWERS_GOLD;

// 3-tall colonnade framing the road / plaza edge
for (const cx of [11, 14, 17, 23, 26]) {
  deco[10][cx] = Tile.COLUMN_BASE;
  over[9][cx] = Tile.T_COL_MID;
  over[8][cx] = Tile.COLUMN_TOP;
}
// banners + greenery accents
deco[11][15] = Tile.BANNER;
deco[5][22] = Tile.BUSH;
deco[6][23] = Tile.FLOWERS_GOLD;

async function main() {
  const tileset = await loadImage(join(ROOT, "apps/client/public/assets/tileset.png"));
  const { canvas, ctx } = makeCanvas(W * T, H * T);
  ctx.imageSmoothingEnabled = false;
  const drawLayer = (layer: number[][]) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = layer[y][x];
        if (t === 0) continue;
        const sx = (t % TILESET_COLS) * T;
        const sy = Math.floor(t / TILESET_COLS) * T;
        ctx.drawImage(tileset, sx, sy, T, T, x * T, y * T, T, T);
      }
    }
  };
  drawLayer(ground);
  drawLayer(deco);
  drawLayer(over);
  mkdirSync(join(ROOT, "preview"), { recursive: true });
  const out = scaleCanvas(canvas, 3);
  writeFileSync(join(ROOT, "preview/scene-preview.png"), out.toBuffer("image/png"));
  console.log(`scene preview: ${W}x${H} tiles -> preview/scene-preview.png`);
}

main();
