/**
 * Renders map previews from world.json:
 *   preview/map-overview.png  — whole 1024x1024 map, 1px per tile (color-coded)
 *   preview/map-city.png      — the capital, real tiles at 8px/tile
 *   preview/map-plaza.png     — plaza closeup, real tiles at 16px/tile
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "@napi-rs/canvas";
import {
  Tile,
  TILESET_COLS,
  TILE_SIZE,
  WorldFile,
  decodeWorld,
  idx,
  decodeTransitionTile,
  TRANSITION_PAIRS,
  TerrainKind,
} from "../packages/shared/src/index.js";
import { makeCanvas } from "./pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const world = decodeWorld(JSON.parse(readFileSync(join(ROOT, "apps/server/data/world.json"), "utf8")) as WorldFile);
const { width: W, height: H } = world;

const KIND_COLOR: Record<number, string> = {
  [TerrainKind.GRASS]: "#6a9a52",
  [TerrainKind.DIRT]: "#c4a878",
  [TerrainKind.SAND]: "#d8c488",
  [TerrainKind.STONE]: "#a8acb4",
  [TerrainKind.MARBLE]: "#d4cfc0",
  [TerrainKind.WATER]: "#4a84b8",
  [TerrainKind.ROCK]: "#908880",
  [TerrainKind.SNOW]: "#dce4ec",
};

const COLORS: Record<number, string> = {
  [Tile.GRASS]: "#6a9a52",
  [Tile.GRASS2]: "#628e4c",
  [Tile.GRASS3]: "#74a65e",
  [Tile.GRASS4]: "#5c8a48",
  [Tile.TALL_GRASS]: "#4e7a3c",
  [Tile.DIRT_PATH]: "#c4a878",
  [Tile.DIRT_PATH2]: "#b89c6c",
  [Tile.DIRT_PATH3]: "#d0b484",
  [Tile.STONE_ROAD]: "#a8acb4",
  [Tile.STONE_ROAD2]: "#9ea2aa",
  [Tile.STONE_ROAD3]: "#b2b6be",
  [Tile.MARBLE_FLOOR]: "#d4cfc0",
  [Tile.MARBLE_FLOOR2]: "#c8c0ac",
  [Tile.MARBLE_FLOOR3]: "#c0bcb0",
  [Tile.SAND]: "#d8c488",
  [Tile.SAND2]: "#d0bc80",
  [Tile.SAND3]: "#e0cc90",
  [Tile.WATER]: "#4a84b8",
  [Tile.WATER2]: "#447eb0",
  [Tile.WATER3]: "#528cbc",
  [Tile.WATER_SHORE]: "#6298c8",
  [Tile.ROCK_GROUND]: "#908880",
  [Tile.ROCK_GROUND2]: "#888078",
  [Tile.ROCK_GROUND3]: "#989088",
  [Tile.SNOW]: "#dce4ec",
  [Tile.SNOW2]: "#d0d8e0",
  [Tile.CLIFF_FACE]: "#6b625a",
  [Tile.CLIFF_TOP]: "#8a8078",
  [Tile.T_STEPS]: "#e4e0d4",
  [Tile.T_FLOOR]: "#c8c0ac",
  [Tile.FLOOR_WOOD]: "#b09060",
  [Tile.RUG]: "#8e3c38",
};

function groundColor(g: number): string {
  if (COLORS[g]) return COLORS[g];
  const dec = decodeTransitionTile(g);
  if (dec) {
    const pair = TRANSITION_PAIRS[dec.pairId];
    // blend fg over bg for overview
    return KIND_COLOR[pair?.fg] ?? "#888888";
  }
  return "#888888";
}
const DECO_COLORS: Record<number, string> = {
  [Tile.TREE_TRUNK]: "#2c6b2e",
  [Tile.TALL_GRASS]: "#3f7d2c",
  [Tile.BUSH]: "#397a35",
  [Tile.BOULDER]: "#877d74",
  [Tile.W_TOP]: "#93855f",
  [Tile.W_BODY]: "#ab9c7c",
  [Tile.W_GATE_L]: "#6b4526",
  [Tile.W_GATE_R]: "#6b4526",
  [Tile.W_GATE_OPEN]: "#4e3018",
  [Tile.W_GATE_TOP]: "#93855f",
  [Tile.H_ROOF_NW]: "#cd6b4b",
  [Tile.H_ROOF_N]: "#cd6b4b",
  [Tile.H_ROOF_NE]: "#cd6b4b",
  [Tile.H_ROOF_W]: "#c9674a",
  [Tile.H_ROOF_M]: "#c9674a",
  [Tile.H_ROOF_E]: "#c9674a",
  [Tile.H_WALL]: "#efe9da",
  [Tile.H_WALL_WIN]: "#e8e2d2",
  [Tile.H_WALL_COL]: "#f4efe2",
  [Tile.H_DOOR]: "#8a5c36",
  [Tile.T_PED_W]: "#f2ede0",
  [Tile.T_PED_M]: "#a43e35",
  [Tile.T_PED_E]: "#f2ede0",
  [Tile.T_FRIEZE]: "#ebe7da",
  [Tile.T_COL_TOP]: "#f8f5ec",
  [Tile.T_COL_MID]: "#f2efe6",
  [Tile.T_CELLA]: "#4e4438",
  [Tile.FOUNTAIN_NW]: "#4494e0",
  [Tile.FOUNTAIN_NE]: "#4494e0",
  [Tile.FOUNTAIN_SW]: "#4494e0",
  [Tile.FOUNTAIN_SE]: "#4494e0",
  [Tile.STATUE_BASE]: "#cbc4b2",
  [Tile.PILLAR]: "#ebe7da",
  [Tile.COLUMN_BASE]: "#ebe7da",
  [Tile.FLOWERS_RED]: "#d84a3f",
  [Tile.FLOWERS_GOLD]: "#d9a840",
};

async function main() {
  mkdirSync(join(ROOT, "preview"), { recursive: true });

  // --- overview: 1px per tile ---
  const ov = makeCanvas(W, H);
  const img = ov.ctx.createImageData(W, H);
  const put = (i: number, hexColor: string) => {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  };
  for (let i = 0; i < W * H; i++) {
    const d = world.deco[i];
    const g = world.ground[i];
    put(i, DECO_COLORS[d] ?? groundColor(g));
  }
  ov.ctx.putImageData(img, 0, 0);
  writeFileSync(join(ROOT, "preview/map-overview.png"), ov.canvas.toBuffer("image/png"));

  // --- city + plaza closeups with real tiles ---
  const tileset = await loadImage(join(ROOT, "apps/client/public/assets/tileset.png"));
  const T = TILE_SIZE;

  const renderRegion = (x0: number, y0: number, x1: number, y1: number, scalePx: number) => {
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    const { canvas, ctx } = makeCanvas(rw * scalePx, rh * scalePx);
    ctx.imageSmoothingEnabled = false;
    const drawT = (t: number, x: number, y: number) => {
      if (!t) return;
      const sx = (t % TILESET_COLS) * T;
      const sy = Math.floor(t / TILESET_COLS) * T;
      ctx.drawImage(tileset, sx, sy, T, T, (x - x0) * scalePx, (y - y0) * scalePx, scalePx, scalePx);
    };
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) drawT(world.ground[idx(x, y, W)], x, y);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) drawT(world.deco[idx(x, y, W)], x, y);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) drawT(world.overhead[idx(x, y, W)], x, y);
    return canvas;
  };

  const city = renderRegion(430, 430, 593, 593, 8);
  writeFileSync(join(ROOT, "preview/map-city.png"), city.toBuffer("image/png"));

  const plaza = renderRegion(474, 474, 550, 550, 16);
  writeFileSync(join(ROOT, "preview/map-plaza.png"), plaza.toBuffer("image/png"));

  console.log("previews written: map-overview.png, map-city.png, map-plaza.png");
}

main();
