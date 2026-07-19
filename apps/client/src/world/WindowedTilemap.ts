import Phaser from "phaser";
import {
  TILE_SIZE,
  isTallPropBase,
  tallPropPixelHeight,
  tallPropDepth,
  tallPropWorldPos,
  TALL_PROP_TOP,
} from "@game/shared";
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
 *
 * Tall props (columns, statues, trees) are lifted off the flat deco/overhead
 * layers into >16px sprites depth-sorted by base Y with the player.
 */
export const VIEW_W = 48;
export const VIEW_H = 36;

type TallPropSprite = {
  key: string;
  sprite: Phaser.GameObjects.Image;
  baseTile: number;
  wx: number;
  wy: number;
};

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

  /** Active tall prop sprites keyed by "wx,wy". */
  private tallProps = new Map<string, TallPropSprite>();
  /** Cached tall frames: baseTile → texture key. */
  private tallFrameKeys = new Map<number, string>();

  constructor(
    private scene: Phaser.Scene,
    private world: WorldModel
  ) {
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
    // Overhead stays high for banners/canopies that are not tall-prop feet
    this.overhead.setDepth(1_000_000);
  }

  get origin(): StreamOrigin {
    return { ox: this.ox, oy: this.oy };
  }

  /** Hide/show all layers + tall prop sprites. */
  setVisible(v: boolean): void {
    this.ground.setVisible(v);
    this.deco.setVisible(v);
    this.overhead.setVisible(v);
    for (const p of this.tallProps.values()) p.sprite.setVisible(v);
  }

  /** Call every frame with the follow target's tile coordinates. */
  update(centerTileX: number, centerTileY: number): void {
    const next = desiredOrigin(centerTileX, centerTileY, VIEW_W, VIEW_H);
    const prev: StreamOrigin | null =
      this.ox === Number.MIN_SAFE_INTEGER ? null : { ox: this.ox, oy: this.oy };
    if (!needsStream(prev, next)) {
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
    this.syncTallProps();
  }

  /** Force tall-prop depth refresh (e.g. after player moves within same window). */
  refreshTallPropDepths(): void {
    for (const p of this.tallProps.values()) {
      p.sprite.setDepth(tallPropDepth(p.wy));
    }
  }

  /** Exposed for tests — number of active tall prop sprites. */
  get tallPropCount(): number {
    return this.tallProps.size;
  }

  /** Exposed for tests — depth of prop at world tile if present. */
  tallPropDepthAt(wx: number, wy: number): number | null {
    const p = this.tallProps.get(`${wx},${wy}`);
    return p ? p.sprite.depth : null;
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
    // Tall prop bases are drawn as Y-sorted sprites — leave deco empty
    if (d !== 0 && isTallPropBase(d)) {
      this.deco.putTileAt(-1, tx, ty, false);
      // Suppress matching overhead top tile (rendered into the tall sprite)
      const top = TALL_PROP_TOP[d] ?? 0;
      const o = w.overhead(wx, wy - 1);
      // Still write local overhead if it's not the pair top on the cell above
      // (handled when we visit the cell above). For the base cell, write overhead normally
      // unless it's a top sitting wrongly on base.
      const oHere = w.overhead(wx, wy);
      this.overhead.putTileAt(oHere === 0 || oHere === top ? -1 : oHere, tx, ty, false);
      void o;
    } else {
      this.deco.putTileAt(d === 0 ? -1 : d, tx, ty, false);
      const o = w.overhead(wx, wy);
      // Hide overhead tops that belong to a tall prop base below
      const below = w.inBounds(wx, wy + 1) ? w.deco(wx, wy + 1) : 0;
      if (below && isTallPropBase(below) && o === (TALL_PROP_TOP[below] ?? -1)) {
        this.overhead.putTileAt(-1, tx, ty, false);
      } else {
        this.overhead.putTileAt(o === 0 ? -1 : o, tx, ty, false);
      }
    }
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

  /**
   * Ensure tall prop sprites exist for every tall base in the current window,
   * destroy those that scrolled out, and set depth from base Y.
   */
  private syncTallProps(): void {
    if (this.ox === Number.MIN_SAFE_INTEGER) return;
    const live = new Set<string>();
    for (let ty = 0; ty < VIEW_H; ty++) {
      for (let tx = 0; tx < VIEW_W; tx++) {
        const wx = this.ox + tx;
        const wy = this.oy + ty;
        if (!this.world.inBounds(wx, wy)) continue;
        const d = this.world.deco(wx, wy);
        if (!d || !isTallPropBase(d)) continue;
        const key = `${wx},${wy}`;
        live.add(key);
        let entry = this.tallProps.get(key);
        if (!entry) {
          const texKey = this.ensureTallTexture(d);
          const pos = tallPropWorldPos(wx, wy);
          const spr = this.scene.add.image(pos.x, pos.y, texKey);
          spr.setOrigin(0.5, 1);
          spr.setDepth(tallPropDepth(wy));
          entry = { key, sprite: spr, baseTile: d, wx, wy };
          this.tallProps.set(key, entry);
        } else {
          const pos = tallPropWorldPos(wx, wy);
          entry.sprite.setPosition(pos.x, pos.y);
          entry.sprite.setDepth(tallPropDepth(wy));
        }
      }
    }
    for (const [key, entry] of this.tallProps) {
      if (!live.has(key)) {
        entry.sprite.destroy();
        this.tallProps.delete(key);
      }
    }
  }

  /** Compose a 16×32 (or 16×16) texture from tileset frames for a tall prop. */
  private ensureTallTexture(baseTile: number): string {
    const existing = this.tallFrameKeys.get(baseTile);
    if (existing && this.scene.textures.exists(existing)) return existing;

    const key = `tall-prop-${baseTile}`;
    if (this.scene.textures.exists(key)) {
      this.tallFrameKeys.set(baseTile, key);
      return key;
    }

    const h = tallPropPixelHeight(baseTile);
    const topTile = TALL_PROP_TOP[baseTile] ?? 0;
    const cols = 16; // TILESET_COLS
    const tileset = this.scene.textures.get("tileset").getSourceImage() as HTMLImageElement;

    const canvas = this.scene.textures.createCanvas(key, TILE_SIZE, h);
    if (!canvas) {
      // Fallback: use single tile frame
      this.tallFrameKeys.set(baseTile, "tileset");
      return "tileset";
    }
    const ctx = canvas.getContext();
    ctx.imageSmoothingEnabled = false;

    const blitTile = (tileIndex: number, dy: number) => {
      if (tileIndex <= 0) return;
      const sx = (tileIndex % cols) * TILE_SIZE;
      const sy = Math.floor(tileIndex / cols) * TILE_SIZE;
      ctx.drawImage(tileset as CanvasImageSource, sx, sy, TILE_SIZE, TILE_SIZE, 0, dy, TILE_SIZE, TILE_SIZE);
    };

    if (topTile && h > TILE_SIZE) {
      blitTile(topTile, 0);
      blitTile(baseTile, TILE_SIZE);
    } else {
      blitTile(baseTile, 0);
    }
    canvas.refresh();
    this.tallFrameKeys.set(baseTile, key);
    return key;
  }
}
