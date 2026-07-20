import Phaser from "phaser";
import {
  TILE_SIZE,
  isTallPropBase,
  tallPropPixelHeight,
  tallPropDepth,
  tallPropWorldPos,
  TALL_PROP_TOP,
  TALL_PROP_STACK,
  tallPropOverlayTiles,
  animatedTileIndex,
  isAnimatedTile,
  TILE_ANIM_PERIOD_MS,
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

  /** Tear down layers + tall props (used when swapping overworld ↔ interior). */
  destroy(): void {
    for (const p of this.tallProps.values()) p.sprite.destroy();
    this.tallProps.clear();
    this.map.destroy();
  }

  /** Last animation period index applied (for ~500ms tile loops). */
  private lastAnimPeriod = -1;

  /** Call every frame with the follow target's tile coordinates. */
  update(centerTileX: number, centerTileY: number): void {
    const next = desiredOrigin(centerTileX, centerTileY, VIEW_W, VIEW_H);
    const prev: StreamOrigin | null =
      this.ox === Number.MIN_SAFE_INTEGER ? null : { ox: this.ox, oy: this.oy };
    if (!needsStream(prev, next)) {
      this.tickAnimatedTiles();
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
    this.tickAnimatedTiles(true);
  }

  /**
   * Advance water / fountain / banner / flower tile frames (~500ms cadence).
   * Phase offset is per world cell so water doesn't shimmer in lockstep.
   */
  private tickAnimatedTiles(force = false): void {
    if (this.ox === Number.MIN_SAFE_INTEGER) return;
    const now = this.scene.time.now;
    const period = Math.floor(now / TILE_ANIM_PERIOD_MS);
    if (!force && period === this.lastAnimPeriod) return;
    this.lastAnimPeriod = period;
    for (let ty = 0; ty < VIEW_H; ty++) {
      for (let tx = 0; tx < VIEW_W; tx++) {
        const wx = this.ox + tx;
        const wy = this.oy + ty;
        if (!this.world.inBounds(wx, wy)) continue;
        const g = this.world.ground(wx, wy);
        if (isAnimatedTile(g)) {
          this.ground.putTileAt(animatedTileIndex(g, now, wx, wy), tx, ty, false);
        }
        const d = this.world.deco(wx, wy);
        if (d && isAnimatedTile(d) && !isTallPropBase(d)) {
          this.deco.putTileAt(animatedTileIndex(d, now, wx, wy), tx, ty, false);
        }
        const o = this.world.overhead(wx, wy);
        if (o && isAnimatedTile(o)) {
          this.overhead.putTileAt(animatedTileIndex(o, now, wx, wy), tx, ty, false);
        }
      }
    }
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
    const now = this.scene.time?.now ?? 0;
    const g0 = w.ground(wx, wy);
    this.ground.putTileAt(
      isAnimatedTile(g0) ? animatedTileIndex(g0, now, wx, wy) : g0,
      tx,
      ty,
      false
    );
    const d = w.deco(wx, wy);
    // Tall prop bases are drawn as Y-sorted sprites — leave deco empty
    if (d !== 0 && isTallPropBase(d)) {
      this.deco.putTileAt(-1, tx, ty, false);
      // Suppress stack overlay tiles that are composed into the tall sprite
      const overlays = new Set(tallPropOverlayTiles(d));
      const top = TALL_PROP_TOP[d] ?? 0;
      if (top) overlays.add(top);
      const oHere = w.overhead(wx, wy);
      this.overhead.putTileAt(oHere === 0 || overlays.has(oHere) ? -1 : oHere, tx, ty, false);
    } else {
      this.deco.putTileAt(d === 0 ? -1 : d, tx, ty, false);
      const o = w.overhead(wx, wy);
      // Hide overhead segments that belong to a tall prop base below (1 or 2 tiles south)
      let hide = false;
      for (const dy of [1, 2]) {
        const by = wy + dy;
        if (!w.inBounds(wx, by)) continue;
        const below = w.deco(wx, by);
        if (!below || !isTallPropBase(below)) continue;
        const overlays = tallPropOverlayTiles(below);
        const top = TALL_PROP_TOP[below] ?? -1;
        if (o === top || overlays.includes(o)) {
          hide = true;
          break;
        }
      }
      if (hide) {
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

  /** Compose a 16×N texture from tileset frames for a tall prop (N = stack height). */
  private ensureTallTexture(baseTile: number): string {
    const existing = this.tallFrameKeys.get(baseTile);
    if (existing && this.scene.textures.exists(existing)) return existing;

    const key = `tall-prop-${baseTile}`;
    if (this.scene.textures.exists(key)) {
      this.tallFrameKeys.set(baseTile, key);
      return key;
    }

    const h = tallPropPixelHeight(baseTile);
    const stack = TALL_PROP_STACK[baseTile] ?? [baseTile];
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

    // stack is top → bottom; blit from y=0 downward
    for (let i = 0; i < stack.length; i++) {
      blitTile(stack[i]!, i * TILE_SIZE);
    }
    canvas.refresh();
    this.tallFrameKeys.set(baseTile, key);
    return key;
  }
}
