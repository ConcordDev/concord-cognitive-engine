/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the callMacro() helper's envelope-unwrap fix: /api/lens/run always
// responds { ok: true, result: PAYLOAD }; the helper must return PAYLOAD
// (beats.list -> { ok, beats: [...] }), not the raw transport envelope,
// or `r.beats` on the caller side is permanently undefined.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({ subscribe: () => () => {} }));

import { PersonalBeatWidget } from './PersonalBeatWidget';

describe('PersonalBeatWidget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces an open beat returned by beats.list through the nested .result envelope', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          ok: true,
          beats: [
            { id: 'beat-1', prose: 'A beat surfaces about the tunnel.', completed_at: null },
          ],
        },
      }),
    })) as unknown as typeof fetch;

    render(<PersonalBeatWidget />);

    await waitFor(() => {
      expect(screen.getByText('A beat surfaces about the tunnel.')).toBeInTheDocument();
    });
  });

  it('renders nothing when beats.list returns no open beats', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, beats: [] } }),
    })) as unknown as typeof fetch;

    const { container } = render(<PersonalBeatWidget />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
