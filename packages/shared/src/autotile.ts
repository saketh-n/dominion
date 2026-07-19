/**
 * 48-tile blob autotiling (Wang / blob masks) + terrain-pair transition lookup.
 *
 * Neighbor layout (bit flags after corner filtering):
 *   NW=128  N=1   NE=2
 *    W=64         E=4
 *   SW=32   S=16  SE=8
 *
 * Corners only count when both adjacent cardinals match the foreground terrain.
 * That yields 47 distinct masks; we store them as blob indices 0..46, plus
 * index 47 as an alternate solid-fill variant (48 tiles total per pair).
 */

/** Cardinal / diagonal bit flags for a filtered 8-neighbor mask. */
export const BLOB_N = 1;
export const BLOB_NE = 2;
export const BLOB_E = 4;
export const BLOB_SE = 8;
export const BLOB_S = 16;
export const BLOB_SW = 32;
export const BLOB_W = 64;
export const BLOB_NW = 128;

/** Tiles per terrain-pair blob set (47 shapes + 1 solid variant). */
export const BLOB_TILE_COUNT = 48;

/**
 * Weighted floor variant: ~85% base / 10% A / 5% B (and thin tail for n>3).
 * unit in [0,1). Exported for map tests.
 */
export function weightedVariantFromUnit(unit: number, variantCount: number): number {
  const n = Math.max(1, variantCount | 0);
  if (n === 1) return 0;
  const u = ((unit % 1) + 1) % 1;
  if (n === 2) return u < 0.85 ? 0 : 1;
  if (u < 0.85) return 0;
  if (u < 0.95) return 1;
  if (n === 3) return 2;
  const t = (u - 0.95) / 0.05;
  return 2 + Math.min(n - 3, Math.floor(t * (n - 2)));
}

/** Solid interior mask (all 8 neighbors match). */
export const BLOB_MASK_ALL = 255;

/**
 * Build a corner-filtered blob mask from 8 neighbor "same as foreground" flags.
 * Order: N, E, S, W, NE, SE, SW, NW.
 */
export function blobMaskFromNeighbors(
  n: boolean,
  e: boolean,
  s: boolean,
  w: boolean,
  ne: boolean,
  se: boolean,
  sw: boolean,
  nw: boolean
): number {
  let mask = 0;
  if (n) mask |= BLOB_N;
  if (e) mask |= BLOB_E;
  if (s) mask |= BLOB_S;
  if (w) mask |= BLOB_W;
  // Corners only when both adjacent cardinals are foreground
  if (n && e && ne) mask |= BLOB_NE;
  if (e && s && se) mask |= BLOB_SE;
  if (s && w && sw) mask |= BLOB_SW;
  if (w && n && nw) mask |= BLOB_NW;
  return mask;
}

/**
 * Canonical list of the 47 valid filtered masks (blob shapes).
 * Index in this array = blob tile index 0..46.
 */
export const BLOB_MASKS_47: readonly number[] = (() => {
  const set = new Set<number>();
  for (let bits = 0; bits < 256; bits++) {
    const n = !!(bits & BLOB_N);
    const e = !!(bits & BLOB_E);
    const s = !!(bits & BLOB_S);
    const w = !!(bits & BLOB_W);
    const ne = !!(bits & BLOB_NE);
    const se = !!(bits & BLOB_SE);
    const sw = !!(bits & BLOB_SW);
    const nw = !!(bits & BLOB_NW);
    set.add(blobMaskFromNeighbors(n, e, s, w, ne, se, sw, nw));
  }
  return Array.from(set).sort((a, b) => a - b);
})();

/** Lookup: filtered mask → blob index 0..46. */
const MASK_TO_INDEX = new Map<number, number>();
for (let i = 0; i < BLOB_MASKS_47.length; i++) {
  MASK_TO_INDEX.set(BLOB_MASKS_47[i], i);
}

/**
 * Map a filtered 8-neighbor mask to a blob tile index in 0..46.
 * Unknown masks fall back to interior (all) or isolated (0).
 */
export function maskToBlobIndex(mask: number): number {
  const hit = MASK_TO_INDEX.get(mask);
  if (hit !== undefined) return hit;
  // Re-filter arbitrary input then look up
  const n = !!(mask & BLOB_N);
  const e = !!(mask & BLOB_E);
  const s = !!(mask & BLOB_S);
  const w = !!(mask & BLOB_W);
  const ne = !!(mask & BLOB_NE);
  const se = !!(mask & BLOB_SE);
  const sw = !!(mask & BLOB_SW);
  const nw = !!(mask & BLOB_NW);
  const filtered = blobMaskFromNeighbors(n, e, s, w, ne, se, sw, nw);
  return MASK_TO_INDEX.get(filtered) ?? 0;
}

/**
 * Convenience: neighbor sameness array → blob index 0..46.
 * neighbors order: [N, E, S, W, NE, SE, SW, NW]
 */
export function neighborsToBlobIndex(same: readonly boolean[]): number {
  if (same.length < 8) throw new Error("neighborsToBlobIndex expects 8 booleans");
  const mask = blobMaskFromNeighbors(
    same[0],
    same[1],
    same[2],
    same[3],
    same[4],
    same[5],
    same[6],
    same[7]
  );
  return maskToBlobIndex(mask);
}

/**
 * Blob index 47 = alternate solid fill (used when mask is ALL and a variant is wanted).
 * Indices 0..46 map via BLOB_MASKS_47; 47 is solid-all variant.
 */
export function blobIndexWithVariant(mask: number, wantVariant: boolean): number {
  const idx = maskToBlobIndex(mask);
  if (wantVariant && mask === BLOB_MASK_ALL) return 47;
  return idx;
}

/** Terrain kinds used for pair transitions (walkable outdoor biomes). */
export enum TerrainKind {
  GRASS = 0,
  DIRT = 1,
  SAND = 2,
  STONE = 3,
  MARBLE = 4,
  WATER = 5,
  ROCK = 6,
  SNOW = 7,
}

export const TERRAIN_KIND_COUNT = 8;

/**
 * Ordered transition pairs: foreground edges over background fill.
 * Pair id is the index in this list; each gets BLOB_TILE_COUNT atlas slots.
 *
 * Priority tip: when two terrains meet, the higher-priority kind is foreground
 * (its edge blob is drawn over the lower kind's fill).
 */
/**
 * Ordered pairs for every major walkable terrain combo (grass/dirt/sand/stone/
 * marble/water/rock) plus snow↔rock. FG = higher TERRAIN_PRIORITY when both
 * meet. Each pair gets a full 48-blob set so boundaries never hard-seam.
 */
export const TRANSITION_PAIRS: readonly { fg: TerrainKind; bg: TerrainKind; name: string }[] = [
  // grass neighbors
  { fg: TerrainKind.DIRT, bg: TerrainKind.GRASS, name: "dirt_over_grass" },
  { fg: TerrainKind.SAND, bg: TerrainKind.GRASS, name: "sand_over_grass" },
  { fg: TerrainKind.STONE, bg: TerrainKind.GRASS, name: "stone_over_grass" },
  { fg: TerrainKind.MARBLE, bg: TerrainKind.GRASS, name: "marble_over_grass" },
  { fg: TerrainKind.WATER, bg: TerrainKind.GRASS, name: "water_over_grass" },
  { fg: TerrainKind.ROCK, bg: TerrainKind.GRASS, name: "rock_over_grass" },
  // dirt neighbors
  { fg: TerrainKind.SAND, bg: TerrainKind.DIRT, name: "sand_over_dirt" },
  { fg: TerrainKind.STONE, bg: TerrainKind.DIRT, name: "stone_over_dirt" },
  { fg: TerrainKind.MARBLE, bg: TerrainKind.DIRT, name: "marble_over_dirt" },
  { fg: TerrainKind.WATER, bg: TerrainKind.DIRT, name: "water_over_dirt" },
  { fg: TerrainKind.ROCK, bg: TerrainKind.DIRT, name: "rock_over_dirt" },
  // sand neighbors
  { fg: TerrainKind.STONE, bg: TerrainKind.SAND, name: "stone_over_sand" },
  { fg: TerrainKind.MARBLE, bg: TerrainKind.SAND, name: "marble_over_sand" },
  { fg: TerrainKind.WATER, bg: TerrainKind.SAND, name: "water_over_sand" },
  { fg: TerrainKind.ROCK, bg: TerrainKind.SAND, name: "rock_over_sand" },
  // stone neighbors
  { fg: TerrainKind.MARBLE, bg: TerrainKind.STONE, name: "marble_over_stone" },
  { fg: TerrainKind.WATER, bg: TerrainKind.STONE, name: "water_over_stone" },
  { fg: TerrainKind.ROCK, bg: TerrainKind.STONE, name: "rock_over_stone" },
  // marble neighbors (critical: fountain rim marble|water)
  { fg: TerrainKind.WATER, bg: TerrainKind.MARBLE, name: "water_over_marble" },
  { fg: TerrainKind.ROCK, bg: TerrainKind.MARBLE, name: "rock_over_marble" },
  // water|rock
  { fg: TerrainKind.WATER, bg: TerrainKind.ROCK, name: "water_over_rock" },
  // snow
  { fg: TerrainKind.SNOW, bg: TerrainKind.ROCK, name: "snow_over_rock" },
  { fg: TerrainKind.SNOW, bg: TerrainKind.GRASS, name: "snow_over_grass" },
  // reverse dirt/grass for soft path edges either side
  { fg: TerrainKind.GRASS, bg: TerrainKind.DIRT, name: "grass_over_dirt" },
  { fg: TerrainKind.DIRT, bg: TerrainKind.SAND, name: "dirt_over_sand" },
];

export const TRANSITION_PAIR_COUNT = TRANSITION_PAIRS.length;

/** Higher = wins as foreground when resolving a boundary. */
export const TERRAIN_PRIORITY: readonly number[] = [
  30, // GRASS
  40, // DIRT
  50, // SAND
  45, // STONE
  55, // MARBLE
  70, // WATER
  35, // ROCK
  60, // SNOW
];

/** Find pair id for (fg, bg), or -1 if that ordered pair is not generated. */
export function transitionPairId(fg: TerrainKind, bg: TerrainKind): number {
  for (let i = 0; i < TRANSITION_PAIRS.length; i++) {
    if (TRANSITION_PAIRS[i].fg === fg && TRANSITION_PAIRS[i].bg === bg) return i;
  }
  return -1;
}

/**
 * Resolve which terrain is foreground at a boundary between a and b.
 * Prefers higher TERRAIN_PRIORITY as FG; if that ordered pair is not in the
 * atlas, falls back to the reverse ordering when painted.
 * Returns [fg, bg] or null if same / unhandled.
 */
export function orderTerrainPair(
  a: TerrainKind,
  b: TerrainKind
): [TerrainKind, TerrainKind] | null {
  if (a === b) return null;
  const pa = TERRAIN_PRIORITY[a] ?? 0;
  const pb = TERRAIN_PRIORITY[b] ?? 0;
  const preferred: [TerrainKind, TerrainKind] = pa >= pb ? [a, b] : [b, a];
  if (transitionPairId(preferred[0], preferred[1]) >= 0) return preferred;
  const reverse: [TerrainKind, TerrainKind] = [preferred[1], preferred[0]];
  if (transitionPairId(reverse[0], reverse[1]) >= 0) return reverse;
  return preferred; // caller may still fail pair lookup
}

/**
 * Select the ground tile index for a cell given its terrain kind, 8-neighbor
 * kinds, variant salt, and the tile-index contract callbacks.
 *
 * Pure logic — no I/O. Callers supply base-variant and transition-tile mappers
 * so this stays free of the Tile enum (avoids circular imports in tests).
 */
export function selectAutotileIndex(
  self: TerrainKind,
  neighbors: readonly TerrainKind[], // [N,E,S,W,NE,SE,SW,NW]
  opts: {
    /** Base fill tile for a terrain + variant slot 0..n */
    baseTile: (kind: TerrainKind, variant: number) => number;
    /** Transition tile: pairId * 48 + blobIndex → absolute tile index */
    transitionTile: (pairId: number, blobIndex: number) => number;
    /** Deterministic variant picker 0..1 */
    variantUnit: number;
    /** Number of base variants available per terrain (at least 1) */
    variantCount: (kind: TerrainKind) => number;
  }
): number {
  if (neighbors.length < 8) throw new Error("selectAutotileIndex expects 8 neighbors");

  // Same-as-self for blob (true = neighbor is same terrain kind)
  const same = neighbors.map((k) => k === self);
  const allSame = same.every(Boolean);
  const variantN = Math.max(1, opts.variantCount(self));
  // Weighted ~85% base / 10% A / 5% B (not uniform — kills checkerboard)
  const variant = weightedVariantFromUnit(opts.variantUnit, variantN);

  if (allSame) {
    return opts.baseTile(self, variant);
  }

  // Dominant foreign neighbor kind (mode of non-self neighbors)
  const counts = new Map<TerrainKind, number>();
  for (let i = 0; i < 8; i++) {
    if (same[i]) continue;
    const k = neighbors[i];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let other: TerrainKind = self;
  let best = 0;
  for (const [k, c] of counts) {
    if (c > best || (c === best && (TERRAIN_PRIORITY[k] ?? 0) > (TERRAIN_PRIORITY[other] ?? 0))) {
      best = c;
      other = k;
    }
  }

  const ordered = orderTerrainPair(self, other);
  if (!ordered) return opts.baseTile(self, variant);
  const [fg, bg] = ordered;
  const pairId = transitionPairId(fg, bg);
  if (pairId < 0) {
    // No painted pair — fall back to own base (may seam; pairs cover major set)
    return opts.baseTile(self, variant);
  }

  // Blob mask: neighbors that match the FOREGROUND terrain
  const fgSame = neighbors.map((k) => k === fg);
  const mask = blobMaskFromNeighbors(
    fgSame[0],
    fgSame[1],
    fgSame[2],
    fgSame[3],
    fgSame[4],
    fgSame[5],
    fgSame[6],
    fgSame[7]
  );
  // If this cell is background, the blob still shows fg edges from neighbors;
  // if this cell is foreground, mask includes center as fg (cardinals from self).
  // Center is always "self": when self===fg, treat center as fg for coverage paint
  // (mask only encodes neighbors; painters treat center as fg when self is fg).
  const blobIdx = maskToBlobIndex(mask);

  // Interior-like masks with only weak foreign contact still use transition
  return opts.transitionTile(pairId, blobIdx);
}

/**
 * Four-corner FG coverage for painting a blob tile (0 = full BG, 1 = full FG).
 * Corners derive from the filtered neighbor mask (standard blob geometry).
 *
 * Single-cardinal edges must still push coverage past 0.5 on that side so the
 * dithered blend is visible (otherwise grass|stone looks like a hard seam).
 */
export function blobCornerCoverage(mask: number): {
  nw: number;
  ne: number;
  se: number;
  sw: number;
} {
  const n = !!(mask & BLOB_N);
  const e = !!(mask & BLOB_E);
  const s = !!(mask & BLOB_S);
  const w = !!(mask & BLOB_W);
  const ne = !!(mask & BLOB_NE);
  const se = !!(mask & BLOB_SE);
  const sw = !!(mask & BLOB_SW);
  const nw = !!(mask & BLOB_NW);

  const corner = (cardA: boolean, cardB: boolean, diag: boolean): number => {
    if (cardA && cardB) return diag ? 1 : 0.92;
    if (cardA || cardB) return 0.72; // strong half-edge so blend is visible
    return 0;
  };

  return {
    nw: corner(n, w, nw),
    ne: corner(n, e, ne),
    se: corner(s, e, se),
    sw: corner(s, w, sw),
  };
}

/**
 * Sample bilinear FG coverage at pixel center (x+0.5,y+0.5) in a tile of size `size`.
 * Also boosts coverage along cardinal edge strips for readable Wang blends.
 */
export function blobCoverageAt(mask: number, x: number, y: number, size = 16): number {
  const { nw, ne, se, sw } = blobCornerCoverage(mask);
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;
  const top = nw + (ne - nw) * u;
  const bot = sw + (se - sw) * u;
  let c = top + (bot - top) * v;

  // Cardinal edge lobes: ensure a ~half-tile feather when that neighbor is FG
  const edge = 0.55; // how far into the tile the edge lobe reaches
  if (mask & BLOB_N) {
    const t = 1 - Math.min(1, v / edge);
    c = Math.max(c, t * 0.95);
  }
  if (mask & BLOB_S) {
    const t = 1 - Math.min(1, (1 - v) / edge);
    c = Math.max(c, t * 0.95);
  }
  if (mask & BLOB_W) {
    const t = 1 - Math.min(1, u / edge);
    c = Math.max(c, t * 0.95);
  }
  if (mask & BLOB_E) {
    const t = 1 - Math.min(1, (1 - u) / edge);
    c = Math.max(c, t * 0.95);
  }
  // Interior-ish when most neighbors match
  const bits =
    (mask & BLOB_N ? 1 : 0) +
    (mask & BLOB_E ? 1 : 0) +
    (mask & BLOB_S ? 1 : 0) +
    (mask & BLOB_W ? 1 : 0);
  if (bits >= 3) c = Math.max(c, 0.55);
  if (mask === BLOB_MASK_ALL) c = 1;

  return Math.max(0, Math.min(1, c));
}
