/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MountHud } from './MountHud';

// Shape the lensRun envelope the same way the real client returns it.
const ok = <T,>(result: T) => ({ data: { ok: true, result } });

function routeMounts(handlers: Record<string, unknown>) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action in handlers) return Promise.resolve(handlers[action]);
    return Promise.reject(new Error(`unexpected action ${action}`));
  });
}

describe('MountHud', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders nothing when the player has no active mount and no roster', async () => {
    routeMounts({
      get_active_mount: ok({ mounted: false }),
      list_mountable: ok({ companions: [] }),
    });

    const { container } = render(<MountHud worldId="tunya" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('mounts', 'list_mountable', { worldId: 'tunya' }));
    expect(container.firstChild).toBeNull();
  });

  it('shows the active mount with a live stamina/care bar', async () => {
    routeMounts({
      get_active_mount: ok({
        mounted: true,
        companion: { id: 'c-1', name: 'Dustmane' },
        speciesId: 'sand-strider',
      }),
      care_state: ok({ loyalty: 72, rideable: true, state: { stamina: 88, hunger: 20 } }),
    });

    render(<MountHud worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Dustmane')).toBeInTheDocument());
    // care_state pulled with the companion id as mountId.
    expect(lensRun).toHaveBeenCalledWith('mounts', 'care_state', { mountId: 'c-1' });
    expect(screen.getByText('Stamina')).toBeInTheDocument();
    expect(screen.getByText('88%')).toBeInTheDocument();
    expect(screen.getByText('Loyalty')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('dismisses the active mount via mounts.dismount', async () => {
    routeMounts({
      get_active_mount: ok({ mounted: true, companion: { id: 'c-1', name: 'Dustmane' } }),
      care_state: ok({ loyalty: 50, rideable: true, state: { stamina: 60 } }),
      dismount: ok({ ok: true }),
    });

    render(<MountHud worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Dismiss')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('mounts', 'dismount', { worldId: 'tunya' }));
  });

  it('offers Summon affordances from the rideable roster and mounts on click', async () => {
    routeMounts({
      get_active_mount: ok({ mounted: false }),
      list_mountable: ok({ companions: [{ id: 'c-9', name: 'Frostfang', level: 7 }] }),
      mount: ok({ ok: true }),
    });

    render(<MountHud worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Frostfang')).toBeInTheDocument());
    expect(screen.getByText('Lv 7')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Frostfang'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('mounts', 'mount', { companionId: 'c-9', worldId: 'tunya' }),
    );
  });
});
