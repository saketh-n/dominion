/** Core world constants shared by client, server, and generators. */

export const TILE_SIZE = 16;

/** World dimensions in tiles ("procedural, very large"). */
export const MAP_W = 1024;
export const MAP_H = 1024;

/** Server simulation tick rate (Hz). */
export const TICK_RATE = 12;

/** How fast players walk, in tiles per second. */
export const WALK_SPEED = 5;

/**
 * How fast players run (hold R + move), in tiles per second.
 * ~1.8× walk — Pokémon-style dash without needing a protocol bit.
 */
export const RUN_SPEED = 9;

/** Grid step duration while walking (ms). */
export const WALK_STEP_MS = 1000 / WALK_SPEED;

/** Grid step duration while running (ms). Faster than walk. */
export const RUN_STEP_MS = 1000 / RUN_SPEED;

/**
 * Duration of one grid step in ms.
 * R alone does not move — only shortens steps while a move key is held.
 */
export function stepDurationMs(running: boolean): number {
  return running ? RUN_STEP_MS : WALK_STEP_MS;
}

/**
 * Server anti-speedhack floor (ms between accepted steps).
 * Uses run cadence × 0.8 jitter slack so legitimate hold-R run is not rejected.
 */
export const MIN_MOVE_INTERVAL_MS = RUN_STEP_MS * 0.8;

/**
 * Top-left overworld command cheat sheet (fixed HUD).
 * Covers move, run (hold R), and inventory — kept in shared so tests assert the contract.
 */
export const CONTROLS_CHEATSHEET = [
  "WASD / Arrows  Move",
  "Hold R + move  Run",
  "I              Bag",
].join("\n");

/** Area-of-interest radius in tiles (proximity chat, nearby queries). */
export const AOI_RADIUS = 24;

/** Spatial hash cell size in tiles. */
export const AOI_CELL = 32;

export const NUM_HOUSES = 100;

/** Wild encounter chance per step on an encounter tile. */
export const ENCOUNTER_CHANCE = 0.08;

export const SERVER_PORT = 2567;
export const WORLD_ROOM = "world";

/** Number of player palette skins generated in the sprite atlas. */
export const NUM_SKINS = 8;

export const MAX_CHAT_LEN = 200;
export const CHAT_RATE_LIMIT_MS = 600;

/** Deterministic seed for world generation. */
export const WORLD_SEED = 20260718;

/**
 * First-look outdoor spawn: south of the grand fountain on the processional road.
 * New joins land here so the Greco-Roman capital (marble court + fountain) is
 * immediately on screen — house claim still assigns a home for lose-warp / enter.
 */
export const PLAZA_SPAWN_X = 513;
export const PLAZA_SPAWN_Y = 528;
