/**
 * Free Dominion dev ports (Vite :5175 + Colyseus :2567) so `pnpm dev`
 * does not fail with "Port 5175 is already in use" after a crashed/orphaned run.
 *
 * These ports are dedicated to this monorepo's dev scripts. Any LISTEN holder
 * is treated as stale and terminated (SIGTERM then SIGKILL).
 */
import { execSync } from "node:child_process";

const PORTS = [5175, 2567];

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    return [...new Set(out.split(/\s+/).map((s) => Number(s)).filter((n) => n > 0))];
  } catch {
    return [];
  }
}

function cmdline(pid) {
  try {
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

let killed = 0;
for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    if (pid === process.pid) continue;
    const cmd = cmdline(pid);
    try {
      process.kill(pid, "SIGTERM");
      killed++;
      console.log(`[free-dev-ports] SIGTERM pid ${pid} on :${port}${cmd ? ` (${cmd.slice(0, 80)})` : ""}`);
    } catch {
      /* already gone */
    }
  }
}

if (killed > 0) {
  sleep(500);
  for (const port of PORTS) {
    for (const pid of pidsOnPort(port)) {
      if (pid === process.pid) continue;
      try {
        process.kill(pid, "SIGKILL");
        console.log(`[free-dev-ports] SIGKILL pid ${pid} on :${port}`);
      } catch {
        /* gone */
      }
    }
  }
  sleep(250);
}

const still = PORTS.flatMap((p) => pidsOnPort(p).map((pid) => ({ p, pid })));
if (still.length) {
  console.warn(
    `[free-dev-ports] still in use: ${still.map((s) => `:${s.p}->${s.pid}`).join(", ")}`
  );
} else {
  console.log(`[free-dev-ports] ports ${PORTS.join(", ")} are free`);
}
