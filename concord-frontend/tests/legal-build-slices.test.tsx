/**
 * build(legal) — FE slice tests (LG-S1/S2/S3/S5/S6a).
 *
 *  · LG-S1 — the declaration: manifest REAL_LIVE + the legal depth
 *    override's "Live" label/caption (the pin test carries the values;
 *    this leg pins the override's existence by lens id).
 *  · LG-S2 — the exits: Close matter / Delete contact run through the
 *    two-step named confirm; the native confirm() is never invoked
 *    (it was the dead gate: R5's three clicks, no effect).
 *  · LG-S3 — LegalQA renders the server's citation verification state
 *    (corrected · in reference / not verified) instead of bare authority.
 *  · LG-S5 — the deadline calculator offers the state response rules and
 *    renders the result's citation + disclaimer; booking writes the
 *    event through calendar-create with the rule recorded.
 *  · LG-S6 — the docket's case form offers the matter link, and a linked
 *    case names its matter in the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/lens/EmptyStateCTA', () => ({ EmptyStateCTA: () => null }));
vi.mock('@/components/legal/LegalMatterMenu', () => ({ LegalMatterMenu: () => null }));
vi.mock('@/components/ui', () => ({ SkeletonTableRows: () => null }));

import { MattersPanel } from '@/components/legal/MattersPanel';
import { ContactsPanel } from '@/components/legal/ContactsPanel';
import { CalendarPanel } from '@/components/legal/CalendarPanel';
import { CaseTracker } from '@/components/legal/CaseTracker';
import { LegalQA } from '@/components/legal/LegalQA';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

type Req = { domain: string; action: string; input?: Record<string, unknown> };
const calls = () => lensRunMock.mock.calls.map(c => c[0] as Req);
const callTo = (action: string) => calls().find(c => c.action === action);

const MATTER = {
  id: 'mat_1', number: 'MAT-00001', name: 'Probe Matter', clientName: 'Probe Client',
  matterType: 'litigation', status: 'open', jurisdiction: 'California', court: '', caseNumber: '',
  hourlyRate: 200, billingType: 'hourly', openedAt: '2026-10-31', closedAt: null, description: '', partyIds: [],
};
const CONTACT = {
  id: 'pty_1', number: 'PTY-00001', name: 'Probe Opposing', kind: 'opposing_party',
  email: '', phone: '', organization: '', address: '', notes: '',
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (req: Req) => {
    switch (req.action) {
      case 'matters-list': return { data: { ok: true, result: { matters: [MATTER] } } };
      case 'contacts-list': return { data: { ok: true, result: { contacts: [CONTACT] } } };
      case 'calendar-list': return { data: { ok: true, result: { events: [] } } };
      case 'case-list': return { data: { ok: true, result: { cases: [] } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('LG-S1 declaration', () => {
  it('manifest declares REAL_LIVE and the badge override reads Live with the CourtListener caption', () => {
    expect(getLensManifest('legal')?.dataTier).toBe('REAL_LIVE');
    const badge = renderHook(() => useDepthBadge('legal')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/CourtListener/);
  });
});

describe('LG-S2 two-step exits (no native confirm)', () => {
  it('Close matter: first click arms the named confirm, second click calls matters-close; window.confirm never fires', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    render(<MattersPanel />);
    const arm = await screen.findByTitle('Close matter');
    fireEvent.click(arm);
    expect(await screen.findByText(/Close “Probe Matter”\?/)).toBeTruthy();
    expect(callTo('matters-close')).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(callTo('matters-close')).toBeTruthy());
    expect(callTo('matters-close')?.input).toEqual({ id: 'mat_1' });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('Delete contact: two-step confirm calls contacts-delete; window.confirm never fires', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    render(<ContactsPanel />);
    const arm = await screen.findByLabelText('Delete');
    fireEvent.click(arm);
    expect(await screen.findByText(/Delete “Probe Opposing”\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(callTo('contacts-delete')).toBeTruthy());
    expect(callTo('contacts-delete')?.input).toEqual({ id: 'pty_1' });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('LG-S3 citation verification rendering', () => {
  it('badges a corrected reference cite and an unverified cite', async () => {
    lensRunMock.mockImplementation(async (req: Req) => {
      if (req.action === 'legal-question') {
        return { data: { ok: true, result: {
          answer: 'You generally have 30 days to respond.',
          jurisdiction: 'US-CA',
          citations: [
            { title: 'Cal. Civ. Proc. Code § 412.20', section: '412.20', verification: 'reference', corrected: true },
            { title: 'California Code of Civil Procedure § 337', section: '337', verification: 'unverified' },
          ],
          caveats: ['This is not legal advice.'],
        } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<LegalQA />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a legal question/), { target: { value: 'How long to respond?' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    expect(await screen.findByText('corrected · in reference')).toBeTruthy();
    expect(await screen.findByText('not verified — check this cite')).toBeTruthy();
  });
});

describe('LG-S5 state deadline rules in the calculator', () => {
  it('offers ca-response, renders citation + disclaimer, and books via calendar-create', async () => {
    lensRunMock.mockImplementation(async (req: Req) => {
      switch (req.action) {
        case 'matters-list': return { data: { ok: true, result: { matters: [MATTER] } } };
        case 'calendar-list': return { data: { ok: true, result: { events: [] } } };
        case 'court-rules-deadline': return { data: { ok: true, result: {
          rule: 'ca-response', ruleName: 'Cal. Civ. Proc. Code § 412.20 — Time to respond to a complaint (California)',
          triggerDate: '2026-10-31', rawDeadline: '2026-11-30', adjustedDeadline: '2026-11-30', rolledForward: false,
          days: 30, citation: 'Cal. Civ. Proc. Code § 412.20', state: 'California',
          disclaimer: 'This is a paraphrased, simplified summary of real published rules for educational reference only — it is not legal advice.',
          countingNote: 'Counted in calendar days with a weekend/holiday roll-forward.',
        } } };
        default: return { data: { ok: true, result: {} } };
      }
    });
    const { container } = render(<CalendarPanel />);
    fireEvent.click(await screen.findByText('Compute a deadline'));
    const ruleSelect = container.querySelector('select')!;
    expect(Array.from(ruleSelect.options).some(o => o.value === 'ca-response')).toBe(true);
    fireEvent.change(ruleSelect, { target: { value: 'ca-response' } });
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '2026-10-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    expect(await screen.findByText(/Deadline: 2026-11-30/)).toBeTruthy();
    expect(await screen.findByText(/not legal advice/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(callTo('calendar-create')).toBeTruthy());
    expect(callTo('calendar-create')?.input).toMatchObject({ date: '2026-11-30', sourceRule: 'ca-response', kind: 'deadline' });
    expect(String(callTo('calendar-create')?.input?.description)).toMatch(/412\.20/);
    expect(String(callTo('calendar-create')?.input?.description)).not.toMatch(/FRCP 6\(a\)/);
  });
});

describe('LG-S6 docket matter link', () => {
  it('the add-case form offers the matter picker', async () => {
    const { container } = render(<CaseTracker />);
    fireEvent.click(await screen.findByTitle('Add case'));
    const selects = Array.from(container.querySelectorAll('select'));
    const matterSelect = selects.find(s => Array.from(s.options).some(o => o.textContent?.includes('Probe Matter')));
    expect(matterSelect).toBeTruthy();
  });

  it('a linked case names its matter in the list', async () => {
    lensRunMock.mockImplementation(async (req: Req) => {
      if (req.action === 'case-list') return { data: { ok: true, result: { cases: [{
        id: 'case_1', caption: 'Link v. Case', caseNumber: '1:26-cv-2', court: 'SDNY', jurisdiction: '',
        filedAt: '2026-10-31', status: 'active', matterType: 'civil', matterId: 'mat_1', events: [],
      }] } } };
      if (req.action === 'matters-list') return { data: { ok: true, result: { matters: [MATTER] } } };
      return { data: { ok: true, result: {} } };
    });
    render(<CaseTracker />);
    expect(await screen.findByText(/Matter: MAT-00001 · Probe Matter/)).toBeTruthy();
  });
});
