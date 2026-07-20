import { WorldFile, WorldData, decodeWorld, idx, Tile } from "@game/shared";

/** Client-side world data: decoded layers + collision queries. */
export class WorldModel {
  readonly data: WorldData;

  constructor(file: WorldFile | WorldData) {
    // Accept either encoded WorldFile or already-decoded WorldData (interiors).
    if ("layers" in file && typeof (file as WorldFile).layers?.ground === "string") {
      this.data = decodeWorld(file as WorldFile);
    } else {
      this.data = file as WorldData;
    }
  }

  /** Build a model from raw decoded layers (interior templates). */
  static fromData(data: WorldData): WorldModel {
    return new WorldModel(data);
  }

  get width() {
    return this.data.width;
  }
  get height() {
    return this.data.height;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.data.collision[idx(x, y, this.width)] === 1;
  }

  ground(x: number, y: number): number {
    return this.data.ground[idx(x, y, this.width)];
  }
  deco(x: number, y: number): number {
    return this.data.deco[idx(x, y, this.width)];
  }
  overhead(x: number, y: number): number {
    return this.data.overhead[idx(x, y, this.width)];
  }

  isEncounter(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.data.encounter[idx(x, y, this.width)] > 0;
  }

  isDoor(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.deco(x, y) === Tile.H_DOOR;
  }
}
