/**
 * Canvas host centering gates.
 * Drives shipped fit geometry helpers (resolution.ts) — not a re-implementation.
 * Run: pnpm exec tsx packages/shared/src/center-layout.test.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  OVERWORLD_ZOOM,
  INTERIOR_ZOOM,
  integerCssScaleForZooms,
  integerCssScale,
  physicalPixelsPerTexel,
  canvasCssSize,
  centeredCanvasOffset,
  canvasCenteringStyles,
  applyIntegerDisplayScale,
} from "./resolution.js";

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

// --- pure geometry: centered offset ---
{
  const off = centeredCanvasOffset(1920, 1080, 960, 640);
  ok("center 960×640 in 1920×1080 left", off.left === 480, `left=${off.left}`);
  ok("center 960×640 in 1920×1080 top", off.top === 220, `top=${off.top}`);
}

{
  // Scaled canvas smaller than container → symmetric letterbox
  const scale = integerCssScaleForZooms(GAME_WIDTH, GAME_HEIGHT, 1920, 1080, 2, [
    OVERWORLD_ZOOM,
    INTERIOR_ZOOM,
  ]);
  const { width, height } = canvasCssSize(GAME_WIDTH, GAME_HEIGHT, scale);
  const off = centeredCanvasOffset(1920, 1080, width, height);
  ok(
    "letterbox left ≈ (containerW - canvasW)/2",
    Math.abs(off.left - (1920 - width) / 2) < 1,
    `left=${off.left} w=${width}`
  );
  ok(
    "letterbox top ≈ (containerH - canvasH)/2",
    Math.abs(off.top - (1080 - height) / 2) < 1,
    `top=${off.top} h=${height}`
  );
  ok("canvas smaller than container (has letterbox room)", width < 1920 && height < 1080);
  // Equal leftover: left == right, top == bottom (within 1px rounding)
  ok(
    "horizontal leftover symmetric",
    Math.abs(off.left - (1920 - width - off.left)) <= 1,
    `L=${off.left} R=${1920 - width - off.left}`
  );
  ok(
    "vertical leftover symmetric",
    Math.abs(off.top - (1080 - height - off.top)) <= 1,
    `T=${off.top} B=${1080 - height - off.top}`
  );
}

// --- centering styles clear absolute pinning ---
{
  const styles = canvasCenteringStyles(960, 640);
  ok("styles set position relative", styles.position === "relative");
  ok("styles clear left", styles.left === "auto");
  ok("styles clear top", styles.top === "auto");
  ok("styles clear margin", styles.margin === "0" || styles.margin === "0px");
  ok("styles set width px", styles.width === "960px");
  ok("styles set height px", styles.height === "640px");
}

// --- applyIntegerDisplayScale writes centering-safe styles (mock canvas) ---
{
  const styleStore: Record<string, string> = {};
  const canvas = {
    style: new Proxy(styleStore, {
      set(t, prop, value) {
        if (typeof prop === "string") t[prop] = String(value);
        return true;
      },
      get(t, prop) {
        if (prop === "setProperty") {
          return (k: string, v: string) => {
            t[k] = v;
          };
        }
        return t[prop as string];
      },
    }),
  } as unknown as HTMLCanvasElement;

  const r = applyIntegerDisplayScale(canvas, GAME_WIDTH, GAME_HEIGHT, 1920, 1080, 2, OVERWORLD_ZOOM);
  ok("apply returns width/height", r.width > 0 && r.height > 0);
  ok("apply sets position relative", styleStore.position === "relative");
  ok("apply sets left auto", styleStore.left === "auto");
  ok("apply sets top auto", styleStore.top === "auto");
  ok("apply sets margin 0", styleStore.margin === "0" || styleStore.margin === "0px");
  ok("apply ppt integer", isInt(r.physicalPerTexel), `ppt=${r.physicalPerTexel}`);
}

// --- fit path geometry for several containers/DPRs ---
const CASES: Array<[number, number, number]> = [
  [1920, 1080, 1],
  [1920, 1080, 2],
  [1440, 900, 1.5],
  [1280, 800, 2],
  [960, 640, 1],
];
for (const [cw, ch, dpr] of CASES) {
  const scale = integerCssScaleForZooms(GAME_WIDTH, GAME_HEIGHT, cw, ch, dpr, [
    OVERWORLD_ZOOM,
    INTERIOR_ZOOM,
  ]);
  const { width, height } = canvasCssSize(GAME_WIDTH, GAME_HEIGHT, scale);
  const off = centeredCanvasOffset(cw, ch, width, height);
  const maxFit = Math.min(cw / GAME_WIDTH, ch / GAME_HEIGHT);
  ok(
    `fit ${cw}x${ch}@${dpr}: scale≤maxFit`,
    scale <= maxFit + 1e-9,
    `scale=${scale} maxFit=${maxFit}`
  );
  ok(
    `fit ${cw}x${ch}@${dpr}: canvas fits`,
    width <= cw + 1 && height <= ch + 1,
    `css=${width}x${height}`
  );
  ok(
    `fit ${cw}x${ch}@${dpr}: centered offsets non-negative`,
    off.left >= -1 && off.top >= -1,
    `L=${off.left} T=${off.top}`
  );
  ok(
    `fit ${cw}x${ch}@${dpr}: OW ppt int`,
    isInt(physicalPixelsPerTexel(OVERWORLD_ZOOM, scale, dpr))
  );
  ok(
    `fit ${cw}x${ch}@${dpr}: INT ppt int`,
    isInt(physicalPixelsPerTexel(INTERIOR_ZOOM, scale, dpr))
  );
  // Not pinned to origin when container is larger
  if (width < cw - 2 && height < ch - 2) {
    ok(
      `fit ${cw}x${ch}@${dpr}: not flush-left (has left inset)`,
      off.left > 0,
      `left=${off.left}`
    );
    ok(
      `fit ${cw}x${ch}@${dpr}: not flush-top (has top inset)`,
      off.top > 0,
      `top=${off.top}`
    );
  }
}

// Single-zoom integerCssScale still centers-compatible
{
  const scale = integerCssScale(GAME_WIDTH, GAME_HEIGHT, 1600, 900, 1, OVERWORLD_ZOOM);
  const { width, height } = canvasCssSize(GAME_WIDTH, GAME_HEIGHT, scale);
  const off = centeredCanvasOffset(1600, 900, width, height);
  ok("single-zoom center left matches formula", off.left === Math.round((1600 - width) / 2));
  ok("single-zoom center top matches formula", off.top === Math.round((900 - height) / 2));
}

// --- source gates: flex host + NO_CENTER + centering styles applied ---
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const main = readFileSync(join(root, "apps/client/src/main.ts"), "utf8");
  const html = readFileSync(join(root, "apps/client/index.html"), "utf8");
  const display = readFileSync(join(root, "apps/client/src/displayScale.ts"), "utf8");
  const res = readFileSync(join(root, "packages/shared/src/resolution.ts"), "utf8");

  ok("index.html #game is flex", /#game\s*\{[^}]*display:\s*flex/s.test(html));
  ok("index.html justify-content center", /justify-content:\s*center/.test(html));
  ok("index.html align-items center", /align-items:\s*center/.test(html));
  ok(
    "main autoCenter is NO_CENTER (not CENTER_BOTH)",
    /autoCenter:\s*Phaser\.Scale\.NO_CENTER/.test(main) &&
      !/autoCenter:\s*Phaser\.Scale\.CENTER_BOTH/.test(main)
  );
  ok("main Scale.NONE", /Scale\.NONE/.test(main));
  ok(
    "displayScale applies canvasCenteringStyles or left auto",
    /canvasCenteringStyles|left.*auto|position.*relative/.test(display)
  );
  ok("resolution exports canvasCenteringStyles", /canvasCenteringStyles/.test(res));
  ok("resolution exports centeredCanvasOffset", /centeredCanvasOffset/.test(res));
  ok(
    "displayScale does not set absolute left/top px",
    !/style\.left\s*=\s*[`'"]\d/.test(display) && !/style\.top\s*=\s*[`'"]\d/.test(display)
  );
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
