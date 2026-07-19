import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WorldFile, WorldData, decodeWorld, idx } from "@game/shared";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data");

let world: WorldData | null = null;

export function getWorld(): WorldData {
  if (!world) {
    const file = JSON.parse(readFileSync(join(DATA_DIR, "world.json"), "utf8")) as WorldFile;
    world = decodeWorld(file);
    console.log(`[world] loaded ${world.width}x${world.height}, ${world.houses.length} houses`);
  }
  return world;
}

export function isBlocked(x: number, y: number): boolean {
  const w = getWorld();
  if (x < 0 || y < 0 || x >= w.width || y >= w.height) return true;
  return w.collision[idx(x, y, w.width)] === 1;
}

/** 0 = none, 1 field, 2 forest, 3 coast, 4 mountain */
export function encounterAt(x: number, y: number): number {
  const w = getWorld();
  if (x < 0 || y < 0 || x >= w.width || y >= w.height) return 0;
  return w.encounter[idx(x, y, w.width)];
}
