import { describe, it, expect, beforeEach } from 'vitest';
import { chatFailure, streamResult } from './chatStreamResult';
import { adoptChatOwner, loadSessionId, saveSessionId, saveConversations, saveMessagesForSession, loadConversations, loadMessagesForSession } from './chatLocalStore';

describe('streamResult', () => {
  it('surfaces out.ok=false (session_forbidden) instead of an empty reply', () => {
    const r = streamResult(
      { ok: false, error: 'session_forbidden', reason: 'not_owner_or_participant' },
      { ok: true, done: true },
      '',
    );
    expect(r.reply).toBe('');
    expect(r.error).toBe('session_forbidden');
    expect(r.ok).toBe(false);
    expect(chatFailure(r)).toEqual({
      kind: 'session_forbidden',
      message: 'This conversation belongs to a different account. Starting a new chat.',
    });
  });

  it('surfaces the catch envelope (top-level error, no out) with its errorId', () => {
    const r = streamResult(null, { ok: false, error: 'boom', errorId: 'err_9', done: true }, '');
    expect(chatFailure(r)).toEqual({ kind: 'error', message: 'Error: boom (ref err_9)' });
  });

  it('a normal answer is not a failure and keeps its fields', () => {
    const r = streamResult({ ok: true, reply: 'hi', refs: [1] }, { ok: true, done: true }, 'hi');
    expect(r.reply).toBe('hi');
    expect(r.refs).toEqual([1]);
    expect(chatFailure(r)).toBeNull();
  });
});

describe('chatFailure', () => {
  it('maps a buffered {ok:false} macro result', () => {
    expect(chatFailure({ ok: false, error: 'rate_limited' })).toEqual({ kind: 'error', message: 'Error: rate_limited' });
  });
  it('keeps the generic path for a real empty reply with ok !== false', () => {
    expect(chatFailure({ reply: '' })).toBeNull();
    expect(chatFailure({ ok: true })).toBeNull();
  });
  it('never hides an answer behind an error flag', () => {
    expect(chatFailure({ ok: false, reply: 'partial answer' })).toBeNull();
  });
});

describe('adoptChatOwner', () => {
  beforeEach(() => localStorage.clear());

  it('clears the previous account\'s session, conversations and threads on a different user', () => {
    saveSessionId('sess-A');
    saveConversations([{ id: 'sess-A', title: 't', lastMessage: '', updatedAt: '', messageCount: 1 }]);
    saveMessagesForSession('sess-A', [{ id: 'm', role: 'user', content: 'x', timestamp: '' }] as never);
    expect(adoptChatOwner('user-A')).toBe(true); // legacy session dropped, owner stamped
    saveSessionId('sess-A');
    expect(adoptChatOwner('user-A')).toBe(false); // same user: untouched
    expect(loadSessionId()).toBe('sess-A');
    expect(adoptChatOwner('user-B')).toBe(true);
    expect(loadSessionId()).toBeNull();
    expect(loadConversations()).toEqual([]);
    expect(loadMessagesForSession('sess-A')).toEqual([]);
  });

  it('legacy data with no recorded owner loses only the session id', () => {
    saveSessionId('legacy');
    saveConversations([{ id: 'c', title: 't', lastMessage: '', updatedAt: '', messageCount: 1 }]);
    expect(adoptChatOwner('user-B')).toBe(true);
    expect(loadSessionId()).toBeNull();
    expect(loadConversations()).toHaveLength(1);
  });

  it('does nothing for an anonymous visitor', () => {
    saveSessionId('anon');
    expect(adoptChatOwner(null)).toBe(false);
    expect(loadSessionId()).toBe('anon');
  });
});
