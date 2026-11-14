/**
 * GB-1538 / FIX-translation-008 — evidence pin for a verdict closure.
 * The ticket reports characters dropped while typing ~200 chars in the
 * Single input. The shipped panel is a plain controlled textarea
 * (onChange → setText(e.target.value)) with no truncation, no maxLength
 * (the 8,000-char cap is a display warning only, mirroring the server),
 * and no per-keystroke work beyond a state set. This pin drives the
 * repro's shape — a long string typed in bursts — and asserts every
 * character is retained.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SingleTranslatePanel } from '@/components/translation/TranslationPanels';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));

describe('SingleTranslatePanel input retention (FIX-translation-008 evidence)', () => {
  it('a 240-character string typed in bursts is retained in full', () => {
    render(
      <SingleTranslatePanel source="en" target="es" formality="neutral" onSave={() => undefined} />,
    );
    const area = screen.getByLabelText('Text to translate') as HTMLTextAreaElement;
    const full = 'The quick brown fox jumps over the lazy dog. '.repeat(6).slice(0, 240);
    let acc = '';
    for (const chunk of full.match(/.{1,24}/g) ?? []) {
      acc += chunk;
      fireEvent.change(area, { target: { value: acc } });
      expect(area.value).toBe(acc);
    }
    expect(area.value).toHaveLength(240);
  });
});
