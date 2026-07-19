/**
 * DPR-aware integer display scaling + host centering.
 * Bound once from main.ts; scenes call refitDisplay() after camera zoom changes.
 *
 * Centering is owned by CSS flex on `#game` plus canvas styles that clear
 * Phaser Scale Manager absolute left/top after manual width/height updates.
 */
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  OVERWORLD_ZOOM,
  INTERIOR_ZOOM,
  applyIntegerDisplayScale,
  integerCssScaleForZooms,
  physicalPixelsPerTexel,
  canvasCssSize,
  canvasCenteringStyles,
  centeredCanvasOffset,
} from "@game/shared";

export type FitResult = {
  cssScale: number;
  physicalPerTexel: number;
  zoom: number;
  width: number;
  height: number;
  /** Expected offset inside host when flex-centered (for tests / diagnostics). */
  expectedLeft: number;
  expectedTop: number;
};

let fitImpl: ((zoom?: number) => FitResult | null) | null = null;
/** Last camera zoom used for CSS fit (updated by scenes). */
let activeZoom = OVERWORLD_ZOOM;

export function setActiveZoom(zoom: number): void {
  if (Number.isInteger(zoom) && zoom >= 1) activeZoom = zoom;
}

export function getActiveZoom(): number {
  return activeZoom;
}

/** Apply size + clear Phaser absolute positioning so flex host can center. */
function applyCenteredCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  containerW: number,
  containerH: number
): { expectedLeft: number; expectedTop: number } {
  const styles = canvasCenteringStyles(width, height);
  for (const [k, v] of Object.entries(styles)) {
    (canvas.style as unknown as Record<string, string>)[k] = v;
  }
  // Also clear attribute-style leftovers Phaser may set as element.style.cssText fragments
  canvas.style.removeProperty("transform");
  const off = centeredCanvasOffset(containerW, containerH, width, height);
  return { expectedLeft: off.left, expectedTop: off.top };
}

/**
 * Install the fit callback (called from main postBoot).
 */
export function installDisplayFit(game: {
  canvas: HTMLCanvasElement | null;
}): void {
  fitImpl = (zoomArg?: number) => {
    const canvas = game.canvas;
    if (!canvas) return null;
    const parent = (canvas.parentElement ?? document.getElementById("game")) as HTMLElement | null;
    const cw = parent?.clientWidth || window.innerWidth;
    const ch = parent?.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const zoom =
      zoomArg !== undefined && Number.isInteger(zoomArg) && zoomArg >= 1
        ? zoomArg
        : activeZoom;

    // Prefer a scale valid for both overworld + interior so either zoom is crisp.
    const dual = integerCssScaleForZooms(
      GAME_WIDTH,
      GAME_HEIGHT,
      cw,
      ch,
      dpr,
      [OVERWORLD_ZOOM, INTERIOR_ZOOM]
    );
    const pptDual = physicalPixelsPerTexel(zoom, dual, dpr);
    const dualOk = Math.abs(pptDual - Math.round(pptDual)) < 1e-6;

    if (dualOk) {
      const { width, height } = canvasCssSize(GAME_WIDTH, GAME_HEIGHT, dual);
      const { expectedLeft, expectedTop } = applyCenteredCanvasSize(canvas, width, height, cw, ch);
      return {
        cssScale: dual,
        physicalPerTexel: pptDual,
        zoom,
        width,
        height,
        expectedLeft,
        expectedTop,
      };
    }

    // Fallback: fit strictly for the active zoom
    const r = applyIntegerDisplayScale(canvas, GAME_WIDTH, GAME_HEIGHT, cw, ch, dpr, zoom);
    const off = centeredCanvasOffset(cw, ch, r.width, r.height);
    return {
      cssScale: r.cssScale,
      physicalPerTexel: r.physicalPerTexel,
      zoom,
      width: r.width,
      height: r.height,
      expectedLeft: off.left,
      expectedTop: off.top,
    };
  };
}

/** Recompute canvas CSS scale for the current (or given) integer camera zoom. */
export function refitDisplay(zoom?: number): FitResult | null {
  if (zoom !== undefined) setActiveZoom(zoom);
  return fitImpl?.(zoom) ?? null;
}

/** Pure helper re-export for tests that import from the client fit module path. */
export { centeredCanvasOffset, canvasCssSize, canvasCenteringStyles };
