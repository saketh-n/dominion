import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT, OVERWORLD_ZOOM } from "@game/shared";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { WorldScene } from "./scenes/WorldScene";
import { BattleScene } from "./scenes/BattleScene";
import { installDisplayFit, refitDisplay, setActiveZoom } from "./displayScale";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: "#14121a",
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scene: [BootScene, PreloadScene, WorldScene, BattleScene],
  scale: {
    // Manual CSS size via displayScale — host flex centers the canvas.
    // NO autoCenter: Phaser CENTER_BOTH writes absolute left/top that fight flex.
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
  },
  callbacks: {
    postBoot: (g) => {
      setActiveZoom(OVERWORLD_ZOOM);
      installDisplayFit(g);
      refitDisplay(OVERWORLD_ZOOM);
      window.addEventListener("resize", () => refitDisplay());
    },
  },
});

void game;
