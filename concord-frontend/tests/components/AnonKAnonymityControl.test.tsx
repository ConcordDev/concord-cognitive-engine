// AnonKAnonymityControl.test.tsx
//
// FIX-anon-002 (FE leg): the Privacy Lab ran anonymize with a silent
// server-side default k=3 — there was no k control anywhere. The lab
// now has a k input and sends it as params.k; the anonymize result
// also names its scope and shows the generalized sample so its stats
// stop reading as a contradiction of the raw-data risk score.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/anon/TorNetworkStatus', () => ({ TorNetworkStatus: () => null }));
vi.mock('@/components/anon/AnonMessenger', () => ({ AnonMessenger: () => null }));
vi.mock('@/components/anon/PrivacyBudgetPanel', () => ({ PrivacyBudgetPanel: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], alerts: [], isLive: false, lastUpdated: null }),
}));
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    Lock: createIcon('Lock'), Zap: createIcon('Zap'), BarChart3: createIcon('BarChart3'),
    XCircle: createIcon('XCircle'), Loader2: createIcon('Loader2'), Fingerprint: createIcon('Fingerprint'),
    ShieldAlert: createIcon('ShieldAlert'), Waves: createIcon('Waves'), AlertTriangle: createIcon('AlertTriangle'),
    CheckCircle: createIcon('CheckCircle'), MessageSquare: createIcon('MessageSquare'), Database: createIcon('Database'),
    Plus: createIcon('Plus'), Trash2: createIcon('Trash2'), Sparkles: createIcon('Sparkles'),
    Network: createIcon('Network'), Gauge: createIcon('Gauge'),
  };
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import AnonLensPage from '@/app/lenses/anon/page';

describe('Privacy Lab k control (FIX-anon-002)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'anonymize') {
        return { data: { ok: true, result: {
          k: 4, generalizationLevel: 2, equivalenceClasses: 1, informationLoss: 50,
          quasiIdentifiers: ['age', 'zipcode'], kAchieved: true,
          anonymizedSample: [{ age: '0-99', zipcode: '941*', condition: '[REDACTED]' }],
        } } };
      }
      return { data: { ok: true, result: {} } };
    });
  });
  afterEach(() => cleanup());

  it('sends the chosen k and shows the generalized sample with its scope', async () => {
    render(React.createElement(AnonLensPage));
    fireEvent.click(screen.getByText('Privacy lab'));
    fireEvent.click(await screen.findByText(/Load example dataset/));

    const kInput = screen.getByLabelText('K-anonymity target (k)') as HTMLInputElement;
    fireEvent.change(kInput, { target: { value: '4' } });
    expect(kInput.value).toBe('4');

    fireEvent.click(screen.getByText('Anonymize Data'));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'anonymize');
    expect(call).toBeTruthy();
    expect(call[2]).toMatchObject({ k: 4 });

    expect(await screen.findByText(/describe the generalized output/)).toBeTruthy();
    expect(screen.getByText(/zip 941\*/)).toBeTruthy();
  });
});
