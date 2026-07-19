/**
 * Step 1 — rendering resolution gates.
 * Run: pnpm exec tsx packages/shared/src/resolution.test.ts
 */
import {
  OVERWORLD_ZOOM,
  INTERIOR_ZOOM,
  GAME_WIDTH,
  GAME_HEIGHT,
  visibleTileCount,
  physicalPixelsPerTexel,
  integerCssScale,
  integerCssScaleForZooms,
  maxIntegerPpt,
  assertIntegerZoom,
} from "./resolution.js";
import { TILE_SIZE } from "./constants.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function isInt(n: number): boolean {
  return Math.abs(n - Math.round(n)) < 1e-6;
}

// --- constants ---
ok("OVERWORLD_ZOOM is integer 3", OVERWORLD_ZOOM === 3 && Number.isInteger(OVERWORLD_ZOOM));
ok("INTERIOR_ZOOM is 1", INTERIOR_ZOOM === 1);
ok("assertIntegerZoom(3) returns 3", assertIntegerZoom(3) === 3);
{
  let threw = false;
  try {
    assertIntegerZoom(2.5);
  } catch {
    threw = true;
  }
  ok("assertIntegerZoom rejects non-integer", threw);
}

// --- visible tiles at shipped game size ---
{
  const { w, h } = visibleTileCount(GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, OVERWORLD_ZOOM);
  ok(
    "visible tiles ≤ 20×14",
    w <= 20 && h <= 14,
    `got ${w}×${h} (game ${GAME_WIDTH}×${GAME_HEIGHT}, tile ${TILE_SIZE}, zoom ${OVERWORLD_ZOOM})`
  );
  ok("visible width is 20", w === 20, `got ${w}`);
  ok("visible height is 14", h === 14, `got ${h}`);
}

{
  const old = visibleTileCount(GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, 2);
  const now = visibleTileCount(GAME_WIDTH, GAME_HEIGHT, TILE_SIZE, OVERWORLD_ZOOM);
  ok(
    "zoom 3 shows fewer tiles than zoom 2",
    now.w < old.w && now.h < old.h,
    `now ${now.w}×${now.h} vs old ${old.w}×${old.h}`
  );
}

const DPRS = [1, 1.25, 1.5, 2, 2.75, 3];

// Representative containers: large (desktop), exact game size, half (small)
// Half maxFit=0.5: integer ppt≥1 is possible iff maxIntegerPpt≥1.
const CONTAINERS: Array<[number, number, string]> = [
  [1920, 1080, "large"],
  [960, 640, "exact"],
  [480, 320, "half"],
];

for (const dpr of DPRS) {
  for (const [cw, ch, label] of CONTAINERS) {
    const maxFit = Math.min(cw / GAME_WIDTH, ch / GAME_HEIGHT);
    for (const zoom of [OVERWORLD_ZOOM, INTERIOR_ZOOM] as const) {
      const scale = integerCssScale(GAME_WIDTH, GAME_HEIGHT, cw, ch, dpr, zoom);
      const ppt = physicalPixelsPerTexel(zoom, scale, dpr);
      const maxK = maxIntegerPpt(maxFit, dpr, zoom);
      ok(
        `z${zoom} dpr=${dpr} ${label}: scale ≤ maxFit`,
        scale <= maxFit + 1e-9,
        `scale=${scale} maxFit=${maxFit}`
      );
      ok(`z${zoom} dpr=${dpr} ${label}: scale > 0`, scale > 0);
      if (maxK >= 1) {
        ok(
          `z${zoom} dpr=${dpr} ${label}: ppt integer (≥1 possible)`,
          isInt(ppt) && ppt >= 1 - 1e-6,
          `scale=${scale} ppt=${ppt} maxK=${maxK}`
        );
      } else {
        // Degenerate host: document that we still clamp to maxFit
        ok(
          `z${zoom} dpr=${dpr} ${label}: degenerate clamps to maxFit`,
          Math.abs(scale - maxFit) < 1e-9,
          `scale=${scale} maxFit=${maxFit}`
        );
      }
    }
  }
}

// Explicit regression from skeptic: 480×320 must NEVER return scale=1
{
  const maxFit = Math.min(480 / GAME_WIDTH, 320 / GAME_HEIGHT);
  ok("half container maxFit is 0.5", Math.abs(maxFit - 0.5) < 1e-9);
  for (const dpr of DPRS) {
    for (const zoom of [1, 3]) {
      const s = integerCssScale(GAME_WIDTH, GAME_HEIGHT, 480, 320, dpr, zoom);
      ok(
        `half dpr=${dpr} z${zoom} scale≤0.5 (no overflow)`,
        s <= 0.5 + 1e-9,
        `scale=${s}`
      );
      const maxK = maxIntegerPpt(0.5, dpr, zoom);
      if (maxK >= 1) {
        ok(
          `half dpr=${dpr} z${zoom} ppt int`,
          isInt(physicalPixelsPerTexel(zoom, s, dpr)),
          `ppt=${physicalPixelsPerTexel(zoom, s, dpr)}`
        );
      }
    }
  }
}

// --- dual-zoom scale path (shipped displayScale prefers this) ---
// Desktop + exact size must keep both zooms integer-ppt
for (const dpr of DPRS) {
  for (const [cw, ch, label] of [
    [1920, 1080, "large"],
    [960, 640, "exact"],
  ] as const) {
    const maxFit = Math.min(cw / GAME_WIDTH, ch / GAME_HEIGHT);
    const scale = integerCssScaleForZooms(GAME_WIDTH, GAME_HEIGHT, cw, ch, dpr, [
      OVERWORLD_ZOOM,
      INTERIOR_ZOOM,
    ]);
    ok(`dual ${label} dpr=${dpr}: scale ≤ maxFit`, scale <= maxFit + 1e-9, `scale=${scale}`);
    ok(
      `dual ${label} dpr=${dpr}: OW ppt int`,
      isInt(physicalPixelsPerTexel(OVERWORLD_ZOOM, scale, dpr)),
      `ppt=${physicalPixelsPerTexel(OVERWORLD_ZOOM, scale, dpr)}`
    );
    ok(
      `dual ${label} dpr=${dpr}: INT ppt int`,
      isInt(physicalPixelsPerTexel(INTERIOR_ZOOM, scale, dpr)),
      `ppt=${physicalPixelsPerTexel(INTERIOR_ZOOM, scale, dpr)}`
    );
  }
}

// Interior zoom 1 under dual path for representative DPRs (skeptic)
for (const dpr of [1, 1.25, 1.5, 2, 3]) {
  const scale = integerCssScaleForZooms(GAME_WIDTH, GAME_HEIGHT, 1920, 1080, dpr, [
    OVERWORLD_ZOOM,
    INTERIOR_ZOOM,
  ]);
  ok(
    `shipped dual path INT z1 dpr=${dpr} ppt int`,
    isInt(physicalPixelsPerTexel(INTERIOR_ZOOM, scale, dpr)),
    `scale=${scale} ppt=${physicalPixelsPerTexel(INTERIOR_ZOOM, scale, dpr)}`
  );
  ok(
    `shipped dual path OW z3 dpr=${dpr} ppt int`,
    isInt(physicalPixelsPerTexel(OVERWORLD_ZOOM, scale, dpr)),
    `scale=${scale} ppt=${physicalPixelsPerTexel(OVERWORLD_ZOOM, scale, dpr)}`
  );
}

// --- source gates ---
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const world = readFileSync(join(root, "apps/client/src/scenes/WorldScene.ts"), "utf8");
  const main = readFileSync(join(root, "apps/client/src/main.ts"), "utf8");
  const display = readFileSync(join(root, "apps/client/src/displayScale.ts"), "utf8");
  ok(
    "WorldScene sets overworld zoom 3",
    /setZoom\s*\(\s*OVERWORLD_ZOOM\s*\)/.test(world) || /setZoom\s*\(\s*3\s*\)/.test(world)
  );
  ok("WorldScene does not setZoom(2.0)", !/setZoom\s*\(\s*2\.0\s*\)/.test(world));
  ok("main keeps pixelArt: true", /pixelArt:\s*true/.test(main));
  ok("main installs display fit + refit", /installDisplayFit|refitDisplay/.test(main));
  ok(
    "displayScale uses active zoom / dual zooms",
    /integerCssScaleForZooms|activeZoom|INTERIOR_ZOOM/.test(display)
  );
  ok(
    "WorldScene refits on interior zoom",
    /refitDisplay\s*\(\s*INTERIOR_ZOOM\s*\)/.test(world)
  );
  ok(
    "WorldScene refits on overworld restore",
    /refitDisplay\s*\(/.test(world) && /resumeOverworldCamera/.test(world)
  );
  ok("WorldScene sets roundPixels", /setRoundPixels\s*\(\s*true\s*\)/.test(world));
  ok(
    "interior setZoom INTERIOR_ZOOM or 1",
    /setZoom\s*\(\s*1\s*\)/.test(world) || /setZoom\s*\(\s*INTERIOR_ZOOM\s*\)/.test(world)
  );
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
