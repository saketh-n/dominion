import { HouseDef, NUM_HOUSES } from "@game/shared";
import { getWorld } from "../world/mapData.js";
import { getDb } from "../db/index.js";

/**
 * House assignment. Persistent ownership: a returning player (identified by a
 * client-generated uid) reclaims their house. Otherwise the lowest free house
 * is claimed. Session-freed only if the owner has no persistent claim.
 */
export class HouseRegistry {
  /** houseId -> uid of current persistent owner */
  private owners = new Map<number, string>();
  /** uid -> houseId */
  private byUid = new Map<string, number>();

  constructor() {
    const rows = getDb()
      .prepare("SELECT house_id, uid FROM house_ownership")
      .all() as Array<{ house_id: number; uid: string }>;
    for (const row of rows) {
      this.owners.set(row.house_id, row.uid);
      this.byUid.set(row.uid, row.house_id);
    }
    console.log(`[houses] ${rows.length} persistent claims loaded`);
  }

  /** claim a house for uid; returns houseId or -1 if all taken */
  claim(uid: string): number {
    const existing = this.byUid.get(uid);
    if (existing !== undefined) return existing;
    for (let id = 0; id < NUM_HOUSES; id++) {
      if (!this.owners.has(id)) {
        this.owners.set(id, uid);
        this.byUid.set(uid, id);
        getDb()
          .prepare("INSERT OR REPLACE INTO house_ownership (house_id, uid) VALUES (?, ?)")
          .run(id, uid);
        return id;
      }
    }
    return -1;
  }

  houseDef(houseId: number): HouseDef | undefined {
    return getWorld().houses.find((h) => h.id === houseId);
  }

  ownerOf(houseId: number): string | undefined {
    return this.owners.get(houseId);
  }

  freeCount(): number {
    return NUM_HOUSES - this.owners.size;
  }
}
