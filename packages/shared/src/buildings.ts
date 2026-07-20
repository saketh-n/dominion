/**
 * Enterable buildings (Pokemon-style interiors).
 * Houses come from world.houses; public buildings are fixed capital landmarks.
 *
 * Door rules (Pokémon DP / overworld convention):
 * - The walkable entrance is the door tile on the building facade (H_DOOR).
 * - Auto-enter warps ONLY when a step lands exactly on that tile
 *   (x === doorX && y === doorY). Neighbors — including the tile directly
 *   in front of the building — never warp.
 * - nearDoor (Manhattan ≤ 1) is ONLY for the "Press E to enter" prompt.
 * - E confirm works only while standing ON the door tile (same as walking in).
 */

import type { Dir } from "./protocol.js";

export type InteriorKind = "house" | "temple" | "shrine";

export interface PublicBuilding {
  id: string;
  kind: InteriorKind;
  name: string;
  /**
   * Walk-on door tile — must match the facade H_DOOR cell in gen-map
   * (not the approach tile south of the building).
   */
  doorX: number;
  doorY: number;
  /** Exit outdoor tile (one step south of door — outside, not the door). */
  exitX: number;
  exitY: number;
}

/**
 * Capital public interiors. Coords = gen-map H_DOOR cells after roof mass:
 * - temple: stampTemple(511, PY0+3=481) roof 4 + facade → door at topY+8 = 489
 * - west/east shrine: stampShrine(cx, PY0+10=488) roof 3 → door at topY+7 = 495
 * - south exedra: stampShrine(511, PY1-12=533) → door at topY+7 = 540
 */
export const PUBLIC_BUILDINGS: readonly PublicBuilding[] = [
  {
    id: "grand-temple",
    kind: "temple",
    name: "Grand Temple",
    doorX: 511,
    doorY: 489, // facade H_DOOR under 4-row roof mass
    exitX: 511,
    exitY: 490, // first step south of door
  },
  {
    id: "south-exedra",
    kind: "shrine",
    name: "South Exedra",
    doorX: 511,
    doorY: 540,
    exitX: 511,
    exitY: 541,
  },
  {
    id: "west-shrine",
    kind: "shrine",
    name: "West Shrine",
    doorX: 486,
    doorY: 495,
    exitX: 486,
    exitY: 496,
  },
  {
    id: "east-shrine",
    kind: "shrine",
    name: "East Shrine",
    doorX: 537,
    doorY: 495,
    exitX: 537,
    exitY: 496,
  },
];

export interface EnterTarget {
  kind: InteriorKind;
  name: string;
  /** house id when kind=house, else -1 */
  houseId: number;
  buildingId: string;
  doorX: number;
  doorY: number;
  exitX: number;
  exitY: number;
}

/** True if (x,y) is exactly the door threshold tile (auto-enter / warp). */
export function onDoorTile(px: number, py: number, doorX: number, doorY: number): boolean {
  return px === doorX && py === doorY;
}

/**
 * Prompt adjacency only — Manhattan distance ≤ 1.
 * NEVER used to warp; only to show "Press E to enter".
 */
export function nearDoor(px: number, py: number, doorX: number, doorY: number): boolean {
  const dx = Math.abs(px - doorX);
  const dy = Math.abs(py - doorY);
  return dx + dy <= 1;
}

/**
 * E-key confirm: only while standing ON the door tile (same cell auto-enter uses).
 * Facing the door from the south without stepping on it does NOT enter — walk onto
 * the door tile first (Pokémon walk-in), then E is a no-op/redundant confirm.
 * `dir` is accepted for call-site compatibility but does not expand the hitbox.
 */
export function canConfirmEnter(
  px: number,
  py: number,
  _dir: Dir,
  doorX: number,
  doorY: number
): boolean {
  return onDoorTile(px, py, doorX, doorY);
}

export interface HouseDoor {
  id: number;
  doorX: number;
  doorY: number;
  spawnX: number;
  spawnY: number;
}

function toTargetFromHouse(h: HouseDoor, name: string): EnterTarget {
  return {
    kind: "house",
    name,
    houseId: h.id,
    buildingId: `house-${h.id}`,
    doorX: h.doorX,
    doorY: h.doorY,
    exitX: h.spawnX,
    exitY: h.spawnY,
  };
}

function toTargetFromPublic(b: PublicBuilding): EnterTarget {
  return {
    kind: b.kind,
    name: b.name,
    houseId: -1,
    buildingId: b.id,
    doorX: b.doorX,
    doorY: b.doorY,
    exitX: b.exitX,
    exitY: b.exitY,
  };
}

type DoorMatch = (px: number, py: number, doorX: number, doorY: number) => boolean;

/**
 * Resolve an enterable building using a door predicate.
 * Prefers own house, then public buildings, then visitor houses.
 */
function resolveWith(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number,
  allowVisitorHouses: boolean,
  match: DoorMatch
): EnterTarget | null {
  if (ownHouseId >= 0) {
    const own = houses.find((h) => h.id === ownHouseId);
    if (own && match(x, y, own.doorX, own.doorY)) {
      return toTargetFromHouse(own, "Your House");
    }
  }
  for (const b of PUBLIC_BUILDINGS) {
    if (match(x, y, b.doorX, b.doorY)) {
      return toTargetFromPublic(b);
    }
  }
  if (allowVisitorHouses) {
    for (const h of houses) {
      if (h.id === ownHouseId) continue;
      if (match(x, y, h.doorX, h.doorY)) {
        return toTargetFromHouse(h, `House #${h.id}`);
      }
    }
  }
  return null;
}

/**
 * Warp / auto-enter resolve — ONLY exact door tile.
 * Stepping onto any of the door's 4 orthogonal neighbors does NOT enter.
 */
export function resolveEnterTarget(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number,
  allowVisitorHouses = true
): EnterTarget | null {
  return resolveWith(x, y, houses, ownHouseId, allowVisitorHouses, onDoorTile);
}

/**
 * Prompt resolve — nearDoor adjacency (≤1). Never used to warp.
 */
export function resolveNearEnterTarget(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number,
  allowVisitorHouses = true
): EnterTarget | null {
  return resolveWith(x, y, houses, ownHouseId, allowVisitorHouses, nearDoor);
}

/**
 * E-key resolve — exact door tile only (same predicate as auto-enter warp).
 */
export function resolveConfirmEnterTarget(
  x: number,
  y: number,
  dir: Dir,
  houses: readonly HouseDoor[],
  ownHouseId: number,
  allowVisitorHouses = true
): EnterTarget | null {
  return resolveWith(x, y, houses, ownHouseId, allowVisitorHouses, (px, py, dx, dy) =>
    canConfirmEnter(px, py, dir, dx, dy)
  );
}

/** Prompt label when standing near a door. */
export function enterPrompt(target: EnterTarget | null): string | null {
  if (!target) return null;
  return `[E] Enter ${target.name}`;
}
