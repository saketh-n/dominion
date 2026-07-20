/**
 * Overlay menus: Party (full), Inventory, Settings.
 * DOM-based so they stay interactive and unit-testable without Phaser.
 */
import type { SPartyEntry, SInventoryEntry, ClientSettings, MenuId } from "@game/shared";
import {
  SPECIES,
  DEFAULT_SETTINGS,
  toggleMenu,
  toggleBoolSetting,
  menusBlockWorld,
  START_MENU_ITEMS,
} from "@game/shared";

const SETTINGS_KEY = "dominion.settings";

export function loadSettings(): ClientSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ClientSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: ClientSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export type MenuCallbacks = {
  onSettingsChange?: (s: ClientSettings) => void;
  onClose?: () => void;
  /** Fired when Bag is opened from Start (fetch inventory). */
  onOpenInventory?: () => void;
};

export class GameMenus {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private menu: MenuId = "none";
  private party: SPartyEntry[] = [];
  private inventory: SInventoryEntry[] = [];
  private settings: ClientSettings;
  private cbs: MenuCallbacks;

  constructor(parent: HTMLElement = document.body, cbs: MenuCallbacks = {}) {
    this.cbs = cbs;
    this.settings = loadSettings();
    this.root = document.createElement("div");
    this.root.id = "game-menus";
    Object.assign(this.root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2000",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(8,6,12,0.55)",
      fontFamily: "ui-monospace, Menlo, monospace",
      color: "#e8dcc0",
    } as CSSStyleDeclaration);

    this.panel = document.createElement("div");
    Object.assign(this.panel.style, {
      width: "min(420px, 92vw)",
      maxHeight: "80vh",
      overflowY: "auto",
      background: "rgba(22,18,28,0.96)",
      border: "2px solid #6a5438",
      borderRadius: "10px",
      padding: "14px 16px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    } as CSSStyleDeclaration);
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);

    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
  }

  get openMenu(): MenuId {
    return this.menu;
  }

  get currentSettings(): ClientSettings {
    return this.settings;
  }

  blocksWorld(): boolean {
    return menusBlockWorld(this.menu);
  }

  setParty(entries: SPartyEntry[]): void {
    this.party = entries ?? [];
    if (this.menu === "party") this.render();
  }

  setInventory(entries: SInventoryEntry[]): void {
    this.inventory = entries ?? [];
    if (this.menu === "inventory" || this.menu === "start") this.render();
  }

  /** Toggle or open a menu; returns new menu id. */
  toggle(target: MenuId): MenuId {
    this.menu = toggleMenu(this.menu, target);
    this.syncVisibility();
    this.render();
    return this.menu;
  }

  open(target: Exclude<MenuId, "none">): void {
    this.menu = target;
    this.syncVisibility();
    this.render();
  }

  /** Open a submenu from the Start list (Party / Bag / Settings). */
  openFromStart(target: "party" | "inventory" | "settings"): void {
    this.open(target);
  }

  close(): void {
    this.menu = "none";
    this.syncVisibility();
    this.cbs.onClose?.();
  }

  private syncVisibility(): void {
    this.root.style.display = this.menu === "none" ? "none" : "flex";
  }

  private render(): void {
    if (this.menu === "none") {
      this.panel.innerHTML = "";
      return;
    }
    if (this.menu === "start") {
      this.renderStartList();
      return;
    }
    const title =
      this.menu === "party" ? "Party" : this.menu === "inventory" ? "Bag" : "Settings";
    let body = "";
    if (this.menu === "party") body = this.renderParty();
    else if (this.menu === "inventory") body = this.renderInventory();
    else body = this.renderSettings();

    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:16px;color:#e8c070;letter-spacing:0.04em">${title}</div>
        <button data-act="close" style="${btnStyle()}">Esc / Close</button>
      </div>
      ${body}
      <div style="margin-top:12px;opacity:0.55;font-size:11px">
        Keys: Enter start · P party · I bag · O settings · Esc close · H go home · E enter · X exit
      </div>
    `;
    this.bindPanelButtons();
  }

  /** Pokémon-style Start menu list. */
  private renderStartList(): void {
    const rows = START_MENU_ITEMS.map(
      (it) =>
        `<button data-start="${it.id}" style="display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;${btnStyle()}font-size:14px">
          ▶ ${esc(it.label)}
        </button>`
    ).join("");
    this.panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:16px;color:#e8c070;letter-spacing:0.04em">MENU</div>
        <button data-act="close" style="${btnStyle()}">Esc</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px">${rows}</div>
      <div style="margin-top:12px;opacity:0.55;font-size:11px">
        Enter toggles · P / I / O jump · Esc closes
      </div>
    `;
    this.bindPanelButtons();
    this.panel.querySelectorAll("button[data-start]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = (el as HTMLElement).dataset.start;
        if (id === "close") this.close();
        else if (id === "party") this.open("party");
        else if (id === "inventory") {
          // Caller may also fetch; open bag panel immediately.
          this.open("inventory");
          this.cbs.onOpenInventory?.();
        } else if (id === "settings") this.open("settings");
      });
    });
  }

  private bindPanelButtons(): void {
    this.panel.querySelectorAll("button[data-act]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = (el as HTMLElement).dataset.act;
        if (act === "close") this.close();
        if (act === "mute") this.flip("muteSfx");
        if (act === "names") this.flip("showNames");
        if (act === "chat-global") this.setChat("global");
        if (act === "chat-local") this.setChat("local");
      });
    });
  }

  private flip(key: "muteSfx" | "showNames"): void {
    this.settings = toggleBoolSetting(this.settings, key);
    saveSettings(this.settings);
    this.cbs.onSettingsChange?.(this.settings);
    this.render();
  }

  private setChat(ch: "global" | "local"): void {
    this.settings = { ...this.settings, chatChannel: ch };
    saveSettings(this.settings);
    this.cbs.onSettingsChange?.(this.settings);
    this.render();
  }

  private renderParty(): string {
    if (!this.party.length) {
      return `<div style="opacity:0.7">No creatures in party yet.</div>`;
    }
    return this.party
      .map((e, i) => {
        const sp = SPECIES[e.speciesId];
        const name = sp?.name ?? `Species ${e.speciesId}`;
        const el = sp?.element ?? "?";
        const pct = e.maxHp > 0 ? Math.round((e.hp / e.maxHp) * 100) : 0;
        const bar = pct > 50 ? "#5cb85c" : pct > 20 ? "#f0ad4e" : "#d9534f";
        return `<div style="border:1px solid #3a3428;border-radius:6px;padding:8px;margin:6px 0;background:#1a1620">
          <div style="display:flex;justify-content:space-between">
            <strong>${i + 1}. ${esc(name)}</strong>
            <span style="opacity:0.75">Lv ${e.level} · ${esc(String(el))}</span>
          </div>
          <div style="background:#2a2430;height:8px;border-radius:3px;margin:6px 0">
            <div style="width:${pct}%;height:100%;background:${bar};border-radius:3px"></div>
          </div>
          <div style="opacity:0.7;font-size:11px">HP ${e.hp} / ${e.maxHp}</div>
        </div>`;
      })
      .join("");
  }

  private renderInventory(): string {
    if (!this.inventory.length) {
      return `<div style="opacity:0.7">Bag is empty.</div>`;
    }
    return (
      `<div style="opacity:0.8;margin-bottom:6px">Items</div>` +
      this.inventory
        .map(
          (it) => `<div style="display:flex;gap:10px;border-bottom:1px solid #2a2430;padding:8px 0">
          <div style="flex:1">
            <div style="color:#e8c070">${esc(it.name)} <span style="opacity:0.7">×${it.qty}</span></div>
            <div style="opacity:0.65;font-size:11px;margin-top:2px">${esc(it.description)}</div>
          </div>
        </div>`
        )
        .join("")
    );
  }

  private renderSettings(): string {
    const s = this.settings;
    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        <label style="display:flex;justify-content:space-between;align-items:center">
          <span>Mute SFX cues</span>
          <button data-act="mute" style="${btnStyle()}">${s.muteSfx ? "ON" : "OFF"}</button>
        </label>
        <label style="display:flex;justify-content:space-between;align-items:center">
          <span>Show player names</span>
          <button data-act="names" style="${btnStyle()}">${s.showNames ? "ON" : "OFF"}</button>
        </label>
        <div>
          <div style="margin-bottom:6px">Default chat channel</div>
          <div style="display:flex;gap:8px">
            <button data-act="chat-global" style="${btnStyle(s.chatChannel === "global")}">Global</button>
            <button data-act="chat-local" style="${btnStyle(s.chatChannel === "local")}">Local</button>
          </div>
        </div>
      </div>
    `;
  }

  destroy(): void {
    this.root.remove();
  }
}

function btnStyle(active = false): string {
  return [
    "cursor:pointer",
    "font:inherit",
    "font-size:12px",
    "padding:4px 10px",
    "border-radius:4px",
    active ? "background:#5a4028;border:1px solid #c8a060;color:#ffe8a0" : "background:#2a2430;border:1px solid #4a4030;color:#e8dcc0",
  ].join(";");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
