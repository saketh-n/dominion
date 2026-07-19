import Phaser from "phaser";
import { TILE_SIZE } from "@game/shared";
import { WorldModel } from "./WorldModel";
import {
  desiredOrigin,
  needsStream,
  edgeCellsToWrite,
  edgeFillJobs,
  type StreamOrigin,
} from "./tileStream";

/**
 * Sliding-window tilemap for the huge world.
 *
 * Origin tracks the player **every tile step** (no large edge MARGIN). Ordinary
 * walks use **incremental edge streaming**: existing tile indices scroll and only
 * the newly exposed row/column is filled — no full VIEW_W×VIEW_H hitch.
 * Teleports (warp) still full-rebuild.
 */
export const VIEW_W = 48;
export const VIEW_H = 36;

export class WindowedTilemap {
  private map: Phaser.Tilemaps.Tilemap;
  private ground!: Phaser.Tilemaps.TilemapLayer;
  private deco!: Phaser.Tilemaps.TilemapLayer;
  private overhead!: Phaser.Tilemaps.TilemapLayer;
  private ox = Number.MIN_SAFE_INTEGER;
  private oy = Number.MIN_SAFE_INTEGER;
  /** How many times the stream window has been updated. */
  streamCount = 0;
  /** Cells written on the last stream (edge strip or full). */
  lastCellsWritten = 0;
  /** Last stream mode for diagnostics / tests. */
  lastStreamMode: "full" | "edge" | "none" = "none";

  constructor(scene: Phaser.Scene, private world: WorldModel) {
    this.map = scene.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: VIEW_W,
      height: VIEW_H,
    });
    const tiles = this.map.addTilesetImage("tiles", "tileset", TILE_SIZE, TILE_SIZE, 0, 0)!;
    this.ground = this.map.createBlankLayer("ground", tiles, 0, 0)!;
    this.deco = this.map.createBlankLayer("deco", tiles, 0, 0)!;
    this.overhead = this.map.createBlankLayer("overhead", tiles, 0, 0)!;
    this.ground.setDepth(0);
    this.deco.setDepth(1);
    this.overhead.setDepth(1_000_000);
  }

  get origin(): StreamOrigin {
    return { ox: this.ox, oy: this.oy };
  }

  /** Hide/show all layers (used while a screen-space interior covers the view). */
  setVisible(v: boolean): void {
    this.ground.setVisible(v);
    this.deco.setVisible(v);
    this.overhead.setVisible(v);
  }

  /** Call every frame with the follow target's tile coordinates. */
  update(centerTileX: number, centerTileY: number): void {
    const next = desiredOrigin(centerTileX, centerTileY, VIEW_W, VIEW_H);
    const prev: StreamOrigin | null =
      this.ox === Number.MIN_SAFE_INTEGER ? null : { ox: this.ox, oy: this.oy };
    if (!needsStream(prev, next)) {
      // Keep lastStreamMode / lastCellsWritten as the previous actual stream
      // so diagnostics can observe edge vs full after walking settles.
      return;
    }

    if (!prev) {
      this.fullRebuild(next.ox, next.oy);
    } else {
      const dx = next.ox - prev.ox;
      const dy = next.oy - prev.oy;
      const plan = edgeCellsToWrite(dx, dy, VIEW_W, VIEW_H);
      if (plan.mode === "full") {
        this.fullRebuild(next.ox, next.oy);
      } else {
        this.incrementalShift(dx, dy);
      }
    }
    this.streamCount++;
  }

  private setLayerPos(ox: number, oy: number): void {
    this.ox = ox;
    this.oy = oy;
    const px = ox * TILE_SIZE;
    const py = oy * TILE_SIZE;
    for (const layer of [this.ground, this.deco, this.overhead]) {
      layer.setPosition(px, py);
    }
  }

  private putCell(tx: number, ty: number, wx: number, wy: number): void {
    const w = this.world;
    if (!w.inBounds(wx, wy)) {
      this.ground.putTileAt(0, tx, ty, false);
      this.deco.putTileAt(-1, tx, ty, false);
      this.overhead.putTileAt(-1, tx, ty, false);
      return;
    }
    this.ground.putTileAt(w.ground(wx, wy), tx, ty, false);
    const d = w.deco(wx, wy);
    this.deco.putTileAt(d === 0 ? -1 : d, tx, ty, false);
    const o = w.overhead(wx, wy);
    this.overhead.putTileAt(o === 0 ? -1 : o, tx, ty, false);
  }

  private fullRebuild(ox: number, oy: number): void {
    this.setLayerPos(ox, oy);
    let n = 0;
    for (let ty = 0; ty < VIEW_H; ty++) {
      for (let tx = 0; tx < VIEW_W; tx++) {
        this.putCell(tx, ty, ox + tx, oy + ty);
        n++;
      }
    }
    this.lastCellsWritten = n;
    this.lastStreamMode = "full";
  }

  /**
   * Scroll tile data opposite to origin movement, then fill only the new edge strip(s).
   */
  private incrementalShift(dx: number, dy: number): void {
    const newOx = this.ox + dx;
    const newOy = this.oy + dy;
    this.setLayerPos(newOx, newOy);

    this.scrollLayerData(this.ground, dx, dy);
    this.scrollLayerData(this.deco, dx, dy);
    this.scrollLayerData(this.overhead, dx, dy);

    const jobs = edgeFillJobs(newOx, newOy, dx, dy, VIEW_W, VIEW_H);
    for (const j of jobs) {
      this.putCell(j.tx, j.ty, j.wx, j.wy);
    }
    this.lastCellsWritten = jobs.length;
    this.lastStreamMode = "edge";
  }

  /** Shift tile indices inside the layer by (-dx, -dy) so interior cells stay correct. */
  private scrollLayerData(layer: Phaser.Tilemaps.TilemapLayer, dx: number, dy: number): void {
    const buf = new Int16Array(VIEW_W * VIEW_H);
    for (let ty = 0; ty < VIEW_H; ty++) {
      for (let tx = 0; tx < VIEW_W; tx++) {
        const t = layer.getTileAt(tx, ty, true);
        buf[ty * VIEW_W + tx] = t && t.index >= 0 ? t.index : -1;
      }
    }
    layer.fill(-1, 0, 0, VIEW_W, VIEW_H, false);
    for (let ty = 0; ty < VIEW_H; ty++) {
      for (let tx = 0; tx < VIEW_W; tx++) {
        const sx = tx + dx;
        const sy = ty + dy;
        if (sx < 0 || sy < 0 || sx >= VIEW_W || sy >= VIEW_H) continue;
        const idx = buf[sy * VIEW_W + sx];
        if (idx >= 0) layer.putTileAt(idx, tx, ty, false);
      }
    }
  }
}
