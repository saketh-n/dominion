/**
 * Generates original character sprites (16x24, 4 dirs x 3 frames, 8 skins)
 * and 8 original creature battle sprites (32x32), plus 4x preview sheets.
 *
 * Output:
 *   apps/client/public/assets/characters.png
 *   apps/client/public/assets/creatures.png
 *   preview/characters-preview.png
 *   preview/creatures-preview.png
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NUM_SKINS, SPECIES } from "../packages/shared/src/index.js";
import {
  makeCanvas,
  scaleCanvas,
  drawTemplate,
  mirrorTemplate,
  shade,
  Ctx,
  dropShadow,
  contactShadow,
  applySelectiveOutline,
  applyDirectionalLight,
  applyDesaturate,
  STYLE,
} from "./pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const CHAR_W = 16;
export const CHAR_H = 24;

// ---------------------------------------------------------------------------
// character templates
// o outline, h hair, H hair highlight, s skin, e eye, t tunic, a accent,
// b belt (gold), f sandal
// ---------------------------------------------------------------------------

// Denser DP-style silhouettes: full outline, multi-shade hair/tunic, gold belt,
// sandal straps, arm definition — Greco-Roman wanderer (not stick figure).
const DOWN_STAND = [
  "................",
  "....oooooooo....",
  "...ohHHHHHHho...",
  "...ohHhhhhhHo...",
  "..ohHhhhhhhhHo..",
  "..ohhhhhhhhhho..",
  "..ohSsssssssHo..",
  "..ohseSssSesho..",
  "..ohsssnssssho..",
  "...osssnssso....",
  "...oaSssssaao...",
  "..otttTTttttTo..",
  "..oStattattatso.",
  "..ostbbbbbbbtso.",
  "..ostattttatdo..",
  "...oaagggaao....",
  "...ossoosso.....",
  "...osnoonso.....",
  "...ossoosso.....",
  "...offooffo.....",
  "...ofooofoo.....",
  "....oooooo......",
  "................",
  "................",
];

const LEFT_STAND = [
  "................",
  ".....oooooo.....",
  "....ohHHhhho....",
  "...ohHHhhhhHo...",
  "...ohHhhhhhho...",
  "...ohhhhhhhho...",
  "...oSsshhhhho...",
  "...oseSnhhhho...",
  "...osnshhhhho...",
  "....osshhhho....",
  "....oaSsssao....",
  "...ottTtttso....",
  "...otTattaso....",
  "...otbbbbgso....",
  "...otdattado....",
  "....oaaggao.....",
  ".....osnno......",
  ".....osnno......",
  ".....osnno......",
  ".....offfo......",
  ".....ofofo......",
  ".....ooooo......",
  "................",
  "................",
];

const LEFT_STRIDE = [
  "................",
  ".....oooooo.....",
  "....ohHHhhho....",
  "...ohHHhhhhHo...",
  "...ohHhhhhhho...",
  "...ohhhhhhhho...",
  "...oSsshhhhho...",
  "...oseSnhhhho...",
  "...osnshhhhho...",
  "....osshhhho....",
  "....oaSsssao....",
  "...ottTtttso....",
  "...otTattaso....",
  "...otbbbbgso....",
  "...otdattado....",
  "....oaaggao.....",
  "....ossnnso.....",
  "....oss.onno....",
  "....oss.onno....",
  "....off.offo....",
  "....ofo.ofoo....",
  "....ooo.oooo....",
  "................",
  "................",
];

/** derive UP from a DOWN template: face rows become hair (back of head). */
function toUp(tpl: string[]): string[] {
  return tpl.map((row, y) => {
    if (y >= 7 && y <= 10) {
      return row.replace(/[se]/g, "h");
    }
    return row;
  });
}

/** derive walk frames for DOWN/UP: lift one leg by 1px (rows 17..21). */
function legLift(tpl: string[], side: "left" | "right"): string[] {
  const out = tpl.map((r) => r.split(""));
  // leg columns: left x4-7, right x8-11
  const [c0, c1] = side === "left" ? [4, 7] : [8, 11];
  for (let y = 17; y <= 21; y++) {
    for (let x = c0; x <= c1; x++) {
      out[y][x] = y + 1 <= 21 ? tpl[y + 1]?.[x] ?? "." : ".";
    }
  }
  // clear the vacated bottom row for that side
  for (let x = c0; x <= c1; x++) out[21][x] = ".";
  return out.map((r) => r.join(""));
}

interface Skin {
  hair: string;
  hairHi: string;
  skin: string;
  tunic: string;
  tunicShade: string;
  accent: string;
}

const SKINS: Skin[] = [
  { hair: "#6b4a2c", hairHi: "#8a6438", skin: "#f0c8a0", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#a43e35" },
  { hair: "#2e2a2e", hairHi: "#4a444e", skin: "#e0b088", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#2f6fb8" },
  { hair: "#d8b45c", hairHi: "#ecd084", skin: "#f0c8a0", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#3f8a3c" },
  { hair: "#8a4a2a", hairHi: "#ab6438", skin: "#c89068", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#d9a840" },
  { hair: "#3a2c20", hairHi: "#584434", skin: "#8a5c3c", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#7a4a9c" },
  { hair: "#242830", hairHi: "#3c4450", skin: "#c89068", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#2e8f86" },
  { hair: "#b05430", hairHi: "#cc7244", skin: "#f0c8a0", tunic: "#f6f0dc", tunicShade: "#ddd4bc", accent: "#d97b2f" },
  { hair: "#b8b4ac", hairHi: "#d4d0c8", skin: "#e0b088", tunic: "#f2ede0", tunicShade: "#d8d0bc", accent: "#3a4a6b" },
];

function charPalette(s: Skin): Record<string, string> {
  // Multi-value DP shading: selective outline, muted gold, unified light
  return {
    o: STYLE.outline,
    h: s.hair,
    H: s.hairHi,
    s: s.skin,
    n: shade(s.skin, -0.28),
    e: "#1a1410",
    t: s.tunic,
    T: s.tunicShade,
    a: s.accent,
    b: "#c49848",
    f: "#7a5434",
    S: shade(s.skin, 0.18),
    d: shade(s.tunic, -0.35),
    g: "#d8b468",
  };
}

// frame order per skin row: down x3, up x3, left x3, right x3 (stand, A, B)
function buildCharacterFrames(): string[][][] {
  const downStand = transliterate(DOWN_STAND);
  const leftStand = transliterate(LEFT_STAND);
  const leftStride = transliterate(LEFT_STRIDE);
  const downA = legLift(downStand, "right");
  const downB = legLift(downStand, "left");
  const upStand = toUp(downStand);
  const upA = toUp(downA);
  const upB = toUp(downB);
  const leftFrames = [leftStand, leftStride, leftStand];
  const rightFrames = leftFrames.map(mirrorTemplate);
  return [
    [downStand, downA, downB],
    [upStand, upA, upB],
    leftFrames,
    rightFrames,
  ];
}

// ---------------------------------------------------------------------------
// creature templates (24x24 in 32x32 frames)
// per-species palette: o outline, m main, l light, d dark, a accent, A accent2,
// e eye, w eye shine
// ---------------------------------------------------------------------------

interface CreatureArt {
  tpl: string[];
  pal: Record<string, string>;
}

// 0 Ignifawn — ember fawn, flame tail & ember back spots (denser multi-shade)
const IGNIFAWN: CreatureArt = {
  pal: {
    o: "#3a2014",
    m: "#d99a5e",
    l: "#eebc84",
    d: "#b0763f",
    a: "#e8542f",
    A: "#f6a03c",
    e: "#2a1c14",
    w: "#ffffff",
    c: "#f6e8d0",
    r: "#8a4a28",
    s: "#f8d4a8",
    f: "#ff7040",
  },
  tpl: [
    "........................",
    ".........afA............",
    "........aAfAa...........",
    "..oo....aAAAa...oo......",
    ".ollo..aAAAAa..ollo.....",
    ".olmo...aAfAa..omlo.....",
    ".osmo....afa...omso.....",
    "..ommoooooooooommo......",
    "..omlmmmmmmmmmmlmo......",
    "..ommewmmmmmmwemmo......",
    "..omlmmmmmmmAmmmmoo.....",
    "..ocsmcmmmmAAAmmmmo.....",
    "..occcommmmmAmmmmdo.....",
    "...oooomlmmmmmmAmmo.....",
    "......ommmmmmmmmmmo.....",
    "......omlmmmmmmlmmo.....",
    "......omdmmmmmdmmro.....",
    "......omomommomomo......",
    "......omo.omo.omo.......",
    "......olo.olo.olo.......",
    "......oro.oro.oro.......",
    "......ooo.ooo.ooo.......",
    "........................",
    "........................",
  ],
};

// 1 Tidelet — teardrop water sprite with fin crest (multi-shade body)
const TIDELET: CreatureArt = {
  pal: {
    o: "#142848",
    m: "#4494e0",
    l: "#74b8f0",
    d: "#2f78c4",
    a: "#a2d8f6",
    e: "#0c1828",
    w: "#ffffff",
    c: "#dcf0fc",
    r: "#1e5a9c",
    s: "#98d0f8",
    f: "#e8f8ff",
  },
  tpl: [
    "........................",
    "...........o............",
    "..........ofo...........",
    ".........oaao...........",
    "........oasaao..........",
    ".......oomlmoo..........",
    "......omlmmmmo..........",
    ".....olmmmmmmmo.........",
    "....olmmmmmmmmmo........",
    "....olmewmmewmmo........",
    "...olmmmmmmmmmmmo.......",
    "...osmmmmmcccmmmo.......",
    "...olmmcccmmmmmdo.......",
    "...ommmmmmmmmmmdo.......",
    "...odmmmmmmmmmddo.......",
    "...odrmmmmmmmrdo........",
    "....odmmmmmmmdo.........",
    ".....odddddddo..........",
    "....oo.ooooo.oo.........",
    "...oao.......oao........",
    "....o.........o.........",
    "........................",
    "........................",
    "........................",
  ],
};

// 2 Thornix — verdant fox with leaf ears & thorn back
const THORNIX: CreatureArt = {
  pal: { o: "#1e4420", m: "#5aa848", l: "#7cc45e", d: "#3f8034", a: "#2e6b2a", A: "#8fd870", e: "#1c2416", w: "#ffffff", c: "#e8f4d8" },
  tpl: [
    "........................",
    "...oo..........oo.......",
    "..oAao........oaAo......",
    "..oaAao......oaAao......",
    "..oaaAo......oAaao......",
    "...oamoooooooomao.......",
    "...ommmmmmmmmmmmo.......",
    "...ommewmmmmwemmo.......",
    "...ommmmmddmmmmmo.......",
    "....ommmdmmdmmmo........",
    ".....ommmccmmmo.........",
    "....oommmmmmmmoo........",
    "...oAmmmmmmmmmmAo.......",
    "..oAmmmmmmmmmmmmAo......",
    "..oammmmmmmmmmmmao.oAo..",
    "..oammdmmmmmmdmmaoaAAao.",
    "...oommmmmmmmmmoo..oAo..",
    "....omo..omo..omo.......",
    "....olo..olo..olo.......",
    "....ooo..ooo..ooo.......",
    "........................",
    "........................",
    "........................",
    "........................",
  ],
};

// 3 Zephyrling — storm songbird, wind-swept wing
const ZEPHYRLING: CreatureArt = {
  pal: { o: "#2c3444", m: "#8fa8c4", l: "#b4c8dc", d: "#68809c", a: "#e8c84c", e: "#1c2028", w: "#ffffff", c: "#e8eef4" },
  tpl: [
    "........................",
    "........................",
    "..........ooo...........",
    ".........olllo..........",
    "........ollmmo..........",
    "........olmewo..........",
    ".......olmmmmo..........",
    "....oa.olmmmmmoaa.......",
    ".....oaommmmmmoa........",
    "......ommmmmmmmo........",
    ".....odmmllllmmmo.......",
    "....odmmllllllmmo.......",
    "...odmmdllllllmmo.......",
    "...odmdmmllllmmmo.......",
    "....oddmmmmmmmmo........",
    ".....oodmmmmmmo.........",
    ".......odmmmmo..........",
    "........ommmo...........",
    ".........omo............",
    "........oaao............",
    ".......oa.ao............",
    "........................",
    "........................",
    "........................",
  ],
};

// 4 Marbleon — marble golem pup, blocky, gold seams
const MARBLEON: CreatureArt = {
  pal: { o: "#5c5648", m: "#e8e4d8", l: "#f8f5ec", d: "#c4bcaa", a: "#d9a840", e: "#2c2820", w: "#ffffff", c: "#a89e8c" },
  tpl: [
    "........................",
    "........................",
    "...ooooo....ooooo.......",
    "...olllo....olllo.......",
    "...olloooooooollo.......",
    "...ollllllllllllo.......",
    "...ollmmmmmmmmllo.......",
    "...olmewmmmmewmlo.......",
    "...olmmmmaammmmlo.......",
    "...ollmmmaammmllo.......",
    "....ollmmmmmmllo........",
    ".....oolllllloo.........",
    "....oolllllllloo........",
    "...ollmmmammmlllo.......",
    "...olmmmmammmmmlo.......",
    "...olmmaaaaaammlo.......",
    "...odmmmmammmmdo........",
    "...odmmmmammmmdo........",
    "....oddoooooddo.........",
    "....odo.....odo.........",
    "....ooo.....ooo.........",
    "........................",
    "........................",
    "........................",
  ],
};

// 5 Umbrit — spirit wisp, violet shade w/ inner glow
const UMBRIT: CreatureArt = {
  pal: { o: "#241c34", m: "#5c4884", l: "#7c64a8", d: "#42305c", a: "#b894e8", e: "#f0e8ff", w: "#fffadc", c: "#8a74b8" },
  tpl: [
    "........................",
    "........................",
    "......o.....o...........",
    ".....olo...olo..........",
    ".....olao.oalo..........",
    "......olooolo...........",
    ".....oommmmoo...........",
    "....ommmmmmmmo..........",
    "...olmmmmmmmmlo.........",
    "...olmewmmwemlo.........",
    "..oammmmmmmmmmao........",
    "..oammmmccmmmmao........",
    "..ommmmmmmmmmmmo........",
    "..ommdmmmmmmdmmo........",
    "...ommdmmmmdmmo.........",
    "...oddmmmmmmddo.........",
    "....odmmddmmdo..........",
    ".....odmodmdo...........",
    "......odo.odo...........",
    ".......o...o............",
    "........................",
    "........................",
    "........................",
  ],
};

// 6 Gryphlet — griffin chick: eagle head, tawny body, small wings
const GRYPHLET: CreatureArt = {
  pal: { o: "#4a3418", m: "#d9b06a", l: "#eccf94", d: "#b08c48", a: "#f2ead8", A: "#e8a02c", e: "#241c10", w: "#ffffff", c: "#8a6c34" },
  tpl: [
    "........................",
    "......oo................",
    ".....oaao...............",
    "....oaaaao..............",
    "....oaewao..............",
    "....oaaaaoo.............",
    ".....oAAao..............",
    "......oAo...............",
    "....oomaoooo............",
    "...ommmaammmoo..........",
    "..olmmmmmmmmmmo.........",
    "..olmmmmmmllmmmo........",
    ".odmmmmmmllllmmo........",
    ".odmmmmmmllllmmo........",
    ".odmmmmmmmllmmmo........",
    "..ommmmmmmmmmmo.........",
    "..ommdmmmmmdmmo.........",
    "...omomommmomo..........",
    "...oAo.ommmmo...........",
    "...oAo..oommmo..........",
    "...ooo....ooAAo.........",
    "...........oooo.........",
    "........................",
    "........................",
  ],
};

// 7 Basilus — upright stone basilisk: cobra pose, marble crest, coiled base
const BASILUS: CreatureArt = {
  pal: { o: "#3c3830", m: "#b0a890", l: "#ccc4ac", d: "#8c8470", a: "#d9a840", A: "#e8e4d8", e: "#8a2c20", w: "#ffffff", c: "#6c6454" },
  tpl: [
    "........................",
    ".......oAAo.............",
    "......oAAAAo............",
    "......ommmmo............",
    ".....olmewmmo...........",
    ".....olmmmmmo...........",
    ".....ommccmmo...........",
    ".....olmmmmmmo..........",
    "....olmmmmmmmmo.........",
    "....ommmammmmmo.........",
    ".....oommmmmoo..........",
    "......olmammo...........",
    "......olmmmmo...........",
    "....ooommammo...........",
    "...odmmmmmmmmoo.........",
    "..odmmmmmmmmmmmo........",
    "..olmmmmmmmmmmmmo.......",
    "..olmdmmmmammmmmo.......",
    "...olmmdddmmmmmo........",
    "....oolmmmmmmoo.........",
    "......oooooo............",
    "........................",
    "........................",
    "........................",
  ],
};

const CREATURES: CreatureArt[] = [IGNIFAWN, TIDELET, THORNIX, ZEPHYRLING, MARBLEON, UMBRIT, GRYPHLET, BASILUS];

/**
 * Fix hand-typing artifacts: transliterate Unicode lookalikes (Cyrillic o, l,
 * O) to their ASCII palette equivalents, then verify every char is known.
 */
const LOOKALIKES: Record<string, string> = { "o": "o", "O": "o", "l": "l", "Л": "l", "a": "a", "А": "A", "e": "e", "n": "h" };

function transliterate(rows: string[]): string[] {
  return rows.map((row) =>
    row
      .split("")
      .map((ch) => LOOKALIKES[ch] ?? ch)
      .join("")
  );
}

function sanitize(art: CreatureArt): CreatureArt {
  const tpl = transliterate(art.tpl);
  const known = new Set(Object.keys(art.pal).concat([".", " "]));
  for (const row of tpl) {
    for (const ch of row) {
      if (!known.has(ch)) throw new Error(`unknown template char '${ch}' (U+${ch.charCodeAt(0).toString(16)})`);
    }
  }
  return { pal: art.pal, tpl };
}

// ---------------------------------------------------------------------------

function main() {
  mkdirSync(join(ROOT, "apps/client/public/assets"), { recursive: true });
  mkdirSync(join(ROOT, "preview"), { recursive: true });

  // --- characters ---
  const dirFrames = buildCharacterFrames(); // [dir][frame] -> template
  const framesPerSkin = 12;
  const charSheet = makeCanvas(framesPerSkin * CHAR_W, NUM_SKINS * CHAR_H);
  charSheet.ctx.imageSmoothingEnabled = false;
  for (let skin = 0; skin < NUM_SKINS; skin++) {
    const pal = charPalette(SKINS[skin]);
    for (let dir = 0; dir < 4; dir++) {
      for (let f = 0; f < 3; f++) {
        const fx = (dir * 3 + f) * CHAR_W;
        const fy = skin * CHAR_H;
        // soft drop + contact AO under feet (baked into frame)
        const tmp = makeCanvas(CHAR_W, CHAR_H);
        dropShadow(tmp.ctx, 8, 21.5, 5.5, 1.6);
        contactShadow(tmp.ctx, 4, 22, 8);
        drawTemplate(tmp.ctx, dirFrames[dir][f], pal, 0, 0);
        applyDirectionalLight(tmp.ctx, CHAR_W, 0.08, CHAR_H);
        applySelectiveOutline(tmp.ctx, CHAR_W, STYLE.outline, CHAR_H);
        charSheet.ctx.drawImage(tmp.canvas, fx, fy);
      }
    }
  }
  // DP density dither on character sheet
  {
    const img = charSheet.ctx.getImageData(0, 0, charSheet.canvas.width, charSheet.canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const x = (i / 4) % charSheet.canvas.width;
      const y = ((i / 4) / charSheet.canvas.width) | 0;
      const bayer = ((x & 2) ^ (y & 2)) * 2 - 2;
      d[i] = Math.max(0, Math.min(255, d[i] + bayer));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + bayer * 0.8));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + bayer * 0.6));
      // mild desat
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i] + (L - d[i]) * 0.08;
      d[i + 1] = d[i + 1] + (L - d[i + 1]) * 0.08;
      d[i + 2] = d[i + 2] + (L - d[i + 2]) * 0.08;
    }
    charSheet.ctx.putImageData(img, 0, 0);
  }
  writeFileSync(join(ROOT, "apps/client/public/assets/characters.png"), charSheet.canvas.toBuffer("image/png"));

  // --- creatures (32x32 frames, art centered) ---
  const crSheet = makeCanvas(CREATURES.length * 32, 32);
  crSheet.ctx.imageSmoothingEnabled = false;
  CREATURES.forEach((artRaw, i) => {
    const art = sanitize(artRaw);
    const ox = i * 32;
    const tmp = makeCanvas(32, 32);
    dropShadow(tmp.ctx, 16, 28, 10, 2.2);
    contactShadow(tmp.ctx, 6, 29, 20);
    // mute pure whites in palette
    const pal = { ...art.pal };
    for (const k of Object.keys(pal)) {
      if (pal[k].toLowerCase() === "#ffffff") pal[k] = "#e8e4dc";
    }
    if (!pal.o) pal.o = STYLE.outline;
    else pal.o = STYLE.outline;
    drawTemplate(tmp.ctx, art.tpl, pal, 4, 4);
    applyDirectionalLight(tmp.ctx, 32, 0.1);
    applyDesaturate(tmp.ctx, 32, 0.1);
    applySelectiveOutline(tmp.ctx, 32);
    crSheet.ctx.drawImage(tmp.canvas, ox, 0);
  });
  {
    const img = crSheet.ctx.getImageData(0, 0, crSheet.canvas.width, crSheet.canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const x = (i / 4) % crSheet.canvas.width;
      const y = ((i / 4) / crSheet.canvas.width) | 0;
      const bayer = (((x * 2 + y * 3) & 7) - 3.5) * 2.2;
      d[i] = Math.max(0, Math.min(255, d[i] + bayer));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + bayer * 0.9));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + bayer * 0.75));
    }
    crSheet.ctx.putImageData(img, 0, 0);
  }
  writeFileSync(join(ROOT, "apps/client/public/assets/creatures.png"), crSheet.canvas.toBuffer("image/png"));

  // --- previews ---
  const charPrev = scaleCanvas(charSheet.canvas, 4);
  writeFileSync(join(ROOT, "preview/characters-preview.png"), charPrev.toBuffer("image/png"));

  const crPrevBase = makeCanvas(CREATURES.length * 34 + 2, 46);
  crPrevBase.ctx.fillStyle = "#38343f";
  crPrevBase.ctx.fillRect(0, 0, crPrevBase.canvas.width, crPrevBase.canvas.height);
  CREATURES.forEach((artRaw, i) => {
    const art = sanitize(artRaw);
    drawTemplate(crPrevBase.ctx, art.tpl, art.pal, i * 34 + 6, 8);
  });
  const crPrev = scaleCanvas(crPrevBase.canvas, 4);
  const labeled = makeCanvas(crPrev.width, crPrev.height + 18);
  labeled.ctx.fillStyle = "#242230";
  labeled.ctx.fillRect(0, 0, labeled.canvas.width, labeled.canvas.height);
  labeled.ctx.drawImage(crPrev, 0, 0);
  labeled.ctx.fillStyle = "#cfc8b8";
  labeled.ctx.font = "11px Menlo";
  SPECIES.forEach((sp, i) => {
    labeled.ctx.fillText(sp.name, i * 34 * 4 + 24, crPrev.height + 13);
  });
  writeFileSync(join(ROOT, "preview/creatures-preview.png"), labeled.canvas.toBuffer("image/png"));

  console.log(`characters: ${NUM_SKINS} skins x 12 frames (${CHAR_W}x${CHAR_H}) -> characters.png`);
  console.log(`creatures: ${CREATURES.length} species (32x32) -> creatures.png`);
  console.log("previews: preview/characters-preview.png, preview/creatures-preview.png");
}

main();
