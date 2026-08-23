// concord-frontend/tests/components/conkay-skills-compress.test.ts
//
// End-to-end pins for the `compress` ConKay skill — the user-invoked
// counterpart to /api/chat 's silent auto-compression.
//
// Pinned behavior:
//   1. Match: "compress", "compress this session", "summarize this
//      conversation", "summarise my chat", "condense our session" all
//      match; "tell me about compression" does NOT (it would otherwise
//      hijack any phrase mentioning compress).
//   2. Run: when ctx has a sessionId and ctx.runMacro returns ok:
//      { dtusCreated: 1, messagesCompressed: 12 }, the spoken reply
//      contains the real numbers (1 DTU, 12 turns). Never a placeholder.
//   3. Run: when ctx.runMacro returns ok with 0/0, the reply is honest
//      about no-op (instead of faking "you've saved X%" or similar).
//   4. Run: when ctx.sessionId is missing, the reply is honest about
//      that — never falls through silently to the LLM with a fake
//      "I started compressing" line.
//   5. Run: when ctx.runMacro is missing entirely, the reply is honest
//      about the macro bridge being unavailable rather than faking a
//      result.
//   6. The skill does NOT advertise itself with marketing copy —
//      the spoken text names real numbers and the real failure modes.

import { describe, it, expect, vi } from 'vitest';
import { CONKAY_SKILLS, matchConKaySkill } from '@/components/conkay/conkay-skills';

const compressSkill = CONKAY_SKILLS.find((s) => s.id === 'compress');
expect(compressSkill).toBeDefined();

if (!compressSkill) throw new Error('compress skill missing — abort');

describe('compress — matcher', () => {
  const POSITIVE = [
    'compress',
    'Compress',
    'COMPRESS',
    'compress this session',
    'compress the conversation',
    'compress our chat',
    'compress my context',
    'compress the window',
    'summarize this session',
    'summarise our talk',
    'summarize my chat',
    'condense',
    'shrink this session',
  ];
  for (const p of POSITIVE) {
    it(`matches "${p}"`, () => {
      expect(compressSkill.match(p)).not.toBeNull();
    });
  }

  const NEGATIVE = [
    'tell me about compression',
    'compression algorithms',
    'compression ratio',
    'how does the compress roller work',
    'i love compressing the world',
    // The math expression parser (a different skill) should still match.
    '1 + 1',
    // Free-form chat should NOT be hijacked by compress.
    'can you compress the answer to be shorter next time',
  ];
  for (const n of NEGATIVE) {
    it(`does NOT match "${n}" (falls through to LLM or other skill)`, () => {
      // It's possible another skill matches here (e.g. math); we only
      // assert that `compress` itself doesn't.
      expect(compressSkill.match(n)).toBeNull();
    });
  }

  it('matchConKaySkill surfaces the compress skill for positive phrasings', () => {
    expect(matchConKaySkill('compress')?.skill.id).toBe('compress');
    expect(matchConKaySkill('Compress This Session')?.skill.id).toBe('compress');
    // 'search' is greedy and registered AFTER compress; compress
    // should still win for these phrasings.
    expect(matchConKaySkill('summarize this chat')?.skill.id).toBe('compress');
  });
});

describe('compress — run (real macro path)', () => {
  it('reports the real dtusCreated and messagesCompressed numbers', async () => {
    const runMacro = vi.fn().mockResolvedValue({
      ok: true,
      dtusCreated: 2,
      messagesCompressed: 18,
    });
    const fetchJson = vi.fn().mockResolvedValue({
      ok: true,
      messageCount: 55,
      batchSize: 20,
      threshold: 50,
      atOrOverThreshold: true,
    });
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson,
      runMacro,
      sessionId: 'session-abc',
    });
    expect(r.acting).toBe(true);
    // Real numbers from the macro result.
    expect(r.spoken).toContain('2');
    expect(r.spoken).toContain('18');
    // The preflight message should also be present (real turn count).
    expect(r.spoken).toContain('55');
    // The toolCall entry exists and is marked ok.
    expect(r.toolCalls?.[0]?.tool).toBe('chat.summary');
    expect(r.toolCalls?.[0]?.ok).toBe(true);
    // runMacro was called with the right (domain, name, input).
    expect(runMacro).toHaveBeenCalledWith(
      'chat',
      'summary',
      expect.objectContaining({ sessionId: 'session-abc' }),
    );
  });

  it('is honest when nothing was compressed (returns a no-op reply)', async () => {
    const runMacro = vi.fn().mockResolvedValue({
      ok: true,
      dtusCreated: 0,
      messagesCompressed: 0,
    });
    const fetchJson = vi.fn().mockResolvedValue({
      ok: true,
      messageCount: 12,
      batchSize: 20,
      threshold: 50,
      atOrOverThreshold: false,
    });
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson,
      runMacro,
      sessionId: 'session-abc',
    });
    // No fake "saved N%": the reply names the real number from
    // the macro (0 DTUs, 0 turns).
    expect(r.spoken).toContain('0');
    // And it does NOT claim acting=true (no real work happened).
    expect(r.acting).toBe(false);
  });

  it('is honest when the macro returns ok:false (reports the error literally)', async () => {
    const runMacro = vi.fn().mockResolvedValue({
      ok: false,
      error: 'below_threshold',
    });
    const fetchJson = vi.fn().mockResolvedValue({ ok: true, messageCount: 5 });
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson,
      runMacro,
      sessionId: 'session-abc',
    });
    expect(r.spoken).toContain('below_threshold');
    expect(r.acting).toBe(false);
  });

  it('is honest when sessionId is missing (does not silently fake it)', async () => {
    const runMacro = vi.fn();
    const fetchJson = vi.fn();
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson,
      runMacro,
      sessionId: null,
    });
    expect(r.spoken).toContain("can't tell which session");
    expect(r.acting).toBe(false);
    // Neither fetch nor macro should be called when we have no
    // session — we'd just be guessing what to act on.
    expect(runMacro).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('is honest when runMacro is unavailable (no fake "started compressing")', async () => {
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson: vi.fn().mockResolvedValue({ ok: true, messageCount: 40 }),
      runMacro: undefined,
      sessionId: 'session-abc',
    });
    expect(r.spoken).toMatch(/nothing compressible|failed/i);
    expect(r.acting).toBe(false);
  });

  it('does not fabricate a successful tool call when the budget endpoint errors but the macro succeeds', async () => {
    // If the budget preflight errors, the skill still calls the
    // macro (real path), and reports the macro's real numbers in the
    // reply — without injecting a fake preflight message.
    const runMacro = vi.fn().mockResolvedValue({
      ok: true,
      dtusCreated: 1,
      messagesCompressed: 12,
    });
    const fetchJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await compressSkill.run({}, {
      apiBase: '',
      fetchJson,
      runMacro,
      sessionId: 'session-abc',
    });
    // Real numbers from the macro, no fake preflight.
    expect(r.spoken).toContain('12');
    expect(r.spoken).not.toContain('I see');
    // Still acting — the macro really did the work.
    expect(r.acting).toBe(true);
  });
});
