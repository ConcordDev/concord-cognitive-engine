/**
 * FIX-legal-006 — the Q&A textbox ate real typing. The legal page binds
 * its workbench tabs to bare letters (p/y/k/q/l) through useLensCommand;
 * before the shared form-field discipline landed (RCA-form-hotkey-steal),
 * those keystrokes belonged to the tab switcher, so a question typed
 * key-by-key never accumulated (Ask stayed disabled) while a
 * programmatic fill — no key events — worked. This test drives the REAL
 * page with the REAL keyboard hooks and the REAL LegalQA, typing a
 * question full of tab-key letters, and pins that the text lands, Ask
 * enables, and the question is what gets asked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast: () => {} }) }),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensAgentFab', () => ({ default: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/feeds/LensFeedPanel', () => ({ LensFeedPanel: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('@/components/legal/ClioSection', () => ({
  ClioSection: () => React.createElement('div', { 'data-testid': 'wb-practice' }, 'ClioSection'),
}));
vi.mock('@/components/legal/ContractAnalyzer', () => ({
  default: () => React.createElement('div', { 'data-testid': 'wb-analyzer' }, 'ContractAnalyzer'),
}));
vi.mock('@/components/legal/CaseTracker', () => ({
  default: () => React.createElement('div', { 'data-testid': 'wb-docket' }, 'CaseTracker'),
}));
vi.mock('@/components/legal/LegalCaseSearch', () => ({
  LegalCaseSearch: () => React.createElement('div', { 'data-testid': 'wb-caselaw' }, 'LegalCaseSearch'),
}));
vi.mock('@/components/legal/LegalActionPanel', () => ({
  LegalActionPanel: () => React.createElement('div', { 'data-testid': 'legal-action-panel' }, 'LegalActionPanel'),
}));
vi.mock('@/components/legal/CourtProcedureReference', () => ({
  CourtProcedureReference: () => null,
}));

import { KeyboardProvider } from '@/lib/keyboard';
import LegalLensPage from '@/app/lenses/legal/page';

const QUESTION = 'A quick plea: what is the filing deadline?';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (req: { domain?: string; action?: string }) => {
    if (req?.domain === 'legal' && req?.action === 'legal-question') {
      return { data: { ok: true, result: { answer: 'Two years from accrual.', jurisdiction: 'US-CA', citations: [], caveats: [] } } };
    }
    return { data: { ok: true, result: {} } };
  });
});

describe('Legal Q&A typing (FIX-legal-006)', () => {
  it('key-by-key typing lands in the box, enables Ask, and asks the typed question', async () => {
    const user = userEvent.setup();
    render(
      <KeyboardProvider>
        <LegalLensPage />
      </KeyboardProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Q&A/ }));
    const box = await waitFor(() => screen.getByPlaceholderText(/Ask a legal question/));
    await user.click(box);
    await user.type(box, QUESTION);
    expect((box as HTMLTextAreaElement).value).toBe(QUESTION);

    const askBtn = screen.getByRole('button', { name: /Ask/ });
    expect((askBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(askBtn);
    await waitFor(() => expect(screen.getByText('Two years from accrual.')).toBeInTheDocument());
    const asked = lensRunMock.mock.calls.find(
      (c) => (c[0] as { action?: string })?.action === 'legal-question',
    );
    expect(asked).toBeTruthy();
    expect((asked?.[0] as { input?: { question?: string } }).input?.question).toBe(QUESTION);
  });
});
