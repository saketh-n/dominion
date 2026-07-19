import Phaser from "phaser";
import { NUM_SKINS } from "@game/shared";

export const CHAR_W = 16;
export const CHAR_H = 24;

/** Bump when shipping new art so browsers/Phaser never reuse stale asset blobs. */
export const ASSET_REV = "grc-dp-v6-seams-marble";

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("preload");
  }

  preload() {
    const label = this.add
      .text(480, 320, "Loading Dominion…", { fontSize: "20px", color: "#e8dcc0" })
      .setOrigin(0.5);
    this.load.on("progress", (p: number) => label.setText(`Loading Dominion… ${Math.round(p * 100)}%`));

    const q = `?v=${ASSET_REV}`;
    this.load.image("tileset", `assets/tileset.png${q}`);
    this.load.spritesheet("characters", `assets/characters.png${q}`, {
      frameWidth: CHAR_W,
      frameHeight: CHAR_H,
    });
    this.load.spritesheet("creatures", `assets/creatures.png${q}`, {
      frameWidth: 32,
      frameHeight: 32,
    });
    this.load.json("world", `assets/world/world.json${q}`);
  }

  create() {
    // walk animations: 12 frames per skin row (4 dirs x [stand, A, B])
    for (let skin = 0; skin < NUM_SKINS; skin++) {
      for (let dir = 0; dir < 4; dir++) {
        const base = skin * 12 + dir * 3;
        this.anims.create({
          key: `walk-${skin}-${dir}`,
          frames: [
            { key: "characters", frame: base + 1 },
            { key: "characters", frame: base },
            { key: "characters", frame: base + 2 },
            { key: "characters", frame: base },
          ],
          frameRate: 10,
          repeat: -1,
        });
      }
    }
    this.scene.start("world");
  }
}
