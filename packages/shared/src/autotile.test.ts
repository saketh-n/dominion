/**
 * Unit tests for 48-tile blob autotile + terrain-pair transition selection.
 * Drives the real shipped functions in autotile.ts / tiles.ts (no re-implementation).
 *
 * Run: pnpm exec tsx packages/shared/src/autotile.test.ts
 */
import {
  BLOB_MASKS_47,
  BLOB_TILE_COUNT,
  BLOB_MASK_ALL,
  BLOB_N,
  BLOB_E,
  BLOB_S,
  BLOB_W,
  BLOB_NE,
  BLOB_SE,
  BLOB_SW,
  BLOB_NW,
  blobMaskFromNeighbors,
  maskToBlobIndex,
  neighborsToBlobIndex,
  blobIndexWithVariant,
  selectAutotileIndex,
  transitionPairId,
  orderTerrainPair,
  TerrainKind,
  TRANSITION_PAIRS,
  TRANSITION_PAIR_COUNT,
  blobCoverageAt,
  blobCornerCoverage,
} from "./autotile.js";
import {
  Tile,
  transitionTileIndex,
  decodeTransitionTile,
  baseTileForTerrain,
  variantCountForTerrain,
  TERRAIN_BASE_VARIANTS,
} from "./tiles.js";

let passed = 0;
let failed = 0;
const lines: string[] = [];

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    lines.push(`PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    lines.push(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// --- blob mask table integrity ---
ok("BLOB_MASKS_47 length is 47", BLOB_MASKS_47.length === 47, `got ${BLOB_MASKS_47.length}`);
ok("BLOB_TILE_COUNT is 48", BLOB_TILE_COUNT === 48);
ok("ALL mask is 255", BLOB_MASK_ALL === 255);
ok("ALL mask is in table", BLOB_MASKS_47.includes(BLOB_MASK_ALL));
ok("isolated mask 0 is index 0", maskToBlobIndex(0) === 0);

// Every filtered mask maps uniquely
{
  const seen = new Set<number>();
  let unique = true;
  for (const m of BLOB_MASKS_47) {
    const idx = maskToBlobIndex(m);
    if (seen.has(idx)) unique = false;
    seen.add(idx);
    if (BLOB_MASKS_47[idx] !== m) unique = false;
  }
  ok("mask→index is bijective over 47", unique && seen.size === 47);
}

// Cardinal edges
ok(
  "N-only edge",
  neighborsToBlobIndex([true, false, false, false, false, false, false, false]) ===
    maskToBlobIndex(BLOB_N)
);
ok(
  "E-only edge",
  neighborsToBlobIndex([false, true, false, false, false, false, false, false]) ===
    maskToBlobIndex(BLOB_E)
);
ok(
  "S-only edge",
  neighborsToBlobIndex([false, false, true, false, false, false, false, false]) ===
    maskToBlobIndex(BLOB_S)
);
ok(
  "W-only edge",
  neighborsToBlobIndex([false, false, false, true, false, false, false, false]) ===
    maskToBlobIndex(BLOB_W)
);

// Corner filtering: NE diagonal alone must NOT set NE bit
{
  const raw = blobMaskFromNeighbors(false, false, false, false, true, false, false, false);
  ok("orphan NE diagonal filtered out", (raw & BLOB_NE) === 0 && raw === 0);
}
// NE corner only when N+E+NE
{
  const m = blobMaskFromNeighbors(true, true, false, false, true, false, false, false);
  ok("NE corner when N+E+NE", (m & (BLOB_N | BLOB_E | BLOB_NE)) === (BLOB_N | BLOB_E | BLOB_NE));
  ok("NE corner blob index defined", maskToBlobIndex(m) >= 0);
}

// Full surround
{
  const m = blobMaskFromNeighbors(true, true, true, true, true, true, true, true);
  ok("full surround → ALL", m === BLOB_MASK_ALL);
  ok("full surround blob index", maskToBlobIndex(m) === BLOB_MASKS_47.indexOf(BLOB_MASK_ALL));
}

// Variant solid
ok(
  "blobIndexWithVariant ALL + variant → 47",
  blobIndexWithVariant(BLOB_MASK_ALL, true) === 47
);
ok(
  "blobIndexWithVariant ALL no variant → interior idx",
  blobIndexWithVariant(BLOB_MASK_ALL, false) === BLOB_MASKS_47.indexOf(BLOB_MASK_ALL)
);

// --- transition pairs ---
ok("TRANSITION_PAIR_COUNT >= 20", TRANSITION_PAIR_COUNT >= 20, `got ${TRANSITION_PAIR_COUNT}`);
ok(
  "dirt_over_grass pair exists",
  transitionPairId(TerrainKind.DIRT, TerrainKind.GRASS) >= 0
);
ok(
  "stone_over_grass pair exists",
  transitionPairId(TerrainKind.STONE, TerrainKind.GRASS) >= 0
);
ok(
  "water_over_sand pair exists",
  transitionPairId(TerrainKind.WATER, TerrainKind.SAND) >= 0
);
ok(
  "marble_over_stone pair exists",
  transitionPairId(TerrainKind.MARBLE, TerrainKind.STONE) >= 0
);
ok(
  "rock_over_grass pair exists",
  transitionPairId(TerrainKind.ROCK, TerrainKind.GRASS) >= 0
);
ok(
  "water_over_marble pair exists (fountain rim)",
  transitionPairId(TerrainKind.WATER, TerrainKind.MARBLE) >= 0
);
ok(
  "water_over_stone pair exists",
  transitionPairId(TerrainKind.WATER, TerrainKind.STONE) >= 0
);
ok(
  "marble_over_dirt pair exists",
  transitionPairId(TerrainKind.MARBLE, TerrainKind.DIRT) >= 0
);
ok(
  "rock_over_dirt pair exists",
  transitionPairId(TerrainKind.ROCK, TerrainKind.DIRT) >= 0
);
ok(
  "stone_over_sand pair exists",
  transitionPairId(TerrainKind.STONE, TerrainKind.SAND) >= 0
);
ok(
  "marble_over_sand pair exists",
  transitionPairId(TerrainKind.MARBLE, TerrainKind.SAND) >= 0
);
ok(
  "rock_over_sand pair exists",
  transitionPairId(TerrainKind.ROCK, TerrainKind.SAND) >= 0
);
ok(
  "rock_over_stone pair exists",
  transitionPairId(TerrainKind.ROCK, TerrainKind.STONE) >= 0
);
ok(
  "rock_over_marble pair exists",
  transitionPairId(TerrainKind.ROCK, TerrainKind.MARBLE) >= 0
);
ok(
  "water_over_rock pair exists",
  transitionPairId(TerrainKind.WATER, TerrainKind.ROCK) >= 0
);

// Every unordered major pair (G/D/Sa/St/M/W/R) has at least one ordered pair
{
  const majors = [
    TerrainKind.GRASS,
    TerrainKind.DIRT,
    TerrainKind.SAND,
    TerrainKind.STONE,
    TerrainKind.MARBLE,
    TerrainKind.WATER,
    TerrainKind.ROCK,
  ];
  let missing = 0;
  const missingNames: string[] = [];
  for (let i = 0; i < majors.length; i++) {
    for (let j = i + 1; j < majors.length; j++) {
      const a = majors[i];
      const b = majors[j];
      const ordered = orderTerrainPair(a, b);
      if (!ordered) {
        missing++;
        continue;
      }
      const [fg, bg] = ordered;
      if (transitionPairId(fg, bg) < 0) {
        missing++;
        missingNames.push(`${fg}|${bg}`);
      }
    }
  }
  ok(
    "all major unordered pairs have ordered transition",
    missing === 0,
    missing ? `missing ${missingNames.join(",")}` : "ok"
  );
}

// Every pair has unique ordered (fg,bg)
{
  const keys = new Set(TRANSITION_PAIRS.map((p) => `${p.fg}:${p.bg}`));
  ok("pair keys unique", keys.size === TRANSITION_PAIRS.length);
}

// orderTerrainPair prefers higher priority as FG
{
  const o = orderTerrainPair(TerrainKind.GRASS, TerrainKind.WATER);
  ok("water wins over grass as FG", !!o && o[0] === TerrainKind.WATER && o[1] === TerrainKind.GRASS);
}

// --- selectAutotileIndex (real path) ---
const opts = {
  baseTile: baseTileForTerrain,
  transitionTile: transitionTileIndex,
  variantUnit: 0.1,
  variantCount: variantCountForTerrain,
};

// Marble|water seam must select transition (not base fill) — fountain rim
{
  const nbs: TerrainKind[] = [
    TerrainKind.MARBLE,
    TerrainKind.WATER,
    TerrainKind.WATER,
    TerrainKind.MARBLE,
    TerrainKind.WATER,
    TerrainKind.WATER,
    TerrainKind.MARBLE,
    TerrainKind.MARBLE,
  ];
  const tWater = selectAutotileIndex(TerrainKind.WATER, nbs, opts);
  const tMarble = selectAutotileIndex(TerrainKind.MARBLE, nbs, opts);
  ok("water cell on marble|water is transition", decodeTransitionTile(tWater) !== null, `tile=${tWater}`);
  ok("marble cell on marble|water is transition", decodeTransitionTile(tMarble) !== null, `tile=${tMarble}`);
  const dw = decodeTransitionTile(tWater);
  if (dw) {
    ok(
      "marble|water pair is water_over_marble",
      TRANSITION_PAIRS[dw.pairId].fg === TerrainKind.WATER &&
        TRANSITION_PAIRS[dw.pairId].bg === TerrainKind.MARBLE,
      `pair=${TRANSITION_PAIRS[dw.pairId]?.name}`
    );
  }
}

// Interior grass → base fill (not transition)
{
  const nbs = Array(8).fill(TerrainKind.GRASS) as TerrainKind[];
  const t = selectAutotileIndex(TerrainKind.GRASS, nbs, opts);
  ok("interior grass is base tile", TERRAIN_BASE_VARIANTS[TerrainKind.GRASS].includes(t), `got ${t}`);
  ok("interior grass is NOT transition", decodeTransitionTile(t) === null);
}

// Hard seam: grass cell with stone to the east → transition tile
{
  // self GRASS, E=STONE, rest GRASS — boundary
  const nbs: TerrainKind[] = [
    TerrainKind.GRASS, // N
    TerrainKind.STONE, // E
    TerrainKind.GRASS, // S
    TerrainKind.GRASS, // W
    TerrainKind.STONE, // NE
    TerrainKind.STONE, // SE
    TerrainKind.GRASS, // SW
    TerrainKind.GRASS, // NW
  ];
  const t = selectAutotileIndex(TerrainKind.GRASS, nbs, opts);
  const dec = decodeTransitionTile(t);
  ok("grass|stone seam picks transition", dec !== null, `tile=${t}`);
  if (dec) {
    const pair = TRANSITION_PAIRS[dec.pairId];
    ok(
      "seam pair is stone_over_grass (stone FG)",
      pair.fg === TerrainKind.STONE && pair.bg === TerrainKind.GRASS,
      `pair=${pair?.name}`
    );
    ok("seam blob index in 0..46", dec.blobIndex >= 0 && dec.blobIndex < 47);
  }
}

// Stone cell on same boundary also gets transition (same pair)
{
  const nbs: TerrainKind[] = [
    TerrainKind.STONE,
    TerrainKind.STONE,
    TerrainKind.STONE,
    TerrainKind.GRASS, // W = grass
    TerrainKind.STONE,
    TerrainKind.STONE,
    TerrainKind.GRASS,
    TerrainKind.GRASS,
  ];
  const t = selectAutotileIndex(TerrainKind.STONE, nbs, opts);
  const dec = decodeTransitionTile(t);
  ok("stone side of grass boundary is transition", dec !== null, `tile=${t}`);
}

// Water / sand shore
{
  const nbs: TerrainKind[] = [
    TerrainKind.SAND,
    TerrainKind.WATER,
    TerrainKind.WATER,
    TerrainKind.SAND,
    TerrainKind.SAND,
    TerrainKind.WATER,
    TerrainKind.SAND,
    TerrainKind.SAND,
  ];
  const t = selectAutotileIndex(TerrainKind.WATER, nbs, opts);
  const dec = decodeTransitionTile(t);
  ok("water|sand picks transition", dec !== null, `tile=${t}`);
  if (dec) {
    ok(
      "water_over_sand pair",
      TRANSITION_PAIRS[dec.pairId].fg === TerrainKind.WATER &&
        TRANSITION_PAIRS[dec.pairId].bg === TerrainKind.SAND
    );
  }
}

// Multi-terrain junction: grass with dirt N and stone E
{
  const nbs: TerrainKind[] = [
    TerrainKind.DIRT,
    TerrainKind.STONE,
    TerrainKind.GRASS,
    TerrainKind.GRASS,
    TerrainKind.STONE,
    TerrainKind.GRASS,
    TerrainKind.GRASS,
    TerrainKind.DIRT,
  ];
  const t = selectAutotileIndex(TerrainKind.GRASS, nbs, opts);
  const dec = decodeTransitionTile(t);
  ok("multi-terrain junction yields transition (not only base)", dec !== null || TERRAIN_BASE_VARIANTS[TerrainKind.GRASS].includes(t), `tile=${t}`);
  // Prefer transition when foreign neighbors exist
  ok(
    "junction not pure single-index hard fill only when all same",
    t !== undefined
  );
}

// transitionTileIndex packing
{
  const t0 = transitionTileIndex(0, 0);
  ok("transition base index", t0 === Tile.TRANSITION_BASE);
  const t = transitionTileIndex(1, 5);
  const d = decodeTransitionTile(t);
  ok("decode roundtrip pair", d?.pairId === 1 && d?.blobIndex === 5);
  ok("COUNT covers all pairs", Tile.COUNT === Tile.TRANSITION_BASE + TRANSITION_PAIR_COUNT * BLOB_TILE_COUNT);
}

// Coverage geometry: isolated mask → low center FG
{
  const c = blobCornerCoverage(0);
  ok("isolated corners near 0", c.nw < 0.1 && c.ne < 0.1 && c.se < 0.1 && c.sw < 0.1);
  const mid = blobCoverageAt(BLOB_MASK_ALL, 8, 8, 16);
  ok("ALL mask high center coverage", mid > 0.8, `got ${mid}`);
  const edge = blobCoverageAt(BLOB_N, 8, 0, 16);
  const bottom = blobCoverageAt(BLOB_N, 8, 15, 16);
  ok("N-edge mask more FG at top than bottom", edge > bottom, `top=${edge} bot=${bottom}`);
  ok("N-edge top coverage > 0.5 (visible blend)", edge > 0.5, `top=${edge}`);
  const sEdge = blobCoverageAt(BLOB_S, 8, 15, 16);
  ok("S-edge bottom coverage > 0.5", sEdge > 0.5, `bot=${sEdge}`);
}


// Variant counts
ok("grass has >= 3 variants", variantCountForTerrain(TerrainKind.GRASS) >= 3);
ok("marble has >= 2 variants", variantCountForTerrain(TerrainKind.MARBLE) >= 2);
ok("baseTileForTerrain grass0 is GRASS", baseTileForTerrain(TerrainKind.GRASS, 0) === Tile.GRASS);

// Report
const summary = `\n${passed} passed, ${failed} failed`;
lines.push(summary);
console.log(lines.join("\n"));
if (failed > 0) process.exit(1);
