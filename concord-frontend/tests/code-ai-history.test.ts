import { describe, expect, it, vi } from 'vitest';
import { codeAiSessionId, codeAiSessionListed, fetchCodeAiHistory, type HistoryRequest } from '@/components/code/codeAiHistory';

describe('code AI history', () => {
  it('does not GET /api/chat/messages when the code-ai session does not exist', async () => {
    const urls: string[] = [];
    const request: HistoryRequest = async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ ok: true, sessions: [{ id: 'chat-other' }] }) };
    };
    const result = await fetchCodeAiHistory(codeAiSessionId('ada'), request);
    expect(result.fetchedMessages).toBe(false);
    expect(result.messages).toEqual([]);
    expect(urls.some((u) => u.includes('/api/chat/messages'))).toBe(false);
    expect(codeAiSessionListed([{ id: 'chat-other' }], 'code-ai-ada')).toBe(false);
  });

  it('reads messages only after the session is listed', async () => {
    const urls: string[] = [];
    const request: HistoryRequest = async (url) => {
      urls.push(url);
      if (url.includes('/api/chat/sessions')) {
        return { ok: true, json: async () => ({ ok: true, sessions: [{ id: 'code-ai-ada' }] }) };
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          messages: [{ role: 'assistant', content: 'prior note', ts: '2026-10-11T00:00:00.000Z' }],
        }),
      };
    };
    const result = await fetchCodeAiHistory('code-ai-ada', request);
    expect(result.fetchedMessages).toBe(true);
    expect(result.messages[0]?.content).toBe('prior note');
    expect(urls.filter((u) => u.includes('/api/chat/messages'))).toHaveLength(1);
  });

  it('skips the messages GET when the session list itself fails', async () => {
    const request = vi.fn<HistoryRequest>(async () => ({ ok: false, json: async () => ({}) }));
    const result = await fetchCodeAiHistory('code-ai-ada', request);
    expect(result.fetchedMessages).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
