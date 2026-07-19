import Phaser from "phaser";
import {
  SBattleStart,
  SBattleUpdate,
  SBattleEnd,
  MOVES,
  SPECIES,
} from "@game/shared";
import { sendBattleAction, bindHandlers } from "../net/connection";

/**
 * Turn-based wild encounter UI. Launched as an overlay scene on BATTLE_START;
 * returns to WorldScene on BATTLE_END.
 */
export class BattleScene extends Phaser.Scene {
  private start!: SBattleStart;
  private logLines: string[] = [];
  private logText!: Phaser.GameObjects.Text;
  private foeHpText!: Phaser.GameObjects.Text;
  private myHpText!: Phaser.GameObjects.Text;
  private foeBar!: Phaser.GameObjects.Rectangle;
  private myBar!: Phaser.GameObjects.Rectangle;
  private buttons: Phaser.GameObjects.Text[] = [];
  private busy = false;
  private unbind: (() => void) | null = null;

  constructor() {
    super("battle");
  }

  init(data: { start: SBattleStart }) {
    this.start = data.start;
    this.logLines = [`A wild ${SPECIES[data.start.speciesId]?.name ?? "creature"} appeared!`];
    this.busy = false;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.add.rectangle(W / 2, H / 2, W, H, 0x0e0c14, 0.92).setScrollFactor(0).setDepth(0);

    // backdrop panel
    this.add
      .rectangle(W / 2, H / 2, Math.min(720, W - 40), Math.min(480, H - 40), 0x1a1622, 1)
      .setStrokeStyle(2, 0x6a5a30)
      .setScrollFactor(0)
      .setDepth(1);

    const foeName = SPECIES[this.start.speciesId]?.name ?? "???";
    const mineName = SPECIES[this.start.mine.speciesId]?.name ?? "???";

    // foe sprite (creatures sheet is 32x32, one frame per species)
    const foeSpr = this.add
      .image(W / 2 + 140, H / 2 - 90, "creatures", this.start.speciesId)
      .setScale(3)
      .setScrollFactor(0)
      .setDepth(2);
    void foeSpr;

    const mySpr = this.add
      .image(W / 2 - 140, H / 2 + 20, "creatures", this.start.mine.speciesId)
      .setScale(3)
      .setScrollFactor(0)
      .setDepth(2);
    void mySpr;

    this.add
      .text(W / 2 + 140, H / 2 - 150, `${foeName}  Lv${this.start.level}`, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#e8dcc0",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3);

    this.add
      .text(W / 2 - 140, H / 2 - 40, `${mineName}  Lv${this.start.mine.level}`, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#e8dcc0",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3);

    // HP bars
    this.add.rectangle(W / 2 + 140, H / 2 - 130, 160, 10, 0x2a2430).setScrollFactor(0).setDepth(3);
    this.foeBar = this.add
      .rectangle(W / 2 + 140 - 80, H / 2 - 130, 160, 10, 0x5cb85c)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(4);
    this.foeHpText = this.add
      .text(W / 2 + 140, H / 2 - 118, `${this.start.hp}/${this.start.maxHp}`, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#a89878",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3);

    this.add.rectangle(W / 2 - 140, H / 2 - 20, 160, 10, 0x2a2430).setScrollFactor(0).setDepth(3);
    this.myBar = this.add
      .rectangle(W / 2 - 140 - 80, H / 2 - 20, 160, 10, 0x5cb85c)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(4);
    this.myHpText = this.add
      .text(W / 2 - 140, H / 2 - 8, `${this.start.mine.hp}/${this.start.mine.maxHp}`, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#a89878",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3);

    this.logText = this.add
      .text(W / 2, H / 2 + 90, this.logLines.join("\n"), {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#d8c8a0",
        align: "center",
        wordWrap: { width: 560 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(3);

    this.buildActionButtons();

    this.unbind = bindHandlers({
      onBattleUpdate: (u) => this.onUpdate(u),
      onBattleEnd: (e) => this.onEnd(e),
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unbind?.();
      this.unbind = null;
    });
  }

  private buildActionButtons() {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    const W = this.scale.width;
    const H = this.scale.height;
    const moves = this.start.mine.moves ?? [];
    const labels: Array<{ label: string; action: () => void }> = [];

    moves.forEach((moveId, i) => {
      const mv = MOVES[moveId];
      labels.push({
        label: mv?.name ?? `Move ${i + 1}`,
        action: () => this.act({ kind: "move", moveIndex: i }),
      });
    });
    labels.push({ label: "Catch", action: () => this.act({ kind: "catch" }) });
    labels.push({ label: "Run", action: () => this.act({ kind: "run" }) });

    const startX = W / 2 - ((labels.length - 1) * 90) / 2;
    labels.forEach((item, i) => {
      const t = this.add
        .text(startX + i * 90, H / 2 + 180, `[ ${item.label} ]`, {
          fontFamily: "monospace",
          fontSize: "13px",
          color: "#ffe8a0",
          backgroundColor: "#2a2430",
          padding: { x: 8, y: 6 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(5)
        .setInteractive({ useHandCursor: true });
      t.on("pointerover", () => t.setColor("#ffffff"));
      t.on("pointerout", () => t.setColor("#ffe8a0"));
      t.on("pointerdown", () => item.action());
      this.buttons.push(t);
    });
  }

  private act(action: { kind: "move"; moveIndex: number } | { kind: "catch" } | { kind: "run" }) {
    if (this.busy) return;
    this.busy = true;
    for (const b of this.buttons) b.setAlpha(0.45);
    sendBattleAction(action);
  }

  private onUpdate(u: SBattleUpdate) {
    this.busy = false;
    for (const b of this.buttons) b.setAlpha(1);
    this.appendLog(u.log);
    this.setHp(this.foeBar, this.foeHpText, u.foeHp, this.start.maxHp);
    this.setHp(this.myBar, this.myHpText, u.myHp, this.start.mine.maxHp);
    this.start.hp = u.foeHp;
    this.start.mine.hp = u.myHp;
  }

  private onEnd(e: SBattleEnd) {
    this.appendLog(e.log);
    this.appendLog([`Result: ${e.result}`]);
    for (const b of this.buttons) {
      b.disableInteractive();
      b.setAlpha(0.4);
    }
    this.time.delayedCall(1400, () => {
      this.scene.stop("battle");
      this.scene.resume("world");
    });
  }

  private appendLog(lines: string[]) {
    for (const l of lines) this.logLines.push(l);
    while (this.logLines.length > 6) this.logLines.shift();
    this.logText.setText(this.logLines.join("\n"));
  }

  private setHp(bar: Phaser.GameObjects.Rectangle, text: Phaser.GameObjects.Text, hp: number, max: number) {
    const pct = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
    bar.width = 160 * pct;
    bar.fillColor = pct > 0.5 ? 0x5cb85c : pct > 0.2 ? 0xf0ad4e : 0xd9534f;
    text.setText(`${Math.max(0, hp)}/${max}`);
  }
}
