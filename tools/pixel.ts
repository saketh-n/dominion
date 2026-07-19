/** Tiny pixel-art toolkit for the asset generators. */
import { createCanvas, Canvas, SKRSContext2D } from "@napi-rs/canvas";

export type Ctx = SKRSContext2D;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function px(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

export function hline(ctx: Ctx, x: number, y: number, w: number, color: string): void {
  rect(ctx, x, y, w, 1, color);
}

export function vline(ctx: Ctx, x: number, y: number, h: number, color: string): void {
  rect(ctx, x, y, 1, h, color);
}

/** Parse #rrggbb or #rrggbbaa. */
function hex(c: string): [number, number, number, number] {
  if (c.startsWith("rgba")) {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) {
      return [
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        m[4] !== undefined ? Math.round(Number(m[4]) * 255) : 255,
      ];
    }
  }
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  const a = c.length >= 9 ? parseInt(c.slice(7, 9), 16) : 255;
  return [r, g, b, a];
}

function toHex(r: number, g: number, b: number, a = 255): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  if (a >= 255) return `#${c(r)}${c(g)}${c(b)}`;
  return `#${c(r)}${c(g)}${c(b)}${c(a)}`;
}

/** Lighten (amt>0) or darken (amt<0), amt in [-1,1]. */
export function shade(color: string, amt: number): string {
  const [r, g, b, a] = hex(color);
  if (amt >= 0) return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt, a);
  return toHex(r * (1 + amt), g * (1 + amt), b * (1 + amt), a);
}

/** Mix two colors. t in [0,1]. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab, aa] = hex(a);
  const [br, bg, bb, ba] = hex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t, aa + (ba - aa) * t);
}

/**
 * Desaturate toward neutral gray while preserving luminance.
 * amount 0 = unchanged, 1 = full gray.
 */
export function desaturate(color: string, amount: number): string {
  const [r, g, b, a] = hex(color);
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  return toHex(r + (L - r) * amount, g + (L - g) * amount, b + (L - b) * amount, a);
}

/**
 * Group a color into a limited value band (quantize luminance) for palette harmony.
 * steps = number of value buckets (e.g. 6).
 */
export function groupValue(color: string, steps = 6): string {
  const [r, g, b, a] = hex(color);
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  const step = 255 / Math.max(1, steps - 1);
  const Lq = Math.round(L / step) * step;
  if (L < 1) return toHex(0, 0, 0, a);
  const scale = Lq / L;
  return toHex(r * scale, g * scale, b * scale, a);
}

/**
 * Unified style tokens — must stay inside the global ≤48 palette (tools/palette.ts).
 * No runtime mix/shade: shadows/outlines are fixed opaque palette entries.
 * Light source: top-left (−1, −1) → highlights NW, shadows SE.
 */
export const STYLE = {
  /** Outline color — selective dark rim, never pure black (palette ink). */
  outline: "#2a2438",
  outlineSoft: "#3a4050",
  /** Drop / contact shadows — opaque palette darks (no RGBA alpha variants). */
  shadow: "#2a2438",
  shadowSoft: "#3a4050",
  contactAO: "#2a2438",
  /** Directional light unit vector (from NW). */
  lightDX: -0.55,
  lightDY: -0.55,
} as const;

/** 4×4 Bayer matrix normalized to [0,1). */
export const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

/** Ordered dither threshold at pixel (x,y) in [0,1). */
export function ditherThreshold(x: number, y: number): number {
  return BAYER_4[y & 3][x & 3];
}

/**
 * Ordered dither between two colors based on coverage t in [0,1].
 * Returns the chosen color (hard pixel pick — no bilinear).
 */
export function ditherPick(x: number, y: number, t: number, lo: string, hi: string): string {
  const thr = ditherThreshold(x, y);
  return t > thr ? hi : lo;
}

/**
 * Multi-stop dithered gradient along Y (top→bottom).
 * colors: ordered stops; paints horizontal bands with dithered blend zones.
 */
export function ditherVGradient(
  ctx: Ctx,
  x0: number,
  y0: number,
  w: number,
  h: number,
  colors: string[]
): void {
  if (colors.length === 0) return;
  if (colors.length === 1) {
    rect(ctx, x0, y0, w, h, colors[0]);
    return;
  }
  for (let y = 0; y < h; y++) {
    const t = h <= 1 ? 0 : y / (h - 1);
    const seg = t * (colors.length - 1);
    const i = Math.min(colors.length - 2, Math.floor(seg));
    const local = seg - i;
    for (let x = 0; x < w; x++) {
      px(ctx, x0 + x, y0 + y, ditherPick(x0 + x, y0 + y, local, colors[i], colors[i + 1]));
    }
  }
}

/**
 * Elliptical contact / cast shadow under an object footprint.
 * Uses only opaque palette colors (no new alpha variants).
 */
export function dropShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string = STYLE.shadow
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / Math.max(0.5, rx);
      const dy = (y + 0.5 - cy) / Math.max(0.5, ry);
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const cover = (1 - d2) * (1 - d2);
      // Dither density for soft edge — still only palette ink / soft
      if (cover < 0.35) {
        if (ditherThreshold(x, y) > cover * 1.2) continue;
        px(ctx, x, y, STYLE.shadowSoft);
      } else {
        px(ctx, x, y, color);
      }
    }
  }
}

/**
 * Dark contact AO oval / line where object meets ground (tighter than drop shadow).
 */
export function contactShadow(
  ctx: Ctx,
  x0: number,
  y: number,
  w: number,
  color: string = STYLE.contactAO
): void {
  for (let x = x0; x < x0 + w; x++) {
    const edge = Math.min(x - x0, x0 + w - 1 - x);
    const t = edge / Math.max(1, w / 2);
    if (t + 0.25 < ditherThreshold(x, y)) continue;
    px(ctx, x, y, color);
    if (t > 0.4 && y > 0) px(ctx, x, y - 1, STYLE.shadowSoft);
  }
}

/**
 * Elliptical contact shadow (preferred for props) — opaque palette only.
 */
export function ellipseContactShadow(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number
): void {
  dropShadow(ctx, cx, cy, rx, ry, STYLE.contactAO);
}

/**
 * Selective outline: darken transparent-adjacent opaque pixels.
 * Operates on a finished buffer in `ctx` of size `w`×`h` (square if one arg).
 */
export function applySelectiveOutline(
  ctx: Ctx,
  w = 16,
  outlineColor: string = STYLE.outline,
  h?: number
): void {
  const width = w;
  const height = h ?? w;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const opaque = (i: number) => d[i + 3] >= 40;
  const out = new Uint8ClampedArray(d);
  const [or, og, ob] = hex(outlineColor);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!opaque(i)) continue;
      let edge = false;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          edge = true;
          break;
        }
        if (!opaque((ny * width + nx) * 4)) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
      const L = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (L < 35 && d[i + 3] < 180) continue;
      out[i] = or;
      out[i + 1] = og;
      out[i + 2] = ob;
      out[i + 3] = Math.max(d[i + 3], 220);
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

/**
 * Apply consistent top-left form shading: brighten NW pixels, darken SE.
 * strength ~0.08–0.18. Skips near-transparent pixels.
 */
export function applyDirectionalLight(ctx: Ctx, w = 16, strength = 0.12, h?: number): void {
  const width = w;
  const height = h ?? w;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (d[i + 3] < 16) continue;
      const u = width <= 1 ? 0 : x / (width - 1);
      const v = height <= 1 ? 0 : y / (height - 1);
      const lit = (1 - u) * 0.55 + (1 - v) * 0.45;
      const amt = (lit - 0.5) * 2 * strength;
      if (amt >= 0) {
        d[i] = Math.min(255, d[i] + (255 - d[i]) * amt);
        d[i + 1] = Math.min(255, d[i + 1] + (255 - d[i + 1]) * amt);
        d[i + 2] = Math.min(255, d[i + 2] + (255 - d[i + 2]) * amt);
      } else {
        const k = 1 + amt;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Mild desaturation pass so harsh pure colors sit in the unified palette.
 */
export function applyDesaturate(ctx: Ctx, w = 16, amount = 0.18, h?: number): void {
  const width = w;
  const height = h ?? w;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i] + (L - d[i]) * amount;
    d[i + 1] = d[i + 1] + (L - d[i + 1]) * amount;
    d[i + 2] = d[i + 2] + (L - d[i + 2]) * amount;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Draw an ASCII pixel template. Each character maps to a color via `palette`;
 * '.' and ' ' are transparent. Rows may be shorter than width.
 */
export function drawTemplate(
  ctx: Ctx,
  template: string[],
  palette: Record<string, string>,
  ox = 0,
  oy = 0
): void {
  for (let y = 0; y < template.length; y++) {
    const row = template[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " ") continue;
      const color = palette[ch];
      if (!color) throw new Error(`no palette entry for '${ch}' at ${x},${y}`);
      px(ctx, ox + x, oy + y, color);
    }
  }
}

/** Mirror an ASCII template horizontally. */
export function mirrorTemplate(template: string[]): string[] {
  const w = Math.max(...template.map((r) => r.length));
  return template.map((row) => row.padEnd(w, ".").split("").reverse().join(""));
}

export function makeCanvas(w: number, h: number): { canvas: Canvas; ctx: Ctx } {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Scale a canvas up with nearest-neighbor for previews. */
export function scaleCanvas(src: Canvas, factor: number): Canvas {
  const out = createCanvas(src.width * factor, src.height * factor);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * Paint blob transition: background fill + foreground coverage from mask,
 * with dithered edge feathering (no hard seam).
 */
export function paintBlobTransition(
  ctx: Ctx,
  mask: number,
  paintBg: (c: Ctx) => void,
  paintFg: (c: Ctx) => void,
  size = 16,
  coverageAt: (mask: number, x: number, y: number, size: number) => number
): void {
  const bg = makeCanvas(size, size);
  const fg = makeCanvas(size, size);
  paintBg(bg.ctx);
  paintFg(fg.ctx);
  const bgData = bg.ctx.getImageData(0, 0, size, size).data;
  const fgData = fg.ctx.getImageData(0, 0, size, size).data;
  const out = ctx.createImageData(size, size);
  const d = out.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cover = coverageAt(mask, x, y, size);
      // Wider dither band for soft feathered seams (DP-style edge blend)
      const edgeSoft = 0.32;
      const lo = 0.5 - edgeSoft;
      const hi = 0.5 + edgeSoft;
      let pickFg: boolean;
      if (cover >= hi) pickFg = true;
      else if (cover <= lo) pickFg = false;
      else {
        const t = (cover - lo) / (hi - lo);
        pickFg = t > ditherThreshold(x, y);
      }
      const src = pickFg ? fgData : bgData;
      // Pick existing palette pixels only — never synthesize new RGB.
      d[i] = src[i];
      d[i + 1] = src[i + 1];
      d[i + 2] = src[i + 2];
      d[i + 3] = src[i + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}
