/**
 * Overworld render resolution helpers.
 * Camera zoom is always an integer; final CSS scale is snapped so each
 * texel maps to an integer number of physical (device) pixels.
 */

import { TILE_SIZE } from "./constants.js";

/** Logical game canvas size (CSS/layout pixels before DPR). */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;

/**
 * Overworld camera zoom. Integer only.
 * At 960×640 and TILE_SIZE 16 → visible area = 20 × ~13.33 tiles (≤ 20×14).
 */
export const OVERWORLD_ZOOM = 3;

/** Interior rooms use zoom 1 (fills the canvas with UI geometry). */
export const INTERIOR_ZOOM = 1;

/** Assert zoom is a positive integer. */
export function assertIntegerZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 1 || !Number.isInteger(zoom)) {
    throw new Error(`Camera zoom must be a positive integer, got ${zoom}`);
  }
  return zoom;
}

/**
 * Visible tile count at a given game size, tile size, and camera zoom.
 * Uses ceil so partially visible edge tiles count.
 */
export function visibleTileCount(
  gameWidth: number,
  gameHeight: number,
  tileSize: number = TILE_SIZE,
  zoom: number = OVERWORLD_ZOOM
): { w: number; h: number } {
  const z = assertIntegerZoom(zoom);
  return {
    w: Math.ceil(gameWidth / (tileSize * z)),
    h: Math.ceil(gameHeight / (tileSize * z)),
  };
}

/**
 * Physical (device) pixels per world texel.
 * texel → game pixels via camera zoom, then CSS scale, then devicePixelRatio.
 * Must be an integer for crisp pixel-art on retina displays.
 */
export function physicalPixelsPerTexel(
  zoom: number,
  cssScale: number,
  devicePixelRatio: number
): number {
  return assertIntegerZoom(zoom) * cssScale * devicePixelRatio;
}

function nearlyInteger(n: number, eps = 1e-6): boolean {
  return Math.abs(n - Math.round(n)) < eps;
}

/**
 * Max integer physical-px-per-texel achievable with scale ≤ maxFit.
 * 0 means no integer ppt ≥ 1 fits the container.
 */
export function maxIntegerPpt(
  maxFit: number,
  dpr: number,
  zoom: number
): number {
  const z = assertIntegerZoom(zoom);
  const safeDpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  if (!(maxFit > 0) || !Number.isFinite(maxFit)) return 0;
  return Math.max(0, Math.floor(z * maxFit * safeDpr + 1e-9));
}

/**
 * Largest CSS scale **≤ maxFit** that keeps physical pixels per texel an integer ≥ 1.
 *
 * ppt = zoom * cssScale * dpr must be a positive integer.
 * Equivalently cssScale = k / (zoom * dpr) for integer k ≥ 1, with cssScale ≤ maxFit.
 *
 * When maxFit is too small for k≥1 (maxIntegerPpt === 0), returns the largest
 * scale ≤ maxFit of the form k/(zoom*dpr) is impossible — returns maxFit itself
 * (ppt may then be < 1 / non-integer). Callers should avoid such tiny hosts;
 * normal phone/desktop sizes always have maxIntegerPpt ≥ 1 for zoom∈{1,3}.
 */
export function integerCssScale(
  gameW: number,
  gameH: number,
  containerW: number,
  containerH: number,
  dpr: number,
  zoom: number = OVERWORLD_ZOOM
): number {
  const z = assertIntegerZoom(zoom);
  const safeDpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const maxFit = Math.min(containerW / gameW, containerH / gameH);
  if (!(maxFit > 0) || !Number.isFinite(maxFit)) {
    return 1 / (z * safeDpr);
  }

  const maxK = maxIntegerPpt(maxFit, safeDpr, z);
  if (maxK >= 1) {
    // Prefer largest k so the game fills as much of the container as possible.
    for (let k = maxK; k >= 1; k--) {
      const scale = k / (z * safeDpr);
      if (scale <= maxFit + 1e-9 && scale > 0) return scale;
    }
  }

  // Degenerate: cannot fit ≥1 physical px/texel. Never exceed maxFit.
  return maxFit;
}

/**
 * CSS scale ≤ maxFit that keeps ppt integer for **every** zoom in `zooms`.
 * Prefers scale = j/dpr (integer CSS game-pixels × dpr → integer device px)
 * so ppt(z) = z*j is automatically integer for all integer z.
 */
export function integerCssScaleForZooms(
  gameW: number,
  gameH: number,
  containerW: number,
  containerH: number,
  dpr: number,
  zooms: readonly number[]
): number {
  const zs = zooms.map(assertIntegerZoom);
  const safeDpr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const maxFit = Math.min(containerW / gameW, containerH / gameH);
  if (!(maxFit > 0) || !Number.isFinite(maxFit)) {
    return 1 / safeDpr;
  }

  // scale = j / dpr ⇒ ppt(z) = z * j ∈ ℤ for all integer z.
  const maxJ = Math.floor(maxFit * safeDpr + 1e-9);
  if (maxJ >= 1) {
    for (let j = maxJ; j >= 1; j--) {
      const scale = j / safeDpr;
      if (scale <= maxFit + 1e-9) return scale;
    }
  }

  // scale = k / (L * dpr) with L = lcm(zooms)
  const L = zs.reduce((a, b) => lcm(a, b), 1);
  const maxK = Math.floor(L * maxFit * safeDpr + 1e-9);
  if (maxK >= 1) {
    for (let k = maxK; k >= 1; k--) {
      const scale = k / (L * safeDpr);
      if (scale > maxFit + 1e-9) continue;
      const ok = zs.every((z) => nearlyInteger(z * scale * safeDpr));
      if (ok) return scale;
    }
  }

  // Fall back to single-zoom fit for the primary zoom
  return integerCssScale(gameW, gameH, containerW, containerH, dpr, zs[0] ?? OVERWORLD_ZOOM);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a | 0);
  let y = Math.abs(b | 0);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/**
 * CSS pixel size of the game canvas after integer scale (rounded).
 */
export function canvasCssSize(
  gameW: number,
  gameH: number,
  cssScale: number
): { width: number; height: number } {
  return {
    width: Math.round(gameW * cssScale),
    height: Math.round(gameH * cssScale),
  };
}

/**
 * Top-left offset that centers a box of (canvasW×canvasH) inside a container.
 * Pure geometry used by layout tests and by the client fit path.
 */
export function centeredCanvasOffset(
  containerW: number,
  containerH: number,
  canvasW: number,
  canvasH: number
): { left: number; top: number } {
  return {
    left: Math.round((containerW - canvasW) / 2),
    top: Math.round((containerH - canvasH) / 2),
  };
}

/**
 * Styles that keep the canvas a normal flex item (or margin-auto block)
 * centered by the host — clears Phaser CENTER_BOTH absolute left/top/margin.
 */
export function canvasCenteringStyles(
  canvasW: number,
  canvasH: number
): Record<string, string> {
  return {
    width: `${canvasW}px`,
    height: `${canvasH}px`,
    imageRendering: "pixelated",
    // Kill Phaser Scale Manager absolute pinning after manual size changes
    position: "relative",
    left: "auto",
    top: "auto",
    margin: "0",
    display: "block",
    maxWidth: "none",
    maxHeight: "none",
  };
}

/**
 * Apply integer CSS scaling + centering-safe styles to a canvas element.
 */
export function applyIntegerDisplayScale(
  canvas: HTMLCanvasElement,
  gameW: number,
  gameH: number,
  containerW: number,
  containerH: number,
  dpr: number,
  zoom: number = OVERWORLD_ZOOM
): { cssScale: number; physicalPerTexel: number; width: number; height: number } {
  const cssScale = integerCssScale(gameW, gameH, containerW, containerH, dpr, zoom);
  const { width, height } = canvasCssSize(gameW, gameH, cssScale);
  const styles = canvasCenteringStyles(width, height);
  for (const [k, v] of Object.entries(styles)) {
    (canvas.style as unknown as Record<string, string>)[k] = v;
  }
  return {
    cssScale,
    physicalPerTexel: physicalPixelsPerTexel(zoom, cssScale, dpr),
    width,
    height,
  };
}
