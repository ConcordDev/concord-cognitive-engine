/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the /api/lens/run envelope-unwrap fix for AssistantMoodChip. The
// endpoint always responds { ok: true, result: PAYLOAD } (chat.mood ->
// { ok, lit, valence, arousal, quale }); reading those fields off the
// top-level response (pre-fix) left `mood` permanently null and the chip
// never rendered.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { AssistantMoodChip } from '@/components/chat/AssistantMoodChip';

describe('AssistantMoodChip', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the felt-mood label read from the nested .result envelope', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({
        ok: true,
        result: { ok: true, lit: true, valence: 0.4, arousal: 0.2, quale: 'curiosity' },
      }),
    })) as unknown as typeof fetch;

    render(<AssistantMoodChip pollMs={60000} />);

    await waitFor(() => {
      expect(screen.getByText('curiosity')).toBeInTheDocument();
    });
  });

  it('renders nothing when the mood is not lit', async () => {
    global.fetch = vi.fn(async () => ({
      json: async () => ({ ok: true, result: { ok: true, lit: false, valence: 0, arousal: 0, quale: null } }),
    })) as unknown as typeof fetch;

    const { container } = render(<AssistantMoodChip pollMs={60000} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
