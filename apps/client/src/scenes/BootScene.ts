import Phaser from "phaser";
import { connect, getPlayerName, getPlayerSkin } from "../net/connection";

/**
 * Connects to the authoritative world room, then hands off to Preload → World.
 * Connection is established before assets load so WorldScene can read spawn state.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create() {
    const label = this.add
      .text(480, 320, "Connecting to Dominion…", { fontSize: "24px", color: "#e8dcc0" })
      .setOrigin(0.5);

    const name = getPlayerName();
    const skin = getPlayerSkin();

    connect({ name, skin })
      .then((room) => {
        label.setText(`Connected · ${name}`);
        // brief beat so the label is readable, then load assets
        this.time.delayedCall(200, () => {
          this.scene.start("preload", { sessionId: room.sessionId });
        });
      })
      .catch((err) => {
        label.setText(`Connection failed: ${err?.message ?? err}\nIs the server running on :2567?`);
        label.setColor("#ff6666");
        label.setFontSize(16);
      });
  }
}
