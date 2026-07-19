import { Client, Room } from "colyseus.js";
import {
  SERVER_PORT,
  WORLD_ROOM,
  MSG,
  SMSG,
  MoveMsg,
  ChatMsg,
  BattleActionMsg,
  ChatChannel,
  Dir,
  SChatMsg,
  SWarp,
  SBattleStart,
  SBattleUpdate,
  SBattleEnd,
  SPartyEntry,
  SMoveAck,
  SInventoryEntry,
  SToast,
  WorldState,
} from "@game/shared";

export const SERVER_URL = `ws://${typeof location !== "undefined" ? location.hostname : "localhost"}:${SERVER_PORT}`;

const UID_KEY = "dominion.uid";
const NAME_KEY = "dominion.name";
const SKIN_KEY = "dominion.skin";

export type NetHandlers = {
  onChat?: (msg: SChatMsg) => void;
  onMoveReject?: (msg: { seq: number; x: number; y: number }) => void;
  onMoveAck?: (msg: SMoveAck) => void;
  onWarp?: (msg: SWarp) => void;
  onBattleStart?: (msg: SBattleStart) => void;
  onBattleUpdate?: (msg: SBattleUpdate) => void;
  onBattleEnd?: (msg: SBattleEnd) => void;
  onParty?: (msg: SPartyEntry[]) => void;
  onServerFull?: (msg: { message: string }) => void;
  onInventory?: (msg: SInventoryEntry[]) => void;
  onToast?: (msg: SToast) => void;
};

let room: Room<WorldState> | null = null;
let moveSeq = 0;
/** Latest party snapshot (PARTY often arrives before scenes bind handlers). */
let lastParty: SPartyEntry[] = [];
let lastInventory: SInventoryEntry[] = [];
const earlyHandlers: NetHandlers[] = [];

export function getRoom(): Room<WorldState> {
  if (!room) throw new Error("not connected");
  return room;
}

export function tryGetRoom(): Room<WorldState> | null {
  return room;
}

export function getLastParty(): SPartyEntry[] {
  return lastParty;
}

export function getLastInventory(): SInventoryEntry[] {
  return lastInventory;
}

export function getStableUid(): string {
  try {
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `uid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return `uid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function getPlayerName(): string {
  try {
    const n = localStorage.getItem(NAME_KEY);
    if (n && n.trim()) return n.trim().slice(0, 16);
  } catch {
    /* ignore */
  }
  return "Wanderer";
}

export function setPlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.slice(0, 16));
  } catch {
    /* ignore */
  }
}

export function getPlayerSkin(): number {
  try {
    const raw = localStorage.getItem(SKIN_KEY);
    if (raw != null) {
      const n = Number(raw) | 0;
      if (n >= 0 && n < 8) return n;
    }
    const skin = Math.floor(Math.random() * 8);
    localStorage.setItem(SKIN_KEY, String(skin));
    return skin;
  } catch {
    return Math.floor(Math.random() * 8);
  }
}

export async function connect(opts?: {
  name?: string;
  uid?: string;
  skin?: number;
}): Promise<Room<WorldState>> {
  const name = opts?.name ?? getPlayerName();
  const uid = opts?.uid ?? getStableUid();
  const skin = opts?.skin ?? getPlayerSkin();
  if (opts?.name) setPlayerName(name);

  const client = new Client(SERVER_URL);
  room = (await client.joinOrCreate(WORLD_ROOM, { name, uid, skin })) as Room<WorldState>;
  moveSeq = 0;
  lastParty = [];
  lastInventory = [];

  // Capture early server pushes (PARTY is sent in onJoin before scenes mount).
  room.onMessage(SMSG.PARTY, (entries: SPartyEntry[]) => {
    lastParty = entries ?? [];
    for (const h of earlyHandlers) h.onParty?.(lastParty);
  });
  room.onMessage(SMSG.INVENTORY, (entries: SInventoryEntry[]) => {
    lastInventory = entries ?? [];
    for (const h of earlyHandlers) h.onInventory?.(lastInventory);
  });
  room.onMessage(SMSG.TOAST, (msg: SToast) => {
    for (const h of earlyHandlers) h.onToast?.(msg);
  });
  room.onMessage(SMSG.SERVER_FULL, (msg: { message: string }) => {
    for (const h of earlyHandlers) h.onServerFull?.(msg);
  });
  room.onMessage(SMSG.CHAT, (msg: SChatMsg) => {
    for (const h of earlyHandlers) h.onChat?.(msg);
  });
  room.onMessage(SMSG.MOVE_REJECT, (msg: { seq: number; x: number; y: number }) => {
    for (const h of earlyHandlers) h.onMoveReject?.(msg);
  });
  room.onMessage(SMSG.MOVE_ACK, (msg: SMoveAck) => {
    for (const h of earlyHandlers) h.onMoveAck?.(msg);
  });
  room.onMessage(SMSG.WARP, (msg: SWarp) => {
    for (const h of earlyHandlers) h.onWarp?.(msg);
  });
  room.onMessage(SMSG.BATTLE_START, (msg: SBattleStart) => {
    for (const h of earlyHandlers) h.onBattleStart?.(msg);
  });
  room.onMessage(SMSG.BATTLE_UPDATE, (msg: SBattleUpdate) => {
    for (const h of earlyHandlers) h.onBattleUpdate?.(msg);
  });
  room.onMessage(SMSG.BATTLE_END, (msg: SBattleEnd) => {
    for (const h of earlyHandlers) h.onBattleEnd?.(msg);
  });

  return room;
}

export function disconnect(): void {
  if (room) {
    room.leave();
    room = null;
  }
}

/** Send a one-tile move intent; returns the sequence number used. */
export function sendMove(dir: Dir): number {
  const r = getRoom();
  const seq = ++moveSeq;
  const msg: MoveMsg = { dir, seq };
  r.send(MSG.MOVE, msg);
  return seq;
}

export function sendChat(channel: ChatChannel, text: string): void {
  const msg: ChatMsg = { channel, text };
  getRoom().send(MSG.CHAT, msg);
}

export function sendEnterHouse(): void {
  getRoom().send(MSG.ENTER_HOUSE);
}

export function sendExitHouse(): void {
  getRoom().send(MSG.EXIT_HOUSE);
}

export function sendGetInventory(): void {
  getRoom().send(MSG.GET_INVENTORY);
}

export function sendGoHome(): void {
  getRoom().send(MSG.GO_HOME);
}

export function sendBattleAction(action: BattleActionMsg): void {
  getRoom().send(MSG.BATTLE_ACTION, action);
}

/**
 * Subscribe to server→client messages. Handlers are multiplexed through the
 * single onMessage bindings registered in connect(), so scenes can mount late
 * without missing PARTY / early WARP.
 */
export function bindHandlers(handlers: NetHandlers): () => void {
  earlyHandlers.push(handlers);
  // Deliver cached party/inventory immediately if we already have it.
  if (handlers.onParty && lastParty.length) {
    handlers.onParty(lastParty);
  }
  if (handlers.onInventory && lastInventory.length) {
    handlers.onInventory(lastInventory);
  }
  return () => {
    const i = earlyHandlers.indexOf(handlers);
    if (i >= 0) earlyHandlers.splice(i, 1);
  };
}
