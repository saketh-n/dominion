/**
 * Global indexed palette (≤48 colors) and per-material ramps for the tileset.
 *
 * Rules:
 * - Painters may only select ramp/palette entries — never mix/shade/desaturate at paint time.
 * - Each ramp is 4–5 hand-picked colors with hue-shifted ends:
 *   shadows → blue/violet, highlights → warm yellow (never lightness-only).
 * - Stamps are fixed micro-shapes using ramp indices only.
 */

/** Hand-picked global palette entries (shared across all materials). */
export const P = {
  // grass 5 — cool shadow → warm highlight
  g0: "#3a5248",
  g1: "#4a6a40",
  g2: "#5a8448",
  g3: "#6a9a50",
  g4: "#7ab058",
  // dirt 4 — mid pair stays within ~15% L for quiet ground
  d0: "#5a4838",
  d1: "#8a7054",
  d2: "#9a8060",
  d3: "#b89870",
  // stone 5 — mid pair close; extremes for objects/outlines
  s0: "#3a4050",
  s1: "#5a6070",
  s2: "#8a909a",
  s3: "#9aa0a8",
  s4: "#b8bcc4",
  // marble 5 — mid pair tight; m0/m4 for prop volume
  m0: "#4a4860",
  m1: "#7a7488",
  m2: "#b8b0a4",
  m3: "#c4bcb0",
  m4: "#e0d8c4",
  // sand 4
  a0: "#7a6038",
  a1: "#b09860",
  a2: "#c0a868",
  a3: "#d0bc80",
  // water 5 — one step higher saturation (richer cyan-blue, less grey)
  w0: "#1e3a62",
  w1: "#2e5c92",
  w2: "#4a8ec4",
  w3: "#5aa0d0",
  w4: "#78c0e8",
  // rock 3 (share d0 for deep)
  r1: "#686460",
  r2: "#787068",
  r3: "#888078",
  // snow mid (light uses s4, shadow uses s2)
  n1: "#d0d6dc",
  // wood 3 — mid pair for floors; o0 for prop outlines
  o0: "#3a2818",
  o1: "#7a5c3c",
  o2: "#8a6848",
  // roof 3
  f0: "#4a2018",
  f1: "#6e3428",
  f2: "#a05040",
  // door 2
  e0: "#2c1c10",
  e1: "#5c3c24",
  // canopy 3
  c0: "#243828",
  c1: "#345830",
  c2: "#4a7840",
  // accents + ink (wall ashlar uses m2/m3)
  gold: "#c49848",
  goldL: "#d8b468",
  crimson: "#8e3c38",
  crimsonD: "#5a2828",
  ink: "#2a2438",
} as const;

export type PalKey = keyof typeof P;

/** Flat list of all palette hex strings (deduped, lowercase). */
export const GLOBAL_PALETTE_LIST: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of Object.values(P)) {
    const h = v.toLowerCase();
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
})();

if (GLOBAL_PALETTE_LIST.length > 48) {
  throw new Error(`Palette has ${GLOBAL_PALETTE_LIST.length} colors (max 48)`);
}

/** Material ramps: index 0 = deepest/cool shadow … last = warm highlight. */
export const RAMPS = {
  grass: [P.g0, P.g1, P.g2, P.g3, P.g4] as const,
  tall: [P.c0, P.c1, P.c2, P.g3, P.g4] as const,
  dirt: [P.d0, P.d1, P.d2, P.d3] as const,
  stone: [P.s0, P.s1, P.s2, P.s3, P.s4] as const,
  marble: [P.m0, P.m1, P.m2, P.m3, P.m4] as const,
  sand: [P.a0, P.a1, P.a2, P.a3] as const,
  water: [P.w0, P.w1, P.w2, P.w3, P.w4] as const,
  rock: [P.d0, P.r1, P.r2, P.r3] as const,
  // snow: two close lights + one cool shadow for props/decals
  snow: [P.s3, P.n1, P.s4] as const,
  wood: [P.o0, P.o1, P.o2, P.d3] as const,
  roof: [P.f0, P.f1, P.f2, P.gold] as const,
  door: [P.e0, P.e1, P.o2] as const,
  canopy: [P.c0, P.c1, P.c2, P.g3] as const,
  trunk: [P.o0, P.o1, P.o2] as const,
  cwall: [P.d0, P.r1, P.m2, P.m3, P.m4] as const,
  gold: [P.crimsonD, P.gold, P.goldL] as const,
  crimson: [P.crimsonD, P.crimson, P.gold] as const,
  ink: [P.ink] as const,
} as const;

export type RampName = keyof typeof RAMPS;

/** Compatibility alias shaped like old PAL. */
export const PAL = {
  grass: { deep: P.g0, dark: P.g1, base: P.g2, light: P.g3, lush: P.g4 },
  tall: { bg: P.c1, blade: P.c2, bladeD: P.c0, bladeL: P.g3, tip: P.g4 },
  dirt: { deep: P.d0, dark: P.d1, base: P.d2, light: P.d3 },
  stone: { deep: P.s0, dark: P.s1, grout: P.s2, base: P.s3, light: P.s4 },
  marble: { deep: P.m0, dark: P.m1, vein: P.m2, base: P.m3, light: P.m4, cream: P.m3 },
  sand: { deep: P.a0, dark: P.a1, base: P.a2, light: P.a3 },
  water: { deep: P.w0, dark: P.w1, base: P.w2, light: P.w3, pale: P.w4 },
  rock: { deep: P.d0, dark: P.r1, base: P.r2, light: P.r3 },
  snow: { shadow: P.s2, base: P.n1, light: P.s4 },
  wood: { deep: P.o0, dark: P.o1, base: P.o2, light: P.d3, seam: P.o0 },
  roof: { deep: P.f0, dark: P.f1, base: P.f2, light: P.gold, lighter: P.goldL },
  door: { darker: P.e0, dark: P.e1, wood: P.o2, light: P.d3 },
  gold: P.gold,
  goldL: P.goldL,
  crimson: P.crimson,
  crimsonD: P.crimsonD,
  cwall: { deep: P.d0, dark: P.r1, mortar: P.d1, base: P.m2, light: P.m3 },
  trunk: { deep: P.o0, dark: P.o1, base: P.o2, light: P.d3 },
  canopy: { deep: P.c0, dark: P.c1, base: P.c2, light: P.g3, lush: P.g4 },
  interior: { wallTop: P.m3, wallDark: P.m2, panel: P.o2, panelD: P.o1 },
  ink: P.ink,
};

// ---------------------------------------------------------------------------
// Micro-shape stamps (≤12). Each pixel is [dx, dy, rampIndex].
// ---------------------------------------------------------------------------

export type StampPixel = readonly [dx: number, dy: number, rampIdx: number];
export type Stamp = {
  readonly name: string;
  readonly pixels: readonly StampPixel[];
  readonly w: number;
  readonly h: number;
};

export const STAMPS: readonly Stamp[] = [
  {
    name: "grass_tuft",
    w: 3,
    h: 2,
    pixels: [
      [0, 1, 1],
      [1, 0, 3],
      [1, 1, 2],
      [2, 1, 1],
    ],
  },
  {
    name: "grass_blade",
    w: 2,
    h: 3,
    pixels: [
      [0, 2, 1],
      [0, 1, 2],
      [0, 0, 3],
      [1, 1, 1],
    ],
  },
  {
    // Solid 2×2 block (filled) — monochrome stamp cannot form internal Bayer
    name: "pebble",
    w: 2,
    h: 2,
    pixels: [
      [0, 0, 3],
      [1, 0, 2],
      [0, 1, 1],
      [1, 1, 1],
    ],
  },
  {
    // Contiguous polyline crack (no diagonal-only gaps vs base)
    name: "crack",
    w: 4,
    h: 2,
    pixels: [
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, 0],
      [2, 1, 1],
      [3, 1, 0],
    ],
  },
  {
    // Contiguous vein line
    name: "vein",
    w: 4,
    h: 2,
    pixels: [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 1],
      [3, 0, 2],
      [3, 1, 1],
    ],
  },
  {
    // Solid horizontal wave crest — no staggered diagonals (those form Bayer with base fill)
    name: "ripple",
    w: 4,
    h: 1,
    pixels: [
      [0, 0, 3],
      [1, 0, 3],
      [2, 0, 3],
      [3, 0, 3],
    ],
  },
  {
    // Single sparkle pixel + neighbor (2px line, not 2×2 diagonal)
    name: "sparkle",
    w: 2,
    h: 1,
    pixels: [
      [0, 0, 4],
      [1, 0, 3],
    ],
  },
  {
    name: "moss",
    w: 3,
    h: 2,
    pixels: [
      [0, 1, 1],
      [1, 0, 2],
      [1, 1, 2],
      [2, 1, 1],
    ],
  },
  {
    name: "leaf",
    w: 3,
    h: 2,
    pixels: [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 1],
      [1, 1, 0],
    ],
  },
  {
    // Solid 2×1 bar (no L-gap checker with base)
    name: "wear",
    w: 2,
    h: 1,
    pixels: [
      [0, 0, 3],
      [1, 0, 4],
    ],
  },
  {
    // Solid 2×1 gravel bar
    name: "gravel",
    w: 2,
    h: 1,
    pixels: [
      [0, 0, 0],
      [1, 0, 1],
    ],
  },
  {
    // Solid 2×2 filled cluster
    name: "dot_cluster",
    w: 2,
    h: 2,
    pixels: [
      [0, 0, 2],
      [1, 0, 3],
      [0, 1, 1],
      [1, 1, 2],
    ],
  },
];

if (STAMPS.length > 12) {
  throw new Error(`Stamp library has ${STAMPS.length} stamps (max 12)`);
}

export const STAMP_BY_NAME: Readonly<Record<string, Stamp>> = Object.fromEntries(
  STAMPS.map((s) => [s.name, s])
);

export function normHex(c: string): string {
  if (c.startsWith("rgba") || c.startsWith("rgb")) {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    if (m) {
      const h = (n: number) =>
        Math.max(0, Math.min(255, Math.round(Number(n))))
          .toString(16)
          .padStart(2, "0");
      return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`;
    }
  }
  return c.slice(0, 7).toLowerCase();
}

export function isPaletteColor(c: string): boolean {
  if (c === "transparent" || c === "") return true;
  return GLOBAL_PALETTE_LIST.includes(normHex(c));
}

export function relativeLuminance(hex: string): number {
  const h = normHex(hex);
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
