/**
 * Navigate from claimed house spawn into the capital plaza / temple / fountain
 * using BFS pathfinding + single-tile steps verified against live __dominionPos.
 */
import { chromium } from "playwright";
import { mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.SCRATCH || "preview";
const URL = process.env.CLIENT_URL || "http://localhost:5175";
mkdirSync(OUT, { recursive: true });
mkdirSync("preview", { recursive: true });

const world = JSON.parse(
  readFileSync(join(ROOT, "apps/client/public/assets/world/world.json"), "utf8")
);
const W = world.width;
const H = world.height;
const col = Uint8Array.from(Buffer.from(world.collision, "base64"));
const solid = (x, y) => x < 0 || y < 0 || x >= W || y >= H || col[y * W + x] === 1;

/** @returns {Array<"U"|"D"|"L"|"R">} */
function pathDirs(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * W + x;
  const q = [[sx, sy]];
  const prev = new Int32Array(W * H).fill(-1);
  prev[key(sx, sy)] = -2;
  let head = 0;
  let found = false;
  while (head < q.length) {
    const [x, y] = q[head++];
    if (x === tx && y === ty) {
      found = true;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = key(nx, ny);
      if (prev[k] !== -1) continue;
      if (solid(nx, ny)) continue;
      prev[k] = key(x, y);
      q.push([nx, ny]);
    }
  }
  if (!found) throw new Error(`no path ${sx},${sy} -> ${tx},${ty}`);
  const dirs = [];
  let cur = key(tx, ty);
  const startK = key(sx, sy);
  while (cur !== startK) {
    const p = prev[cur];
    if (p < 0) break;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const px = p % W;
    const py = (p / W) | 0;
    const dx = cx - px;
    const dy = cy - py;
    dirs.push(dx === 1 ? "R" : dx === -1 ? "L" : dy === 1 ? "D" : "U");
    cur = p;
  }
  dirs.reverse();
  return dirs;
}

// Match WorldScene Dir: 0=down, 1=up, 2=left, 3=right
const DIR_CODE = { D: 0, U: 1, L: 2, R: 3 };
const DXY = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

async function getPos(page) {
  return page.evaluate(() => /** @type {any} */ (window).__dominionPos);
}

async function waitPos(page) {
  await page.waitForFunction(
    () => {
      const g = /** @type {any} */ (window).__dominionPos;
      return g && typeof g.x === "number" && g.place === "world" && typeof window.__dominionStep === "function";
    },
    { timeout: 20000 }
  );
  return getPos(page);
}

/** One tile via __dominionStep — no key-hold overshoot. */
async function stepOne(page, dir) {
  const before = await getPos(page);
  const [dx, dy] = DXY[dir];
  const expectX = before.x + dx;
  const expectY = before.y + dy;
  if (solid(expectX, expectY)) {
    console.warn("skip solid", expectX, expectY);
    return before;
  }
  for (let i = 0; i < 30; i++) {
    const p = await getPos(page);
    if (!p.moving) break;
    await page.waitForTimeout(25);
  }
  const started = await page.evaluate((d) => {
    const fn = /** @type {any} */ (window).__dominionStep;
    return fn ? fn(d) : false;
  }, DIR_CODE[dir]);
  if (!started) {
    // collision or busy — wait and return
    await page.waitForTimeout(50);
    return getPos(page);
  }
  for (let t = 0; t < 40; t++) {
    await page.waitForTimeout(30);
    const p = await getPos(page);
    if (!p.moving && (p.x !== before.x || p.y !== before.y)) return p;
    if (p.x === expectX && p.y === expectY && !p.moving) return p;
  }
  return getPos(page);
}

/** Walk to target, re-pathing from live position every 20 steps. */
async function goTo(page, tx, ty, label = "") {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await getPos(page);
    if (cur.x === tx && cur.y === ty) {
      console.log(`arrived ${label} (${tx},${ty})`);
      return cur;
    }
    const dirs = pathDirs(cur.x, cur.y, tx, ty);
    if (!dirs.length) {
      console.log(`no dirs ${label} at`, cur);
      return cur;
    }
    const chunk = dirs.slice(0, 24);
    console.log(
      `goto ${label} from ${cur.x},${cur.y} → ${tx},${ty} chunk ${chunk.length}/${dirs.length}`
    );
    for (const d of chunk) {
      await stepOne(page, d);
      const p = await getPos(page);
      if (p.x === tx && p.y === ty) {
        console.log(`arrived ${label} (${tx},${ty})`);
        return p;
      }
    }
  }
  const end = await getPos(page);
  console.warn(`failed ${label}: ended ${end.x},${end.y} want ${tx},${ty}`);
  return end;
}

async function shot(page, name) {
  const p = await getPos(page);
  console.log(`shot ${name} @ ${p.x},${p.y}`);
  const path = join(OUT, name);
  await page.screenshot({ path });
  copyFileSync(path, join("preview", name));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(2500);
const live = await waitPos(page);
console.log("live spawn", live);

// Destinations (walkable marble / steps)
const FOUNTAIN = { x: 513, y: 528 }; // south of grand basin on processional road
// On approach terrace just south of steps — pediment + colonnade fill the top half
const TEMPLE = { x: 511, y: 491 };
const PLAZA_VIEW = { x: 511, y: 530 }; // fountain + gardens + shrine in frame
const STATUE = { x: 500, y: 531 };
const WEST = { x: 490, y: 518 };
const EAST = { x: 532, y: 518 };

// Mid-route district shot
{
  const cur = await getPos(page);
  const dirs = pathDirs(cur.x, cur.y, FOUNTAIN.x, FOUNTAIN.y);
  const midN = Math.min(40, Math.floor(dirs.length * 0.4));
  for (let i = 0; i < midN; i++) await stepOne(page, dirs[i]);
  await shot(page, "game-district.png");
}

await goTo(page, FOUNTAIN.x, FOUNTAIN.y, "fountain");
await page.waitForTimeout(300);
await shot(page, "game-fountain.png");

await goTo(page, TEMPLE.x, TEMPLE.y, "temple");
await page.waitForTimeout(300);
await shot(page, "game-temple.png");

await goTo(page, PLAZA_VIEW.x, PLAZA_VIEW.y, "plaza");
await page.waitForTimeout(300);
await shot(page, "game-plaza.png");

await goTo(page, STATUE.x, STATUE.y, "statue");
await page.waitForTimeout(200);
await shot(page, "game-approach.png");

await goTo(page, WEST.x, WEST.y, "west");
await shot(page, "game-walk-west.png");

// scroll east across plaza (mid + end)
{
  const cur = await getPos(page);
  const dirs = pathDirs(cur.x, cur.y, EAST.x, EAST.y);
  const half = Math.floor(dirs.length / 2);
  for (let i = 0; i < half; i++) await stepOne(page, dirs[i]);
  await shot(page, "game-walk-mid.png");
  for (let i = half; i < dirs.length; i++) await stepOne(page, dirs[i]);
  await shot(page, "game-walk-east.png");
}

// avenue shot: walk toward west gate area of plaza
await goTo(page, 485, 511, "avenue");
await shot(page, "game-avenue.png");

console.log("errors", errors);
await browser.close();
if (errors.length) process.exit(1);
