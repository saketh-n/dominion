/** Message protocol between client and server (over the Colyseus room). */

export type ChatChannel = "global" | "local";

// ---- client -> server ----
export const MSG = {
  /** Move intent: step one tile in a direction. */
  MOVE: "move",
  /** Chat message. */
  CHAT: "chat",
  /** Enter building at current tile (house door / public temple / shrine). */
  ENTER_HOUSE: "enterHouse",
  /** Leave interior back to the world. */
  EXIT_HOUSE: "exitHouse",
  /** Battle action. */
  BATTLE_ACTION: "battleAction",
  /** Request inventory snapshot. */
  GET_INVENTORY: "getInventory",
  /** Warp to own house door outdoors (home beacon). */
  GO_HOME: "goHome",
} as const;

export type Dir = 0 | 1 | 2 | 3; // down, up, left, right
export const DIR = { DOWN: 0, UP: 1, LEFT: 2, RIGHT: 3 } as const;
export const DIR_DX = [0, 0, -1, 1] as const;
export const DIR_DY = [1, -1, 0, 0] as const;

export interface MoveMsg {
  dir: Dir;
  /** client sequence number for reconciliation */
  seq: number;
}

export interface ChatMsg {
  channel: ChatChannel;
  text: string;
}

export type BattleActionMsg =
  | { kind: "move"; moveIndex: number }
  | { kind: "catch" }
  | { kind: "run" };

// ---- server -> client ----
export const SMSG = {
  CHAT: "s.chat",
  MOVE_ACK: "s.moveAck",
  MOVE_REJECT: "s.moveReject",
  WARP: "s.warp",
  BATTLE_START: "s.battleStart",
  BATTLE_UPDATE: "s.battleUpdate",
  BATTLE_END: "s.battleEnd",
  SERVER_FULL: "s.serverFull",
  PARTY: "s.party",
  INVENTORY: "s.inventory",
  /** Soft feedback (can't enter, etc.) */
  TOAST: "s.toast",
} as const;

export interface SChatMsg {
  channel: ChatChannel;
  from: string;
  fromId: string;
  text: string;
  ts: number;
}

export interface SMoveAck {
  seq: number;
  x: number;
  y: number;
}

export interface SWarp {
  /** "interior" = inside a building; "world" = overworld */
  place: "interior" | "world";
  x: number;
  y: number;
  /** Interior presentation hint */
  interiorKind?: "house" | "temple" | "shrine";
  interiorName?: string;
  buildingId?: string;
}

export interface SInventoryEntry {
  id: string;
  name: string;
  description: string;
  qty: number;
}

export interface SToast {
  message: string;
}

export interface SBattleStart {
  speciesId: number;
  level: number;
  hp: number;
  maxHp: number;
  /** player's active creature */
  mine: { speciesId: number; level: number; hp: number; maxHp: number; moves: number[] };
}

export interface SBattleUpdate {
  log: string[];
  myHp: number;
  foeHp: number;
}

export interface SBattleEnd {
  result: "win" | "lose" | "caught" | "fled";
  log: string[];
}

export interface SPartyEntry {
  speciesId: number;
  level: number;
  hp: number;
  maxHp: number;
}
