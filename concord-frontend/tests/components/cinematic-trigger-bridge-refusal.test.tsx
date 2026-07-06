/**
 * Fix 1 (verification audit, 2026-07-05) — CinematicTriggerBridge's
 * refusal-field-compound trigger name.
 *
 * cinematic-director.ts's `findSequenceForTrigger` does exact string
 * equality against `AUTO_TEMPLATES` keys / authored `trigger` fields. The
 * `refusal:compound` key (AUTO_TEMPLATES + content/cinematics/concordia-deep-cold.json)
 * uses the colon convention shared by 3 other authored triggers
 * (ark:archive_unlocked, dynasty:heir_acceded, vela:reveal) — but
 * CinematicTriggerBridge used to call `dir.playSequence('refusal_field_compound', ...)`,
 * an underscore name matching NEITHER the template key nor the JSON, so a
 * compound-refusal event (strength >= 9) never played the "Concordia deep
 * cold" cinematic. Fixed to fire the matching colon name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { waitFor } from '@testing-library/react';

const { subscribeHandlers, subscribeMock, playSequenceMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    subscribeHandlers: handlers,
    subscribeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
    playSequenceMock: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: subscribeMock,
}));

vi.mock('@/lib/world-lens/cinematic-director', () => ({
  playSequence: playSequenceMock,
}));

vi.mock('@/lib/world-lens/cinematic-sequences-registry', () => ({
  ensureCinematicsRegistered: vi.fn(),
}));

import { CinematicTriggerBridge } from '@/components/world/CinematicTriggerBridge';

describe('CinematicTriggerBridge — refusal-field-compound trigger', () => {
  beforeEach(() => {
    subscribeHandlers.clear();
    playSequenceMock.mockClear();
  });

  it('fires playSequence with the colon-style name matching AUTO_TEMPLATES / the authored JSON', async () => {
    render(<CinematicTriggerBridge />);
    await waitFor(() => expect(subscribeHandlers.has('world:refusal-field')).toBe(true));

    subscribeHandlers.get('world:refusal-field')!({ strength: 9 });

    expect(playSequenceMock).toHaveBeenCalledTimes(1);
    // The real bug: this used to be called with 'refusal_field_compound',
    // which matches neither cinematic-director's AUTO_TEMPLATES key nor
    // concordia-deep-cold.json's "trigger" field (both 'refusal:compound'),
    // so the cinematic silently never played.
    expect(playSequenceMock).toHaveBeenCalledWith('refusal:compound', { strength: 9 });
    expect(playSequenceMock).not.toHaveBeenCalledWith('refusal_field_compound', expect.anything());
  });

  it('does not fire below the strength >= 9 compound threshold', async () => {
    render(<CinematicTriggerBridge />);
    await waitFor(() => expect(subscribeHandlers.has('world:refusal-field')).toBe(true));

    subscribeHandlers.get('world:refusal-field')!({ strength: 5 });

    expect(playSequenceMock).not.toHaveBeenCalled();
  });
});
