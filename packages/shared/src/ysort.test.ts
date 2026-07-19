/**
 * Step 6 — Y-sorted tall props (>16px), depth by base Y with player.
 * Run: pnpm exec tsx packages/shared/src/ysort.test.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isTallPropBase,
  tallPropPixelHeight,
  tallPropDepth,
  tallPropOccludesPlayer,
  tallPropWorldPos,
  TALL_PROP_BASES,
  TALL_PROP_TOP,
} from "./tall-props.js";
import { ySortDepth, propOccludesPlayer } from "./graphics-analysis.js";
import { Tile } from "./tiles.js";
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

ok("column base is tall prop", isTallPropBase(Tile.COLUMN_BASE));
ok("statue base is tall prop", isTallPropBase(Tile.STATUE_BASE));
ok("tree trunk is tall prop", isTallPropBase(Tile.TREE_TRUNK));
ok("grass is not tall prop", !isTallPropBase(Tile.GRASS));
ok("column pixel height > 16", tallPropPixelHeight(Tile.COLUMN_BASE) > 16, `h=${tallPropPixelHeight(Tile.COLUMN_BASE)}`);
ok("statue pixel height > 16", tallPropPixelHeight(Tile.STATUE_BASE) > TILE_SIZE);
ok("column has top tile", TALL_PROP_TOP[Tile.COLUMN_BASE] === Tile.COLUMN_TOP);
ok("statue has top tile", TALL_PROP_TOP[Tile.STATUE_BASE] === Tile.STATUE_TOP);

// Depth space matches player formula
ok(
  "tallPropDepth === ySortDepth",
  tallPropDepth(528) === ySortDepth(528, 10),
  `${tallPropDepth(528)} vs ${ySortDepth(528, 10)}`
);

// Player north of prop (smaller tileY) → prop draws on top → occludes lower half
ok(
  "player Y=10 behind prop base Y=12 → occluded",
  tallPropOccludesPlayer(10, 12) && propOccludesPlayer(10, 12)
);
ok(
  "player Y=12 at prop base → not occluded by higher depth rule alone",
  !tallPropOccludesPlayer(12, 12)
);
ok(
  "player Y=14 south of prop Y=12 → player on top (not occluded)",
  !tallPropOccludesPlayer(14, 12)
);

// World position foot at bottom of base tile
{
  const p = tallPropWorldPos(5, 10);
  ok("world x centered", p.x === 5 * TILE_SIZE + TILE_SIZE / 2);
  ok("world y at foot", p.y === 10 * TILE_SIZE + TILE_SIZE);
}

// Source: WindowedTilemap implements tall sprites
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wtm = readFileSync(join(ROOT, "apps/client/src/world/WindowedTilemap.ts"), "utf8");
const ws = readFileSync(join(ROOT, "apps/client/src/scenes/WorldScene.ts"), "utf8");
ok("WindowedTilemap has tall prop sprites", /tallProps|ensureTallTexture|tallPropDepth/.test(wtm));
ok("WindowedTilemap composes height > TILE_SIZE", /tallPropPixelHeight|TILE_SIZE \* 2/.test(wtm));
ok("player depth uses tileY * 0.001", /setDepth\s*\(\s*10\s*\+\s*this\.tileY\s*\*\s*0\.001\s*\)/.test(ws));
ok("WorldScene refreshes tall prop depths", /refreshTallPropDepths/.test(ws));
ok("TALL_PROP_BASES non-empty", TALL_PROP_BASES.size >= 3);

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
