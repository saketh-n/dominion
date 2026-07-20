/**
 * Server enter/exit building logic — pure helpers over world houses + public buildings.
 */
import {
  resolveEnterTarget,
  resolveConfirmEnterTarget,
  type EnterTarget,
  type HouseDoor,
  type InteriorKind,
  type Dir,
  PLAZA_SPAWN_X,
  PLAZA_SPAWN_Y,
  INTERIOR_SPAWN_TILE,
  INTERIOR_EXIT_TILE,
  isInteriorExitTile,
} from "@game/shared";

export interface InteriorSession {
  kind: InteriorKind;
  name: string;
  buildingId: string;
  /** Outdoor tile to restore on exit */
  exitX: number;
  exitY: number;
}

/** Auto-enter / step-on-door: exact door tile only. */
export function tryEnterBuilding(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number
): EnterTarget | null {
  return resolveEnterTarget(x, y, houses, ownHouseId, true);
}

/**
 * E-key confirm: on door tile, or directly south of door facing north.
 * Does NOT warp from east/west/north neighbors.
 */
export function tryConfirmEnterBuilding(
  x: number,
  y: number,
  dir: Dir,
  houses: readonly HouseDoor[],
  ownHouseId: number
): EnterTarget | null {
  return resolveConfirmEnterTarget(x, y, dir, houses, ownHouseId, true);
}

export function interiorFromTarget(t: EnterTarget): InteriorSession {
  return {
    kind: t.kind,
    name: t.name,
    buildingId: t.buildingId,
    exitX: t.exitX,
    exitY: t.exitY,
  };
}

/**
 * Fixed interior spawn — just north of the south-edge exit mat.
 * Room templates are ~12×9; mat sits at south edge, spawn one tile north of it.
 */
export const INTERIOR_SPAWN = INTERIOR_SPAWN_TILE;

/** South-edge door-mat tile — stepping onto it exits (exact-tile rule). */
export const INTERIOR_EXIT_MAT = INTERIOR_EXIT_TILE;

export function isInteriorExitMat(x: number, y: number): boolean {
  return isInteriorExitTile(x, y);
}

export function homeOutdoor(
  houses: readonly HouseDoor[],
  ownHouseId: number
): { x: number; y: number } {
  if (ownHouseId >= 0) {
    const h = houses.find((hh) => hh.id === ownHouseId);
    if (h) return { x: h.spawnX, y: h.spawnY };
  }
  return { x: PLAZA_SPAWN_X, y: PLAZA_SPAWN_Y };
}
