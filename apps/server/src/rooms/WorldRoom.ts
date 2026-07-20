import { Room, Client } from "@colyseus/core";
import {
  WorldState,
  PlayerState,
  TICK_RATE,
  WALK_SPEED,
  MSG,
  SMSG,
  MoveMsg,
  ChatMsg,
  SChatMsg,
  MAX_CHAT_LEN,
  CHAT_RATE_LIMIT_MS,
  PLAZA_SPAWN_X,
  PLAZA_SPAWN_Y,
} from "@game/shared";
import { encounterAt, getWorld } from "../world/mapData.js";
import { HouseRegistry } from "../systems/houses.js";
import { getDb } from "../db/index.js";
import { BattleManager } from "../systems/battle.js";
import { tryStep } from "../systems/movement.js";
import { chatRecipients, buildChatPayload } from "../systems/chat.js";
import {
  tryEnterBuilding,
  tryConfirmEnterBuilding,
  interiorFromTarget,
  INTERIOR_SPAWN,
  isInteriorExitMat,
  homeOutdoor,
  type InteriorSession,
} from "../systems/enterBuilding.js";
import { loadOrGrantInventory } from "../systems/inventory.js";
import type { EnterTarget } from "@game/shared";

const STEP_MS = 1000 / WALK_SPEED;

interface SessionData {
  uid: string;
  lastMoveAt: number;
  lastChatAt: number;
  /** Active interior (when place === interior). */
  interior: InteriorSession | null;
}

export class WorldRoom extends Room<WorldState> {
  maxClients = 200;
  private houses = new HouseRegistry();
  private sessions = new Map<string, SessionData>();
  battles = new BattleManager(this);

  onCreate() {
    this.setState(new WorldState());
    this.autoDispose = false;
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);

    this.onMessage(MSG.MOVE, (client, msg: MoveMsg) => this.handleMove(client, msg));
    this.onMessage(MSG.CHAT, (client, msg: ChatMsg) => this.handleChat(client, msg));
    this.onMessage(MSG.ENTER_HOUSE, (client) => this.handleEnterHouse(client));
    this.onMessage(MSG.EXIT_HOUSE, (client) => this.handleExitHouse(client));
    this.onMessage(MSG.BATTLE_ACTION, (client, msg) => this.battles.handleAction(client, msg));
    this.onMessage(MSG.GET_INVENTORY, (client) => this.handleGetInventory(client));
    this.onMessage(MSG.GO_HOME, (client) => this.handleGoHome(client));

    console.log("[world] room created");
  }

  tick() {
    // reserved for periodic systems (battle timeouts etc.)
    this.battles.tick();
  }

  onJoin(client: Client, options: { name?: string; uid?: string; skin?: number }) {
    const uid = typeof options?.uid === "string" && options.uid.length <= 64 ? options.uid : client.sessionId;
    const p = new PlayerState();
    p.name = String(options?.name ?? "Wanderer").slice(0, 16).replace(/[^\w\- ]/g, "") || "Wanderer";
    p.skin = Math.min(7, Math.max(0, Number(options?.skin ?? 0) | 0));

    const houseId = this.houses.claim(uid);
    p.houseId = houseId;
    // First paint is always the capital plaza (marble court + fountain). House is
    // still claimed for lose-warp / enter-home; do not drop players in empty lawns.
    p.x = PLAZA_SPAWN_X;
    p.y = PLAZA_SPAWN_Y;
    if (houseId < 0) {
      client.send(SMSG.SERVER_FULL, { message: "All 100 houses are claimed — you spawn at the plaza." });
    }

    this.state.players.set(client.sessionId, p);
    this.sessions.set(client.sessionId, { uid, lastMoveAt: 0, lastChatAt: 0, interior: null });
    // Grant starter immediately (DB), then re-send PARTY shortly after join so the
    // client has time to register onMessage handlers post-joinOrCreate.
    this.battles.sendParty(client, uid);
    client.send(SMSG.INVENTORY, loadOrGrantInventory(uid));
    this.clock.setTimeout(() => {
      if (this.sessions.has(client.sessionId)) {
        this.battles.sendParty(client, uid);
        client.send(SMSG.INVENTORY, loadOrGrantInventory(uid));
      }
    }, 80);
    console.log(
      `[world] ${client.sessionId} (${p.name}) joined — house ${houseId}, ${this.state.players.size} online`
    );
  }

  onLeave(client: Client) {
    this.battles.endFor(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    console.log(`[world] ${client.sessionId} left — ${this.state.players.size} online`);
  }

  uidOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.uid;
  }

  private handleMove(client: Client, msg: MoveMsg) {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || p.inBattle) return;
    const dir = msg?.dir;
    if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) return;

    // anti-speedhack: allow slight jitter but no faster than 80% of step time
    const now = Date.now();
    if (now - s.lastMoveAt < STEP_MS * 0.8) {
      client.send(SMSG.MOVE_REJECT, { seq: msg.seq, x: p.x, y: p.y });
      return;
    }

    // Interior movement: walk room tiles; stepping on exit mat warps out.
    if (p.place === "interior") {
      p.dir = dir;
      const nx = p.x + (dir === 2 ? -1 : dir === 3 ? 1 : 0);
      const ny = p.y + (dir === 0 ? 1 : dir === 1 ? -1 : 0);
      // Soft bounds matching interior templates (~12×9); solid walls handled client-side.
      if (nx < 1 || ny < 1 || nx > 10 || ny > 8) {
        client.send(SMSG.MOVE_REJECT, { seq: msg.seq, x: p.x, y: p.y });
        return;
      }
      s.lastMoveAt = now;
      p.x = nx;
      p.y = ny;
      client.send(SMSG.MOVE_ACK, { seq: msg.seq, x: p.x, y: p.y });
      if (isInteriorExitMat(nx, ny)) {
        this.warpExit(client, p, s);
      }
      return;
    }

    if (p.place !== "world") return;

    const step = tryStep(p.x, p.y, dir);
    p.dir = dir;
    if (!step.ok) {
      client.send(SMSG.MOVE_REJECT, { seq: msg.seq, x: p.x, y: p.y });
      return;
    }
    s.lastMoveAt = now;
    p.x = step.x;
    p.y = step.y;
    client.send(SMSG.MOVE_ACK, { seq: msg.seq, x: p.x, y: p.y });

    // Auto-enter ONLY when the step lands exactly on the door tile (never adjacency).
    const entered = this.tryWarpEnter(client, p, step.x, step.y);
    if (entered) return;

    // wild encounter roll
    const habitat = encounterAt(step.x, step.y);
    if (habitat > 0) {
      this.battles.maybeStart(client, p, habitat);
    }
  }

  private housesList() {
    return getWorld().houses;
  }

  /** Apply an enter warp from a resolved target. */
  private applyEnterWarp(client: Client, p: PlayerState, target: EnterTarget): boolean {
    const s = this.sessions.get(client.sessionId);
    if (!s) return false;
    const interior = interiorFromTarget(target);
    s.interior = interior;
    p.place = "interior";
    p.x = INTERIOR_SPAWN.x;
    p.y = INTERIOR_SPAWN.y;
    client.send(SMSG.WARP, {
      place: "interior",
      x: INTERIOR_SPAWN.x,
      y: INTERIOR_SPAWN.y,
      interiorKind: interior.kind,
      interiorName: interior.name,
      buildingId: interior.buildingId,
    });
    return true;
  }

  /** Auto-enter: exact door tile only (x === doorX && y === doorY). */
  private tryWarpEnter(client: Client, p: PlayerState, x: number, y: number): boolean {
    const target = tryEnterBuilding(x, y, this.housesList(), p.houseId);
    if (!target) return false;
    return this.applyEnterWarp(client, p, target);
  }

  private warpExit(
    client: Client,
    p: PlayerState,
    s: SessionData
  ): void {
    const interior = s.interior;
    p.place = "world";
    if (interior) {
      p.x = interior.exitX;
      p.y = interior.exitY;
    } else {
      const home = homeOutdoor(this.housesList(), p.houseId);
      p.x = home.x;
      p.y = home.y;
    }
    p.dir = 0;
    s.interior = null;
    client.send(SMSG.WARP, { place: "world", x: p.x, y: p.y });
  }

  private handleEnterHouse(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.place !== "world" || p.inBattle) return;
    // E confirm: on door tile OR directly south facing north — never side/north neighbors alone.
    const target = tryConfirmEnterBuilding(p.x, p.y, p.dir as 0 | 1 | 2 | 3, this.housesList(), p.houseId);
    if (target && this.applyEnterWarp(client, p, target)) return;
    client.send(SMSG.TOAST, {
      message: "Stand on a doorway (or face it from the south) and press E — or H to go home.",
    });
  }

  private handleExitHouse(client: Client) {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || p.place !== "interior") return;
    this.warpExit(client, p, s);
  }

  private handleGetInventory(client: Client) {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    client.send(SMSG.INVENTORY, loadOrGrantInventory(s.uid));
  }

  private handleGoHome(client: Client) {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || p.inBattle) return;
    if (p.place === "interior") {
      // exit first then home
      s.interior = null;
    }
    const home = homeOutdoor(this.housesList(), p.houseId);
    p.place = "world";
    p.x = home.x;
    p.y = home.y;
    p.dir = 0;
    client.send(SMSG.WARP, { place: "world", x: p.x, y: p.y });
    client.send(SMSG.TOAST, {
      message: p.houseId >= 0 ? "Returned to your house door." : "No house claimed — plaza spawn.",
    });
  }

  private handleChat(client: Client, msg: ChatMsg) {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s) return;
    const now = Date.now();
    if (now - s.lastChatAt < CHAT_RATE_LIMIT_MS) return;
    const channel = msg?.channel === "local" ? "local" : "global";
    const text = String(msg?.text ?? "")
      .slice(0, MAX_CHAT_LEN)
      .trim();
    if (!text) return;
    s.lastChatAt = now;

    const speaker = {
      sessionId: client.sessionId,
      name: p.name,
      x: p.x,
      y: p.y,
      place: p.place,
    };
    const peers = [...this.state.players.entries()].map(([sessionId, other]) => ({
      sessionId,
      x: other.x,
      y: other.y,
      place: other.place,
    }));
    const out: SChatMsg = buildChatPayload(speaker, channel, text, now);
    const targets = chatRecipients(speaker, channel, peers);
    for (const sid of targets) {
      const target = this.clients.find((c) => c.sessionId === sid);
      target?.send(SMSG.CHAT, out);
    }
    getDb()
      .prepare("INSERT INTO chat_log (ts, uid, name, channel, text) VALUES (?, ?, ?, ?, ?)")
      .run(now, s.uid, p.name, channel, text);
  }
}
