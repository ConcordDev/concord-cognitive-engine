import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamConKayAgent } from '@/lib/conkay/agent-stream';

vi.mock('@/lib/api/base', () => ({ getApiBase: () => 'http://test.local' }));

function sseResponse(blocks: string[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(blocks.join('')));
      controller.close();
    },
  });
  return { ok: true, status: 200, body };
}

function runWith(doneData: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
    'event: token\ndata: {"chunk":"hi"}\n\n',
    `event: done\ndata: ${JSON.stringify(doneData)}\n\n`,
  ])));
  return streamConKayAgent({
    message: 'q', history: [], persona: 'p',
    onToken: () => {}, onToolCall: () => {},
  });
}

describe('streamConKayAgent done parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes confidence and confidenceReason from a backup-model done event', async () => {
    const done = await runWith({
      ok: true, provider: 'concord_default', model: 'concord-utility-2b:latest',
      turns: 1, answerConfidence: 'low', answerConfidenceReason: 'GPU brain offline — answered by small local model',
    });
    expect(done.confidence).toBe('low');
    expect(done.confidenceReason).toBe('GPU brain offline — answered by small local model');
  });

  it('leaves confidence undefined when the server sends none (pod-served answer)', async () => {
    const done = await runWith({ ok: true, provider: 'concord_default', model: 'qwen3:30b', turns: 1 });
    expect(done.ok).toBe(true);
    expect(done.confidence).toBeUndefined();
    expect(done.confidenceReason).toBeUndefined();
  });

  it('ignores a non-low confidence value', async () => {
    const done = await runWith({ ok: true, answerConfidence: 'high', answerConfidenceReason: 'x' });
    expect(done.confidence).toBeUndefined();
  });
});
