/**
 * Multi-tile prop stamps: explicit ground footprint + collision bits.
 * Collision is written from the stamp's declared footprint at stamp time —
 * never derived solely by scanning overhead-layer art.
 */
import { Tile, SOLID_TILES } from "./tiles.js";

/** One cell of a stamp relative to the anchor (foot) tile. */
export type StampCell = {
  dx: number;
  dy: number;
  /** Layer the art is written to. Overhead never contributes collision alone. */
  layer: "ground" | "deco" | "overhead";
  tile: number;
  /** When true, this cell is part of the solid ground footprint. */
  solid?: boolean;
};

export type PropStampDef = {
  id: string;
  cells: readonly StampCell[];
};

/** Declared solid footprint cells (dx,dy from anchor). */
export function stampFootprint(stamp: PropStampDef): ReadonlyArray<{ dx: number; dy: number }> {
  return stamp.cells.filter((c) => c.solid).map((c) => ({ dx: c.dx, dy: c.dy }));
}

/**
 * True if every solid footprint cell has non-empty ground-level art
 * (ground or deco layer) on the same cell — never overhead-only.
 */
export function stampSolidHasGroundArt(stamp: PropStampDef): boolean {
  const solids = stamp.cells.filter((c) => c.solid);
  if (solids.length === 0) return true;
  for (const s of solids) {
    const groundArt = stamp.cells.find(
      (c) =>
        c.dx === s.dx &&
        c.dy === s.dy &&
        (c.layer === "ground" || c.layer === "deco") &&
        c.tile !== Tile.EMPTY &&
        c.tile !== 0
    );
    if (!groundArt) return false;
  }
  return true;
}

/** Layers a stamp applicator mutates. */
export type StampLayers = {
  width: number;
  height: number;
  ground: Uint16Array;
  deco: Uint16Array;
  overhead: Uint16Array;
  /** Collision bits written from footprints (1 = blocked). */
  collision: Uint8Array;
};

function cellIndex(layers: StampLayers, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= layers.width || y >= layers.height) return null;
  return y * layers.width + x;
}

export type ApplyStampResult = {
  ok: boolean;
  /** Absolute cells where collision was set from footprint. */
  writtenCollision: Array<{ x: number; y: number }>;
  /** Absolute solid footprint cells declared by the stamp. */
  declaredFootprint: Array<{ x: number; y: number }>;
};

/**
 * Apply a multi-tile prop stamp at anchor (ax, ay).
 * Writes art layers and sets collision bits exactly on declared solid footprint.
 */
export function applyPropStamp(
  layers: StampLayers,
  stamp: PropStampDef,
  ax: number,
  ay: number,
  opts: { overwrite?: boolean } = {}
): ApplyStampResult {
  const declaredFootprint: Array<{ x: number; y: number }> = [];
  const writtenCollision: Array<{ x: number; y: number }> = [];
  const overwrite = opts.overwrite ?? true;

  // Bounds + occupancy check
  for (const c of stamp.cells) {
    const x = ax + c.dx;
    const y = ay + c.dy;
    const i = cellIndex(layers, x, y);
    if (i === null) return { ok: false, writtenCollision, declaredFootprint };
    if (!overwrite && c.layer === "deco" && layers.deco[i] !== 0 && c.tile !== 0) {
      return { ok: false, writtenCollision, declaredFootprint };
    }
  }

  for (const c of stamp.cells) {
    const x = ax + c.dx;
    const y = ay + c.dy;
    const i = cellIndex(layers, x, y)!;
    if (c.layer === "ground") layers.ground[i] = c.tile;
    else if (c.layer === "deco") layers.deco[i] = c.tile;
    else layers.overhead[i] = c.tile;

    if (c.solid) {
      declaredFootprint.push({ x, y });
      layers.collision[i] = 1;
      writtenCollision.push({ x, y });
    }
  }

  return { ok: true, writtenCollision, declaredFootprint };
}

/**
 * Assert footprint == collision bits written for a single apply result.
 */
export function footprintMatchesCollision(result: ApplyStampResult): boolean {
  if (!result.ok) return false;
  if (result.declaredFootprint.length !== result.writtenCollision.length) return false;
  const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
  const a = new Set(result.declaredFootprint.map(key));
  const b = new Set(result.writtenCollision.map(key));
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Catalog of multi-tile prop stamps used by map gen
// ---------------------------------------------------------------------------

/** 3-tall plaza column: solid base only; mid shaft + capital are overhead (non-blocking art). */
export const STAMP_COLUMN_3: PropStampDef = {
  id: "column_3",
  cells: [
    { dx: 0, dy: 0, layer: "deco", tile: Tile.COLUMN_BASE, solid: true },
    { dx: 0, dy: -1, layer: "overhead", tile: Tile.COLUMN_SHAFT, solid: false },
    { dx: 0, dy: -2, layer: "overhead", tile: Tile.COLUMN_TOP, solid: false },
  ],
};

/** 2-tall statue: solid base only. */
export const STAMP_STATUE: PropStampDef = {
  id: "statue",
  cells: [
    { dx: 0, dy: 0, layer: "deco", tile: Tile.STATUE_BASE, solid: true },
    { dx: 0, dy: -1, layer: "overhead", tile: Tile.STATUE_TOP, solid: false },
  ],
};

/** Tree: solid trunk; canopy overhead. */
export const STAMP_TREE: PropStampDef = {
  id: "tree",
  cells: [
    { dx: 0, dy: 0, layer: "deco", tile: Tile.TREE_TRUNK, solid: true },
    { dx: 0, dy: -1, layer: "overhead", tile: Tile.TREE_CANOPY, solid: false },
  ],
};

/**
 * Fountain 2×2 rim assembly on water.
 * All four rim tiles are solid and carry ground-level (deco) art filling the tile.
 * Interior basin water is separate terrain (not this stamp).
 */
export const STAMP_FOUNTAIN_2X2: PropStampDef = {
  id: "fountain_2x2",
  cells: [
    { dx: 0, dy: 0, layer: "deco", tile: Tile.FOUNTAIN_NW, solid: true },
    { dx: 1, dy: 0, layer: "deco", tile: Tile.FOUNTAIN_NE, solid: true },
    { dx: 0, dy: 1, layer: "deco", tile: Tile.FOUNTAIN_SW, solid: true },
    { dx: 1, dy: 1, layer: "deco", tile: Tile.FOUNTAIN_SE, solid: true },
  ],
};

/** Single-tile solid props. */
export const STAMP_PILLAR: PropStampDef = {
  id: "pillar",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.PILLAR, solid: true }],
};

export const STAMP_CRATE: PropStampDef = {
  id: "crate",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.CRATE, solid: true }],
};

export const STAMP_BENCH: PropStampDef = {
  id: "bench",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.BENCH, solid: true }],
};

export const STAMP_PLANTER: PropStampDef = {
  id: "planter",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.PLANTER, solid: true }],
};

export const STAMP_AMPHORA: PropStampDef = {
  id: "amphora",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.AMPHORA, solid: true }],
};

export const STAMP_BUSH: PropStampDef = {
  id: "bush",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.BUSH, solid: true }],
};

export const STAMP_TABLE: PropStampDef = {
  id: "table",
  cells: [{ dx: 0, dy: 0, layer: "deco", tile: Tile.TABLE, solid: true }],
};

/**
 * Painting hangs on wall face — solid wall already blocks on deco/ground.
 * Painting art is overhead so it never replaces the wall's ground-level solid tile.
 */
export const STAMP_PAINTING: PropStampDef = {
  id: "painting",
  cells: [{ dx: 0, dy: 0, layer: "overhead", tile: Tile.PAINTING, solid: false }],
};

/** Banner on column/wall face (overhead hang). */
export const STAMP_BANNER: PropStampDef = {
  id: "banner",
  cells: [{ dx: 0, dy: 0, layer: "overhead", tile: Tile.BANNER, solid: false }],
};

/** All multi-tile / solid prop stamps that must pass footprint==collision + ground-art checks. */
export const ALL_PROP_STAMPS: readonly PropStampDef[] = [
  STAMP_COLUMN_3,
  STAMP_STATUE,
  STAMP_TREE,
  STAMP_FOUNTAIN_2X2,
  STAMP_PILLAR,
  STAMP_CRATE,
  STAMP_BENCH,
  STAMP_PLANTER,
  STAMP_AMPHORA,
  STAMP_BUSH,
  STAMP_TABLE,
];

/**
 * After stamp passes, merge remaining SOLID_TILES on ground/deco that were
 * placed outside the stamp system (walls, water, cliffs, houses).
 * Does NOT treat overhead-only tiles as solid.
 */
export function mergeLayerScanCollision(layers: StampLayers): void {
  const n = layers.width * layers.height;
  for (let i = 0; i < n; i++) {
    if (layers.collision[i]) continue;
    const g = layers.ground[i]!;
    const d = layers.deco[i]!;
    // Overhead is intentionally ignored here — blocking surfaces must have ground/deco art.
    if (SOLID_TILES.has(g) || SOLID_TILES.has(d)) layers.collision[i] = 1;
  }
}
