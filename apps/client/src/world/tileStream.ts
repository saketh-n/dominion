/**
 * Pure sliding-window origin math for continuous tile streaming.
 * The rendered window tracks the player every tile step (no large edge margin).
 * Incremental edge strips avoid full-window refill hitch on ordinary walking.
 */

export interface StreamOrigin {
  ox: number;
  oy: number;
}

/** Desired window origin so the player tile sits near the center of the view. */
export function desiredOrigin(
  centerTileX: number,
  centerTileY: number,
  viewW: number,
  viewH: number
): StreamOrigin {
  return {
    ox: Math.floor(centerTileX - viewW / 2),
    oy: Math.floor(centerTileY - viewH / 2),
  };
}

/**
 * After N one-tile steps east from a start tile, the streamed origin.ox must
 * advance by exactly N (continuous tracking — not stuck until a large margin).
 */
export function originAfterSteps(
  startTileX: number,
  startTileY: number,
  stepsEast: number,
  viewW: number,
  viewH: number
): StreamOrigin {
  const start = desiredOrigin(startTileX, startTileY, viewW, viewH);
  const end = desiredOrigin(startTileX + stepsEast, startTileY, viewW, viewH);
  return { ox: end.ox - start.ox, oy: end.oy - start.oy };
}

/** True when the window should re-stream (any origin change). */
export function needsStream(prev: StreamOrigin | null, next: StreamOrigin): boolean {
  if (!prev) return true;
  return prev.ox !== next.ox || prev.oy !== next.oy;
}

/**
 * How many layer cells must be rewritten for an origin shift of (dx, dy).
 * Ordinary 1-tile walks only touch one edge strip (viewH or viewW cells),
 * never the full VIEW_W*VIEW_H window — that is the hitch we eliminate.
 */
export function edgeCellsToWrite(
  dx: number,
  dy: number,
  viewW: number,
  viewH: number
): { mode: "full" | "edge" | "none"; cells: number } {
  if (dx === 0 && dy === 0) return { mode: "none", cells: 0 };
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  // Large teleports (warp) fall back to full rebuild
  if (adx > 2 || ady > 2) {
    return { mode: "full", cells: viewW * viewH };
  }
  // Edge strips (corners counted once via inclusion)
  let cells = 0;
  if (adx > 0) cells += adx * viewH;
  if (ady > 0) cells += ady * (viewW - adx); // avoid double-count corner strip
  return { mode: "edge", cells };
}

/**
 * World-tile coordinates of cells that must be filled after shifting origin by (dx,dy).
 * Used by WindowedTilemap and unit tests — single source of truth for edge streaming.
 */
export function edgeFillJobs(
  newOx: number,
  newOy: number,
  dx: number,
  dy: number,
  viewW: number,
  viewH: number
): Array<{ tx: number; ty: number; wx: number; wy: number }> {
  const jobs: Array<{ tx: number; ty: number; wx: number; wy: number }> = [];
  if (dx > 0) {
    for (let s = 0; s < dx; s++) {
      const tx = viewW - dx + s;
      for (let ty = 0; ty < viewH; ty++) {
        jobs.push({ tx, ty, wx: newOx + tx, wy: newOy + ty });
      }
    }
  } else if (dx < 0) {
    for (let s = 0; s < -dx; s++) {
      const tx = s;
      for (let ty = 0; ty < viewH; ty++) {
        jobs.push({ tx, ty, wx: newOx + tx, wy: newOy + ty });
      }
    }
  }
  if (dy > 0) {
    for (let s = 0; s < dy; s++) {
      const ty = viewH - dy + s;
      const tx0 = dx < 0 ? -dx : 0;
      const tx1 = dx > 0 ? viewW - dx : viewW;
      for (let tx = tx0; tx < tx1; tx++) {
        jobs.push({ tx, ty, wx: newOx + tx, wy: newOy + ty });
      }
    }
  } else if (dy < 0) {
    for (let s = 0; s < -dy; s++) {
      const ty = s;
      const tx0 = dx < 0 ? -dx : 0;
      const tx1 = dx > 0 ? viewW - dx : viewW;
      for (let tx = tx0; tx < tx1; tx++) {
        jobs.push({ tx, ty, wx: newOx + tx, wy: newOy + ty });
      }
    }
  }
  return jobs;
}
