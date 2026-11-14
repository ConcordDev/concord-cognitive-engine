// FIX-linguistics-008 — DatamusePanel read the macro's words at the
// top level of the /api/lens/run response, but the route wraps every
// success in the { ok, result } envelope (server/lib/lens-run-http.js),
// so words live at result.words. The panel got undefined for every
// word and rendered 'No matches' even on a healthy upstream answer.
// Failures are not enveloped (spread at top level) and must still
// surface as errors.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const postMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => postMock(...args), get: vi.fn(async () => ({ data: {} })) },
  lensRun: vi.fn(),
  apiHelpers: {},
}));

import { DatamusePanel } from '@/components/linguistics/DatamusePanel';

describe('DatamusePanel envelope reading (FIX-linguistics-008)', () => {
  it('renders words from inside the { ok, result } envelope', async () => {
    postMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ok: true, source: 'Datamuse', word: 'syntax', kind: 'means', total: 2,
          words: [
            { word: 'phrase structure', score: 300, numSyllables: 3, tags: [] },
            { word: 'sentence structure', score: 299, numSyllables: 4, tags: [] },
          ],
        },
      },
    });
    render(<DatamusePanel domain="linguistics" />);
    const input = screen.getByPlaceholderText('Word…');
    fireEvent.change(input, { target: { value: 'syntax' } });
    // the panel debounces 400ms
    expect(await screen.findByText('phrase structure', {}, { timeout: 3000 })).toBeTruthy();
    expect(await screen.findByText('sentence structure')).toBeTruthy();
    expect(screen.queryByText(/No matches/)).toBeNull();
  });

  it('an upstream failure (top-level, unenveloped) still surfaces as an error, not an empty result', async () => {
    postMock.mockResolvedValue({
      data: { ok: false, reason: 'datamuse_unreachable', error: 'datamuse_unreachable' },
    });
    render(<DatamusePanel domain="linguistics" />);
    fireEvent.change(screen.getByPlaceholderText('Word…'), { target: { value: 'syntax' } });
    expect(await screen.findByText(/datamuse_unreachable/, {}, { timeout: 3000 })).toBeTruthy();
  });
});
