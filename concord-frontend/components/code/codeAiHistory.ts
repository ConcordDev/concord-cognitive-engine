/**
 * Code-lens AI chat history.
 *
 * The session id is `code-ai-<userId>`. That row does not exist until the
 * first turn is persisted. GET /api/chat/messages on a missing id is a 404
 * on every Code load. List the caller's sessions first and only read
 * messages when this id is already there.
 */

export function codeAiSessionId(userId: string): string {
  return `code-ai-${userId}`;
}

export function codeAiSessionListed(
  sessions: Array<{ id?: string } | null | undefined> | null | undefined,
  sessionId: string,
): boolean {
  if (!sessionId || !Array.isArray(sessions)) return false;
  return sessions.some((s) => s?.id === sessionId);
}

export interface CodeAiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  dtuRefs?: Array<{ id: string; title: string | null; tier: string | null }>;
}

export type HistoryResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

export type HistoryRequest = (url: string, init?: RequestInit) => Promise<HistoryResponse>;

interface ListedSession {
  id?: string;
}

interface RawMessage {
  role?: string;
  content?: string;
  ts?: string;
  meta?: Record<string, unknown>;
}

export async function fetchCodeAiHistory(
  sessionId: string,
  request: HistoryRequest,
): Promise<{ fetchedMessages: boolean; messages: CodeAiHistoryMessage[] }> {
  const sid = String(sessionId || '').trim();
  if (!sid) return { fetchedMessages: false, messages: [] };

  const list = await request('/api/chat/sessions?limit=200', { credentials: 'include' });
  if (!list.ok) return { fetchedMessages: false, messages: [] };
  const listed = await list.json() as { ok?: boolean; sessions?: ListedSession[] };
  if (listed?.ok === false || !codeAiSessionListed(listed?.sessions, sid)) {
    return { fetchedMessages: false, messages: [] };
  }

  const res = await request(
    `/api/chat/messages?sessionId=${encodeURIComponent(sid)}&limit=200`,
    { credentials: 'include' },
  );
  if (!res.ok) return { fetchedMessages: true, messages: [] };
  const json = await res.json() as { ok?: boolean; messages?: RawMessage[] };
  if (!json || json.ok === false || !Array.isArray(json.messages)) {
    return { fetchedMessages: true, messages: [] };
  }
  const messages = json.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const meta = (m.meta || {}) as Record<string, unknown>;
      return {
        role: m.role as 'user' | 'assistant',
        content: String(m.content || ''),
        ts: new Date(String(m.ts || '')).getTime() || Date.now(),
        dtuRefs: Array.isArray(meta.dtuRefs) ? meta.dtuRefs as CodeAiHistoryMessage['dtuRefs'] : undefined,
      };
    });
  return { fetchedMessages: true, messages };
}
