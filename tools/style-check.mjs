/**
 * Structural style gates for DP-bar graphics.
 * Checks shipped tileset + client flags + world scatter/transition stats.
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

function gate(name, ok, detail) {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  return ok;
}

async function sampleTile(img, tileIndex, cols, tileSize = 16) {
  const sx = (tileIndex % cols) * tileSize;
  const sy = Math.floor(tileIndex / cols) * tileSize;
  const c = createCanvas(tileSize, tileSize);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, tileSize, tileSize, 0, 0, tileSize, tileSize);
  return ctx.getImageData(0, 0, tileSize, tileSize).data;
}

function hasSemiTransparentDark(data) {
  // shadow/AO: dark-ish with alpha between ~40 and 240 OR opaque palette ink
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const L = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (a >= 40 && a < 250 && L < 90) n++;
    // opaque contact/cast shadow from global palette (ink / deep)
    else if (a >= 250 && L < 70) n++;
  }
  return n;
}

/** Count dark pixels near the bottom rows (contact shadow footprint). */
function contactShadowPixels(data, w = 16, h = 16) {
  let n = 0;
  for (let y = h - 3; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 40) continue;
      const L = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (L < 85) n++;
    }
  }
  return n;
}

function ditherScore(data, w = 16, h = 16) {
  // checker / alternating neighbor differences (ordered dither signature)
  let alt = 0;
  let tot = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const j = i + 4;
      if (data[i + 3] < 16 || data[j + 3] < 16) continue;
      const d =
        Math.abs(data[i] - data[j]) +
        Math.abs(data[i + 1] - data[j + 1]) +
        Math.abs(data[i + 2] - data[j + 2]);
      tot++;
      if (d > 8 && d < 80) alt++;
    }
  }
  return tot ? alt / tot : 0;
}

function paletteHarsh(data) {
  // pure white / pure black primary fills
  let pureW = 0,
    pureB = 0,
    tot = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    tot++;
    if (data[i] >= 252 && data[i + 1] >= 252 && data[i + 2] >= 252) pureW++;
    if (data[i] <= 3 && data[i + 1] <= 3 && data[i + 2] <= 3) pureB++;
  }
  return { pureW: tot ? pureW / tot : 0, pureB: tot ? pureB / tot : 0, tot };
}

async function main() {
  log("=== STYLE CHECK (DP-bar structural) ===");
  log(new Date().toISOString());
  let ok = true;

  const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
  const charsPath = join(ROOT, "apps/client/public/assets/characters.png");
  const creaturesPath = join(ROOT, "apps/client/public/assets/creatures.png");
  const mainTs = readFileSync(join(ROOT, "apps/client/src/main.ts"), "utf8");
  const pixelTs = readFileSync(join(ROOT, "tools/pixel.ts"), "utf8");
  const genTileset = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
  const autotile = readFileSync(join(ROOT, "packages/shared/src/autotile.ts"), "utf8");
  const tilesTs = readFileSync(join(ROOT, "packages/shared/src/tiles.ts"), "utf8");

  ok = gate("tileset_exists", existsSync(tilesetPath)) && ok;
  ok = gate("characters_exists", existsSync(charsPath)) && ok;
  ok = gate("creatures_exists", existsSync(creaturesPath)) && ok;
  // Indexed ≤48-color hard-edge tileset compresses smaller than noisy dither PNGs
  ok = gate("tileset_bytes>=20000", statSync(tilesetPath).size >= 20000, `got ${statSync(tilesetPath).size}`) && ok;

  ok = gate("client_pixelArt_true", /pixelArt:\s*true/.test(mainTs)) && ok;
  ok = gate("pixel_toolkit_nearest_neighbor", /imageSmoothingEnabled\s*=\s*false/.test(pixelTs)) && ok;
  ok = gate("gen_tileset_nearest_neighbor", /imageSmoothingEnabled\s*=\s*false/.test(genTileset)) && ok;
  ok = gate("autotile_blob_48", /BLOB_TILE_COUNT\s*=\s*48/.test(autotile)) && ok;
  ok = gate("transition_pairs_defined", /TRANSITION_PAIRS/.test(autotile) && /TRANSITION_BASE/.test(tilesTs)) && ok;
  // Dither helpers may remain for sprites, but transitions must be hard-edged
  ok = gate("hard_blob_transition", /cover\s*>=\s*0\.5/.test(pixelTs) && /paintBlobTransition/.test(pixelTs)) && ok;
  ok = gate("no_wide_edgeSoft_feather", !/edgeSoft\s*=\s*0\.3/.test(pixelTs)) && ok;
  ok = gate("drop_shadow_helpers", /dropShadow|contactShadow/.test(pixelTs)) && ok;
  ok = gate("outline_helpers", /applySelectiveOutline/.test(pixelTs)) && ok;
  // Solid hard shadows: dropShadow must not dither soft edges
  ok =
    gate(
      "dropShadow_solid_no_dither",
      /function dropShadow[\s\S]*?^}/m.test(pixelTs) &&
        !/function dropShadow[\s\S]*?ditherThreshold[\s\S]*?^}/m.test(pixelTs)
    ) && ok;
  // Ground floors: gen-tileset must not call ditherVGradient on ground painters
  ok =
    gate(
      "gen_no_ground_ditherVGradient",
      !/\bditherVGradient\s*\(/.test(genTileset)
    ) && ok;
  ok = gate("gen_has_slab_seams", /paintSlabSeams/.test(genTileset)) && ok; // paintSlabSeamsFromRamp
  ok = gate("gen_water_shore_foam", /foam|coping|W\.pale/.test(genTileset)) && ok;

  const img = await loadImage(tilesetPath);
  const cols = 16; // TILESET_COLS
  // Prop tiles with expected shadows: BUSH=19, BOULDER=20, TREE_TRUNK=21, PILLAR=22, COLUMN_BASE=23, STATUE_BASE=24, AMPHORA=61
  const propIds = [19, 20, 21, 22, 23, 24, 61, 60];
  let propsWithShadow = 0;
  for (const id of propIds) {
    const data = await sampleTile(img, id, cols);
    const n = hasSemiTransparentDark(data) + contactShadowPixels(data);
    if (n >= 4) propsWithShadow++;
    log(`  prop ${id} shadow/AO pixels: ${n}`);
  }
  ok = gate("props_have_shadow_AO", propsWithShadow >= 6, `${propsWithShadow}/${propIds.length}`) && ok;

  // Water tiles: sparse wave lines give neighbor variation (not Bayer spray)
  const waterData = await sampleTile(img, 11, cols);
  const waterDith = ditherScore(waterData);
  log(`  water texture score: ${waterDith.toFixed(3)}`);
  ok = gate("water_has_texture_variation", waterDith >= 0.02, `score=${waterDith.toFixed(3)}`) && ok;

  // Transition tile (first blob at TRANSITION_BASE) should differ from pure fills
  // Parse TRANSITION_BASE from tiles.ts so new prop IDs don't hard-break this gate.
  const tbMatch = tilesTs.match(/TRANSITION_BASE\s*=\s*(\d+)/);
  const transitionBase = tbMatch ? parseInt(tbMatch[1], 10) : 94;
  const t0 = await sampleTile(img, transitionBase, cols);
  const opaque = [...t0].filter((_, i) => i % 4 === 3 && t0[i] > 200).length;
  ok = gate("transition_tile_0_painted", opaque >= 200, `opaque~${opaque} id=${transitionBase}`) && ok;

  // Palette: grass/marble not pure white/black dominant
  const grass = paletteHarsh(await sampleTile(img, 1, cols));
  const marble = paletteHarsh(await sampleTile(img, 8, cols));
  log(`  grass pureW=${grass.pureW.toFixed(3)} pureB=${grass.pureB.toFixed(3)}`);
  log(`  marble pureW=${marble.pureW.toFixed(3)} pureB=${marble.pureB.toFixed(3)}`);
  ok = gate("grass_not_pure_white_fill", grass.pureW < 0.05) && ok;
  ok = gate("marble_not_pure_white_fill", marble.pureW < 0.15, `got ${marble.pureW.toFixed(3)}`) && ok;

  // World scatter + transition stats (drive real world.json)
  const worldPath = join(ROOT, "apps/server/data/world.json");
  if (existsSync(worldPath)) {
    // dynamic import of shared decode via child — parse base64 layers lightly
    const { execSync } = await import("node:child_process");
    const out = execSync(
      `pnpm exec tsx -e '
import { readFileSync } from "fs";
import { decodeWorld, decodeTransitionTile, SCATTER_DECALS, Tile } from "./packages/shared/src/index.ts";
const w = decodeWorld(JSON.parse(readFileSync("apps/server/data/world.json","utf8")));
let wt=0, ws=0, grassOnly=0, grassVar=0;
const gset=new Set();
for(let i=0;i<w.ground.length;i++){
  const g=w.ground[i];
  if(decodeTransitionTile(g)) wt++;
  if(SCATTER_DECALS.includes(w.deco[i])) ws++;
  if(g===Tile.GRASS||g===Tile.GRASS2||g===Tile.GRASS3||g===Tile.GRASS4){ grassOnly++; gset.add(g); }
}
// plaza region
let pt=0, pb=0, ps=0; const u=new Set();
for(let y=478;y<=545;y++)for(let x=478;x<=545;x++){
  const i=y*w.width+x; const g=w.ground[i]; u.add(g);
  if(decodeTransitionTile(g)) pt++; else pb++;
  if(SCATTER_DECALS.includes(w.deco[i])) ps++;
}
console.log(JSON.stringify({worldTrans:wt,worldScatter:ws,grassVariants:gset.size,plazaTrans:pt,plazaBase:pb,plazaScatter:ps,plazaUnique:u.size}));
'`,
      { cwd: ROOT, encoding: "utf8" }
    );
    log("  world stats: " + out.trim());
    const st = JSON.parse(out.trim());
    ok = gate("world_has_transition_tiles", st.worldTrans > 1000, `got ${st.worldTrans}`) && ok;
    ok = gate("world_has_scatter_decals", st.worldScatter > 5000, `got ${st.worldScatter}`) && ok;
    ok = gate("grass_variants_used", st.grassVariants >= 3, `got ${st.grassVariants}`) && ok;
    ok = gate("plaza_has_transitions", st.plazaTrans > 50, `got ${st.plazaTrans}`) && ok;
    ok = gate("plaza_unique_ground>=8", st.plazaUnique >= 8, `got ${st.plazaUnique}`) && ok;
  } else {
    ok = gate("world_json_exists", false) && ok;
  }

  log(ok ? "\nALL STYLE GATES PASSED" : "\nSOME STYLE GATES FAILED");
  const outPath = join(SCRATCH, "style-check.log");
  writeFileSync(outPath, lines.join("\n") + "\n");
  log("wrote " + outPath);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
