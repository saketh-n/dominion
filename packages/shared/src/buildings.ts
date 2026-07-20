/**
 * Enterable buildings (Pokemon-style interiors).
 * Houses come from world.houses; public buildings are fixed capital landmarks.
 *
 * Door rules (Pokémon-correct):
 * - Auto-enter warps only when the step lands exactly on the door tile
 *   (x === doorX && y === doorY), typically walking north into a south-facing door.
 * - nearDoor (Manhattan ≤ 1) is ONLY for the "Press E to enter" prompt — never warps.
 * - E confirm works when standing on the door tile, or directly south of it facing north.
 */

import type { Dir } from "./protocol.js";

export type InteriorKind = "house" | "temple" | "shrine";

export interface PublicBuilding {
  id: string;
  kind: InteriorKind;
  name: string;
  /** Walk-on door / threshold tile (must be walkable overworld). */
  doorX: number;
  doorY: number;
  /** Exit outdoor tile (usually one step south of door). */
  exitX: number;
  exitY: number;
}

/**
 * Capital public interiors near plaza spawn so players can enter buildings
 * without hiking to a distant house first.
 * Coords match tools/gen-map.ts stamps (temple @ 511, PY0+3; south exedra @ 511, PY1-12).
 */
export const PUBLIC_BUILDINGS: readonly PublicBuilding[] = [
  {
    id: "grand-temple",
    kind: "temple",
    name: "Grand Temple",
    // Just south of the triple steps (steps end ~ y=488)
    doorX: 511,
    doorY: 489,
    exitX: 511,
    exitY: 490,
  },
  {
    id: "south-exedra",
    kind: "shrine",
    name: "South Exedra",
    doorX: 511,
    doorY: 538, // PY1-12+5 steps front ≈ 545-12+4 = 537 steps; door south
    exitX: 511,
    exitY: 539,
  },
  {
    id: "west-shrine",
    kind: "shrine",
    name: "West Shrine",
    doorX: 486,
    doorY: 492, // PY0+10+4
    exitX: 486,
    exitY: 493,
  },
  {
    id: "east-shrine",
    kind: "shrine",
    name: "East Shrine",
    doorX: 537,
    doorY: 492,
    exitX: 537,
    exitY: 493,
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
 * E-key confirm: standing on the door tile, or directly south of it facing north (dir=1).
 * South-facing doors are the capital convention (approach from below).
 */
export function canConfirmEnter(
  px: number,
  py: number,
  dir: Dir,
  doorX: number,
  doorY: number
): boolean {
  if (onDoorTile(px, py, doorX, doorY)) return true;
  // Directly south of door, facing north into it
  return px === doorX && py === doorY + 1 && dir === 1;
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
 * E-key resolve — on door tile, or one tile south facing north into the door.
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
