/**
 * Tile-based interior room templates (~12×9).
 * Rendered through the same WindowedTilemap path as the overworld
 * (integer zoom 3, collision bake, y-sort).
 *
 * DP conventions:
 * - 2-tile-tall wall faces (dark top band + lit face via I_WALL rows)
 * - plank-floor seams (FLOOR_WOOD)
 * - outlined furniture with collision (TABLE, BED, AMPHORA)
 * - distinct layouts per kind (house / temple / shrine)
 * - exit = door-mat (RUG) at south edge center — exact-tile step exits
 */
import { Tile, SOLID_TILES } from "./tiles.js";
import type { InteriorKind } from "./buildings.js";
import type { WorldData } from "./world.js";
import { encodeU16, bytesToB64 } from "./world.js";

/** Interior room size in tiles (matches INTERIOR_SPAWN / EXIT_MAT). */
export const INTERIOR_ROOM_W = 12;
export const INTERIOR_ROOM_H = 9;

/** Spawn just north of the south-edge exit mat. */
export const INTERIOR_SPAWN_TILE = { x: 6, y: 7 } as const;
/** South-edge door-mat — stepping here exits (exact-tile rule). */
export const INTERIOR_EXIT_TILE = { x: 6, y: 8 } as const;

export interface InteriorLayers {
  width: number;
  height: number;
  ground: Uint16Array;
  deco: Uint16Array;
  overhead: Uint16Array;
  collision: Uint8Array;
}

function emptyLayers(w: number, h: number): InteriorLayers {
  const n = w * h;
  return {
    width: w,
    height: h,
    ground: new Uint16Array(n),
    deco: new Uint16Array(n),
    overhead: new Uint16Array(n),
    collision: new Uint8Array(n),
  };
}

function at(L: InteriorLayers, x: number, y: number): number {
  return y * L.width + x;
}

function setG(L: InteriorLayers, x: number, y: number, t: number): void {
  if (x < 0 || y < 0 || x >= L.width || y >= L.height) return;
  L.ground[at(L, x, y)] = t;
}

function setD(L: InteriorLayers, x: number, y: number, t: number): void {
  if (x < 0 || y < 0 || x >= L.width || y >= L.height) return;
  L.deco[at(L, x, y)] = t;
}

function bakeCollision(L: InteriorLayers): void {
  const n = L.width * L.height;
  for (let i = 0; i < n; i++) {
    const g = L.ground[i]!;
    const d = L.deco[i]!;
    const o = L.overhead[i]!;
    L.collision[i] =
      SOLID_TILES.has(g) || SOLID_TILES.has(d) || SOLID_TILES.has(o) ? 1 : 0;
  }
  // Perimeter walls stay solid even when deco is a wall-face painting.
  const W = L.width;
  const H = L.height;
  for (let x = 0; x < W; x++) {
    L.collision[at(L, x, 0)] = 1;
    L.collision[at(L, x, 1)] = 1;
    if (x !== INTERIOR_EXIT_TILE.x) L.collision[at(L, x, H - 1)] = 1;
  }
  for (let y = 2; y < H - 1; y++) {
    L.collision[at(L, 0, y)] = 1;
    L.collision[at(L, W - 1, y)] = 1;
  }
  // Exit mat + spawn must always be walkable
  const ex = at(L, INTERIOR_EXIT_TILE.x, INTERIOR_EXIT_TILE.y);
  const sp = at(L, INTERIOR_SPAWN_TILE.x, INTERIOR_SPAWN_TILE.y);
  L.collision[ex] = 0;
  L.collision[sp] = 0;
  L.deco[ex] = Tile.RUG; // door-mat visual
}

/** Fill floor + 2-tile-tall perimeter walls + south door gap. */
function baseRoom(floorTile: number): InteriorLayers {
  const L = emptyLayers(INTERIOR_ROOM_W, INTERIOR_ROOM_H);
  const W = L.width;
  const H = L.height;

  // Floor
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      setG(L, x, y, floorTile);
    }
  }

  // 2-tile-tall wall faces on north edge: y=0 dark top band, y=1 lit face
  // Side walls y=0..H-2; south edge open at exit mat with wall flanks
  for (let x = 0; x < W; x++) {
    setD(L, x, 0, Tile.I_WALL); // dark top band
    setD(L, x, 1, Tile.I_WALL); // lit wall face
  }
  for (let y = 2; y < H - 1; y++) {
    setD(L, 0, y, Tile.I_WALL);
    setD(L, W - 1, y, Tile.I_WALL);
  }
  // South wall with center door gap at exit mat
  for (let x = 0; x < W; x++) {
    if (x === INTERIOR_EXIT_TILE.x) continue;
    setD(L, x, H - 1, Tile.I_WALL);
  }
  // Corners already covered
  return L;
}

function buildHouse(): InteriorLayers {
  const L = baseRoom(Tile.FLOOR_WOOD);
  // Bed against north wall face
  setD(L, 2, 2, Tile.BED);
  setD(L, 3, 2, Tile.BED);
  // Table + amphora
  setD(L, 8, 3, Tile.TABLE);
  setD(L, 9, 3, Tile.AMPHORA);
  // Center rug (not exit)
  setD(L, 5, 4, Tile.RUG);
  setD(L, 6, 4, Tile.RUG);
  // Side crate / painting accents
  setD(L, 1, 4, Tile.CRATE);
  setD(L, 10, 2, Tile.PAINTING);
  setD(L, 2, 5, Tile.AMPHORA);
  bakeCollision(L);
  return L;
}

function buildTemple(): InteriorLayers {
  const L = baseRoom(Tile.T_FLOOR);
  // Marble-like aisle + side columns (engaged via wall col tiles as deco)
  for (let y = 2; y <= 6; y++) {
    setG(L, 5, y, Tile.MARBLE_FLOOR);
    setG(L, 6, y, Tile.MARBLE_FLOOR);
  }
  // Colonnade flanks (solid bases)
  for (const x of [2, 9]) {
    setD(L, x, 2, Tile.COLUMN_BASE);
    setD(L, x, 3, Tile.COLUMN_BASE);
    setD(L, x, 5, Tile.COLUMN_BASE);
  }
  // Altar table + rugs
  setD(L, 5, 3, Tile.TABLE);
  setD(L, 6, 3, Tile.TABLE);
  setD(L, 5, 5, Tile.RUG);
  setD(L, 6, 5, Tile.RUG);
  // Amphorae
  setD(L, 3, 6, Tile.AMPHORA);
  setD(L, 8, 6, Tile.AMPHORA);
  setD(L, 1, 3, Tile.PAINTING);
  setD(L, 10, 3, Tile.PAINTING);
  bakeCollision(L);
  return L;
}

function buildShrine(): InteriorLayers {
  const L = baseRoom(Tile.STONE_ROAD);
  // Smaller sacred focus
  setD(L, 5, 3, Tile.TABLE);
  setD(L, 6, 3, Tile.AMPHORA);
  setD(L, 5, 4, Tile.RUG);
  setD(L, 6, 4, Tile.RUG);
  setD(L, 3, 2, Tile.COLUMN_BASE);
  setD(L, 8, 2, Tile.COLUMN_BASE);
  setD(L, 2, 5, Tile.AMPHORA);
  setD(L, 9, 5, Tile.AMPHORA);
  setD(L, 1, 2, Tile.PAINTING);
  setD(L, 10, 2, Tile.PAINTING);
  bakeCollision(L);
  return L;
}

const CACHE = new Map<InteriorKind, InteriorLayers>();

/** Get (cached) interior layers for a building kind. */
export function getInteriorLayers(kind: InteriorKind): InteriorLayers {
  let L = CACHE.get(kind);
  if (!L) {
    if (kind === "temple") L = buildTemple();
    else if (kind === "shrine") L = buildShrine();
    else L = buildHouse();
    CACHE.set(kind, L);
  }
  return L;
}

/** WorldData view of an interior room (for WorldModel / WindowedTilemap). */
export function buildInteriorWorld(kind: InteriorKind): WorldData {
  const L = getInteriorLayers(kind);
  return {
    seed: 0,
    width: L.width,
    height: L.height,
    houses: [],
    ground: L.ground,
    deco: L.deco,
    overhead: L.overhead,
    collision: L.collision,
    encounter: new Uint8Array(L.width * L.height),
  };
}

/** True if (x,y) is the south-edge exit mat. */
export function isInteriorExitTile(x: number, y: number): boolean {
  return x === INTERIOR_EXIT_TILE.x && y === INTERIOR_EXIT_TILE.y;
}

/** Encode interior as a mini WorldFile-shaped object (tests / tooling). */
export function encodeInteriorFile(kind: InteriorKind) {
  const L = getInteriorLayers(kind);
  return {
    width: L.width,
    height: L.height,
    kind,
    layers: {
      ground: encodeU16(L.ground),
      deco: encodeU16(L.deco),
      overhead: encodeU16(L.overhead),
    },
    collision: bytesToB64(L.collision),
  };
}
