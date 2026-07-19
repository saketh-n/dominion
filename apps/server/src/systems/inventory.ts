import {
  STARTER_INVENTORY,
  describeStack,
  type SInventoryEntry,
} from "@game/shared";
import { getDb } from "../db/index.js";

/** Ensure starter bag rows exist for uid; return full inventory snapshot. */
export function loadOrGrantInventory(uid: string): SInventoryEntry[] {
  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE uid = ?").get(uid) as { n: number }
  ).n;
  if (count === 0) {
    const ins = db.prepare(
      "INSERT INTO inventory (uid, item_id, qty) VALUES (?, ?, ?)"
    );
    const tx = db.transaction(() => {
      for (const s of STARTER_INVENTORY) {
        ins.run(uid, s.id, s.qty);
      }
    });
    tx();
  }
  const rows = db
    .prepare("SELECT item_id, qty FROM inventory WHERE uid = ? ORDER BY item_id")
    .all(uid) as Array<{ item_id: string; qty: number }>;
  return rows.map((r) => {
    const d = describeStack({ id: r.item_id, qty: r.qty });
    return { id: r.item_id, name: d.name, description: d.description, qty: d.qty };
  });
}
