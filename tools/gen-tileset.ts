/**
 * Generates the original Dominion tileset (16x16 tiles, Pokemon-DS-inspired,
 * Greco-Roman capital theme) plus a labeled 4x preview contact sheet.
 *
 * Output:
 *   apps/client/public/assets/tileset.png
 *   preview/tileset-preview.png
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Canvas } from "@napi-rs/canvas";
import {
  Tile,
  TILESET_COLS,
  TILE_SIZE,
  BLOB_MASKS_47,
  BLOB_TILE_COUNT,
  BLOB_MASK_ALL,
  TRANSITION_PAIRS,
  TRANSITION_PAIR_COUNT,
  TerrainKind,
  blobCoverageAt,
  transitionTileIndex,
} from "../packages/shared/src/index.js";
import {
  makeCanvas,
  scaleCanvas,
  px,
  rect,
  hline,
  vline,
  rng,
  shade,
  mix,
  drawTemplate,
  Ctx,
  STYLE,
  ditherPick,
  ditherVGradient,
  ditherThreshold,
  dropShadow,
  contactShadow,
  applySelectiveOutline,
  applyDirectionalLight,
  applyDesaturate,
  paintBlobTransition,
  desaturate,
} from "./pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = TILE_SIZE; // 16

// ---------------------------------------------------------------------------
// Palette — muted, desaturated, value-grouped. Light source: top-left.
// ---------------------------------------------------------------------------
export const PAL = {
  grass: { base: "#6a9a52", light: "#7eae64", lush: "#8fbc72", dark: "#568044", deep: "#3f6434" },
  tall: { bg: "#4e7a3c", blade: "#3a6830", bladeD: "#2c5226", bladeL: "#5e9250", tip: "#78a864" },
  dirt: { base: "#c4a878", light: "#d4bc8c", dark: "#a88c60", deep: "#8a704c" },
  stone: { base: "#a8acb4", light: "#bcc0c8", dark: "#8a909a", grout: "#6e747e", deep: "#585c64" },
  marble: { base: "#d4cfc0", light: "#e4e0d4", vein: "#b0a898", dark: "#9a9284", deep: "#7a7264", cream: "#c8c0ac" },
  sand: { base: "#d8c488", light: "#e6d69c", dark: "#c0a870", deep: "#a88c58" },
  water: { base: "#4a84b8", light: "#6298c8", pale: "#8cb4d4", dark: "#3a6a98", deep: "#2c5478" },
  rock: { base: "#908880", light: "#a89e96", dark: "#706860", deep: "#544c46" },
  snow: { base: "#dce4ec", shadow: "#b0bcc8", light: "#eef2f6" },
  wood: { base: "#b09060", light: "#c4a878", dark: "#8a7048", seam: "#6e5638" },
  roof: { base: "#b06048", light: "#c4785c", lighter: "#d49074", dark: "#8e4838", deep: "#6e3428" },
  door: { wood: "#7a5434", dark: "#5c3c24", darker: "#3c2818", light: "#96704c" },
  gold: "#c49848",
  goldL: "#d8b468",
  crimson: "#8e3c38",
  crimsonD: "#6a2c28",
  cwall: { base: "#b8ac90", light: "#ccc0a4", dark: "#968a70", mortar: "#7a7058", deep: "#5e5644" },
  trunk: { base: "#7a5638", dark: "#5c4028", light: "#927050", deep: "#443020" },
  canopy: { base: "#4a8650", light: "#5e9c64", lush: "#74b078", dark: "#386840", deep: "#284c30" },
  interior: { wallTop: "#d4c8b0", wallDark: "#b8a888", panel: "#9a784c", panelD: "#7a5c38" },
};

// ---------------------------------------------------------------------------
// terrain painters
// ---------------------------------------------------------------------------

function grass(ctx: Ctx, seed: number, lushDots: boolean) {
  const r = rng(seed);
  // Dithered vertical light gradient (top-left sun) + organic clumps
  ditherVGradient(ctx, 0, 0, T, T, [PAL.grass.light, PAL.grass.base, PAL.grass.dark]);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * T);
    const y = Math.floor(r() * T);
    const pick = r();
    const c =
      pick < 0.22
        ? PAL.grass.deep
        : pick < 0.45
          ? PAL.grass.dark
          : pick < 0.72
            ? mix(PAL.grass.base, PAL.grass.light, 0.5)
            : PAL.grass.light;
    px(ctx, x, y, c);
  }
  for (let i = 0; i < 28; i++) {
    const x = Math.floor(r() * T);
    const y = Math.floor(r() * (T - 1));
    const c = r() < 0.5 ? PAL.grass.light : PAL.grass.dark;
    px(ctx, x, y, c);
    px(ctx, x, y + 1, shade(c, -0.1));
    if (r() < 0.35) px(ctx, x + 1, y, mix(c, PAL.grass.lush, 0.3));
  }
  for (let i = 0; i < 7; i++) {
    const x = 1 + Math.floor(r() * (T - 4));
    const y = 1 + Math.floor(r() * (T - 4));
    px(ctx, x, y, PAL.grass.deep);
    px(ctx, x + 1, y, PAL.grass.dark);
    px(ctx, x, y + 1, PAL.grass.dark);
    px(ctx, x + 1, y + 1, mix(PAL.grass.dark, PAL.grass.base, 0.4));
    if (r() < 0.7) px(ctx, x + 1, y - 1, PAL.grass.light);
    if (r() < 0.4) px(ctx, x + 2, y, PAL.grass.lush);
  }
  if (lushDots) {
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(r() * (T - 1));
      const y = Math.floor(r() * (T - 1));
      px(ctx, x, y, PAL.grass.lush);
      px(ctx, x + 1, y, shade(PAL.grass.lush, 0.15));
      px(ctx, x, y + 1, mix(PAL.grass.lush, PAL.grass.dark, 0.25));
    }
  }
}

function tallGrass(ctx: Ctx) {
  rect(ctx, 0, 0, T, T, PAL.tall.bg);
  // two staggered rows of chunky tufts (DS-style)
  const tuft = (cx: number, baseY: number) => {
    // center blade
    vline(ctx, cx, baseY - 5, 5, PAL.tall.blade);
    px(ctx, cx, baseY - 6, PAL.tall.tip);
    // left blade
    vline(ctx, cx - 2, baseY - 3, 3, PAL.tall.bladeD);
    px(ctx, cx - 2, baseY - 4, PAL.tall.blade);
    px(ctx, cx - 1, baseY - 2, PAL.tall.bladeD);
    // right blade
    vline(ctx, cx + 2, baseY - 4, 4, PAL.tall.bladeL);
    px(ctx, cx + 2, baseY - 5, PAL.tall.tip);
    px(ctx, cx + 1, baseY - 2, PAL.tall.blade);
    // base shadow
    hline(ctx, cx - 2, baseY, 5, PAL.tall.bladeD);
  };
  tuft(3, 7);
  tuft(11, 8);
  tuft(7, 15);
  tuft(14, 15);
  tuft(1, 15);
}

function dirtPath(ctx: Ctx, seed: number) {
  const r = rng(seed);
  ditherVGradient(ctx, 0, 0, T, T, [PAL.dirt.light, PAL.dirt.base, PAL.dirt.dark]);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * T);
    const y = Math.floor(r() * T);
    hline(ctx, x, y, 1 + Math.floor(r() * 3), r() < 0.5 ? PAL.dirt.light : PAL.dirt.dark);
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * (T - 2)) + 1;
    const y = Math.floor(r() * (T - 2)) + 1;
    px(ctx, x, y, PAL.dirt.deep);
    px(ctx, x + 1, y, PAL.dirt.dark);
    px(ctx, x, y - 1, PAL.dirt.light);
  }
  // micro gravel scatter
  for (let i = 0; i < 6; i++) {
    px(ctx, Math.floor(r() * T), Math.floor(r() * T), mix(PAL.dirt.deep, PAL.stone.dark, 0.3));
  }
}

function stoneRoad(ctx: Ctx, seed: number, offset: boolean) {
  const r = rng(seed);
  // multi-value cobble: 4×4 stones with grout + wear (DP road density)
  rect(ctx, 0, 0, T, T, PAL.stone.grout);
  for (let row = 0; row < 4; row++) {
    const shift = offset && row % 2 === 1 ? 2 : 0;
    const sy = row * 4;
    for (let col = -1; col < 5; col++) {
      const sx = col * 4 + shift;
      const tone = mix(PAL.stone.base, PAL.stone.light, r() * 0.6);
      const tw = 3 + (r() < 0.3 ? 1 : 0);
      const th = 3;
      rect(ctx, sx, sy, tw, th, tone);
      hline(ctx, sx, sy, tw, shade(tone, 0.18));
      hline(ctx, sx, sy + th - 1, tw, PAL.stone.dark);
      vline(ctx, sx + tw - 1, sy, th, PAL.stone.dark);
      if (r() < 0.5) px(ctx, sx + 1, sy + 1, shade(tone, r() < 0.5 ? 0.2 : -0.15));
      if (r() < 0.25) px(ctx, sx + 1, sy + 2, PAL.stone.deep);
    }
  }
}

function marbleFloor(ctx: Ctx, seed: number) {
  const r = rng(seed);
  // Continuous court slab — NO edge bevels, NO diamond lattice, NO tile-border
  // lines (those create a 16px period when fields tile). Low-contrast wash +
  // seed-driven mottling only; large fields hide the grid via variants.
  const top = mix(PAL.marble.light, PAL.marble.cream, 0.15 + (seed % 5) * 0.02);
  const mid = mix(PAL.marble.base, PAL.marble.cream, 0.35 + (seed % 3) * 0.05);
  const bot = mix(PAL.marble.base, PAL.marble.vein, 0.08);
  // Very gentle vertical wash (no hard bands) via dither
  ditherVGradient(ctx, 0, 0, T, T, [top, mid, bot]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      // seed-scrambled hash so adjacent tiles with different seeds don't align
      const n = ((x * 17 + y * 31 + seed * 9137 + x * y * 3) >>> 0) % 19;
      if (n === 0) px(ctx, x, y, mix(PAL.marble.base, PAL.marble.cream, 0.5));
      else if (n === 1) px(ctx, x, y, mix(PAL.marble.base, PAL.marble.vein, 0.28));
      else if (n === 2) px(ctx, x, y, mix(PAL.marble.base, PAL.marble.light, 0.4));
      else if (n === 3) px(ctx, x, y, mix(mid, PAL.stone.light, 0.08));
    }
  }
  // short irregular vein (interior only, never full edge)
  const vx = 3 + Math.floor(r() * 5);
  const vy = 3 + Math.floor(r() * 5);
  for (let i = 0; i < 4; i++) {
    const x = Math.min(T - 3, Math.max(2, vx + i + (r() < 0.35 ? 1 : 0)));
    const y = Math.min(T - 3, Math.max(2, vy + Math.floor(i * 0.6)));
    px(ctx, x, y, mix(PAL.marble.vein, PAL.marble.base, 0.5));
  }
  for (let i = 0; i < 5; i++) {
    px(
      ctx,
      2 + Math.floor(r() * (T - 4)),
      2 + Math.floor(r() * (T - 4)),
      mix(PAL.marble.dark, PAL.marble.vein, 0.35)
    );
  }
}

function marbleChecker(ctx: Ctx) {
  // Cooler alternate slab — different noise field, still no borders
  const r = rng(818);
  ditherVGradient(ctx, 0, 0, T, T, [
    mix(PAL.marble.cream, PAL.stone.light, 0.12),
    mix(PAL.marble.base, PAL.stone.base, 0.1),
    mix(PAL.marble.cream, PAL.marble.vein, 0.25),
  ]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = ((x * 23 + y * 41 + 1103 + x * y) >>> 0) % 17;
      if (n === 0) px(ctx, x, y, mix(PAL.marble.cream, PAL.goldL, 0.06));
      else if (n === 1) px(ctx, x, y, mix(PAL.marble.base, PAL.marble.vein, 0.32));
      else if (n === 2) px(ctx, x, y, PAL.marble.light);
      else if (n === 3) px(ctx, x, y, mix(PAL.marble.base, PAL.stone.dark, 0.08));
    }
  }
  // interior blotch only (never edge-aligned)
  for (let i = 0; i < 4; i++) {
    const cx = 3 + Math.floor(r() * 8);
    const cy = 3 + Math.floor(r() * 8);
    px(ctx, cx, cy, mix(PAL.marble.vein, PAL.marble.base, 0.45));
    px(ctx, cx + 1, cy, mix(PAL.marble.vein, PAL.marble.cream, 0.4));
  }
}

function sandTile(ctx: Ctx, seed: number) {
  const r = rng(seed);
  ditherVGradient(ctx, 0, 0, T, T, [PAL.sand.light, PAL.sand.base, PAL.sand.dark]);
  for (let i = 0; i < 14; i++) {
    px(ctx, Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? PAL.sand.light : PAL.sand.dark);
  }
  // wavy ripple dashes (dithered)
  for (let x = 2; x < 6; x++) px(ctx, x, 5, ditherPick(x, 5, 0.55, PAL.sand.dark, PAL.sand.deep));
  px(ctx, 6, 4, PAL.sand.dark);
  for (let x = 9; x < 13; x++) px(ctx, x, 11, ditherPick(x, 11, 0.5, PAL.sand.dark, PAL.sand.base));
  px(ctx, 8, 10, PAL.sand.dark);
  hline(ctx, 3, 14, 3, PAL.sand.deep);
}

function waterTile(ctx: Ctx, phase: number) {
  // Dithered depth gradient + foam sparkles (no pure white)
  const foam = mix(PAL.water.pale, PAL.snow.light, 0.35);
  ditherVGradient(ctx, 0, 0, T, T, [
    mix(PAL.water.light, PAL.water.pale, 0.25 + phase * 0.05),
    PAL.water.base,
    mix(PAL.water.dark, PAL.water.deep, 0.35 + phase * 0.05),
  ]);
  const o = phase * 3;
  // undertone patches with dithered edges
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 6; dx++) {
      const x = (2 + o + dx) % T;
      const y = 4 + dy;
      if (ditherThreshold(x, y) < 0.7) px(ctx, x, y, PAL.water.dark);
    }
  }
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const x = (9 + o + dx) % T;
      const y = 10 + dy;
      if (ditherThreshold(x, y) < 0.65) px(ctx, x, y, mix(PAL.water.base, PAL.water.deep, 0.45));
    }
  }
  // wave crests + foam (dithered, muted)
  for (let i = 0; i < 5; i++) {
    const x = (3 + o + i) % T;
    px(ctx, x, 3, ditherPick(x, 3, 0.6, PAL.water.pale, foam));
  }
  px(ctx, (7 + o) % T, 2, foam);
  for (let i = 0; i < 6; i++) {
    const x = (8 + o + i) % T;
    px(ctx, x, 7, ditherPick(x, 7, 0.5, PAL.water.light, PAL.water.pale));
  }
  px(ctx, (12 + o) % T, 6, PAL.water.pale);
  for (let i = 0; i < 5; i++) {
    const x = (1 + o + i) % T;
    px(ctx, x, 12, ditherPick(x, 12, 0.55, PAL.water.pale, foam));
  }
  px(ctx, (4 + o) % T, 11, foam);
  px(ctx, (10 + o) % T, 14, PAL.water.pale);
  px(ctx, 0, 15, PAL.water.deep);
  px(ctx, 15, 15, PAL.water.deep);
  px(ctx, 1, 14, PAL.water.dark);
}

function waterShore(ctx: Ctx) {
  // dithered shallow → deep + foam edge
  ditherVGradient(ctx, 0, 0, T, T, [mix(PAL.water.pale, PAL.sand.light, 0.15), PAL.water.light, PAL.water.base, PAL.water.dark]);
  for (let x = 0; x < T; x++) {
    px(ctx, x, 0, ditherPick(x, 0, 0.7, PAL.water.pale, mix(PAL.water.pale, PAL.snow.light, 0.4)));
    px(ctx, x, 1, ditherPick(x, 1, 0.45, PAL.water.light, PAL.water.pale));
  }
  px(ctx, 3, 2, PAL.water.pale);
  px(ctx, 9, 2, PAL.water.pale);
  px(ctx, 14, 2, PAL.water.pale);
  hline(ctx, 2, 5, 4, PAL.water.pale);
  hline(ctx, 9, 10, 5, PAL.water.pale);
  hline(ctx, 4, 13, 4, PAL.water.light);
}

function rockGround(ctx: Ctx, seed: number) {
  const r = rng(seed);
  ditherVGradient(ctx, 0, 0, T, T, [PAL.rock.light, PAL.rock.base, PAL.rock.dark]);
  const pebbles = 5;
  for (let i = 0; i < pebbles; i++) {
    const x = 1 + Math.floor(r() * (T - 4));
    const y = 1 + Math.floor(r() * (T - 3));
    hline(ctx, x, y, 2 + Math.floor(r() * 2), PAL.rock.light);
    hline(ctx, x, y + 1, 2 + Math.floor(r() * 2), PAL.rock.dark);
  }
  for (let i = 0; i < 6; i++) {
    px(ctx, Math.floor(r() * T), Math.floor(r() * T), r() < 0.5 ? PAL.rock.light : PAL.rock.dark);
  }
}

function snowTile(ctx: Ctx, seed: number) {
  const r = rng(seed);
  ditherVGradient(ctx, 0, 0, T, T, [PAL.snow.light, PAL.snow.base, PAL.snow.shadow]);
  for (let i = 0; i < 7; i++) {
    px(ctx, Math.floor(r() * T), Math.floor(r() * T), PAL.snow.shadow);
  }
  px(ctx, 4, 3, PAL.snow.light);
  px(ctx, 12, 9, PAL.snow.light);
  px(ctx, 7, 13, PAL.snow.light);
}

function woodFloor(ctx: Ctx, seed: number) {
  const r = rng(seed);
  rect(ctx, 0, 0, T, T, PAL.wood.base);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    hline(ctx, 0, y + 3, T, PAL.wood.seam);
    hline(ctx, 0, y, T, PAL.wood.light);
    // plank joints staggered
    const jx = (row * 7 + 3) % T;
    vline(ctx, jx, y, 3, PAL.wood.seam);
    // grain
    hline(ctx, Math.floor(r() * 10), y + 1 + Math.floor(r() * 2), 2 + Math.floor(r() * 3), PAL.wood.dark);
  }
}

// ---------------------------------------------------------------------------
// deco painters (transparent background — drawn over ground)
// ---------------------------------------------------------------------------

function flowers(ctx: Ctx, color: string, colorLight: string) {
  const flower = (cx: number, cy: number) => {
    px(ctx, cx, cy - 1, color);
    px(ctx, cx, cy + 1, color);
    px(ctx, cx - 1, cy, color);
    px(ctx, cx + 1, cy, color);
    px(ctx, cx - 1, cy - 1, colorLight);
    px(ctx, cx, cy, PAL.goldL);
    // leaves
    px(ctx, cx + 1, cy + 2, PAL.grass.deep);
    px(ctx, cx - 2, cy + 1, PAL.grass.deep);
  };
  flower(4, 4);
  flower(11, 7);
  flower(5, 12);
}

function bush(ctx: Ctx) {
  const B = PAL.canopy;
  dropShadow(ctx, 8, 14.2, 6.5, 2.2);
  contactShadow(ctx, 3, 14, 10);
  rect(ctx, 3, 5, 10, 8, B.base);
  rect(ctx, 2, 6, 12, 6, B.base);
  rect(ctx, 4, 4, 8, 2, B.base);
  rect(ctx, 5, 3, 6, 1, B.base);
  hline(ctx, 5, 2, 6, B.deep);
  px(ctx, 4, 3, B.deep);
  px(ctx, 11, 3, B.deep);
  px(ctx, 3, 4, B.deep);
  px(ctx, 12, 4, B.deep);
  px(ctx, 2, 5, B.deep);
  px(ctx, 13, 5, B.deep);
  vline(ctx, 1, 6, 6, B.deep);
  vline(ctx, 14, 6, 6, B.deep);
  px(ctx, 2, 12, B.deep);
  px(ctx, 13, 12, B.deep);
  hline(ctx, 3, 13, 10, B.deep);
  rect(ctx, 5, 4, 3, 2, B.light);
  rect(ctx, 4, 6, 2, 2, B.light);
  px(ctx, 6, 3, B.lush);
  px(ctx, 5, 5, B.lush);
  rect(ctx, 10, 9, 3, 3, B.dark);
  rect(ctx, 6, 10, 3, 2, B.dark);
  applySelectiveOutline(ctx, T);
}

function boulder(ctx: Ctx) {
  const R = PAL.rock;
  dropShadow(ctx, 8, 13.5, 6, 2.0);
  contactShadow(ctx, 3, 13, 10);
  rect(ctx, 3, 5, 10, 7, R.base);
  rect(ctx, 4, 4, 8, 1, R.base);
  rect(ctx, 5, 3, 5, 1, R.base);
  hline(ctx, 5, 2, 5, R.deep);
  px(ctx, 4, 3, R.deep);
  px(ctx, 10, 3, R.deep);
  px(ctx, 3, 4, R.deep);
  px(ctx, 12, 4, R.deep);
  vline(ctx, 2, 5, 7, R.deep);
  vline(ctx, 13, 5, 7, R.deep);
  hline(ctx, 3, 12, 10, R.deep);
  rect(ctx, 5, 4, 4, 3, R.light);
  px(ctx, 4, 5, R.light);
  rect(ctx, 9, 8, 3, 3, R.dark);
  hline(ctx, 4, 10, 4, R.dark);
  px(ctx, 8, 6, R.dark);
  applySelectiveOutline(ctx, T);
}

function treeTrunk(ctx: Ctx) {
  const K = PAL.trunk;
  dropShadow(ctx, 8, 15, 6.5, 1.6);
  contactShadow(ctx, 2, 15, 12);
  rect(ctx, 5, 0, 6, 12, K.base);
  vline(ctx, 4, 0, 10, K.dark);
  vline(ctx, 11, 0, 10, K.dark);
  vline(ctx, 5, 0, 11, K.light);
  vline(ctx, 8, 2, 4, K.dark);
  px(ctx, 7, 7, K.dark);
  px(ctx, 9, 8, K.dark);
  rect(ctx, 3, 12, 10, 2, K.base);
  px(ctx, 2, 13, K.dark);
  px(ctx, 13, 13, K.dark);
  hline(ctx, 3, 11, 2, K.dark);
  hline(ctx, 11, 11, 2, K.dark);
  hline(ctx, 2, 14, 12, K.deep);
  applySelectiveOutline(ctx, T);
}

function treeCanopy(ctx: Ctx) {
  const C = PAL.canopy;
  // big rounded canopy filling the tile, scalloped bottom
  rect(ctx, 1, 3, 14, 10, C.base);
  rect(ctx, 2, 1, 12, 2, C.base);
  rect(ctx, 4, 0, 8, 1, C.base);
  rect(ctx, 0, 5, 16, 6, C.base);
  // outline
  hline(ctx, 4, 0, 8, C.deep);
  px(ctx, 3, 1, C.deep);
  px(ctx, 12, 1, C.deep);
  px(ctx, 2, 2, C.deep);
  px(ctx, 13, 2, C.deep);
  px(ctx, 1, 3, C.deep);
  px(ctx, 14, 3, C.deep);
  vline(ctx, 0, 4, 7, C.deep);
  vline(ctx, 15, 4, 7, C.deep);
  // scalloped lower edge
  px(ctx, 1, 11, C.deep);
  hline(ctx, 2, 12, 2, C.deep);
  hline(ctx, 4, 13, 3, C.deep);
  hline(ctx, 7, 12, 2, C.deep);
  hline(ctx, 9, 13, 3, C.deep);
  hline(ctx, 12, 12, 2, C.deep);
  px(ctx, 14, 11, C.deep);
  // leaf cluster highlights
  rect(ctx, 3, 2, 5, 3, C.light);
  rect(ctx, 2, 5, 3, 3, C.light);
  px(ctx, 5, 1, C.lush);
  rect(ctx, 4, 3, 2, 2, C.lush);
  rect(ctx, 9, 4, 3, 2, C.light);
  // shadow clusters
  rect(ctx, 10, 8, 4, 3, C.dark);
  rect(ctx, 5, 9, 4, 2, C.dark);
  px(ctx, 12, 6, C.dark);
}

// ---------------------------------------------------------------------------
// marble props
// ---------------------------------------------------------------------------

function pillarSingle(ctx: Ctx) {
  const M = PAL.marble;
  dropShadow(ctx, 8.5, 15.2, 7, 1.8);
  contactShadow(ctx, 1, 15, 14);
  rect(ctx, 2, 0, 12, 2, M.light);
  hline(ctx, 2, 0, 12, M.deep);
  hline(ctx, 2, 1, 12, PAL.goldL);
  rect(ctx, 3, 2, 10, 2, mix(M.base, PAL.gold, 0.15));
  hline(ctx, 3, 2, 10, M.light);
  hline(ctx, 3, 3, 10, M.dark);
  rect(ctx, 4, 4, 8, 8, M.base);
  vline(ctx, 4, 4, 8, M.light);
  vline(ctx, 5, 4, 8, mix(M.base, M.light, 0.4));
  vline(ctx, 7, 4, 8, M.vein);
  vline(ctx, 9, 4, 8, M.dark);
  vline(ctx, 10, 4, 8, M.deep);
  vline(ctx, 11, 4, 8, shade(M.deep, -0.15));
  hline(ctx, 4, 4, 8, M.dark);
  hline(ctx, 4, 11, 8, M.vein);
  rect(ctx, 3, 12, 10, 1, M.base);
  hline(ctx, 3, 12, 10, M.light);
  rect(ctx, 2, 13, 12, 2, M.cream);
  hline(ctx, 2, 13, 12, M.light);
  hline(ctx, 2, 14, 12, M.deep);
  vline(ctx, 2, 13, 2, M.deep);
  vline(ctx, 13, 13, 2, M.deep);
  applySelectiveOutline(ctx, T);
}

function columnBase(ctx: Ctx) {
  const M = PAL.marble;
  dropShadow(ctx, 8, 15.2, 6.5, 1.6);
  contactShadow(ctx, 2, 15, 12);
  rect(ctx, 5, 0, 6, 11, M.base);
  vline(ctx, 5, 0, 11, M.light);
  vline(ctx, 7, 0, 11, M.vein);
  vline(ctx, 9, 0, 11, M.dark);
  vline(ctx, 10, 0, 11, M.deep);
  rect(ctx, 4, 11, 8, 2, M.base);
  hline(ctx, 4, 11, 8, M.light);
  rect(ctx, 3, 13, 10, 2, M.base);
  hline(ctx, 3, 13, 10, M.vein);
  hline(ctx, 3, 14, 10, M.deep);
  applySelectiveOutline(ctx, T);
}

function columnTop(ctx: Ctx) {
  const M = PAL.marble;
  // abacus + echinus capital at bottom half; transparent above
  rect(ctx, 3, 9, 10, 2, M.light);
  hline(ctx, 3, 8, 10, M.deep);
  hline(ctx, 3, 10, 10, M.vein);
  rect(ctx, 4, 11, 8, 2, M.base);
  hline(ctx, 4, 12, 8, M.dark);
  // shaft neck
  rect(ctx, 5, 13, 6, 3, M.base);
  vline(ctx, 5, 13, 3, M.light);
  vline(ctx, 9, 13, 3, M.dark);
  vline(ctx, 10, 13, 3, M.deep);
}

const STATUE_TOP_TPL = [
  // denser hoplite: g=gold, o=outline, w=marble, l=light, s=shield, d=dark marble, c=crest
  "...g............",
  "...g..ooo.......",
  "...g.olwo.......",
  "...g.olwwo......",
  "...gc.lwwc......",
  "...gowwwwo......",
  "..oowlwwwwo.....",
  ".ossslwwwwdo....",
  ".ossslwwwwdo....",
  ".ossolwwwdo.....",
  "..oso.lwwdo.....",
  "...o..owwdo.....",
  "......ow.wo.....",
  ".....olw.wdo....",
  ".....lww.wwd....",
  "....owwoowwdo...",
];

function statueTop(ctx: Ctx) {
  // marble hoplite: raised spear, crest, round shield, multi-shade body
  const M = PAL.marble;
  const palMap: Record<string, string> = {
    o: M.deep,
    w: M.base,
    l: M.light,
    g: PAL.gold,
    s: mix(M.light, "#c8d0e0", 0.3),
    d: M.dark,
    c: mix(PAL.crimson, M.base, 0.2),
  };
  drawTemplate(ctx, STATUE_TOP_TPL, palMap);
  // shield boss + rim
  px(ctx, 2, 8, PAL.gold);
  px(ctx, 2, 9, M.dark);
  px(ctx, 1, 8, M.deep);
  // spear tip gleam
  px(ctx, 3, 0, PAL.goldL);
  px(ctx, 3, 1, PAL.gold);
  // face highlight
  px(ctx, 7, 3, M.light);
}

function statueBase(ctx: Ctx) {
  const M = PAL.marble;
  dropShadow(ctx, 8, 14.8, 7.5, 1.8);
  contactShadow(ctx, 1, 14, 14);
  rect(ctx, 3, 0, 10, 3, M.base);
  hline(ctx, 3, 0, 10, M.light);
  vline(ctx, 3, 0, 3, M.deep);
  vline(ctx, 12, 0, 3, M.deep);
  rect(ctx, 2, 3, 12, 2, M.light);
  hline(ctx, 2, 4, 12, M.vein);
  vline(ctx, 2, 3, 2, M.deep);
  vline(ctx, 13, 3, 2, M.deep);
  rect(ctx, 4, 5, 8, 7, M.base);
  vline(ctx, 4, 5, 7, M.light);
  vline(ctx, 3, 5, 7, M.deep);
  vline(ctx, 12, 5, 7, M.deep);
  vline(ctx, 11, 5, 7, M.dark);
  hline(ctx, 6, 7, 4, M.deep);
  hline(ctx, 6, 9, 4, M.vein);
  rect(ctx, 2, 12, 12, 2, M.base);
  hline(ctx, 2, 12, 12, M.light);
  hline(ctx, 2, 13, 12, M.deep);
  vline(ctx, 1, 12, 2, M.deep);
  vline(ctx, 14, 12, 2, M.deep);
  applySelectiveOutline(ctx, T);
}

function paintFountain(fctx: Ctx) {
  // 32x32 circular marble fountain with classical tiered basin + jet (DP density)
  const M = PAL.marble;
  const W = PAL.water;
  const cx = 16;
  const cy = 16;
  // soft cast shadow under basin
  dropShadow(fctx, 16, 28, 14, 3.5);
  contactShadow(fctx, 4, 29, 24);
  // outer basin water + thick marble rim
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      if (d < 15.2) {
        if (d > 12.2) {
          // double-bevel marble rim
          const lit = y < 15 && x < 18;
          if (d > 14.4) px(fctx, x, y, M.deep);
          else if (d > 13.4) px(fctx, x, y, lit ? M.light : M.dark);
          else px(fctx, x, y, lit ? mix(M.base, M.light, 0.4) : M.base);
        } else if (d > 10.5) {
          // dithered deep pool near rim
          const t = (d - 10.5) / 1.7;
          px(fctx, x, y, ditherPick(x, y, t, mix(W.base, W.dark, 0.2), mix(W.base, W.dark, 0.55)));
        } else {
          // dithered depth toward center
          const t = d / 10.5;
          px(fctx, x, y, ditherPick(x, y, 1 - t * 0.5, W.base, mix(W.base, W.light, 0.35)));
        }
      }
    }
  }
  // concentric ripple rings
  for (const rad of [9.2, 6.5, 4.0]) {
    for (let a = 0; a < 48; a++) {
      if (a % 3 === 0) continue;
      const ang = (a / 48) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * rad - 0.5);
      const y = Math.round(cy + Math.sin(ang) * rad - 0.5);
      px(fctx, x, y, a % 2 === 0 ? W.pale : W.light);
    }
  }
  // raised inner marble plinth (tier 2)
  rect(fctx, 12, 13, 8, 6, M.base);
  hline(fctx, 12, 13, 8, M.light);
  hline(fctx, 12, 18, 8, M.deep);
  vline(fctx, 12, 13, 6, M.light);
  vline(fctx, 19, 13, 6, M.dark);
  // fluted spout column
  rect(fctx, 14, 8, 4, 6, M.cream);
  vline(fctx, 14, 8, 6, M.light);
  vline(fctx, 15, 8, 6, M.base);
  vline(fctx, 16, 8, 6, M.vein);
  vline(fctx, 17, 8, 6, M.dark);
  // capital / bowl on spout
  rect(fctx, 13, 6, 6, 3, M.light);
  hline(fctx, 13, 6, 6, M.deep);
  hline(fctx, 13, 8, 6, M.dark);
  px(fctx, 14, 7, W.pale);
  px(fctx, 17, 7, W.pale);
  // water jet (sparkle column upward)
  const foam = mix(W.pale, PAL.snow.light, 0.35);
  px(fctx, 15, 5, W.pale);
  px(fctx, 16, 4, foam);
  px(fctx, 15, 3, W.pale);
  px(fctx, 16, 2, foam);
  px(fctx, 15, 4, W.light);
  px(fctx, 14, 5, W.light);
  px(fctx, 17, 5, W.light);
  // foam at base of jet
  px(fctx, 13, 10, W.pale);
  px(fctx, 18, 10, W.pale);
  px(fctx, 14, 11, foam);
  px(fctx, 17, 11, foam);
}

// ---------------------------------------------------------------------------
// scatter / decal painters (transparent BG — stamp over ground)
// ---------------------------------------------------------------------------

function decalPebbles(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 5; i++) {
    const x = 1 + Math.floor(r() * (T - 3));
    const y = 2 + Math.floor(r() * (T - 4));
    px(ctx, x, y, PAL.stone.dark);
    px(ctx, x + 1, y, PAL.stone.base);
    px(ctx, x, y + 1, PAL.stone.deep);
    if (r() < 0.5) px(ctx, x + 1, y + 1, PAL.stone.grout);
  }
}

function decalTuft(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(r() * (T - 5));
    const y = 4 + Math.floor(r() * (T - 6));
    px(ctx, x, y, PAL.grass.dark);
    px(ctx, x, y - 1, PAL.grass.base);
    px(ctx, x + 1, y - 1, PAL.grass.light);
    px(ctx, x - 1, y, PAL.grass.deep);
    px(ctx, x + 1, y + 1, STYLE.shadowSoft);
  }
}

function decalLeaf(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = 1 + Math.floor(r() * (T - 2));
    const y = 2 + Math.floor(r() * (T - 3));
    const c = r() < 0.5 ? PAL.canopy.dark : mix(PAL.canopy.base, PAL.dirt.dark, 0.3);
    px(ctx, x, y, c);
    px(ctx, x + 1, y, shade(c, 0.1));
    if (r() < 0.4) px(ctx, x, y + 1, shade(c, -0.15));
  }
}

function decalCracks(ctx: Ctx, seed: number) {
  const r = rng(seed);
  let x = 3 + Math.floor(r() * 6);
  let y = 2 + Math.floor(r() * 4);
  for (let i = 0; i < 8; i++) {
    px(ctx, x, y, PAL.marble.dark);
    if (r() < 0.5) px(ctx, x + 1, y, PAL.marble.vein);
    x += r() < 0.5 ? 1 : 0;
    y += r() < 0.7 ? 1 : 0;
    if (x >= T - 1 || y >= T - 1) break;
  }
}

function decalRubble(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = 1 + Math.floor(r() * (T - 4));
    const y = 3 + Math.floor(r() * (T - 5));
    rect(ctx, x, y, 2 + Math.floor(r() * 2), 1 + Math.floor(r() * 2), PAL.stone.dark);
    px(ctx, x, y, PAL.stone.light);
    px(ctx, x + 1, y + 1, PAL.stone.deep);
  }
}

function decalShell(ctx: Ctx, seed: number) {
  const r = rng(seed);
  const x = 4 + Math.floor(r() * 6);
  const y = 5 + Math.floor(r() * 5);
  px(ctx, x, y, PAL.sand.light);
  px(ctx, x + 1, y, PAL.marble.light);
  px(ctx, x, y + 1, PAL.sand.dark);
  px(ctx, x + 1, y + 1, PAL.marble.cream);
  px(ctx, x + 2, y, PAL.sand.deep);
}

function decalMoss(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(r() * T);
    const y = 6 + Math.floor(r() * 8);
    px(ctx, x, y, r() < 0.5 ? PAL.canopy.dark : PAL.canopy.base);
  }
}

function decalGravel(ctx: Ctx, seed: number) {
  const r = rng(seed);
  for (let i = 0; i < 10; i++) {
    px(
      ctx,
      Math.floor(r() * T),
      Math.floor(r() * T),
      r() < 0.5 ? PAL.stone.grout : mix(PAL.dirt.deep, PAL.stone.dark, 0.4)
    );
  }
}

function marbleFloor3(ctx: Ctx, seed: number) {
  // third marble variant — warmer cream, irregular blotches, no borders/lattice
  const r = rng(seed + 77);
  ditherVGradient(ctx, 0, 0, T, T, [
    mix(PAL.marble.light, PAL.goldL, 0.05),
    mix(PAL.marble.cream, PAL.marble.base, 0.45),
    mix(PAL.marble.base, PAL.marble.dark, 0.08),
  ]);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = ((x * 29 + y * 37 + seed * 4201) >>> 0) % 16;
      if (n === 0) px(ctx, x, y, mix(PAL.marble.base, PAL.marble.vein, 0.25));
      else if (n === 1) px(ctx, x, y, mix(PAL.marble.base, PAL.stone.base, 0.15));
      else if (n === 2) px(ctx, x, y, PAL.marble.light);
      else if (n === 3) px(ctx, x, y, mix(PAL.marble.cream, PAL.goldL, 0.08));
    }
  }
  for (let i = 0; i < 3; i++) {
    const cx = 3 + Math.floor(r() * 8);
    const cy = 3 + Math.floor(r() * 8);
    px(ctx, cx, cy, mix(PAL.marble.vein, PAL.marble.base, 0.45));
    px(ctx, cx + 1, cy, mix(PAL.marble.vein, PAL.marble.cream, 0.35));
    px(ctx, cx, cy + 1, mix(PAL.marble.base, PAL.marble.dark, 0.2));
  }
}

/** Map TerrainKind → base fill painter (variant 0). */
function terrainPainter(kind: TerrainKind, variant = 0): (c: Ctx) => void {
  switch (kind) {
    case TerrainKind.GRASS:
      return (c) => grass(c, 101 + variant * 97, variant > 1);
    case TerrainKind.DIRT:
      return (c) => dirtPath(c, 404 + variant * 53);
    case TerrainKind.SAND:
      return (c) => sandTile(c, 808 + variant * 41);
    case TerrainKind.STONE:
      return (c) => stoneRoad(c, 505 + variant * 61, variant % 2 === 1);
    case TerrainKind.MARBLE:
      if (variant === 1) return (c) => marbleChecker(c);
      if (variant >= 2) return (c) => marbleFloor3(c, 909 + variant);
      return (c) => marbleFloor(c, 707);
    case TerrainKind.WATER:
      return (c) => waterTile(c, variant);
    case TerrainKind.ROCK:
      return (c) => rockGround(c, 909 + variant * 17);
    case TerrainKind.SNOW:
      return (c) => snowTile(c, 111 + variant * 19);
    default:
      return (c) => grass(c, 1, false);
  }
}

// ---------------------------------------------------------------------------
// house (3-wide roof band + walls), painted as strips and sliced
// ---------------------------------------------------------------------------

function paintRoofBand(rctx: Ctx, w: number, upper: boolean) {
  const R = PAL.roof;
  // terracotta courses: scalloped tile rows every 4px
  rect(rctx, 0, 0, w, T, R.base);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    hline(rctx, 0, y, w, upper && row === 0 ? R.lighter : R.light);
    hline(rctx, 0, y + 3, w, R.dark);
    for (let x = 0; x < w; x += 4) {
      // scallop shadows marking individual tiles (staggered)
      const sx = x + (row % 2 === 0 ? 0 : 2);
      px(rctx, sx, y + 1, R.light);
      px(rctx, sx + 3, y + 2, R.deep);
      px(rctx, sx + 2, y + 3, R.deep);
    }
  }
  if (upper) {
    // ridge cap
    hline(rctx, 0, 0, w, R.deep);
    hline(rctx, 0, 1, w, R.lighter);
  } else {
    // eave shadow at bottom
    hline(rctx, 0, T - 2, w, R.deep);
    hline(rctx, 0, T - 1, w, PAL.crimsonD);
  }
  // side edges (rake) — gable trim
  vline(rctx, 0, 0, T, R.deep);
  vline(rctx, 1, 0, T, R.lighter);
  vline(rctx, w - 1, 0, T, R.deep);
  vline(rctx, w - 2, 0, T, R.dark);
}

function paintWallStrip(wctx: Ctx, w: number) {
  const M = PAL.marble;
  // stucco wall with frieze band on top and plinth at bottom
  rect(wctx, 0, 0, w, T, M.base);
  // frieze: crimson band with gold meander dashes
  rect(wctx, 0, 0, w, 3, PAL.crimson);
  hline(wctx, 0, 0, w, PAL.crimsonD);
  for (let x = 1; x < w; x += 4) {
    hline(wctx, x, 1, 2, PAL.gold);
  }
  hline(wctx, 0, 3, w, M.deep);
  // subtle wall shading
  hline(wctx, 0, 4, w, M.light);
  for (let x = 0; x < w; x += 5) {
    vline(wctx, x, 5, 8, M.vein);
  }
  // plinth
  hline(wctx, 0, T - 3, w, M.dark);
  rect(wctx, 0, T - 2, w, 2, M.cream);
  hline(wctx, 0, T - 1, w, M.deep);
}

function wallWindow(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const M = PAL.marble;
  // window opening
  rect(ctx, 5, 5, 6, 7, "#3c4660");
  rect(ctx, 6, 6, 4, 2, "#5a6a8c"); // glow top
  vline(ctx, 5, 5, 7, M.deep);
  vline(ctx, 10, 5, 7, M.deep);
  hline(ctx, 5, 5, 6, M.deep);
  hline(ctx, 4, 12, 8, M.light); // sill
  hline(ctx, 4, 13, 8, M.dark);
  hline(ctx, 4, 4, 8, M.light); // lintel
}

function wallColumn(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const M = PAL.marble;
  // engaged pilaster
  rect(ctx, 6, 3, 4, 11, M.light);
  vline(ctx, 7, 4, 10, M.base);
  vline(ctx, 9, 3, 11, M.dark);
  vline(ctx, 5, 3, 11, M.deep);
  vline(ctx, 10, 3, 11, M.deep);
  rect(ctx, 5, 3, 6, 1, M.light); // capital
  rect(ctx, 5, 13, 6, 1, M.light); // base
  hline(ctx, 5, 14, 6, M.deep);
}

function doorTile(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const D = PAL.door;
  const M = PAL.marble;
  // marble door frame
  rect(ctx, 3, 3, 10, 13, M.light);
  vline(ctx, 3, 3, 13, M.dark);
  vline(ctx, 12, 3, 13, M.deep);
  hline(ctx, 3, 3, 10, M.light);
  // arch shadow + wooden double door
  rect(ctx, 5, 5, 6, 11, D.dark);
  rect(ctx, 5, 6, 6, 10, D.wood);
  hline(ctx, 5, 5, 6, D.darker); // arch shadow
  hline(ctx, 5, 6, 6, D.darker);
  vline(ctx, 8, 6, 10, D.darker); // door split
  vline(ctx, 5, 6, 10, D.light);
  // plank lines
  vline(ctx, 6, 7, 9, D.dark);
  vline(ctx, 10, 7, 9, D.dark);
  // handles
  px(ctx, 7, 11, PAL.gold);
  px(ctx, 9, 11, PAL.gold);
  // threshold
  hline(ctx, 4, 15, 8, M.cream);
}

// ---------------------------------------------------------------------------
// temple pieces
// ---------------------------------------------------------------------------

function paintPediment(pctx: Ctx) {
  // 48x16 triangle pediment sliced into 3 tiles — apex at TOP center
  const M = PAL.marble;
  const apexX = 24;
  for (let y = 0; y < 16; y++) {
    // triangle widens downward from the apex
    const half = Math.max(1, (y / 15) * 24);
    const x0 = Math.round(apexX - half);
    const x1 = Math.round(apexX + half);
    hline(pctx, x0, y, x1 - x0, M.base);
    // raking cornice edges
    px(pctx, x0, y, M.deep);
    if (x0 + 1 < x1) px(pctx, x0 + 1, y, M.light);
    px(pctx, x1 - 1, y, M.deep);
    if (x1 - 2 > x0) px(pctx, x1 - 2, y, M.dark);
  }
  // tympanum (recessed crimson field), inset from the raking cornice
  for (let y = 5; y < 14; y++) {
    const half = (y / 15) * 24 - 4;
    if (half <= 1) continue;
    hline(pctx, Math.round(apexX - half), y, Math.round(half * 2), PAL.crimson);
    px(pctx, Math.round(apexX - half), y, PAL.crimsonD);
    px(pctx, Math.round(apexX + half) - 1, y, PAL.crimsonD);
  }
  // gold laurel emblem centered in the tympanum
  px(pctx, 22, 9, PAL.gold);
  px(pctx, 26, 9, PAL.gold);
  px(pctx, 21, 10, PAL.gold);
  px(pctx, 27, 10, PAL.gold);
  px(pctx, 22, 11, PAL.gold);
  px(pctx, 26, 11, PAL.gold);
  rect(pctx, 23, 12, 3, 1, PAL.goldL);
  // cornice base line with shadow
  hline(pctx, 0, 14, 48, M.light);
  hline(pctx, 0, 15, 48, M.deep);
}

function friezeTile(ctx: Ctx) {
  const M = PAL.marble;
  // entablature: architrave + triglyph frieze + cornice
  rect(ctx, 0, 0, T, T, M.base);
  hline(ctx, 0, 0, T, M.light);
  hline(ctx, 0, 1, T, M.light);
  hline(ctx, 0, 2, T, M.dark);
  // frieze band with triglyphs
  rect(ctx, 0, 3, T, 8, M.cream);
  for (let x = 1; x < T; x += 8) {
    rect(ctx, x, 4, 5, 6, M.base);
    vline(ctx, x + 1, 4, 6, M.deep);
    vline(ctx, x + 3, 4, 6, M.deep);
    vline(ctx, x, 4, 6, M.light);
  }
  hline(ctx, 0, 11, T, M.dark);
  // cornice
  rect(ctx, 0, 12, T, 2, M.light);
  hline(ctx, 0, 14, T, M.dark);
  hline(ctx, 0, 15, T, M.deep);
}

function templeColTop(ctx: Ctx) {
  const M = PAL.marble;
  // capital
  rect(ctx, 2, 0, 12, 2, M.light);
  hline(ctx, 2, 1, 12, M.vein);
  hline(ctx, 2, 2, 12, M.dark);
  rect(ctx, 3, 3, 10, 2, M.base);
  hline(ctx, 3, 4, 10, M.dark);
  // fluted shaft
  flutedShaft(ctx, 5);
}

function flutedShaft(ctx: Ctx, fromY: number) {
  const M = PAL.marble;
  rect(ctx, 4, fromY, 8, T - fromY, M.base);
  vline(ctx, 4, fromY, T - fromY, M.light);
  vline(ctx, 6, fromY, T - fromY, M.vein);
  vline(ctx, 8, fromY, T - fromY, M.light);
  vline(ctx, 9, fromY, T - fromY, M.vein);
  vline(ctx, 10, fromY, T - fromY, M.dark);
  vline(ctx, 11, fromY, T - fromY, M.deep);
  vline(ctx, 3, fromY, T - fromY, M.deep);
  vline(ctx, 12, fromY, T - fromY, M.deep);
}

function templeColMid(ctx: Ctx) {
  flutedShaft(ctx, 0);
}

function templeSteps(ctx: Ctx) {
  const M = PAL.marble;
  // three broad steps (walkable)
  for (let s = 0; s < 3; s++) {
    const y = s * 5;
    rect(ctx, 0, y, T, 4, s === 0 ? M.light : M.base);
    hline(ctx, 0, y, T, M.light);
    hline(ctx, 0, y + 4, T, M.deep);
  }
  hline(ctx, 0, 15, T, M.dark);
}

function cella(ctx: Ctx) {
  // shadowed temple interior behind the colonnade — makes white columns pop
  rect(ctx, 0, 0, T, T, "#4e4438");
  rect(ctx, 0, 0, T, 4, "#3c342a"); // deeper shadow under the entablature
  hline(ctx, 0, 4, T, "#463d31");
  // faint marble sheen deep inside
  hline(ctx, 2, 9, 3, "#5a5042");
  hline(ctx, 9, 11, 4, "#5a5042");
  hline(ctx, 5, 13, 3, "#5a5042");
  hline(ctx, 0, 15, T, "#352d23");
}

function templeFloor(ctx: Ctx, seed: number) {
  const r = rng(seed);
  const M = PAL.marble;
  rect(ctx, 0, 0, T, T, M.cream);
  hline(ctx, 0, 0, T, shade(M.cream, 0.1));
  // large slab joints
  hline(ctx, 0, 7, T, M.dark);
  vline(ctx, 7, 0, 8, M.dark);
  vline(ctx, 12, 8, 8, M.dark);
  for (let i = 0; i < 4; i++) {
    px(ctx, Math.floor(r() * T), Math.floor(r() * T), M.vein);
  }
}

// ---------------------------------------------------------------------------
// city wall & gate
// ---------------------------------------------------------------------------

function cityWallBody(ctx: Ctx, seed: number) {
  const C = PAL.cwall;
  const r = rng(seed);
  rect(ctx, 0, 0, T, T, C.base);
  // two chunky ashlar courses (8h each), blocks 8 wide, staggered joints
  for (let row = 0; row < 2; row++) {
    const y = row * 8;
    const shift = row % 2 === 0 ? 0 : 4;
    for (let col = -1; col < 3; col++) {
      const bx = col * 8 + shift;
      const tone = mix(C.base, C.light, r() * 0.5);
      rect(ctx, bx, y, 7, 7, tone);
      hline(ctx, bx, y, 7, shade(tone, 0.16)); // lit top edge
      vline(ctx, bx, y, 7, shade(tone, 0.1));
      hline(ctx, bx, y + 6, 7, C.dark); // lower edge
      vline(ctx, bx + 6, y + 1, 6, C.dark);
      // mortar joint right of block
      vline(ctx, bx + 7, y, 7, C.mortar);
      if (r() < 0.45) px(ctx, bx + 2 + Math.floor(r() * 4), y + 2 + Math.floor(r() * 3), C.dark);
    }
    // mortar shadow line between courses
    hline(ctx, 0, y + 7, T, C.deep);
  }
}

function cityWallTop(ctx: Ctx) {
  const C = PAL.cwall;
  // crenellated parapet: chunky merlons (5 wide) on transparent sky
  for (const mx of [0, 8]) {
    rect(ctx, mx, 1, 5, 9, C.base);
    hline(ctx, mx, 1, 5, shade(C.light, 0.2)); // strong lit cap
    hline(ctx, mx, 2, 5, C.light);
    vline(ctx, mx, 1, 9, C.light);
    vline(ctx, mx + 4, 2, 8, C.deep);
    hline(ctx, mx + 1, 9, 4, C.deep);
    px(ctx, mx + 2, 5, C.dark); // weathering
  }
  // deep shadow in the embrasure gaps
  rect(ctx, 5, 7, 3, 3, "rgba(50,42,28,0.45)");
  rect(ctx, 13, 7, 3, 3, "rgba(50,42,28,0.45)");
  // parapet walkway
  rect(ctx, 0, 10, T, 3, C.light);
  hline(ctx, 0, 10, T, shade(C.light, 0.18));
  hline(ctx, 0, 12, T, C.mortar);
  rect(ctx, 0, 13, T, 3, C.base);
  hline(ctx, 0, 13, T, C.dark);
  hline(ctx, 0, 15, T, C.deep);
}

function gateTop(ctx: Ctx) {
  // arch crown: wall body with a dark arch opening cut from the bottom center
  cityWallBody(ctx, 88);
  const C = PAL.cwall;
  // opening (rounded arch)
  rect(ctx, 4, 8, 8, 8, "#241f18");
  rect(ctx, 3, 10, 10, 6, "#241f18");
  px(ctx, 4, 8, C.dark);
  px(ctx, 11, 8, C.dark);
  // voussoir stones around the arc
  px(ctx, 3, 9, C.deep);
  px(ctx, 12, 9, C.deep);
  hline(ctx, 4, 7, 8, C.deep);
  px(ctx, 3, 8, C.deep);
  px(ctx, 12, 8, C.deep);
  vline(ctx, 2, 10, 6, C.deep);
  vline(ctx, 13, 10, 6, C.deep);
  // keystone
  rect(ctx, 7, 5, 2, 3, C.light);
  vline(ctx, 6, 5, 3, C.dark);
  vline(ctx, 9, 5, 3, C.dark);
}

function gateSide(ctx: Ctx, left: boolean) {
  cityWallBody(ctx, 77);
  const C = PAL.cwall;
  // inner arch curve + wooden gate leaf
  const D = PAL.door;
  if (left) {
    rect(ctx, 10, 4, 6, 12, D.dark);
    rect(ctx, 11, 6, 5, 10, D.wood);
    vline(ctx, 12, 6, 10, D.dark);
    vline(ctx, 14, 6, 10, D.dark);
    px(ctx, 15, 11, PAL.gold);
    // arch stones
    px(ctx, 10, 4, C.deep);
    px(ctx, 11, 3, C.deep);
    vline(ctx, 10, 5, 11, C.deep);
    px(ctx, 12, 2, C.deep);
  } else {
    rect(ctx, 0, 4, 6, 12, D.dark);
    rect(ctx, 0, 6, 5, 10, D.wood);
    vline(ctx, 1, 6, 10, D.dark);
    vline(ctx, 3, 6, 10, D.dark);
    px(ctx, 0, 11, PAL.gold);
    px(ctx, 5, 4, C.deep);
    px(ctx, 4, 3, C.deep);
    vline(ctx, 5, 5, 11, C.deep);
    px(ctx, 3, 2, C.deep);
  }
}

function gateOpen(ctx: Ctx) {
  // open passage: stone road in shadow
  stoneRoad(ctx, 55, true);
  // shadow gradient from the arch above
  rect(ctx, 0, 0, T, 3, "rgba(20,18,26,0.7)");
  rect(ctx, 0, 3, T, 2, "rgba(20,18,26,0.45)");
  rect(ctx, 0, 5, T, 2, "rgba(20,18,26,0.25)");
  // arch corners
  px(ctx, 0, 0, PAL.cwall.deep);
  px(ctx, 1, 0, PAL.cwall.deep);
  px(ctx, 15, 0, PAL.cwall.deep);
  px(ctx, 14, 0, PAL.cwall.deep);
}

// ---------------------------------------------------------------------------
// cliffs
// ---------------------------------------------------------------------------

function cliffFace(ctx: Ctx, seed: number) {
  const R = PAL.rock;
  const r = rng(seed);
  rect(ctx, 0, 0, T, T, R.base);
  hline(ctx, 0, 0, T, R.light); // lit top edge
  hline(ctx, 0, 1, T, R.light);
  // vertical crevices
  for (const cx of [3, 8, 13]) {
    vline(ctx, cx, 2 + Math.floor(r() * 2), 12, R.deep);
    vline(ctx, cx + 1, 3, 10, R.dark);
  }
  // ledges
  hline(ctx, 0, 6, 6, R.dark);
  hline(ctx, 9, 9, 7, R.dark);
  hline(ctx, 2, 12, 8, R.dark);
  hline(ctx, 0, 15, T, R.deep);
}

function cliffTop(ctx: Ctx, seed: number) {
  rockGround(ctx, seed);
  const R = PAL.rock;
  hline(ctx, 0, T - 2, T, R.light);
  hline(ctx, 0, T - 1, T, R.deep);
}

// ---------------------------------------------------------------------------
// interior
// ---------------------------------------------------------------------------

function interiorWall(ctx: Ctx) {
  const I = PAL.interior;
  rect(ctx, 0, 0, T, T, I.wallTop);
  hline(ctx, 0, 0, T, shade(I.wallTop, -0.25));
  hline(ctx, 0, 1, T, shade(I.wallTop, 0.12));
  // crimson trim line
  hline(ctx, 0, 8, T, PAL.crimson);
  // wood wainscot
  rect(ctx, 0, 9, T, 7, I.panel);
  hline(ctx, 0, 9, T, shade(I.panel, 0.2));
  for (let x = 0; x < T; x += 4) vline(ctx, x, 10, 6, I.panelD);
  hline(ctx, 0, 15, T, shade(I.panelD, -0.3));
}

function rug(ctx: Ctx) {
  rect(ctx, 1, 1, 14, 14, PAL.crimson);
  // border
  hline(ctx, 1, 1, 14, PAL.crimsonD);
  hline(ctx, 1, 14, 14, PAL.crimsonD);
  vline(ctx, 1, 1, 14, PAL.crimsonD);
  vline(ctx, 14, 1, 14, PAL.crimsonD);
  hline(ctx, 3, 3, 10, PAL.gold);
  hline(ctx, 3, 12, 10, PAL.gold);
  vline(ctx, 3, 3, 10, PAL.gold);
  vline(ctx, 12, 3, 10, PAL.gold);
  // center diamond
  px(ctx, 7, 7, PAL.goldL);
  px(ctx, 8, 7, PAL.goldL);
  px(ctx, 7, 8, PAL.goldL);
  px(ctx, 8, 8, PAL.goldL);
  px(ctx, 6, 7, PAL.gold);
  px(ctx, 9, 8, PAL.gold);
  px(ctx, 7, 6, PAL.gold);
  px(ctx, 8, 9, PAL.gold);
}

function table(ctx: Ctx) {
  const W = PAL.wood;
  dropShadow(ctx, 8, 13.5, 7, 1.8);
  contactShadow(ctx, 2, 13, 12);
  rect(ctx, 2, 3, 12, 9, W.base);
  hline(ctx, 2, 3, 12, W.light);
  vline(ctx, 2, 3, 9, W.light);
  hline(ctx, 2, 11, 12, W.seam);
  vline(ctx, 13, 4, 8, W.dark);
  hline(ctx, 4, 6, 8, W.dark);
  hline(ctx, 5, 8, 6, W.dark);
  px(ctx, 3, 12, W.seam);
  px(ctx, 12, 12, W.seam);
  applySelectiveOutline(ctx, T);
}

function amphora(ctx: Ctx) {
  const A = { base: "#a86240", light: "#c08058", dark: "#7e4a30", deep: "#5c3420" };
  dropShadow(ctx, 8, 15, 4.5, 1.4);
  contactShadow(ctx, 5, 15, 6);
  rect(ctx, 6, 3, 4, 1, A.base);
  hline(ctx, 6, 2, 4, A.deep);
  rect(ctx, 7, 4, 2, 2, A.base);
  rect(ctx, 5, 6, 6, 5, A.base);
  rect(ctx, 6, 11, 4, 2, A.base);
  rect(ctx, 7, 13, 2, 1, A.base);
  hline(ctx, 6, 14, 4, A.deep);
  px(ctx, 4, 5, A.dark);
  px(ctx, 4, 6, A.dark);
  px(ctx, 11, 5, A.dark);
  px(ctx, 11, 6, A.dark);
  vline(ctx, 5, 6, 5, A.light);
  vline(ctx, 6, 4, 9, A.light);
  vline(ctx, 10, 6, 5, A.deep);
  hline(ctx, 5, 8, 6, PAL.gold);
  px(ctx, 6, 9, PAL.gold);
  px(ctx, 8, 9, PAL.gold);
  applySelectiveOutline(ctx, T);
}

function bed(ctx: Ctx) {
  const W = PAL.wood;
  dropShadow(ctx, 8, 15, 7, 1.5);
  contactShadow(ctx, 2, 15, 12);
  rect(ctx, 2, 1, 12, 14, W.dark);
  rect(ctx, 3, 2, 10, 12, PAL.marble.cream);
  rect(ctx, 4, 3, 8, 3, PAL.marble.light);
  hline(ctx, 4, 5, 8, PAL.marble.vein);
  rect(ctx, 3, 7, 10, 7, PAL.crimson);
  hline(ctx, 3, 7, 10, PAL.crimsonD);
  hline(ctx, 3, 9, 10, PAL.gold);
  hline(ctx, 3, 13, 10, PAL.crimsonD);
  hline(ctx, 2, 1, 12, W.light);
  hline(ctx, 2, 14, 12, W.seam);
  applySelectiveOutline(ctx, T);
}

function banner(ctx: Ctx) {
  // hanging crimson banner from a gold rod (overhead deco)
  hline(ctx, 2, 1, 12, PAL.gold);
  px(ctx, 2, 0, PAL.goldL);
  px(ctx, 13, 0, PAL.goldL);
  rect(ctx, 4, 2, 8, 10, PAL.crimson);
  vline(ctx, 4, 2, 10, PAL.crimsonD);
  vline(ctx, 11, 2, 10, PAL.crimsonD);
  hline(ctx, 4, 2, 8, shade(PAL.crimson, 0.15));
  // swallowtail
  rect(ctx, 4, 12, 3, 2, PAL.crimson);
  rect(ctx, 9, 12, 3, 2, PAL.crimson);
  px(ctx, 4, 14, PAL.crimsonD);
  px(ctx, 6, 12, PAL.crimsonD);
  px(ctx, 9, 12, PAL.crimsonD);
  px(ctx, 11, 14, PAL.crimsonD);
  // gold laurel emblem
  px(ctx, 6, 5, PAL.gold);
  px(ctx, 9, 5, PAL.gold);
  px(ctx, 5, 6, PAL.gold);
  px(ctx, 10, 6, PAL.gold);
  px(ctx, 6, 8, PAL.gold);
  px(ctx, 9, 8, PAL.gold);
  hline(ctx, 7, 9, 2, PAL.goldL);
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

function main() {
  const cols = TILESET_COLS;
  const rows = Math.ceil(Tile.COUNT / cols);
  const { canvas, ctx } = makeCanvas(cols * T, rows * T);
  // Enforce nearest-neighbor everywhere
  ctx.imageSmoothingEnabled = false;

  // strip canvases for multi-tile structures
  const roofUpper = makeCanvas(48, T);
  paintRoofBand(roofUpper.ctx, 48, true);
  const roofLower = makeCanvas(48, T);
  paintRoofBand(roofLower.ctx, 48, false);
  const pediment = makeCanvas(48, T);
  paintPediment(pediment.ctx);
  const fountain = makeCanvas(32, 32);
  paintFountain(fountain.ctx);

  const at = (tile: number): [number, number] => [(tile % cols) * T, Math.floor(tile / cols) * T];

  const blit = (tile: number, src: Canvas, sx: number, sy: number) => {
    const [dx, dy] = at(tile);
    ctx.drawImage(src, sx, sy, T, T, dx, dy, T, T);
  };

  const paint = (tile: number, fn: (c: Ctx) => void, style = true) => {
    const [dx, dy] = at(tile);
    const tmp = makeCanvas(T, T);
    fn(tmp.ctx);
    if (style) {
      applyDirectionalLight(tmp.ctx, T, 0.1);
      applyDesaturate(tmp.ctx, T, 0.12);
    }
    ctx.drawImage(tmp.canvas, dx, dy);
  };

  paint(Tile.GRASS, (c) => grass(c, 101, false));
  paint(Tile.GRASS2, (c) => grass(c, 202, false));
  paint(Tile.GRASS3, (c) => grass(c, 303, true));
  paint(Tile.GRASS4, (c) => grass(c, 404, true));
  paint(Tile.TALL_GRASS, (c) => tallGrass(c));
  paint(Tile.DIRT_PATH, (c) => dirtPath(c, 404));
  paint(Tile.DIRT_PATH2, (c) => dirtPath(c, 505));
  paint(Tile.DIRT_PATH3, (c) => dirtPath(c, 606));
  paint(Tile.STONE_ROAD, (c) => stoneRoad(c, 505, false));
  paint(Tile.STONE_ROAD2, (c) => stoneRoad(c, 606, true));
  paint(Tile.STONE_ROAD3, (c) => stoneRoad(c, 707, false));
  paint(Tile.MARBLE_FLOOR, (c) => marbleFloor(c, 707));
  paint(Tile.MARBLE_FLOOR2, (c) => marbleChecker(c));
  paint(Tile.MARBLE_FLOOR3, (c) => marbleFloor3(c, 808));
  paint(Tile.SAND, (c) => sandTile(c, 808));
  paint(Tile.SAND2, (c) => sandTile(c, 909));
  paint(Tile.SAND3, (c) => sandTile(c, 1010));
  paint(Tile.WATER, (c) => waterTile(c, 0));
  paint(Tile.WATER2, (c) => waterTile(c, 1));
  paint(Tile.WATER3, (c) => waterTile(c, 2));
  paint(Tile.WATER_SHORE, (c) => waterShore(c));
  paint(Tile.ROCK_GROUND, (c) => rockGround(c, 909));
  paint(Tile.ROCK_GROUND2, (c) => rockGround(c, 1011));
  paint(Tile.ROCK_GROUND3, (c) => rockGround(c, 1112));
  paint(Tile.SNOW, (c) => snowTile(c, 111));
  paint(Tile.SNOW2, (c) => snowTile(c, 222));
  paint(Tile.FLOOR_WOOD, (c) => woodFloor(c, 121));

  paint(Tile.FLOWERS_RED, (c) => flowers(c, desaturate("#c05048", 0.15), desaturate("#d87868", 0.1)));
  paint(Tile.FLOWERS_GOLD, (c) => flowers(c, PAL.gold, PAL.goldL));
  paint(Tile.BUSH, (c) => bush(c), false);
  paint(Tile.BOULDER, (c) => boulder(c), false);
  paint(Tile.TREE_TRUNK, (c) => treeTrunk(c), false);
  paint(Tile.PILLAR, (c) => pillarSingle(c), false);
  paint(Tile.COLUMN_BASE, (c) => columnBase(c), false);
  paint(Tile.STATUE_BASE, (c) => statueBase(c), false);

  blit(Tile.FOUNTAIN_NW, fountain.canvas, 0, 0);
  blit(Tile.FOUNTAIN_NE, fountain.canvas, 16, 0);
  blit(Tile.FOUNTAIN_SW, fountain.canvas, 0, 16);
  blit(Tile.FOUNTAIN_SE, fountain.canvas, 16, 16);

  blit(Tile.H_ROOF_NW, roofUpper.canvas, 0, 0);
  blit(Tile.H_ROOF_N, roofUpper.canvas, 16, 0);
  blit(Tile.H_ROOF_NE, roofUpper.canvas, 32, 0);
  blit(Tile.H_ROOF_W, roofLower.canvas, 0, 0);
  blit(Tile.H_ROOF_M, roofLower.canvas, 16, 0);
  blit(Tile.H_ROOF_E, roofLower.canvas, 32, 0);
  paint(Tile.H_WALL, (c) => paintWallStrip(c, T));
  paint(Tile.H_WALL_WIN, (c) => wallWindow(c));
  paint(Tile.H_DOOR, (c) => doorTile(c));
  paint(Tile.H_WALL_COL, (c) => wallColumn(c));

  blit(Tile.T_PED_W, pediment.canvas, 0, 0);
  blit(Tile.T_PED_M, pediment.canvas, 16, 0);
  blit(Tile.T_PED_E, pediment.canvas, 32, 0);
  paint(Tile.T_FRIEZE, (c) => friezeTile(c));
  paint(Tile.T_COL_TOP, (c) => templeColTop(c));
  paint(Tile.T_COL_MID, (c) => templeColMid(c));
  paint(Tile.T_STEPS, (c) => templeSteps(c));
  paint(Tile.T_FLOOR, (c) => templeFloor(c, 131));

  paint(Tile.W_TOP, (c) => cityWallTop(c));
  paint(Tile.W_BODY, (c) => cityWallBody(c, 141));
  paint(Tile.W_GATE_L, (c) => gateSide(c, true));
  paint(Tile.W_GATE_R, (c) => gateSide(c, false));
  paint(Tile.W_GATE_OPEN, (c) => gateOpen(c));
  paint(Tile.W_GATE_TOP, (c) => gateTop(c));
  paint(Tile.T_CELLA, (c) => cella(c));

  paint(Tile.TREE_CANOPY, (c) => {
    treeCanopy(c);
    applySelectiveOutline(c, T);
  }, false);
  paint(Tile.COLUMN_TOP, (c) => {
    columnTop(c);
    applySelectiveOutline(c, T);
  }, false);
  paint(Tile.STATUE_TOP, (c) => {
    statueTop(c);
    applySelectiveOutline(c, T);
  }, false);
  paint(Tile.BANNER, (c) => banner(c));

  paint(Tile.CLIFF_FACE, (c) => cliffFace(c, 151));
  paint(Tile.CLIFF_TOP, (c) => cliffTop(c, 161));

  paint(Tile.I_WALL, (c) => interiorWall(c));
  paint(Tile.RUG, (c) => rug(c));
  paint(Tile.TABLE, (c) => table(c), false);
  paint(Tile.AMPHORA, (c) => amphora(c), false);
  paint(Tile.BED, (c) => bed(c), false);

  // scatter decals
  paint(Tile.DECAL_PEBBLES, (c) => decalPebbles(c, 1001), false);
  paint(Tile.DECAL_PEBBLES2, (c) => decalPebbles(c, 1002), false);
  paint(Tile.DECAL_TUFT, (c) => decalTuft(c, 1003), false);
  paint(Tile.DECAL_TUFT2, (c) => decalTuft(c, 1004), false);
  paint(Tile.DECAL_LEAF, (c) => decalLeaf(c, 1005), false);
  paint(Tile.DECAL_CRACKS, (c) => decalCracks(c, 1006), false);
  paint(Tile.DECAL_RUBBLE, (c) => decalRubble(c, 1007), false);
  paint(Tile.DECAL_SHELL, (c) => decalShell(c, 1008), false);
  paint(Tile.DECAL_MOSS, (c) => decalMoss(c, 1009), false);
  paint(Tile.DECAL_GRAVEL, (c) => decalGravel(c, 1010), false);

  // 48-tile blob transitions for every major terrain pair
  console.log(`painting ${TRANSITION_PAIR_COUNT} transition pairs × ${BLOB_TILE_COUNT} blobs...`);
  for (let pairId = 0; pairId < TRANSITION_PAIR_COUNT; pairId++) {
    const pair = TRANSITION_PAIRS[pairId];
    const paintBg = terrainPainter(pair.bg, 0);
    const paintFg = terrainPainter(pair.fg, 0);
    for (let bi = 0; bi < BLOB_TILE_COUNT; bi++) {
      const mask = bi < BLOB_MASKS_47.length ? BLOB_MASKS_47[bi] : BLOB_MASK_ALL;
      const tile = transitionTileIndex(pairId, bi);
      paint(
        tile,
        (c) => {
          paintBlobTransition(c, mask, paintBg, paintFg, T, blobCoverageAt);
        },
        true
      );
    }
  }

  // DP density pass: micro shade + ordered dither on every opaque pixel
  {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const r = rng(0xda1f0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const n = (r() - 0.5) * 8;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.9));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.8));
      const x = (i / 4) % canvas.width;
      const y = ((i / 4) / canvas.width) | 0;
      const bayer = ((x & 1) ^ (y & 1)) * 2.5 - 1.25;
      d[i] = Math.max(0, Math.min(255, d[i] + bayer));
      // mild desat
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i] + (L - d[i]) * 0.06;
      d[i + 1] = d[i + 1] + (L - d[i + 1]) * 0.06;
      d[i + 2] = d[i + 2] + (L - d[i + 2]) * 0.06;
    }
    ctx.putImageData(img, 0, 0);
  }

  // write tileset
  const outDir = join(ROOT, "apps/client/public/assets");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "tileset.png"), canvas.toBuffer("image/png"));

  // labeled 4x contact sheet — sample key tiles + first transition pair (not all 758)
  const SCALE = 4;
  const sampleIds: number[] = [];
  for (let id = 0; id < Math.min(86, Tile.COUNT); id++) sampleIds.push(id);
  // first pair full 48 + a few other pairs' interiors
  for (let bi = 0; bi < BLOB_TILE_COUNT; bi++) sampleIds.push(transitionTileIndex(0, bi));
  for (const pairId of [2, 4, 6, 9]) {
    sampleIds.push(transitionTileIndex(pairId, 0));
    sampleIds.push(transitionTileIndex(pairId, 1));
    sampleIds.push(transitionTileIndex(pairId, maskToSampleInterior()));
  }
  const cell = T * SCALE + 18;
  const perRow = 12;
  const sheetRows = Math.ceil(sampleIds.length / perRow);
  const sheet = makeCanvas(perRow * cell + 8, sheetRows * cell + 8);
  sheet.ctx.imageSmoothingEnabled = false;
  sheet.ctx.fillStyle = "#242230";
  sheet.ctx.fillRect(0, 0, sheet.canvas.width, sheet.canvas.height);
  const scaled = scaleCanvas(canvas, SCALE);
  sampleIds.forEach((id, n) => {
    const gx = (n % perRow) * cell + 8;
    const gy = Math.floor(n / perRow) * cell + 8;
    const [sx, sy] = at(id);
    for (let cy2 = 0; cy2 < T; cy2 += 4) {
      for (let cx2 = 0; cx2 < T; cx2 += 4) {
        sheet.ctx.fillStyle = ((cx2 + cy2) / 4) % 2 === 0 ? "#38343f" : "#302c38";
        sheet.ctx.fillRect(gx + cx2 * SCALE, gy + cy2 * SCALE, 4 * SCALE, 4 * SCALE);
      }
    }
    sheet.ctx.drawImage(scaled, sx * SCALE, sy * SCALE, T * SCALE, T * SCALE, gx, gy, T * SCALE, T * SCALE);
    sheet.ctx.fillStyle = "#cfc8b8";
    sheet.ctx.font = "8px Menlo";
    sheet.ctx.fillText(String(id), gx, gy + T * SCALE + 10);
  });
  mkdirSync(join(ROOT, "preview"), { recursive: true });
  writeFileSync(join(ROOT, "preview/tileset-preview.png"), sheet.canvas.toBuffer("image/png"));

  console.log(`tileset: ${cols * T}x${rows * T} (${Tile.COUNT} tiles, ${TRANSITION_PAIR_COUNT} pairs) -> apps/client/public/assets/tileset.png`);
  console.log("preview: preview/tileset-preview.png");
}

function maskToSampleInterior(): number {
  // blob index for ALL mask
  return BLOB_MASKS_47.indexOf(BLOB_MASK_ALL);
}

main();
