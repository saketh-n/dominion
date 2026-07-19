/**
 * Pure menu / settings state helpers — unit-tested without Phaser/DOM.
 */

export type MenuId = "none" | "party" | "inventory" | "settings";

export interface ClientSettings {
  /** Mute UI/SFX cue flags (client-side). */
  muteSfx: boolean;
  /** Show remote player name tags. */
  showNames: boolean;
  /** Default chat channel preference. */
  chatChannel: "global" | "local";
}

export const DEFAULT_SETTINGS: ClientSettings = {
  muteSfx: false,
  showNames: true,
  chatChannel: "global",
};

export function toggleMenu(current: MenuId, target: MenuId): MenuId {
  if (target === "none") return "none";
  return current === target ? "none" : target;
}

export function applySetting<K extends keyof ClientSettings>(
  settings: ClientSettings,
  key: K,
  value: ClientSettings[K]
): ClientSettings {
  return { ...settings, [key]: value };
}

export function toggleBoolSetting(settings: ClientSettings, key: "muteSfx" | "showNames"): ClientSettings {
  return { ...settings, [key]: !settings[key] };
}

/** World movement blocked while a full-screen menu is open. */
export function menusBlockWorld(menu: MenuId): boolean {
  return menu !== "none";
}
