/**
 * anon-full-build.test.tsx — B6 F-B build(anon) FE pins.
 *
 * (S2/F1) Tor flags come from the DETAILS document (real flag names,
 * counted once per relay of the stated sample). The summary payload's
 * per-relay "f" is a fingerprint — its letters must never become counts.
 * (S5/F4) the anonymize panel headlines the ACHIEVED k and renders the
 * generalized table. (S6/F5) all three attack models render.
 * (S3/F2) DP renders the named statistics with their noisy values.
 * (S7/F7) the lab dataset restores from this browser's storage on mount.
 * (S4/F3) Rotate is two-step: the first click arms with the consequence,
 * the second performs the rotation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Tor ──────────────────────────────────────────────────────────────
const SUMMARY = {
  relays_published: '2026-10-31 12:00:00',
  // f is a FINGERPRINT (40 hex chars, heavy on the letter E) — the trap.
  relays: [
    { n: 'r1', f: 'EEEEEEEEEE1111111111AAAAAAAAAAAAAAAAAAAA' },
    { n: 'r2', f: 'EEEEEEEEEE2222222222AAAAAAAAAAAAAAAAAAAA' },
    { n: 'r3', f: 'EEEEEEEEEE3333333333AAAAAAAAAAAAAAAAAAAA' },
  ],
  bridges: [{ n: 'b1', h: 'x' }],
};
const DETAILS = {
  relays: [
    { nickname: 'r1', fingerprint: 'EE', flags: ['Exit', 'Fast', 'Running', 'Valid'] },
    { nickname: 'r2', fingerprint: 'EE', flags: ['Fast', 'Guard', 'Running', 'Valid'] },
    { nickname: 'r3', fingerprint: 'EE', flags: ['Fast', 'Running', 'Valid'] },
  ],
};

vi.mock('@/lib/public-lookup', () => ({
  publicLookup: async (action: string) => (action === 'onionoo-details' ? DETAILS : SUMMARY),
  carryLookupMeta: (d: unknown) => d,
  lookupMeta: () => null,
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { TorNetworkStatus } from '@/components/anon/TorNetworkStatus';

describe('build(anon) — Tor flags (S2)', () => {
  it('counts real flags once per relay of the details sample; fingerprint letters never count', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><TorNetworkStatus /></QueryClientProvider>);
    // Fast is on all 3 sampled relays → 100%; Exit on 1 → 33%.
    await waitFor(() => expect(screen.getByText(/Flag distribution \(details sample of 3 relays\)/)).toBeTruthy());
    // Fast/Running/Valid are on all 3 relays (100% ×3); Exit and Guard
    // are each on 1 of 3 (33% ×2). Fingerprint counting could produce
    // neither distribution (and produced shares above 100%).
    expect(screen.getAllByText('100%').length).toBe(3);
    expect(screen.getAllByText('33%').length).toBe(2);
    // Exit nodes cell = 1 (the details truth), not a fingerprint count.
    expect(screen.getByText('Exit nodes')).toBeTruthy();
  });
});

// ── Lab page ─────────────────────────────────────────────────────────
const ANON_RESULTS: Record<string, unknown> = {
  anonymize: {
    k: 3, kAchieved: true, generalizationLevel: 1, equivalenceClasses: 2,
    informationLoss: 40, minClassSize: 5, quasiIdentifiers: ['age', 'zipcode'],
    anonymizedRecords: [
      { age: '20-29', zipcode: '941**', condition: '[REDACTED]' },
      { age: '20-29', zipcode: '941**', condition: '[REDACTED]' },
    ],
    anonymizedSample: [],
  },
  privacyRisk: {
    overallRiskLevel: 'critical',
    attackModels: {
      prosecutor: { risk: 100, description: 'Targeted attack on known individual' },
      journalist: { risk: 40, description: 'Random re-identification attempt' },
      marketer: { risk: 25, description: 'Bulk re-identification' },
    },
    recommendations: [],
  },
  differentialPrivacy: {
    privacyParameters: { epsilon: 1, privacyLevel: 'moderate', queriesProcessed: 3 },
    budgetTracking: { cumulative: 1 },
    results: [
      { type: 'count', trueAnswer: 10, noisyAnswer: 10.42, confidenceInterval95: 3.1, relativeError: 4.2 },
      { type: 'mean', trueAnswer: 41.2, noisyAnswer: 39.9, confidenceInterval95: 8.4, relativeError: 3.1 },
    ],
  },
};

const lensRunCalls: string[] = [];
const rotateCalls: string[] = [];
const IDENTITY = {
  anonId: 'aid_1', alias: 'anon-aaaa1111', publicKey: 'pk', fingerprint: 'FP123',
  keyCustody: 'server', createdAt: 1, rotatedAt: null, verifiedPeerCount: 0,
};
vi.mock('@/lib/api/client', () => ({
  lensRun: async (_domain: string, action: string) => {
    lensRunCalls.push(action);
    if (action === 'rotateIdentity') {
      rotateCalls.push(action);
      return { data: { ok: true, result: { ...IDENTITY, alias: 'anon-bbbb2222', anonId: 'aid_2' } } };
    }
    if (action === 'identity') return { data: { ok: true, result: IDENTITY } };
    if (action === 'listConversations') return { data: { ok: true, result: { conversations: [] } } };
    if (action === 'directory') return { data: { ok: true, result: { peers: [] } } };
    if (action in ANON_RESULTS) return { data: { ok: true, result: ANON_RESULTS[action] } };
    return { data: { ok: true, result: {} } };
  },
  api: { get: async () => ({}), post: async () => ({}) },
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
// NOTE: AnonMessenger and TorNetworkStatus are NOT stubbed here — they
// are exercised directly below; the page renders the real messenger
// (its own dependencies are mocked) and never visits the network view.
vi.mock('@/components/anon/PrivacyBudgetPanel', () => ({ PrivacyBudgetPanel: () => null }));
vi.mock('framer-motion', () => ({
  motion: { div: ({ children, ...p }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('div', p, children) },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

import AnonLensPage from '@/app/lenses/anon/page';

async function renderLab() {
  render(<AnonLensPage />);
  fireEvent.click(screen.getByText('Privacy lab'));
  await waitFor(() => expect(screen.getByText('Load example dataset')).toBeTruthy());
  fireEvent.click(screen.getByText('Load example dataset'));
  await waitFor(() => expect(screen.getByText(/Dataset \(10 records\)/)).toBeTruthy());
}

describe('build(anon) — Privacy Lab panels', () => {
  beforeEach(() => { lensRunCalls.length = 0; window.localStorage.clear(); });

  it('S5: anonymize headlines the ACHIEVED k and renders the generalized table', async () => {
    await renderLab();
    fireEvent.click(screen.getByText('Anonymize Data'));
    await waitFor(() => expect(screen.getByText(/K achieved \(smallest class\) · requested 3/)).toBeTruthy());
    expect(screen.getByText('Generalized records (2)')).toBeTruthy();
    expect(screen.getAllByText('20-29').length).toBeGreaterThan(0);
    expect(screen.getAllByText('[REDACTED]').length).toBeGreaterThan(0);
  });

  it('S6: privacy risk renders all three attack models', async () => {
    await renderLab();
    fireEvent.click(screen.getByText('Privacy Risk'));
    await waitFor(() => expect(screen.getByText(/prosecutor \(worst case\)/)).toBeTruthy());
    expect(screen.getByText('journalist')).toBeTruthy();
    expect(screen.getByText('marketer')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
  });

  it('S3: differential privacy renders the named statistics with noisy values', async () => {
    await renderLab();
    fireEvent.click(screen.getByText('Differential Privacy'));
    await waitFor(() => expect(screen.getByText('Queries processed')).toBeTruthy());
    expect(screen.getByText('count of ages')).toBeTruthy();
    expect(screen.getByText(/noisy 10\.42/)).toBeTruthy();
    expect(screen.getByText(/noisy 39\.9/)).toBeTruthy();
  });

  it('S7: a dataset stored in this browser is restored on mount', async () => {
    window.localStorage.setItem('concord.anon.labRecords.v1', JSON.stringify([
      { age: 34, zipcode: '94110', condition: 'Flu' },
      { age: 51, zipcode: '94110', condition: 'Cold' },
    ]));
    render(<AnonLensPage />);
    fireEvent.click(screen.getByText('Privacy lab'));
    await waitFor(() => expect(screen.getByText(/Dataset \(2 records\)/)).toBeTruthy());
  });

  it('S7: a non-numeric zipcode is refused in words and the row is not added', async () => {
    await renderLab();
    const age = screen.getByPlaceholderText('34');
    const zip = screen.getByPlaceholderText('94110');
    fireEvent.change(age, { target: { value: '40' } });
    fireEvent.change(zip, { target: { value: 'ABCDE' } });
    fireEvent.click(screen.getByText('Add row'));
    await waitFor(() => expect(screen.getByText('Zipcode must be numeric — the row was not added.')).toBeTruthy());
    expect(screen.getByText(/Dataset \(10 records\)/)).toBeTruthy();
  });
});

// ── Messenger rotate ─────────────────────────────────────────────────
vi.mock('@/hooks/useSocket', () => ({ useSocket: () => ({ on: vi.fn(), off: vi.fn(), isConnected: true }) }));
vi.mock('@/lib/anon/encryption-copy', () => ({
  SERVER_READABLE_NOTICE: 'Server-readable',
  anonEncryptionNotice: () => ({ badge: 'Server-readable', body: 'Encrypted in transit and stored encrypted on Concord’s server; Concord can technically read these.' }),
  claimEndToEnd: () => false,
}));
vi.mock('@/lib/anon/client-e2e', () => ({
  buildAnonSendPayload: (x: unknown) => x,
  buildIdentityParams: () => ({}),
  isAnonClientE2EFlagOn: () => false,
  loadOrCreateClientKey: async () => null,
  openSealed: async () => '',
  createClientKeyPair: async () => ({}),
  writeStoredClientKey: vi.fn(),
  sealEnvelopes: async () => ({}),
  safetyNumberGroups: () => [],
}));

import { AnonMessenger } from '@/components/anon/AnonMessenger';

describe('build(anon) — Rotate is two-step (S4)', () => {
  it('the first click arms with the consequence and does not rotate; the second rotates', async () => {
    rotateCalls.length = 0;
    render(<AnonMessenger />);
    const btn = await screen.findByTitle('Rotate pseudonym');
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText(/Rotate\? Prior traffic unlinks/)).toBeTruthy());
    expect(rotateCalls.length).toBe(0);
    fireEvent.click(screen.getByTitle(/Click again to rotate/));
    await waitFor(() => expect(rotateCalls.length).toBe(1));
  });
});
