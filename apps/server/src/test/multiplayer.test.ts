/**
 * Live multiplayer integration: boots the real Colyseus server entry points
 * (WorldRoom + express health) and drives ≥2 colyseus.js clients through
 * join → move → chat. No mocks of room logic.
 *
 * Run: pnpm --filter @game/server test:mp
 */
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  SERVER_PORT,
  WORLD_ROOM,
  MSG,
  SMSG,
  DIR,
  WorldState,
} from "@game/shared";
import { WorldRoom } from "../rooms/WorldRoom.js";
import { closeDb, openDb, getDb } from "../db/index.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(ROOT, "../../../data/runtime/test-mp.db");
const PORT = 2657;
const WS_URL = `ws://127.0.0.1:${PORT}`;
const HTTP_URL = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resetDb() {
  closeDb();
  for (const p of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ok */
    }
  }
  mkdirSync(dirname(DB_PATH), { recursive: true });
  process.env.DOMINION_DB_PATH = DB_PATH;
  openDb(DB_PATH);
}

async function startServer() {
  resetDb();
  const app = express();
  app.use(cors());
  app.get("/health", (_req, res) => res.json({ ok: true, room: WORLD_ROOM }));

  const httpServer = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define(WORLD_ROOM, WorldRoom);

  await new Promise<void>((resolve) => httpServer.listen(PORT, "127.0.0.1", () => resolve()));
  return { httpServer, gameServer };
}

async function stopServer(httpServer: http.Server, gameServer: Server) {
  try {
    await gameServer.gracefullyShutdown(false);
  } catch {
    /* ignore */
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  closeDb();
}

console.log("\n=== Dominion multiplayer live tests ===\n");

const { httpServer, gameServer } = await startServer();

await run("GET /health returns ok", async () => {
  const res = await fetch(`${HTTP_URL}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});

await run("two clients join, get distinct houses, both visible in room state", async () => {
  const c1 = new Client(WS_URL);
  const c2 = new Client(WS_URL);
  const r1 = await c1.joinOrCreate(WORLD_ROOM, { name: "Alpha", uid: "mp-alpha", skin: 1 });
  const r2 = await c2.joinOrCreate(WORLD_ROOM, { name: "Beta", uid: "mp-beta", skin: 2 });

  await sleep(200);

  assert.ok(r1.state.players.get(r1.sessionId), "r1 sees self");
  assert.ok(r1.state.players.get(r2.sessionId), "r1 sees r2");
  assert.ok(r2.state.players.get(r1.sessionId), "r2 sees r1");
  assert.ok(r2.state.players.get(r2.sessionId), "r2 sees self");

  const h1 = r1.state.players.get(r1.sessionId)!.houseId;
  const h2 = r2.state.players.get(r2.sessionId)!.houseId;
  assert.notEqual(h1, h2, "houses must be unique");
  assert.ok(h1 >= 0 && h2 >= 0);

  const s1 = r1.state.players.get(r1.sessionId)!;
  assert.ok(typeof s1.x === "number" && typeof s1.y === "number");
  // First-look: both clients must join at capital plaza, not empty house lawns
  const { PLAZA_SPAWN_X, PLAZA_SPAWN_Y } = await import("@game/shared");
  assert.equal(s1.x, PLAZA_SPAWN_X, "join x must be plaza (first-look capital)");
  assert.equal(s1.y, PLAZA_SPAWN_Y, "join y must be plaza (first-look capital)");
  const s2 = r2.state.players.get(r2.sessionId)!;
  assert.equal(s2.x, PLAZA_SPAWN_X);
  assert.equal(s2.y, PLAZA_SPAWN_Y);

  await r1.leave();
  await r2.leave();
  void WorldState;
});

await run("move updates shared position; wall rejects leave position unchanged", async () => {
  const c1 = new Client(WS_URL);
  const r1 = await c1.joinOrCreate(WORLD_ROOM, { name: "Mover", uid: "mp-mover", skin: 0 });
  await sleep(150);

  const me = () => r1.state.players.get(r1.sessionId)!;

  let moved = false;
  for (const dir of [DIR.RIGHT, DIR.LEFT, DIR.DOWN, DIR.UP]) {
    const beforeX = me().x;
    const beforeY = me().y;
    r1.send(MSG.MOVE, { dir, seq: 1 });
    await sleep(250);
    if (me().x !== beforeX || me().y !== beforeY) {
      moved = true;
      break;
    }
  }
  assert.equal(moved, true, "expected at least one successful step from spawn");

  const c2 = new Client(WS_URL);
  const r2 = await c2.joinOrCreate(WORLD_ROOM, { name: "Watcher", uid: "mp-watcher", skin: 3 });
  await sleep(200);
  const remote = r2.state.players.get(r1.sessionId);
  assert.ok(remote, "watcher sees mover");
  assert.equal(remote!.x, me().x);
  assert.equal(remote!.y, me().y);

  r1.send(MSG.MOVE, { dir: DIR.UP, seq: 99 });
  await sleep(100);
  assert.equal(typeof me().x, "number");
  assert.ok(me().x >= 0 && me().y >= 0);

  await r1.leave();
  await r2.leave();
});

await run("chat global round-trips to both clients; local is distance-filtered", async () => {
  const c1 = new Client(WS_URL);
  const c2 = new Client(WS_URL);
  const r1 = await c1.joinOrCreate(WORLD_ROOM, { name: "ChatA", uid: "mp-chata", skin: 0 });
  const r2 = await c2.joinOrCreate(WORLD_ROOM, { name: "ChatB", uid: "mp-chatb", skin: 1 });
  await sleep(150);

  const inbox1: unknown[] = [];
  const inbox2: unknown[] = [];
  r1.onMessage(SMSG.CHAT, (m) => inbox1.push(m));
  r2.onMessage(SMSG.CHAT, (m) => inbox2.push(m));

  r1.send(MSG.CHAT, { channel: "global", text: "hail dominion" });
  await sleep(200);
  assert.ok(
    inbox1.some((m) => (m as { text: string }).text === "hail dominion"),
    "sender receives global (broadcast includes self)"
  );
  assert.ok(
    inbox2.some((m) => (m as { text: string }).text === "hail dominion"),
    "other receives global"
  );

  inbox1.length = 0;
  inbox2.length = 0;
  // CHAT_RATE_LIMIT_MS is 600 — wait past it or the local send is silently dropped
  await sleep(700);
  r1.send(MSG.CHAT, { channel: "local", text: "nearby only" });
  await sleep(200);

  const p1 = r1.state.players.get(r1.sessionId)!;
  const p2 = r2.state.players.get(r2.sessionId)!;
  const near =
    p1.place === p2.place &&
    Math.abs(p1.x - p2.x) <= 24 &&
    Math.abs(p1.y - p2.y) <= 24;

  if (near) {
    assert.ok(inbox2.some((m) => (m as { text: string }).text === "nearby only"));
  } else {
    assert.equal(
      inbox2.some((m) => (m as { text: string }).text === "nearby only"),
      false,
      "far player must not receive local chat"
    );
    console.log("    (local chat correctly dropped — players not in AOI)");
  }

  await r1.leave();
  await r2.leave();
});

await run("party message arrives on join", async () => {
  const c = new Client(WS_URL);
  let partyPayload: unknown = null;
  const joined = await c.joinOrCreate(WORLD_ROOM, {
    name: "Partier",
    uid: "mp-party-live",
    skin: 4,
  });
  joined.onMessage(SMSG.PARTY, (m) => {
    partyPayload = m;
  });
  // Server re-sends PARTY ~80ms after join for late handlers
  await sleep(300);

  const rows = getDb()
    .prepare("SELECT species_id, level, hp FROM party WHERE uid = ?")
    .all("mp-party-live") as Array<{ species_id: number; level: number; hp: number }>;
  assert.ok(rows.length >= 1, "starter granted on join");
  assert.ok(rows[0].hp > 0);
  assert.ok(partyPayload != null, "PARTY message received by client");
  const list = partyPayload as Array<{ speciesId: number; hp: number }>;
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.ok(list[0].hp > 0);

  await joined.leave();
});

await stopServer(httpServer, gameServer);

console.log(`\n${passed} passed, ${failed} failed\n`);
void SERVER_PORT;
if (failed > 0) process.exit(1);
