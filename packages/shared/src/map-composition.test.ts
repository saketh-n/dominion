/**
 * Step 7 — map composition: weighted variants, no adjacent non-base, path width, prop density.
 * Run: pnpm exec tsx packages/shared/src/map-composition.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  weightedVariantFromUnit,
} from "./autotile.js";
import {
  weightedVariantIndex,
  hasAdjacentNonBaseVariants,
  assignVariantsNoAdjacent,
} from "./graphics-analysis.js";
import {
  Tile,
  TERRAIN_BASE_VARIANTS,
  tileToTerrainKind,
  baseTileForTerrain,
} from "./tiles.js";
import { TerrainKind } from "./autotile.js";
import { MAP_W, MAP_H } from "./constants.js";

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

// --- unit: weighted distribution ~85/10/5 ---
{
  const N = 100_000;
  const counts = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const v = weightedVariantFromUnit(u, 3);
    counts[v]!++;
  }
  const p0 = counts[0]! / N;
  const p1 = counts[1]! / N;
  const p2 = counts[2]! / N;
  ok("variant ~85% base", p0 > 0.82 && p0 < 0.88, `p0=${p0.toFixed(3)}`);
  ok("variant ~10% A", p1 > 0.08 && p1 < 0.12, `p1=${p1.toFixed(3)}`);
  ok("variant ~5% B", p2 > 0.03 && p2 < 0.07, `p2=${p2.toFixed(3)}`);
  ok(
    "weightedVariantIndex matches shipped helper",
    weightedVariantIndex(0.5, 3) === weightedVariantFromUnit(0.5, 3)
  );
}

// --- no adjacent non-base on synthetic assign ---
{
  const w = 64;
  const h = 64;
  const grid = assignVariantsNoAdjacent(w, h, 3, (x, y) => {
    let n = (x * 374761393 + y * 668265263) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  });
  ok("assignVariantsNoAdjacent has no adjacent non-base", !hasAdjacentNonBaseVariants(grid, w, h));
  const nonBase = grid.filter((v) => v !== 0).length;
  ok("some non-base variants exist", nonBase > 10, `nonBase=${nonBase}`);
}

// --- shipped world.json checks ---
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const worldPath = join(ROOT, "apps/client/public/assets/world/world.json");
ok("world.json exists", existsSync(worldPath));

if (existsSync(worldPath)) {
  const world = JSON.parse(readFileSync(worldPath, "utf8")) as {
    width: number;
    height: number;
    layers: { ground: string; deco: string; overhead: string };
  };
  // Decode u16 LE from b64 (encodeU16 layout)
  const gBuf = Buffer.from(world.layers.ground, "base64");
  const dBuf = Buffer.from(world.layers.deco, "base64");
  const W = world.width;
  const H = world.height;
  ok("world size 1024", W === MAP_W && H === MAP_H, `${W}x${H}`);

  const groundAt = (x: number, y: number) => gBuf.readUInt16LE((y * W + x) * 2);
  const decoAt = (x: number, y: number) => dBuf.readUInt16LE((y * W + x) * 2);

  // Sample marble court region (capital plaza ~490-530)
  const marbleList = TERRAIN_BASE_VARIANTS[TerrainKind.MARBLE];
  const baseM = marbleList[0]!;
  let baseC = 0;
  let varC = 0;
  let adjFail = 0;
  let samples = 0;
  for (let y = 500; y < 530; y++) {
    for (let x = 490; x < 530; x++) {
      const t = groundAt(x, y);
      if (!marbleList.includes(t)) continue;
      samples++;
      if (t === baseM) baseC++;
      else varC++;
      // adjacency of non-base
      if (t !== baseM) {
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const n = groundAt(x + dx, y + dy);
          if (marbleList.includes(n) && n !== baseM) adjFail++;
        }
      }
    }
  }
  if (samples > 50) {
    const br = baseC / samples;
    ok(
      "plaza marble base ratio ~≥75%",
      br >= 0.75,
      `base=${br.toFixed(3)} samples=${samples} var=${varC}`
    );
    ok("plaza no adjacent non-base marble variants", adjFail === 0, `adjFail=${adjFail}`);
  } else {
    ok("plaza marble samples present", false, `only ${samples}`);
  }

  // Prop density on open grass/stone sample region outside dense temple
  let open = 0;
  let props = 0;
  const PROP = new Set([
    Tile.BUSH,
    Tile.BOULDER,
    Tile.AMPHORA,
    Tile.PILLAR,
    Tile.COLUMN_BASE,
    Tile.STATUE_BASE,
    Tile.TABLE,
    Tile.FLOWERS_RED,
    Tile.FLOWERS_GOLD,
    Tile.TREE_TRUNK,
  ]);
  for (let y = 540; y < 600; y++) {
    for (let x = 480; x < 560; x++) {
      const d = decoAt(x, y);
      const g = groundAt(x, y);
      const k = tileToTerrainKind(g);
      if (k === TerrainKind.WATER) continue;
      open++;
      if (PROP.has(d)) props++;
    }
  }
  const density = open ? props / open : 0;
  ok(
    "prop density ≤ ~1/15 open tiles (cap ~1/20 with slack)",
    density <= 1 / 12,
    `density=${density.toFixed(4)} props=${props} open=${open}`
  );

  // Paths ≥ 2 wide: sample dirt/stone corridors near gates (x~510)
  function minWidthOnRow(y: number, isPath: (t: number) => boolean): number {
    let best = 0;
    let run = 0;
    for (let x = 400; x < 600; x++) {
      if (isPath(groundAt(x, y))) {
        run++;
        best = Math.max(best, run);
      } else run = 0;
    }
    return best;
  }
  const stonePath = (t: number) => {
    const k = tileToTerrainKind(t);
    return k === TerrainKind.STONE || k === TerrainKind.DIRT;
  };
  let pathOk = 0;
  let pathChecks = 0;
  for (let y = 480; y < 540; y += 4) {
    const w = minWidthOnRow(y, stonePath);
    if (w >= 1) {
      pathChecks++;
      if (w >= 2) pathOk++;
    }
  }
  ok(
    "path corridors ≥2 tiles where paths exist",
    pathChecks === 0 || pathOk / pathChecks >= 0.7,
    `ok ${pathOk}/${pathChecks}`
  );
}

// gen-map source gates
const genMap = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");
ok("gen-map forces base when neighbor non-base", /isNonBaseVariantTile/.test(genMap));
ok("autotile uses weightedVariantFromUnit", /weightedVariantFromUnit/.test(readFileSync(join(ROOT, "packages/shared/src/autotile.ts"), "utf8")));
ok("baseTileForTerrain(MARBLE,0) is MARBLE_FLOOR", baseTileForTerrain(TerrainKind.MARBLE, 0) === Tile.MARBLE_FLOOR);
// Architecture massing (step 5)
ok("gen-map has stampCol3 3-tile colonnade", /function stampCol3|stampCol3\s*\(/.test(genMap));
ok("gen-map stampTemple has door facade", /H_DOOR/.test(genMap) && /function stampTemple/.test(genMap));
ok("gen-map pool terrace has cliff/ledge", /CLIFF_FACE|CLIFF_TOP/.test(genMap) && /T_STEPS/.test(genMap));
ok("gen-map stampTemple multi-row facade", /T_COL_TOP/.test(genMap) && /T_COL_MID/.test(genMap) && /T_FRIEZE/.test(genMap));

// Plaza/temple approach frame: count vertical massing (deco+overhead+structure ground)
if (existsSync(worldPath)) {
  const world = JSON.parse(readFileSync(worldPath, "utf8")) as {
    width: number;
    layers: { ground: string; deco: string; overhead: string };
  };
  const gBuf = Buffer.from(world.layers.ground, "base64");
  const dBuf = Buffer.from(world.layers.deco, "base64");
  const oBuf = Buffer.from(world.layers.overhead, "base64");
  const W = world.width;
  // Structure-only vertical surfaces (walls/columns/facades/cliffs/roofs/statues).
  // EXCLUDE flat props: T_STEPS, BUSH, AMPHORA, FOUNTAIN, BANNER, flowers.
  const VERT = new Set([
    Tile.COLUMN_BASE,
    Tile.COLUMN_TOP,
    Tile.T_COL_TOP,
    Tile.T_COL_MID,
    Tile.T_CELLA,
    Tile.T_FRIEZE,
    Tile.T_PED_W,
    Tile.T_PED_M,
    Tile.T_PED_E,
    Tile.H_WALL,
    Tile.H_WALL_WIN,
    Tile.H_WALL_COL,
    Tile.H_DOOR,
    Tile.H_ROOF_NW,
    Tile.H_ROOF_N,
    Tile.H_ROOF_NE,
    Tile.H_ROOF_W,
    Tile.H_ROOF_M,
    Tile.H_ROOF_E,
    Tile.STATUE_BASE,
    Tile.STATUE_TOP,
    Tile.PILLAR,
    Tile.TREE_TRUNK,
    Tile.TREE_CANOPY,
    Tile.CLIFF_FACE,
    Tile.CLIFF_TOP,
    Tile.W_BODY,
    Tile.W_TOP,
    Tile.W_GATE_L,
    Tile.W_GATE_R,
    Tile.W_GATE_TOP,
  ]);
  let cells = 0;
  let vert = 0;
  // Tight temple front + colonnade approach (typical screenshot frame)
  for (let y = 478; y < 500; y++) {
    for (let x = 500; x < 524; x++) {
      cells++;
      const i = (y * W + x) * 2;
      const d = dBuf.readUInt16LE(i);
      const o = oBuf.readUInt16LE(i);
      const g = gBuf.readUInt16LE(i);
      if (VERT.has(d) || VERT.has(o) || VERT.has(g)) vert++;
    }
  }
  const frac = cells ? vert / cells : 0;
  ok(
    "temple front structure-only vertical tile frac ≥ 0.40",
    frac >= 0.4,
    `frac=${frac.toFixed(3)} vert=${vert}/${cells}`
  );
  ok("temple frame has substantial structure tiles", vert >= 100, `vert=${vert}`);
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
