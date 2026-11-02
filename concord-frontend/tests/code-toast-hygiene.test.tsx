/**
 * S16 (PR #1707): System Status explainability (F16) — the half of S16
 * that stays in this PR.
 *
 * System Status's badge used to be a bare red count with no stated
 * meaning. It now carries its definition (the badge's title text) and
 * the expanded panel states what is counted — server errors, timeouts,
 * network failures — and what is not (expected responses handled
 * elsewhere).
 *
 * The other half of S16 — the api client's handler-defect refusal
 * classification (lib/api/lens-refusal.ts + the interceptor branch in
 * lib/api/client.ts) — was split into its own PR per GB-0736, for
 * separate blast-radius review of the global error handler; its unit
 * tests live there as tests/lens-refusal.test.ts. The handler_defect
 * request-error entry in the fixture below is store data of the shape
 * that change records; System Status renders the request-error list
 * the same either way, so this suite stands alone in this PR.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ── System Status: the count explains itself ─────────────────────────
vi.mock('lucide-react', () => ({
  Wifi: () => <span />, WifiOff: () => <span />, Shield: () => <span />,
  AlertTriangle: () => <span />, ChevronDown: () => <span />, ChevronUp: () => <span />,
}));
vi.mock('@/lib/utils', () => ({ cn: (...a: Array<string | false | undefined>) => a.filter(Boolean).join(' ') }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(async () => ({ data: { ok: true, version: '5.0.0' } })) } }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { ok: true, version: '5.0.0', infrastructure: { auth: { mode: 'jwt' } } }, isError: false, isPending: false, isFetched: true, error: null }),
}));
const errState = {
  requestErrors: [
    { id: 'e1', at: new Date().toISOString(), path: '/api/lens/run', method: 'POST', status: 500, message: 'diagnostics failed inside the server (invalid_input/type_error)', reason: 'handler_defect' },
    { id: 'e2', at: new Date().toISOString(), path: '/api/status', method: 'GET', status: 503, message: 'unreachable' },
  ],
  clearRequestErrors: vi.fn(),
  authPosture: { mode: 'jwt', usesJwt: true, usesApiKey: false },
};
vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: typeof errState) => unknown) => sel(errState),
}));
vi.mock('@/hooks/useClientConfig', () => ({ useClientConfig: () => ({ poll: { systemStatusMs: 30000 } }) }));
vi.mock('@/lib/first-run', () => ({ useCookieConsentVisible: () => false }));

import { SystemStatus, SYSTEM_STATUS_OPEN_EVENT } from '@/components/common/SystemStatus';

describe('SystemStatus count explanation (S16)', () => {
  it('the badge carries its meaning and the expanded panel states what is counted', () => {
    render(<SystemStatus />);
    const badge = screen.getByText('2');
    expect(badge.getAttribute('title')).toMatch(/failed requests recorded/);
    act(() => { window.dispatchEvent(new Event(SYSTEM_STATUS_OPEN_EVENT)); });
    expect(screen.getByText(/2 failed requests recorded since this page loaded/)).toBeTruthy();
    expect(screen.getByText(/Expected responses \(404 lookups, 401 auth checks/)).toBeTruthy();
  });
});
