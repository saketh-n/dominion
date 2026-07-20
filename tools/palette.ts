/**
 * Global indexed palette (≤48 colors) and per-material ramps for the tileset.
 *
 * Rules:
 * - Painters may only select ramp/palette entries — never mix/shade/desaturate at paint time.
 * - Each ramp is 4–5 hand-picked colors with hue-shifted ends:
 *   shadows → blue/violet, highlights → warm yellow (never lightness-only).
 * - Stamps are fixed micro-shapes using ramp indices only.
 */

/**
 * Hand-picked global palette (≤48). Contrast pass:
 * - Each ramp has a near-black deep step used for door voids, eave, canopy cores.
 * - Hue segmentation: grass=green, dirt=orange-brown, stone=cool blue-grey,
 *   marble/court=warm cream, roof=terracotta, water=cyan — adjacent classes
 *   never share both hue family and value band.
 * - Zone accents (higher sat): temple gold, market crimson, garden leaf, court teal.
 */
export const P = {
  // grass 5 — cool deep → warm leaf (garden zone accent = g4)
  g0: "#1a2e24",
  g1: "#3a5248",
  g2: "#4a6a40",
  g3: "#5a8448",
  g4: "#6ab050",
  // dirt 4 — warm orange-brown (distinct from cool stone)
  d0: "#2a1810",
  d1: "#6a4830",
  d2: "#9a7048",
  d3: "#c49860",
  // stone 5 — cool blue-grey path (value mid; not cream marble)
  s0: "#1c2438",
  s1: "#3a4860",
  s2: "#6a7890",
  s3: "#8a98a8",
  s4: "#b0bcc8",
  // marble / wall 5 — warm cream-violet (walls); court uses lighter cream
  m0: "#2a2838",
  m1: "#5a5470",
  m2: "#a89888",
  m3: "#d0c4b0",
  m4: "#f0e8d4",
  // sand 4 — yellow-ochre (coast zone)
  a0: "#3a2810",
  a1: "#8a6830",
  a2: "#c0a050",
  a3: "#e0c870",
  // water 5 — saturated cyan-blue
  w0: "#0a1838",
  w1: "#1e4a8a",
  w2: "#3a88c8",
  w3: "#58b0e0",
  w4: "#88d8f0",
  // rock 3
  r1: "#484440",
  r2: "#686058",
  r3: "#888078",
  // snow mid
  n1: "#e0e6ec",
  // wood 3
  o0: "#1a1008",
  o1: "#6a4428",
  o2: "#9a6840",
  // roof terracotta 3 + deep eave
  f0: "#180808",
  f1: "#5a2018",
  f2: "#b84830",
  // door near-black void
  e0: "#080408",
  e1: "#3c2414",
  // canopy / hedge deep interior
  c0: "#081810",
  c1: "#244828",
  c2: "#3a7840",
  // accents (high sat) + ink
  gold: "#e0a838",
  goldL: "#f0d060",
  crimson: "#c03830",
  crimsonD: "#681818",
  ink: "#100c18",
} as const;

/** Court signature teal — alias of saturated water mid (stays ≤48 unique hex). */
export const TEAL_ACCENT = "#3a88c8"; // = P.w2, court zone accent

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
  /** Court floor — warmer cream, higher value than wall mid. */
  court: [P.m1, P.m2, P.m3, P.m4, P.goldL] as const, // goldL = highlight; zone accent via TEAL/w2 seams
  sand: [P.a0, P.a1, P.a2, P.a3] as const,
  water: [P.w0, P.w1, P.w2, P.w3, P.w4] as const,
  rock: [P.d0, P.r1, P.r2, P.r3] as const,
  snow: [P.s2, P.n1, P.s4] as const,
  wood: [P.o0, P.o1, P.o2, P.d3] as const,
  roof: [P.f0, P.f1, P.f2, P.gold] as const,
  door: [P.e0, P.e1, P.o2] as const,
  canopy: [P.c0, P.c1, P.c2, P.g3] as const,
  trunk: [P.o0, P.o1, P.o2] as const,
  cwall: [P.d0, P.r1, P.m2, P.m3, P.m4] as const,
  gold: [P.crimsonD, P.gold, P.goldL] as const,
  crimson: [P.crimsonD, P.crimson, P.gold] as const,
  ink: [P.ink] as const,
  teal: [P.w0, P.w2, P.w3] as const,
} as const;

/**
 * Hue-family labels for adjacent-material separation gates.
 * floor (dirt/stone path) ≠ wall (marble) ≠ court (court/marble court).
 */
export const MATERIAL_HUE_FAMILY = {
  grass: "green",
  dirt: "orange",
  stone: "cool-grey",
  marble: "warm-cream",
  court: "warm-cream-light",
  sand: "ochre",
  water: "cyan",
  rock: "neutral-brown",
  roof: "terracotta",
  wood: "brown",
  canopy: "leaf",
  door: "near-black",
} as const;

/** Zone → signature accent hex (raised saturation). */
export const ZONE_ACCENT = {
  temple: P.gold,
  market: P.crimson,
  garden: P.g4,
  court: P.w2, // cyan-teal court/pool signature
} as const;

export type RampName = keyof typeof RAMPS;

/** Compatibility alias shaped like old PAL. */
export const PAL = {
  grass: { deep: P.g0, dark: P.g1, base: P.g2, light: P.g3, lush: P.g4 },
  tall: { bg: P.c1, blade: P.c2, bladeD: P.c0, bladeL: P.g3, tip: P.g4 },
  dirt: { deep: P.d0, dark: P.d1, base: P.d2, light: P.d3 },
  stone: { deep: P.s0, dark: P.s1, grout: P.s2, base: P.s3, light: P.s4 },
  marble: { deep: P.m0, dark: P.m1, vein: P.m2, base: P.m3, light: P.m4, cream: P.m3 },
  court: { deep: P.m1, dark: P.m2, base: P.m3, light: P.m4, accent: P.goldL },
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
  teal: P.w2,
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
