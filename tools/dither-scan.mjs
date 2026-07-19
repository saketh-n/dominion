/**
 * Scan shipped tileset for true 50% Bayer-style 2D checkerboard regions.
 * A checker cell is a 2×2 where diagonals match and adjacent differ.
 * Max contiguous region width must be ≤2px.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tilesetPath = join(ROOT, "apps/client/public/assets/tileset.png");
const SCRATCH = process.env.SCRATCH || join(ROOT, "preview");
const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

function rgbKey(d, i) {
  return `${d[i]},${d[i + 1]},${d[i + 2]}`;
}

function colorsDiffer(d, i, j, thr = 12) {
  return (
    Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) > thr
  );
}

/**
 * Mark pixels that participate in a local 2×2 Bayer checker.
 * Pattern: A B / B A  (or B A / A B)
 */
function checkerMask(data, w, h) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i00 = (y * w + x) * 4;
      const i10 = (y * w + x + 1) * 4;
      const i01 = ((y + 1) * w + x) * 4;
      const i11 = ((y + 1) * w + x + 1) * 4;
      if (data[i00 + 3] < 200 || data[i10 + 3] < 200 || data[i01 + 3] < 200 || data[i11 + 3] < 200)
        continue;
      const sameDiag =
        !colorsDiffer(data, i00, i11, 18) && !colorsDiffer(data, i10, i01, 18);
      const diffAdj =
        colorsDiffer(data, i00, i10, 18) &&
        colorsDiffer(data, i00, i01, 18) &&
        colorsDiffer(data, i11, i10, 18) &&
        colorsDiffer(data, i11, i01, 18);
      if (sameDiag && diffAdj) {
        mask[y * w + x] = 1;
        mask[y * w + x + 1] = 1;
        mask[(y + 1) * w + x] = 1;
        mask[(y + 1) * w + x + 1] = 1;
      }
    }
  }
  return mask;
}

/** Max width of any 4-connected component of checker mask. */
function maxComponentWidth(mask, w, h) {
  const seen = new Uint8Array(w * h);
  let maxW = 0;
  let maxSize = 0;
  let sample = null;
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = y * w + x;
      if (!mask[i0] || seen[i0]) continue;
      let head = 0,
        tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[i0] = 1;
      let minX = x,
        maxX = x,
        size = 0;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        size++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      const width = maxX - minX + 1;
      if (width > maxW || (width === maxW && size > maxSize)) {
        maxW = width;
        maxSize = size;
        sample = { x, y, width, size };
      }
    }
  }
  return { maxW, maxSize, sample };
}

async function sampleTile(img, id, cols = 16, T = 16) {
  const sx = (id % cols) * T;
  const sy = Math.floor(id / cols) * T;
  const c = createCanvas(T, T);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, T, T, 0, 0, T, T);
  return ctx.getImageData(0, 0, T, T);
}

function distinctColors(imgData) {
  const s = new Set();
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    s.add(rgbKey(d, i));
  }
  return s.size;
}

async function main() {
  log("=== DITHER / EDGE / WATER SCAN (2D Bayer field) ===");
  log(new Date().toISOString());
  const img = await loadImage(tilesetPath);
  const full = createCanvas(img.width, img.height);
  const fctx = full.getContext("2d");
  fctx.imageSmoothingEnabled = false;
  fctx.drawImage(img, 0, 0);
  const fullData = fctx.getImageData(0, 0, img.width, img.height);
  const mask = checkerMask(fullData.data, img.width, img.height);
  const { maxW, maxSize, sample } = maxComponentWidth(mask, img.width, img.height);
  log(`max_2d_checker_width_px=${maxW} size=${maxSize} sample=${JSON.stringify(sample)}`);
  const ditherOk = maxW <= 2;
  log(`${ditherOk ? "PASS" : "FAIL"}  max_checker_region_width_le_2  got=${maxW}`);

  // Per base tile
  let worstTile = 0,
    worstW = 0;
  for (let id = 1; id < 86; id++) {
    const td = await sampleTile(img, id);
    const m = checkerMask(td.data, 16, 16);
    const r = maxComponentWidth(m, 16, 16);
    if (r.maxW > worstW) {
      worstW = r.maxW;
      worstTile = id;
    }
  }
  log(`worst_base_tile_2d_checker id=${worstTile} w=${worstW}`);
  const matOk = worstW <= 2;
  log(`${matOk ? "PASS" : "FAIL"}  material_interior_dither_le_2  worst=${worstW}`);

  // Water / shore
  const water = await sampleTile(img, 11);
  const shore = await sampleTile(img, 13);
  const waterColors = distinctColors(water);
  const shoreColors = distinctColors(shore);
  const shoreChecker = maxComponentWidth(checkerMask(shore.data, 16, 16), 16, 16).maxW;
  log(`water colors=${waterColors} shore colors=${shoreColors} shore2dChecker=${shoreChecker}`);
  const waterOk = shoreChecker <= 2 && shoreColors >= 4;
  log(
    `${waterOk ? "PASS" : "FAIL"}  water_shore_no_dot_spray  shoreChecker=${shoreChecker} colors=${shoreColors}`
  );

  // Foam line on shore row 3
  let foamN = 0;
  const sd = shore.data;
  for (let x = 0; x < 16; x++) {
    const i = (3 * 16 + x) * 4;
    if (sd[i + 3] >= 200 && sd[i + 2] > sd[i] + 20) foamN++;
  }
  log(`shore row3 foam candidates=${foamN}`);
  log(`${foamN >= 4 ? "PASS" : "FAIL"}  water_1px_foam_line  foamN=${foamN}`);

  // Transition tiles
  let tMax = 0,
    tId = 86;
  for (let id = 86; id < 86 + 48 * 3; id++) {
    const td = await sampleTile(img, id);
    const r = maxComponentWidth(checkerMask(td.data, 16, 16), 16, 16);
    if (r.maxW > tMax) {
      tMax = r.maxW;
      tId = id;
    }
  }
  log(`transition 2d checker max id=${tId} w=${tMax}`);
  log(`${tMax <= 2 ? "PASS" : "FAIL"}  transition_no_wide_2d_checker  max=${tMax}`);

  // Source gates
  const pixelTs = readFileSync(join(ROOT, "tools/pixel.ts"), "utf8");
  const genTs = readFileSync(join(ROOT, "tools/gen-tileset.ts"), "utf8");
  const hardCut = /cover\s*>=\s*0\.5/.test(pixelTs) && !/edgeSoft\s*=\s*0\.3/.test(pixelTs);
  log(`${hardCut ? "PASS" : "FAIL"}  paintBlobTransition_hard_cut`);
  log(
    `${!/\bditherVGradient\s*\(/.test(genTs) ? "PASS" : "FAIL"}  gen_no_ditherVGradient`
  );
  log(`${/paintSlabSeams/.test(genTs) ? "PASS" : "FAIL"}  gen_has_slab_seams`);
  log(
    `${/foam|W\.pale/.test(genTs) && /coping|rim/.test(genTs) ? "PASS" : "FAIL"}  gen_water_rim_foam`
  );

  const ok = ditherOk && matOk && waterOk && foamN >= 4 && tMax <= 2 && hardCut;
  log(ok ? "\nALL DITHER/EDGE GATES PASSED" : "\nSOME DITHER/EDGE GATES FAILED");
  writeFileSync(join(SCRATCH, "dither-scan.log"), lines.join("\n") + "\n");
  writeFileSync(join(SCRATCH, "edge-water.log"), lines.join("\n") + "\n");
  writeFileSync(join(SCRATCH, "step1-dither-edge.log"), lines.join("\n") + "\n");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
