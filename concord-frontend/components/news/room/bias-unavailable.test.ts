import { describe, it, expect } from 'vitest';
import { biasReasonSentence, biasUnavailableText, finiteOrNull } from './bias-unavailable';

describe('bias-unavailable', () => {
  it('maps reason codes to plain sentences and never returns the raw code', () => {
    expect(biasUnavailableText('no_bias_terms')).toBe(
      'Not available: no loaded or hedge words found in the text',
    );
    expect(biasUnavailableText('no_text')).toBe('Not available: no article text to score');
    expect(biasReasonSentence('some_new_code')).toBe('not enough text to score');
    expect(biasReasonSentence(null)).toBe('not enough text to score');
    expect(biasUnavailableText('no_bias_terms')).not.toMatch(/_/);
  });

  it('passes finite numbers through, including a real 0', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(-0.5)).toBe(-0.5);
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull(Number.NaN)).toBeNull();
  });
});
