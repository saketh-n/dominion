/**
 * Tall prop contract: multi-tile-high objects rendered as sprites >16px,
 * depth-sorted by base (foot) Y with the player.
 */
import { Tile } from "./tiles.js";
import { TILE_SIZE } from "./constants.js";
import { ySortDepth } from "./graphics-analysis.js";

/** Deco tile that is the foot of a tall prop (base tile index). */
export const TALL_PROP_BASES: ReadonlySet<number> = new Set([
  Tile.COLUMN_BASE,
  Tile.STATUE_BASE,
  Tile.TREE_TRUNK,
  Tile.PILLAR, // 1-tile tall still gets sprite + shadow treatment
]);

/** Map base deco → overhead top tile (0 if single-tile). */
export const TALL_PROP_TOP: Readonly<Record<number, number>> = {
  [Tile.COLUMN_BASE]: Tile.COLUMN_TOP,
  [Tile.STATUE_BASE]: Tile.STATUE_TOP,
  [Tile.TREE_TRUNK]: Tile.TREE_CANOPY,
  [Tile.PILLAR]: 0,
};

/** Pixel height of the composed tall sprite. */
export function tallPropPixelHeight(baseTile: number): number {
  const top = TALL_PROP_TOP[baseTile] ?? 0;
  if (top) return TILE_SIZE * 2;
  return TILE_SIZE;
}

/** True if this deco index should be lifted off the flat tile layer into a Y-sorted sprite. */
export function isTallPropBase(decoTile: number): boolean {
  return TALL_PROP_BASES.has(decoTile);
}

/**
 * Depth key for a tall prop whose foot sits on tileY.
 * Same space as the player (`10 + tileY * 0.001`).
 */
export function tallPropDepth(baseTileY: number): number {
  return ySortDepth(baseTileY, 10);
}

/**
 * When the player stands on a tile north of the prop base (playerTileY < propBaseY)
 * but still overlaps the tall sprite vertically, the prop draws on top (occludes
 * the player's lower half).
 */
export function tallPropOccludesPlayer(playerTileY: number, propBaseTileY: number): boolean {
  return tallPropDepth(propBaseTileY) > tallPropDepth(playerTileY);
}

/**
 * World pixel position for a tall prop sprite with origin (0.5, 1) at foot.
 */
export function tallPropWorldPos(tileX: number, tileY: number): { x: number; y: number } {
  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE,
  };
}
