/**
 * Procedural world generator: 1024x1024 tiles.
 * - Hand-templated Greco-Roman capital (walls, gates, plaza, grand temple,
 *   fountain, avenues, 100 houses with door/spawn coords)
 * - Procedural surroundings: ocean ring, beaches, plains, forests, mountains
 * - Wild-encounter mask (values = habitat: 1 field, 2 forest, 3 coast, 4 mountain)
 * - Collision grid, BFS reachability validation for all 100 house doors
 *
 * Output (identical file, two copies):
 *   apps/client/public/assets/world/world.json
 *   apps/server/data/world.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAP_W,
  MAP_H,
  WORLD_SEED,
  NUM_HOUSES,
  Tile,
  SOLID_TILES,
  HouseDef,
  WorldFile,
  encodeU16,
  bytesToB64,
  idx,
  TerrainKind,
  selectAutotileIndex,
  baseTileForTerrain,
  variantCountForTerrain,
  transitionTileIndex,
  SCATTER_DECALS,
  isWaterTile,
  tileToTerrainKind,
  TERRAIN_BASE_VARIANTS,
} from "../packages/shared/src/index.js";
import { rng } from "./pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = MAP_W;
const H = MAP_H;

const ground = new Uint16Array(W * H);
const deco = new Uint16Array(W * H);
const overhead = new Uint16Array(W * H);
const encounter = new Uint8Array(W * H);

const r = rng(WORLD_SEED);

// ---------------------------------------------------------------------------
// value noise
// ---------------------------------------------------------------------------

function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number): number => {
    let h = seed ^ (ix * 374761393) ^ (iy * 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const lattice = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => {
    // 4 octaves
    let v = 0;
    let amp = 0.5;
    let freq = 1 / 96;
    for (let o = 0; o < 4; o++) {
      v += lattice(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return v / 0.9375;
  };
}

const elevNoise = makeNoise(WORLD_SEED * 7 + 1);
const moistNoise = makeNoise(WORLD_SEED * 13 + 2);
const detailNoise = makeNoise(WORLD_SEED * 29 + 3);

// ---------------------------------------------------------------------------
// pass 1: terrain biomes
// ---------------------------------------------------------------------------

const SEA = 0.34;
const BEACH = 0.365;
const MOUNTAIN = 0.68;
const SNOWLINE = 0.8;

function edgeFalloff(x: number, y: number): number {
  // push elevation down near map borders -> ocean ring
  const dx = Math.min(x, W - 1 - x);
  const dy = Math.min(y, H - 1 - y);
  const d = Math.min(dx, dy);
  const m = 72; // falloff band width
  return d >= m ? 0 : (1 - d / m) * 0.55;
}

function elevation(x: number, y: number): number {
  let e = elevNoise(x, y);
  // mountains rise toward the north
  e += (1 - y / H) * 0.18;
  e -= edgeFalloff(x, y);
  return e;
}

console.log("terrain pass...");
// Terrain-kind grid (autotiled to tile indices after city stamp)
const terrain = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = idx(x, y, W);
    const e = elevation(x, y);
    const d = detailNoise(x * 3, y * 3);
    if (e < SEA) {
      terrain[i] = TerrainKind.WATER;
    } else if (e < BEACH) {
      terrain[i] = TerrainKind.SAND;
    } else if (e >= MOUNTAIN) {
      const e2 = e + d * 0.04;
      terrain[i] = e2 >= SNOWLINE ? TerrainKind.SNOW : TerrainKind.ROCK;
    } else {
      terrain[i] = TerrainKind.GRASS;
    }
  }
}

/** Neighbor kinds [N,E,S,W,NE,SE,SW,NW] with edge clamp. */
function neighborKinds(x: number, y: number): TerrainKind[] {
  const at = (xx: number, yy: number) =>
    terrain[idx(Math.max(0, Math.min(W - 1, xx)), Math.max(0, Math.min(H - 1, yy)), W)] as TerrainKind;
  return [
    at(x, y - 1),
    at(x + 1, y),
    at(x, y + 1),
    at(x - 1, y),
    at(x + 1, y - 1),
    at(x + 1, y + 1),
    at(x - 1, y + 1),
    at(x - 1, y - 1),
  ];
}

function hash01(x: number, y: number, salt = 0): number {
  let h = (WORLD_SEED ^ salt ^ (x * 374761393) ^ (y * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** True if ground tile is a non-base (variant A/B/…) fill for its terrain. */
function isNonBaseVariantTile(t: number): boolean {
  const k = tileToTerrainKind(t);
  if (k === null) return false;
  const list = TERRAIN_BASE_VARIANTS[k];
  if (!list || list.length < 2) return false;
  // base is list[0]; transitions are not "variants" for adjacency
  if (t >= Tile.TRANSITION_BASE) return false;
  return list.includes(t) && t !== list[0];
}

/** Bake terrain-kind grid → ground tile indices via 48-blob autotile. */
function bakeAutotileGround(x0 = 0, y0 = 0, x1 = W - 1, y1 = H - 1) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y, W);
      const self = terrain[i] as TerrainKind;
      // Preserve special stamped tiles (cliffs, wood floors, rugs, temple steps)
      const prev = ground[i];
      if (
        prev === Tile.CLIFF_FACE ||
        prev === Tile.CLIFF_TOP ||
        prev === Tile.FLOOR_WOOD ||
        prev === Tile.RUG ||
        prev === Tile.T_STEPS ||
        prev === Tile.T_FLOOR
      ) {
        continue;
      }
      let unit = hash01(x, y, 17);
      // No two non-base variants 4-adjacent: if left/up is non-base, force base (unit→0)
      const left = x > x0 ? ground[idx(x - 1, y, W)] : 0;
      const up = y > y0 ? ground[idx(x, y - 1, W)] : 0;
      if (isNonBaseVariantTile(left) || isNonBaseVariantTile(up)) {
        unit = 0; // always base
      }
      ground[i] = selectAutotileIndex(self, neighborKinds(x, y), {
        baseTile: baseTileForTerrain,
        transitionTile: transitionTileIndex,
        variantUnit: unit,
        variantCount: variantCountForTerrain,
      });
    }
  }
}

// Initial bake (wilderness); city pass overwrites terrain then re-bakes
bakeAutotileGround();

// cliff faces on south-facing mountain edges (special ground stamps)
for (let y = 1; y < H - 1; y++) {
  for (let x = 0; x < W; x++) {
    const i = idx(x, y, W);
    const isMtn = terrain[i] === TerrainKind.ROCK || terrain[i] === TerrainKind.SNOW;
    const below = terrain[i + W];
    const belowMtn = below === TerrainKind.ROCK || below === TerrainKind.SNOW;
    if (isMtn && !belowMtn) {
      ground[i] = Tile.CLIFF_FACE;
      if (terrain[i - W] === TerrainKind.ROCK) ground[i - W] = Tile.CLIFF_TOP;
    }
  }
}

// ---------------------------------------------------------------------------
// pass 2: forests, tall grass, props (outside the city, added before city stamp)
// ---------------------------------------------------------------------------

const CITY_X0 = 432;
const CITY_Y0 = 432;
const CITY_X1 = 591;
const CITY_Y1 = 591;

function inCity(x: number, y: number, pad = 8): boolean {
  return x >= CITY_X0 - pad && x <= CITY_X1 + pad && y >= CITY_Y0 - pad && y <= CITY_Y1 + pad;
}

function isGrass(t: number): boolean {
  return (
    t === Tile.GRASS ||
    t === Tile.GRASS2 ||
    t === Tile.GRASS3 ||
    t === Tile.GRASS4 ||
    // grass-over-dirt transitions still read as grass for planting
    (t >= Tile.TRANSITION_BASE && terrainKindOfGround(t) === TerrainKind.GRASS)
  );
}

function terrainKindOfGround(t: number): TerrainKind | null {
  if (t === Tile.GRASS || t === Tile.GRASS2 || t === Tile.GRASS3 || t === Tile.GRASS4) return TerrainKind.GRASS;
  if (t === Tile.DIRT_PATH || t === Tile.DIRT_PATH2 || t === Tile.DIRT_PATH3) return TerrainKind.DIRT;
  if (t === Tile.SAND || t === Tile.SAND2 || t === Tile.SAND3) return TerrainKind.SAND;
  if (t === Tile.STONE_ROAD || t === Tile.STONE_ROAD2 || t === Tile.STONE_ROAD3) return TerrainKind.STONE;
  if (t === Tile.MARBLE_FLOOR || t === Tile.MARBLE_FLOOR2 || t === Tile.MARBLE_FLOOR3) return TerrainKind.MARBLE;
  if (isWaterTile(t)) return TerrainKind.WATER;
  if (t === Tile.ROCK_GROUND || t === Tile.ROCK_GROUND2 || t === Tile.ROCK_GROUND3) return TerrainKind.ROCK;
  if (t === Tile.SNOW || t === Tile.SNOW2) return TerrainKind.SNOW;
  return null;
}

function isWalkableGround(t: number): boolean {
  if (SOLID_TILES.has(t)) return false;
  return true;
}

console.log("vegetation pass...");
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    if (inCity(x, y)) continue;
    const i = idx(x, y, W);
    if (terrain[i] !== TerrainKind.GRASS) continue;
    const m = moistNoise(x, y);
    const d = detailNoise(x * 5 + 999, y * 5 + 999);

    // forests: high moisture -> tree lattice (trunk + canopy above)
    if (m > 0.58) {
      if (x % 3 === (y % 2 === 0 ? 0 : 1) && y % 3 === 0 && d > 0.3) {
        if (deco[i] === 0 && deco[i - W] === 0 && overhead[i - W] === 0) {
          deco[i] = Tile.TREE_TRUNK;
          overhead[i - W] = Tile.TREE_CANOPY;
          continue;
        }
      }
      // forest floor tall grass in gaps
      if (d > 0.62) {
        deco[i] = Tile.TALL_GRASS;
        encounter[i] = 2; // forest habitat
        continue;
      }
    }

    // plains tall-grass patches
    if (m <= 0.58 && d > 0.66) {
      deco[i] = Tile.TALL_GRASS;
      encounter[i] = 1; // field habitat
      continue;
    }

    // scattered props — sparse (~1 per 20 open tiles) in small clusters
    // d thresholds tightened vs old 0.015/0.985 scatter
    if (d < 0.006 && (x + y) % 5 === 0) deco[i] = Tile.BUSH;
    else if (d > 0.992 && x % 4 === 0) deco[i] = Tile.BOULDER;
    else if (d > 0.988 && d <= 0.992 && (x % 3 === 0))
      deco[i] = m > 0.5 ? Tile.FLOWERS_RED : Tile.FLOWERS_GOLD;
  }
}

// coast habitat: tall grass near sand
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y, W);
    if (encounter[i] !== 1) continue;
    let nearSand = false;
    for (let dy = -5; dy <= 5 && !nearSand; dy++) {
      for (let dx = -5; dx <= 5 && !nearSand; dx++) {
        if (terrain[idx(x + dx, y + dy, W)] === TerrainKind.SAND) nearSand = true;
      }
    }
    if (nearSand) encounter[i] = 3;
  }
}

// mountain habitat: scrub tall-grass on rocky plateaus
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    if (inCity(x, y)) continue;
    const i = idx(x, y, W);
    if (terrain[i] !== TerrainKind.ROCK) continue;
    const d = detailNoise(x * 5 + 999, y * 5 + 999);
    if (d > 0.8) {
      deco[i] = Tile.TALL_GRASS;
      encounter[i] = 4;
    }
  }
}

// ---------------------------------------------------------------------------
// pass 3: the capital city
// ---------------------------------------------------------------------------

console.log("city pass...");

function fillG(x0: number, y0: number, x1: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ground[idx(x, y, W)] = t;
}
function fillTerrain(x0: number, y0: number, x1: number, y1: number, k: TerrainKind) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) terrain[idx(x, y, W)] = k;
}
function fillD(x0: number, y0: number, x1: number, y1: number, t: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) deco[idx(x, y, W)] = t;
}
function clearArea(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      deco[idx(x, y, W)] = 0;
      overhead[idx(x, y, W)] = 0;
      encounter[idx(x, y, W)] = 0;
    }
  }
}
function road(x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      terrain[idx(x, y, W)] = TerrainKind.STONE;
      deco[idx(x, y, W)] = 0;
      encounter[idx(x, y, W)] = 0;
    }
  }
}

// flatten city footprint: clear vegetation, lay lawn terrain
clearArea(CITY_X0 - 4, CITY_Y0 - 4, CITY_X1 + 4, CITY_Y1 + 4);
fillTerrain(CITY_X0 - 4, CITY_Y0 - 4, CITY_X1 + 4, CITY_Y1 + 4, TerrainKind.GRASS);

// walls (3 tall horizontal bands N/S, 2 wide vertical bands E/W)
fillD(CITY_X0, CITY_Y0, CITY_X1, CITY_Y0, Tile.W_TOP);
fillD(CITY_X0, CITY_Y0 + 1, CITY_X1, CITY_Y0 + 2, Tile.W_BODY);
fillD(CITY_X0, CITY_Y1 - 2, CITY_X1, CITY_Y1 - 2, Tile.W_TOP);
fillD(CITY_X0, CITY_Y1 - 1, CITY_X1, CITY_Y1, Tile.W_BODY);
fillD(CITY_X0, CITY_Y0, CITY_X0 + 1, CITY_Y1, Tile.W_BODY);
fillD(CITY_X1 - 1, CITY_Y0, CITY_X1, CITY_Y1, Tile.W_BODY);
// corner crenellation caps
fillD(CITY_X0, CITY_Y0, CITY_X1, CITY_Y0, Tile.W_TOP);

// gates: 2-wide openings centered on each wall
const GNX = 510; // north/south gate x (2 wide: 510-511)
const GEY = 510; // east/west gate y
// north gate
fillD(GNX - 1, CITY_Y0, GNX - 1, CITY_Y0 + 2, Tile.W_GATE_L);
fillD(GNX + 2, CITY_Y0, GNX + 2, CITY_Y0 + 2, Tile.W_GATE_R);
for (const gx of [GNX, GNX + 1]) {
  deco[idx(gx, CITY_Y0, W)] = 0;
  deco[idx(gx, CITY_Y0 + 1, W)] = Tile.W_GATE_TOP;
  deco[idx(gx, CITY_Y0 + 2, W)] = Tile.W_GATE_OPEN;
}
// south gate
fillD(GNX - 1, CITY_Y1 - 2, GNX - 1, CITY_Y1, Tile.W_GATE_L);
fillD(GNX + 2, CITY_Y1 - 2, GNX + 2, CITY_Y1, Tile.W_GATE_R);
for (const gx of [GNX, GNX + 1]) {
  deco[idx(gx, CITY_Y1 - 2, W)] = 0;
  deco[idx(gx, CITY_Y1 - 1, W)] = Tile.W_GATE_TOP;
  deco[idx(gx, CITY_Y1, W)] = Tile.W_GATE_OPEN;
}
// west & east gates (vertical walls): simple 2-tall opening
for (const gy of [GEY, GEY + 1]) {
  deco[idx(CITY_X0, gy, W)] = 0;
  deco[idx(CITY_X0 + 1, gy, W)] = 0;
  deco[idx(CITY_X1 - 1, gy, W)] = 0;
  deco[idx(CITY_X1, gy, W)] = 0;
}

// avenues (6 wide) connecting gates through the center
road(GNX - 2, CITY_Y0 + 3, GNX + 3, CITY_Y1 - 3);
road(CITY_X0 + 2, GEY - 2, CITY_X1 - 2, GEY + 3);
// gate passages
road(GNX, CITY_Y0, GNX + 1, CITY_Y0 + 2);
road(GNX, CITY_Y1 - 2, GNX + 1, CITY_Y1);
road(CITY_X0, GEY, CITY_X0 + 1, GEY + 1);
road(CITY_X1 - 1, GEY, CITY_X1, GEY + 1);

// plaza: epic Greco-Roman CAPITAL COURT (Pokemon DP density, mood-ref layout).
// Marble-dominant diamond court + large central fountain + processional stone
// avenues + corner garden courts (green break) + dense props/statues/colonnades.
// NOT a grass park with a path — Rome-as-Pokemon.
const PX0 = 478;
const PY0 = 478;
const PX1 = 545;
const PY1 = 545;
const FCX = 511.5; // fountain center
const FCY = 518.5;
// 1) Base court: continuous marble field (variants + decals break grid — NOT
// stone grit every N tiles, which autotiles into a screaming checker of
// marble_over_stone transitions). Stone only on outer rim; avenues stamped later.
for (let y = PY0; y <= PY1; y++) {
  for (let x = PX0; x <= PX1; x++) {
    const i = idx(x, y, W);
    const edge = Math.min(x - PX0, PX1 - x, y - PY0, PY1 - y);
    // single stone border ring; interior is pure marble
    terrain[i] = edge <= 1 ? TerrainKind.STONE : TerrainKind.MARBLE;
    deco[i] = 0;
    encounter[i] = 0;
  }
}
// 2) LARGE corner garden courts (mood green + breaks beige monotony)
function stampGardenCourt(gx0: number, gy0: number, gx1: number, gy1: number) {
  for (let y = gy0; y <= gy1; y++) {
    for (let x = gx0; x <= gx1; x++) {
      const i = idx(x, y, W);
      terrain[i] = TerrainKind.GRASS;
      deco[i] = 0;
      encounter[i] = 0;
    }
  }
  // stone border ring around garden
  for (let x = gx0 - 1; x <= gx1 + 1; x++) {
    terrain[idx(x, gy0 - 1, W)] = TerrainKind.STONE;
    terrain[idx(x, gy1 + 1, W)] = TerrainKind.STONE;
  }
  for (let y = gy0; y <= gy1; y++) {
    terrain[idx(gx0 - 1, y, W)] = TerrainKind.STONE;
    terrain[idx(gx1 + 1, y, W)] = TerrainKind.STONE;
  }
}
// Expanded gardens — ~18×16 each quadrant (was ~16×16)
stampGardenCourt(480, 482, 500, 504);
stampGardenCourt(523, 482, 543, 504);
stampGardenCourt(480, 524, 500, 542);
stampGardenCourt(523, 524, 543, 542);
// 3) Processional stone cross (N-S / E-W avenues) — 6 wide cobble
function stampPlazaRoad(x0: number, y0: number, x1: number, y1: number) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      const i = idx(x, y, W);
      terrain[i] = TerrainKind.STONE;
      deco[i] = 0;
      encounter[i] = 0;
    }
  }
}
// N-S avenue (through gates / temple)
stampPlazaRoad(508, PY0, 515, PY1);
// E-W avenue
stampPlazaRoad(PX0, 515, PX1, 522);
// marble accent strips flanking avenues (limited — keep processional read)
for (let y = PY0 + 4; y <= PY1 - 4; y++) {
  for (const px of [506, 517]) {
    if (terrain[idx(px, y, W)] === TerrainKind.STONE) continue;
    if (terrain[idx(px, y, W)] === TerrainKind.GRASS) continue;
    terrain[idx(px, y, W)] = TerrainKind.MARBLE;
  }
}
for (let x = PX0 + 4; x <= PX1 - 4; x++) {
  for (const py of [514, 523]) {
    const k = terrain[idx(x, py, W)];
    if (k === TerrainKind.STONE || k === TerrainKind.GRASS) continue;
    terrain[idx(x, py, W)] = TerrainKind.MARBLE;
  }
}

// grand temple at the north end of the plaza (faces south) — multi-height massing
// 2–3 tile front facade: pediment + frieze + colonnade/cella + door row + steps
function stampTemple(cx: number, topY: number, width: number) {
  // width odd, columns every 2 tiles
  const x0 = cx - (width - 1) / 2;
  const x1 = x0 + width - 1;
  // rear podium / cella wall mass (taller silhouette) — 3 rows deep
  for (let row = -3; row <= -1; row++) {
    for (let x = x0 - 2; x <= x1 + 2; x++) {
      deco[idx(x, topY + row, W)] = row === -1 ? Tile.T_FRIEZE : Tile.T_CELLA;
      terrain[idx(x, topY + row, W)] = TerrainKind.MARBLE;
    }
  }
  // pediment (3 wide centered)
  deco[idx(cx - 1, topY, W)] = Tile.T_PED_W;
  deco[idx(cx, topY, W)] = Tile.T_PED_M;
  deco[idx(cx + 1, topY, W)] = Tile.T_PED_E;
  // side pediment wings as frieze
  for (let x = x0; x <= x1; x++) {
    if (x === cx - 1 || x === cx || x === cx + 1) continue;
    deco[idx(x, topY, W)] = Tile.T_FRIEZE;
  }
  // double frieze band (entablature height) — lit top of facade
  for (let x = x0; x <= x1; x++) deco[idx(x, topY + 1, W)] = Tile.T_FRIEZE;
  // colonnade (3 rows tall massing): columns on even offsets, shadowed cella between
  // front facade height: frieze + col top + mid + base/door = 2–3 tile vertical wall read
  for (let x = x0; x <= x1; x++) {
    const isCol = (x - x0) % 2 === 0;
    deco[idx(x, topY + 2, W)] = isCol ? Tile.T_COL_TOP : Tile.T_CELLA;
    deco[idx(x, topY + 3, W)] = isCol ? Tile.T_COL_MID : Tile.T_CELLA;
    // door at center base of facade; engaged columns / wall elsewhere
    if (x === cx) {
      deco[idx(x, topY + 4, W)] = Tile.H_DOOR;
    } else if (isCol) {
      deco[idx(x, topY + 4, W)] = Tile.T_COL_MID;
    } else {
      deco[idx(x, topY + 4, W)] = Tile.H_WALL;
    }
  }
  // triple steps (walkable terrace) — multi-level approach
  for (let s = 0; s < 3; s++) {
    for (let x = x0 - 2; x <= x1 + 2; x++) {
      deco[idx(x, topY + 5 + s, W)] = 0;
      ground[idx(x, topY + 5 + s, W)] = Tile.T_STEPS;
    }
  }
  // banners on outer columns + mid spans (accent massing)
  overhead[idx(x0, topY + 1, W)] = Tile.BANNER;
  overhead[idx(x1, topY + 1, W)] = Tile.BANNER;
  overhead[idx(cx - 4, topY + 1, W)] = Tile.BANNER;
  overhead[idx(cx + 4, topY + 1, W)] = Tile.BANNER;
  overhead[idx(cx - 2, topY + 1, W)] = Tile.BANNER;
  overhead[idx(cx + 2, topY + 1, W)] = Tile.BANNER;
  // greenery / amphora accents flanking temple approach
  for (const [ax, ay, t] of [
    [x0 - 3, topY + 6, Tile.BUSH],
    [x1 + 3, topY + 6, Tile.BUSH],
    [x0 - 2, topY + 7, Tile.FLOWERS_RED],
    [x1 + 2, topY + 7, Tile.FLOWERS_GOLD],
    [x0 - 4, topY + 5, Tile.AMPHORA],
    [x1 + 4, topY + 5, Tile.AMPHORA],
    [cx - 6, topY + 8, Tile.TREE_TRUNK],
    [cx + 6, topY + 8, Tile.TREE_TRUNK],
  ] as const) {
    const i = idx(ax, ay, W);
    if (deco[i] === 0 && terrain[i] !== TerrainKind.WATER) {
      deco[i] = t;
      if (t === Tile.TREE_TRUNK) overhead[idx(ax, ay - 1, W)] = Tile.TREE_CANOPY;
    }
  }
}
// Wider multi-tile temple massing for ≥40% vertical structure in approach frame
stampTemple(511, PY0 + 3, 23);

/** Place a 3-tile-tall y-sorted plaza column: top + mid overhead, base deco. */
function stampCol3(x: number, y: number): boolean {
  const i = idx(x, y, W);
  if (deco[i] !== 0) return false;
  if (terrain[i] === TerrainKind.WATER) return false;
  deco[i] = Tile.COLUMN_BASE;
  // mid shaft one tile north; capital two tiles north
  if (y - 1 >= 0) overhead[idx(x, y - 1, W)] = Tile.T_COL_MID;
  if (y - 2 >= 0) overhead[idx(x, y - 2, W)] = Tile.COLUMN_TOP;
  return true;
}

// secondary side shrines (smaller temples) on E/W plaza terraces + south exedra
function stampShrine(cx: number, topY: number) {
  deco[idx(cx - 1, topY, W)] = Tile.T_PED_W;
  deco[idx(cx, topY, W)] = Tile.T_PED_M;
  deco[idx(cx + 1, topY, W)] = Tile.T_PED_E;
  for (let x = cx - 1; x <= cx + 1; x++) deco[idx(x, topY + 1, W)] = Tile.T_FRIEZE;
  deco[idx(cx - 1, topY + 2, W)] = Tile.T_COL_TOP;
  deco[idx(cx + 1, topY + 2, W)] = Tile.T_COL_TOP;
  deco[idx(cx, topY + 2, W)] = Tile.T_CELLA;
  deco[idx(cx - 1, topY + 3, W)] = Tile.T_COL_MID;
  deco[idx(cx + 1, topY + 3, W)] = Tile.T_COL_MID;
  deco[idx(cx, topY + 3, W)] = Tile.T_CELLA;
  for (let x = cx - 1; x <= cx + 1; x++) {
    ground[idx(x, topY + 4, W)] = Tile.T_STEPS;
    deco[idx(x, topY + 4, W)] = 0;
  }
}
stampShrine(486, PY0 + 10);
stampShrine(537, PY0 + 10);
stampShrine(486, PY1 - 14);
stampShrine(537, PY1 - 14);
// south exedra (small shrine facing north into plaza)
stampShrine(511, PY1 - 12);

// === GRAND FOUNTAIN COMPLEX (8×8 basin — mood-ref dolphin-scale mass) ===
// Outer water pool, thick marble rim, 2×2 spout tiles at center.
for (let y = 514; y <= 523; y++) {
  for (let x = 507; x <= 516; x++) {
    const dx = x - FCX;
    const dy = y - FCY;
    // circular basin radius ~5 tiles
    if (dx * dx + dy * dy > 28) continue;
    const i = idx(x, y, W);
    const r2 = dx * dx + dy * dy;
    if (r2 >= 20) {
      terrain[i] = TerrainKind.MARBLE;
      deco[i] = 0;
    } else {
      terrain[i] = TerrainKind.WATER;
      deco[i] = 0;
    }
    encounter[i] = 0;
  }
}
// central spout (2×2 fountain tiles sit on water)
deco[idx(511, 518, W)] = Tile.FOUNTAIN_NW;
deco[idx(512, 518, W)] = Tile.FOUNTAIN_NE;
deco[idx(511, 519, W)] = Tile.FOUNTAIN_SW;
deco[idx(512, 519, W)] = Tile.FOUNTAIN_SE;
// wide marble apron ring around basin (walkable court)
for (let y = 510; y <= 527; y++) {
  for (let x = 503; x <= 520; x++) {
    const dx = x - FCX;
    const dy = y - FCY;
    const r2 = dx * dx + dy * dy;
    if (r2 > 28 && r2 <= 55) {
      const i = idx(x, y, W);
      if (terrain[i] === TerrainKind.WATER) continue;
      terrain[i] = TerrainKind.MARBLE;
      deco[i] = 0;
    }
  }
}
// walkable marble bridge spokes into fountain rim (N/S/E/W) — keep avenues open
for (let t = 0; t < 4; t++) {
  for (const [bx, by] of [
    [511, 512 - t],
    [512, 512 - t],
    [511, 525 + t],
    [512, 525 + t],
    [505 - t, 518],
    [505 - t, 519],
    [518 + t, 518],
    [518 + t, 519],
  ]) {
    const i = idx(bx, by, W);
    if (terrain[i] === TerrainKind.WATER) continue;
    terrain[i] = TerrainKind.MARBLE;
    deco[i] = 0;
  }
}

// Colonnade ring around fountain — 3-tile-tall y-sorted columns
for (const [cx2, cy2] of [
  [504, 513],
  [519, 513],
  [504, 524],
  [519, 524],
  [506, 511],
  [517, 511],
  [506, 526],
  [517, 526],
  [502, 518],
  [521, 518],
  [502, 519],
  [521, 519],
  [511, 510],
  [512, 510],
  [511, 527],
  [512, 527],
  [503, 515],
  [520, 515],
  [503, 522],
  [520, 522],
  [508, 512],
  [515, 512],
  [508, 525],
  [515, 525],
]) {
  stampCol3(cx2, cy2);
}

// Pool terrace elevation: ledge/cliff ring + stairs on the four cardinals
// Raised marble terrace edge just outside the apron (r2 ~55–70)
for (let y = 508; y <= 529; y++) {
  for (let x = 501; x <= 522; x++) {
    const dx = x - FCX;
    const dy = y - FCY;
    const r2 = dx * dx + dy * dy;
    if (r2 < 55 || r2 > 72) continue;
    const i = idx(x, y, W);
    if (terrain[i] === TerrainKind.WATER) continue;
    // south-facing faces get cliff face; tops get cliff top
    const southOpen = terrain[idx(x, y + 1, W)] !== TerrainKind.WATER && (dy > 0 || Math.abs(dx) > Math.abs(dy));
    if (dy >= 2 && Math.abs(dx) <= Math.abs(dy) + 1) {
      ground[i] = Tile.CLIFF_FACE;
      terrain[i] = TerrainKind.ROCK;
      deco[i] = 0;
    } else if (r2 <= 62) {
      ground[i] = Tile.CLIFF_TOP;
      terrain[i] = TerrainKind.ROCK;
      deco[i] = 0;
    }
    void southOpen;
  }
}
// Stairs cutting through the ledge on N/S/E/W approaches
for (let t = 0; t < 3; t++) {
  for (const [sx, sy] of [
    [511, 509 + t],
    [512, 509 + t],
    [511, 526 + t],
    [512, 526 + t],
    [504 + t, 518],
    [504 + t, 519],
    [517 + t, 518],
    [517 + t, 519],
  ]) {
    const i = idx(sx, sy, W);
    ground[i] = Tile.T_STEPS;
    terrain[i] = TerrainKind.MARBLE;
    deco[i] = 0;
  }
}

// Hero statues on pedestals — dense cardinal + corner placement (mood density)
for (const [sx, sy] of [
  [500, 512],
  [523, 512],
  [500, 525],
  [523, 525],
  [505, 508],
  [518, 508],
  [505, 529],
  [518, 529],
  [495, 518],
  [528, 518],
  [498, 505],
  [525, 505],
  [498, 532],
  [525, 532],
  [PX0 + 6, PY0 + 6],
  [PX1 - 6, PY0 + 6],
  [PX0 + 6, PY1 - 6],
  [PX1 - 6, PY1 - 6],
  [490, 511],
  [533, 511],
  [490, 526],
  [533, 526],
  [501, 518],
  [522, 518],
  [511, 505],
  [512, 532],
  [494, 512],
  [529, 512],
  [494, 525],
  [529, 525],
]) {
  if (deco[idx(sx, sy, W)] !== 0) continue;
  const k = terrain[idx(sx, sy, W)];
  if (k === TerrainKind.WATER) continue;
  deco[idx(sx, sy, W)] = Tile.STATUE_BASE;
  overhead[idx(sx, sy - 1, W)] = Tile.STATUE_TOP;
}

// Processional colonnades along plaza frame + avenue edges (3-tile-tall, denser)
for (let x = PX0 + 3; x <= PX1 - 3; x += 2) {
  for (const py of [PY0 + 2, PY0 + 4, PY0 + 6, PY1 - 2, PY1 - 4, PY1 - 6]) {
    if (Math.abs(x - 511) < 4) continue;
    stampCol3(x, py);
  }
}
for (let y = PY0 + 5; y <= PY1 - 5; y += 2) {
  for (const px of [PX0 + 2, PX0 + 4, PX0 + 6, PX1 - 2, PX1 - 4, PX1 - 6]) {
    if (Math.abs(y - 518) < 4) continue;
    stampCol3(px, y);
  }
}
// Extra inner colonnade ring for vertical massing (~40%+ frame read)
for (let x = PX0 + 8; x <= PX1 - 8; x += 3) {
  for (const py of [PY0 + 8, PY1 - 8]) {
    if (Math.abs(x - 511) < 6) continue;
    stampCol3(x, py);
  }
}
for (let y = PY0 + 10; y <= PY1 - 10; y += 3) {
  for (const px of [PX0 + 8, PX1 - 8]) {
    if (Math.abs(y - 518) < 6) continue;
    stampCol3(px, y);
  }
}
// Dense 3-tile colonnade filling temple approach frame (structure-only ≥40%)
// Rows just south of temple steps through mid-approach; every other x
for (let y = PY0 + 11; y <= PY0 + 20; y += 2) {
  for (let x = 500; x <= 522; x += 2) {
    if (x >= 508 && x <= 515) continue; // keep N-S avenue open
    stampCol3(x, y);
  }
}
// Side wall runs (engaged facade mass) flanking temple approach
for (let y = PY0 + 3; y <= PY0 + 14; y++) {
  for (const px of [499, 500, 523, 524]) {
    const i = idx(px, y, W);
    if (deco[i] !== 0) continue;
    if (y === PY0 + 3) deco[i] = Tile.T_FRIEZE;
    else if (y === PY0 + 4) deco[i] = Tile.T_COL_TOP;
    else deco[i] = Tile.H_WALL_COL;
    terrain[i] = TerrainKind.MARBLE;
  }
}
// Double colonnade along N-S avenue edges — full 3-tile columns
for (let y = PY0 + 10; y <= PY1 - 10; y += 2) {
  for (const px of [506, 517]) {
    if (Math.abs(y - FCY) < 9) continue;
    stampCol3(px, y);
  }
}
// Garden props on grass courts — purposeful clusters, open rest between (~1/20)
for (let y = PY0 + 6; y <= PY1 - 6; y++) {
  for (let x = PX0 + 6; x <= PX1 - 6; x++) {
    const i = idx(x, y, W);
    if (deco[i] !== 0) continue;
    if (terrain[i] !== TerrainKind.GRASS) continue;
    // keep processional avenues clear
    if (x >= 508 && x <= 515) continue;
    if (y >= 515 && y <= 522 && x >= 500 && x <= 523) continue;
    if (Math.abs(x - FCX) < 10 && Math.abs(y - FCY) < 10) continue;
    // cluster grid: only plant on 4×4 lattice seeds + rare fill
    const cluster = x % 4 === 0 && y % 4 === 0;
    const h = detailNoise(x * 11 + 3, y * 13 + 7);
    if (!cluster && h > 0.08) continue;
    if (h < 0.04) {
      if (deco[i - W] === 0 && overhead[i - W] === 0) {
        deco[i] = Tile.TREE_TRUNK;
        overhead[i - W] = Tile.TREE_CANOPY;
      }
    } else if (h < 0.07 && cluster) {
      deco[i] = Tile.BUSH;
    } else if (h < 0.1 && cluster) {
      deco[i] = h < 0.085 ? Tile.FLOWERS_RED : Tile.FLOWERS_GOLD;
    } else if (h < 0.12 && cluster && (x + y) % 8 === 0) {
      deco[i] = Tile.AMPHORA;
    } else if (h < 0.14 && cluster && (x + y) % 10 === 0) {
      deco[i] = Tile.PILLAR;
    }
  }
}
// Marble-court props: amphorae, rugs, tables along court (not only grass)
// Rugs stamped after bake as special ground; mark with a reserved flag via deco temp? 
// We stamp rugs into ground AFTER bakeAutotile — collect coords.
const rugCells: number[] = [];
for (let y = PY0 + 8; y <= PY1 - 8; y++) {
  for (let x = PX0 + 8; x <= PX1 - 8; x++) {
    const i = idx(x, y, W);
    if (deco[i] !== 0) continue;
    if (terrain[i] !== TerrainKind.MARBLE) continue;
    if (x >= 508 && x <= 515) continue; // avenue clear
    if (y >= 515 && y <= 522) continue;
    if (Math.abs(x - FCX) < 11 && Math.abs(y - FCY) < 11) continue;
    const h = detailNoise(x * 17 + 5, y * 19 + 9);
    if (h < 0.12 && (x + y) % 3 === 0) {
      deco[i] = Tile.AMPHORA;
    } else if (h < 0.18 && (x % 4 === 0) && (y % 3 === 0)) {
      deco[i] = Tile.PILLAR;
    } else if (h < 0.22 && (x + y) % 6 === 0) {
      rugCells.push(i);
    } else if (h < 0.25 && (x % 5 === 0) && (y % 4 === 0)) {
      deco[i] = Tile.TABLE;
    }
  }
}
// Market stall rugs — dense warm color bands (mood stalls / banners)
for (let x = PX0 + 6; x <= PX1 - 6; x += 2) {
  for (const yy of [512, 513, 524, 525]) {
    if (Math.abs(x - 511) < 6) continue;
    const i = idx(x, yy, W);
    if (deco[i] !== 0) continue;
    if (terrain[i] === TerrainKind.WATER || terrain[i] === TerrainKind.GRASS) continue;
    rugCells.push(i);
    if ((x / 2) % 2 === 0) {
      if (deco[idx(x, yy - 1, W)] === 0) deco[idx(x, yy - 1, W)] = Tile.AMPHORA;
    } else if (deco[idx(x + 1, yy, W)] === 0) {
      deco[idx(x + 1, yy, W)] = Tile.TABLE;
    }
  }
}
// N-S avenue market rugs (extra warm_frac)
for (let y = PY0 + 10; y <= PY1 - 10; y += 3) {
  for (const xx of [505, 506, 517, 518]) {
    if (Math.abs(y - FCY) < 8) continue;
    const i = idx(xx, y, W);
    if (deco[i] !== 0) continue;
    if (terrain[i] === TerrainKind.WATER || terrain[i] === TerrainKind.GRASS) continue;
    rugCells.push(i);
    if (deco[idx(xx, y - 1, W)] === 0 && (y % 6 === 0)) deco[idx(xx, y - 1, W)] = Tile.AMPHORA;
  }
}
// Banners on colonnade capitals near temple / fountain approaches
for (const [bx, by] of [
  [504, 510],
  [519, 510],
  [504, 527],
  [519, 527],
  [500, 505],
  [523, 505],
  [498, 518],
  [525, 518],
]) {
  if (overhead[idx(bx, by, W)] === 0) overhead[idx(bx, by, W)] = Tile.BANNER;
}
// processional pillar avenue from south gate into plaza
for (let y = PY1 + 1; y <= Math.min(PY1 + 18, 560); y += 2) {
  for (const px of [506, 507, 516, 517]) {
    if (deco[idx(px, y, W)] !== 0) continue;
    const k = terrain[idx(px, y, W)];
    if (
      k !== TerrainKind.GRASS &&
      k !== TerrainKind.STONE &&
      k !== TerrainKind.DIRT &&
      k !== TerrainKind.MARBLE
    )
      continue;
    deco[idx(px, y, W)] = px === 507 || px === 516 ? Tile.PILLAR : Tile.AMPHORA;
  }
}

// (district shrines removed — they collided with the house grid)

// gardens: flowers along the avenues
for (let y = CITY_Y0 + 4; y <= CITY_Y1 - 4; y += 6) {
  for (const gx of [GNX - 4, GNX + 5]) {
    const i = idx(gx, y, W);
    if (deco[i] === 0 && terrain[i] === TerrainKind.GRASS)
      deco[i] = (y / 6) % 2 === 0 ? Tile.FLOWERS_RED : Tile.FLOWERS_GOLD;
  }
}

// ---------------------------------------------------------------------------
// houses: 100 in four 5x5 quadrant grids
// ---------------------------------------------------------------------------

const houses: HouseDef[] = [];

function stampHouse(hx: number, hy: number, id: number) {
  // 5 wide x 4 tall; door at (hx+2, hy+3)
  const roofTop = [Tile.H_ROOF_NW, Tile.H_ROOF_N, Tile.H_ROOF_N, Tile.H_ROOF_N, Tile.H_ROOF_NE];
  const roofBot = [Tile.H_ROOF_W, Tile.H_ROOF_M, Tile.H_ROOF_M, Tile.H_ROOF_M, Tile.H_ROOF_E];
  const wallRow = [Tile.H_WALL_COL, Tile.H_WALL_WIN, Tile.H_WALL, Tile.H_WALL_WIN, Tile.H_WALL_COL];
  const doorRow = [Tile.H_WALL, Tile.H_WALL, Tile.H_DOOR, Tile.H_WALL, Tile.H_WALL];
  for (let i2 = 0; i2 < 5; i2++) {
    deco[idx(hx + i2, hy, W)] = roofTop[i2];
    deco[idx(hx + i2, hy + 1, W)] = roofBot[i2];
    deco[idx(hx + i2, hy + 2, W)] = wallRow[i2];
    deco[idx(hx + i2, hy + 3, W)] = doorRow[i2];
  }
  const doorX = hx + 2;
  const doorY = hy + 3;
  // path from the door to the street below
  for (let py = doorY + 1; py <= hy + 5; py++) {
    terrain[idx(doorX, py, W)] = TerrainKind.DIRT;
    deco[idx(doorX, py, W)] = 0;
  }
  houses.push({ id, doorX, doorY, spawnX: doorX, spawnY: doorY + 1 });
}

const quadrants: Array<[number, number]> = [
  [438, 438], // NW
  [536, 438], // NE
  [438, 536], // SW
  [536, 536], // SE
];
let houseId = 0;
for (const [qx, qy] of quadrants) {
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      const hx = qx + cx * 10 + 2;
      const hy = qy + cy * 10 + 2;
      stampHouse(hx, hy, houseId++);
    }
  }
}

// district streets: connect every house row to the central avenues/plaza
for (const [qx, qy] of quadrants) {
  const west = qx < 500; // west quadrants extend streets east toward the avenue
  for (let cy = 0; cy < 5; cy++) {
    const sy = qy + cy * 10 + 8;
    if (sy > CITY_Y1 - 3) continue;
    // clamp against plaza rows so streets stop at the marble edge
    const inPlazaRows = sy >= PY0 - 1 && sy <= PY1 + 1;
    if (west) {
      road(qx + 1, sy, inPlazaRows ? PX0 - 1 : GNX - 3, sy);
    } else {
      road(inPlazaRows ? PX1 + 1 : GNX + 4, sy, qx + 48, sy);
    }
  }
  // vertical connector through the middle of the quadrant to the EW avenue
  const north = qy < 500;
  if (north) {
    road(qx + 24, qy + 2, qx + 25, GEY - 3);
  } else {
    road(qx + 24, GEY + 4, qx + 25, qy + 48);
  }
}

// city lawn planting: sparse clusters with open rest (~1 prop per 20 open tiles).
// Never stamp solid deco on house door/spawn tiles or the 3-tile door path.
const houseClear = new Set<number>();
for (const h of houses) {
  for (let dy = 0; dy <= 3; dy++) {
    houseClear.add(idx(h.doorX, h.doorY + dy, W));
    houseClear.add(idx(h.spawnX, h.spawnY + dy, W));
  }
  // clear flanks of door path one tile
  for (let dy = 0; dy <= 2; dy++) {
    houseClear.add(idx(h.doorX - 1, h.doorY + dy, W));
    houseClear.add(idx(h.doorX + 1, h.doorY + dy, W));
  }
}
for (let y = CITY_Y0 + 4; y <= CITY_Y1 - 4; y++) {
  for (let x = CITY_X0 + 3; x <= CITY_X1 - 3; x++) {
    const i = idx(x, y, W);
    if (houseClear.has(i)) continue;
    if (deco[i] !== 0 || terrain[i] !== TerrainKind.GRASS) continue;
    // 5×5 lattice clusters only — open lawn between
    if (x % 5 !== 0 || y % 5 !== 0) continue;
    const d = detailNoise(x * 7 + 555, y * 7 + 555);
    if (d < 0.12) {
      if (
        deco[i - W] === 0 &&
        overhead[i - W] === 0 &&
        terrain[idx(x, y - 1, W)] === TerrainKind.GRASS &&
        !houseClear.has(i - W)
      ) {
        deco[i] = Tile.TREE_TRUNK;
        overhead[i - W] = Tile.TREE_CANOPY;
      }
    } else if (d < 0.22) {
      deco[i] = d < 0.17 ? Tile.FLOWERS_RED : Tile.FLOWERS_GOLD;
    } else if (d < 0.32) {
      deco[i] = Tile.BUSH;
    } else if (d < 0.4 && (x + y) % 10 === 0) {
      deco[i] = Tile.AMPHORA;
    } else if (d < 0.48 && (x + y) % 15 === 0) {
      deco[i] = Tile.PILLAR;
    } else if (d < 0.55 && x % 15 === 0 && y % 10 === 0) {
      deco[i] = Tile.STATUE_BASE;
      if (overhead[i - W] === 0 && !houseClear.has(i - W)) overhead[i - W] = Tile.STATUE_TOP;
    }
  }
}
// Stone frontage strips along district dirt paths (breaks pure grass)
for (let y = CITY_Y0 + 4; y <= CITY_Y1 - 4; y++) {
  for (let x = CITY_X0 + 3; x <= CITY_X1 - 3; x++) {
    const i = idx(x, y, W);
    if (terrain[i] !== TerrainKind.DIRT) continue;
    terrain[i] = TerrainKind.STONE;
  }
}
// Rugs / market color near house clusters facing streets (walkable ground only)
for (const [qx, qy] of quadrants) {
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      const hx = qx + cx * 10 + 2;
      const hy = qy + cy * 10 + 2;
      const rx = hx + 2;
      const ry = hy + 6; // south of door path, not on spawn
      const ri = idx(rx, ry, W);
      if (!houseClear.has(ri) && deco[ri] === 0 && terrain[ri] !== TerrainKind.WATER) {
        rugCells.push(ri);
      }
      // single amphora accent at door (not a pair — keeps density down)
      if ((hx + hy) % 3 === 0) {
        const ax = hx + 4;
        const ay = hy + 3;
        const ai = idx(ax, ay, W);
        if (!houseClear.has(ai) && deco[ai] === 0 && terrain[ai] === TerrainKind.GRASS) {
          deco[ai] = Tile.AMPHORA;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FINAL AUTOTILE BAKE — terrain kinds → blob/transition tile indices
// ---------------------------------------------------------------------------
console.log("autotile bake...");
bakeAutotileGround();

// Special ground stamps that must not be autotiled away
for (const i of rugCells) {
  if (deco[i] === 0) ground[i] = Tile.RUG;
}
// Temple steps / floors already stamped on ground in stampTemple/Shrine — re-apply
// (bake skips T_STEPS/T_FLOOR if already set, but first bake was pre-city)
// Re-stamp temple steps that stampTemple wrote to ground before bake:
// stampTemple wrote ground T_STEPS — those were after first bake and before this bake.
// bakeAutotileGround preserves T_STEPS/T_FLOOR — good if they exist.
// Fountain water is terrain WATER → autotiled with transitions.

// Final safety: clear solid deco off every house door/spawn
for (const h of houses) {
  for (const [hx, hy] of [
    [h.doorX, h.doorY],
    [h.spawnX, h.spawnY],
    [h.doorX, h.doorY + 1],
    [h.spawnX, h.spawnY + 1],
  ] as const) {
    const i = idx(hx, hy, W);
    if (SOLID_TILES.has(deco[i])) deco[i] = 0;
    if (SOLID_TILES.has(ground[i])) {
      terrain[i] = TerrainKind.STONE;
      ground[i] = baseTileForTerrain(TerrainKind.STONE, (hx + hy) % 3);
    }
  }
}

// Scatter decals on open floors/paths/grass — low density, clustered rest areas
console.log("scatter decals...");
let scatterCount = 0;
for (let y = 2; y < H - 2; y++) {
  for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y, W);
    if (deco[i] !== 0) continue;
    if (SOLID_TILES.has(ground[i])) continue;
    if (ground[i] === Tile.RUG || ground[i] === Tile.T_STEPS || ground[i] === Tile.T_FLOOR) continue;
    const k = terrain[i] as TerrainKind;
    const h = hash01(x, y, 99);
    // ~1 prop/decal per 20 open tiles overall; prefer cluster seeds
    let chance = 0;
    if (k === TerrainKind.GRASS) chance = 0.035;
    else if (k === TerrainKind.STONE) chance = 0.03;
    else if (k === TerrainKind.MARBLE) chance = 0.025;
    else if (k === TerrainKind.DIRT) chance = 0.03;
    else if (k === TerrainKind.SAND) chance = 0.025;
    else if (k === TerrainKind.ROCK) chance = 0.02;
    else continue;
    // cluster: boost only near existing deco, else rare seed
    let nearDeco = false;
    for (let dy = -2; dy <= 2 && !nearDeco; dy++) {
      for (let dx = -2; dx <= 2 && !nearDeco; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (deco[idx(x + dx, y + dy, W)] !== 0) nearDeco = true;
      }
    }
    if (nearDeco) chance *= 1.8;
    else chance *= 0.55;
    if (h > chance) continue;
    // pick decal suited to terrain
    let pool: number[];
    if (k === TerrainKind.GRASS) {
      pool = [Tile.DECAL_TUFT, Tile.DECAL_TUFT2, Tile.DECAL_LEAF, Tile.DECAL_PEBBLES, Tile.DECAL_MOSS];
    } else if (k === TerrainKind.SAND) {
      pool = [Tile.DECAL_SHELL, Tile.DECAL_PEBBLES, Tile.DECAL_PEBBLES2, Tile.DECAL_GRAVEL];
    } else if (k === TerrainKind.MARBLE) {
      pool = [Tile.DECAL_CRACKS, Tile.DECAL_PEBBLES, Tile.DECAL_RUBBLE, Tile.DECAL_GRAVEL];
    } else if (k === TerrainKind.STONE) {
      pool = [Tile.DECAL_PEBBLES, Tile.DECAL_PEBBLES2, Tile.DECAL_RUBBLE, Tile.DECAL_GRAVEL, Tile.DECAL_MOSS];
    } else {
      pool = [...SCATTER_DECALS];
    }
    deco[i] = pool[Math.floor(hash01(x, y, 123) * pool.length) % pool.length];
    scatterCount++;
  }
}
console.log(`scatter decals placed: ${scatterCount.toLocaleString()}`);

// plaza embellishments: bronze-age flair — urns along the border
for (let x = PX0 + 4; x <= PX1 - 4; x += 6) {
  if (Math.abs(x - 511) < 5) continue;
  for (const py of [PY0 + 2, PY1 - 2]) {
    if (deco[idx(x, py, W)] === 0) deco[idx(x, py, W)] = Tile.AMPHORA;
  }
}
for (let y = PY0 + 8; y <= PY1 - 8; y += 6) {
  if (Math.abs(y - 511) < 5) continue;
  for (const pxx of [PX0 + 2, PX1 - 2]) {
    if (deco[idx(pxx, y, W)] === 0) deco[idx(pxx, y, W)] = Tile.AMPHORA;
  }
}
// heroic statues flanking the grand temple steps (outside colonnade footprint)
for (const sx of [498, 524]) {
  const sy = PY0 + 11; // just south of temple steps
  deco[idx(sx, sy, W)] = Tile.STATUE_BASE;
  overhead[idx(sx, sy - 1, W)] = Tile.STATUE_TOP;
}

// ---------------------------------------------------------------------------
// roads from the gates into the wilderness
// ---------------------------------------------------------------------------

function dirtRoad(x0: number, y0: number, x1: number, y1: number) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      const i = idx(x, y, W);
      if (terrain[i] === TerrainKind.WATER) continue;
      terrain[i] = TerrainKind.DIRT;
      // immediate local bake for road cells + neighbors for clean transitions
      deco[i] = 0;
      encounter[i] = 0;
      if (overhead[i - W] === Tile.TREE_CANOPY) overhead[i - W] = 0;
    }
  }
}
dirtRoad(GNX, 340, GNX + 1, CITY_Y0 - 1);
dirtRoad(GNX, CITY_Y1 + 1, GNX + 1, 700);
dirtRoad(340, GEY, CITY_X0 - 1, GEY + 1);
dirtRoad(CITY_X1 + 1, GEY, 700, GEY + 1);
// Re-bake corridors around dirt roads so edges blend
bakeAutotileGround(330, 330, 720, 720);
// Re-apply rugs after road bake
for (const i of rugCells) {
  if (deco[i] === 0) ground[i] = Tile.RUG;
}

// ---------------------------------------------------------------------------
// collision + validation
// ---------------------------------------------------------------------------

console.log("collision pass...");
const collision = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (SOLID_TILES.has(ground[i]) || SOLID_TILES.has(deco[i])) collision[i] = 1;
}
// map borders
for (let x = 0; x < W; x++) {
  collision[idx(x, 0, W)] = 1;
  collision[idx(x, H - 1, W)] = 1;
}
for (let y = 0; y < H; y++) {
  collision[idx(0, y, W)] = 1;
  collision[idx(W - 1, y, W)] = 1;
}

// validation: every house door + spawn walkable and reachable from the fountain
console.log("validating reachability...");
// south of fountain apron on processional road (must stay walkable)
const start = idx(513, 528, W);
if (collision[start]) throw new Error("plaza start tile is blocked!");
const visited = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
let qh = 0;
let qt = 0;
queue[qt++] = start;
visited[start] = 1;
while (qh < qt) {
  const cur = queue[qh++];
  const cx = cur % W;
  const cy = (cur / W) | 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const ni = ny * W + nx;
    if (visited[ni] || collision[ni]) continue;
    visited[ni] = 1;
    queue[qt++] = ni;
  }
}
let unreachable = 0;
for (const h of houses) {
  const di = idx(h.doorX, h.doorY, W);
  const si = idx(h.spawnX, h.spawnY, W);
  if (collision[di]) throw new Error(`house ${h.id} door is solid`);
  if (collision[si]) throw new Error(`house ${h.id} spawn is solid`);
  if (!visited[si]) {
    unreachable++;
    console.error(`house ${h.id} spawn unreachable at ${h.spawnX},${h.spawnY}`);
  }
}
if (unreachable > 0) throw new Error(`${unreachable} house spawns unreachable`);
if (houses.length !== NUM_HOUSES) throw new Error(`expected ${NUM_HOUSES} houses, got ${houses.length}`);

const reachableCount = visited.reduce((a, b) => a + b, 0);
console.log(`all ${houses.length} house doors reachable; ${reachableCount.toLocaleString()} walkable tiles connected`);

// encounter tiles must not be solid
for (let i = 0; i < W * H; i++) if (collision[i]) encounter[i] = 0;

// ---------------------------------------------------------------------------
// write output
// ---------------------------------------------------------------------------

const file: WorldFile = {
  seed: WORLD_SEED,
  width: W,
  height: H,
  houses,
  layers: {
    ground: encodeU16(ground),
    deco: encodeU16(deco),
    overhead: encodeU16(overhead),
  },
  collision: bytesToB64(collision),
  encounter: bytesToB64(encounter),
};

const json = JSON.stringify(file);
const clientDir = join(ROOT, "apps/client/public/assets/world");
const serverDir = join(ROOT, "apps/server/data");
mkdirSync(clientDir, { recursive: true });
mkdirSync(serverDir, { recursive: true });
writeFileSync(join(clientDir, "world.json"), json);
writeFileSync(join(serverDir, "world.json"), json);
console.log(`world.json written (${(json.length / 1024 / 1024).toFixed(1)} MB) to client + server`);

// stats
let water = 0;
let enc = 0;
for (let i = 0; i < W * H; i++) {
  const g2 = ground[i];
  if (g2 === Tile.WATER || g2 === Tile.WATER2 || g2 === Tile.WATER_SHORE) water++;
  if (encounter[i]) enc++;
}
console.log(
  `stats: ${W}x${H} tiles | water ${((water / (W * H)) * 100).toFixed(1)}% | encounter tiles ${enc.toLocaleString()}`
);
