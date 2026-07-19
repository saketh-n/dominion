/**
 * Enterable buildings (Pokemon-style interiors).
 * Houses come from world.houses; public buildings are fixed capital landmarks.
 */

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

/** True if (x,y) is on the door tile or orthogonally adjacent (Pokemon-like confirm). */
export function nearDoor(px: number, py: number, doorX: number, doorY: number): boolean {
  const dx = Math.abs(px - doorX);
  const dy = Math.abs(py - doorY);
  return dx + dy <= 1;
}

export interface HouseDoor {
  id: number;
  doorX: number;
  doorY: number;
  spawnX: number;
  spawnY: number;
}

/**
 * Resolve an enterable building at the player's tile.
 * Prefers own house, then any house door (visitor), then public buildings.
 */
export function resolveEnterTarget(
  x: number,
  y: number,
  houses: readonly HouseDoor[],
  ownHouseId: number,
  allowVisitorHouses = true
): EnterTarget | null {
  // Own house first
  if (ownHouseId >= 0) {
    const own = houses.find((h) => h.id === ownHouseId);
    if (own && nearDoor(x, y, own.doorX, own.doorY)) {
      return {
        kind: "house",
        name: "Your House",
        houseId: own.id,
        buildingId: `house-${own.id}`,
        doorX: own.doorX,
        doorY: own.doorY,
        exitX: own.spawnX,
        exitY: own.spawnY,
      };
    }
  }
  // Public capital buildings
  for (const b of PUBLIC_BUILDINGS) {
    if (nearDoor(x, y, b.doorX, b.doorY)) {
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
  }
  // Other houses as visitor interiors
  if (allowVisitorHouses) {
    for (const h of houses) {
      if (h.id === ownHouseId) continue;
      if (nearDoor(x, y, h.doorX, h.doorY)) {
        return {
          kind: "house",
          name: `House #${h.id}`,
          houseId: h.id,
          buildingId: `house-${h.id}`,
          doorX: h.doorX,
          doorY: h.doorY,
          exitX: h.spawnX,
          exitY: h.spawnY,
        };
      }
    }
  }
  return null;
}

/** Prompt label when standing near a door. */
export function enterPrompt(target: EnterTarget | null): string | null {
  if (!target) return null;
  return `[E] Enter ${target.name}`;
}
