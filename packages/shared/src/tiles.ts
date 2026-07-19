/**
 * The tile-index contract. The tileset generator draws exactly these tiles,
 * the map generator places them, and client/server read collision from them.
 * Index 0 is reserved as "empty" (transparent) for deco/overhead layers.
 *
 * Layout:
 *   0                    EMPTY
 *   1..N                 base terrain variants + props + structures
 *   TRANSITION_BASE..    48-blob sets × TRANSITION_PAIR_COUNT terrain pairs
 */
import {
  BLOB_TILE_COUNT,
  TerrainKind,
  TRANSITION_PAIR_COUNT,
  TRANSITION_PAIRS,
} from "./autotile.js";

export enum Tile {
  EMPTY = 0,

  // --- ground terrain (variants break grid repetition) ---
  GRASS = 1,
  GRASS2 = 2,
  GRASS3 = 3,
  TALL_GRASS = 4, // wild encounter tile
  DIRT_PATH = 5,
  STONE_ROAD = 6,
  STONE_ROAD2 = 7,
  MARBLE_FLOOR = 8,
  MARBLE_FLOOR2 = 9,
  SAND = 10,
  WATER = 11,
  WATER2 = 12,
  WATER_SHORE = 13, // shallow edge water
  ROCK_GROUND = 14,
  SNOW = 15,
  FLOOR_WOOD = 16, // house interiors

  // --- decoration / props (deco layer, some collide) ---
  FLOWERS_RED = 17,
  FLOWERS_GOLD = 18,
  BUSH = 19,
  BOULDER = 20,
  TREE_TRUNK = 21,
  PILLAR = 22, // freestanding marble column (1 tile)
  COLUMN_BASE = 23, // 2-tall column, bottom
  STATUE_BASE = 24, // 2-tall statue, bottom
  FOUNTAIN_NW = 25,
  FOUNTAIN_NE = 26,
  FOUNTAIN_SW = 27,
  FOUNTAIN_SE = 28,

  // --- Greco-Roman house (5 wide x 4 tall template) ---
  H_ROOF_NW = 29,
  H_ROOF_N = 30,
  H_ROOF_NE = 31,
  H_ROOF_W = 32,
  H_ROOF_M = 33,
  H_ROOF_E = 34,
  H_WALL = 35, // marble wall with frieze
  H_WALL_WIN = 36, // wall with window
  H_DOOR = 37, // door (walkable -> warp)
  H_WALL_COL = 38, // wall with engaged column

  // --- temple pieces ---
  T_PED_W = 39, // pediment left slope
  T_PED_M = 40, // pediment middle
  T_PED_E = 41, // pediment right slope
  T_FRIEZE = 42, // entablature/frieze band
  T_COL_TOP = 43, // fluted column capital
  T_COL_MID = 44, // fluted column shaft
  T_STEPS = 45, // stylobate steps (walkable)
  T_FLOOR = 46, // temple inner floor (walkable)

  // --- city wall & gate ---
  W_TOP = 47, // wall crenellation
  W_BODY = 48, // wall body (stone blocks)
  W_GATE_L = 49,
  W_GATE_R = 50,
  W_GATE_OPEN = 51, // open gate passage (walkable)

  // --- overhead layer ---
  TREE_CANOPY = 52,
  COLUMN_TOP = 53, // 2-tall column, top
  STATUE_TOP = 54, // 2-tall statue, top (hero figure)
  BANNER = 55, // hanging crimson banner

  // --- mountains/cliffs ---
  CLIFF_FACE = 56,
  CLIFF_TOP = 57,

  // --- interior ---
  I_WALL = 58, // interior wall
  RUG = 59,
  TABLE = 60,
  AMPHORA = 61, // decorative vase
  BED = 62,

  /** shadowed temple interior behind the colonnade */
  T_CELLA = 63,
  /** gate arch crown (sits above W_GATE_OPEN) */
  W_GATE_TOP = 64,

  // --- extra ground variants (anti-repetition) ---
  GRASS4 = 65,
  DIRT_PATH2 = 66,
  DIRT_PATH3 = 67,
  STONE_ROAD3 = 68,
  MARBLE_FLOOR3 = 69,
  SAND2 = 70,
  SAND3 = 71,
  WATER3 = 72,
  ROCK_GROUND2 = 73,
  ROCK_GROUND3 = 74,
  SNOW2 = 75,

  // --- scatter / decal tiles (deco layer, walkable — break grid) ---
  DECAL_PEBBLES = 76,
  DECAL_PEBBLES2 = 77,
  DECAL_TUFT = 78,
  DECAL_TUFT2 = 79,
  DECAL_LEAF = 80,
  DECAL_CRACKS = 81,
  DECAL_RUBBLE = 82,
  DECAL_SHELL = 83,
  DECAL_MOSS = 84,
  DECAL_GRAVEL = 85,

  /**
   * First index of terrain-pair blob transition sets.
   * Layout: TRANSITION_BASE + pairId * 48 + blobIndex (0..47).
   */
  TRANSITION_BASE = 86,

  /** Total tile slots = TRANSITION_BASE + pairs * 48 */
  COUNT = TRANSITION_BASE + TRANSITION_PAIR_COUNT * BLOB_TILE_COUNT,
}

/** Tiles the player cannot walk onto (checked on whichever layer they appear). */
function buildSolidTiles(): Set<number> {
  const s = new Set<number>([
    Tile.WATER,
    Tile.WATER2,
    Tile.WATER3,
    Tile.WATER_SHORE,
    Tile.BUSH,
    Tile.BOULDER,
    Tile.TREE_TRUNK,
    Tile.PILLAR,
    Tile.COLUMN_BASE,
    Tile.STATUE_BASE,
    Tile.FOUNTAIN_NW,
    Tile.FOUNTAIN_NE,
    Tile.FOUNTAIN_SW,
    Tile.FOUNTAIN_SE,
    Tile.H_ROOF_NW,
    Tile.H_ROOF_N,
    Tile.H_ROOF_NE,
    Tile.H_ROOF_W,
    Tile.H_ROOF_M,
    Tile.H_ROOF_E,
    Tile.H_WALL,
    Tile.H_WALL_WIN,
    Tile.H_WALL_COL,
    Tile.T_PED_W,
    Tile.T_PED_M,
    Tile.T_PED_E,
    Tile.T_FRIEZE,
    Tile.T_COL_TOP,
    Tile.T_COL_MID,
    Tile.W_TOP,
    Tile.W_BODY,
    Tile.W_GATE_L,
    Tile.W_GATE_R,
    Tile.CLIFF_FACE,
    Tile.T_CELLA,
    Tile.W_GATE_TOP,
    Tile.I_WALL,
    Tile.TABLE,
    Tile.AMPHORA,
    Tile.BED,
  ]);
  // Water-as-foreground transition blobs are also solid
  for (let pairId = 0; pairId < TRANSITION_PAIR_COUNT; pairId++) {
    if (TRANSITION_PAIRS[pairId].fg !== TerrainKind.WATER) continue;
    for (let b = 0; b < BLOB_TILE_COUNT; b++) {
      s.add(transitionTileIndex(pairId, b));
    }
  }
  return s;
}

export const SOLID_TILES: ReadonlySet<number> = buildSolidTiles();

/** Number of columns in the generated tileset image. */
export const TILESET_COLS = 16;

/** Absolute tile index for a transition blob. */
export function transitionTileIndex(pairId: number, blobIndex: number): number {
  if (pairId < 0 || pairId >= TRANSITION_PAIR_COUNT) {
    throw new Error(`pairId out of range: ${pairId}`);
  }
  if (blobIndex < 0 || blobIndex >= BLOB_TILE_COUNT) {
    throw new Error(`blobIndex out of range: ${blobIndex}`);
  }
  return Tile.TRANSITION_BASE + pairId * BLOB_TILE_COUNT + blobIndex;
}

/** Decode pairId + blobIndex from a transition tile, or null if not a transition. */
export function decodeTransitionTile(
  tile: number
): { pairId: number; blobIndex: number } | null {
  if (tile < Tile.TRANSITION_BASE || tile >= Tile.COUNT) return null;
  const off = tile - Tile.TRANSITION_BASE;
  return {
    pairId: Math.floor(off / BLOB_TILE_COUNT),
    blobIndex: off % BLOB_TILE_COUNT,
  };
}

/** True if tile is any water body (solid). */
export function isWaterTile(t: number): boolean {
  if (t === Tile.WATER || t === Tile.WATER2 || t === Tile.WATER3 || t === Tile.WATER_SHORE) {
    return true;
  }
  const dec = decodeTransitionTile(t);
  if (!dec) return false;
  return TRANSITION_PAIRS[dec.pairId]?.fg === TerrainKind.WATER;
}

/** Map a placed ground tile (base or transition) to its TerrainKind. */
export function tileToTerrainKind(t: number): TerrainKind | null {
  switch (t) {
    case Tile.GRASS:
    case Tile.GRASS2:
    case Tile.GRASS3:
    case Tile.GRASS4:
    case Tile.TALL_GRASS:
      return TerrainKind.GRASS;
    case Tile.DIRT_PATH:
    case Tile.DIRT_PATH2:
    case Tile.DIRT_PATH3:
      return TerrainKind.DIRT;
    case Tile.SAND:
    case Tile.SAND2:
    case Tile.SAND3:
      return TerrainKind.SAND;
    case Tile.STONE_ROAD:
    case Tile.STONE_ROAD2:
    case Tile.STONE_ROAD3:
      return TerrainKind.STONE;
    case Tile.MARBLE_FLOOR:
    case Tile.MARBLE_FLOOR2:
    case Tile.MARBLE_FLOOR3:
    case Tile.T_FLOOR:
    case Tile.T_STEPS:
    case Tile.RUG:
      return TerrainKind.MARBLE;
    case Tile.WATER:
    case Tile.WATER2:
    case Tile.WATER3:
    case Tile.WATER_SHORE:
      return TerrainKind.WATER;
    case Tile.ROCK_GROUND:
    case Tile.ROCK_GROUND2:
    case Tile.ROCK_GROUND3:
    case Tile.CLIFF_FACE:
    case Tile.CLIFF_TOP:
      return TerrainKind.ROCK;
    case Tile.SNOW:
    case Tile.SNOW2:
      return TerrainKind.SNOW;
    default: {
      const dec = decodeTransitionTile(t);
      if (!dec) return null;
      // Transition tiles store the cell's own terrain in the pair via map gen;
      // prefer FG if this was painted as edge of FG, else BG. Map gen always
      // places the transition on the cell whose kind is self — callers should
      // use terrain-id grid, not reverse from tile, when possible.
      return TRANSITION_PAIRS[dec.pairId]?.fg ?? null;
    }
  }
}

/** Base fill variants for each terrain kind (used by autotile + map gen). */
export const TERRAIN_BASE_VARIANTS: Readonly<Record<TerrainKind, readonly number[]>> = {
  [TerrainKind.GRASS]: [Tile.GRASS, Tile.GRASS2, Tile.GRASS3, Tile.GRASS4],
  [TerrainKind.DIRT]: [Tile.DIRT_PATH, Tile.DIRT_PATH2, Tile.DIRT_PATH3],
  [TerrainKind.SAND]: [Tile.SAND, Tile.SAND2, Tile.SAND3],
  [TerrainKind.STONE]: [Tile.STONE_ROAD, Tile.STONE_ROAD2, Tile.STONE_ROAD3],
  [TerrainKind.MARBLE]: [Tile.MARBLE_FLOOR, Tile.MARBLE_FLOOR2, Tile.MARBLE_FLOOR3],
  [TerrainKind.WATER]: [Tile.WATER, Tile.WATER2, Tile.WATER3],
  [TerrainKind.ROCK]: [Tile.ROCK_GROUND, Tile.ROCK_GROUND2, Tile.ROCK_GROUND3],
  [TerrainKind.SNOW]: [Tile.SNOW, Tile.SNOW2],
};

export function baseTileForTerrain(kind: TerrainKind, variant: number): number {
  const list = TERRAIN_BASE_VARIANTS[kind];
  if (!list || list.length === 0) return Tile.GRASS;
  return list[((variant % list.length) + list.length) % list.length];
}

export function variantCountForTerrain(kind: TerrainKind): number {
  return TERRAIN_BASE_VARIANTS[kind]?.length ?? 1;
}

/** Scatter decals that can sit on deco without blocking. */
export const SCATTER_DECALS: readonly number[] = [
  Tile.DECAL_PEBBLES,
  Tile.DECAL_PEBBLES2,
  Tile.DECAL_TUFT,
  Tile.DECAL_TUFT2,
  Tile.DECAL_LEAF,
  Tile.DECAL_CRACKS,
  Tile.DECAL_RUBBLE,
  Tile.DECAL_SHELL,
  Tile.DECAL_MOSS,
  Tile.DECAL_GRAVEL,
];

/** Props that must cast baked drop + contact AO shadows. */
export const SHADOW_PROPS: readonly number[] = [
  Tile.BUSH,
  Tile.BOULDER,
  Tile.TREE_TRUNK,
  Tile.PILLAR,
  Tile.COLUMN_BASE,
  Tile.STATUE_BASE,
  Tile.FOUNTAIN_NW,
  Tile.FOUNTAIN_NE,
  Tile.FOUNTAIN_SW,
  Tile.FOUNTAIN_SE,
  Tile.AMPHORA,
  Tile.TABLE,
  Tile.BED,
  Tile.TREE_CANOPY,
];
