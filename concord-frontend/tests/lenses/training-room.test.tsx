/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the lens scaffolding so the test focuses on the page's own behavior.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import TrainingRoomPage from '@/app/lenses/training-room/page';

// Real frame envelopes (mirror server/lib/combat-frame-data.js KIND_FRAME_BASE).
const SWORD_FRAME = {
  skillId: 'sword', name: 'Sword', kind: 'sword', level: 1,
  startup_ms: 200, active_ms: 100, recovery_ms: 300,
  parry_window_ms: 220, dodge_window_ms: 260, combo_followups: [],
};
const BOW_FRAME = {
  skillId: 'bow', name: 'Bow', kind: 'bow', level: 1,
  startup_ms: 350, active_ms: 80, recovery_ms: 250,
  parry_window_ms: 0, dodge_window_ms: 320, combo_followups: [],
};

function envelope<T>(result: T) {
  return { data: { ok: true, result, error: null } };
}

describe('TrainingRoomPage — four UX states', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  function wirePopulated() {
    lensRun.mockImplementation((domain: string, action: string, input: { skillId?: string }) => {
      if (action === 'list_skills') return Promise.resolve(envelope({ skills: [] }));
      if (action === 'list_kinds') {
        return Promise.resolve(envelope({ kinds: [{ kind: 'sword', name: 'Sword' }, { kind: 'bow', name: 'Bow' }] }));
      }
      if (action === 'frame_data') {
        return Promise.resolve(envelope({ ok: true, frameData: input.skillId === 'bow' ? BOW_FRAME : SWORD_FRAME }));
      }
      return Promise.resolve(envelope(null));
    });
  }

  it('renders the EMPTY state when the player has no skills and no kinds', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'list_skills') return Promise.resolve(envelope({ skills: [] }));
      if (action === 'list_kinds') return Promise.resolve(envelope({ kinds: [] }));
      return Promise.resolve(envelope(null));
    });
    render(<TrainingRoomPage />);
    await waitFor(() => expect(screen.getByTestId('skills-empty')).toBeInTheDocument());
    // No skill selected → frame panel shows its own empty state.
    expect(screen.getByTestId('frame-empty')).toBeInTheDocument();
  });

  it('renders the LOADING state for the skill list before data resolves', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'list_kinds') return new Promise((res) => { resolveList = res; });
      return Promise.resolve(envelope({ skills: [] }));
    });
    render(<TrainingRoomPage />);
    expect(screen.getByTestId('skills-loading')).toBeInTheDocument();
    resolveList(envelope({ kinds: [] }));
    await waitFor(() => expect(screen.queryByTestId('skills-loading')).not.toBeInTheDocument());
  });

  it('renders the ERROR state with a retry when the list call rejects', async () => {
    lensRun.mockRejectedValue(new Error('network down'));
    render(<TrainingRoomPage />);
    await waitFor(() => expect(screen.getByTestId('skills-error')).toBeInTheDocument());
    const retry = screen.getByRole('button', { name: /retry/i });
    expect(retry).toBeInTheDocument();

    // Retry succeeds → error clears.
    wirePopulated();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByTestId('skills-error')).not.toBeInTheDocument());
  });

  it('renders the POPULATED state with real frame values and the ranged-parry rule', async () => {
    wirePopulated();
    render(<TrainingRoomPage />);

    // Auto-selects the first kind (sword) → real melee frame values.
    await waitFor(() => expect(screen.getByTestId('frame-ready')).toBeInTheDocument());
    const ready = screen.getByTestId('frame-ready');
    expect(ready).toHaveTextContent('200'); // sword startup
    expect(ready).toHaveTextContent('100'); // active
    expect(ready).toHaveTextContent('300'); // recovery
    expect(ready).toHaveTextContent('220'); // melee parry window > 0

    // Switch to bow → parry window renders as "none" (parry_window_ms === 0).
    fireEvent.click(screen.getByRole('button', { name: /bow/i }));
    await waitFor(() => expect(screen.getByTestId('frame-ready')).toHaveTextContent('none'));
    expect(screen.getByTestId('frame-ready')).toHaveTextContent('350'); // bow startup
  });

  it('calls the real training-room macros (no fabricated client data)', async () => {
    wirePopulated();
    render(<TrainingRoomPage />);
    await waitFor(() => expect(screen.getByTestId('frame-ready')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('training-room', 'list_skills', {});
    expect(lensRun).toHaveBeenCalledWith('training-room', 'list_kinds', {});
    expect(lensRun).toHaveBeenCalledWith('training-room', 'frame_data', { skillId: 'sword' });
  });

  it('renders the frame ERROR state when a skill resolves no frame data', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'list_skills') return Promise.resolve(envelope({ skills: [{ id: 'mystery', title: 'Mystery' }] }));
      if (action === 'list_kinds') return Promise.resolve(envelope({ kinds: [] }));
      if (action === 'frame_data') return Promise.resolve(envelope({ ok: false }));
      return Promise.resolve(envelope(null));
    });
    render(<TrainingRoomPage />);
    await waitFor(() => expect(screen.getByTestId('frame-error')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/no frame data/i);
  });
});
