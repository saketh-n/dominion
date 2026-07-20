/**
 * Hold-R run timing + top-left controls cheatsheet contract.
 * Drives shipped helpers in constants.ts (not a reimplementation).
 * Run: pnpm exec tsx packages/shared/src/run-controls.test.ts
 */
import {
  WALK_SPEED,
  RUN_SPEED,
  WALK_STEP_MS,
  RUN_STEP_MS,
  stepDurationMs,
  MIN_MOVE_INTERVAL_MS,
  CONTROLS_CHEATSHEET,
} from "./constants.js";
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

// --- shipped step timing ---
ok("walk step ms matches WALK_SPEED", stepDurationMs(false) === 1000 / WALK_SPEED);
ok("run step ms matches RUN_SPEED", stepDurationMs(true) === 1000 / RUN_SPEED);
ok(
  "run is strictly faster than walk",
  stepDurationMs(true) < stepDurationMs(false),
  `walk=${stepDurationMs(false)} run=${stepDurationMs(true)}`
);
ok("WALK_STEP_MS exported equals walk duration", WALK_STEP_MS === stepDurationMs(false));
ok("RUN_STEP_MS exported equals run duration", RUN_STEP_MS === stepDurationMs(true));
ok(
  "MIN_MOVE_INTERVAL_MS is run cadence with 0.8 slack",
  MIN_MOVE_INTERVAL_MS === RUN_STEP_MS * 0.8
);
ok(
  "server floor allows legitimate run (floor ≤ run step)",
  MIN_MOVE_INTERVAL_MS <= RUN_STEP_MS
);
ok(
  "server floor still blocks super-run (floor > half run step)",
  MIN_MOVE_INTERVAL_MS > RUN_STEP_MS * 0.5
);
ok("RUN_SPEED > WALK_SPEED", RUN_SPEED > WALK_SPEED);

// --- cheatsheet content contract ---
ok("cheatsheet mentions Move", /move/i.test(CONTROLS_CHEATSHEET));
ok("cheatsheet mentions Run and R", /run/i.test(CONTROLS_CHEATSHEET) && /\bR\b/.test(CONTROLS_CHEATSHEET));
ok(
  "cheatsheet mentions inventory/bag and I",
  (/bag|inventory/i.test(CONTROLS_CHEATSHEET) && /\bI\b/.test(CONTROLS_CHEATSHEET))
);
ok("cheatsheet is multi-line HUD text", CONTROLS_CHEATSHEET.includes("\n"));

// --- client wiring: hold R shortens steps; R is not a move dir ---
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const worldScene = readFileSync(join(ROOT, "apps/client/src/scenes/WorldScene.ts"), "utf8");
ok("WorldScene imports stepDurationMs", /stepDurationMs/.test(worldScene));
ok("WorldScene imports CONTROLS_CHEATSHEET", /CONTROLS_CHEATSHEET/.test(worldScene));
ok("WorldScene binds key R", /addKey\(\s*["']R["']\s*\)/.test(worldScene));
ok(
  "WorldScene uses stepDurationMs(isRunning()) for tween",
  /stepDurationMs\s*\(\s*this\.isRunning\s*\(\s*\)\s*\)/.test(worldScene)
);
ok(
  "WorldScene isRunning only checks keyR (R alone does not move)",
  /\/\*\* Hold R while moving to run\. R alone never starts a step\. \*\/\s*private isRunning/.test(
    worldScene
  ) &&
    /private isRunning\(\)[\s\S]*?return this\.keyR\?\.isDown === true;/.test(worldScene) &&
    !/private heldDir[\s\S]*?keyR[\s\S]*?private isRunning/.test(worldScene)
);
ok(
  "cheat sheet text object at top-left (x=8,y=8) with scrollFactor 0",
  /\.text\(\s*8\s*,\s*8\s*,\s*CONTROLS_CHEATSHEET/.test(worldScene) &&
    /cheatSheet[\s\S]{0,400}setScrollFactor\(\s*0\s*\)/.test(worldScene)
);
ok(
  "heldDir does not treat R as a direction",
  /heldDir\s*\(\s*\)\s*:\s*Dir\s*\|\s*null\s*\{[\s\S]*?return null;\s*\}/.test(worldScene) &&
    !/heldDir[\s\S]*?keyR[\s\S]*?return [0-3]/.test(worldScene)
);

// --- server rate floor uses MIN_MOVE_INTERVAL_MS ---
const worldRoom = readFileSync(join(ROOT, "apps/server/src/rooms/WorldRoom.ts"), "utf8");
ok("WorldRoom imports MIN_MOVE_INTERVAL_MS", /MIN_MOVE_INTERVAL_MS/.test(worldRoom));
ok(
  "WorldRoom rate check uses MIN_MOVE_INTERVAL_MS",
  /lastMoveAt\s*<\s*MIN_MOVE_INTERVAL_MS/.test(worldRoom)
);
ok(
  "WorldRoom no longer floors on walk-only STEP_MS",
  !/const STEP_MS\s*=\s*1000\s*\/\s*WALK_SPEED/.test(worldRoom)
);

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
