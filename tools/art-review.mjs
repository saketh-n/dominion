/**
 * Honest DP-bar art review. CAN AND MUST FAIL sparse plazas.
 *
 * Gates include beige_frac + prop occupancy vs mood-ref baselines,
 * asset byte floors, unique color floors, scroll structure, and map stamps.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = process.env.SCRATCH || join(ROOT, "preview");
const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

/** Classify pixels: beige marble-field vs colorful prop/terrain. */
function classify(path, step = 2) {
  if (!existsSync(path)) return null;
  // sync load via canvas — async wrapper below
  return path;
}

async function metrics(path, step = 2) {
  if (!existsSync(path)) return null;
  const img = await loadImage(path);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const colors = new Set();
  let tot = 0;
  let beige = 0;
  let prop = 0;
  let green = 0;
  let blue = 0;
  let warm = 0; // terracotta/red/gold
  let edge = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (d[i + 3] < 16) continue;
      // skip pure UI black panels (chat) — very dark
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (r + g + b < 40) continue; // UI chrome
      tot++;
      colors.add(`${r >> 3},${g >> 3},${b >> 3}`);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const L = (r + g + b) / 3;
      const chroma = max - min;
      // beige marble / cream field
      if (L > 155 && chroma < 48 && r >= g - 8 && g >= b - 12) {
        beige++;
      } else if (b > r + 25 && b > 110) {
        blue++;
        prop++;
      } else if (g > r + 18 && g > 95 && g > b) {
        green++;
        prop++;
      } else if ((r > 145 && g < 120 && b < 110) || (r > 170 && g > 130 && b < 110)) {
        warm++;
        prop++;
      } else if (L > 200 && chroma < 35) {
        prop++; // bright statue/marble highlight
      } else if (chroma > 35) {
        prop++;
      }
      if (x + step < img.width) {
        const j = (y * img.width + x + step) * 4;
        const dr = Math.abs(r - d[j]) + Math.abs(g - d[j + 1]) + Math.abs(b - d[j + 2]);
        if (dr > 40) edge++;
      }
    }
  }
  return {
    path,
    w: img.width,
    h: img.height,
    bytes: statSync(path).size,
    unique5: colors.size,
    tot,
    beige_frac: tot ? beige / tot : 1,
    prop_frac: tot ? prop / tot : 0,
    green_frac: tot ? green / tot : 0,
    blue_frac: tot ? blue / tot : 0,
    warm_frac: tot ? warm / tot : 0,
    edge_ratio: tot ? edge / tot : 0,
  };
}

function gate(name, ok, detail) {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return ok;
}

async function main() {
  log("=== Dominion ART BAR REVIEW (strict / can FAIL) ===");
  log(new Date().toISOString());

  const tileset = await metrics(join(ROOT, "apps/client/public/assets/tileset.png"), 1);
  const chars = await metrics(join(ROOT, "apps/client/public/assets/characters.png"), 1);
  const creatures = await metrics(join(ROOT, "apps/client/public/assets/creatures.png"), 1);
  const plaza = await metrics(join(ROOT, "preview/game-plaza.png"), 2);
  const temple = await metrics(join(ROOT, "preview/game-temple.png"), 2);
  const fountain = await metrics(join(ROOT, "preview/game-fountain.png"), 2);
  const mood = await metrics(join(ROOT, "preview/refs/mood-capital-plaza.jpg"), 3);
  const moodTiles = existsSync(join(ROOT, "preview/refs/mood-dp-tiles.jpg"));
  const charsPrev = await metrics(join(ROOT, "preview/characters-preview.png"), 2);
  const crPrev = await metrics(join(ROOT, "preview/creatures-preview.png"), 2);

  log("\n--- metrics ---");
  for (const s of [tileset, chars, creatures, plaza, temple, fountain, mood, charsPrev, crPrev]) {
    if (s) log(JSON.stringify(s));
  }

  log("\n--- gates ---");
  let ok = true;

  // Asset density floors
  ok = gate("tileset_bytes>=20000", tileset && tileset.bytes >= 20000, `got ${tileset?.bytes}`) && ok;
  ok = gate("characters_bytes>=6500", chars && chars.bytes >= 6500, `got ${chars?.bytes}`) && ok;
  ok = gate("creatures_bytes>=3500", creatures && creatures.bytes >= 3500, `got ${creatures?.bytes}`) && ok;
  ok = gate("tileset_unique5>=120", tileset && tileset.unique5 >= 120, `got ${tileset?.unique5}`) && ok;
  ok = gate("chars_unique5>=40", chars && chars.unique5 >= 40, `got ${chars?.unique5}`) && ok;
  ok = gate("creatures_unique5>=60", creatures && creatures.unique5 >= 60, `got ${creatures?.unique5}`) && ok;

  // CRITICAL: plaza must not be ~80% empty beige (mood ~0.28)
  // Allow some headroom vs painted mood art but fail the prior 0.80 disaster.
  ok =
    gate(
      "game_plaza_beige_frac<=0.55",
      plaza && plaza.beige_frac <= 0.55,
      `got ${plaza?.beige_frac?.toFixed(3)} (mood=${mood?.beige_frac?.toFixed(3)})`
    ) && ok;
  ok =
    gate(
      "game_fountain_beige_frac<=0.55",
      fountain && fountain.beige_frac <= 0.55,
      `got ${fountain?.beige_frac?.toFixed(3)}`
    ) && ok;
  ok =
    gate(
      "game_plaza_prop_frac>=0.08",
      plaza && plaza.prop_frac >= 0.08,
      `got ${plaza?.prop_frac?.toFixed(3)} (mood≈${mood?.prop_frac?.toFixed(3)})`
    ) && ok;
  ok =
    gate(
      "game_fountain_prop_frac>=0.08",
      fountain && fountain.prop_frac >= 0.08,
      `got ${fountain?.prop_frac?.toFixed(3)}`
    ) && ok;
  // Must have green gardens AND blue water visible in plaza/fountain shots
  ok =
    gate(
      "game_plaza_green_frac>=0.04",
      plaza && plaza.green_frac >= 0.04,
      `got ${plaza?.green_frac?.toFixed(3)}`
    ) && ok;
  ok =
    gate(
      "game_fountain_blue_frac>=0.015",
      fountain && fountain.blue_frac >= 0.015,
      `got ${fountain?.blue_frac?.toFixed(3)} — fountain mass must read as water`
    ) && ok;
  ok =
    gate(
      "game_plaza_edge>=0.15",
      plaza && plaza.edge_ratio >= 0.15,
      `got ${plaza?.edge_ratio?.toFixed(3)}`
    ) && ok;

  // Side-by-side vs mood: plaza beige must be closer to mood than to pure field
  if (mood && plaza) {
    const distMood = Math.abs(plaza.beige_frac - mood.beige_frac);
    const distSparse = Math.abs(plaza.beige_frac - 0.8);
    ok =
      gate(
        "plaza_closer_to_mood_than_sparse_beige",
        distMood < distSparse,
        `distMood=${distMood.toFixed(3)} distSparse=${distSparse.toFixed(3)}`
      ) && ok;
  } else {
    ok = gate("mood_ref_loaded", false, "missing mood-capital-plaza.jpg") && ok;
  }

  ok = gate("mood_dp_tiles_present", moodTiles) && ok;

  // Char/creature ATLASES must show multi-shade (edge density).
  // Labeled contact sheets have large dark padding — gate the shipped atlas PNGs.
  ok =
    gate(
      "chars_atlas_edge>=0.35",
      chars && chars.edge_ratio >= 0.35,
      `got ${chars?.edge_ratio?.toFixed(3)}`
    ) && ok;
  ok =
    gate(
      "creatures_atlas_edge>=0.30",
      creatures && creatures.edge_ratio >= 0.3,
      `got ${creatures?.edge_ratio?.toFixed(3)}`
    ) && ok;
  ok =
    gate(
      "chars_preview_exists",
      charsPrev && charsPrev.bytes >= 10000,
      `bytes ${charsPrev?.bytes}`
    ) && ok;
  ok =
    gate(
      "creatures_preview_exists",
      crPrev && crPrev.bytes >= 8000,
      `bytes ${crPrev?.bytes}`
    ) && ok;

  // Structural
  const mapSrc = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");
  ok = gate("map_has_fountain", /FOUNTAIN_NW/.test(mapSrc)) && ok;
  ok = gate("map_has_temple", /stampTemple/.test(mapSrc)) && ok;
  ok = gate("map_has_statues", /STATUE_BASE/.test(mapSrc)) && ok;
  ok = gate("map_has_garden_plaza", /GRASS2|garden/i.test(mapSrc) && /stampPlazaRoad|processional/i.test(mapSrc)) && ok;
  ok = gate("map_large_fountain_basin", /WATER2|basin|6×6|grand fountain/i.test(mapSrc)) && ok;

  const winSrc = readFileSync(join(ROOT, "apps/client/src/world/WindowedTilemap.ts"), "utf8");
  ok = gate("scroll_no_MARGIN", !/MARGIN\s*=\s*[1-9]/.test(winSrc)) && ok;
  ok = gate("scroll_incremental", /incrementalShift|edgeFillJobs/.test(winSrc)) && ok;
  const sceneSrc = readFileSync(join(ROOT, "apps/client/src/scenes/WorldScene.ts"), "utf8");
  ok =
    gate(
      "camera_hard_follow",
      /startFollow\(\s*this\.player/.test(sceneSrc) && /setDeadzone\(\s*0\s*,\s*0\s*\)/.test(sceneSrc)
    ) && ok;

  log("\n--- visual checklist (FAIL if gates above fail) ---");
  log("1. Plaza beige_frac must be <=0.55 (was ~0.80 sparse field)");
  log("2. Fountain must show blue water mass (blue_frac gate)");
  log("3. Green gardens + warm props break monotony");
  log("4. Char/creature multi-shade edge density");
  log("5. Mood refs present for side-by-side");

  log("\n" + (ok ? "ART_BAR_PASS true" : "ART_BAR_PASS false"));
  writeFileSync(join(SCRATCH, "art-review.log"), lines.join("\n") + "\n");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
