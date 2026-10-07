/**
 * Stream one ConKay agent turn from /api/chat-agent/stream — the same
 * runAgentLoop tool-use pipeline the ⌘J overlay uses. Every `tool_call` event
 * is a receipt for a tool the server already ran; every `token` is answer
 * text. Nothing is synthesised client-side.
 */

import { getApiBase } from '@/lib/api/base';

export interface AgentToolCall {
  tool?: string;
  ok?: boolean;
  domain?: string;
  action?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface AgentDone {
  ok: boolean;
  error?: string;
  provider?: string;
  model?: string;
}

export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Split a growing SSE buffer into complete events (blocks ended by a blank
 * line). Returns the events and the unconsumed tail — a block whose end has
 * not arrived yet — to prepend to the next chunk, so an event split across
 * network chunks keeps its `event:` name.
 */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    try {
      const data = JSON.parse(dataLines.join('\n'));
      if (data && typeof data === 'object') events.push({ event, data });
    } catch { /* a malformed block is skipped, not guessed at */ }
  }
  return { events, rest };
}

export async function streamConKayAgent(args: {
  message: string;
  history: Array<{ role: string; content: string }>;
  persona: string;
  signal?: AbortSignal;
  onToken: (chunk: string) => void;
  onToolCall: (call: AgentToolCall) => void;
}): Promise<AgentDone> {
  const res = await fetch(`${getApiBase()}/api/chat-agent/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: args.message, history: args.history, persona: args.persona }),
    signal: args.signal,
  });
  const reader = res.body?.getReader();
  if (!res.ok || !reader) {
    let err = '';
    try { err = String((await res.json())?.error || ''); } catch { /* non-JSON error body */ }
    return { ok: false, error: err || `status_${res.status}` };
  }
  const decoder = new TextDecoder();
  let buf = '';
  let done: AgentDone | null = null;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buf);
    buf = parsed.rest;
    for (const { event, data } of parsed.events) {
      if (event === 'token') args.onToken(String((data as { chunk?: unknown }).chunk ?? ''));
      else if (event === 'tool_call') args.onToolCall(data as AgentToolCall);
      else if (event === 'done') {
        done = {
          ok: data.ok !== false,
          error: data.error ? String(data.error) : undefined,
          provider: data.provider ? String(data.provider) : undefined,
          model: data.model ? String(data.model) : undefined,
        };
      }
    }
  }
  return done ?? { ok: false, error: 'stream_ended_without_done' };
}

/** The agent's failure, said plainly. Study edits never depend on the model. */
export function agentFailure(error?: string): string {
  const e = String(error || '');
  if (/fetch failed|ECONNREFUSED|llm|model|provider|ollama|no_brain|unavailable|503/i.test(e)) {
    return 'ConKay’s language model is not reachable right now, so I can’t answer free-form questions. Study edits, FEA runs, sweeps, saving and keeping as a DTU still work.';
  }
  if (/401|no_actor/i.test(e)) return 'Sign in to talk to ConKay.';
  return `ConKay could not answer${e ? ` (${e})` : ''}.`;
}
