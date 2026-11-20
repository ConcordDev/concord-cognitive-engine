/**
 * The Notebook's one "Answer as" control: your own assistants first, then the
 * ways of answering, then the built-in voices. ConKay is never a way of
 * answering here (it is its own lens). Every option sets both things the send
 * path reads: the request mode and the persona's system prompt.
 */
import { describe, expect, it } from 'vitest';
import { answerAsOptions, currentKey } from '@/components/chat/notebook/AnswerAsPicker';
import { AI_MODES, PERSONAS } from '@/components/chat/ChatModeConfig';

describe('answerAsOptions', () => {
  it('orders yours, then ways, then voices, and leaves ConKay out', () => {
    const opts = answerAsOptions([{ id: 'a1', name: 'Tax helper', instructions: 'You answer tax questions.', model: 'research' }]);
    expect(opts[0]).toMatchObject({ key: 'gpt-a1', group: 'yours', label: 'Tax helper' });
    const groups = opts.map((o) => o.group);
    expect(groups.indexOf('ways')).toBeGreaterThan(groups.lastIndexOf('yours'));
    expect(groups.indexOf('voices')).toBeGreaterThan(groups.lastIndexOf('ways'));
    expect(opts.some((o) => o.mode.id === 'conkay' || /conkay/i.test(o.key))).toBe(false);
    expect(opts.some((o) => o.persona.id === 'default' && o.group === 'voices')).toBe(false);
  });

  it('an assistant answers with its own instructions in the mode it was made for', () => {
    const [mine] = answerAsOptions([{ id: 'a1', name: 'Tax helper', instructions: 'You answer tax questions.', model: 'research' }]);
    expect(mine.mode.id).toBe('research');
    expect(mine.persona.systemPrompt).toBe('You answer tax questions.');
  });

  it('an assistant whose saved mode is unknown or ConKay falls back to plain Chat, never ConKay', () => {
    const opts = answerAsOptions([
      { id: 'x', name: 'Odd', instructions: 'i', model: 'not-a-mode' },
      { id: 'y', name: 'Sneaky', instructions: 'i', model: 'conkay' },
    ]);
    expect(opts[0].mode.id).toBe(AI_MODES[0].id);
    expect(opts[1].mode.id).toBe(AI_MODES[0].id);
  });

  it('a hostile assistant name is carried as text, not markup', () => {
    const [o] = answerAsOptions([{ id: 'z', name: '<img src=x onerror=alert(1)>', instructions: 'i' }]);
    expect(o.label).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('currentKey', () => {
  it('names the option the (mode, persona) pair is', () => {
    const code = AI_MODES.find((m) => m.id === 'code')!;
    expect(currentKey(code, PERSONAS[0])).toBe('mode-code');
    const voice = PERSONAS.find((p) => p.id !== 'default')!;
    expect(currentKey(AI_MODES[0], voice)).toBe(`voice-${voice.id}`);
    expect(currentKey(AI_MODES[0], { ...PERSONAS[0], id: 'gpt-a1' })).toBe('gpt-a1');
  });

  it('every option round-trips to its own key', () => {
    for (const o of answerAsOptions([{ id: 'a1', name: 'Mine', instructions: 'i' }])) {
      expect(currentKey(o.mode, o.persona)).toBe(o.key);
    }
  });
});
