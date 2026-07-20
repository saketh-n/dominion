/**
 * DP-style art-pass contracts: roof grammar, density, animation, silhouette helpers.
 * Pure functions shared by map gen, client anim, and gating tests.
 */
import { Tile } from "./tiles.js";

/** Target roof mass height in tile rows (inclusive of ridge + body + eave). */
export const ROOF_ROWS_MIN = 3;
export const ROOF_ROWS_MAX = 5;

/** House stamp: 4 roof rows + wall + door = 6 tall. Door at local y = 5. */
export const HOUSE_ROOF_ROWS = 4;
export const HOUSE_DOOR_LOCAL_Y = 5;
export const HOUSE_WIDTH = 5;

/**
 * Build a house roof column (north → south) of `HOUSE_ROOF_ROWS` tiles:
 * ridge, upper body, lower body, eave shadow.
 */
export function houseRoofColumn(i: number, width = HOUSE_WIDTH): number[] {
  const isW = i === 0;
  const isE = i === width - 1;
  return [
    isW ? Tile.H_ROOF_NW : isE ? Tile.H_ROOF_NE : Tile.H_ROOF_RIDGE,
    isW ? Tile.H_ROOF_W : isE ? Tile.H_ROOF_E : Tile.H_ROOF_N,
    isW ? Tile.H_ROOF_W : isE ? Tile.H_ROOF_E : Tile.H_ROOF_M,
    Tile.H_EAVE_SHADOW,
  ];
}

/** Wall row for house (engaged cols + windows). */
export function houseWallRow(i: number, width = HOUSE_WIDTH): number {
  if (i === 0 || i === width - 1) return Tile.H_WALL_COL;
  if (i === 1 || i === width - 2) return Tile.H_WALL_WIN;
  return Tile.H_WALL;
}

/** Door row for house. */
export function houseDoorRow(i: number, width = HOUSE_WIDTH): number {
  const mid = (width / 2) | 0;
  if (i === mid) return Tile.H_DOOR;
  return Tile.H_WALL;
}

/** True if tile is part of roof mass (ridge/body/eave). */
export function isRoofTile(t: number): boolean {
  return (
    t === Tile.H_ROOF_NW ||
    t === Tile.H_ROOF_N ||
    t === Tile.H_ROOF_NE ||
    t === Tile.H_ROOF_W ||
    t === Tile.H_ROOF_M ||
    t === Tile.H_ROOF_E ||
    t === Tile.H_ROOF_RIDGE ||
    t === Tile.H_EAVE_SHADOW ||
    t === Tile.T_PED_W ||
    t === Tile.T_PED_M ||
    t === Tile.T_PED_E
  );
}

/** True if tile is facade wall (not roof). */
export function isFacadeTile(t: number): boolean {
  return (
    t === Tile.H_WALL ||
    t === Tile.H_WALL_WIN ||
    t === Tile.H_WALL_COL ||
    t === Tile.H_DOOR ||
    t === Tile.T_FRIEZE ||
    t === Tile.T_COL_TOP ||
    t === Tile.T_COL_MID ||
    t === Tile.T_CELLA ||
    t === Tile.W_BODY ||
    t === Tile.W_TOP
  );
}

/** Organic ground kinds that must not appear inside structure footprints. */
export const ORGANIC_GROUND: ReadonlySet<number> = new Set([
  Tile.GRASS,
  Tile.GRASS2,
  Tile.GRASS3,
  Tile.GRASS4,
  Tile.TALL_GRASS,
  Tile.DIRT_PATH,
  Tile.DIRT_PATH2,
  Tile.DIRT_PATH3,
  Tile.SAND,
  Tile.SAND2,
  Tile.SAND3,
]);

/** Object-type buckets for density / distinct-type counts. */
export const OBJECT_TYPE_TILES: Readonly<Record<string, readonly number[]>> = {
  roof: [
    Tile.H_ROOF_NW,
    Tile.H_ROOF_N,
    Tile.H_ROOF_NE,
    Tile.H_ROOF_W,
    Tile.H_ROOF_M,
    Tile.H_ROOF_E,
    Tile.H_ROOF_RIDGE,
    Tile.H_EAVE_SHADOW,
    Tile.T_PED_W,
    Tile.T_PED_M,
    Tile.T_PED_E,
  ],
  wall: [Tile.H_WALL, Tile.H_WALL_WIN, Tile.H_WALL_COL, Tile.W_BODY, Tile.W_TOP, Tile.I_WALL],
  door: [Tile.H_DOOR],
  column: [Tile.COLUMN_BASE, Tile.COLUMN_TOP, Tile.COLUMN_SHAFT, Tile.PILLAR, Tile.T_COL_TOP, Tile.T_COL_MID],
  statue: [Tile.STATUE_BASE, Tile.STATUE_TOP],
  tree: [Tile.TREE_TRUNK, Tile.TREE_CANOPY],
  bush: [Tile.BUSH, Tile.HEDGE],
  fountain: [Tile.FOUNTAIN_NW, Tile.FOUNTAIN_NE, Tile.FOUNTAIN_SW, Tile.FOUNTAIN_SE],
  flowers: [Tile.FLOWERS_RED, Tile.FLOWERS_GOLD],
  banner: [Tile.BANNER, Tile.AWNING],
  amphora: [Tile.AMPHORA],
  bench: [Tile.BENCH],
  planter: [Tile.PLANTER],
  crate: [Tile.CRATE, Tile.MARKET],
  lantern: [Tile.LANTERN],
  fence: [Tile.FENCE],
  sign: [Tile.SIGNPOST],
  steps: [Tile.T_STEPS],
};

/** Bare walkable ground (no deco/overhead prop) used for density fraction. */
export function isBareGroundTile(ground: number, deco: number, overhead: number): boolean {
  if (deco !== 0 || overhead !== 0) return false;
  return (
    ground === Tile.GRASS ||
    ground === Tile.GRASS2 ||
    ground === Tile.GRASS3 ||
    ground === Tile.GRASS4 ||
    ground === Tile.DIRT_PATH ||
    ground === Tile.DIRT_PATH2 ||
    ground === Tile.DIRT_PATH3 ||
    ground === Tile.STONE_ROAD ||
    ground === Tile.STONE_ROAD2 ||
    ground === Tile.STONE_ROAD3 ||
    ground === Tile.MARBLE_FLOOR ||
    ground === Tile.MARBLE_FLOOR2 ||
    ground === Tile.MARBLE_FLOOR3 ||
    ground === Tile.MARBLE_COURT ||
    ground === Tile.SAND ||
    ground === Tile.SAND2 ||
    ground === Tile.SAND3
  );
}

/**
 * Count distinct object-type labels present in a set of deco/overhead tiles.
 */
export function countDistinctObjectTypes(tiles: Iterable<number>): number {
  const present = new Set<string>();
  const list = [...tiles];
  for (const [name, ids] of Object.entries(OBJECT_TYPE_TILES)) {
    const set = new Set(ids);
    if (list.some((t) => set.has(t))) present.add(name);
  }
  return present.size;
}

/** Camera-sized sample defaults (~20×14 overworld tiles at zoom 3). */
export const CAMERA_FRAME_W = 20;
export const CAMERA_FRAME_H = 14;

/**
 * Bare-ground fraction in a rectangular window of layered world data.
 * layers: parallel arrays length width*height, or accessors.
 */
export function bareGroundFraction(
  width: number,
  x0: number,
  y0: number,
  fw: number,
  fh: number,
  groundAt: (x: number, y: number) => number,
  decoAt: (x: number, y: number) => number,
  overheadAt: (x: number, y: number) => number
): number {
  let bare = 0;
  let total = 0;
  for (let y = y0; y < y0 + fh; y++) {
    for (let x = x0; x < x0 + fw; x++) {
      if (x < 0 || y < 0 || x >= width) continue;
      total++;
      if (isBareGroundTile(groundAt(x, y), decoAt(x, y), overheadAt(x, y))) bare++;
    }
  }
  return total ? bare / total : 1;
}

/** Collect deco+overhead tiles in a frame for object-type counting. */
export function collectFrameTiles(
  width: number,
  x0: number,
  y0: number,
  fw: number,
  fh: number,
  decoAt: (x: number, y: number) => number,
  overheadAt: (x: number, y: number) => number
): number[] {
  const out: number[] = [];
  for (let y = y0; y < y0 + fh; y++) {
    for (let x = x0; x < x0 + fw; x++) {
      if (x < 0 || y < 0 || x >= width) continue;
      const d = decoAt(x, y);
      const o = overheadAt(x, y);
      if (d) out.push(d);
      if (o) out.push(o);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Animated tiles (~500ms / 2 Hz, 2–4 frames)
// ---------------------------------------------------------------------------

/** Animation period in ms (Pokémon-like gentle loop). */
export const TILE_ANIM_PERIOD_MS = 500;

/** Frame counts per animated family (2–4). */
export const TILE_ANIM_FRAMES = {
  water: 3,
  fountain: 2,
  banner: 2,
  flowers: 2,
} as const;

/**
 * Base tile → ordered frame tile indices (2–4 entries).
 * Every frame MUST be a same-object variant (never a foreign tile id):
 * - water ↔ water wave variants
 * - each fountain corner ↔ its own spray phase (NW never becomes NE)
 * - banner ↔ banner flutter (never awning)
 * - flowers_red ↔ flowers_red2 (never gold swap)
 */
export const ANIMATED_TILE_FRAMES: Readonly<Record<number, readonly number[]>> = {
  // Water: 3-frame wave loop (phase offset per tile via tileAnimPhaseOffset)
  [Tile.WATER]: [Tile.WATER, Tile.WATER2, Tile.WATER3],
  [Tile.WATER2]: [Tile.WATER2, Tile.WATER3, Tile.WATER],
  [Tile.WATER3]: [Tile.WATER3, Tile.WATER, Tile.WATER2],
  // Shore: foam phase only (still shore geometry)
  [Tile.WATER_SHORE]: [Tile.WATER_SHORE, Tile.WATER_SHORE2],
  [Tile.WATER_SHORE2]: [Tile.WATER_SHORE2, Tile.WATER_SHORE],
  // Fountain spray: each corner keeps its quadrant; phase B is spray offset art
  [Tile.FOUNTAIN_NW]: [Tile.FOUNTAIN_NW, Tile.FOUNTAIN_NW2],
  [Tile.FOUNTAIN_NE]: [Tile.FOUNTAIN_NE, Tile.FOUNTAIN_NE2],
  [Tile.FOUNTAIN_SW]: [Tile.FOUNTAIN_SW, Tile.FOUNTAIN_SW2],
  [Tile.FOUNTAIN_SE]: [Tile.FOUNTAIN_SE, Tile.FOUNTAIN_SE2],
  [Tile.FOUNTAIN_NW2]: [Tile.FOUNTAIN_NW2, Tile.FOUNTAIN_NW],
  [Tile.FOUNTAIN_NE2]: [Tile.FOUNTAIN_NE2, Tile.FOUNTAIN_NE],
  [Tile.FOUNTAIN_SW2]: [Tile.FOUNTAIN_SW2, Tile.FOUNTAIN_SW],
  [Tile.FOUNTAIN_SE2]: [Tile.FOUNTAIN_SE2, Tile.FOUNTAIN_SE],
  // Banner flutter: hanging cloth frames only
  [Tile.BANNER]: [Tile.BANNER, Tile.BANNER2],
  [Tile.BANNER2]: [Tile.BANNER2, Tile.BANNER],
  // Flowers sway within the same color cluster
  [Tile.FLOWERS_RED]: [Tile.FLOWERS_RED, Tile.FLOWERS_RED2],
  [Tile.FLOWERS_GOLD]: [Tile.FLOWERS_GOLD, Tile.FLOWERS_GOLD2],
  [Tile.FLOWERS_RED2]: [Tile.FLOWERS_RED2, Tile.FLOWERS_RED],
  [Tile.FLOWERS_GOLD2]: [Tile.FLOWERS_GOLD2, Tile.FLOWERS_GOLD],
};

/**
 * Family membership for anim frames — used by tests and to prove frames
 * never jump to a foreign object class.
 */
export const ANIM_FRAME_FAMILY: Readonly<Record<number, string>> = {
  [Tile.WATER]: "water",
  [Tile.WATER2]: "water",
  [Tile.WATER3]: "water",
  [Tile.WATER_SHORE]: "water_shore",
  [Tile.WATER_SHORE2]: "water_shore",
  [Tile.FOUNTAIN_NW]: "fountain_nw",
  [Tile.FOUNTAIN_NW2]: "fountain_nw",
  [Tile.FOUNTAIN_NE]: "fountain_ne",
  [Tile.FOUNTAIN_NE2]: "fountain_ne",
  [Tile.FOUNTAIN_SW]: "fountain_sw",
  [Tile.FOUNTAIN_SW2]: "fountain_sw",
  [Tile.FOUNTAIN_SE]: "fountain_se",
  [Tile.FOUNTAIN_SE2]: "fountain_se",
  [Tile.BANNER]: "banner",
  [Tile.BANNER2]: "banner",
  [Tile.FLOWERS_RED]: "flowers_red",
  [Tile.FLOWERS_RED2]: "flowers_red",
  [Tile.FLOWERS_GOLD]: "flowers_gold",
  [Tile.FLOWERS_GOLD2]: "flowers_gold",
};

/** True if every frame of `base` shares the same anim family as the base. */
export function animFramesAreSameObject(baseTile: number): boolean {
  const frames = ANIMATED_TILE_FRAMES[baseTile];
  if (!frames || frames.length < 2) return false;
  const fam = ANIM_FRAME_FAMILY[baseTile];
  if (!fam) return false;
  return frames.every((f) => ANIM_FRAME_FAMILY[f] === fam);
}

/** Stable phase offset 0..period-1 from tile coords (water stagger). */
export function tileAnimPhaseOffset(tileX: number, tileY: number, periodMs = TILE_ANIM_PERIOD_MS): number {
  // Cheap hash → [0, period)
  const h = ((tileX * 374761393 + tileY * 668265263) >>> 0) % periodMs;
  return h;
}

/**
 * Which frame index (0..frameCount-1) at time `nowMs` for a cell.
 */
export function tileAnimFrameIndex(
  nowMs: number,
  tileX: number,
  tileY: number,
  frameCount: number,
  periodMs = TILE_ANIM_PERIOD_MS
): number {
  if (frameCount <= 1) return 0;
  const t = (nowMs + tileAnimPhaseOffset(tileX, tileY, periodMs)) / periodMs;
  return Math.floor(t) % frameCount;
}

/**
 * Resolve displayed tile index for an animated base tile at world cell.
 * Non-animated tiles return base unchanged.
 */
export function animatedTileIndex(baseTile: number, nowMs: number, tileX: number, tileY: number): number {
  const frames = ANIMATED_TILE_FRAMES[baseTile];
  if (!frames || frames.length < 2) return baseTile;
  const fi = tileAnimFrameIndex(nowMs, tileX, tileY, frames.length);
  return frames[fi]!;
}

/** True if this tile participates in a 2–4 frame loop. */
export function isAnimatedTile(t: number): boolean {
  const f = ANIMATED_TILE_FRAMES[t];
  return !!f && f.length >= 2 && f.length <= 4;
}

// ---------------------------------------------------------------------------
// Silhouette helpers (16×16 alpha masks)
// ---------------------------------------------------------------------------

/**
 * Jaccard distance between two boolean masks (same length).
 * 0 = identical, 1 = no overlap. Used to prove statue/amphora/bush differ.
 */
export function maskJaccardDistance(a: readonly boolean[], b: readonly boolean[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const A = a[i]!;
    const B = b[i]!;
    if (A || B) union++;
    if (A && B) inter++;
  }
  if (union === 0) return 0;
  return 1 - inter / union;
}

/** Build occupancy mask from RGBA buffer (alpha > threshold). */
export function alphaMaskFromRgba(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  alphaMin = 32
): boolean[] {
  const m = new Array<boolean>(w * h);
  for (let i = 0; i < w * h; i++) {
    m[i] = data[i * 4 + 3]! >= alphaMin;
  }
  return m;
}

/**
 * Count roof vs facade cells in a vertical strip of deco values (north→south).
 * Used to assert roof area ≥ facade area on building stamps.
 */
export function roofVsFacadeCounts(decoColumn: readonly number[]): { roof: number; facade: number } {
  let roof = 0;
  let facade = 0;
  for (const t of decoColumn) {
    if (isRoofTile(t)) roof++;
    else if (isFacadeTile(t)) facade++;
  }
  return { roof, facade };
}

/** Consecutive roof-row run length at the top of a deco column (skips empty). */
export function topRoofRun(decoColumn: readonly number[]): number {
  let i = 0;
  while (i < decoColumn.length && decoColumn[i] === 0) i++;
  let run = 0;
  while (i < decoColumn.length && isRoofTile(decoColumn[i]!)) {
    run++;
    i++;
  }
  return run;
}
