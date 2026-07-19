/** World file format produced by tools/gen-map.ts and consumed by client + server. */

export interface HouseDef {
  id: number;
  /** Door tile (walkable; standing here + confirming enters the house). */
  doorX: number;
  doorY: number;
  /** Outdoor spawn tile (just below the door). */
  spawnX: number;
  spawnY: number;
}

export interface WorldFile {
  seed: number;
  width: number;
  height: number;
  houses: HouseDef[];
  /** base64-encoded little-endian Uint16 tile indices, row-major. */
  layers: {
    ground: string;
    deco: string;
    overhead: string;
  };
  /** base64-encoded Uint8: 1 = blocked. */
  collision: string;
  /** base64-encoded Uint8: 1 = wild encounter tile. */
  encounter: string;
}

/** Decoded, ready-to-use world data. */
export interface WorldData {
  seed: number;
  width: number;
  height: number;
  houses: HouseDef[];
  ground: Uint16Array;
  deco: Uint16Array;
  overhead: Uint16Array;
  collision: Uint8Array;
  encounter: Uint8Array;
}

// Environment-neutral handles (Buffer in node, atob/btoa in browsers).
const g = globalThis as any;

/** Cross-platform (browser + node) base64 -> bytes. */
export function b64ToBytes(b64: string): Uint8Array {
  if (typeof g.Buffer !== "undefined") {
    return new Uint8Array(g.Buffer.from(b64, "base64"));
  }
  const bin = g.atob(b64) as string;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  if (typeof g.Buffer !== "undefined") {
    return g.Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return g.btoa(bin) as string;
}

export function decodeU16(b64: string): Uint16Array {
  const bytes = b64ToBytes(b64);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

export function encodeU16(arr: Uint16Array): string {
  return bytesToB64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
}

export function decodeWorld(file: WorldFile): WorldData {
  return {
    seed: file.seed,
    width: file.width,
    height: file.height,
    houses: file.houses,
    ground: decodeU16(file.layers.ground),
    deco: decodeU16(file.layers.deco),
    overhead: decodeU16(file.layers.overhead),
    collision: b64ToBytes(file.collision),
    encounter: b64ToBytes(file.encounter),
  };
}

export function idx(x: number, y: number, width: number): number {
  return y * width + x;
}
