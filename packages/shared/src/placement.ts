/**
 * Anchor placement grammar for plaza / city props.
 * Pure predicates — map gen and unit tests share these functions.
 */
import { Tile } from "./tiles.js";

/** Tiles that count as a wall face (vertical structure a painting/banner can hang on). */
export const WALL_FACE_TILES: ReadonlySet<number> = new Set([
  Tile.H_WALL,
  Tile.H_WALL_WIN,
  Tile.H_WALL_COL,
  Tile.W_BODY,
  Tile.W_TOP,
  Tile.W_GATE_L,
  Tile.W_GATE_R,
  Tile.T_FRIEZE,
  Tile.T_CELLA,
  Tile.T_COL_TOP,
  Tile.T_COL_MID,
  Tile.I_WALL,
  Tile.COLUMN_BASE,
  Tile.PILLAR,
]);

/** Column / capital tiles suitable for banners. */
export const COLUMN_OR_WALL_FACE: ReadonlySet<number> = new Set([
  ...WALL_FACE_TILES,
  Tile.COLUMN_TOP,
  Tile.COLUMN_SHAFT,
  Tile.T_COL_TOP,
  Tile.T_COL_MID,
]);

export type LayerView = {
  width: number;
  ground: ArrayLike<number>;
  deco: ArrayLike<number>;
  overhead: ArrayLike<number>;
};

function at(view: LayerView, x: number, y: number): { g: number; d: number; o: number } | null {
  if (x < 0 || y < 0 || x >= view.width) return null;
  const i = y * view.width + x;
  if (i < 0 || i >= view.ground.length) return null;
  return { g: view.ground[i]!, d: view.deco[i]!, o: view.overhead[i]! };
}

/** True if deco or ground at (x,y) is a wall-face tile (not open floor). */
export function isWallFace(view: LayerView, x: number, y: number): boolean {
  const c = at(view, x, y);
  if (!c) return false;
  return WALL_FACE_TILES.has(c.d) || WALL_FACE_TILES.has(c.g);
}

/** Orthogonal neighbor is a wall face (N/E/S/W). */
export function hasOrthoWallNeighbor(view: LayerView, x: number, y: number): boolean {
  return (
    isWallFace(view, x, y - 1) ||
    isWallFace(view, x, y + 1) ||
    isWallFace(view, x - 1, y) ||
    isWallFace(view, x + 1, y)
  );
}

/** Prefer corners: 2+ orthogonal wall neighbors. */
export function isWallCorner(view: LayerView, x: number, y: number): boolean {
  let n = 0;
  if (isWallFace(view, x, y - 1)) n++;
  if (isWallFace(view, x, y + 1)) n++;
  if (isWallFace(view, x - 1, y)) n++;
  if (isWallFace(view, x + 1, y)) n++;
  return n >= 2;
}

/** On plaza center axis (N-S processional), within half-width of axisX. */
export function onCenterAxis(x: number, axisX: number, halfWidth = 1): boolean {
  return Math.abs(x - axisX) <= halfWidth;
}

/**
 * Mirrored flanking entrance positions: ±offset from center on the same row,
 * or the mirrored pair of a given flank x.
 */
export function isMirroredFlankEntrance(
  x: number,
  y: number,
  axisX: number,
  entranceY: number,
  flankOffset: number,
  yTol = 1
): boolean {
  if (Math.abs(y - entranceY) > yTol) return false;
  return x === axisX - flankOffset || x === axisX + flankOffset;
}

/** Banner only on column capital / wall face cells. */
export function canPlaceBanner(view: LayerView, x: number, y: number): boolean {
  const c = at(view, x, y);
  if (!c) return false;
  if (COLUMN_OR_WALL_FACE.has(c.d) || COLUMN_OR_WALL_FACE.has(c.g)) return true;
  // Capital/shaft often lives on overhead above a column base
  if (c.o === Tile.COLUMN_TOP || c.o === Tile.COLUMN_SHAFT || c.o === Tile.T_COL_TOP) return true;
  // Cell directly above a column base
  const below = at(view, x, y + 1);
  if (below && (below.d === Tile.COLUMN_BASE || below.d === Tile.PILLAR)) return true;
  const below2 = at(view, x, y + 2);
  if (below2 && below2.d === Tile.COLUMN_BASE) return true;
  return isWallFace(view, x, y);
}

/** PAINTING only on wall-face tiles — never open floor. */
export function canPlacePainting(view: LayerView, x: number, y: number): boolean {
  return isWallFace(view, x, y);
}

/** CRATE requires an orthogonal wall neighbor (corner preferred by scorer). */
export function canPlaceCrate(view: LayerView, x: number, y: number): boolean {
  return hasOrthoWallNeighbor(view, x, y);
}

/**
 * STATUE only on plaza center axis or mirrored flanking entrances.
 */
export function canPlaceStatue(
  x: number,
  y: number,
  opts: {
    axisX: number;
    entranceYs: readonly number[];
    flankOffset: number;
    axisHalfWidth?: number;
  }
): boolean {
  if (onCenterAxis(x, opts.axisX, opts.axisHalfWidth ?? 1)) return true;
  for (const ey of opts.entranceYs) {
    if (isMirroredFlankEntrance(x, y, opts.axisX, ey, opts.flankOffset)) return true;
  }
  return false;
}

/** Path-edge: orthogonal neighbor is path (stone/dirt) while cell is not deep path center. */
export function isPathEdge(
  isPath: (x: number, y: number) => boolean,
  x: number,
  y: number
): boolean {
  if (isPath(x, y)) {
    // on path: edge if any ortho neighbor is NOT path
    return (
      !isPath(x - 1, y) || !isPath(x + 1, y) || !isPath(x, y - 1) || !isPath(x, y + 1)
    );
  }
  // off path: edge if any ortho neighbor IS path
  return isPath(x - 1, y) || isPath(x + 1, y) || isPath(x, y - 1) || isPath(x, y + 1);
}

export function canPlaceBenchOrPlanter(
  isPath: (x: number, y: number) => boolean,
  x: number,
  y: number
): boolean {
  return isPathEdge(isPath, x, y);
}

/** Per-zone density budget: max props per zone cell count. */
export type ZoneBudget = {
  id: string;
  /** Inclusive bounds */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Max solid/decor props allowed in zone (absolute). */
  maxProps: number;
  count: number;
};

export function makeZoneBudget(
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxProps: number
): ZoneBudget {
  return { id, x0, y0, x1, y1, maxProps, count: 0 };
}

export function zoneContains(z: ZoneBudget, x: number, y: number): boolean {
  return x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
}

/** Try to consume one prop slot in the first matching zone with remaining budget. */
export function tryConsumeBudget(zones: ZoneBudget[], x: number, y: number): boolean {
  for (const z of zones) {
    if (!zoneContains(z, x, y)) continue;
    if (z.count >= z.maxProps) return false;
    z.count++;
    return true;
  }
  return true; // outside all zones: allowed
}

/**
 * Mirror a list of (x,y) placements across vertical axis `axisX`.
 * Returns original + mirrored pairs (deduped).
 */
export function mirrorAcrossAxis(
  points: ReadonlyArray<{ x: number; y: number; kind: string }>,
  axisX: number
): Array<{ x: number; y: number; kind: string }> {
  const seen = new Set<string>();
  const out: Array<{ x: number; y: number; kind: string }> = [];
  const push = (p: { x: number; y: number; kind: string }) => {
    const k = `${p.kind}:${p.x},${p.y}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const p of points) {
    push(p);
    const mx = axisX * 2 - p.x;
    push({ x: mx, y: p.y, kind: p.kind });
  }
  return out;
}

/** Crate placement score: higher = better (corners preferred). */
export function crateScore(view: LayerView, x: number, y: number): number {
  if (!canPlaceCrate(view, x, y)) return -1;
  return isWallCorner(view, x, y) ? 2 : 1;
}
