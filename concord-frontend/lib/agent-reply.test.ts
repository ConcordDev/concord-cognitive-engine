import { describe, it, expect } from 'vitest';
import { readAgentReply } from './agent-reply';

describe('readAgentReply', () => {
  it('reads answer', () => {
    expect(readAgentReply({ result: { ok: true, answer: 'hi' } })).toEqual({ ok: true, text: 'hi' });
  });
  it('stringifies a non-string summary', () => {
    const r = readAgentReply({ result: { summary: { a: 1 } } });
    expect(r).toEqual({ ok: true, text: JSON.stringify({ a: 1 }, null, 2) });
  });
  it('carries a failure reason', () => {
    expect(readAgentReply({ result: { ok: false, reason: 'no_brain' } })).toEqual({ ok: false, reason: 'no_brain' });
  });
  it('says so when nothing was written', () => {
    expect(readAgentReply({ result: { ok: true } })).toEqual({ ok: false, reason: 'The agent finished without writing anything.' });
  });
  it('handles null', () => {
    expect(readAgentReply(null).ok).toBe(false);
  });
  it('skips an empty answer for a filled reply', () => {
    expect(readAgentReply({ result: { answer: '', reply: 'x' } })).toEqual({ ok: true, text: 'x' });
  });
  it('falls back to data.reply', () => {
    expect(readAgentReply({ reply: 'top' })).toEqual({ ok: true, text: 'top' });
  });
});
