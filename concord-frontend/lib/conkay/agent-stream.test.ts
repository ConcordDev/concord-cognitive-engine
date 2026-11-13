import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamConKayAgent } from './agent-stream';

function sseResponse(text: string) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: bytes })) }) },
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('streamConKayAgent cockpit events', () => {
  it('passes cockpit:* events to onCockpit and never treats them as tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      'event: cockpit:step\ndata: {"runId":"run_1","seq":1}\n\n' +
      'event: token\ndata: {"chunk":"hi"}\n\n' +
      'event: done\ndata: {"ok":true,"cockpitRunId":"run_1"}\n\n',
    )));
    const onToken = vi.fn();
    const onCockpit = vi.fn();
    const done = await streamConKayAgent({ message: 'x', history: [], persona: '', onToken, onToolCall: vi.fn(), onCockpit });
    expect(onCockpit).toHaveBeenCalledTimes(1);
    expect(onCockpit.mock.calls[0][0].runId).toBe('run_1');
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith('hi');
    expect(done.cockpitRunId).toBe('run_1');
  });
});
