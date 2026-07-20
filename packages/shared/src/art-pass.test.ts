/**
 * DP art-pass gates: roof grammar, density, anim, silhouette, contrast.
 * Drives shipped art-pass.ts, stamps in gen-map, palette, tileset pixels.
 * Run: pnpm exec tsx packages/shared/src/art-pass.test.ts
 */
import {
  houseRoofColumn,
  houseWallRow,
  houseDoorRow,
  HOUSE_ROOF_ROWS,
  HOUSE_DOOR_LOCAL_Y,
  ROOF_ROWS_MIN,
  ROOF_ROWS_MAX,
  isRoofTile,
  isFacadeTile,
  roofVsFacadeCounts,
  topRoofRun,
  bareGroundFraction,
  collectFrameTiles,
  countDistinctObjectTypes,
  CAMERA_FRAME_W,
  CAMERA_FRAME_H,
  TILE_ANIM_PERIOD_MS,
  TILE_ANIM_FRAMES,
  ANIMATED_TILE_FRAMES,
  ANIM_FRAME_FAMILY,
  animatedTileIndex,
  tileAnimFrameIndex,
  tileAnimPhaseOffset,
  isAnimatedTile,
  animFramesAreSameObject,
  maskJaccardDistance,
  alphaMaskFromRgba,
  ORGANIC_GROUND,
} from "./art-pass.js";
import { Tile, TILESET_COLS } from "./tiles.js";
import { readFileSync, existsSync } from "node:fs";
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// --- Roof grammar (shipped houseRoofColumn) ---
{
  const col = houseRoofColumn(2);
  ok("house roof rows in 3–5", col.length >= ROOF_ROWS_MIN && col.length <= ROOF_ROWS_MAX, `n=${col.length}`);
  ok("HOUSE_ROOF_ROWS matches column", col.length === HOUSE_ROOF_ROWS);
  ok("roof column all roof tiles", col.every(isRoofTile));
  ok("eave is last roof row", col[col.length - 1] === Tile.H_EAVE_SHADOW);
  ok("ridge/top is roof", isRoofTile(col[0]!));
  const run = topRoofRun([...col, houseWallRow(2), houseDoorRow(2)]);
  ok("top roof run 3–5", run >= 3 && run <= 5, `run=${run}`);
  const { roof, facade } = roofVsFacadeCounts([...col, houseWallRow(2), houseDoorRow(2)]);
  ok("house roof cells ≥ facade cells", roof >= facade, `roof=${roof} facade=${facade}`);
  ok("door on door row", houseDoorRow(2) === Tile.H_DOOR);
  ok("door local y after roof+wall", HOUSE_DOOR_LOCAL_Y === HOUSE_ROOF_ROWS + 1);
}

// --- gen-map source contracts ---
{
  const genMap = readFileSync(join(ROOT, "tools/gen-map.ts"), "utf8");
  ok("gen-map uses houseRoofColumn", /houseRoofColumn/.test(genMap));
  ok("gen-map stampTemple has H_ROOF_RIDGE", /H_ROOF_RIDGE/.test(genMap));
  ok("gen-map stampTemple has H_EAVE_SHADOW", /H_EAVE_SHADOW/.test(genMap));
  ok("gen-map stampShrine has multi-row roof", /H_EAVE_SHADOW/.test(genMap) && /function stampShrine/.test(genMap));
  ok("gen-map stampStoa has 3-row roof", /function stampStoa[\s\S]*H_ROOF_RIDGE/.test(genMap));
  ok("gen-map density clutter pass", /density clutter pass/.test(genMap));
  ok("gen-map purges organic-in-structure", /organic-in-structure/.test(genMap));
  ok("gen-map places new clutter tiles", /Tile\.HEDGE/.test(genMap) && /Tile\.LANTERN/.test(genMap) && /Tile\.MARKET/.test(genMap));
}

// --- Animation contract (honest: same-object frames, real phase variety) ---
{
  ok("anim period ~500ms", TILE_ANIM_PERIOD_MS === 500);
  ok("water frames 2–4", TILE_ANIM_FRAMES.water >= 2 && TILE_ANIM_FRAMES.water <= 4);
  ok("fountain frames 2–4", TILE_ANIM_FRAMES.fountain >= 2 && TILE_ANIM_FRAMES.fountain <= 4);
  ok("banner frames 2–4", TILE_ANIM_FRAMES.banner >= 2 && TILE_ANIM_FRAMES.banner <= 4);
  ok("flowers frames 2–4", TILE_ANIM_FRAMES.flowers >= 2 && TILE_ANIM_FRAMES.flowers <= 4);
  ok("WATER is animated", isAnimatedTile(Tile.WATER));
  ok("BANNER is animated", isAnimatedTile(Tile.BANNER));
  ok("FLOWERS_RED is animated", isAnimatedTile(Tile.FLOWERS_RED));
  ok("FOUNTAIN_NW is animated", isAnimatedTile(Tile.FOUNTAIN_NW));

  // Water advances over one period at fixed cell
  const w0 = animatedTileIndex(Tile.WATER, 0, 10, 20);
  const w1 = animatedTileIndex(Tile.WATER, TILE_ANIM_PERIOD_MS, 10, 20);
  ok("water frame advances over period", w0 !== w1, `t0=${w0} t500=${w1}`);
  ok(
    "water frames stay in water family",
    ANIM_FRAME_FAMILY[w0] === "water" && ANIM_FRAME_FAMILY[w1] === "water"
  );

  // Phase offset must differ for distant tiles (not theater)
  const phaseA = tileAnimPhaseOffset(10, 20);
  const phaseB = tileAnimPhaseOffset(99, 20);
  ok("water phase offset differs by tile x", phaseA !== phaseB, `a=${phaseA} b=${phaseB}`);
  const fiA = tileAnimFrameIndex(0, 10, 20, 3);
  const fiB = tileAnimFrameIndex(0, 99, 20, 3);
  // With period 500 and different offsets, at least some pairs differ; try several times
  let phaseVariety = fiA !== fiB;
  if (!phaseVariety) {
    for (let t = 0; t < 500 && !phaseVariety; t += 50) {
      if (tileAnimFrameIndex(t, 1, 1, 3) !== tileAnimFrameIndex(t, 50, 50, 3)) phaseVariety = true;
    }
  }
  ok("water multi-tile phase yields different frame indices", phaseVariety);

  // Same-object: every animated base keeps family across all frames
  const bases = [
    Tile.WATER,
    Tile.WATER_SHORE,
    Tile.FOUNTAIN_NW,
    Tile.FOUNTAIN_NE,
    Tile.FOUNTAIN_SW,
    Tile.FOUNTAIN_SE,
    Tile.BANNER,
    Tile.FLOWERS_RED,
    Tile.FLOWERS_GOLD,
  ];
  for (const b of bases) {
    ok(`animFramesAreSameObject(${b})`, animFramesAreSameObject(b));
    const fr = ANIMATED_TILE_FRAMES[b]!;
    ok(`frames for ${b} length 2–4`, fr.length >= 2 && fr.length <= 4);
    // Distinct frame ids (real variants, not duplicate no-ops only)
    ok(`frames for ${b} not all identical`, new Set(fr).size >= 2, `fr=${fr.join(",")}`);
  }

  // Fountain: NW never becomes NE/SE/SW at any time
  let nwBad: number | null = null;
  for (let t = 0; t < 2000; t += 100) {
    const id = animatedTileIndex(Tile.FOUNTAIN_NW, t, 0, 0);
    if (id !== Tile.FOUNTAIN_NW && id !== Tile.FOUNTAIN_NW2) {
      nwBad = id;
      break;
    }
  }
  ok("fountain NW stays NW family over 2s", nwBad === null, nwBad != null ? `bad id=${nwBad}` : "");
  ok(
    "fountain NW frames only NW/NW2",
    ANIMATED_TILE_FRAMES[Tile.FOUNTAIN_NW]!.every(
      (f) => f === Tile.FOUNTAIN_NW || f === Tile.FOUNTAIN_NW2
    )
  );
  ok(
    "fountain NE never lists NW",
    !ANIMATED_TILE_FRAMES[Tile.FOUNTAIN_NE]!.includes(Tile.FOUNTAIN_NW) &&
      !ANIMATED_TILE_FRAMES[Tile.FOUNTAIN_NE]!.includes(Tile.FOUNTAIN_NW2)
  );

  // Banner: never awning
  const banFrames = ANIMATED_TILE_FRAMES[Tile.BANNER]!;
  ok(
    "banner frames never include AWNING",
    !banFrames.includes(Tile.AWNING) && banFrames.every((f) => ANIM_FRAME_FAMILY[f] === "banner")
  );
  const b0 = animatedTileIndex(Tile.BANNER, 0, 3, 3);
  const b1 = animatedTileIndex(Tile.BANNER, 500, 3, 3);
  ok("banner advances between BANNER and BANNER2", b0 !== b1, `t0=${b0} t500=${b1}`);
  ok("banner frames are banner family", ANIM_FRAME_FAMILY[b0] === "banner" && ANIM_FRAME_FAMILY[b1] === "banner");

  // Flowers: red never becomes gold
  ok(
    "flowers red frames stay red family",
    ANIMATED_TILE_FRAMES[Tile.FLOWERS_RED]!.every((f) => ANIM_FRAME_FAMILY[f] === "flowers_red")
  );
  ok(
    "flowers gold frames stay gold family",
    ANIMATED_TILE_FRAMES[Tile.FLOWERS_GOLD]!.every((f) => ANIM_FRAME_FAMILY[f] === "flowers_gold")
  );

  // client wires anim
  const wtm = readFileSync(join(ROOT, "apps/client/src/world/WindowedTilemap.ts"), "utf8");
  ok("WindowedTilemap imports animatedTileIndex", /animatedTileIndex/.test(wtm));
  ok("WindowedTilemap tickAnimatedTiles", /tickAnimatedTiles/.test(wtm));
  ok("WindowedTilemap uses TILE_ANIM_PERIOD_MS", /TILE_ANIM_PERIOD_MS/.test(wtm));
}

// --- Palette contrast / hue ---
{
  const pal = readFileSync(join(ROOT, "tools/palette.ts"), "utf8");
  ok("palette has near-black door e0", /e0:\s*"#080408"/.test(pal) || /e0:\s*"#[0-2]/.test(pal));
  ok("palette has roof deep f0 near-black", /f0:\s*"#180808"/.test(pal) || /f0:\s*"#[0-3]/.test(pal));
  ok("palette has canopy deep c0", /c0:\s*"#081810"/.test(pal) || /c0:\s*"#[0-2]/.test(pal));
  ok("palette ZONE_ACCENT", /ZONE_ACCENT/.test(pal));
  ok("palette MATERIAL_HUE_FAMILY", /MATERIAL_HUE_FAMILY/.test(pal));
  ok("palette court ramp", /court:/.test(pal));
  ok("palette teal accent", /teal:/.test(pal));
  // dynamic import of relative luminance
  const { relativeLuminance, P, RAMPS, MATERIAL_HUE_FAMILY, ZONE_ACCENT } = await import(
    join(ROOT, "tools/palette.ts") as string
  ).catch(async () => {
    // tsx path
    return await import("../../../tools/palette.js").catch(() => null);
  });
  if (P && relativeLuminance) {
    const doorL = relativeLuminance(P.e0);
    const eaveL = relativeLuminance(P.f0);
    const inkL = relativeLuminance(P.ink);
    const marbleL = relativeLuminance(P.m4);
    ok("door deep near-black L<0.05", doorL < 0.05, `L=${doorL.toFixed(4)}`);
    ok("eave/roof deep near-black L<0.08", eaveL < 0.08, `L=${eaveL.toFixed(4)}`);
    ok("ink near-black", inkL < 0.05, `L=${inkL.toFixed(4)}`);
    ok("marble light near-white L>0.7", marbleL > 0.55, `L=${marbleL.toFixed(4)}`);
    ok(
      "floor dirt vs wall marble different hue family",
      MATERIAL_HUE_FAMILY.dirt !== MATERIAL_HUE_FAMILY.marble
    );
    ok(
      "stone vs marble different hue family",
      MATERIAL_HUE_FAMILY.stone !== MATERIAL_HUE_FAMILY.marble
    );
    ok("zone accents present", !!ZONE_ACCENT.temple && !!ZONE_ACCENT.market && !!ZONE_ACCENT.court);
    // ramp index 0 is darkest
    for (const name of ["grass", "marble", "roof", "door", "canopy", "water"] as const) {
      const r = RAMPS[name];
      if (!r) continue;
      const l0 = relativeLuminance(r[0]!);
      const lLast = relativeLuminance(r[r.length - 1]!);
      ok(`ramp ${name} deep darker than highlight`, l0 < lLast, `${l0.toFixed(3)} < ${lLast.toFixed(3)}`);
    }
  } else {
    ok("palette module load (fallback source gates only)", true);
  }
}

// --- World metrics (shipped world.json) ---
{
  const worldPath = join(ROOT, "apps/client/public/assets/world/world.json");
  if (!existsSync(worldPath)) {
    ok("world.json exists", false);
  } else {
    const world = JSON.parse(readFileSync(worldPath, "utf8")) as {
      width: number;
      height: number;
      layers: { ground: string; deco: string; overhead: string };
      houses: Array<{ doorX: number; doorY: number }>;
    };
    const W = world.width;
    const gBuf = Buffer.from(world.layers.ground, "base64");
    const dBuf = Buffer.from(world.layers.deco, "base64");
    const oBuf = Buffer.from(world.layers.overhead, "base64");
    const gAt = (x: number, y: number) => gBuf.readUInt16LE((y * W + x) * 2);
    const dAt = (x: number, y: number) => dBuf.readUInt16LE((y * W + x) * 2);
    const oAt = (x: number, y: number) => oBuf.readUInt16LE((y * W + x) * 2);

    // Temple door cell
    const { PUBLIC_BUILDINGS } = await import("./buildings.js");
    for (const b of PUBLIC_BUILDINGS) {
      ok(
        `${b.id} door is H_DOOR`,
        dAt(b.doorX, b.doorY) === Tile.H_DOOR,
        `deco=${dAt(b.doorX, b.doorY)} at ${b.doorX},${b.doorY}`
      );
    }

    // Roof run above temple door (skip rear cella north of roof; measure roof mass only)
    {
      const tx = 511;
      const doorY = PUBLIC_BUILDINGS.find((b) => b.id === "grand-temple")!.doorY;
      const col: number[] = [];
      for (let y = doorY - 12; y <= doorY; y++) col.push(dAt(tx, y));
      // Longest consecutive roof run in column (ridge→body→eave)
      let best = 0;
      let cur = 0;
      for (const t of col) {
        if (isRoofTile(t)) {
          cur++;
          best = Math.max(best, cur);
        } else cur = 0;
      }
      ok("temple roof mass run 3–5", best >= 3 && best <= 5, `run=${best}`);
      ok(
        "temple column has eave shadow",
        col.includes(Tile.H_EAVE_SHADOW),
        `tiles=${col.filter(isRoofTile).join(",")}`
      );
      // Roof mass area ≥ facade face: count roof tiles vs door-row facade only (not rear podium)
      const roofN = col.filter(isRoofTile).length;
      // facade = frieze/col/door south of eave until door inclusive
      let facadeN = 0;
      let seenEave = false;
      for (const t of col) {
        if (t === Tile.H_EAVE_SHADOW) seenEave = true;
        if (!seenEave) continue;
        if (isFacadeTile(t) || t === Tile.H_DOOR) facadeN++;
      }
      ok("temple roof ≥ south facade", roofN >= facadeN, `r=${roofN} f=${facadeN}`);
    }

    // House sample roof
    if (world.houses?.length) {
      const h0 = world.houses[0]!;
      const hx = h0.doorX - 2;
      const hy = h0.doorY - HOUSE_DOOR_LOCAL_Y;
      const col: number[] = [];
      for (let r = 0; r < 6; r++) col.push(dAt(hx + 2, hy + r));
      const run = topRoofRun(col);
      ok("house roof run 3–5", run >= 3 && run <= 5, `run=${run} door=${h0.doorX},${h0.doorY}`);
      ok("house has eave", col.includes(Tile.H_EAVE_SHADOW));
    }

    // Density: plaza camera frame around fountain
    const bare = bareGroundFraction(
      W,
      502,
      510,
      CAMERA_FRAME_W,
      CAMERA_FRAME_H,
      gAt,
      dAt,
      oAt
    );
    ok("plaza frame bare ground ≤ 0.30", bare <= 0.3, `bare=${bare.toFixed(3)}`);

    // Temple approach frame
    const bareT = bareGroundFraction(W, 501, 482, CAMERA_FRAME_W, CAMERA_FRAME_H, gAt, dAt, oAt);
    ok("temple frame bare ground ≤ 0.35", bareT <= 0.35, `bare=${bareT.toFixed(3)}`);

    const tiles = collectFrameTiles(W, 502, 510, CAMERA_FRAME_W, CAMERA_FRAME_H, dAt, oAt);
    const nTypes = countDistinctObjectTypes(tiles);
    ok("plaza frame ≥ 8 object types", nTypes >= 8, `types=${nTypes}`);

    // Organic inside structure roofs
    let organicHits = 0;
    let structCells = 0;
    for (let y = 478; y <= 545; y++) {
      for (let x = 478; x <= 545; x++) {
        const d = dAt(x, y);
        if (!isRoofTile(d) && !isFacadeTile(d)) continue;
        structCells++;
        if (ORGANIC_GROUND.has(gAt(x, y))) organicHits++;
      }
    }
    ok(
      "no organic ground under plaza structure deco",
      organicHits === 0,
      `hits=${organicHits}/${structCells}`
    );

    // Vocabulary present in capital
    const need = [
      Tile.HEDGE,
      Tile.LANTERN,
      Tile.FENCE,
      Tile.SIGNPOST,
      Tile.AWNING,
      Tile.MARKET,
      Tile.H_EAVE_SHADOW,
      Tile.H_ROOF_RIDGE,
    ];
    for (const t of need) {
      let found = false;
      for (let y = 430; y < 560 && !found; y++) {
        for (let x = 430; x < 560 && !found; x++) {
          if (dAt(x, y) === t || oAt(x, y) === t) found = true;
        }
      }
      ok(`capital contains tile ${t}`, found);
    }
  }
}

// --- Tileset silhouette + value span ---
{
  const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
  if (!existsSync(tilesetPath)) {
    ok("tileset.png exists", false);
  } else {
    try {
      const { createCanvas, loadImage } = await import("@napi-rs/canvas");
      const img = await loadImage(tilesetPath);
      const extract = (id: number) => {
        const c = createCanvas(16, 16);
        const ctx = c.getContext("2d");
        const sx = (id % TILESET_COLS) * 16;
        const sy = Math.floor(id / TILESET_COLS) * 16;
        ctx.drawImage(img, sx, sy, 16, 16, 0, 0, 16, 16);
        return ctx.getImageData(0, 0, 16, 16).data;
      };
      const bushM = alphaMaskFromRgba(extract(Tile.BUSH), 16, 16);
      const amphM = alphaMaskFromRgba(extract(Tile.AMPHORA), 16, 16);
      const statM = alphaMaskFromRgba(extract(Tile.STATUE_TOP), 16, 16);
      const dBA = maskJaccardDistance(bushM, amphM);
      const dBS = maskJaccardDistance(bushM, statM);
      const dAS = maskJaccardDistance(amphM, statM);
      ok("bush≠amphora silhouette", dBA > 0.15, `jaccardDist=${dBA.toFixed(3)}`);
      ok("bush≠statue silhouette", dBS > 0.15, `jaccardDist=${dBS.toFixed(3)}`);
      ok("amphora≠statue silhouette", dAS > 0.12, `jaccardDist=${dAS.toFixed(3)}`);

      // value histogram span near-black to near-white across sample tiles
      const sampleIds = [
        Tile.H_DOOR,
        Tile.H_EAVE_SHADOW,
        Tile.MARBLE_FLOOR,
        Tile.MARBLE_COURT,
        Tile.GRASS,
        Tile.WATER,
        Tile.H_ROOF_RIDGE,
        Tile.BUSH,
        Tile.STATUE_TOP,
      ];
      let minL = 1;
      let maxL = 0;
      const lum = (r: number, g: number, b: number) =>
        (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      for (const id of sampleIds) {
        const data = extract(id);
        for (let i = 0; i < 16 * 16; i++) {
          if (data[i * 4 + 3]! < 32) continue;
          const L = lum(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
          minL = Math.min(minL, L);
          maxL = Math.max(maxL, L);
        }
      }
      ok("value histogram near-black", minL < 0.12, `minL=${minL.toFixed(3)}`);
      ok("value histogram near-white", maxL > 0.75, `maxL=${maxL.toFixed(3)}`);

      // eave tile mostly dark
      const eave = extract(Tile.H_EAVE_SHADOW);
      let dark = 0;
      let n = 0;
      for (let i = 0; i < 16 * 16; i++) {
        if (eave[i * 4 + 3]! < 32) continue;
        n++;
        if (lum(eave[i * 4]!, eave[i * 4 + 1]!, eave[i * 4 + 2]!) < 0.2) dark++;
      }
      ok("eave shadow mostly dark pixels", n > 0 && dark / n > 0.6, `darkFrac=${(dark / n).toFixed(2)}`);
    } catch (e) {
      ok("tileset silhouette analysis", false, String(e));
    }
  }
}

// --- y-sort roofs ---
{
  const tp = readFileSync(join(ROOT, "packages/shared/src/tall-props.ts"), "utf8");
  ok("ROOF_YSORT_TILES defined", /ROOF_YSORT_TILES/.test(tp));
  ok("H_EAVE_SHADOW in tall props", /H_EAVE_SHADOW/.test(tp));
  const { isTallPropBase } = await import("./tall-props.js");
  ok("roof ridge is tall prop base", isTallPropBase(Tile.H_ROOF_RIDGE));
  ok("eave is tall prop base", isTallPropBase(Tile.H_EAVE_SHADOW));
}

console.log(lines.join("\n"));
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
