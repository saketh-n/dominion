import { Client } from "@colyseus/core";
import {
  PlayerState,
  SMSG,
  BattleActionMsg,
  SPECIES,
  MOVES,
  ENCOUNTER_CHANCE,
  effectiveness,
  statAtLevel,
  hpAtLevel,
  damage,
  SPartyEntry,
  PLAZA_SPAWN_X,
  PLAZA_SPAWN_Y,
} from "@game/shared";
import { getDb } from "../db/index.js";
import type { WorldRoom } from "../rooms/WorldRoom.js";

interface Combatant {
  speciesId: number;
  level: number;
  hp: number;
  maxHp: number;
}

interface BattleSession {
  sessionId: string;
  uid: string;
  foe: Combatant;
  mine: Combatant;
  mineSlot: number;
  lastActionAt: number;
}

const HABITATS = ["", "field", "forest", "coast", "mountain"] as const;
const BATTLE_TIMEOUT_MS = 90_000;

export class BattleManager {
  private battles = new Map<string, BattleSession>();

  constructor(private room: WorldRoom) {}

  // ---- party persistence ----

  loadParty(uid: string): Array<{ slot: number; speciesId: number; level: number; hp: number }> {
    return (
      getDb()
        .prepare("SELECT slot, species_id as speciesId, level, hp FROM party WHERE uid = ? ORDER BY slot")
        .all(uid) as Array<{ slot: number; speciesId: number; level: number; hp: number }>
    );
  }

  private grantStarter(uid: string): void {
    const starterIds = [0, 1, 2]; // Ignifawn, Tidelet, Thornix
    const sid = starterIds[Math.floor(Math.random() * starterIds.length)];
    const level = 5;
    const hp = hpAtLevel(SPECIES[sid].baseHp, level);
    getDb().prepare("INSERT INTO party (uid, slot, species_id, level, hp) VALUES (?, 0, ?, ?, ?)").run(uid, sid, level, hp);
  }

  sendParty(client: Client, uid: string): void {
    let party = this.loadParty(uid);
    if (party.length === 0) {
      this.grantStarter(uid);
      party = this.loadParty(uid);
    }
    const entries: SPartyEntry[] = party.map((row) => ({
      speciesId: row.speciesId,
      level: row.level,
      hp: row.hp,
      maxHp: hpAtLevel(SPECIES[row.speciesId].baseHp, row.level),
    }));
    client.send(SMSG.PARTY, entries);
  }

  // ---- battle flow ----

  maybeStart(client: Client, p: PlayerState, habitat: number): void {
    if (p.inBattle || Math.random() > ENCOUNTER_CHANCE) return;
    const uid = this.room.uidOf(client.sessionId);
    if (!uid) return;

    const habitatName = HABITATS[habitat] ?? "field";
    const pool = SPECIES.filter((s) => s.habitat === habitatName);
    const species = pool.length ? pool[Math.floor(Math.random() * pool.length)] : SPECIES[0];
    const level = 2 + Math.floor(Math.random() * 5); // 2..6

    const party = this.loadParty(uid);
    const alive = party.find((row) => row.hp > 0);
    if (!alive) return; // whole party fainted — no battles until healed (win/lose heals)

    const foe: Combatant = {
      speciesId: species.id,
      level,
      hp: hpAtLevel(species.baseHp, level),
      maxHp: hpAtLevel(species.baseHp, level),
    };
    const mine: Combatant = {
      speciesId: alive.speciesId,
      level: alive.level,
      hp: alive.hp,
      maxHp: hpAtLevel(SPECIES[alive.speciesId].baseHp, alive.level),
    };

    p.inBattle = true;
    this.battles.set(client.sessionId, {
      sessionId: client.sessionId,
      uid,
      foe,
      mine,
      mineSlot: alive.slot,
      lastActionAt: Date.now(),
    });
    client.send(SMSG.BATTLE_START, {
      speciesId: foe.speciesId,
      level: foe.level,
      hp: foe.hp,
      maxHp: foe.maxHp,
      mine: {
        speciesId: mine.speciesId,
        level: mine.level,
        hp: mine.hp,
        maxHp: mine.maxHp,
        moves: SPECIES[mine.speciesId].moves,
      },
    });
  }

  handleAction(client: Client, msg: BattleActionMsg): void {
    const b = this.battles.get(client.sessionId);
    const p = this.room.state.players.get(client.sessionId);
    if (!b || !p) return;
    b.lastActionAt = Date.now();
    const log: string[] = [];

    const mineSpec = SPECIES[b.mine.speciesId];
    const foeSpec = SPECIES[b.foe.speciesId];

    const foeAttack = () => {
      const moveId = foeSpec.moves[Math.floor(Math.random() * foeSpec.moves.length)];
      const mv = MOVES[moveId];
      if (Math.random() > mv.accuracy) {
        log.push(`Wild ${foeSpec.name}'s ${mv.name} missed!`);
        return;
      }
      const dmg = damage(
        b.foe.level,
        statAtLevel(foeSpec.baseAtk, b.foe.level),
        statAtLevel(mineSpec.baseDef, b.mine.level),
        mv.power,
        effectiveness(mv.element, mineSpec.element),
        0.85 + Math.random() * 0.15
      );
      b.mine.hp = Math.max(0, b.mine.hp - dmg);
      const eff = effectiveness(mv.element, mineSpec.element);
      log.push(
        `Wild ${foeSpec.name} used ${mv.name}! ${eff > 1 ? "It's super effective! " : eff < 1 ? "Not very effective… " : ""}(-${dmg})`
      );
    };

    const myAttack = (moveIndex: number): boolean => {
      const moveId = mineSpec.moves[moveIndex] ?? mineSpec.moves[0];
      const mv = MOVES[moveId];
      if (Math.random() > mv.accuracy) {
        log.push(`${mineSpec.name}'s ${mv.name} missed!`);
        return false;
      }
      const dmg = damage(
        b.mine.level,
        statAtLevel(mineSpec.baseAtk, b.mine.level),
        statAtLevel(foeSpec.baseDef, b.foe.level),
        mv.power,
        effectiveness(mv.element, foeSpec.element),
        0.85 + Math.random() * 0.15
      );
      b.foe.hp = Math.max(0, b.foe.hp - dmg);
      const eff = effectiveness(mv.element, foeSpec.element);
      log.push(
        `${mineSpec.name} used ${mv.name}! ${eff > 1 ? "It's super effective! " : eff < 1 ? "Not very effective… " : ""}(-${dmg})`
      );
      return true;
    };

    if (msg?.kind === "run") {
      if (Math.random() < 0.75) {
        log.push("Got away safely!");
        this.finish(client, b, p, "fled", log);
        return;
      }
      log.push("Couldn't escape!");
      foeAttack();
    } else if (msg?.kind === "catch") {
      const partyCount = this.loadParty(b.uid).length;
      if (partyCount >= 6) {
        log.push("Your party is full!");
        foeAttack();
      } else {
        const hpFactor = 1 - (b.foe.hp / b.foe.maxHp) * 0.7;
        const chance = foeSpec.catchRate * (0.6 + hpFactor);
        if (Math.random() < chance) {
          log.push(`Gotcha! ${foeSpec.name} was bound in a Soul Laurel!`);
          getDb()
            .prepare("INSERT INTO party (uid, slot, species_id, level, hp) VALUES (?, ?, ?, ?, ?)")
            .run(b.uid, partyCount, b.foe.speciesId, b.foe.level, b.foe.hp);
          this.finish(client, b, p, "caught", log);
          return;
        }
        log.push(`${foeSpec.name} broke free!`);
        foeAttack();
      }
    } else if (msg?.kind === "move") {
      const idx = Math.min(mineSpec.moves.length - 1, Math.max(0, Number(msg.moveIndex) | 0));
      // speed decides order
      const mineFirst =
        statAtLevel(mineSpec.baseSpd, b.mine.level) >= statAtLevel(foeSpec.baseSpd, b.foe.level);
      if (mineFirst) {
        myAttack(idx);
        if (b.foe.hp > 0) foeAttack();
      } else {
        foeAttack();
        if (b.mine.hp > 0) myAttack(idx);
      }
    } else {
      return;
    }

    // outcomes
    if (b.foe.hp <= 0) {
      const newLevel = Math.min(50, b.mine.level + 1);
      log.push(`Wild ${foeSpec.name} fainted! ${mineSpec.name} grew to Lv.${newLevel}!`);
      const healed = hpAtLevel(mineSpec.baseHp, newLevel);
      getDb()
        .prepare("UPDATE party SET level = ?, hp = ? WHERE uid = ? AND slot = ?")
        .run(newLevel, healed, b.uid, b.mineSlot);
      this.finish(client, b, p, "win", log);
      return;
    }
    if (b.mine.hp <= 0) {
      log.push(`${mineSpec.name} fainted! You retreat home to recover…`);
      // heal whole party, send the player home
      const rows = this.loadParty(b.uid);
      for (const row of rows) {
        getDb()
          .prepare("UPDATE party SET hp = ? WHERE uid = ? AND slot = ?")
          .run(hpAtLevel(SPECIES[row.speciesId].baseHp, row.level), b.uid, row.slot);
      }
      this.finish(client, b, p, "lose", log);
      return;
    }

    // persist my hp and continue
    getDb().prepare("UPDATE party SET hp = ? WHERE uid = ? AND slot = ?").run(b.mine.hp, b.uid, b.mineSlot);
    client.send(SMSG.BATTLE_UPDATE, { log, myHp: b.mine.hp, foeHp: b.foe.hp });
  }

  private finish(
    client: Client,
    b: BattleSession,
    p: PlayerState,
    result: "win" | "lose" | "caught" | "fled",
    log: string[]
  ): void {
    this.battles.delete(b.sessionId);
    p.inBattle = false;
    if (result === "lose") {
      // Teleport home and tell the client immediately (schema alone is easy to miss
      // while the battle overlay is up / WorldScene is paused).
      const def = getWorldHouse(this.room, p.houseId);
      if (def) {
        p.x = def.spawnX;
        p.y = def.spawnY;
      } else {
        p.x = PLAZA_SPAWN_X;
        p.y = PLAZA_SPAWN_Y;
      }
      p.place = "world";
      p.dir = 0;
      client.send(SMSG.WARP, { place: "world", x: p.x, y: p.y });
    } else {
      getDb().prepare("UPDATE party SET hp = ? WHERE uid = ? AND slot = ?").run(b.mine.hp, b.uid, b.mineSlot);
    }
    client.send(SMSG.BATTLE_END, { result, log });
    this.sendParty(client, b.uid);
  }

  endFor(sessionId: string): void {
    this.battles.delete(sessionId);
  }

  tick(): void {
    const now = Date.now();
    for (const [sid, b] of this.battles) {
      if (now - b.lastActionAt > BATTLE_TIMEOUT_MS) {
        const p = this.room.state.players.get(sid);
        const client = this.room.clients.find((c) => c.sessionId === sid);
        if (p && client) {
          this.finish(client, b, p, "fled", ["The wild creature wandered off."]);
        } else {
          this.battles.delete(sid);
        }
      }
    }
  }
}

import { getWorld } from "../world/mapData.js";
function getWorldHouse(room: WorldRoom, houseId: number) {
  return getWorld().houses.find((h) => h.id === houseId);
}
