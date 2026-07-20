/**
 * Live Playwright: enter Grand Temple, exit, open party/inventory/settings, go home.
 * Requires dev client+server on :5175 / :2567.
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CLIENT = process.env.CLIENT_URL || "http://localhost:5175";
const OUT = process.env.SCRATCH || "/tmp/dominion-enter-menus";
mkdirSync(OUT, { recursive: true });

function analyzePng(path) {
  const script = `
from PIL import Image
import json, sys
im = Image.open(sys.argv[1]).convert("RGB")
w,h = im.size
px = im.load()
bg = (20, 18, 26)
non = tot = 0
acc = 0
for y in range(0, h, 4):
    for x in range(0, w, 4):
        r,g,b = px[x,y]
        tot += 1
        if abs(r-bg[0])>12 or abs(g-bg[1])>12 or abs(b-bg[2])>12:
            non += 1
        acc = (acc * 33 + r + g*3 + b*7) & 0xFFFFFFFF
print(json.dumps({"w":w,"h":h,"non":non,"tot":tot,"fill": non/tot if tot else 0, "hash": acc}))
`;
  return JSON.parse(execFileSync("python3", ["-c", script, path], { encoding: "utf8" }));
}

/**
 * Prove the screenshot is a tile interior room, not leftover overworld.
 * Tile-based interiors (zoom 3): wood/marble/stone floors, dark I_WALL bands,
 * crimson rug accents; overworld grass and open sky must be scarce in center.
 */
function analyzeInteriorRoom(path, expectKind) {
  const script = `
from PIL import Image
import json, sys
im = Image.open(sys.argv[1]).convert("RGB")
w,h = im.size
px = im.load()
kind = sys.argv[2]

def near(c, t, tol=28):
    return abs(c[0]-t[0])<=tol and abs(c[1]-t[1])<=tol and abs(c[2]-t[2])<=tol

# Tile palette approximations (gen-tileset interior + floor tiles)
wood_floor = (0x6a, 0x4a, 0x2e)
temple_floor = (0xc8, 0xc0, 0xa8)
stone_floor = (0x88, 0x84, 0x78)
wall_dark = (0x3a, 0x2e, 0x28)
wall_panel = (0x5a, 0x48, 0x38)
rug = (0xa4, 0x3e, 0x35)
marble = (0xd0, 0xcc, 0xb8)

cx0, cx1 = w//2 - 160, w//2 + 160
cy0, cy1 = h//2 - 120, h//2 + 120
floor_n = wall_n = rug_n = grass_n = marble_n = col_n = tot = 0
for y in range(cy0, cy1, 2):
    for x in range(cx0, cx1, 2):
        c = px[x,y]
        tot += 1
        r,g,b = c
        if kind == "temple":
            if near(c, temple_floor, 40) or near(c, marble, 36): floor_n += 1
            if near(c, wall_dark, 36) or near(c, wall_panel, 36): wall_n += 1
            if near(c, rug, 44): rug_n += 1
            if near(c, marble, 30) and r > 180: col_n += 1
        elif kind == "shrine":
            if near(c, stone_floor, 40) or near(c, marble, 36): floor_n += 1
            if near(c, wall_dark, 36) or near(c, wall_panel, 36): wall_n += 1
            if near(c, rug, 44): rug_n += 1
        else:
            if near(c, wood_floor, 42) or (r > 70 and r < 140 and g < r and b < g): floor_n += 1
            if near(c, wall_dark, 36) or near(c, wall_panel, 36): wall_n += 1
            if near(c, rug, 44): rug_n += 1
        if g > r + 25 and g > b + 15 and g > 90:
            grass_n += 1
        if near(c, marble, 24):
            marble_n += 1

center = list(px[w//2, h//2])
corners = [list(px[8,8]), list(px[w-9,8]), list(px[8,h-9]), list(px[w-9,h-9])]
print(json.dumps({
  "kind": kind,
  "tot": tot,
  "floor_n": floor_n,
  "wall_n": wall_n,
  "rug_n": rug_n,
  "col_n": col_n,
  "grass_n": grass_n,
  "marble_n": marble_n,
  "floor_frac": floor_n/tot if tot else 0,
  "wall_frac": wall_n/tot if tot else 0,
  "rug_frac": rug_n/tot if tot else 0,
  "grass_frac": grass_n/tot if tot else 0,
  "center": center,
  "corners": corners,
}))
`;
  return JSON.parse(
    execFileSync("python3", ["-c", script, path, expectKind], { encoding: "utf8" })
  );
}

function isDistinctInterior(room, expectKind) {
  if (!room) return false;
  // Tile interiors: scarce grass + some floor/wall/rug structure in center crop.
  const grassLow = room.grass_frac < 0.12;
  const structureOk =
    room.floor_frac >= 0.06 ||
    room.wall_frac >= 0.04 ||
    room.rug_frac >= 0.01 ||
    room.marble_n / Math.max(room.tot, 1) >= 0.08;
  void expectKind;
  return grassLow && structureOk;
}

const errors = [];
const logs = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  logs.push(`[${msg.type()}] ${msg.text()}`);
});

console.log("loading", CLIENT);
await page.goto(CLIENT, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForFunction(
  () => window.__dominionPos && document.getElementById("chat-ui"),
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(1500);

const plazaPath = join(OUT, "live-plaza.png");
await page.screenshot({ path: plazaPath, type: "png" });
const plaza = await analyzePng(plazaPath);
console.log("plaza", plaza, await page.evaluate(() => window.__dominionPos));

/** Follow dir list (0 down 1 up 2 left 3 right). Returns final pos. */
async function followDirs(dirs, label = "path") {
  for (let i = 0; i < dirs.length; i++) {
    const pos = await page.evaluate(() => window.__dominionPos);
    if (pos?.place === "interior") return pos;
    const d = dirs[i];
    let moved = await page.evaluate((dir) => window.__dominionStep?.(dir) ?? false, d);
    await page.waitForTimeout(moved ? 230 : 50);
    if (!moved) {
      // retry once after brief wait (tween settle)
      await page.waitForTimeout(100);
      moved = await page.evaluate((dir) => window.__dominionStep?.(dir) ?? false, d);
      await page.waitForTimeout(moved ? 230 : 40);
    }
    if (!moved) {
      console.warn(label, "stuck at step", i, "dir", d, await page.evaluate(() => window.__dominionPos));
    }
  }
  return page.evaluate(() => window.__dominionPos);
}

// Precomputed BFS plaza(513,528) → temple H_DOOR (511,485) around fountain.
// Door is the facade tile — standing south of it must NOT warp.
const TO_TEMPLE = [
  1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2,
];
const TEMPLE_DOOR = { x: 511, y: 485 };
const atDoor = await followDirs(TO_TEMPLE, "to-temple");
console.log("atDoor", atDoor);
const doorPath = join(OUT, "live-temple-door.png");
await page.screenshot({ path: doorPath, type: "png" });

// If not exactly on door, step toward the H_DOOR cell only (not adjacency warp)
if (
  atDoor &&
  (atDoor.x !== TEMPLE_DOOR.x || atDoor.y !== TEMPLE_DOOR.y) &&
  atDoor.place === "world"
) {
  for (let n = 0; n < 12; n++) {
    const p = await page.evaluate(() => window.__dominionPos);
    if (!p || p.place === "interior") break;
    if (p.x === TEMPLE_DOOR.x && p.y === TEMPLE_DOOR.y) break;
    let d = 1;
    if (p.x < TEMPLE_DOOR.x) d = 3;
    else if (p.x > TEMPLE_DOOR.x) d = 2;
    else if (p.y > TEMPLE_DOOR.y) d = 1;
    else d = 0;
    await page.evaluate((dir) => window.__dominionStep?.(dir), d);
    await page.waitForTimeout(230);
  }
}

// Auto-enter may fire on step; otherwise press E via hook
let interiorReady = await page.evaluate(() => window.__dominionPos?.place === "interior");
if (!interiorReady) {
  await page.evaluate(() => window.__dominionEnter?.());
  try {
    await page.waitForFunction(() => window.__dominionPos?.place === "interior", null, {
      timeout: 6000,
    });
    interiorReady = true;
  } catch {
    // last resort: keyboard E
    await page.keyboard.press("e");
    await page.waitForTimeout(800);
  }
}
await page.waitForTimeout(400);
const interiorPos = await page.evaluate(() => window.__dominionPos);
console.log("interior", interiorPos);
const interiorPath = join(OUT, "live-interior.png");
await page.screenshot({ path: interiorPath, type: "png" });
const interiorStats = await analyzePng(interiorPath);
const interiorRoom = analyzeInteriorRoom(interiorPath, "temple");
console.log("interiorRoom", interiorRoom);

// Exit
await page.evaluate(() => window.__dominionExit?.());
await page.waitForFunction(() => window.__dominionPos?.place === "world", null, {
  timeout: 5000,
});
await page.waitForTimeout(300);
const afterExit = await page.evaluate(() => window.__dominionPos);
console.log("afterExit", afterExit);

// Menus: party, inventory, settings
async function openMenu(id, shotName) {
  await page.evaluate((m) => window.__dominionMenu?.(m), id);
  await page.waitForTimeout(250);
  const visible = await page.evaluate(() => {
    const el = document.getElementById("game-menus");
    return {
      display: el?.style.display,
      text: el?.innerText?.slice(0, 400) ?? "",
      menu: window.__dominionPos?.menu,
    };
  });
  const path = join(OUT, shotName);
  await page.screenshot({ path, type: "png" });
  console.log("menu", id, visible.menu, visible.text.slice(0, 120).replace(/\n/g, " | "));
  return { visible, path, stats: await analyzePng(path) };
}

const party = await openMenu("party", "live-party.png");
await page.evaluate(() => window.__dominionMenu?.("close"));
await page.waitForTimeout(150);
const inv = await openMenu("inventory", "live-inventory.png");
await page.evaluate(() => window.__dominionMenu?.("close"));
await page.waitForTimeout(150);
const settings = await openMenu("settings", "live-settings.png");
await page.evaluate(() => window.__dominionMenu?.("close"));
await page.waitForTimeout(150);

// Go home
await page.evaluate(() => window.__dominionGoHome?.());
await page.waitForTimeout(600);
const homePos = await page.evaluate(() => window.__dominionPos);
console.log("home", homePos);
const homePath = join(OUT, "live-home.png");
await page.screenshot({ path: homePath, type: "png" });

// Enter own house if at door
if (homePos?.place === "world") {
  await page.evaluate(() => window.__dominionEnter?.());
  await page.waitForTimeout(500);
}
const houseInterior = await page.evaluate(() => window.__dominionPos);
console.log("houseInterior", houseInterior);
const housePath = join(OUT, "live-house-interior.png");
await page.screenshot({ path: housePath, type: "png" });
const houseStats = await analyzePng(housePath);
const houseRoom =
  houseInterior?.place === "interior" ? analyzeInteriorRoom(housePath, "house") : null;
console.log("houseRoom", houseRoom);
if (houseInterior?.place === "interior") {
  await page.evaluate(() => window.__dominionExit?.());
  await page.waitForTimeout(400);
}

const chatText = await page.evaluate(() => document.getElementById("chat-ui")?.innerText ?? "");

const result = {
  url: CLIENT,
  errors,
  plaza,
  atDoor,
  interiorPos,
  interiorStats,
  interiorRoom,
  houseRoom,
  afterExit,
  party: { menu: party.visible.menu, text: party.visible.text, stats: party.stats },
  inventory: { menu: inv.visible.menu, text: inv.visible.text, stats: inv.stats },
  settings: { menu: settings.visible.menu, text: settings.visible.text, stats: settings.stats },
  homePos,
  houseInterior,
  chatSnippet: chatText.slice(0, 500),
  pass: {
    enteredTemple:
      interiorPos?.place === "interior" && /temple|Temple/i.test(interiorPos?.interiorName ?? ""),
    exited: afterExit?.place === "world",
    // Prefer DOM content (menus are real); probe menu id is best-effort.
    partyMenu:
      party.visible.display === "flex" &&
      /Party/i.test(party.visible.text) &&
      /Lv|HP|Ignifawn|creature/i.test(party.visible.text),
    inventoryMenu:
      inv.visible.display === "flex" &&
      /Potion|Antidote|Bag|Escape Rope|Laurel/i.test(inv.visible.text),
    settingsMenu:
      settings.visible.display === "flex" &&
      /Settings/i.test(settings.visible.text) &&
      /Mute|names|chat/i.test(settings.visible.text),
    goHome: homePos?.place === "world" && typeof homePos?.houseId === "number",
    houseEnter: houseInterior?.place === "interior" && /House/i.test(houseInterior?.interiorName ?? ""),
    noErrors: errors.length === 0,
    // Visual: painted room palette in center crop (not map-edge grass fill).
    templeInteriorVisual: isDistinctInterior(interiorRoom, "temple"),
    houseInteriorVisual: isDistinctInterior(houseRoom, "house"),
    interiorsDiffer: houseStats ? interiorStats.hash !== houseStats.hash : false,
  },
};
result.pass.all = Object.values(result.pass).every(Boolean);

writeFileSync(join(OUT, "enter-menus-result.json"), JSON.stringify(result, null, 2));
console.log("PASS", result.pass);
await browser.close();
if (!result.pass.all) {
  console.error("ENTER/MENUS VERIFICATION FAILED");
  process.exit(1);
}
console.log("ENTER/MENUS VERIFICATION PASSED");
