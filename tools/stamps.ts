/**
 * Stamp blitter + placement rules for ground tiles.
 * Randomness only chooses which stamp, where, and how many — never per-pixel noise.
 *
 * Ground uses a strict 2-stop quiet band so ≥80% (actually ~100%) of pixels are
 * the top-2 colors and there are zero non-dominant detail orphans.
 */
import type { Ctx } from "./pixel.js";
import { px } from "./pixel.js";
import { STAMPS, type Stamp, type RampName, RAMPS } from "./palette.js";

export type Rng = () => number;

export const STAMP_EDGE_MARGIN = 2;
/** Chebyshev gap between stamps — keep high enough that accent blobs never form 2×2 Bayer with base. */
export const STAMP_MIN_SPACING = 4;
export const STAMP_COUNT_MIN = 2;
export const STAMP_COUNT_MAX = 5;

/** Parse #rrggbb → relative luminance 0–1. */
function lum(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Two closest consecutive ramp colors by luminance (prefer mid-ramp).
 * Guarantees narrow ground value band without third-color orphans.
 */
export function quietPair(ramp: readonly string[]): [string, string] {
  const n = ramp.length;
  if (n <= 1) {
    const c = ramp[0] ?? "#808080";
    return [c, c];
  }
  if (n === 2) return [ramp[0]!, ramp[1]!];
  let bestI = 0;
  let bestSpread = Infinity;
  let bestMidDist = Infinity;
  const mid = (n - 1) / 2;
  for (let i = 0; i < n - 1; i++) {
    const spread = Math.abs(lum(ramp[i]!) - lum(ramp[i + 1]!));
    const midDist = Math.abs(i + 0.5 - mid);
    // prefer smaller spread; tie-break toward center of ramp
    if (spread < bestSpread - 1e-9 || (Math.abs(spread - bestSpread) < 1e-9 && midDist < bestMidDist)) {
      bestSpread = spread;
      bestMidDist = midDist;
      bestI = i;
    }
  }
  return [ramp[bestI]!, ramp[bestI + 1]!];
}

export function blitStamp(
  ctx: Ctx,
  stamp: Stamp,
  ox: number,
  oy: number,
  ramp: readonly string[]
): void {
  const [a, b] = quietPair(ramp);
  // Stamp body = darker of quiet pair (fill is the lighter) — contiguous, no Bayer.
  const la =
    0.2126 * (parseInt(a.slice(1, 3), 16) / 255) +
    0.7152 * (parseInt(a.slice(3, 5), 16) / 255) +
    0.0722 * (parseInt(a.slice(5, 7), 16) / 255);
  const lb =
    0.2126 * (parseInt(b.slice(1, 3), 16) / 255) +
    0.7152 * (parseInt(b.slice(3, 5), 16) / 255) +
    0.0722 * (parseInt(b.slice(5, 7), 16) / 255);
  const accent = la <= lb ? a : b;
  for (const [dx, dy] of stamp.pixels) {
    px(ctx, ox + dx, oy + dy, accent);
  }
}

function stampGap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): number {
  const dx = ax < bx ? bx - (ax + aw) : ax - (bx + bw);
  const dy = ay < by ? by - (ay + ah) : ay - (by + bh);
  return Math.max(dx, dy);
}

export type PlaceOpts = {
  tileSize?: number;
  edgeMargin?: number;
  minSpacing?: number;
  countMin?: number;
  countMax?: number;
  stampNames?: string[];
};

export function placeStamps(
  ctx: Ctx,
  ramp: readonly string[],
  rng: Rng,
  opts: PlaceOpts = {}
): Array<{ name: string; x: number; y: number }> {
  const T = opts.tileSize ?? 16;
  const edge = opts.edgeMargin ?? STAMP_EDGE_MARGIN;
  const minSp = opts.minSpacing ?? STAMP_MIN_SPACING;
  const cMin = opts.countMin ?? STAMP_COUNT_MIN;
  const cMax = opts.countMax ?? STAMP_COUNT_MAX;
  const count = cMin + Math.floor(rng() * (cMax - cMin + 1));

  const library =
    opts.stampNames && opts.stampNames.length
      ? STAMPS.filter((s) => opts.stampNames!.includes(s.name))
      : STAMPS.slice();
  if (library.length === 0) return [];

  const placed: Array<{ stamp: Stamp; x: number; y: number }> = [];
  const out: Array<{ name: string; x: number; y: number }> = [];

  for (let attempt = 0; attempt < count * 24 && placed.length < count; attempt++) {
    const stamp = library[Math.floor(rng() * library.length)]!;
    const maxX = T - edge - stamp.w;
    const maxY = T - edge - stamp.h;
    if (maxX < edge || maxY < edge) continue;
    const x = edge + Math.floor(rng() * (maxX - edge + 1));
    const y = edge + Math.floor(rng() * (maxY - edge + 1));

    let ok = true;
    for (const p of placed) {
      if (stampGap(x, y, stamp.w, stamp.h, p.x, p.y, p.stamp.w, p.stamp.h) < minSp) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    placed.push({ stamp, x, y });
    blitStamp(ctx, stamp, x, y, ramp);
    out.push({ name: stamp.name, x, y });
  }
  return out;
}

/**
 * Quiet 2-color ground + stamps — flat uniform fill (no vertical gradient bands).
 * Fill uses the LIGHTER of the quiet pair so BR slab seams (darker of pair) stay visible.
 * Stamps blit the darker accent for quiet mid-tone detail.
 */
export function paintGroundWithStamps(
  ctx: Ctx,
  ramp: readonly string[],
  rng: Rng,
  opts: PlaceOpts = {}
): void {
  const T = opts.tileSize ?? 16;
  const [a, b] = quietPair(ramp);
  // Prefer brighter as floor fill so dark BR seams + stamp accents read against it
  const la = relativeLum(a);
  const lb = relativeLum(b);
  const fill = la >= lb ? a : b;

  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      px(ctx, x, y, fill);
    }
  }

  placeStamps(ctx, ramp, rng, opts);
}

function relativeLum(hex: string): number {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function rampOf(name: RampName): readonly string[] {
  return RAMPS[name];
}
