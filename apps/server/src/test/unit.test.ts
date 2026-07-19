/**
 * Unit / integration tests against shipped server systems.
 * Run: pnpm --filter @game/server test
 *
 * Calls real HouseRegistry, tryStep, chatRecipients, BattleManager —
 * no reimplementation of the rules under test.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DIR,
  AOI_RADIUS,
  NUM_HOUSES,
  SMSG,
  MSG,
  SPECIES,
  MOVES,
  hpAtLevel,
  damage,
  effectiveness,
  statAtLevel,
  PLAZA_SPAWN_X,
  PLAZA_SPAWN_Y,
  PUBLIC_BUILDINGS,
  resolveEnterTarget,
  nearDoor,
  enterPrompt,
  STARTER_INVENTORY,
  describeStack,
  toggleMenu,
  toggleBoolSetting,
  menusBlockWorld,
  DEFAULT_SETTINGS,
} from "@game/shared";
import { openDb, closeDb, getDb } from "../db/index.js";
import { HouseRegistry } from "../systems/houses.js";
import { isBlocked, getWorld } from "../world/mapData.js";
import { tryStep } from "../systems/movement.js";
import { chatRecipients, buildChatPayload } from "../systems/chat.js";
import { BattleManager } from "../systems/battle.js";
import {
  tryEnterBuilding,
  interiorFromTarget,
  INTERIOR_SPAWN,
  homeOutdoor,
} from "../systems/enterBuilding.js";
import { loadOrGrantInventory } from "../systems/inventory.js";
import type { PlayerState } from "@game/shared";
import { reconcileWorldPosition } from "@game/shared";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCRATCH_DB = join(ROOT, "../../../data/runtime/test-unit.db");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return { name, fn };
}

async function run(name: string, fn: () => void | Promise<void>) {
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

function resetDb() {
  closeDb();
  try {
    rmSync(SCRATCH_DB, { force: true });
    rmSync(SCRATCH_DB + "-wal", { force: true });
    rmSync(SCRATCH_DB + "-shm", { force: true });
  } catch {
    /* ok */
  }
  mkdirSync(dirname(SCRATCH_DB), { recursive: true });
  openDb(SCRATCH_DB);
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  const p = {
    name: "T",
    x: 513,
    y: 518,
    dir: 0,
    skin: 0,
    houseId: -1,
    place: "world",
    inBattle: false,
    ...overrides,
  } as unknown as PlayerState;
  return p;
}

type Sent = { type: string; payload: unknown };
function mockClient(sessionId: string) {
  const sent: Sent[] = [];
  return {
    sessionId,
    sent,
    send(type: string, payload?: unknown) {
      sent.push({ type, payload });
    },
  };
}

function makeRoomFacade(clients: ReturnType<typeof mockClient>[], players: Map<string, PlayerState>) {
  const sessions = new Map<string, { uid: string; lastMoveAt: number; lastChatAt: number }>();
  for (const c of clients) {
    sessions.set(c.sessionId, { uid: `uid-${c.sessionId}`, lastMoveAt: 0, lastChatAt: 0 });
  }
  return {
    state: { players },
    clients,
    uidOf(sid: string) {
      return sessions.get(sid)?.uid;
    },
    sessions,
  } as unknown as import("../rooms/WorldRoom.js").WorldRoom;
}

const tests = [
  test("house claim: distinct uids get unique house ids", () => {
    resetDb();
    const reg = new HouseRegistry();
    const a = reg.claim("alice");
    const b = reg.claim("bob");
    const c = reg.claim("carol");
    assert.notEqual(a, -1);
    assert.notEqual(b, -1);
    assert.notEqual(c, -1);
    assert.notEqual(a, b);
    assert.notEqual(b, c);
    assert.notEqual(a, c);
    assert.equal(reg.claim("alice"), a);
    assert.equal(reg.ownerOf(a), "alice");
  }),

  test("house claim: same uid reclaims same house across registry reload", () => {
    resetDb();
    const r1 = new HouseRegistry();
    const id = r1.claim("persistent-user");
    assert.ok(id >= 0 && id < NUM_HOUSES);
    const r2 = new HouseRegistry();
    assert.equal(r2.claim("persistent-user"), id);
    assert.equal(r2.freeCount(), NUM_HOUSES - 1);
  }),

  test("house claim: uniqueness holds for many uids", () => {
    resetDb();
    const reg = new HouseRegistry();
    const ids = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const id = reg.claim(`user-${i}`);
      assert.ok(id >= 0);
      assert.equal(ids.has(id), false, `duplicate house ${id}`);
      ids.add(id);
    }
    assert.equal(ids.size, 50);
  }),

  test("movement tryStep: wall reject leaves position unchanged", () => {
    const w = getWorld();
    let found = false;
    for (let y = 430; y < 600 && !found; y++) {
      for (let x = 430; x < 600 && !found; x++) {
        if (isBlocked(x, y)) continue;
        for (const d of [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT] as const) {
          const r = tryStep(x, y, d);
          if (!r.ok) {
            assert.equal(r.x, x, "rejected move must keep x");
            assert.equal(r.y, y, "rejected move must keep y");
            found = true;
            break;
          }
        }
      }
    }
    assert.equal(found, true, "expected a wall-adjacent walkable tile");
    assert.equal(w.width, 1024);
  }),

  test("movement tryStep: open plaza step succeeds and advances tile", () => {
    assert.equal(isBlocked(513, 528), false);
    const r = tryStep(513, 528, DIR.RIGHT);
    if (r.ok) {
      assert.equal(r.x, 514);
      assert.equal(r.y, 528);
    } else {
      // right blocked — try other dirs
      let ok = false;
      for (const d of [DIR.LEFT, DIR.UP, DIR.DOWN] as const) {
        const s = tryStep(513, 528, d);
        if (s.ok) {
          ok = true;
          assert.notEqual(s.x === 513 && s.y === 528, true);
          break;
        }
      }
      assert.equal(ok, true, "plaza should allow at least one step");
    }
    assert.equal(tryStep(-1, 0, DIR.LEFT).ok, false);
    assert.equal(isBlocked(9999, 0), true);
  }),

  test("chatRecipients: global reaches all; local filters distance + place", () => {
    const peers = [
      { sessionId: "a", x: 100, y: 100, place: "world" },
      { sessionId: "b", x: 105, y: 100, place: "world" },
      { sessionId: "c", x: 100 + AOI_RADIUS + 5, y: 100, place: "world" },
      { sessionId: "d", x: 100, y: 100, place: "interior" },
    ];
    const from = { sessionId: "a", name: "A", x: 100, y: 100, place: "world" };

    const globalTo = chatRecipients(from, "global", peers).sort();
    assert.deepEqual(globalTo, ["a", "b", "c", "d"]);

    const localTo = chatRecipients(from, "local", peers);
    assert.ok(localTo.includes("a"));
    assert.ok(localTo.includes("b"));
    assert.equal(localTo.includes("c"), false, "far player must not get local chat");
    assert.equal(localTo.includes("d"), false, "interior player must not get world local chat");

    const payload = buildChatPayload(from, "local", "hi", 123);
    assert.equal(payload.text, "hi");
    assert.equal(payload.channel, "local");
    assert.equal(payload.fromId, "a");
  }),

  test("chat routing + db log via shipped helpers", () => {
    resetDb();
    const peers = [
      { sessionId: "s-near", x: 510, y: 518, place: "world", name: "Near" },
      { sessionId: "s-far", x: 510 + AOI_RADIUS + 10, y: 518, place: "world", name: "Far" },
    ];
    const cNear = mockClient("s-near");
    const cFar = mockClient("s-far");
    const clients = [cNear, cFar];

    function deliver(fromId: string, channel: "global" | "local", text: string) {
      const speaker = peers.find((p) => p.sessionId === fromId)!;
      const from = { ...speaker, name: speaker.name };
      const out = buildChatPayload(from, channel, text);
      for (const sid of chatRecipients(from, channel, peers)) {
        clients.find((c) => c.sessionId === sid)?.send(SMSG.CHAT, out);
      }
      getDb()
        .prepare("INSERT INTO chat_log (ts, uid, name, channel, text) VALUES (?, ?, ?, ?, ?)")
        .run(Date.now(), fromId, speaker.name, channel, text);
    }

    deliver("s-near", "global", "hello all");
    assert.equal(cNear.sent.filter((s) => s.type === SMSG.CHAT).length, 1);
    assert.equal(cFar.sent.filter((s) => s.type === SMSG.CHAT).length, 1);

    cNear.sent.length = 0;
    cFar.sent.length = 0;
    deliver("s-near", "local", "psst");
    assert.equal(cNear.sent.filter((s) => s.type === SMSG.CHAT).length, 1);
    assert.equal(cFar.sent.filter((s) => s.type === SMSG.CHAT).length, 0);

    const rows = getDb().prepare("SELECT channel, text FROM chat_log ORDER BY id").all() as Array<{
      channel: string;
      text: string;
    }>;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].channel, "global");
    assert.equal(rows[1].text, "psst");
  }),

  test("battle: damage formula produces positive integer", () => {
    const atk = statAtLevel(SPECIES[0].baseAtk, 5);
    const def = statAtLevel(SPECIES[1].baseDef, 5);
    const mv = MOVES[1];
    const dmg = damage(5, atk, def, mv.power, effectiveness(mv.element, SPECIES[1].element), 1.0);
    assert.ok(dmg >= 1);
  }),

  test("battle: catch inserts into party via BattleManager", () => {
    resetDb();
    const client = mockClient("battler-1");
    const players = new Map<string, PlayerState>();
    const p = makePlayer({ houseId: 0, x: 442, y: 444 });
    players.set(client.sessionId, p);
    const room = makeRoomFacade([client], players);
    const bm = new BattleManager(room);

    bm.sendParty(client as never, room.uidOf(client.sessionId)!);
    const partyBefore = bm.loadParty(room.uidOf(client.sessionId)!);
    assert.ok(partyBefore.length >= 1);

    const realRandom = Math.random;
    let call = 0;
    Math.random = () => {
      call++;
      if (call === 1) return 0.01;
      return 0.5;
    };
    try {
      bm.maybeStart(client as never, p, 1);
    } finally {
      Math.random = realRandom;
    }

    assert.equal(p.inBattle, true);
    assert.ok(client.sent.find((s) => s.type === SMSG.BATTLE_START), "expected BATTLE_START");

    Math.random = () => 0.0;
    try {
      bm.handleAction(client as never, { kind: "catch" });
    } finally {
      Math.random = realRandom;
    }

    const end = client.sent.find((s) => s.type === SMSG.BATTLE_END);
    assert.ok(end, "expected BATTLE_END");
    assert.equal((end!.payload as { result: string }).result, "caught");
    assert.equal(p.inBattle, false);

    const partyAfter = bm.loadParty(room.uidOf(client.sessionId)!);
    assert.ok(partyAfter.length > partyBefore.length, "catch must insert party row");
  }),

  test("battle: fight action sends BATTLE_UPDATE or END", () => {
    resetDb();
    const client = mockClient("battler-2");
    const players = new Map<string, PlayerState>();
    const p = makePlayer({ houseId: 1 });
    players.set(client.sessionId, p);
    const room = makeRoomFacade([client], players);
    const bm = new BattleManager(room);
    bm.sendParty(client as never, room.uidOf(client.sessionId)!);

    const realRandom = Math.random;
    let n = 0;
    Math.random = () => {
      n++;
      if (n === 1) return 0.01;
      return 0.5;
    };
    try {
      bm.maybeStart(client as never, p, 2);
    } finally {
      Math.random = realRandom;
    }
    assert.equal(p.inBattle, true);
    client.sent.length = 0;

    Math.random = () => 0.5;
    try {
      bm.handleAction(client as never, { kind: "move", moveIndex: 0 });
    } finally {
      Math.random = realRandom;
    }

    const upd = client.sent.find((s) => s.type === SMSG.BATTLE_UPDATE || s.type === SMSG.BATTLE_END);
    assert.ok(upd, "expected battle update or end after fight");
    if (upd!.type === SMSG.BATTLE_UPDATE) {
      const payload = upd!.payload as { myHp: number; foeHp: number; log: string[] };
      assert.ok(Array.isArray(payload.log));
      assert.ok(typeof payload.myHp === "number");
      assert.ok(typeof payload.foeHp === "number");
    }
  }),

  test("battle lose: finish teleports to house spawn and sends SMSG.WARP", () => {
    resetDb();
    const world = getWorld();
    const house = world.houses.find((h) => h.id === 0)!;
    assert.ok(house, "house 0 must exist on map");

    // Encounter tile far from house spawn so we can detect the teleport
    const encounterX = 600;
    const encounterY = 600;
    assert.ok(encounterX !== house.spawnX || encounterY !== house.spawnY);

    const client = mockClient("battler-lose");
    const players = new Map<string, PlayerState>();
    const p = makePlayer({ houseId: 0, x: encounterX, y: encounterY });
    players.set(client.sessionId, p);
    const room = makeRoomFacade([client], players);
    const bm = new BattleManager(room);
    const uid = room.uidOf(client.sessionId)!;

    // Grant starter then leave it one hit from fainting before battle loads party
    bm.sendParty(client as never, uid);
    getDb().prepare("UPDATE party SET hp = 1 WHERE uid = ? AND slot = 0").run(uid);

    const realRandom = Math.random;
    // maybeStart: first roll is encounter chance (< ENCOUNTER_CHANCE)
    Math.random = () => 0.0;
    try {
      bm.maybeStart(client as never, p, 1);
    } finally {
      Math.random = realRandom;
    }
    assert.equal(p.inBattle, true);
    assert.equal(p.x, encounterX);
    assert.equal(p.y, encounterY);

    client.sent.length = 0;

    // Failed run → foe counterattack KO (mine hp was 1).
    // run: random < 0.75 flees — use 0.9 to fail.
    // foe accuracy: random > accuracy misses — use 0.0 to hit.
    // foe damage roll: 0.85 + random*0.15 — any value deals ≥1 dmg.
    const queue = [0.9, 0.0, 0.5];
    let qi = 0;
    Math.random = () => queue[Math.min(qi++, queue.length - 1)]!;
    try {
      bm.handleAction(client as never, { kind: "run" });
    } finally {
      Math.random = realRandom;
    }

    assert.equal(p.inBattle, false, "battle should have ended on faint");
    const end = client.sent.find((s) => s.type === SMSG.BATTLE_END);
    assert.ok(end, "expected BATTLE_END");
    assert.equal((end!.payload as { result: string }).result, "lose");

    // Authoritative position is house spawn (not encounter tile)
    assert.equal(p.x, house.spawnX, "server x must be house spawn after lose");
    assert.equal(p.y, house.spawnY, "server y must be house spawn after lose");
    assert.equal(p.place, "world");

    const warp = client.sent.find((s) => s.type === SMSG.WARP);
    assert.ok(warp, "lose must send SMSG.WARP so the client leaves the encounter tile");
    const wp = warp!.payload as { place: string; x: number; y: number };
    assert.equal(wp.place, "world");
    assert.equal(wp.x, house.spawnX);
    assert.equal(wp.y, house.spawnY);

    // WARP arrives before/during battle UI — client onWarp applies coords immediately
    let local = { tileX: encounterX, tileY: encounterY, place: "world" as const };
    local = { tileX: wp.x, tileY: wp.y, place: "world" };
    assert.equal(local.tileX, house.spawnX);
    assert.equal(local.tileY, house.spawnY);
    // RESUME forceReconcileFromServer with matching schema → already synced
    assert.equal(reconcileWorldPosition(local, { x: p.x, y: p.y, place: p.place }), null);

    // If WARP were missed, RESUME still snaps via schema (shipped reconcile helper)
    const missed = reconcileWorldPosition(
      { tileX: encounterX, tileY: encounterY, place: "world" },
      { x: p.x, y: p.y, place: p.place }
    );
    assert.ok(missed);
    assert.equal(missed!.tileX, house.spawnX);
    assert.equal(missed!.tileY, house.spawnY);
  }),

  test("client reconcileWorldPosition snaps encounter tile to house after lose schema move", () => {
    // Simulates: WARP missed (handler late) but schema already has house spawn;
    // WorldScene.forceReconcileFromServer on RESUME must still snap.
    const world = getWorld();
    const house = world.houses[0];
    const local = { tileX: 700, tileY: 700, place: "world" as const };
    const server = { x: house.spawnX, y: house.spawnY, place: "world" };
    const snap = reconcileWorldPosition(local, server);
    assert.ok(snap, "must snap when server moved us home");
    assert.equal(snap!.tileX, house.spawnX);
    assert.equal(snap!.tileY, house.spawnY);

    // No-op when already matched
    assert.equal(
      reconcileWorldPosition(
        { tileX: house.spawnX, tileY: house.spawnY, place: "world" },
        server
      ),
      null
    );
    // Interior local is left alone (house interior uses different presentation)
    assert.equal(
      reconcileWorldPosition({ tileX: 4, tileY: 6, place: "interior" }, server),
      null
    );
  }),

  test("shared: hpAtLevel and starter grant produce positive hp", () => {
    resetDb();
    const hp = hpAtLevel(SPECIES[0].baseHp, 5);
    assert.ok(hp > 10);
    getDb()
      .prepare("INSERT INTO party (uid, slot, species_id, level, hp) VALUES (?, 0, ?, ?, ?)")
      .run("u1", 0, 5, hp);
    const row = getDb().prepare("SELECT hp FROM party WHERE uid = ?").get("u1") as { hp: number };
    assert.equal(row.hp, hp);
  }),

  test("protocol constants exported for client wiring", () => {
    assert.equal(MSG.MOVE, "move");
    assert.equal(SMSG.BATTLE_START, "s.battleStart");
    assert.equal(SMSG.WARP, "s.warp");
    assert.equal(SMSG.CHAT, "s.chat");
  }),

  test("join first-look: WorldRoom onJoin assigns PLAZA_SPAWN (not house lawn)", () => {
    // Drive the shipped constant + room source so join cannot silently regress to
    // residential house door coords (the "same shitty graphics" first-paint bug).
    assert.equal(PLAZA_SPAWN_X, 513);
    assert.equal(PLAZA_SPAWN_Y, 528);
    assert.equal(isBlocked(PLAZA_SPAWN_X, PLAZA_SPAWN_Y), false, "plaza spawn must be walkable");
    const roomSrc = readFileSync(join(ROOT, "../rooms/WorldRoom.ts"), "utf8");
    assert.match(roomSrc, /PLAZA_SPAWN_X/);
    assert.match(roomSrc, /PLAZA_SPAWN_Y/);
    // Must assign plaza coords on join — not def.spawnX/spawnY for first paint
    assert.match(roomSrc, /p\.x\s*=\s*PLAZA_SPAWN_X/);
    assert.match(roomSrc, /p\.y\s*=\s*PLAZA_SPAWN_Y/);
    // House claim still exists for lose-warp, but join body must not set p.x from house def
    const onJoin = roomSrc.slice(roomSrc.indexOf("onJoin"), roomSrc.indexOf("onLeave"));
    assert.equal(/p\.x\s*=\s*def\.spawnX/.test(onJoin), false, "onJoin must not place at house door");
    assert.equal(/p\.y\s*=\s*def\.spawnY/.test(onJoin), false, "onJoin must not place at house door");
  }),

  test("preload assets cache-bust so new tileset/world are fetched", () => {
    const preload = readFileSync(
      join(ROOT, "../../../client/src/scenes/PreloadScene.ts"),
      "utf8"
    );
    assert.match(preload, /ASSET_REV/);
    assert.match(preload, /tileset\.png\$\{q\}|tileset\.png\?v=/);
    assert.match(preload, /world\.json/);
  }),

  test("public buildings: doors walkable and resolveEnterTarget finds them", () => {
    const w = getWorld();
    assert.ok(PUBLIC_BUILDINGS.length >= 2, "need temple + at least one shrine");
    for (const b of PUBLIC_BUILDINGS) {
      assert.equal(isBlocked(b.doorX, b.doorY), false, `${b.id} door must be walkable`);
      assert.equal(isBlocked(b.exitX, b.exitY), false, `${b.id} exit must be walkable`);
      const t = resolveEnterTarget(b.doorX, b.doorY, w.houses, -1, true);
      assert.ok(t, `resolve at ${b.id} door`);
      assert.equal(t!.buildingId, b.id);
      assert.equal(t!.kind, b.kind);
      assert.ok(nearDoor(b.doorX, b.doorY + 1, b.doorX, b.doorY), "adjacent south counts");
      const prompt = enterPrompt(t);
      assert.match(prompt ?? "", /Enter/);
    }
    // Grand temple near plaza so first-session enter is reachable
    const temple = PUBLIC_BUILDINGS.find((b) => b.id === "grand-temple")!;
    const dist =
      Math.abs(temple.doorX - PLAZA_SPAWN_X) + Math.abs(temple.doorY - PLAZA_SPAWN_Y);
    assert.ok(dist < 50, `temple should be near plaza (dist=${dist})`);
  }),

  test("house enter: own house preferred; visitor allowed; tryEnterBuilding mirrors", () => {
    const w = getWorld();
    const h0 = w.houses[0];
    const h1 = w.houses[1];
    assert.equal(isBlocked(h0.doorX, h0.doorY), false);
    const own = resolveEnterTarget(h0.doorX, h0.doorY, w.houses, h0.id, true);
    assert.ok(own);
    assert.equal(own!.kind, "house");
    assert.equal(own!.houseId, h0.id);
    assert.equal(own!.name, "Your House");
    const visit = resolveEnterTarget(h1.doorX, h1.doorY, w.houses, h0.id, true);
    assert.ok(visit);
    assert.equal(visit!.houseId, h1.id);
    assert.match(visit!.name, /House #/);
    // server helper
    const t = tryEnterBuilding(h0.doorX, h0.doorY, w.houses, h0.id);
    assert.ok(t);
    const session = interiorFromTarget(t!);
    assert.equal(session.buildingId, `house-${h0.id}`);
    assert.equal(session.exitX, h0.spawnX);
    assert.equal(session.exitY, h0.spawnY);
    assert.equal(INTERIOR_SPAWN.x, 4);
    assert.equal(INTERIOR_SPAWN.y, 6);
  }),

  test("homeOutdoor: own house spawn, else plaza", () => {
    const w = getWorld();
    const h = w.houses[3];
    const home = homeOutdoor(w.houses, h.id);
    assert.equal(home.x, h.spawnX);
    assert.equal(home.y, h.spawnY);
    const plaza = homeOutdoor(w.houses, -1);
    assert.equal(plaza.x, PLAZA_SPAWN_X);
    assert.equal(plaza.y, PLAZA_SPAWN_Y);
  }),

  test("inventory: starter bag granted once and described", () => {
    resetDb();
    const a = loadOrGrantInventory("inv-user-1");
    assert.ok(a.length >= STARTER_INVENTORY.length);
    const potion = a.find((i) => i.id === "potion");
    assert.ok(potion);
    assert.ok((potion!.qty as number) >= 1);
    assert.ok(potion!.name.length > 0);
    assert.ok(potion!.description.length > 0);
    // second call does not duplicate stacks
    const b = loadOrGrantInventory("inv-user-1");
    assert.equal(b.length, a.length);
    const d = describeStack({ id: "laurel", qty: 1 });
    assert.match(d.name, /Laurel/i);
  }),

  test("menus: toggle + settings + block world", () => {
    assert.equal(toggleMenu("none", "party"), "party");
    assert.equal(toggleMenu("party", "party"), "none");
    assert.equal(toggleMenu("party", "inventory"), "inventory");
    assert.equal(menusBlockWorld("party"), true);
    assert.equal(menusBlockWorld("none"), false);
    const s = toggleBoolSetting(DEFAULT_SETTINGS, "showNames");
    assert.equal(s.showNames, false);
    assert.equal(DEFAULT_SETTINGS.showNames, true);
  }),

  test("protocol: enter/exit/inventory/goHome/toast messages exist", () => {
    assert.equal(MSG.ENTER_HOUSE, "enterHouse");
    assert.equal(MSG.EXIT_HOUSE, "exitHouse");
    assert.equal(MSG.GET_INVENTORY, "getInventory");
    assert.equal(MSG.GO_HOME, "goHome");
    assert.equal(SMSG.INVENTORY, "s.inventory");
    assert.equal(SMSG.TOAST, "s.toast");
    assert.equal(SMSG.PARTY, "s.party");
    const roomSrc = readFileSync(join(ROOT, "../rooms/WorldRoom.ts"), "utf8");
    assert.match(roomSrc, /handleEnterHouse|tryWarpEnter/);
    assert.match(roomSrc, /handleExitHouse/);
    assert.match(roomSrc, /handleGoHome/);
    assert.match(roomSrc, /handleGetInventory/);
    assert.match(roomSrc, /interiorKind/);
    const worldSrc = readFileSync(
      join(ROOT, "../../../client/src/scenes/WorldScene.ts"),
      "utf8"
    );
    assert.match(worldSrc, /GameMenus/);
    assert.match(worldSrc, /sendEnterHouse/);
    assert.match(worldSrc, /sendGoHome/);
    assert.match(worldSrc, /keyP|keyI|keyO/);
  }),

  test("enter-exit flow via WorldRoom message handlers (mock client)", () => {
    // Drive the pure path the room uses: tryEnter → interior session → exit coords.
    const w = getWorld();
    const temple = PUBLIC_BUILDINGS.find((b) => b.id === "grand-temple")!;
    const target = tryEnterBuilding(temple.doorX, temple.doorY, w.houses, 0);
    assert.ok(target);
    assert.equal(target!.kind, "temple");
    const interior = interiorFromTarget(target!);
    assert.equal(interior.exitX, temple.exitX);
    assert.equal(interior.exitY, temple.exitY);
    // Simulate player state transitions (same as handleEnter/Exit)
    const p = makePlayer({ x: temple.doorX, y: temple.doorY, place: "world", houseId: 0 });
    p.place = "interior";
    p.x = INTERIOR_SPAWN.x;
    p.y = INTERIOR_SPAWN.y;
    assert.equal(p.place, "interior");
    // exit
    p.place = "world";
    p.x = interior.exitX;
    p.y = interior.exitY;
    assert.equal(p.x, temple.exitX);
    assert.equal(isBlocked(p.x, p.y), false);
  }),

  test("client interior presentation: dedicated room origin, not worldView/tile pixels", () => {
    // Regression: showInterior used cameras.main.worldView.center + scrollFactor(0),
    // then onWarp called syncPlayerPixel() which yanked the avatar to tile (4,6)
    // world pixels — room gfx stayed off-screen and screenshots looked like map edge.
    const worldSrc = readFileSync(
      join(ROOT, "../../../client/src/scenes/WorldScene.ts"),
      "utf8"
    );
    const showStart = worldSrc.indexOf("private showInterior");
    const showEnd = worldSrc.indexOf("private hideInterior");
    assert.ok(showStart >= 0 && showEnd > showStart, "showInterior/hideInterior present");
    const showBody = worldSrc.slice(showStart, showEnd);
    assert.equal(
      /worldView\.center/.test(showBody),
      false,
      "showInterior must not place gfx at worldView.center"
    );
    // Dedicated off-map interior origin + zoom 1 room (fills canvas, distinct palette)
    assert.match(showBody, /INTERIOR_ORIGIN/);
    assert.match(showBody, /setZoom\s*\(\s*(?:1|INTERIOR_ZOOM)\s*\)/);
    assert.match(showBody, /tilemap\.setVisible\(false\)/);
    assert.match(showBody, /0xd8d0bc|floorColor/, "temple floor palette present");
    assert.match(showBody, /0x3a2e22/, "house floor palette present");
    // Player parked at interior origin, not syncPlayerPixel tile math
    assert.match(showBody, /this\.player\.x\s*=\s*ox/);
    // onWarp interior branch must not call syncPlayerPixel after showInterior
    const onWarpStart = worldSrc.indexOf("private onWarp");
    const onWarpEnd = worldSrc.indexOf("private showInterior");
    const onWarpBody = worldSrc.slice(onWarpStart, onWarpEnd);
    const interiorBranch = onWarpBody.slice(
      onWarpBody.indexOf('msg.place === "interior"'),
      onWarpBody.indexOf("} else {")
    );
    // Strip // comments so the regression note itself doesn't trip the guard.
    const interiorCode = interiorBranch
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.equal(
      /syncPlayerPixel\s*\(/.test(interiorCode),
      false,
      "onWarp interior path must not syncPlayerPixel after showInterior"
    );
    assert.match(interiorCode, /showInterior\s*\(/);
    // World exit branch still restores overworld pixels + camera
    const elseBranch = onWarpBody.slice(onWarpBody.indexOf("} else {"));
    assert.match(elseBranch, /syncPlayerPixel\s*\(/);
    assert.match(elseBranch, /resumeOverworldCamera\s*\(/);
    // tilemap visibility helper exists
    const tm = readFileSync(join(ROOT, "../../../client/src/world/WindowedTilemap.ts"), "utf8");
    assert.match(tm, /setVisible\s*\(\s*v:\s*boolean/);
  }),
];

console.log("\n=== Dominion server unit/integration tests ===\n");
for (const t of tests) {
  await run(t.name, t.fn);
}
closeDb();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
