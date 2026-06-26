import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { TargetNameplate } from './TargetNameplate';
import { cameraLookState } from '@/lib/world-lens/camera-look-state';

// Capture the handlers registered via useSocket so the test can drive socket events.
const socketHandlers: Record<string, (payload: unknown) => void> = {};
vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({
    on: (event: string, cb: (payload: unknown) => void) => {
      socketHandlers[event] = cb;
    },
    off: (event: string) => {
      delete socketHandlers[event];
    },
    isConnected: true,
  }),
}));

const NPCS = [
  { id: 'npc-1', name: 'Brackish', currentHp: 100, maxHp: 100 },
  { id: 'npc-2', name: 'Old Seam', currentHp: 80, maxHp: 80 },
];

function lockOn(id: string, mode: 'soft' | 'hard' = 'soft') {
  cameraLookState.lockedTargetId = id;
  cameraLookState.lockMode = mode;
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:lockon-changed', { detail: { id, mode } }));
  });
}

describe('TargetNameplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(socketHandlers)) delete socketHandlers[k];
    cameraLookState.lockedTargetId = null;
    cameraLookState.lockMode = null;
  });

  it('renders nothing with no locked target', () => {
    const { container } = render(<TargetNameplate npcs={NPCS} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the locked target name + health bar', async () => {
    render(<TargetNameplate npcs={NPCS} />);
    lockOn('npc-1', 'hard');

    await waitFor(() => expect(screen.getByText('Brackish')).toBeInTheDocument());
    expect(screen.getByText('hard')).toBeInTheDocument();
    const fill = screen.getByTestId('target-hp-fill');
    expect(fill).toHaveStyle({ width: '100%' });
  });

  it('drops HP when a combat:impact hits the locked target', async () => {
    render(<TargetNameplate npcs={NPCS} />);
    lockOn('npc-1');

    await waitFor(() => expect(screen.getByText('Brackish')).toBeInTheDocument());
    expect(screen.getByTestId('target-hp-fill')).toHaveStyle({ width: '100%' });

    act(() => {
      socketHandlers['combat:impact']?.({ targetId: 'npc-1', damage: 40 });
    });

    await waitFor(() =>
      expect(screen.getByTestId('target-hp-fill')).toHaveStyle({ width: '60%' })
    );
    expect(screen.getByText(/60 \/ 100/)).toBeInTheDocument();
  });

  it('ignores damage to a non-locked target', async () => {
    render(<TargetNameplate npcs={NPCS} />);
    lockOn('npc-1');
    await waitFor(() => expect(screen.getByTestId('target-hp-fill')).toHaveStyle({ width: '100%' }));

    act(() => {
      socketHandlers['combat:impact']?.({ targetId: 'npc-2', damage: 50 });
    });

    expect(screen.getByTestId('target-hp-fill')).toHaveStyle({ width: '100%' });
  });

  it('clears the frame on combat:death of the locked target', async () => {
    const { container } = render(<TargetNameplate npcs={NPCS} />);
    lockOn('npc-1');
    await waitFor(() => expect(screen.getByText('Brackish')).toBeInTheDocument());

    act(() => {
      socketHandlers['combat:death']?.({ id: 'npc-1' });
    });

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
