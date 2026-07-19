/** Core world constants shared by client, server, and generators. */

export const TILE_SIZE = 16;

/** World dimensions in tiles ("procedural, very large"). */
export const MAP_W = 1024;
export const MAP_H = 1024;

/** Server simulation tick rate (Hz). */
export const TICK_RATE = 12;

/** How fast players walk, in tiles per second. */
export const WALK_SPEED = 5;

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
