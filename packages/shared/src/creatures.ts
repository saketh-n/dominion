/**
 * Original creature roster ("Daimons") — classical-myth flavored, fully original.
 * No Nintendo IP: original names, stats, designs.
 */

export type Element = "ember" | "tide" | "verdant" | "storm" | "stone" | "spirit";

/** attacker -> defender multiplier (1 = neutral). Simple wheel + extras. */
const EFF: Record<Element, Partial<Record<Element, number>>> = {
  ember: { verdant: 2, stone: 0.5, tide: 0.5 },
  tide: { ember: 2, stone: 2, verdant: 0.5 },
  verdant: { tide: 2, stone: 1, ember: 0.5, storm: 0.5 },
  storm: { tide: 2, verdant: 1, stone: 0.5 },
  stone: { ember: 2, storm: 2, verdant: 0.5 },
  spirit: { spirit: 2 },
};

export function effectiveness(atk: Element, def: Element): number {
  return EFF[atk]?.[def] ?? 1;
}

export interface MoveDef {
  id: number;
  name: string;
  element: Element;
  power: number; // 0 = status-ish (not used in v1)
  accuracy: number; // 0..1
}

export const MOVES: MoveDef[] = [
  { id: 0, name: "Tackle", element: "stone", power: 35, accuracy: 0.98 },
  { id: 1, name: "Cinder Snap", element: "ember", power: 45, accuracy: 0.95 },
  { id: 2, name: "Flame Lash", element: "ember", power: 60, accuracy: 0.9 },
  { id: 3, name: "Ripple Jet", element: "tide", power: 45, accuracy: 0.95 },
  { id: 4, name: "Undertow", element: "tide", power: 60, accuracy: 0.9 },
  { id: 5, name: "Leaf Dart", element: "verdant", power: 45, accuracy: 0.95 },
  { id: 6, name: "Bramble Coil", element: "verdant", power: 60, accuracy: 0.9 },
  { id: 7, name: "Gale Peck", element: "storm", power: 45, accuracy: 0.95 },
  { id: 8, name: "Thunder Dive", element: "storm", power: 65, accuracy: 0.85 },
  { id: 9, name: "Marble Slam", element: "stone", power: 55, accuracy: 0.9 },
  { id: 10, name: "Haunt Wisp", element: "spirit", power: 50, accuracy: 0.95 },
  { id: 11, name: "Quick Jab", element: "stone", power: 30, accuracy: 1.0 },
];

export interface SpeciesDef {
  id: number;
  name: string;
  element: Element;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  baseSpd: number;
  /** 0..1 — chance factor for capture. */
  catchRate: number;
  moves: number[]; // MOVES ids
  /** habitat biome tag used by the encounter table */
  habitat: "field" | "forest" | "coast" | "mountain";
}

export const SPECIES: SpeciesDef[] = [
  { id: 0, name: "Ignifawn", element: "ember", baseHp: 44, baseAtk: 52, baseDef: 40, baseSpd: 55, catchRate: 0.35, moves: [0, 1, 2], habitat: "field" },
  { id: 1, name: "Tidelet", element: "tide", baseHp: 46, baseAtk: 48, baseDef: 45, baseSpd: 48, catchRate: 0.35, moves: [0, 3, 4], habitat: "coast" },
  { id: 2, name: "Thornix", element: "verdant", baseHp: 45, baseAtk: 49, baseDef: 46, baseSpd: 50, catchRate: 0.35, moves: [0, 5, 6], habitat: "forest" },
  { id: 3, name: "Zephyrling", element: "storm", baseHp: 40, baseAtk: 45, baseDef: 38, baseSpd: 66, catchRate: 0.4, moves: [11, 7, 8], habitat: "field" },
  { id: 4, name: "Marbleon", element: "stone", baseHp: 55, baseAtk: 50, baseDef: 60, baseSpd: 30, catchRate: 0.3, moves: [0, 9, 11], habitat: "mountain" },
  { id: 5, name: "Umbrit", element: "spirit", baseHp: 42, baseAtk: 50, baseDef: 42, baseSpd: 58, catchRate: 0.28, moves: [11, 10], habitat: "forest" },
  { id: 6, name: "Gryphlet", element: "storm", baseHp: 50, baseAtk: 55, baseDef: 45, baseSpd: 60, catchRate: 0.22, moves: [11, 7, 8], habitat: "mountain" },
  { id: 7, name: "Basilus", element: "stone", baseHp: 48, baseAtk: 54, baseDef: 52, baseSpd: 42, catchRate: 0.25, moves: [0, 9, 5], habitat: "coast" },
];

export function statAtLevel(base: number, level: number): number {
  return Math.floor((base * 2 * level) / 100) + 5;
}

export function hpAtLevel(baseHp: number, level: number): number {
  return Math.floor((baseHp * 2 * level) / 100) + level + 10;
}

/** Deterministic damage formula (server-authoritative). */
export function damage(
  level: number,
  atk: number,
  def: number,
  power: number,
  eff: number,
  roll: number // 0.85..1.0
): number {
  const base = (((2 * level) / 5 + 2) * power * (atk / Math.max(1, def))) / 50 + 2;
  return Math.max(1, Math.floor(base * eff * roll));
}
