import type { SPartyEntry } from "@game/shared";
import { SPECIES } from "@game/shared";

/** Small party strip in the top-right corner. */
export class PartyHUD {
  readonly root: HTMLDivElement;
  private entries: SPartyEntry[] = [];

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.id = "party-hud";
    Object.assign(this.root.style, {
      position: "fixed",
      top: "10px",
      right: "12px",
      zIndex: "1000",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: "11px",
      color: "#e8dcc0",
      background: "rgba(20,18,26,0.82)",
      border: "1px solid #3a3428",
      borderRadius: "6px",
      padding: "6px 8px",
      minWidth: "140px",
      pointerEvents: "none",
    } as CSSStyleDeclaration);
    parent.appendChild(this.root);
    this.render();
  }

  setParty(entries: SPartyEntry[]): void {
    this.entries = entries ?? [];
    this.render();
  }

  private render(): void {
    if (!this.entries.length) {
      this.root.innerHTML = `<div style="opacity:0.7">Party: —</div>`;
      return;
    }
    this.root.innerHTML =
      `<div style="color:#c8a060;margin-bottom:4px">Party</div>` +
      this.entries
        .map((e) => {
          const name = SPECIES[e.speciesId]?.name ?? `?${e.speciesId}`;
          const pct = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 0;
          const barColor = pct > 50 ? "#5cb85c" : pct > 20 ? "#f0ad4e" : "#d9534f";
          return `<div style="margin:2px 0">
            <div>${name} <span style="opacity:0.7">Lv${e.level}</span></div>
            <div style="background:#2a2430;height:4px;border-radius:2px;margin-top:2px">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:2px"></div>
            </div>
            <div style="opacity:0.6;font-size:10px">${e.hp}/${e.maxHp}</div>
          </div>`;
        })
        .join("");
  }

  destroy(): void {
    this.root.remove();
  }
}
