/**
 * Generates the Dominion tileset (16×16 tiles, Pokémon-DS / DP inspired,
 * Greco-Roman capital theme) plus a labeled 4× preview contact sheet.
 *
 * Graphics rules (Steps 2–5):
 * - Single global ≤48 color palette; painters only select ramp entries.
 * - No paint-time mix()/shade()/desaturate() producing new colors.
 * - Ground detail via ≤12 authored stamps (no per-pixel scatter noise).
 * - Ground stays in a narrow value band; props get full form shading.
 * - Props: 3/4 top-down, selective outline (ramp darkest), elliptical contact shadow, ≥3 ramp values.
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
  drawTemplate,
  Ctx,
  STYLE,
  dropShadow,
  contactShadow,
  applySelectiveOutline,
  paintBlobTransition,
} from "./pixel.js";
import { PAL, P, RAMPS, GLOBAL_PALETTE_LIST } from "./palette.js";
import { paintGroundWithStamps, placeStamps } from "./stamps.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = TILE_SIZE; // 16

// Re-export palette size for tests
export { GLOBAL_PALETTE_LIST, RAMPS, PAL };

// ---------------------------------------------------------------------------
// terrain painters — quiet fills + stamps only
// ---------------------------------------------------------------------------

function grass(ctx: Ctx, seed: number, _lushDots: boolean) {
  const r = rng(seed);
  paintGroundWithStamps(ctx, RAMPS.grass, r, {
    baseIdx: 2,
    topIdx: 3,
    botIdx: 1,
    stampNames: ["grass_tuft", "grass_blade", "moss", "dot_cluster"],
    countMin: 3,
    countMax: 6,
  });
}

function tallGrass(ctx: Ctx) {
  const R = RAMPS.tall;
  rect(ctx, 0, 0, T, T, R[1]!);
  // authored tufts (not scatter)
  const tuft = (cx: number, baseY: number) => {
    vline(ctx, cx, baseY - 5, 5, R[2]!);
    px(ctx, cx, baseY - 6, R[4]!);
    vline(ctx, cx - 2, baseY - 3, 3, R[0]!);
    px(ctx, cx - 2, baseY - 4, R[2]!);
    px(ctx, cx - 1, baseY - 2, R[0]!);
    vline(ctx, cx + 2, baseY - 4, 4, R[3]!);
    px(ctx, cx + 2, baseY - 5, R[4]!);
    px(ctx, cx + 1, baseY - 2, R[2]!);
    hline(ctx, cx - 2, baseY, 5, R[0]!);
  };
  tuft(3, 7);
  tuft(11, 8);
  tuft(7, 15);
  tuft(14, 15);
  tuft(1, 15);
}

function dirtPath(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.dirt, rng(seed), {
    baseIdx: 2,
    topIdx: 3,
    botIdx: 1,
    stampNames: ["pebble", "gravel", "wear", "dot_cluster"],
    countMin: 3,
    countMax: 5,
  });
}

function stoneRoad(ctx: Ctx, seed: number, offset: boolean) {
  // Quiet cobbles: 3-stop band only (ground value hierarchy)
  const r = rng(seed);
  paintGroundWithStamps(ctx, RAMPS.stone, r, {
    stampNames: ["pebble", "wear", "gravel"],
    countMin: 3,
    countMax: 5,
  });
  // subtle block joints using band shadow only (contiguous lines, no orphans)
  const band = RAMPS.stone;
  const joint = band[1]!;
  for (let row = 0; row < 4; row++) {
    const sy = row * 4 + 3;
    if (sy < T) hline(ctx, 0, sy, T, joint);
    const shift = offset && row % 2 === 1 ? 2 : 0;
    for (let col = 0; col < 4; col++) {
      const sx = col * 4 + shift + 3;
      if (sx >= 0 && sx < T) vline(ctx, sx, row * 4, 3, joint);
    }
  }
}

function marbleFloor(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.marble, rng(seed), {
    baseIdx: 3,
    topIdx: 4,
    botIdx: 2,
    stampNames: ["vein", "wear", "crack", "dot_cluster"],
    countMin: 3,
    countMax: 5,
  });
}

function marbleChecker(ctx: Ctx) {
  // cooler alternate — more dark vein stamps
  paintGroundWithStamps(ctx, RAMPS.marble, rng(818), {
    baseIdx: 2,
    topIdx: 3,
    botIdx: 1,
    stampNames: ["vein", "crack", "wear"],
    countMin: 3,
    countMax: 5,
  });
}

function marbleFloor3(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.marble, rng(seed + 77), {
    baseIdx: 3,
    topIdx: 4,
    botIdx: 2,
    stampNames: ["vein", "dot_cluster", "wear"],
    countMin: 3,
    countMax: 4,
  });
}

function sandTile(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.sand, rng(seed), {
    baseIdx: 2,
    topIdx: 3,
    botIdx: 1,
    stampNames: ["ripple", "pebble", "dot_cluster"],
    countMin: 3,
    countMax: 5,
  });
}

function waterTile(ctx: Ctx, phase: number) {
  paintGroundWithStamps(ctx, RAMPS.water, rng(900 + phase * 17), {
    stampNames: ["ripple", "sparkle", "dot_cluster"],
    countMin: 3,
    countMax: 5,
  });
}

function waterShore(ctx: Ctx) {
  paintGroundWithStamps(ctx, RAMPS.water, rng(44), {
    stampNames: ["ripple", "sparkle"],
    countMin: 3,
    countMax: 4,
  });
}

function rockGround(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.rock, rng(seed), {
    baseIdx: 2,
    topIdx: 3,
    botIdx: 1,
    stampNames: ["pebble", "crack", "gravel"],
    countMin: 3,
    countMax: 5,
  });
}

function snowTile(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.snow, rng(seed), {
    baseIdx: 1,
    topIdx: 2,
    botIdx: 0,
    stampNames: ["dot_cluster", "wear", "pebble"],
    countMin: 3,
    countMax: 4,
  });
}

function woodFloor(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.wood, rng(seed), {
    stampNames: ["wear", "dot_cluster"],
    countMin: 3,
    countMax: 4,
  });
  // plank seams in band shadow (contiguous)
  const seam = RAMPS.wood[1]!;
  for (let row = 0; row < 4; row++) {
    hline(ctx, 0, row * 4 + 3, T, seam);
  }
}

// ---------------------------------------------------------------------------
// deco painters
// ---------------------------------------------------------------------------

function flowers(ctx: Ctx, color: string, colorLight: string) {
  const flower = (cx: number, cy: number) => {
    px(ctx, cx, cy - 1, color);
    px(ctx, cx, cy + 1, color);
    px(ctx, cx - 1, cy, color);
    px(ctx, cx + 1, cy, color);
    px(ctx, cx - 1, cy - 1, colorLight);
    px(ctx, cx, cy, PAL.goldL);
    px(ctx, cx + 1, cy + 2, PAL.grass.deep);
    px(ctx, cx - 2, cy + 1, PAL.grass.deep);
  };
  flower(4, 4);
  flower(11, 7);
  flower(5, 12);
}

function bush(ctx: Ctx) {
  const C = PAL.canopy;
  dropShadow(ctx, 8, 14.5, 6, 1.6);
  contactShadow(ctx, 3, 14, 10);
  // volume: lit top-left, mid front
  rect(ctx, 3, 4, 10, 9, C.base);
  rect(ctx, 4, 3, 8, 3, C.light);
  rect(ctx, 2, 6, 3, 5, C.dark);
  rect(ctx, 11, 7, 3, 5, C.deep);
  px(ctx, 5, 2, C.lush);
  px(ctx, 8, 2, C.light);
  rect(ctx, 5, 8, 4, 3, C.dark);
  applySelectiveOutline(ctx, T, C.deep);
}

function boulder(ctx: Ctx) {
  const R = PAL.rock;
  dropShadow(ctx, 8, 14, 6, 1.5);
  contactShadow(ctx, 3, 13, 10);
  // 3/4 rock volume
  rect(ctx, 3, 5, 10, 8, R.base);
  rect(ctx, 4, 4, 8, 3, R.light); // top face
  rect(ctx, 3, 9, 4, 4, R.dark); // front-left mid
  rect(ctx, 10, 8, 3, 5, R.deep); // right shadow
  px(ctx, 6, 6, R.light);
  px(ctx, 8, 10, R.dark);
  applySelectiveOutline(ctx, T, R.deep);
}

function treeTrunk(ctx: Ctx) {
  const Tr = PAL.trunk;
  dropShadow(ctx, 8, 15, 5, 1.4);
  contactShadow(ctx, 2, 15, 12);
  rect(ctx, 5, 0, 6, 14, Tr.base);
  vline(ctx, 5, 0, 14, Tr.light);
  vline(ctx, 6, 0, 14, Tr.base);
  vline(ctx, 9, 0, 14, Tr.dark);
  vline(ctx, 10, 0, 14, Tr.deep);
  rect(ctx, 4, 12, 8, 3, Tr.dark);
  hline(ctx, 4, 12, 8, Tr.base);
  applySelectiveOutline(ctx, T, Tr.deep);
}

function treeCanopy(ctx: Ctx) {
  const C = PAL.canopy;
  // dense clumps with form shading
  rect(ctx, 1, 2, 14, 12, C.base);
  rect(ctx, 2, 1, 10, 4, C.light);
  rect(ctx, 1, 6, 5, 6, C.dark);
  rect(ctx, 10, 7, 5, 6, C.deep);
  px(ctx, 5, 1, C.lush);
  rect(ctx, 4, 3, 2, 2, C.lush);
  rect(ctx, 9, 4, 3, 2, C.light);
  rect(ctx, 10, 8, 4, 3, C.dark);
  rect(ctx, 5, 9, 4, 2, C.dark);
  applySelectiveOutline(ctx, T, C.deep);
}

// ---------------------------------------------------------------------------
// marble props — 3/4 volumes, outline, contact shadow, ≥3 ramp values
// ---------------------------------------------------------------------------

function pillarSingle(ctx: Ctx) {
  const M = PAL.marble;
  dropShadow(ctx, 8.5, 15.2, 7, 1.8);
  contactShadow(ctx, 1, 15, 14);
  // abacus top (lit)
  rect(ctx, 2, 0, 12, 2, M.light);
  hline(ctx, 2, 0, 12, M.deep);
  hline(ctx, 2, 1, 12, PAL.goldL);
  // neck
  rect(ctx, 3, 2, 10, 2, M.base);
  hline(ctx, 3, 2, 10, M.light);
  hline(ctx, 3, 3, 10, M.dark);
  // shaft — left lit, right shadow (top-left light)
  rect(ctx, 4, 4, 8, 8, M.base);
  vline(ctx, 4, 4, 8, M.light);
  vline(ctx, 5, 4, 8, M.light);
  vline(ctx, 7, 4, 8, M.vein);
  vline(ctx, 9, 4, 8, M.dark);
  vline(ctx, 10, 4, 8, M.deep);
  vline(ctx, 11, 4, 8, M.deep);
  hline(ctx, 4, 4, 8, M.dark);
  hline(ctx, 4, 11, 8, M.vein);
  // base plinth
  rect(ctx, 3, 12, 10, 1, M.base);
  hline(ctx, 3, 12, 10, M.light);
  rect(ctx, 2, 13, 12, 2, M.cream);
  hline(ctx, 2, 13, 12, M.light);
  hline(ctx, 2, 14, 12, M.deep);
  vline(ctx, 2, 13, 2, M.deep);
  vline(ctx, 13, 13, 2, M.deep);
  applySelectiveOutline(ctx, T, M.deep);
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
  applySelectiveOutline(ctx, T, M.deep);
}

function columnTop(ctx: Ctx) {
  const M = PAL.marble;
  rect(ctx, 3, 9, 10, 2, M.light);
  hline(ctx, 3, 8, 10, M.deep);
  hline(ctx, 3, 10, 10, M.vein);
  rect(ctx, 4, 11, 8, 2, M.base);
  hline(ctx, 4, 12, 8, M.dark);
  rect(ctx, 5, 13, 6, 3, M.base);
  vline(ctx, 5, 13, 3, M.light);
  vline(ctx, 9, 13, 3, M.dark);
  vline(ctx, 10, 13, 3, M.deep);
  applySelectiveOutline(ctx, T, M.deep);
}

const STATUE_TOP_TPL = [
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
  const M = PAL.marble;
  const palMap: Record<string, string> = {
    o: M.deep,
    w: M.base,
    l: M.light,
    g: PAL.gold,
    s: P.s4, // shield steel from palette
    d: M.dark,
    c: PAL.crimson,
  };
  drawTemplate(ctx, STATUE_TOP_TPL, palMap);
  px(ctx, 2, 8, PAL.gold);
  px(ctx, 2, 9, M.dark);
  px(ctx, 1, 8, M.deep);
  px(ctx, 3, 0, PAL.goldL);
  px(ctx, 3, 1, PAL.gold);
  px(ctx, 7, 3, M.light);
  applySelectiveOutline(ctx, T, M.deep);
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
  applySelectiveOutline(ctx, T, M.deep);
}

function paintFountain(fctx: Ctx) {
  const M = PAL.marble;
  const W = PAL.water;
  const cx = 16;
  const cy = 16;
  dropShadow(fctx, 16, 28, 14, 3.5);
  contactShadow(fctx, 4, 29, 24);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.sqrt((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2);
      if (d < 15.2) {
        if (d > 12.2) {
          const lit = y < 15 && x < 18;
          if (d > 14.4) px(fctx, x, y, M.deep);
          else if (d > 13.4) px(fctx, x, y, lit ? M.light : M.dark);
          else px(fctx, x, y, lit ? M.light : M.base);
        } else if (d > 10.5) {
          px(fctx, x, y, d > 11.5 ? W.dark : W.base);
        } else {
          px(fctx, x, y, d < 5 ? W.light : W.base);
        }
      }
    }
  }
  for (const rad of [9.2, 6.5, 4.0]) {
    for (let a = 0; a < 48; a++) {
      if (a % 3 === 0) continue;
      const ang = (a / 48) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(ang) * rad - 0.5);
      const y = Math.round(cy + Math.sin(ang) * rad - 0.5);
      px(fctx, x, y, a % 2 === 0 ? W.pale : W.light);
    }
  }
  rect(fctx, 12, 13, 8, 6, M.base);
  hline(fctx, 12, 13, 8, M.light);
  hline(fctx, 12, 18, 8, M.deep);
  vline(fctx, 12, 13, 6, M.light);
  vline(fctx, 19, 13, 6, M.dark);
  rect(fctx, 14, 8, 4, 6, M.cream);
  vline(fctx, 14, 8, 6, M.light);
  vline(fctx, 15, 8, 6, M.base);
  vline(fctx, 16, 8, 6, M.vein);
  vline(fctx, 17, 8, 6, M.dark);
  rect(fctx, 13, 6, 6, 3, M.light);
  hline(fctx, 13, 6, 6, M.deep);
  hline(fctx, 13, 8, 6, M.dark);
  px(fctx, 14, 7, W.pale);
  px(fctx, 17, 7, W.pale);
  px(fctx, 15, 5, W.pale);
  px(fctx, 16, 4, W.light);
  px(fctx, 15, 3, W.pale);
  px(fctx, 16, 2, W.light);
  px(fctx, 15, 4, W.light);
  px(fctx, 14, 5, W.light);
  px(fctx, 17, 5, W.light);
  px(fctx, 13, 10, W.pale);
  px(fctx, 18, 10, W.pale);
  px(fctx, 14, 11, W.pale);
  px(fctx, 17, 11, W.pale);
  applySelectiveOutline(fctx, 32, M.deep);
}

// ---------------------------------------------------------------------------
// scatter / decals — stamps only on transparent BG
// ---------------------------------------------------------------------------

function decalPebbles(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.stone, rng(seed), {
    stampNames: ["pebble", "gravel"],
    countMin: 3,
    countMax: 5,
  });
}

function decalTuft(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.grass, rng(seed), {
    stampNames: ["grass_tuft", "grass_blade"],
    countMin: 3,
    countMax: 4,
  });
}

function decalLeaf(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.canopy, rng(seed), {
    stampNames: ["leaf", "moss"],
    countMin: 3,
    countMax: 4,
  });
}

function decalCracks(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.marble, rng(seed), {
    stampNames: ["crack", "vein"],
    countMin: 3,
    countMax: 4,
  });
}

function decalRubble(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.stone, rng(seed), {
    stampNames: ["pebble", "gravel", "wear"],
    countMin: 3,
    countMax: 5,
  });
}

function decalShell(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.sand, rng(seed), {
    stampNames: ["pebble", "sparkle"],
    countMin: 3,
    countMax: 3,
  });
}

function decalMoss(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.canopy, rng(seed), {
    stampNames: ["moss", "leaf"],
    countMin: 3,
    countMax: 4,
  });
}

function decalGravel(ctx: Ctx, seed: number) {
  placeStamps(ctx, RAMPS.stone, rng(seed), {
    stampNames: ["gravel", "dot_cluster"],
    countMin: 3,
    countMax: 5,
  });
}

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
// house / structures
// ---------------------------------------------------------------------------

function paintRoofBand(rctx: Ctx, w: number, upper: boolean) {
  const R = PAL.roof;
  rect(rctx, 0, 0, w, T, R.base);
  for (let row = 0; row < 4; row++) {
    const y = row * 4;
    hline(rctx, 0, y, w, upper && row === 0 ? R.lighter : R.light);
    hline(rctx, 0, y + 3, w, R.dark);
    for (let x = 0; x < w; x += 4) {
      const sx = x + (row % 2 === 0 ? 0 : 2);
      px(rctx, sx, y + 1, R.light);
      px(rctx, sx + 3, y + 2, R.deep);
      px(rctx, sx + 2, y + 3, R.deep);
    }
  }
  if (upper) {
    hline(rctx, 0, 0, w, R.deep);
    hline(rctx, 0, 1, w, R.lighter);
  } else {
    hline(rctx, 0, T - 2, w, R.deep);
    hline(rctx, 0, T - 1, w, PAL.crimsonD);
  }
  vline(rctx, 0, 0, T, R.deep);
  vline(rctx, 1, 0, T, R.lighter);
  vline(rctx, w - 1, 0, T, R.deep);
  vline(rctx, w - 2, 0, T, R.dark);
}

function paintWallStrip(wctx: Ctx, w: number) {
  const M = PAL.marble;
  rect(wctx, 0, 0, w, T, M.base);
  rect(wctx, 0, 0, w, 3, PAL.crimson);
  hline(wctx, 0, 0, w, PAL.crimsonD);
  for (let x = 1; x < w; x += 4) hline(wctx, x, 1, 2, PAL.gold);
  hline(wctx, 0, 3, w, M.deep);
  hline(wctx, 0, 4, w, M.light);
  for (let x = 0; x < w; x += 5) vline(wctx, x, 5, 8, M.vein);
  hline(wctx, 0, T - 3, w, M.dark);
  rect(wctx, 0, T - 2, w, 2, M.cream);
  hline(wctx, 0, T - 1, w, M.deep);
}

function wallWindow(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const M = PAL.marble;
  rect(ctx, 5, 5, 6, 7, P.s0);
  rect(ctx, 6, 6, 4, 2, P.s1);
  vline(ctx, 5, 5, 7, M.deep);
  vline(ctx, 10, 5, 7, M.deep);
  hline(ctx, 5, 5, 6, M.deep);
  hline(ctx, 4, 12, 8, M.light);
  hline(ctx, 4, 13, 8, M.dark);
  hline(ctx, 4, 4, 8, M.light);
}

function wallColumn(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const M = PAL.marble;
  rect(ctx, 6, 3, 4, 11, M.light);
  vline(ctx, 7, 4, 10, M.base);
  vline(ctx, 9, 3, 11, M.dark);
  vline(ctx, 5, 3, 11, M.deep);
  vline(ctx, 10, 3, 11, M.deep);
  rect(ctx, 5, 3, 6, 1, M.light);
  rect(ctx, 5, 13, 6, 1, M.light);
  hline(ctx, 5, 14, 6, M.deep);
}

function doorTile(ctx: Ctx) {
  paintWallStrip(ctx, T);
  const D = PAL.door;
  const M = PAL.marble;
  rect(ctx, 3, 3, 10, 13, M.light);
  vline(ctx, 3, 3, 13, M.dark);
  vline(ctx, 12, 3, 13, M.deep);
  hline(ctx, 3, 3, 10, M.light);
  rect(ctx, 5, 5, 6, 11, D.dark);
  rect(ctx, 5, 6, 6, 10, D.wood);
  hline(ctx, 5, 5, 6, D.darker);
  hline(ctx, 5, 6, 6, D.darker);
  vline(ctx, 8, 6, 10, D.darker);
  vline(ctx, 5, 6, 10, D.light);
  vline(ctx, 6, 7, 9, D.dark);
  vline(ctx, 10, 7, 9, D.dark);
  px(ctx, 7, 11, PAL.gold);
  px(ctx, 9, 11, PAL.gold);
  hline(ctx, 4, 15, 8, M.cream);
}

function paintPediment(pctx: Ctx) {
  const M = PAL.marble;
  const apexX = 24;
  for (let y = 0; y < 16; y++) {
    const half = Math.max(1, (y / 15) * 24);
    const x0 = Math.round(apexX - half);
    const x1 = Math.round(apexX + half);
    hline(pctx, x0, y, x1 - x0, M.base);
    px(pctx, x0, y, M.deep);
    if (x0 + 1 < x1) px(pctx, x0 + 1, y, M.light);
    px(pctx, x1 - 1, y, M.deep);
    if (x1 - 2 > x0) px(pctx, x1 - 2, y, M.dark);
  }
  for (let y = 5; y < 14; y++) {
    const half = (y / 15) * 24 - 4;
    if (half <= 1) continue;
    hline(pctx, Math.round(apexX - half), y, Math.round(half * 2), PAL.crimson);
    px(pctx, Math.round(apexX - half), y, PAL.crimsonD);
    px(pctx, Math.round(apexX + half) - 1, y, PAL.crimsonD);
  }
  px(pctx, 22, 9, PAL.gold);
  px(pctx, 26, 9, PAL.gold);
  px(pctx, 21, 10, PAL.gold);
  px(pctx, 27, 10, PAL.gold);
  px(pctx, 22, 11, PAL.gold);
  px(pctx, 26, 11, PAL.gold);
  rect(pctx, 23, 12, 3, 1, PAL.goldL);
  hline(pctx, 0, 14, 48, M.light);
  hline(pctx, 0, 15, 48, M.deep);
}

function friezeTile(ctx: Ctx) {
  const M = PAL.marble;
  rect(ctx, 0, 0, T, T, M.base);
  hline(ctx, 0, 0, T, M.light);
  hline(ctx, 0, 1, T, M.light);
  hline(ctx, 0, 2, T, M.dark);
  rect(ctx, 0, 3, T, 8, M.cream);
  for (let x = 1; x < T; x += 8) {
    rect(ctx, x, 4, 5, 6, M.base);
    vline(ctx, x + 1, 4, 6, M.deep);
    vline(ctx, x + 3, 4, 6, M.deep);
    vline(ctx, x, 4, 6, M.light);
  }
  hline(ctx, 0, 11, T, M.dark);
  rect(ctx, 0, 12, T, 2, M.light);
  hline(ctx, 0, 14, T, M.dark);
  hline(ctx, 0, 15, T, M.deep);
}

function templeColTop(ctx: Ctx) {
  const M = PAL.marble;
  rect(ctx, 2, 0, 12, 2, M.light);
  hline(ctx, 2, 1, 12, M.vein);
  hline(ctx, 2, 2, 12, M.dark);
  rect(ctx, 3, 3, 10, 2, M.base);
  hline(ctx, 3, 4, 10, M.dark);
  flutedShaft(ctx, 5);
  applySelectiveOutline(ctx, T, M.deep);
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
  applySelectiveOutline(ctx, T, PAL.marble.deep);
}

function templeSteps(ctx: Ctx) {
  const M = PAL.marble;
  for (let s = 0; s < 3; s++) {
    const y = s * 5;
    rect(ctx, 0, y, T, 4, s === 0 ? M.light : M.base);
    hline(ctx, 0, y, T, M.light);
    hline(ctx, 0, y + 4, T, M.deep);
  }
  hline(ctx, 0, 15, T, M.dark);
}

function cella(ctx: Ctx) {
  rect(ctx, 0, 0, T, T, P.d0);
  rect(ctx, 0, 0, T, 4, P.o0);
  hline(ctx, 0, 4, T, P.d1);
  hline(ctx, 2, 9, 3, P.d1);
  hline(ctx, 9, 11, 4, P.d1);
  hline(ctx, 5, 13, 3, P.d1);
  hline(ctx, 0, 15, T, P.o0);
}

function templeFloor(ctx: Ctx, seed: number) {
  paintGroundWithStamps(ctx, RAMPS.marble, rng(seed), {
    baseIdx: 3,
    topIdx: 4,
    botIdx: 2,
    stampNames: ["vein", "wear"],
    countMin: 3,
    countMax: 4,
  });
  // slab joints from ramp only
  hline(ctx, 0, 7, T, PAL.marble.dark);
  vline(ctx, 7, 0, 8, PAL.marble.dark);
}

function cityWallBody(ctx: Ctx, seed: number) {
  const C = PAL.cwall;
  const r = rng(seed);
  rect(ctx, 0, 0, T, T, C.base);
  for (let row = 0; row < 2; row++) {
    const y = row * 8;
    const shift = row % 2 === 0 ? 0 : 4;
    for (let col = -1; col < 3; col++) {
      const bx = col * 8 + shift;
      const tone = r() < 0.5 ? C.base : C.light;
      rect(ctx, bx, y, 7, 7, tone);
      hline(ctx, bx, y, 7, C.light);
      vline(ctx, bx, y, 7, C.light);
      hline(ctx, bx, y + 6, 7, C.dark);
      vline(ctx, bx + 6, y + 1, 6, C.dark);
      vline(ctx, bx + 7, y, 7, C.mortar);
      if (r() < 0.45) px(ctx, bx + 2 + Math.floor(r() * 4), y + 2 + Math.floor(r() * 3), C.dark);
    }
    hline(ctx, 0, y + 7, T, C.deep);
  }
}

function cityWallTop(ctx: Ctx) {
  const C = PAL.cwall;
  for (const mx of [0, 8]) {
    rect(ctx, mx, 1, 5, 9, C.base);
    hline(ctx, mx, 1, 5, C.light);
    hline(ctx, mx, 2, 5, C.light);
    vline(ctx, mx, 1, 9, C.light);
    vline(ctx, mx + 4, 2, 8, C.deep);
    hline(ctx, mx + 1, 9, 4, C.deep);
    px(ctx, mx + 2, 5, C.dark);
  }
  rect(ctx, 5, 7, 3, 3, P.ink);
  rect(ctx, 13, 7, 3, 3, P.ink);
  rect(ctx, 0, 10, T, 3, C.light);
  hline(ctx, 0, 10, T, C.light);
  hline(ctx, 0, 12, T, C.mortar);
  rect(ctx, 0, 13, T, 3, C.base);
  hline(ctx, 0, 13, T, C.dark);
  hline(ctx, 0, 15, T, C.deep);
}

function gateTop(ctx: Ctx) {
  cityWallBody(ctx, 88);
  const C = PAL.cwall;
  rect(ctx, 4, 8, 8, 8, P.ink);
  rect(ctx, 3, 10, 10, 6, P.ink);
  px(ctx, 4, 8, C.dark);
  px(ctx, 11, 8, C.dark);
  px(ctx, 3, 9, C.deep);
  px(ctx, 12, 9, C.deep);
  hline(ctx, 4, 7, 8, C.deep);
  px(ctx, 3, 8, C.deep);
  px(ctx, 12, 8, C.deep);
  vline(ctx, 2, 10, 6, C.deep);
  vline(ctx, 13, 10, 6, C.deep);
  rect(ctx, 7, 5, 2, 3, C.light);
  vline(ctx, 6, 5, 3, C.dark);
  vline(ctx, 9, 5, 3, C.dark);
}

function gateSide(ctx: Ctx, left: boolean) {
  cityWallBody(ctx, 77);
  const C = PAL.cwall;
  const D = PAL.door;
  if (left) {
    rect(ctx, 10, 4, 6, 12, D.dark);
    rect(ctx, 11, 6, 5, 10, D.wood);
    vline(ctx, 12, 6, 10, D.dark);
    vline(ctx, 14, 6, 10, D.dark);
    px(ctx, 15, 11, PAL.gold);
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
  stoneRoad(ctx, 55, true);
  // shadow from palette ink bands only
  rect(ctx, 0, 0, T, 3, P.ink);
  rect(ctx, 0, 3, T, 2, P.s0);
  rect(ctx, 0, 5, T, 2, P.s1);
  px(ctx, 0, 0, PAL.cwall.deep);
  px(ctx, 1, 0, PAL.cwall.deep);
  px(ctx, 15, 0, PAL.cwall.deep);
  px(ctx, 14, 0, PAL.cwall.deep);
}

function cliffFace(ctx: Ctx, seed: number) {
  const R = PAL.rock;
  const r = rng(seed);
  rect(ctx, 0, 0, T, T, R.base);
  hline(ctx, 0, 0, T, R.light);
  hline(ctx, 0, 1, T, R.light);
  for (const cx of [3, 8, 13]) {
    vline(ctx, cx, 2 + Math.floor(r() * 2), 12, R.deep);
    vline(ctx, cx + 1, 3, 10, R.dark);
  }
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

function interiorWall(ctx: Ctx) {
  const I = PAL.interior;
  rect(ctx, 0, 0, T, T, I.wallTop);
  hline(ctx, 0, 0, T, I.wallDark);
  hline(ctx, 0, 1, T, I.wallTop);
  hline(ctx, 0, 8, T, PAL.crimson);
  rect(ctx, 0, 9, T, 7, I.panel);
  hline(ctx, 0, 9, T, I.panel);
  for (let x = 0; x < T; x += 4) vline(ctx, x, 10, 6, I.panelD);
  hline(ctx, 0, 15, T, I.panelD);
}

function rug(ctx: Ctx) {
  rect(ctx, 1, 1, 14, 14, PAL.crimson);
  hline(ctx, 1, 1, 14, PAL.crimsonD);
  hline(ctx, 1, 14, 14, PAL.crimsonD);
  vline(ctx, 1, 1, 14, PAL.crimsonD);
  vline(ctx, 14, 1, 14, PAL.crimsonD);
  hline(ctx, 3, 3, 10, PAL.gold);
  hline(ctx, 3, 12, 10, PAL.gold);
  vline(ctx, 3, 3, 10, PAL.gold);
  vline(ctx, 12, 3, 10, PAL.gold);
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
  dropShadow(ctx, 8, 14, 7, 1.5);
  contactShadow(ctx, 2, 14, 12);
  // top face lit
  rect(ctx, 2, 4, 12, 4, W.light);
  hline(ctx, 2, 4, 12, W.light);
  hline(ctx, 2, 7, 12, W.dark);
  // front face mid
  rect(ctx, 3, 8, 10, 3, W.base);
  hline(ctx, 3, 10, 10, W.deep);
  // legs
  vline(ctx, 3, 11, 3, W.dark);
  vline(ctx, 12, 11, 3, W.dark);
  vline(ctx, 4, 11, 3, W.deep);
  vline(ctx, 11, 11, 3, W.deep);
  applySelectiveOutline(ctx, T, W.deep);
}

function amphora(ctx: Ctx) {
  const M = PAL.marble;
  dropShadow(ctx, 8, 14.5, 5, 1.4);
  contactShadow(ctx, 4, 14, 8);
  // body volume
  rect(ctx, 5, 4, 6, 8, M.base);
  vline(ctx, 5, 4, 8, M.light);
  vline(ctx, 6, 4, 8, M.light);
  vline(ctx, 9, 4, 8, M.dark);
  vline(ctx, 10, 4, 8, M.deep);
  // neck + rim (top lit)
  rect(ctx, 6, 2, 4, 2, M.light);
  hline(ctx, 6, 2, 4, M.light);
  hline(ctx, 6, 3, 4, M.vein);
  // base
  rect(ctx, 4, 12, 8, 2, M.dark);
  hline(ctx, 4, 12, 8, M.base);
  hline(ctx, 4, 13, 8, M.deep);
  // handles
  px(ctx, 4, 6, M.vein);
  px(ctx, 11, 6, M.dark);
  px(ctx, 4, 7, M.deep);
  px(ctx, 11, 7, M.deep);
  applySelectiveOutline(ctx, T, M.deep);
}

function bed(ctx: Ctx) {
  const W = PAL.wood;
  dropShadow(ctx, 8, 14, 7, 1.4);
  contactShadow(ctx, 1, 14, 14);
  rect(ctx, 1, 6, 14, 7, W.base);
  rect(ctx, 2, 5, 12, 3, W.light); // top blanket
  hline(ctx, 2, 5, 12, PAL.crimson);
  rect(ctx, 2, 8, 12, 4, W.dark);
  vline(ctx, 1, 6, 7, W.deep);
  vline(ctx, 14, 6, 7, W.deep);
  // pillow
  rect(ctx, 3, 6, 4, 2, Mlight());
  applySelectiveOutline(ctx, T, W.deep);
}

function Mlight() {
  return PAL.marble.light;
}

function banner(ctx: Ctx) {
  dropShadow(ctx, 8, 14, 4, 1.2);
  // pole
  vline(ctx, 7, 0, 4, PAL.wood.dark);
  vline(ctx, 8, 0, 4, PAL.wood.base);
  // cloth
  rect(ctx, 4, 3, 8, 10, PAL.crimson);
  vline(ctx, 4, 3, 10, PAL.crimsonD);
  vline(ctx, 11, 3, 10, PAL.crimsonD);
  hline(ctx, 4, 3, 8, PAL.gold);
  hline(ctx, 5, 7, 6, PAL.gold);
  px(ctx, 7, 5, PAL.goldL);
  px(ctx, 8, 5, PAL.goldL);
  // scallop bottom
  px(ctx, 4, 13, PAL.crimsonD);
  px(ctx, 6, 13, PAL.crimson);
  px(ctx, 8, 13, PAL.crimson);
  px(ctx, 10, 13, PAL.crimsonD);
  applySelectiveOutline(ctx, T, PAL.crimsonD);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const cols = TILESET_COLS;
  const rows = Math.ceil(Tile.COUNT / cols);
  const { canvas, ctx } = makeCanvas(cols * T, rows * T);

  const paint = (id: number, fn: (c: Ctx) => void, clear = true) => {
    const x = (id % cols) * T;
    const y = Math.floor(id / cols) * T;
    const tile = makeCanvas(T, T);
    if (clear) rect(tile.ctx, 0, 0, T, T, "#00000000");
    fn(tile.ctx);
    ctx.drawImage(tile.canvas, x, y);
  };

  const blit = (id: number, src: Canvas, sx: number, sy: number) => {
    const x = (id % cols) * T;
    const y = Math.floor(id / cols) * T;
    ctx.drawImage(src, sx, sy, T, T, x, y, T, T);
  };

  // multi-tile assemblies
  const fountain = makeCanvas(32, 32);
  paintFountain(fountain.ctx);
  const roofUpper = makeCanvas(48, T);
  paintRoofBand(roofUpper.ctx, 48, true);
  const roofLower = makeCanvas(48, T);
  paintRoofBand(roofLower.ctx, 48, false);
  const pediment = makeCanvas(48, T);
  paintPediment(pediment.ctx);

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

  paint(Tile.FLOWERS_RED, (c) => flowers(c, PAL.crimson, PAL.gold), false);
  paint(Tile.FLOWERS_GOLD, (c) => flowers(c, PAL.gold, PAL.goldL), false);
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

  paint(Tile.TREE_CANOPY, (c) => treeCanopy(c), false);
  paint(Tile.COLUMN_TOP, (c) => columnTop(c), false);
  paint(Tile.STATUE_TOP, (c) => statueTop(c), false);
  paint(Tile.BANNER, (c) => banner(c), false);

  paint(Tile.CLIFF_FACE, (c) => cliffFace(c, 151));
  paint(Tile.CLIFF_TOP, (c) => cliffTop(c, 161));

  paint(Tile.I_WALL, (c) => interiorWall(c));
  paint(Tile.RUG, (c) => rug(c));
  paint(Tile.TABLE, (c) => table(c), false);
  paint(Tile.AMPHORA, (c) => amphora(c), false);
  paint(Tile.BED, (c) => bed(c), false);

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

  // blob transitions
  for (let pairId = 0; pairId < TRANSITION_PAIR_COUNT; pairId++) {
    const pair = TRANSITION_PAIRS[pairId]!;
    const paintBg = terrainPainter(pair.bg, 0);
    const paintFg = terrainPainter(pair.fg, 0);
    for (let b = 0; b < BLOB_TILE_COUNT; b++) {
      const mask = b === BLOB_TILE_COUNT - 1 ? 0xff : BLOB_MASKS_47[b]!;
      const id = transitionTileIndex(pairId, b);
      paint(id, (c) => {
        paintBlobTransition(c, mask, paintBg, paintFg, T, blobCoverageAt);
      });
    }
  }

  const outDir = join(ROOT, "apps/client/public/assets");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(ROOT, "preview"), { recursive: true });
  writeFileSync(join(outDir, "tileset.png"), canvas.toBuffer("image/png"));

  // contact sheet of first 86 base tiles
  const sampleIds: number[] = [];
  for (let id = 0; id < Math.min(86, Tile.COUNT); id++) sampleIds.push(id);
  const sc = 4;
  const perRow = 10;
  const sheetRows = Math.ceil(sampleIds.length / perRow);
  const sheet = makeCanvas(perRow * T * sc + 8, sheetRows * (T * sc + 14) + 8);
  sheet.ctx.fillStyle = "#1a1820";
  sheet.ctx.fillRect(0, 0, sheet.canvas.width, sheet.canvas.height);
  sheet.ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < sampleIds.length; i++) {
    const id = sampleIds[i]!;
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const dx = 4 + col * T * sc;
    const dy = 4 + row * (T * sc + 14);
    const sx = (id % cols) * T;
    const sy = Math.floor(id / cols) * T;
    sheet.ctx.drawImage(canvas, sx, sy, T, T, dx, dy, T * sc, T * sc);
    sheet.ctx.fillStyle = "#c8b890";
    sheet.ctx.font = "10px monospace";
    sheet.ctx.fillText(String(id), dx, dy + T * sc + 10);
  }
  writeFileSync(join(ROOT, "preview/tileset-preview.png"), sheet.canvas.toBuffer("image/png"));

  console.log(
    `tileset: ${cols * T}x${rows * T} (${Tile.COUNT} tiles, ${TRANSITION_PAIR_COUNT} pairs) -> apps/client/public/assets/tileset.png`
  );
  console.log(`palette colors: ${GLOBAL_PALETTE_LIST.length}`);
  console.log(`preview -> preview/tileset-preview.png`);
}

main();
