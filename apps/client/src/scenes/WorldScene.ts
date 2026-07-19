import Phaser from "phaser";
import { getStateCallbacks } from "colyseus.js";
import {
  TILE_SIZE,
  WALK_SPEED,
  DIR_DX,
  DIR_DY,
  Dir,
  WorldFile,
  SWarp,
  SBattleStart,
  SPartyEntry,
  SInventoryEntry,
  SChatMsg,
  PlayerState,
  WorldState,
  resolveEnterTarget,
  enterPrompt,
  type ClientSettings,
} from "@game/shared";
import { WorldModel } from "../world/WorldModel";
import { WindowedTilemap } from "../world/WindowedTilemap";
import { CHAR_H } from "./PreloadScene";
import {
  getRoom,
  sendMove,
  sendEnterHouse,
  sendExitHouse,
  sendGetInventory,
  sendGoHome,
  bindHandlers,
  getPlayerSkin,
  getLastParty,
  getLastInventory,
} from "../net/connection";
import { reconcileWorldPosition } from "../net/reconcile";
import { ChatUI } from "../ui/ChatUI";
import { PartyHUD } from "../ui/PartyHUD";
import { GameMenus, loadSettings } from "../ui/GameMenus";

const STEP_MS = 1000 / WALK_SPEED;

interface RemoteSprite {
  sprite: Phaser.GameObjects.Sprite;
  nameTag: Phaser.GameObjects.Text;
  tx: number;
  ty: number;
  dir: number;
  skin: number;
  targetX: number;
  targetY: number;
}

/**
 * Authoritative multiplayer world scene.
 * Local player: client-side prediction + server reject/reconcile.
 * Remotes: schema-driven with simple position lerp.
 */
export class WorldScene extends Phaser.Scene {
  world!: WorldModel;
  private tilemap!: WindowedTilemap;
  private player!: Phaser.GameObjects.Sprite;
  private nameTag!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private keyE!: Phaser.Input.Keyboard.Key;
  private keyX!: Phaser.Input.Keyboard.Key;
  private keyP!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyO!: Phaser.Input.Keyboard.Key;
  private keyH!: Phaser.Input.Keyboard.Key;
  private keyEsc!: Phaser.Input.Keyboard.Key;

  tileX = 513; // PLAZA_SPAWN_X — first paint defaults to capital until schema arrives
  tileY = 528; // PLAZA_SPAWN_Y
  private dir: Dir = 0;
  private moving = false;
  private skin = 0;
  private place: "world" | "interior" = "world";
  private houseId = -1;
  private sessionId = "";
  private pendingSeq = 0;
  /** predicted path of seq → tile after that move (for reject reconcile) */
  private predStack: Array<{ seq: number; x: number; y: number }> = [];

  private remotes = new Map<string, RemoteSprite>();
  private chat!: ChatUI;
  private partyHud!: PartyHUD;
  private menus!: GameMenus;
  private interiorGfx: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private unbind: (() => void) | null = null;
  private inBattle = false;
  private interiorKind: "house" | "temple" | "shrine" = "house";
  private interiorName = "Interior";
  private settings: ClientSettings = loadSettings();
  /** Overworld zoom restored when leaving an interior. */
  private overworldZoom = 2.0;
  /**
   * Fixed world origin for interior rooms (far from the 1024 map so leftover
   * tiles never appear). Camera centers here with zoom 1 while inside.
   */
  private static readonly INTERIOR_ORIGIN_X = -8000;
  private static readonly INTERIOR_ORIGIN_Y = -8000;

  constructor() {
    super("world");
  }

  create() {
    const file = this.cache.json.get("world") as WorldFile;
    this.world = new WorldModel(file);
    this.tilemap = new WindowedTilemap(this, this.world);

    const room = getRoom();
    this.sessionId = room.sessionId;

    // Authoritative spawn from schema (or wait briefly if not yet present)
    const me = room.state.players.get(this.sessionId);
    this.skin = me?.skin ?? getPlayerSkin();
    if (me) {
      this.tileX = me.x;
      this.tileY = me.y;
      this.dir = (me.dir as Dir) ?? 0;
      this.houseId = me.houseId ?? -1;
      this.place = (me.place as "world" | "interior") || "world";
    }

    this.player = this.add.sprite(0, 0, "characters", this.skin * 12);
    this.player.setOrigin(0.5, 1);
    this.syncPlayerPixel();

    this.nameTag = this.add
      .text(0, 0, me?.name ?? "You", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#ffe8a0",
        stroke: "#000",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    this.syncNameTag();

    const cam = this.cameras.main;
    // DP-like overworld zoom: player stays centered; world scrolls underfoot.
    // ~2.0 ≈ 30×20 tiles at 960×640 — capital plaza props readable in-frame.
    cam.setZoom(2.0);
    cam.startFollow(this.player, true, 1, 1); // hard lock — no laggy edge feel
    cam.setRoundPixels(true);
    cam.setDeadzone(0, 0);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys("W,A,S,D") as WorldScene["wasd"];
    this.keyE = this.input.keyboard!.addKey("E");
    this.keyX = this.input.keyboard!.addKey("X");
    this.keyP = this.input.keyboard!.addKey("P");
    this.keyI = this.input.keyboard!.addKey("I");
    this.keyO = this.input.keyboard!.addKey("O");
    this.keyH = this.input.keyboard!.addKey("H");
    this.keyEsc = this.input.keyboard!.addKey("ESC");

    this.chat = new ChatUI();
    this.partyHud = new PartyHUD();
    this.menus = new GameMenus(document.body, {
      onSettingsChange: (s) => this.applySettings(s),
    });
    const cachedParty = getLastParty();
    if (cachedParty.length) {
      this.partyHud.setParty(cachedParty);
      this.menus.setParty(cachedParty);
    }
    const cachedInv = getLastInventory();
    if (cachedInv.length) this.menus.setInventory(cachedInv);
    this.applySettings(this.menus.currentSettings);
    this.statusText = this.add
      .text(8, 8, "", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#c8b890",
        backgroundColor: "#00000088",
        padding: { x: 4, y: 2 },
      })
      .setScrollFactor(0)
      .setDepth(1_000_000);
    this.promptText = this.add
      .text(480, 600, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#ffe8a0",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(1_000_001)
      .setVisible(false);

    this.tilemap.update(this.tileX, this.tileY);
    this.bindNet(room);
    this.hookRemotePlayers(room);

    // If schema arrived late, re-sync once
    this.time.delayedCall(100, () => {
      const p = room.state.players.get(this.sessionId);
      if (p && !this.moving && this.place === "world") {
        this.tileX = p.x;
        this.tileY = p.y;
        this.skin = p.skin;
        this.houseId = p.houseId;
        this.player.setFrame(this.skin * 12 + this.dir * 3);
        this.syncPlayerPixel();
        this.tilemap.update(this.tileX, this.tileY);
      }
      this.refreshStatus();
    });

    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.inBattle = false;
      this.moving = false;
      // Schema may have moved us (e.g. lose → house spawn) while battle overlay ran.
      this.forceReconcileFromServer();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  /** Snap local tile/pixel to authoritative room state (post-battle, WARP fallback). */
  private forceReconcileFromServer() {
    try {
      const room = getRoom();
      const me = room.state.players.get(this.sessionId);
      if (!me) return;
      this.houseId = me.houseId ?? this.houseId;
      if (me.place === "interior" && this.place !== "interior") {
        // Unexpected interior while we think we're outside — honor WARP path only
        return;
      }
      if (me.place === "world" && this.place === "interior") {
        // Server put us back in world (lose while somehow interior) — exit interior gfx
        this.hideInterior();
        this.place = "world";
        this.resumeOverworldCamera();
      }
      const snap = reconcileWorldPosition(
        { tileX: this.tileX, tileY: this.tileY, place: this.place },
        { x: me.x, y: me.y, place: me.place }
      );
      if (snap) {
        this.tweens.killTweensOf(this.player);
        this.tileX = snap.tileX;
        this.tileY = snap.tileY;
        this.dir = (me.dir as Dir) ?? this.dir;
        this.player.stop();
        this.player.setFrame(this.skin * 12 + this.dir * 3);
        this.syncPlayerPixel();
        this.cameras.main.centerOn(this.player.x, this.player.y);
        this.tilemap.update(this.tileX, this.tileY);
        this.refreshStatus();
      }
    } catch {
      /* not connected */
    }
  }

  private teardown() {
    this.unbind?.();
    this.chat?.destroy();
    this.partyHud?.destroy();
    this.menus?.destroy();
    for (const r of this.remotes.values()) {
      r.sprite.destroy();
      r.nameTag.destroy();
    }
    this.remotes.clear();
  }

  private bindNet(room: ReturnType<typeof getRoom>) {
    this.unbind = bindHandlers({
      onChat: (msg: SChatMsg) => this.chat.push(msg),
      onMoveReject: (msg) => this.onMoveReject(msg),
      onWarp: (msg) => this.onWarp(msg),
      onBattleStart: (msg) => this.onBattleStart(msg),
      onParty: (entries: SPartyEntry[]) => {
        this.partyHud.setParty(entries);
        this.menus.setParty(entries);
      },
      onInventory: (entries: SInventoryEntry[]) => this.menus.setInventory(entries),
      onToast: (msg) => this.chat.system(msg.message),
      onServerFull: (msg) => this.chat.system(msg.message),
    });
    void room;
  }

  private applySettings(s: ClientSettings): void {
    this.settings = s;
    // Name tags visibility
    this.nameTag?.setVisible(s.showNames);
    for (const r of this.remotes.values()) {
      r.nameTag.setVisible(s.showNames && r.sprite.visible);
    }
    // Chat default channel
    this.chat?.setDefaultChannel?.(s.chatChannel);
  }

  private hookRemotePlayers(room: ReturnType<typeof getRoom>) {
    // Colyseus 0.16 / schema 3: callbacks via getStateCallbacks proxy
    const $ = getStateCallbacks(room);
    const $state = $(room.state as WorldState);

    $state.players.onAdd((player, sessionId) => {
      const p = player as unknown as PlayerState;
      const $player = $(player);
      if (sessionId === this.sessionId) {
        $player.onChange(() => this.softReconcileSelf(p));
        return;
      }
      this.ensureRemote(sessionId, p);
      $player.onChange(() => this.syncRemote(sessionId, p));
    });

    $state.players.onRemove((_player, sessionId) => {
      const r = this.remotes.get(sessionId);
      if (r) {
        r.sprite.destroy();
        r.nameTag.destroy();
        this.remotes.delete(sessionId);
      }
    });
  }

  /** When idle, snap to authoritative schema position if we drifted. */
  private softReconcileSelf(player: PlayerState) {
    // During battle the overlay owns the screen; RESUME + WARP apply the snap.
    if (this.moving || this.inBattle) return;
    this.houseId = player.houseId;
    const snap = reconcileWorldPosition(
      { tileX: this.tileX, tileY: this.tileY, place: this.place },
      { x: player.x, y: player.y, place: player.place }
    );
    if (!snap) return;
    this.tileX = snap.tileX;
    this.tileY = snap.tileY;
    this.dir = (player.dir as Dir) ?? this.dir;
    this.player.setFrame(this.skin * 12 + this.dir * 3);
    this.syncPlayerPixel();
    this.tilemap.update(this.tileX, this.tileY);
  }

  private ensureRemote(sessionId: string, player: PlayerState) {
    let r = this.remotes.get(sessionId);
    if (!r) {
      const sprite = this.add.sprite(0, 0, "characters", (player.skin ?? 0) * 12);
      sprite.setOrigin(0.5, 1);
      const nameTag = this.add
        .text(0, 0, player.name || "?", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#c8d8ff",
          stroke: "#000",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1);
      r = {
        sprite,
        nameTag,
        tx: player.x,
        ty: player.y,
        dir: player.dir,
        skin: player.skin,
        targetX: player.x * TILE_SIZE + TILE_SIZE / 2,
        targetY: player.y * TILE_SIZE + TILE_SIZE,
      };
      this.remotes.set(sessionId, r);
    }
    this.syncRemote(sessionId, player);
  }

  private syncRemote(sessionId: string, player: PlayerState) {
    const r = this.remotes.get(sessionId);
    if (!r) return;

    // Hide players in different places (other interiors / world while we're inside)
    const samePlace =
      player.place === this.place &&
      (this.place === "world" || true); // interiors are private — only self is shown inside
    const visible =
      this.place === "world" && player.place === "world" && !player.inBattle;

    r.sprite.setVisible(visible);
    r.nameTag.setVisible(visible && this.settings.showNames);
    if (!visible) return;

    r.skin = player.skin;
    r.dir = player.dir;
    r.nameTag.setText(player.name || "?");

    if (r.tx !== player.x || r.ty !== player.y) {
      r.tx = player.x;
      r.ty = player.y;
      r.targetX = player.x * TILE_SIZE + TILE_SIZE / 2;
      r.targetY = player.y * TILE_SIZE + TILE_SIZE;
      r.sprite.play(`walk-${r.skin}-${r.dir}`, true);
    } else {
      r.sprite.setFrame(r.skin * 12 + r.dir * 3);
    }
    void samePlace;
  }

  private syncPlayerPixel() {
    this.player.x = this.tileX * TILE_SIZE + TILE_SIZE / 2;
    this.player.y = this.tileY * TILE_SIZE + TILE_SIZE;
    this.player.setDepth(10 + this.tileY * 0.001);
    this.syncNameTag();
  }

  private syncNameTag() {
    if (!this.nameTag || !this.player) return;
    this.nameTag.x = this.player.x;
    this.nameTag.y = this.player.y - CHAR_H - 2;
    this.nameTag.setDepth(this.player.depth + 0.1);
  }

  private heldDir(): Dir | null {
    // Don't steal keys while typing in chat
    if (document.activeElement instanceof HTMLInputElement) return null;
    if (this.cursors.up.isDown || this.wasd.W.isDown) return 1;
    if (this.cursors.down.isDown || this.wasd.S.isDown) return 0;
    if (this.cursors.left.isDown || this.wasd.A.isDown) return 2;
    if (this.cursors.right.isDown || this.wasd.D.isDown) return 3;
    return null;
  }

  private tryStep(d: Dir) {
    if (this.inBattle || this.place === "interior") return;
    this.dir = d;
    const nx = this.tileX + DIR_DX[d];
    const ny = this.tileY + DIR_DY[d];
    this.player.setFrame(this.skin * 12 + d * 3);

    // Local collision prediction (server is authoritative)
    if (this.world.isBlocked(nx, ny)) {
      // still tell server so it can reject consistently / face dir
      // but skip animation
      return;
    }

    const seq = sendMove(d);
    this.pendingSeq = seq;
    this.predStack.push({ seq, x: nx, y: ny });
    if (this.predStack.length > 8) this.predStack.shift();

    this.moving = true;
    this.tileX = nx;
    this.tileY = ny;
    this.player.play(`walk-${this.skin}-${d}`, true);
    this.tweens.add({
      targets: this.player,
      x: nx * TILE_SIZE + TILE_SIZE / 2,
      y: ny * TILE_SIZE + TILE_SIZE,
      duration: STEP_MS,
      onUpdate: () => this.syncNameTag(),
      onComplete: () => {
        this.moving = false;
        this.player.setDepth(10 + this.tileY * 0.001);
        this.syncNameTag();
        if (this.inBattle) {
          this.player.stop();
          this.player.setFrame(this.skin * 12 + this.dir * 3);
          return;
        }
        const held = this.heldDir();
        if (held !== null) {
          this.tryStep(held);
        } else {
          this.player.stop();
          this.player.setFrame(this.skin * 12 + this.dir * 3);
        }
      },
    });
  }

  private onMoveReject(msg: { seq: number; x: number; y: number }) {
    // Snap back to authoritative position
    this.tweens.killTweensOf(this.player);
    this.moving = false;
    this.tileX = msg.x;
    this.tileY = msg.y;
    this.predStack = this.predStack.filter((p) => p.seq > msg.seq);
    this.player.stop();
    this.player.setFrame(this.skin * 12 + this.dir * 3);
    this.syncPlayerPixel();
    this.tilemap.update(this.tileX, this.tileY);
  }

  private onWarp(msg: SWarp) {
    // Apply even while battle overlay is up so lose→home is not lost.
    this.tweens.killTweensOf(this.player);
    this.moving = false;
    this.place = msg.place;
    this.tileX = msg.x;
    this.tileY = msg.y;
    this.player.stop();
    this.player.setFrame(this.skin * 12 + this.dir * 3);

    if (msg.place === "interior") {
      this.interiorKind = msg.interiorKind ?? "house";
      this.interiorName = msg.interiorName ?? "Interior";
      // Screen-space room overlay — must run AFTER tile coords are set, and must
      // NOT be followed by syncPlayerPixel (that would yank the sprite to tile 4,6
      // world space while scrollFactor is 0, leaving the room off-camera).
      this.showInterior();
      this.chat.system(`Entered ${this.interiorName}. Press X to exit.`);
    } else {
      this.hideInterior();
      this.syncPlayerPixel();
      this.tilemap.update(this.tileX, this.tileY);
      this.resumeOverworldCamera();
      if (!this.inBattle) this.chat.system("Returned to the world.");
      else this.chat.system("You retreat home to recover…");
    }
    this.refreshStatus();
    // refresh remote visibility for place change
    try {
      const room = getRoom();
      room.state.players.forEach((p, sid) => {
        if (sid !== this.sessionId) this.syncRemote(sid, p);
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * Paint a distinct interior room at a fixed world origin and park the camera
   * there (zoom 1). Never uses overworld tile pixels or scrollFactor(0)+zoom
   * hacks — those left the room off-screen / in a corner while grass showed.
   */
  private showInterior() {
    this.hideInterior();
    this.tilemap.setVisible(false);

    const cam = this.cameras.main;
    this.overworldZoom = cam.zoom || 2.0;
    cam.stopFollow();
    cam.setZoom(1);

    const ox = WorldScene.INTERIOR_ORIGIN_X;
    const oy = WorldScene.INTERIOR_ORIGIN_Y;
    // Room sized to fill most of the 960×640 canvas at zoom 1.
    const roomW = 720;
    const roomH = 480;
    const kind = this.interiorKind;
    const floorColor = kind === "temple" ? 0xd8d0bc : kind === "shrine" ? 0xc8c0a8 : 0x3a2e22;
    const wallColor = kind === "house" ? 0x1a1410 : 0x2a2830;
    const accent = kind === "temple" ? 0xa43e35 : kind === "shrine" ? 0x2f6fb8 : 0x6a3030;

    const mk = (x: number, y: number, w: number, h: number, color: number, depth: number) =>
      this.add.rectangle(x, y, w, h, color, 1).setDepth(depth);

    // Large void so nothing outside the room is visible
    const voidBg = mk(ox, oy, cam.width * 2, cam.height * 2, 0x0c0a10, 4.5);
    const walls = mk(ox, oy, roomW, roomH, wallColor, 5);
    const floor = mk(ox, oy + 16, roomW * 0.78, roomH * 0.62, floorColor, 5.1);
    floor.setStrokeStyle(3, 0x6a5040);
    const rug = mk(ox, oy + 40, roomW * 0.32, roomH * 0.22, accent, 5.2);

    const extras: Phaser.GameObjects.GameObject[] = [];
    if (kind !== "house") {
      for (const dx of [-roomW * 0.28, roomW * 0.28]) {
        extras.push(mk(ox + dx, oy - 10, 36, roomH * 0.55, 0xe8e0d0, 5.15));
      }
    } else {
      extras.push(mk(ox - roomW * 0.22, oy - 20, 70, 90, 0x4a6080, 5.2));
    }

    const label = this.add
      .text(ox, oy - roomH * 0.42, this.interiorName, {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#e8dcc0",
        backgroundColor: "#000000cc",
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(5.4);
    const hint = this.add
      .text(ox, oy + roomH * 0.42, "[X] Exit building", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#c8a060",
        backgroundColor: "#000000cc",
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(5.4);

    this.interiorGfx = [voidBg, walls, floor, rug, label, hint, ...extras];

    // Avatar stands in the room — world coords at interior origin, NOT tile 4,6.
    this.player.setScrollFactor(1);
    this.player.setDepth(6);
    this.player.x = ox;
    this.player.y = oy + 50;
    this.nameTag.setScrollFactor(1);
    this.nameTag.setDepth(6.1);
    this.syncNameTag();

    cam.centerOn(ox, oy);
  }

  private hideInterior() {
    for (const g of this.interiorGfx) g.destroy();
    this.interiorGfx = [];
    this.tilemap?.setVisible(true);
    if (this.player) {
      this.player.setScrollFactor(1);
      this.nameTag.setScrollFactor(1);
    }
  }

  /** Restore overworld camera follow + zoom after leaving an interior. */
  private resumeOverworldCamera() {
    if (!this.player) return;
    const cam = this.cameras.main;
    cam.setZoom(this.overworldZoom || 2.0);
    cam.startFollow(this.player, true, 1, 1);
    cam.setDeadzone(0, 0);
    cam.centerOn(this.player.x, this.player.y);
  }

  private onBattleStart(msg: SBattleStart) {
    this.inBattle = true;
    this.tweens.killTweensOf(this.player);
    this.moving = false;
    this.player.stop();
    this.player.setFrame(this.skin * 12 + this.dir * 3);
    this.scene.pause("world");
    this.scene.launch("battle", { start: msg });
  }

  private refreshStatus() {
    const place = this.place === "interior" ? this.interiorName : "world";
    const house = this.houseId >= 0 ? `house #${this.houseId}` : "plaza (no house)";
    this.statusText?.setText(
      `${place} · ${house} · (${this.tileX},${this.tileY})  [P]arty [I]bag [O]pts [H]ome [E]nter`
    );
    this.updateDoorPrompt();
    // Debug / screenshot tooling probe (pathfinding walkers)
    const w = window as unknown as {
      __dominionPos?: object;
      __dominionStep?: (dir: number) => boolean;
      __dominionEnter?: () => void;
      __dominionExit?: () => void;
      __dominionMenu?: (id: string) => void;
      __dominionGoHome?: () => void;
    };
    w.__dominionPos = {
      x: this.tileX,
      y: this.tileY,
      houseId: this.houseId,
      place: this.place,
      interiorName: this.interiorName,
      moving: this.moving,
      menu: this.menus?.openMenu ?? "none",
      px: this.player?.x,
      py: this.player?.y,
      streamCount: this.tilemap?.streamCount,
      lastStreamMode: this.tilemap?.lastStreamMode,
      lastCellsWritten: this.tilemap?.lastCellsWritten,
    };
    w.__dominionStep = (dir: number) => {
      if (this.menus?.blocksWorld() || this.moving || this.inBattle || this.place !== "world") return false;
      if (dir < 0 || dir > 3) return false;
      this.tryStep(dir as Dir);
      return this.moving;
    };
    w.__dominionEnter = () => sendEnterHouse();
    w.__dominionExit = () => sendExitHouse();
    w.__dominionGoHome = () => sendGoHome();
    w.__dominionMenu = (id: string) => {
      if (id === "none" || id === "close") this.menus.close();
      else if (id === "party" || id === "inventory" || id === "settings") this.menus.open(id);
      // Keep debug probe in sync even when world update is paused by menus.
      if (w.__dominionPos && typeof w.__dominionPos === "object") {
        (w.__dominionPos as { menu: string }).menu = this.menus.openMenu;
      }
    };
  }

  private updateDoorPrompt(): void {
    if (!this.promptText) return;
    if (this.place !== "world" || this.menus?.blocksWorld()) {
      this.promptText.setVisible(false);
      return;
    }
    const target = resolveEnterTarget(
      this.tileX,
      this.tileY,
      this.world.data.houses,
      this.houseId,
      true
    );
    const text = enterPrompt(target);
    if (text) {
      this.promptText.setText(text);
      this.promptText.setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }

  update(_t: number, dt: number) {
    if (this.inBattle) return;

    // Menus (work in world + interior; Esc closes)
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      if (this.menus.openMenu !== "none") this.menus.close();
    } else if (Phaser.Input.Keyboard.JustDown(this.keyP)) {
      this.menus.toggle("party");
    } else if (Phaser.Input.Keyboard.JustDown(this.keyI)) {
      sendGetInventory();
      this.menus.toggle("inventory");
    } else if (Phaser.Input.Keyboard.JustDown(this.keyO)) {
      this.menus.toggle("settings");
    }

    if (this.menus.blocksWorld()) {
      this.promptText?.setVisible(false);
      return;
    }

    // building enter / exit / go home
    if (Phaser.Input.Keyboard.JustDown(this.keyE) && this.place === "world") {
      sendEnterHouse();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyX) && this.place === "interior") {
      sendExitHouse();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyH) && this.place === "world") {
      sendGoHome();
    }

    if (this.place === "world" && !this.moving) {
      const held = this.heldDir();
      if (held !== null) this.tryStep(held);
    }
    // Stream tiles from the player's *pixel* center every frame so the window
    // tracks mid-step during the walk tween (continuous scroll, not edge-pop).
    if (this.place === "world") {
      const cx = Math.floor(this.player.x / TILE_SIZE);
      const cy = Math.floor((this.player.y - 1) / TILE_SIZE);
      this.tilemap.update(cx, cy);
    }

    // lerp remotes
    const alpha = Math.min(1, (dt / 1000) * WALK_SPEED * 1.4);
    for (const r of this.remotes.values()) {
      if (!r.sprite.visible) continue;
      r.sprite.x += (r.targetX - r.sprite.x) * alpha;
      r.sprite.y += (r.targetY - r.sprite.y) * alpha;
      const arrived =
        Math.abs(r.sprite.x - r.targetX) < 0.5 && Math.abs(r.sprite.y - r.targetY) < 0.5;
      if (arrived) {
        r.sprite.x = r.targetX;
        r.sprite.y = r.targetY;
        if (r.sprite.anims.isPlaying) {
          r.sprite.stop();
          r.sprite.setFrame(r.skin * 12 + r.dir * 3);
        }
      }
      r.sprite.setDepth(10 + r.ty * 0.001);
      r.nameTag.x = r.sprite.x;
      r.nameTag.y = r.sprite.y - CHAR_H - 2;
      r.nameTag.setDepth(r.sprite.depth + 0.1);
    }

    this.syncNameTag();
    if (this.place === "world") this.refreshStatus();
  }
}
