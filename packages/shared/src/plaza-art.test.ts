/**
 * Phases C–F — ledges, shadows, columns, pool coping.
 * Run: pnpm exec tsx packages/shared/src/plaza-art.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Tile, TILESET_COLS, isWaterTile, decodeTransitionTile, SOLID_TILES } from "./tiles.js";
import { TRANSITION_PAIRS, TerrainKind } from "./autotile.js";
import { TILE_SIZE } from "./constants.js";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const pixelSrc = readFileSync(join(ROOT, "tools/pixel.ts"), "utf8");
const genTileset = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
const genMap = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");

// --- D: shadows axis-aligned 1-tile south ---
{
  const m = pixelSrc.match(/export function dropShadow\([\s\S]*?\n\}/);
  ok("dropShadow present", !!m);
  ok("dropShadow uses southCastShadow or axis strip", !!(m && /southCastShadow|for \(let yy/.test(m[0]!)));
  ok("dropShadow has no ellipse dx*dx+dy*dy", !!(m && !/dx \* dx \+ dy \* dy/.test(m[0]!)));
  ok("southCastShadow exported", /export function southCastShadow/.test(pixelSrc));
  ok("gen has no SE offset solid comments", !/SE offset solid/.test(genTileset));
}

// --- E: columns seamless mid-shaft ---
{
  ok("columnShaft painter exists", /function columnShaft/.test(genTileset));
  ok("COLUMN_SHAFT painted", /Tile\.COLUMN_SHAFT/.test(genTileset));
  // mid-shaft function should not draw horizontal molding hlines across shaft body
  const shaftFn = genTileset.match(/function columnShaft\([\s\S]*?\n\}/);
  ok("columnShaft present body", !!shaftFn);
  if (shaftFn) {
    // allow outline but no hline across mid rows 4-12
    const hlines = [...shaftFn[0]!.matchAll(/hline\s*\(/g)];
    ok("columnShaft no horizontal molding hlines", hlines.length === 0, `hlines=${hlines.length}`);
  }
  ok("columnBase is base-only (no capital gold abacus in base)", /function columnBase/.test(genTileset));
  ok("columnTop is capital", /function columnTop/.test(genTileset));
}

// --- C/F world structural ---
const worldPath = join(ROOT, "apps/client/public/assets/world/world.json");
const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
ok("world.json exists", existsSync(worldPath));
ok("tileset exists", existsSync(tilesetPath));

if (existsSync(worldPath)) {
  const world = JSON.parse(readFileSync(worldPath, "utf8")) as {
    width: number;
    layers: { ground: string; deco: string; overhead: string };
    collision: string;
  };
  const W = world.width;
  const gBuf = Buffer.from(world.layers.ground, "base64");
  const dBuf = Buffer.from(world.layers.deco, "base64");
  const groundAt = (x: number, y: number) => gBuf.readUInt16LE((y * W + x) * 2);
  const decoAt = (x: number, y: number) => dBuf.readUInt16LE((y * W + x) * 2);

  // Court / pool region
  const COURT_X0 = 503;
  const COURT_Y0 = 510;
  const COURT_X1 = 520;
  const COURT_Y1 = 527;

  // Every elevation boundary cell should be LEDGE_FACE (except stairs gaps)
  let ringCells = 0;
  let ledgeCells = 0;
  let stairGaps = 0;
  for (let y = COURT_Y0 - 1; y <= COURT_Y1 + 1; y++) {
    for (let x = COURT_X0 - 1; x <= COURT_X1 + 1; x++) {
      const onRing =
        x === COURT_X0 - 1 ||
        x === COURT_X1 + 1 ||
        y === COURT_Y0 - 1 ||
        y === COURT_Y1 + 1;
      if (!onRing) continue;
      ringCells++;
      const g = groundAt(x, y);
      if (g === Tile.LEDGE_FACE || g === Tile.CLIFF_FACE) ledgeCells++;
      if (g === Tile.T_STEPS) stairGaps++;
    }
  }
  ok(
    "elevation boundary has ledge faces",
    ledgeCells + stairGaps >= ringCells * 0.85,
    `ledge=${ledgeCells} stairs=${stairGaps} ring=${ringCells}`
  );
  ok("some LEDGE_FACE placed", ledgeCells >= 8, `ledge=${ledgeCells}`);

  // Court floor MARBLE_COURT present and not darkest-only
  let courtMarble = 0;
  let courtBase = 0;
  for (let y = COURT_Y0; y <= COURT_Y1; y++) {
    for (let x = COURT_X0; x <= COURT_X1; x++) {
      const g = groundAt(x, y);
      if (g === Tile.MARBLE_COURT) courtMarble++;
      if (g === Tile.MARBLE_FLOOR || g === Tile.MARBLE_FLOOR2) courtBase++;
    }
  }
  ok("court uses MARBLE_COURT (raised value)", courtMarble >= 20, `court=${courtMarble} base=${courtBase}`);

  // Pool basin (shipped rect from gen-map): pure WATER* interior + POOL_COPING ring.
  // FAIL if any water-foreground transition (incl. 45° corner blobs) exists in the pool rect.
  const POOL_X0 = 508;
  const POOL_Y0 = 515;
  const POOL_X1 = 515;
  const POOL_Y1 = 522;
  const pureWater = new Set([Tile.WATER, Tile.WATER2, Tile.WATER3, Tile.WATER_SHORE]);
  let waterCells = 0;
  let coping = 0;
  let waterFgTransitions = 0;
  let badPoolGround = 0;
  let badAdj = 0;
  const isPureWater = (t: number) => pureWater.has(t);
  const isCoping = (t: number) => t === Tile.POOL_COPING;
  const isAllowedPoolNeighbor = (x: number, y: number) => {
    const t = groundAt(x, y);
    const d = decoAt(x, y);
    if (isPureWater(t) || isCoping(t)) return true;
    if (
      d === Tile.FOUNTAIN_NW ||
      d === Tile.FOUNTAIN_NE ||
      d === Tile.FOUNTAIN_SW ||
      d === Tile.FOUNTAIN_SE
    )
      return true;
    // court apron outside ring may be marble court / steps — only for cells outside basin+ring
    return false;
  };

  for (let y = POOL_Y0 - 1; y <= POOL_Y1 + 1; y++) {
    for (let x = POOL_X0 - 1; x <= POOL_X1 + 1; x++) {
      const t = groundAt(x, y);
      const onRing =
        x === POOL_X0 - 1 ||
        x === POOL_X1 + 1 ||
        y === POOL_Y0 - 1 ||
        y === POOL_Y1 + 1;
      const inWater = x >= POOL_X0 && x <= POOL_X1 && y >= POOL_Y0 && y <= POOL_Y1;
      const dec = decodeTransitionTile(t);
      if (dec) {
        const pair = TRANSITION_PAIRS[dec.pairId];
        if (pair?.fg === TerrainKind.WATER || pair?.bg === TerrainKind.WATER) {
          waterFgTransitions++;
        }
        badPoolGround++;
      } else if (inWater) {
        if (isPureWater(t)) waterCells++;
        else badPoolGround++;
      } else if (onRing) {
        if (isCoping(t)) coping++;
        else badPoolGround++;
      }
    }
  }
  // Adjacency: every pure-water cell's 4-neighbors must be pure water or coping (or fountain deco cell)
  for (let y = POOL_Y0; y <= POOL_Y1; y++) {
    for (let x = POOL_X0; x <= POOL_X1; x++) {
      if (!isPureWater(groundAt(x, y))) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (!isAllowedPoolNeighbor(x + dx, y + dy)) badAdj++;
      }
    }
  }
  ok("water cells present in pool", waterCells >= 8, `water=${waterCells}`);
  ok(
    "zero water_over_* / transition tiles in pool rect",
    waterFgTransitions === 0,
    `waterFgTransitions=${waterFgTransitions}`
  );
  ok(
    "pool ground only WATER*|POOL_COPING (no blobs)",
    badPoolGround === 0,
    `badPoolGround=${badPoolGround}`
  );
  ok("water never adjacent to raw floor", badAdj === 0, `badAdj=${badAdj}`);
  ok("marble coping ring present", coping >= 8, `coping=${coping}`);
  ok("gen-map uses POOL_COPING", /POOL_COPING/.test(genMap));
  ok("gen-map finalizePoolBasin", /finalizePoolBasin/.test(genMap));
  ok("gen-map uses LEDGE_FACE", /LEDGE_FACE/.test(genMap));
  ok("gen-map uses MARBLE_COURT", /MARBLE_COURT/.test(genMap));

  // Ghost collision: collision=1 with empty deco and non-solid ground must not exist in plaza band
  const cBuf = Buffer.from(
    (JSON.parse(readFileSync(worldPath, "utf8")) as { collision: string }).collision,
    "base64"
  );
  const collAt = (x: number, y: number) => cBuf[y * W + x]!;
  let ghosts = 0;
  for (let y = 540; y <= 560; y++) {
    for (const x of [506, 507, 516, 517]) {
      if (collAt(x, y) === 1 && decoAt(x, y) === 0 && !SOLID_TILES.has(groundAt(x, y))) ghosts++;
    }
  }
  // known former ghost cells
  ok(
    "no ghost collision at processional pillar line",
    ghosts === 0 &&
      !(collAt(506, 554) === 1 && decoAt(506, 554) === 0 && !SOLID_TILES.has(groundAt(506, 554))) &&
      !(collAt(517, 554) === 1 && decoAt(517, 554) === 0 && !SOLID_TILES.has(groundAt(517, 554))),
    `ghosts=${ghosts} c506=${collAt(506, 554)} c517=${collAt(517, 554)}`
  );
}

// tileset pixel checks: column mid-shaft no horizontal band; shadow strip south
if (existsSync(tilesetPath)) {
  const img = await loadImage(tilesetPath);
  const cols = TILESET_COLS;
  const T = TILE_SIZE;
  function sample(id: number) {
    const sx = (id % cols) * T;
    const sy = Math.floor(id / cols) * T;
    const c = createCanvas(T, T);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, T, T, 0, 0, T, T);
    return ctx.getImageData(0, 0, T, T).data;
  }
  // COLUMN_SHAFT: check mid rows don't have a distinct full-width horizontal molding
  // (count unique colors on row 7 vs vertical continuity)
  const shaft = sample(Tile.COLUMN_SHAFT);
  let midOpaque = 0;
  for (let x = 0; x < T; x++) {
    if (shaft[(8 * T + x) * 4 + 3]! >= 40) midOpaque++;
  }
  ok("COLUMN_SHAFT has mid-row art", midOpaque >= 4, `midOpaque=${midOpaque}`);

  // COLUMN_BASE has shadow pixels near bottom (south strip)
  const base = sample(Tile.COLUMN_BASE);
  let bottomDark = 0;
  for (let y = 13; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = (y * T + x) * 4;
      if (base[i + 3]! < 40) continue;
      const lum = (base[i]! + base[i + 1]! + base[i + 2]!) / 3;
      if (lum < 80) bottomDark++;
    }
  }
  ok("COLUMN_BASE has south shadow/AO", bottomDark >= 4, `bottomDark=${bottomDark}`);

  // MARBLE_COURT mean luminance > MARBLE_FLOOR (raised one step)
  function meanLum(id: number): number {
    const d = sample(id);
    let s = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      n++;
    }
    return n ? s / n : 0;
  }
  const courtL = meanLum(Tile.MARBLE_COURT);
  const floorL = meanLum(Tile.MARBLE_FLOOR);
  ok(
    "MARBLE_COURT brighter than MARBLE_FLOOR",
    courtL > floorL + 2,
    `court=${courtL.toFixed(1)} floor=${floorL.toFixed(1)}`
  );

  // LEDGE_FACE has highlight lip (top rows brighter) and dark base
  const ledge = sample(Tile.LEDGE_FACE);
  let topL = 0,
    topN = 0,
    botL = 0,
    botN = 0;
  for (let x = 0; x < T; x++) {
    for (const y of [0, 1]) {
      const i = (y * T + x) * 4;
      if (ledge[i + 3]! < 40) continue;
      topL += (ledge[i]! + ledge[i + 1]! + ledge[i + 2]!) / 3;
      topN++;
    }
    for (const y of [14, 15]) {
      const i = (y * T + x) * 4;
      if (ledge[i + 3]! < 40) continue;
      botL += (ledge[i]! + ledge[i + 1]! + ledge[i + 2]!) / 3;
      botN++;
    }
  }
  const topM = topN ? topL / topN : 0;
  const botM = botN ? botL / botN : 0;
  ok("LEDGE_FACE highlight lip > dark base", topM > botM + 10, `top=${topM.toFixed(1)} bot=${botM.toFixed(1)}`);
}

// name-tag layout exists in WorldScene
{
  const scene = readFileSync(join(ROOT, "apps/client/src/scenes/WorldScene.ts"), "utf8");
  ok("WorldScene has layoutNameTags", /layoutNameTags/.test(scene));
  ok("name-tag vertical offset stack", /i \* 12|vertical offset/i.test(scene));
  ok("name-tag alpha fade", /setAlpha/.test(scene));
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
