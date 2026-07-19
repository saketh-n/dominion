/** Starter bag + inventory item ids (shared client/server). */

export interface InventoryItemDef {
  id: string;
  name: string;
  description: string;
}

export const ITEM_DEFS: Record<string, InventoryItemDef> = {
  potion: {
    id: "potion",
    name: "Potion",
    description: "Restores a little HP to a party member.",
  },
  antidote: {
    id: "antidote",
    name: "Antidote",
    description: "Cures poison (flavor item for now).",
  },
  escape_rope: {
    id: "escape_rope",
    name: "Escape Rope",
    description: "Warp out of a cave — or home from the plaza.",
  },
  map_fragment: {
    id: "map_fragment",
    name: "Map Fragment",
    description: "A scrap of the capital's processional plan.",
  },
  laurel: {
    id: "laurel",
    name: "Laurel Crown",
    description: "Ceremonial greenery from the temple gardens.",
  },
};

export interface InventoryStack {
  id: string;
  qty: number;
}

/** Default bag granted on first join. */
export const STARTER_INVENTORY: readonly InventoryStack[] = [
  { id: "potion", qty: 5 },
  { id: "antidote", qty: 2 },
  { id: "escape_rope", qty: 1 },
  { id: "map_fragment", qty: 1 },
  { id: "laurel", qty: 1 },
];

export function describeStack(stack: InventoryStack): { name: string; description: string; qty: number } {
  const def = ITEM_DEFS[stack.id];
  return {
    name: def?.name ?? stack.id,
    description: def?.description ?? "",
    qty: stack.qty,
  };
}
