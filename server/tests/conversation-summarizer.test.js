/**
 * Conversation Summarizer — Comprehensive Tests
 * Run: node --test tests/conversation-summarizer.test.js
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  isSummaryDue,
  compressConversation,
  getSessionSummary,
  getSummaryText,
  annotateWithUnsaid,
  SUMMARY_CONSTANTS,
} from '../lib/conversation-summarizer.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function makeState(sessionId, messageCount, lastSummaryExchange = 0) {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i}`,
    ts: new Date().toISOString(),
  }));
  const sess = { messages, _lastSummaryExchange: lastSummaryExchange, createdAt: new Date().toISOString() };
  const sessions = new Map([[sessionId, sess]]);
  return { sessions, shadowDtus: new Map() };
}

// ── isSummaryDue tests ──────────────────────────────────────────────────────

describe('isSummaryDue', () => {
  it('returns false for empty sessions', () => {
    const STATE = { sessions: new Map() };
    assert.strictEqual(isSummaryDue(STATE.sessions, 'nonexistent'), false);
  });

  it('returns false for session with no messages', () => {
    const STATE = makeState('s1', 0);
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), false);
  });

  it('returns false when fewer than 10 messages (5 exchanges)', () => {
    const STATE = makeState('s1', 8); // 4 exchanges
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), false);
  });

  it('returns true at exactly 10 messages (5 exchanges)', () => {
    const STATE = makeState('s1', 10); // 5 exchanges
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), true);
  });

  it('returns true when past the next interval', () => {
    const STATE = makeState('s1', 22); // 11 exchanges
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), true);
  });

  it('returns false when already summarized at current interval', () => {
    const STATE = makeState('s1', 10, 5); // summarized at exchange 5
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), false);
  });

  it('returns true when past next interval after previous summary', () => {
    const STATE = makeState('s1', 20, 5); // summarized at 5, now at 10
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), true);
  });

  it('handles session with no messages array', () => {
    const STATE = { sessions: new Map([['s1', {}]]) };
    assert.strictEqual(isSummaryDue(STATE.sessions, 's1'), false);
  });
});

// ── compressConversation tests ──────────────────────────────────────────────

describe('compressConversation', () => {
  it('returns error for insufficient messages', async () => {
    const STATE = makeState('s1', 2);
    const result = await compressConversation(STATE, 's1');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'insufficient_messages');
  });

  it('returns error for nonexistent session', async () => {
    const STATE = { sessions: new Map(), shadowDtus: new Map() };
    const result = await compressConversation(STATE, 'nonexistent');
    assert.strictEqual(result.ok, false);
  });

  it('calls Utility brain with correct payload (mocked fetch)', async () => {
    const STATE = makeState('s1', 12);
    let capturedBody = null;

    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ response: 'This is a test summary of the conversation.' }),
      };
    };

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, true);
      assert.ok(result.summaryId);
      assert.ok(capturedBody);
      assert.ok(capturedBody.prompt.includes('Conversation:'));
      assert.strictEqual(capturedBody.stream, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('creates shadow DTU with correct structure', async () => {
    const STATE = makeState('s1', 12);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ response: 'Summary text here.' }),
    });

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, true);

      const dtu = STATE.shadowDtus.get('summary_session_s1');
      assert.ok(dtu);
      assert.strictEqual(dtu.tier, 'shadow');
      assert.ok(dtu.tags.includes('shadow'));
      assert.ok(dtu.tags.includes('summary'));
      assert.ok(dtu.tags.includes('session'));
      assert.strictEqual(dtu.machine.kind, 'conversation_summary');
      assert.strictEqual(dtu.machine.sessionId, 's1');
      assert.strictEqual(dtu.machine.summaryText, 'Summary text here.');
      assert.strictEqual(dtu.machine.generatedBy, 'utility_brain');
    } finally {
      delete globalThis.fetch;
    }
  });

  it('archives previous summary when updating', async () => {
    const STATE = makeState('s1', 20);
    STATE.shadowDtus.set('summary_session_s1', {
      id: 'summary_session_s1',
      machine: { summaryText: 'Old summary', previousSummaries: [], exchangeCount: 5 },
      createdAt: new Date().toISOString(),
    });

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ response: 'New summary.' }),
    });

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, true);

      const dtu = STATE.shadowDtus.get('summary_session_s1');
      assert.ok(dtu.machine.previousSummaries.length >= 1);
      assert.strictEqual(dtu.machine.previousSummaries[0].text, 'Old summary');
    } finally {
      delete globalThis.fetch;
    }
  });

  it('handles brain HTTP error', async () => {
    const STATE = makeState('s1', 12);

    globalThis.fetch = async () => ({ ok: false, status: 500 });

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.includes('brain_http'));
    } finally {
      delete globalThis.fetch;
    }
  });

  it('handles empty brain response', async () => {
    const STATE = makeState('s1', 12);

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ response: '' }),
    });

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'empty_summary');
    } finally {
      delete globalThis.fetch;
    }
  });

  it('handles fetch timeout (AbortError)', async () => {
    const STATE = makeState('s1', 12);

    globalThis.fetch = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };

    try {
      const result = await compressConversation(STATE, 's1');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'timeout');
    } finally {
      delete globalThis.fetch;
    }
  });

  it('uses incremental prompt when previous summary exists', async () => {
    const STATE = makeState('s1', 12);
    STATE.shadowDtus.set('summary_session_s1', {
      id: 'summary_session_s1',
      machine: { summaryText: 'Previous context', previousSummaries: [], exchangeCount: 3 },
      createdAt: new Date().toISOString(),
    });

    let capturedPrompt = '';
    globalThis.fetch = async (_, opts) => {
      capturedPrompt = JSON.parse(opts.body).prompt;
      return { ok: true, json: async () => ({ response: 'Updated summary.' }) };
    };

    try {
      await compressConversation(STATE, 's1');
      assert.ok(capturedPrompt.includes('Previous summary:'));
      assert.ok(capturedPrompt.includes('Previous context'));
      assert.ok(capturedPrompt.includes('New messages:'));
    } finally {
      delete globalThis.fetch;
    }
  });

  it('updates _lastSummaryExchange on session', async () => {
    const STATE = makeState('s1', 12);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ response: 'Summary.' }),
    });
    try {
      await compressConversation(STATE, 's1');
      const sess = STATE.sessions.get('s1');
      assert.strictEqual(sess._lastSummaryExchange, 6); // 12 messages = 6 exchanges
    } finally {
      delete globalThis.fetch;
    }
  });
});

// ── getSessionSummary tests ─────────────────────────────────────────────────

describe('getSessionSummary', () => {
  it('returns error when no summary exists', () => {
    const STATE = { shadowDtus: new Map() };
    const result = getSessionSummary(STATE, 'nonexistent');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'no_summary');
  });

  it('returns summary with correct structure', () => {
    const STATE = {
      shadowDtus: new Map([
        ['summary_session_s1', {
          id: 'summary_session_s1',
          machine: {
            summaryText: 'Test summary',
            exchangeCount: 5,
            messageCount: 10,
            unsaidAnnotation: 'Hidden context',
            previousSummaries: ['old1', 'old2'],
          },
          updatedAt: '2025-01-01T00:00:00Z',
          createdAt: '2025-01-01T00:00:00Z',
        }],
      ]),
    };
    const result = getSessionSummary(STATE, 's1');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.summary.text, 'Test summary');
    assert.strictEqual(result.summary.exchangeCount, 5);
    assert.strictEqual(result.summary.messageCount, 10);
    assert.strictEqual(result.summary.unsaidAnnotation, 'Hidden context');
    assert.strictEqual(result.summary.archivedSummaryCount, 2);
  });

  it('handles undefined shadowDtus', () => {
    const STATE = {};
    const result = getSessionSummary(STATE, 's1');
    assert.strictEqual(result.ok, false);
  });
});

// ── getSummaryText tests ────────────────────────────────────────────────────

describe('getSummaryText', () => {
  it('returns empty string when no summary exists', () => {
    assert.strictEqual(getSummaryText({ shadowDtus: new Map() }, 's1'), '');
  });

  it('returns summary text when available', () => {
    const STATE = {
      shadowDtus: new Map([
        ['summary_session_s1', { machine: { summaryText: 'Hello world' } }],
      ]),
    };
    assert.strictEqual(getSummaryText(STATE, 's1'), 'Hello world');
  });

  it('handles missing machine field', () => {
    const STATE = { shadowDtus: new Map([['summary_session_s1', {}]]) };
    assert.strictEqual(getSummaryText(STATE, 's1'), '');
  });
});

// ── annotateWithUnsaid tests ────────────────────────────────────────────────

describe('annotateWithUnsaid', () => {
  it('annotates existing summary DTU', () => {
    const STATE = {
      shadowDtus: new Map([
        ['summary_session_s1', { machine: { summaryText: 'Test' }, updatedAt: '' }],
      ]),
    };
    annotateWithUnsaid(STATE, 's1', 'User seems frustrated');
    const dtu = STATE.shadowDtus.get('summary_session_s1');
    assert.strictEqual(dtu.machine.unsaidAnnotation, 'User seems frustrated');
    assert.ok(dtu.updatedAt); // Should be updated
  });

  it('does nothing when summary does not exist', () => {
    const STATE = { shadowDtus: new Map() };
    annotateWithUnsaid(STATE, 'nonexistent', 'test');
    // Should not throw
    assert.strictEqual(STATE.shadowDtus.size, 0);
  });

  it('creates machine field if missing', () => {
    const STATE = {
      shadowDtus: new Map([['summary_session_s1', { updatedAt: '' }]]),
    };
    annotateWithUnsaid(STATE, 's1', 'annotation');
    const dtu = STATE.shadowDtus.get('summary_session_s1');
    assert.strictEqual(dtu.machine.unsaidAnnotation, 'annotation');
  });
});

// ── SUMMARY_CONSTANTS tests ─────────────────────────────────────────────────

describe('SUMMARY_CONSTANTS', () => {
  it('exports correct interval', () => {
    assert.strictEqual(SUMMARY_CONSTANTS.SUMMARY_INTERVAL, 5);
  });

  it('exports correct max archived', () => {
    // Bumped 20 → 200 for multi-tenant deployments. Override via CONCORD_ARCHIVED_SUMMARIES.
    assert.strictEqual(SUMMARY_CONSTANTS.MAX_ARCHIVED_SUMMARIES, 200);
  });

  it('exports correct max tokens', () => {
    assert.strictEqual(SUMMARY_CONSTANTS.SUMMARY_MAX_TOKENS, 600);
  });

  it('constants are frozen', () => {
    assert.ok(Object.isFrozen(SUMMARY_CONSTANTS));
  });
});
