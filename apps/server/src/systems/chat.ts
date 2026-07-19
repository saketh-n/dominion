import { AOI_RADIUS, ChatChannel, SChatMsg } from "@game/shared";

export interface ChatSpeaker {
  sessionId: string;
  name: string;
  x: number;
  y: number;
  place: string;
}

export interface ChatPeer {
  sessionId: string;
  x: number;
  y: number;
  place: string;
}

/**
 * Decide which session ids receive a chat message.
 * Global → everyone; local → same place within AOI_RADIUS (Chebyshev).
 */
export function chatRecipients(
  from: ChatSpeaker,
  channel: ChatChannel,
  peers: Iterable<ChatPeer>
): string[] {
  if (channel === "global") {
    const ids: string[] = [];
    for (const p of peers) ids.push(p.sessionId);
    return ids;
  }
  const out: string[] = [];
  for (const other of peers) {
    if (other.place !== from.place) continue;
    if (Math.abs(other.x - from.x) > AOI_RADIUS || Math.abs(other.y - from.y) > AOI_RADIUS) continue;
    out.push(other.sessionId);
  }
  return out;
}

export function buildChatPayload(
  from: ChatSpeaker,
  channel: ChatChannel,
  text: string,
  ts = Date.now()
): SChatMsg {
  return { channel, from: from.name, fromId: from.sessionId, text, ts };
}
