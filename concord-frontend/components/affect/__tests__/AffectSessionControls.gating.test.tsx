// FIX-affect-002 — the ATS session controls render only when a write
// would be honoured.
//
// The lens opens on the shared 'default' session, and Reset / Cooldown /
// Emit Affect Event were offered to every signed-in member against it
// (the server now refuses those writes for anyone but the session's
// owner or an operator). The panels mirror that rule: a member viewing
// a session that is not theirs sees an owner/operator note instead of
// the controls; their own session (user_<id>) and any operator view
// keep the controls.

import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState: { user: { id: string; username: string; email: string; role: string } | null } = { user: null };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: authState.user, isLoading: false, isAuthenticated: !!authState.user, logout: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {
    affect: {
      state: vi.fn(async () => ({ data: { state: { v: 0.5, a: 0.5, s: 0.5, c: 0.5, g: 0.5, t: 0.5, f: 0.5 } } })),
      policy: vi.fn(async () => ({ data: { policy: {} } })),
      health: vi.fn(async () => ({ data: { healthy: true, score: 0.8 } })),
      events: vi.fn(async () => ({ data: { events: [] } })),
      reset: vi.fn(async () => ({ data: { ok: true } })),
      emit: vi.fn(async () => ({ data: { ok: true } })),
    },
    lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) },
  },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { AffectSessionProvider } from '../AffectSessionContext';
import { AffectStateStrip } from '../AffectStateStrip';
import { DimensionsPanel } from '../DimensionsPanel';

const render = (ui: React.ReactElement) =>
  rtlRender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AffectSessionProvider>{ui}</AffectSessionProvider>
    </QueryClientProvider>,
  );
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
// The strip holds a loading branch until its queries land; on a cold
// first render that outlasts one settle tick, so poll it out.
const settleLoaded = async (container: HTMLElement) => {
  for (let i = 0; i < 50 && (container.textContent || '').includes('Loading affect state'); i++) {
    await settle();
  }
};
const buttons = () => screen.queryAllByRole('button').map((b) => (b.textContent || '').trim());

const MEMBER = { id: 'u1', username: 'member1', email: 'm@example.com', role: 'member' };
const ADMIN = { id: 'op1', username: 'op', email: 'op@example.com', role: 'admin' };

afterEach(() => cleanup());

describe('AffectStateStrip session controls (FIX-affect-002)', () => {
  it('a member on the shared default session gets the note, not Reset/Cooldown', async () => {
    authState.user = MEMBER;
    const view = render(<AffectStateStrip />);
    await settleLoaded(view.container);
    expect(buttons()).not.toContain('Reset');
    expect(buttons()).not.toContain('Cooldown');
    expect(view.container.textContent).toContain("Reset and cooldown act on the session's owner");
  });

  it('a member viewing their own session keeps Reset/Cooldown', async () => {
    authState.user = MEMBER;
    render(<AffectStateStrip />);
    await settle();
    const input = screen.getByLabelText('Affect session id');
    fireEvent.change(input, { target: { value: 'user_u1' } });
    fireEvent.keyDown(screen.getByLabelText('Affect session id'), { key: 'Enter' });
    await settle();
    expect(buttons()).toContain('Reset');
    expect(buttons()).toContain('Cooldown');
  });

  it('an operator on the shared default session keeps Reset/Cooldown', async () => {
    authState.user = ADMIN;
    render(<AffectStateStrip />);
    await settle();
    expect(buttons()).toContain('Reset');
    expect(buttons()).toContain('Cooldown');
  });
});

describe('DimensionsPanel emit gate (FIX-affect-002)', () => {
  it('a member on the shared session gets the note, not the emitter', async () => {
    authState.user = MEMBER;
    const view = render(<DimensionsPanel />);
    await settle();
    expect(buttons()).not.toContain('Emit Event');
    expect(view.container.textContent).toContain('limited to the');
  });

  it('an operator keeps the emitter', async () => {
    authState.user = ADMIN;
    render(<DimensionsPanel />);
    await settle();
    expect(buttons()).toContain('Emit Event');
  });
});
