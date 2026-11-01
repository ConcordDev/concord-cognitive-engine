/**
 * S16 (PR #1707): toast hygiene + System Status explainability (F16).
 *
 * The false "invalid input" toast: the dispatch rewrites server
 * handler TypeErrors to error:"invalid_input" (reason type_error /
 * not_a_function); the api interceptor toasted every refusal's raw
 * code, so companion calls made a red "invalid input" appear over
 * successful saves/creates. Handler defects are now classified apart
 * from genuine refusals (recorded, not toasted), genuine refusals
 * name the field/reason, and System Status explains what its badge
 * counts.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { isHandlerDefectRefusal, refusalToastMessage } from '@/lib/api/lens-refusal';

describe('isHandlerDefectRefusal', () => {
  it('classifies dispatch-rewritten TypeErrors as handler defects', () => {
    expect(isHandlerDefectRefusal('invalid_input', 'type_error')).toBe(true);
    expect(isHandlerDefectRefusal('invalid_input', 'not_a_function')).toBe(true);
    expect(isHandlerDefectRefusal('invalid_input', 'invalid_time')).toBe(true);
  });
  it('does NOT classify genuine input refusals as defects', () => {
    expect(isHandlerDefectRefusal('invalid_input', 'expected_number')).toBe(false);
    expect(isHandlerDefectRefusal('invalid_input', undefined)).toBe(false);
    expect(isHandlerDefectRefusal('insufficient_balance', 'type_error')).toBe(false);
    expect(isHandlerDefectRefusal('not_found', null)).toBe(false);
  });
});

describe('refusalToastMessage', () => {
  it('humanizes the code and appends the named field/reason', () => {
    expect(refusalToastMessage('invalid_input', 'count', 'expected_number')).toBe('invalid input (count — expected_number)');
    expect(refusalToastMessage('insufficient_balance')).toBe('insufficient balance');
  });
});

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
