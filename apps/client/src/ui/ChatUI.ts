import type { ChatChannel, SChatMsg } from "@game/shared";
import { sendChat } from "../net/connection";

/**
 * DOM chat overlay (global / local). Kept outside Phaser so it stays
 * interactive during scene transitions and is easy to drive from tests.
 */
export type ChatUIOptions = {
  /**
   * When true (default historically), bare Enter focuses the chat input.
   * Set false so the game can use Enter for the Start menu; users still
   * click the input or Tab to it for chat.
   */
  captureEnter?: boolean;
  parent?: HTMLElement;
};

export class ChatUI {
  readonly root: HTMLDivElement;
  private logEl: HTMLDivElement;
  private input: HTMLInputElement;
  private channel: ChatChannel = "global";
  private globalBtn: HTMLButtonElement;
  private localBtn: HTMLButtonElement;
  private visible = true;
  private captureEnter: boolean;

  constructor(parentOrOpts: HTMLElement | ChatUIOptions = document.body) {
    const opts: ChatUIOptions =
      parentOrOpts instanceof HTMLElement
        ? { parent: parentOrOpts }
        : parentOrOpts ?? {};
    const parent = opts.parent ?? document.body;
    this.captureEnter = opts.captureEnter !== false;

    this.root = document.createElement("div");
    this.root.id = "chat-ui";
    Object.assign(this.root.style, {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      width: "340px",
      maxWidth: "42vw",
      zIndex: "1000",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: "12px",
      color: "#e8dcc0",
      pointerEvents: "auto",
    } as CSSStyleDeclaration);

    this.logEl = document.createElement("div");
    Object.assign(this.logEl.style, {
      background: "rgba(20,18,26,0.82)",
      border: "1px solid #3a3428",
      borderRadius: "6px 6px 0 0",
      padding: "6px 8px",
      height: "140px",
      overflowY: "auto",
      lineHeight: "1.35",
    } as CSSStyleDeclaration);

    const bar = document.createElement("div");
    Object.assign(bar.style, {
      display: "flex",
      gap: "4px",
      background: "rgba(20,18,26,0.92)",
      border: "1px solid #3a3428",
      borderTop: "none",
      borderRadius: "0 0 6px 6px",
      padding: "4px",
    } as CSSStyleDeclaration);

    this.globalBtn = this.mkChannelBtn("global", "Global");
    this.localBtn = this.mkChannelBtn("local", "Local");
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.placeholder = "Enter to chat…";
    this.input.maxLength = 200;
    Object.assign(this.input.style, {
      flex: "1",
      background: "#1c1822",
      border: "1px solid #4a4030",
      color: "#e8dcc0",
      borderRadius: "3px",
      padding: "4px 6px",
      outline: "none",
      font: "inherit",
    } as CSSStyleDeclaration);

    this.input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.input.value.trim();
        if (text) {
          sendChat(this.channel, text);
          this.input.value = "";
        }
      }
      if (e.key === "Escape") {
        this.input.blur();
      }
    });
    // Prevent Phaser from also handling keys while typing
    this.input.addEventListener("keyup", (e) => e.stopPropagation());
    this.input.addEventListener("keypress", (e) => e.stopPropagation());

    bar.append(this.globalBtn, this.localBtn, this.input);
    this.root.append(this.logEl, bar);
    parent.appendChild(this.root);
    this.refreshChannelButtons();

    window.addEventListener("keydown", this.onToggle);
  }

  private onToggle = (e: KeyboardEvent) => {
    if (
      this.captureEnter &&
      e.key === "Enter" &&
      document.activeElement !== this.input &&
      !(e.target instanceof HTMLInputElement)
    ) {
      e.preventDefault();
      this.input.focus();
    }
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && document.activeElement === this.input) {
      e.preventDefault();
      this.channel = this.channel === "global" ? "local" : "global";
      this.refreshChannelButtons();
    }
  };

  private mkChannelBtn(ch: ChatChannel, label: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    Object.assign(b.style, {
      background: "#2a2430",
      border: "1px solid #4a4030",
      color: "#c8b890",
      borderRadius: "3px",
      padding: "2px 6px",
      cursor: "pointer",
      font: "inherit",
    } as CSSStyleDeclaration);
    b.addEventListener("click", () => {
      this.channel = ch;
      this.refreshChannelButtons();
      this.input.focus();
    });
    return b;
  }

  private refreshChannelButtons() {
    const active = { background: "#4a3a20", color: "#ffe8a0", borderColor: "#c8a040" };
    const idle = { background: "#2a2430", color: "#c8b890", borderColor: "#4a4030" };
    Object.assign(this.globalBtn.style, this.channel === "global" ? active : idle);
    Object.assign(this.localBtn.style, this.channel === "local" ? active : idle);
  }

  push(msg: SChatMsg): void {
    const line = document.createElement("div");
    const tag = msg.channel === "local" ? "L" : "G";
    const color = msg.channel === "local" ? "#8fd4ff" : "#e8dcc0";
    line.innerHTML = `<span style="color:#8a8070">[${tag}]</span> <b style="color:${color}">${escapeHtml(
      msg.from
    )}</b>: ${escapeHtml(msg.text)}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    while (this.logEl.childElementCount > 80) {
      this.logEl.firstElementChild?.remove();
    }
  }

  system(text: string): void {
    const line = document.createElement("div");
    line.style.color = "#c8a060";
    line.textContent = `• ${text}`;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? "block" : "none";
  }

  setDefaultChannel(ch: ChatChannel): void {
    this.channel = ch;
    this.refreshChannelButtons();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onToggle);
    this.root.remove();
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
