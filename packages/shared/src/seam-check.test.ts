/**
 * Structural seam check against shipped world.json.
 * Asserts major terrain base-base hard adjacencies are gone after autotile bake
 * (especially marble|water at the fountain).
 *
 * Run: pnpm exec tsx packages/shared/src/seam-check.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeWorld,
  WorldFile,
  Tile,
  decodeTransitionTile,
  TerrainKind,
  TERRAIN_BASE_VARIANTS,
  transitionPairId,
  orderTerrainPair,
  TRANSITION_PAIRS,
} from "./index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const worldPath = join(ROOT, "apps/server/data/world.json");

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

/** Special ground stamps (not autotiled terrain bases) — excluded from hard-seam counts. */
const SPECIAL_GROUND = new Set<number>([
  Tile.CLIFF_FACE,
  Tile.CLIFF_TOP,
  Tile.T_STEPS,
  Tile.T_FLOOR,
  Tile.RUG,
  Tile.FLOOR_WOOD,
  Tile.TALL_GRASS, // deco-ish encounter ground
]);

function kindOfBase(t: number): TerrainKind | null {
  for (const [k, list] of Object.entries(TERRAIN_BASE_VARIANTS)) {
    if ((list as readonly number[]).includes(t)) return Number(k) as TerrainKind;
  }
  if (t === Tile.WATER_SHORE) return TerrainKind.WATER;
  return null;
}

function cellKind(t: number): {
  kind: TerrainKind | null;
  isTransition: boolean;
  isBase: boolean;
  isSpecial: boolean;
} {
  if (SPECIAL_GROUND.has(t)) {
    return { kind: null, isTransition: false, isBase: false, isSpecial: true };
  }
  const dec = decodeTransitionTile(t);
  if (dec) {
    return {
      kind: TRANSITION_PAIRS[dec.pairId]?.fg ?? null,
      isTransition: true,
      isBase: false,
      isSpecial: false,
    };
  }
  const k = kindOfBase(t);
  return { kind: k, isTransition: false, isBase: k !== null, isSpecial: false };
}

if (!existsSync(worldPath)) {
  ok("world.json exists", false, worldPath);
  console.log(lines.join("\n"));
  process.exit(1);
}

const world = decodeWorld(JSON.parse(readFileSync(worldPath, "utf8")) as WorldFile);
const g = world.ground;
const W = world.width;

// Count hard base-base adjacencies for every major pair that has a transition set
const majors = [
  TerrainKind.GRASS,
  TerrainKind.DIRT,
  TerrainKind.SAND,
  TerrainKind.STONE,
  TerrainKind.MARBLE,
  TerrainKind.WATER,
  TerrainKind.ROCK,
];

type PairKey = string;
const hardSeams = new Map<PairKey, number>();
const softSeams = new Map<PairKey, number>();

function pairKey(a: TerrainKind, b: TerrainKind): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Scan whole map cardinal neighbors (right + down only to avoid double count)
for (let y = 0; y < world.height; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const a = cellKind(g[i]);
    if (a.kind === null) continue;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= W || ny >= world.height) continue;
      const b = cellKind(g[ny * W + nx]);
      if (b.kind === null || b.kind === a.kind) continue;
      // only majors
      if (!majors.includes(a.kind) || !majors.includes(b.kind)) continue;
      const ordered = orderTerrainPair(a.kind, b.kind);
      if (!ordered) continue;
      const [fg, bg] = ordered;
      if (transitionPairId(fg, bg) < 0) continue; // pair not in atlas — skip
      const key = pairKey(a.kind, b.kind);
      // Hard seam = BOTH cells are base fills of different kinds (no blend tile)
      if (a.isBase && b.isBase) {
        hardSeams.set(key, (hardSeams.get(key) ?? 0) + 1);
      } else {
        softSeams.set(key, (softSeams.get(key) ?? 0) + 1);
      }
    }
  }
}

// Fountain region focus (marble|water)
let fountainHard = 0;
let fountainSoft = 0;
let fountainTrans = 0;
for (let y = 510; y <= 527; y++) {
  for (let x = 503; x <= 520; x++) {
    const i = y * W + x;
    const a = cellKind(g[i]);
    if (decodeTransitionTile(g[i])) fountainTrans++;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const b = cellKind(g[(y + dy) * W + (x + dx)]);
      if (a.kind === null || b.kind === null) continue;
      const isMW =
        (a.kind === TerrainKind.MARBLE && b.kind === TerrainKind.WATER) ||
        (a.kind === TerrainKind.WATER && b.kind === TerrainKind.MARBLE);
      if (!isMW) continue;
      if (a.isBase && b.isBase) fountainHard++;
      else fountainSoft++;
    }
  }
}

ok("world loaded", g.length === W * world.height, `${W}x${world.height}`);
ok(
  "fountain region has transition tiles",
  fountainTrans > 20,
  `trans=${fountainTrans}`
);
ok(
  "fountain marble|water hard base-base seams == 0",
  fountainHard === 0,
  `hard=${fountainHard} soft=${fountainSoft}`
);
ok(
  "fountain marble|water soft/blended contacts > 0",
  fountainSoft > 0,
  `soft=${fountainSoft}`
);

// Global: covered major pairs must have zero hard base-base seams
// (specials excluded above)
let totalHard = 0;
const criticalPairs = [
  pairKey(TerrainKind.MARBLE, TerrainKind.WATER),
  pairKey(TerrainKind.WATER, TerrainKind.SAND),
  pairKey(TerrainKind.STONE, TerrainKind.GRASS),
  pairKey(TerrainKind.WATER, TerrainKind.STONE),
  pairKey(TerrainKind.DIRT, TerrainKind.GRASS),
  pairKey(TerrainKind.MARBLE, TerrainKind.GRASS),
  pairKey(TerrainKind.ROCK, TerrainKind.GRASS),
  pairKey(TerrainKind.STONE, TerrainKind.MARBLE),
];

for (const [key, n] of hardSeams) {
  const [a, b] = key.split("|").map(Number) as [TerrainKind, TerrainKind];
  const ordered = orderTerrainPair(a, b)!;
  const name =
    TRANSITION_PAIRS.find((p) => p.fg === ordered[0] && p.bg === ordered[1])?.name ?? key;
  ok(
    `hard seams ${name} == 0`,
    n === 0,
    `got ${n} (soft=${softSeams.get(key) ?? 0})`
  );
  totalHard += n;
  lines.push(`  info  ${name}: hard=${n} soft=${softSeams.get(key) ?? 0}`);
}

// Explicit critical-pair presence of soft blends
for (const key of criticalPairs) {
  const soft = softSeams.get(key) ?? 0;
  const hard = hardSeams.get(key) ?? 0;
  // only require soft>0 when that boundary exists in the world
  if (soft + hard === 0) continue;
  ok(`critical pair ${key} has no hard seams`, hard === 0, `hard=${hard} soft=${soft}`);
}

ok(
  "water_over_marble pair in atlas",
  transitionPairId(TerrainKind.WATER, TerrainKind.MARBLE) >= 0
);

// Marble: variants used + no diamond lattice in painters (source check)
{
  const counts = new Map<number, number>();
  let marbleish = 0;
  for (let y = 478; y <= 545; y++) {
    for (let x = 478; x <= 545; x++) {
      const t = g[y * W + x];
      if (
        t === Tile.MARBLE_FLOOR ||
        t === Tile.MARBLE_FLOOR2 ||
        t === Tile.MARBLE_FLOOR3
      ) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
        marbleish++;
      } else {
        const dec = decodeTransitionTile(t);
        if (dec && TRANSITION_PAIRS[dec.pairId]?.fg === TerrainKind.MARBLE) marbleish++;
        if (dec && TRANSITION_PAIRS[dec.pairId]?.bg === TerrainKind.MARBLE) marbleish++;
      }
    }
  }
  ok(
    "plaza uses >=2 marble base variants when bases present",
    counts.size === 0 || counts.size >= 2,
    `variants=${[...counts.entries()]}`
  );
  ok("plaza has marble terrain presence", marbleish > 100, `n=${marbleish}`);
}

// Source: marble painters must not paint full-tile diamond diagonals
{
  const src = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
  const floorFn = src.slice(src.indexOf("function marbleFloor"), src.indexOf("function marbleChecker"));
  const hasFullDiagonal =
    /for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*T\s*;\s*i\s*\+\+\s*\)[\s\S]{0,120}px\(ctx,\s*i,\s*i/.test(
      floorFn
    );
  ok("marbleFloor has no full-tile diagonal lattice loop", !hasFullDiagonal);
}

const summary = `\n${passed} passed, ${failed} failed (totalHard residual ${totalHard})`;
lines.push(summary);
console.log(lines.join("\n"));
if (failed > 0) process.exit(1);
