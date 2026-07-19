/**
 * Server enter/exit building logic — pure helpers over world houses + public buildings.
 */
import {
  resolveEnterTarget,
  type EnterTarget,
  type HouseDoor,
  type InteriorKind,
  PLAZA_SPAWN_X,
  PLAZA_SPAWN_Y,
} from "@game/shared";

export interface InteriorSession {
  kind: InteriorKind;
  name: string;
  buildingId: string;
  /** Outdoor tile to restore on exit */
  exitX: number;
  exitY: number;
}

export function tryEnterBuilding(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number
): EnterTarget | null {
  return resolveEnterTarget(x, y, houses, ownHouseId, true);
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

/** Fixed interior spawn (client paints room; coords are logical only). */
export const INTERIOR_SPAWN = { x: 4, y: 6 } as const;

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
