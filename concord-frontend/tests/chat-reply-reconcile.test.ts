// Live finding 2026-10-17: a completed, saved chat reply never rendered in
// the chat lens after a "Server busy. Retrying…" banner; it showed only on
// reload. Pins the SSE line buffering and the saved-reply recovery.
import { describe, it, expect } from 'vitest';
import { createSseParser, findSavedReply, waitForSavedReply, type SavedChatMessage } from '@/lib/chat/reply-reconcile';

describe('createSseParser', () => {
  it('keeps a data line split across network reads (the done envelope)', () => {
    const events: Record<string, unknown>[] = [];
    const p = createSseParser((e) => events.push(e));
    const done = `data: ${JSON.stringify({ ok: true, done: true, out: { reply: 'TANGERINE-42 recorded.', sources: [{ url: 'https://x.test' }] } })}\n\n`;
    const all = `:keepalive\n\ndata: ${JSON.stringify({ ok: true, chunk: 'TANGERINE-42 ', done: false })}\n\n${done}`;
    // Cut in the middle of both JSON payloads.
    p.push(all.slice(0, 30));
    p.push(all.slice(30, all.length - 40));
    p.push(all.slice(all.length - 40));
    p.end();
    expect(events.map((e) => (e.done ? 'done' : e.chunk))).toEqual(['TANGERINE-42 ', 'done']);
    expect((events[1].out as { reply: string }).reply).toBe('TANGERINE-42 recorded.');
  });
  it('parses a final line with no trailing newline and ignores comments / bad JSON', () => {
    const events: Record<string, unknown>[] = [];
    const p = createSseParser((e) => events.push(e));
    p.push(':keepalive\n\ndata: {oops\n\ndata: {"done":true}');
    p.end();
    expect(events).toEqual([{ done: true }]);
  });
});

const thread: SavedChatMessage[] = [
  { role: 'user', content: 'Remember this codeword: TANGERINE-42.', ts: '2026-10-17T13:03:59.895Z' },
  { role: 'assistant', content: 'TANGERINE-42 recorded.', ts: '2026-10-17T13:04:10.701Z', meta: { llmUsed: true } },
];
const sentAtMs = Date.parse('2026-10-17T13:03:59.800Z');

describe('findSavedReply', () => {
  it('matches by clientTurnId when the server stamped it', () => {
    const rows: SavedChatMessage[] = [
      ...thread,
      { role: 'user', content: 'again', ts: '2026-10-17T13:05:00Z' },
      { role: 'assistant', content: 'second', ts: '2026-10-17T13:05:05Z', meta: { clientTurnId: 'user-2' } },
    ];
    expect(findSavedReply(rows, { clientTurnId: 'user-2', userContent: 'nope', sentAtMs })?.content).toBe('second');
  });
  it('falls back to the assistant row after the matching user row of this turn', () => {
    expect(findSavedReply(thread, { clientTurnId: 'user-x', userContent: 'Remember this codeword:  TANGERINE-42.', sentAtMs })?.content)
      .toBe('TANGERINE-42 recorded.');
  });
  it('does not return a reply to an older identical question, or one not saved yet', () => {
    expect(findSavedReply(thread, { userContent: 'Remember this codeword: TANGERINE-42.', sentAtMs: sentAtMs + 3_600_000 })).toBeNull();
    expect(findSavedReply(thread.slice(0, 1), { userContent: 'Remember this codeword: TANGERINE-42.', sentAtMs })).toBeNull();
  });
});

describe('waitForSavedReply', () => {
  it('polls through busy answers until the reply is saved', async () => {
    let calls = 0;
    let clock = 0;
    const hit = await waitForSavedReply(
      { userContent: 'Remember this codeword: TANGERINE-42.', sentAtMs },
      {
        fetchMessages: async () => {
          calls++;
          if (calls === 1) throw new Error('503 service_overloaded');
          if (calls === 2) return thread.slice(0, 1);
          return thread;
        },
        intervalMs: 3000,
        timeoutMs: 60_000,
        sleep: async (ms) => { clock += ms; },
        now: () => clock,
      },
    );
    expect(hit?.content).toBe('TANGERINE-42 recorded.');
    expect(calls).toBe(3);
  });
  it('gives up at the deadline', async () => {
    let clock = 0;
    const hit = await waitForSavedReply(
      { userContent: 'q', sentAtMs },
      { fetchMessages: async () => [], intervalMs: 1000, timeoutMs: 5000, sleep: async (ms) => { clock += ms; }, now: () => clock },
    );
    expect(hit).toBeNull();
  });
});
