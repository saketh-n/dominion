import { DIR_DX, DIR_DY, Dir } from "@game/shared";
import { isBlocked } from "../world/mapData.js";

export interface MoveResult {
  ok: boolean;
  x: number;
  y: number;
  dir: Dir;
}

/**
 * Server-authoritative one-tile step. Returns new position or unchanged on block.
 */
export function tryStep(x: number, y: number, dir: Dir): MoveResult {
  if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) {
    return { ok: false, x, y, dir: (dir as Dir) || 0 };
  }
  const nx = x + DIR_DX[dir];
  const ny = y + DIR_DY[dir];
  if (isBlocked(nx, ny)) {
    return { ok: false, x, y, dir };
  }
  return { ok: true, x: nx, y: ny, dir };
}
