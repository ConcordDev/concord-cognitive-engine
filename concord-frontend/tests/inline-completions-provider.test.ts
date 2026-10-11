import { describe, expect, it } from 'vitest';
import { createInlineCompletionsProvider } from '@/components/code/inlineCompletionsProvider';

const model = {
  getLineCount: () => 3,
  getLineMaxColumn: () => 8,
  getValueInRange: () => 'const ',
};

describe('inline completions provider', () => {
  it('implements disposeInlineCompletions and freeInlineCompletions', async () => {
    const provider = createInlineCompletionsProvider('javascript', async () => 'x = 1');
    expect(typeof provider.disposeInlineCompletions).toBe('function');
    expect(typeof provider.freeInlineCompletions).toBe('function');
    const list = await provider.provideInlineCompletions(model, { lineNumber: 1, column: 7 });
    expect(list.items[0]?.insertText).toBe('x = 1');
    expect(() => provider.disposeInlineCompletions(list, 'lost')).not.toThrow();
    expect(() => provider.freeInlineCompletions(list)).not.toThrow();
  });

  it('returns no items when the completion source throws', async () => {
    const provider = createInlineCompletionsProvider('javascript', async () => {
      throw new Error('no model');
    });
    const list = await provider.provideInlineCompletions(model, { lineNumber: 1, column: 1 });
    expect(list.items).toEqual([]);
    provider.disposeInlineCompletions(list);
  });
});
