/**
 * Structural unit test for continuous tile streaming.
 * Run: pnpm test:scroll  OR  npx tsx apps/client/src/world/tileStream.test.ts
 *
 * Proves:
 *  - after N one-tile steps east, streamed origin advances by N (no MARGIN hitch)
 *  - ordinary 1-step walks plan EDGE fills only (cells << VIEW_W*VIEW_H)
 *  - WorldScene hard-follows player and streams from pixel center
 */
import assert from "node:assert/strict";
import {
  desiredOrigin,
  originAfterSteps,
  needsStream,
  edgeCellsToWrite,
  edgeFillJobs,
} from "./tileStream.js";
import { VIEW_W, VIEW_H } from "./WindowedTilemap.js";

let passed = 0;
let failed = 0;

function run(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(e);
  }
}

console.log("\n=== tile stream continuous scroll ===\n");
console.log(`VIEW ${VIEW_W}x${VIEW_H} fullCells=${VIEW_W * VIEW_H}`);

run("desiredOrigin centers player in the view window", () => {
  const o = desiredOrigin(513, 518, VIEW_W, VIEW_H);
  assert.equal(o.ox, Math.floor(513 - VIEW_W / 2));
  assert.equal(o.oy, Math.floor(518 - VIEW_H / 2));
});

run("after N east steps, origin.ox advances by exactly N", () => {
  for (const N of [1, 2, 5, 12, 30]) {
    const d = originAfterSteps(500, 500, N, VIEW_W, VIEW_H);
    assert.equal(d.ox, N, `expected ox delta ${N}, got ${d.ox}`);
    assert.equal(d.oy, 0);
  }
});

run("needsStream fires on every single-tile origin change (no MARGIN gate)", () => {
  let prev = desiredOrigin(100, 100, VIEW_W, VIEW_H);
  let streams = 0;
  for (let i = 1; i <= 20; i++) {
    const next = desiredOrigin(100 + i, 100, VIEW_W, VIEW_H);
    if (needsStream(prev, next)) {
      streams++;
      prev = next;
    }
  }
  assert.equal(streams, 20, `expected 20 streams for 20 steps, got ${streams}`);
});

run("1-step east is EDGE mode writing only one column (not full window)", () => {
  const full = VIEW_W * VIEW_H;
  const plan = edgeCellsToWrite(1, 0, VIEW_W, VIEW_H);
  assert.equal(plan.mode, "edge");
  assert.equal(plan.cells, VIEW_H, `expected ${VIEW_H} edge cells, got ${plan.cells}`);
  assert.ok(plan.cells < full / 4, "edge fill must be far smaller than full rebuild");
  const jobs = edgeFillJobs(100, 200, 1, 0, VIEW_W, VIEW_H);
  assert.equal(jobs.length, VIEW_H);
  // new column is the east edge of the window
  assert.ok(jobs.every((j) => j.tx === VIEW_W - 1));
  assert.equal(jobs[0].wx, 100 + VIEW_W - 1);
});

run("1-step north is EDGE mode writing only one row", () => {
  const plan = edgeCellsToWrite(0, -1, VIEW_W, VIEW_H);
  assert.equal(plan.mode, "edge");
  assert.equal(plan.cells, VIEW_W);
  const jobs = edgeFillJobs(50, 60, 0, -1, VIEW_W, VIEW_H);
  assert.equal(jobs.length, VIEW_W);
  assert.ok(jobs.every((j) => j.ty === 0));
});

run("large teleport uses FULL rebuild", () => {
  const plan = edgeCellsToWrite(10, 0, VIEW_W, VIEW_H);
  assert.equal(plan.mode, "full");
  assert.equal(plan.cells, VIEW_W * VIEW_H);
});

run("WorldScene camera follow binding present in source", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "../scenes/WorldScene.ts");
  const src = readFileSync(root, "utf8");
  assert.match(src, /startFollow\(\s*this\.player/);
  assert.match(src, /setDeadzone\(\s*0\s*,\s*0\s*\)/);
  assert.match(src, /tilemap\.update/);
  assert.match(src, /player\.x\s*\/\s*TILE_SIZE/);
});

run("WindowedTilemap uses incremental edge path (no MARGIN gate, has scroll)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "./WindowedTilemap.ts");
  const src = readFileSync(root, "utf8");
  assert.equal(/MARGIN\s*=\s*[1-9]/.test(src), false, "MARGIN gate must be removed");
  assert.match(src, /needsStream/);
  assert.match(src, /desiredOrigin/);
  assert.match(src, /incrementalShift|edgeFillJobs/);
  assert.match(src, /lastStreamMode/);
  assert.match(src, /scrollLayerData/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
