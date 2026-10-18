import { describe, it, expect, vi } from 'vitest';
import { agentFailure, parseSseBuffer } from '@/lib/conkay/agent-stream';

describe('parseSseBuffer', () => {
  it('parses complete events and keeps a partial block for the next chunk', () => {
    const first = parseSseBuffer('event: status\ndata: {"phase":"started"}\n\nevent: tool_call\ndata: {"tool":"run_');
    expect(first.events).toEqual([{ event: 'status', data: { phase: 'started' } }]);
    const second = parseSseBuffer(`${first.rest}lens_action","ok":true}\n\nevent: token\ndata: {"chunk":"hi"}\n\n`);
    expect(second.events).toEqual([
      { event: 'tool_call', data: { tool: 'run_lens_action', ok: true } },
      { event: 'token', data: { chunk: 'hi' } },
    ]);
    expect(second.rest).toBe('');
  });

  it('keeps the event name when the split falls between event and data lines', () => {
    const a = parseSseBuffer('event: done\n');
    expect(a.events).toEqual([]);
    const b = parseSseBuffer(`${a.rest}data: {"ok":true}\n\n`);
    expect(b.events).toEqual([{ event: 'done', data: { ok: true } }]);
  });

  it('skips malformed data instead of guessing', () => {
    expect(parseSseBuffer('event: token\ndata: {nope\n\n').events).toEqual([]);
  });
});

describe('agentFailure', () => {
  it('says the model is offline without blaming the study tools', () => {
    expect(agentFailure('fetch failed')).toMatch(/language model is not reachable/);
    expect(agentFailure('fetch failed')).toMatch(/FEA runs/);
    expect(agentFailure('status_401')).toBe('Sign in to talk to ConKay.');
    expect(agentFailure('weird')).toBe('ConKay could not answer (weird).');
  });
});

describe('streamConKayAgent', () => {
  const enc = new TextEncoder();
  function sse(chunks: string[], status = 200) {
    let i = 0;
    return {
      ok: status < 400,
      status,
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true }) }) },
      json: async () => ({ error: 'no_actor' }),
    };
  }

  it('relays tokens and tool receipts in order and returns the done event', async () => {
    const { streamConKayAgent } = await import('@/lib/conkay/agent-stream');
    const fetchMock = vi.fn().mockResolvedValue(sse([
      'event: tool_call\ndata: {"tool":"run_lens_action","domain":"engineering","action":"beamStudy","ok":true}\n\nevent: tok',
      'en\ndata: {"chunk":"Hello "}\n\nevent: token\ndata: {"chunk":"there"}\n\n',
      'event: done\ndata: {"ok":true,"model":"m1"}\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const tokens: string[] = [];
    const tools: unknown[] = [];
    const done = await streamConKayAgent({ message: 'hi', history: [], persona: 'p', onToken: (t) => tokens.push(t), onToolCall: (c) => tools.push(c) });
    expect(done).toEqual({ ok: true, error: undefined, provider: undefined, model: 'm1' });
    expect(tokens.join('')).toBe('Hello there');
    expect(tools).toEqual([{ tool: 'run_lens_action', domain: 'engineering', action: 'beamStudy', ok: true }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: 'hi', history: [], persona: 'p' });
    vi.unstubAllGlobals();
  });

  it('returns the server error for a refused request, and flags a stream that never finished', async () => {
    const { streamConKayAgent } = await import('@/lib/conkay/agent-stream');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([], 401)));
    expect(await streamConKayAgent({ message: 'x', history: [], persona: '', onToken: () => {}, onToolCall: () => {} }))
      .toEqual({ ok: false, error: 'no_actor' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(['event: token\ndata: {"chunk":"a"}\n\n'])));
    expect(await streamConKayAgent({ message: 'x', history: [], persona: '', onToken: () => {}, onToolCall: () => {} }))
      .toEqual({ ok: false, error: 'stream_ended_without_done' });
    vi.unstubAllGlobals();
  });
});

describe('artifacts and tool-call leaks (ConKay tools-by-default)', () => {
  const enc = new TextEncoder();
  it('relays artifact events to onArtifact', async () => {
    const { streamConKayAgent } = await import('@/lib/conkay/agent-stream');
    const chunks = [
      'event: artifact\ndata: {"kind":"song","projectId":"p1","title":"T"}\n\nevent: arti',
      'fact\ndata: {"kind":"mesh","positions":[0,0,0,1,0,0,0,1,0],"indices":[0,1,2]}\n\nevent: done\ndata: {"ok":true}\n\n',
    ];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true }) }) },
    }));
    const got: Array<Record<string, unknown>> = [];
    await streamConKayAgent({ message: 'm', history: [], persona: 'p', onToken: () => {}, onToolCall: () => {}, onArtifact: (a) => got.push(a) });
    expect(got.map((a) => a.kind)).toEqual(['song', 'mesh']);
  });

  it('strips raw [TOOL_CALL: …] markers and reports the leak', async () => {
    const { stripToolCallLeak, artifactKey } = await import('@/lib/conkay/agent-stream');
    expect(stripToolCallLeak('[TOOL_CALL: {"tool":"run_lens_action","params":{"domain":"music","action":"track-list","params":{}}}]'))
      .toEqual({ text: '', leaked: true });
    expect(stripToolCallLeak('Here you go. [TOOL_CALL: {"tool":"x","params":{"a":[1,2]}}] Done.')).toEqual({ text: 'Here you go.  Done.', leaked: true });
    expect(stripToolCallLeak('plain')).toEqual({ text: 'plain', leaked: false });
    expect(artifactKey({ kind: 'song', projectId: 'p1' })).toBe(artifactKey({ kind: 'song', projectId: 'p1', title: 'x' }));
  });
});
