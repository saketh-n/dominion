/**
 * Pure analysis helpers for DP graphics acceptance tests.
 * No canvas/Phaser dependency — operates on RGBA buffers / color lists.
 */

/** Count unique opaque (a≥8) RGBA colors in an image buffer. */
export function countUniqueColors(data: Uint8ClampedArray | Uint8Array, alphaMin = 8): number {
  const set = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < alphaMin) continue;
    set.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  }
  return set.size;
}

/** Frequency map of opaque colors → count. */
export function colorHistogram(
  data: Uint8ClampedArray | Uint8Array,
  alphaMin = 8
): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < alphaMin) continue;
    const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Fraction of opaque pixels that use one of the top-2 most common colors.
 */
export function top2ColorShare(data: Uint8ClampedArray | Uint8Array, alphaMin = 8): number {
  const hist = colorHistogram(data, alphaMin);
  let total = 0;
  const counts: number[] = [];
  for (const c of hist.values()) {
    total += c;
    counts.push(c);
  }
  if (total === 0) return 1;
  counts.sort((a, b) => b - a);
  const top = (counts[0] ?? 0) + (counts[1] ?? 0);
  return top / total;
}

/**
 * Connected components (4-connected) on a binary mask.
 * Returns sizes of each component.
 */
export function connectedComponentSizes(mask: boolean[], w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const sizes: number[] = [];
  const qx = new Int16Array(w * h);
  const qy = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = y * w + x;
      if (!mask[i0] || seen[i0]) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[i0] = 1;
      let size = 0;
      while (head < tail) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head++;
        size++;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      sizes.push(size);
    }
  }
  return sizes;
}

/**
 * Detail pixels = opaque pixels that are NOT one of the top-2 colors.
 * Orphan = connected component of size 1 among detail pixels.
 */
export function detailOrphanCount(data: Uint8ClampedArray | Uint8Array, w: number, h: number): number {
  const hist = colorHistogram(data);
  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const top2 = new Set(ranked.slice(0, 2).map(([k]) => k));
  const mask: boolean[] = new Array(w * h).fill(false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3]! < 8) continue;
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      if (!top2.has(k)) mask[y * w + x] = true;
    }
  }
  const sizes = connectedComponentSizes(mask, w, h);
  return sizes.filter((s) => s === 1).length;
}

/** Relative luminance 0–1 from sRGB channel bytes. */
export function luminanceRgb(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Min/max luminance among opaque pixels; spread = max - min. */
export function lightnessSpread(data: Uint8ClampedArray | Uint8Array, alphaMin = 8): {
  min: number;
  max: number;
  spread: number;
} {
  let min = 1;
  let max = 0;
  let any = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < alphaMin) continue;
    const L = luminanceRgb(data[i]!, data[i + 1]!, data[i + 2]!);
    any = true;
    if (L < min) min = L;
    if (L > max) max = L;
  }
  if (!any) return { min: 0, max: 0, spread: 0 };
  return { min, max, spread: max - min };
}

/** Count distinct opaque RGB triples. */
export function distinctRgbCount(data: Uint8ClampedArray | Uint8Array, alphaMin = 8): number {
  return colorHistogram(data, alphaMin).size;
}

/**
 * Weighted variant pick: ~85% base / 10% A / 5% B (for n≥3).
 * unit in [0,1).
 */
export function weightedVariantIndex(unit: number, variantCount: number): number {
  const n = Math.max(1, variantCount | 0);
  if (n === 1) return 0;
  const u = ((unit % 1) + 1) % 1;
  if (n === 2) {
    // 85% base, 15% A
    return u < 0.85 ? 0 : 1;
  }
  // 85 / 10 / 5 for first three; extra variants share the 5% tail thinly
  if (u < 0.85) return 0;
  if (u < 0.95) return 1;
  if (n === 3) return 2;
  // map remaining 5% across variants 2..n-1
  const t = (u - 0.95) / 0.05;
  return 2 + Math.min(n - 3, Math.floor(t * (n - 2)));
}

/**
 * True if two non-base variants are 4-adjacent anywhere in a grid of variant indices.
 */
export function hasAdjacentNonBaseVariants(variants: number[], w: number, h: number): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = variants[y * w + x]!;
      if (v === 0) continue;
      if (x + 1 < w) {
        const r = variants[y * w + x + 1]!;
        if (r !== 0) return true;
      }
      if (y + 1 < h) {
        const d = variants[(y + 1) * w + x]!;
        if (d !== 0) return true;
      }
    }
  }
  return false;
}

/**
 * Assign variants with weighted random + no two non-base 4-adjacent.
 */
export function assignVariantsNoAdjacent(
  w: number,
  h: number,
  variantCount: number,
  hash01: (x: number, y: number) => number
): number[] {
  const out = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = weightedVariantIndex(hash01(x, y), variantCount);
      if (v !== 0) {
        const left = x > 0 ? out[y * w + x - 1]! : 0;
        const up = y > 0 ? out[(y - 1) * w + x]! : 0;
        if (left !== 0 || up !== 0) v = 0;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * Y-sort depth key for entities with a foot/base at tileY (or pixel Y).
 * Higher base Y (south) draws on top.
 */
export function ySortDepth(baseY: number, layerBias = 10): number {
  return layerBias + baseY * 0.001;
}

/**
 * When player and tall prop overlap in screen space, prop should draw over
 * player's lower half iff prop.baseY > player.tileY (prop is south of player foot
 * ... actually: prop base is the foot of the prop. Player walking "behind" means
 * player is north of the prop base (player.tileY < prop.baseY) while still
 * overlapping the tall sprite. Then propDepth > playerDepth → prop on top.
 */
export function propOccludesPlayer(playerTileY: number, propBaseTileY: number): boolean {
  return ySortDepth(propBaseTileY) > ySortDepth(playerTileY);
}
