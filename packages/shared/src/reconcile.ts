/**
 * Authoritative world-position snap used after battles / schema drift.
 * Shared so server tests and the client WorldScene drive the same helper.
 */
export interface LocalPos {
  tileX: number;
  tileY: number;
  place: "world" | "interior";
}

export interface ServerPos {
  x: number;
  y: number;
  place: string;
}

/**
 * If both sides are in the overworld and coords differ, return the server tile.
 * Returns null when no snap is needed (or when in an interior).
 */
export function reconcileWorldPosition(local: LocalPos, server: ServerPos): LocalPos | null {
  if (local.place !== "world") return null;
  if (server.place !== "world") return null;
  if (server.x === local.tileX && server.y === local.tileY) return null;
  return { tileX: server.x, tileY: server.y, place: "world" };
}
