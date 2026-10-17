/**
 * Chat reply delivery helpers for the chat lens (ChatWorkspacePanel).
 *
 * Live finding (2026-10-17, concord-os.org): during an event-loop stall the
 * "Server busy. Retrying…" banner showed, and the assistant reply for the
 * turn never rendered, though chat.respond had finished and saved it. The
 * reply only appeared after a page reload. Two client gaps:
 *
 *  1. The SSE reader split each network read on "\n" and JSON.parsed each
 *     piece. A `data:` line cut across two reads (the final `done` envelope
 *     carries the whole `out` object and is the longest line) was dropped
 *     silently, so the stream could end with no reply and no error.
 *  2. Any stream/fallback failure ended the turn with nothing (or a "Failed
 *     to send" note) even when the server had completed and persisted it.
 *
 * `createSseParser` keeps partial lines across reads. `findSavedReply` /
 * `waitForSavedReply` read the persisted thread (GET /api/chat/messages)
 * and pick the assistant row for this turn: by `meta.clientTurnId` when
 * the server stamped it, else the first assistant row after the matching
 * user row sent at or after this turn started.
 */

export type SseEvent = Record<string, unknown>;

/** Incremental SSE `data:` line parser that survives lines split across reads. */
export function createSseParser(onEvent: (ev: SseEvent) => void) {
  let buf = '';
  const flushLine = (line: string) => {
    const l = line.replace(/\r$/, '');
    if (!l.startsWith('data:')) return; // comments (":keepalive"), blank separators, other fields
    const payload = l.slice(5).replace(/^ /, '');
    if (!payload) return;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') onEvent(parsed as SseEvent);
    } catch {
      /* malformed event — skip */
    }
  };
  return {
    push(text: string) {
      buf += text;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        flushLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
    },
    /** Call once the stream ended: parses a trailing line with no newline. */
    end() {
      if (buf) flushLine(buf);
      buf = '';
    },
  };
}

export interface SavedChatMessage {
  role: string;
  content: string;
  ts: string | number;
  meta?: Record<string, unknown> | null;
}

function tsMs(ts: string | number | undefined): number {
  if (typeof ts === 'number') return ts;
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) return n;
  const p = Date.parse(String(ts || ''));
  return Number.isFinite(p) ? p : 0;
}

const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The persisted assistant reply for one turn, or null when it is not saved yet.
 * @param sentAtMs when the client sent the turn (local clock; 2 min skew allowed)
 */
export function findSavedReply(
  messages: SavedChatMessage[],
  turn: { clientTurnId?: string | null; userContent: string; sentAtMs: number },
): SavedChatMessage | null {
  const rows = Array.isArray(messages) ? messages : [];
  if (turn.clientTurnId) {
    const byId = rows.find(
      (m) => m.role === 'assistant' && m.meta && m.meta.clientTurnId === turn.clientTurnId,
    );
    if (byId) return byId;
  }
  const want = norm(turn.userContent);
  const floor = turn.sentAtMs - 120_000;
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = rows[i];
    if (m.role !== 'user' || norm(m.content) !== want) continue;
    if (tsMs(m.ts) && tsMs(m.ts) < floor) return null; // an older identical question
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].role === 'user') break;
      if (rows[j].role === 'assistant' && norm(rows[j].content)) return rows[j];
    }
    return null;
  }
  return null;
}

export interface WaitOptions {
  fetchMessages: () => Promise<SavedChatMessage[] | null>;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Poll the saved thread until this turn's reply lands (or time runs out). */
export async function waitForSavedReply(
  turn: { clientTurnId?: string | null; userContent: string; sentAtMs: number },
  opts: WaitOptions,
): Promise<SavedChatMessage | null> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;
  for (;;) {
    if (opts.signal?.aborted) return null;
    try {
      const rows = await opts.fetchMessages();
      const hit = rows ? findSavedReply(rows, turn) : null;
      if (hit) return hit;
    } catch {
      /* busy / offline — keep polling until the deadline */
    }
    if (now() + intervalMs > deadline) return null;
    await sleep(intervalMs);
  }
}

/** GET /api/chat/messages for one session; null on any non-OK answer. */
export async function fetchSessionMessages(sessionId: string, signal?: AbortSignal): Promise<SavedChatMessage[] | null> {
  const res = await fetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}&limit=200`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { ok?: boolean; messages?: SavedChatMessage[] };
  return json?.ok && Array.isArray(json.messages) ? json.messages : null;
}
