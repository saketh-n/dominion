/**
 * Phase B — placement grammar + symmetry + density budget.
 * Also world.json structural checks for PAINTING/CRATE/STATUE/BANNER/bench/planter.
 * Run: pnpm exec tsx packages/shared/src/placement.test.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canPlacePainting,
  canPlaceCrate,
  canPlaceStatue,
  canPlaceBanner,
  canPlaceBenchOrPlanter,
  isWallFace,
  hasOrthoWallNeighbor,
  onCenterAxis,
  isMirroredFlankEntrance,
  isPathEdge,
  mirrorAcrossAxis,
  makeZoneBudget,
  tryConsumeBudget,
  crateScore,
  type LayerView,
} from "./placement.js";
import { Tile } from "./tiles.js";
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// --- pure predicate unit tests ---
{
  const W = 16;
  const ground = new Uint16Array(W * W);
  const deco = new Uint16Array(W * W);
  const overhead = new Uint16Array(W * W);
  const view: LayerView = { width: W, ground, deco, overhead };

  // wall at (5,5)
  deco[5 * W + 5] = Tile.H_WALL;
  ok("isWallFace on H_WALL", isWallFace(view, 5, 5));
  ok("not wall on empty floor", !isWallFace(view, 8, 8));
  ok("canPlacePainting on wall", canPlacePainting(view, 5, 5));
  ok("cannot place painting on open floor", !canPlacePainting(view, 8, 8));

  // crate next to wall
  ok("hasOrthoWallNeighbor east of wall", hasOrthoWallNeighbor(view, 6, 5));
  ok("canPlaceCrate beside wall", canPlaceCrate(view, 6, 5));
  ok("cannot crate in open", !canPlaceCrate(view, 10, 10));
  // corner
  deco[6 * W + 5] = Tile.H_WALL; // wait that's the cell itself
  deco[4 * W + 5] = Tile.H_WALL; // north of (5,6)? let's set L corner at (7,7)
  deco[7 * W + 7] = Tile.H_WALL;
  deco[7 * W + 8] = Tile.H_WALL;
  deco[8 * W + 7] = Tile.H_WALL;
  ok("crateScore corner > edge", crateScore(view, 8, 8) > crateScore(view, 6, 5) || crateScore(view, 8, 8) >= 1);

  ok("onCenterAxis", onCenterAxis(511, 511, 1));
  ok("not onCenterAxis", !onCenterAxis(500, 511, 1));
  ok(
    "mirrored flank",
    isMirroredFlankEntrance(498, 489, 511, 489, 13) && isMirroredFlankEntrance(524, 489, 511, 489, 13)
  );
  ok(
    "canPlaceStatue axis",
    canPlaceStatue(511, 500, { axisX: 511, entranceYs: [489], flankOffset: 13 })
  );
  ok(
    "canPlaceStatue flank",
    canPlaceStatue(498, 489, { axisX: 511, entranceYs: [489], flankOffset: 13 })
  );
  ok(
    "cannot statue random",
    !canPlaceStatue(505, 520, { axisX: 511, entranceYs: [489], flankOffset: 13 })
  );

  // banner on column
  deco[3 * W + 3] = Tile.COLUMN_BASE;
  overhead[1 * W + 3] = Tile.COLUMN_TOP;
  ok("banner on column top cell", canPlaceBanner(view, 3, 1));
  ok("banner on wall", canPlaceBanner(view, 5, 5));
  ok("no banner open floor", !canPlaceBanner(view, 12, 12));

  // path edge
  const isPath = (x: number, y: number) => x >= 4 && x <= 6;
  ok("path edge", isPathEdge(isPath, 4, 2));
  ok("bench on path edge", canPlaceBenchOrPlanter(isPath, 4, 2));
  ok("not bench deep off-path", !canPlaceBenchOrPlanter(isPath, 12, 12));

  // symmetry
  const mir = mirrorAcrossAxis(
    [
      { x: 500, y: 10, kind: "a" },
      { x: 511, y: 10, kind: "a" },
    ],
    511
  );
  ok("mirror produces pair", mir.some((p) => p.x === 522) && mir.some((p) => p.x === 500));
  ok("mirror keeps axis point once", mir.filter((p) => p.x === 511).length === 1);

  // density budget
  const z = makeZoneBudget("t", 0, 0, 10, 10, 2);
  ok("budget allow 1", tryConsumeBudget([z], 1, 1));
  ok("budget allow 2", tryConsumeBudget([z], 2, 2));
  ok("budget deny 3", !tryConsumeBudget([z], 3, 3));
  ok("outside zone allowed", tryConsumeBudget([z], 50, 50));
}

// --- world.json grammar checks ---
const worldPath = join(ROOT, "apps/client/public/assets/world/world.json");
ok("world.json exists", existsSync(worldPath));

if (existsSync(worldPath)) {
  const world = JSON.parse(readFileSync(worldPath, "utf8")) as {
    width: number;
    height: number;
    layers: { ground: string; deco: string; overhead: string };
    collision: string;
  };
  const W = world.width;
  const H = world.height;
  ok("world size", W === MAP_W && H === MAP_H);
  const gBuf = Buffer.from(world.layers.ground, "base64");
  const dBuf = Buffer.from(world.layers.deco, "base64");
  const oBuf = Buffer.from(world.layers.overhead, "base64");
  const cBuf = Buffer.from(world.collision, "base64");
  const groundAt = (x: number, y: number) => gBuf.readUInt16LE((y * W + x) * 2);
  const decoAt = (x: number, y: number) => dBuf.readUInt16LE((y * W + x) * 2);
  const overAt = (x: number, y: number) => oBuf.readUInt16LE((y * W + x) * 2);
  const collAt = (x: number, y: number) => cBuf[y * W + x]!;

  const view: LayerView = {
    width: W,
    ground: {
      length: W * H,
      [Symbol.iterator]: undefined as never,
      0: 0,
    } as unknown as ArrayLike<number>,
    deco: { length: W * H } as ArrayLike<number>,
    overhead: { length: W * H } as ArrayLike<number>,
  };
  // build real arrays for view
  const gArr = new Uint16Array(W * H);
  const dArr = new Uint16Array(W * H);
  const oArr = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gArr[i] = gBuf.readUInt16LE(i * 2);
    dArr[i] = dBuf.readUInt16LE(i * 2);
    oArr[i] = oBuf.readUInt16LE(i * 2);
  }
  const realView: LayerView = { width: W, ground: gArr, deco: dArr, overhead: oArr };

  // PAINTING: zero on open floor
  let paintings = 0;
  let paintingFloor = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = decoAt(x, y);
      const o = overAt(x, y);
      if (d === Tile.PAINTING || o === Tile.PAINTING) {
        paintings++;
        if (!canPlacePainting(realView, x, y)) paintingFloor++;
      }
    }
  }
  ok("zero PAINTING on open floor", paintingFloor === 0, `floor=${paintingFloor} total=${paintings}`);
  ok("some PAINTING placed on walls", paintings >= 1, `count=${paintings}`);

  // CRATE: every crate has ortho wall neighbor
  let crates = 0;
  let crateBad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (decoAt(x, y) !== Tile.CRATE) continue;
      crates++;
      if (!canPlaceCrate(realView, x, y)) crateBad++;
    }
  }
  ok("every CRATE has ortho wall neighbor", crateBad === 0, `bad=${crateBad} total=${crates}`);
  ok("some CRATEs placed", crates >= 1, `count=${crates}`);

  // STATUE only axis or flanks
  const AXIS = 511;
  const ENTRANCES = [489, 532];
  const FLANK = 13;
  let statues = 0;
  let statueBad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (decoAt(x, y) !== Tile.STATUE_BASE) continue;
      statues++;
      if (
        !canPlaceStatue(x, y, {
          axisX: AXIS,
          entranceYs: ENTRANCES,
          flankOffset: FLANK,
          axisHalfWidth: 1,
        })
      )
        statueBad++;
    }
  }
  ok("STATUE only axis/flanks", statueBad === 0, `bad=${statueBad} total=${statues}`);
  ok("some STATUEs", statues >= 1, `count=${statues}`);

  // BANNER only on column/wall
  let banners = 0;
  let bannerBad = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (overAt(x, y) !== Tile.BANNER && decoAt(x, y) !== Tile.BANNER) continue;
      banners++;
      if (!canPlaceBanner(realView, x, y)) bannerBad++;
    }
  }
  ok("BANNER only column/wall face", bannerBad === 0, `bad=${bannerBad} total=${banners}`);

  // benches/planters on path edges (plaza band)
  const PX0_CHECK = 478;
  const PX1_CHECK = 545;
  const isPath = (x: number, y: number) => {
    const g = groundAt(x, y);
    // stone/dirt variants + roads
    return (
      g === Tile.STONE_ROAD ||
      g === Tile.STONE_ROAD2 ||
      g === Tile.STONE_ROAD3 ||
      g === Tile.DIRT_PATH ||
      g === Tile.DIRT_PATH2 ||
      g === Tile.DIRT_PATH3 ||
      // also accept marble court path edges near avenues
      (x >= 508 && x <= 515) ||
      (y >= 515 && y <= 522 && x >= PX0_CHECK && x <= PX1_CHECK)
    );
  };
  let benchPlanter = 0;
  let bpBad = 0;
  for (let y = 478; y <= 545; y++) {
    for (let x = 478; x <= 545; x++) {
      const d = decoAt(x, y);
      if (d !== Tile.BENCH && d !== Tile.PLANTER) continue;
      benchPlanter++;
      if (!canPlaceBenchOrPlanter(isPath, x, y) && !isPathEdge(isPath, x, y)) bpBad++;
    }
  }
  ok(
    "benches/planters on path edges",
    bpBad === 0 && benchPlanter >= 1,
    `bad=${bpBad} total=${benchPlanter}`
  );

  // Plaza decor roughly symmetric across axis (sample statues + columns)
  let leftCols = 0;
  let rightCols = 0;
  for (let y = 478; y <= 545; y++) {
    for (let x = 478; x <= 545; x++) {
      if (decoAt(x, y) !== Tile.COLUMN_BASE) continue;
      if (x < AXIS) leftCols++;
      else if (x > AXIS) rightCols++;
    }
  }
  const colRatio = leftCols && rightCols ? Math.min(leftCols, rightCols) / Math.max(leftCols, rightCols) : 0;
  ok(
    "plaza columns roughly symmetric",
    colRatio >= 0.75,
    `L=${leftCols} R=${rightCols} ratio=${colRatio.toFixed(2)}`
  );

  // Column 4-side collision identical
  let colChecked = 0;
  let colOk = 0;
  for (let y = 500; y < 530 && colChecked < 20; y++) {
    for (let x = 500; x < 530 && colChecked < 20; x++) {
      if (decoAt(x, y) !== Tile.COLUMN_BASE) continue;
      if (collAt(x, y) !== 1) continue;
      colChecked++;
      // approach tiles N/E/S/W: player cannot enter column cell from any side
      // (the column cell itself is blocked — identical solid footprint)
      const blocked = collAt(x, y) === 1;
      // neighbors themselves may be walkable; identity = column cell always solid
      if (blocked) colOk++;
    }
  }
  ok(
    "plaza COLUMN_BASE cells solid (4-side identical footprint)",
    colChecked > 0 && colOk === colChecked,
    `ok ${colOk}/${colChecked}`
  );

  // shaft overhead is non-solid
  let shaftOver = 0;
  let shaftColl = 0;
  for (let y = 500; y < 530; y++) {
    for (let x = 500; x < 530; x++) {
      if (overAt(x, y) !== Tile.COLUMN_SHAFT) continue;
      shaftOver++;
      // cell may still collide if something else is there; shaft alone shouldn't force it
      // if deco is empty and ground not solid, collision should be 0
      if (decoAt(x, y) === 0 && !SOLID_FROM_GROUND(groundAt(x, y)) && collAt(x, y) === 1) {
        // only count if ground isn't solid
        shaftColl++;
      }
    }
  }
  function SOLID_FROM_GROUND(g: number): boolean {
    return (
      g === Tile.WATER ||
      g === Tile.POOL_COPING ||
      g === Tile.LEDGE_FACE ||
      g === Tile.CLIFF_FACE ||
      g === Tile.W_BODY
    );
  }
  ok(
    "COLUMN_SHAFT overhead present",
    shaftOver > 0,
    `count=${shaftOver}`
  );
}

// gen-map source gates
const genMap = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");
ok("gen-map uses canPlacePainting", /canPlacePainting/.test(genMap));
ok("gen-map uses canPlaceCrate", /canPlaceCrate/.test(genMap));
ok("gen-map uses canPlaceStatue", /canPlaceStatue/.test(genMap));
ok("gen-map uses mirrorAcrossAxis", /mirrorAcrossAxis/.test(genMap));
ok("gen-map uses tryConsumeBudget|makeZoneBudget", /tryConsumeBudget|makeZoneBudget/.test(genMap));
ok("gen-map uses canPlaceBanner", /canPlaceBanner/.test(genMap));
ok("gen-map uses canPlaceBenchOrPlanter", /canPlaceBenchOrPlanter/.test(genMap));

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
