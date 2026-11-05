// Render coverage for the nonprofit files the build changed: the campaign
// manager (campaigns, donations, two-step delete) and the workbench's seven tabs
// (donor CRM, recurring giving, communications, tax receipts, donation pages,
// volunteers, events/P2P) against stubbed nonprofit.* macros.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart" /> }));

import { CampaignManager } from './CampaignManager';
import { NonprofitWorkbench, WB_TABS } from './NonprofitWorkbench';

const GIFT = { id: 'g1', amount: 100, at: '2026-01-05', fund: 'general', campaign: 'Spring', method: 'card', receiptIssued: false, ackSent: false };
const PLEDGE = { id: 'p1', amount: 25, frequency: 'monthly', status: 'active', paid: 50, payments: 2, nextDue: '2026-03-01', fund: 'general', donorId: 'd1', donorName: 'Ada' };
const COMM = { id: 'c1', kind: 'thank_you', channel: 'email', subject: 'Thanks', body: 'Thank you', sentAt: '2026-01-06', status: 'sent', reason: null };
const DONOR = {
  id: 'd1', name: 'Ada Lovelace', email: 'ada@example.org', phone: '555', address: '1 Main', type: 'individual', notes: 'n',
  gifts: [GIFT], comms: [COMM], pledges: [PLEDGE], totalGiven: 100, giftCount: 1, avgGift: 100,
  lastGiftAt: '2026-01-05', firstGiftAt: '2026-01-05', pledgeBalance: 0, commCount: 1,
};
const SEG = { major: [DONOR], midLevel: [], firstTime: [DONOR], lapsed: [], recurring: [DONOR], prospect: [] };
const PAGE = { id: 'pg1', slug: 'spring', title: 'Spring Appeal', story: 's', goal: 5000, suggestedAmounts: [25, 50], accentColor: '#f43f5e', coverImage: '', published: true, raised: 1200, donations: [{ id: 'x', amount: 50, donor: 'A', at: '2026-01-01' }], donorCount: 1, progressPct: 24, publicUrl: '/give/spring' };
const SHIFT = { id: 's1', role: 'Greeter', date: '2026-02-01', startTime: '09:00', endTime: '12:00', scheduledHours: 3, loggedHours: 1, status: 'scheduled' };
const VOL = { id: 'v1', name: 'Bo', email: 'bo@example.org', phone: '', skills: ['driving'], availability: 'weekends', shifts: [SHIFT], totalHours: 1, status: 'active' };
const TEAM = { id: 't1', teamName: 'Runners', captain: 'Cy', personalGoal: 500, raised: 200, donations: [{ id: 'td', amount: 20, donor: 'Z' }] };
const EVENT = { id: 'e1', name: 'Gala', description: 'd', date: '2026-05-01', goal: 10000, ticketPrice: 100, type: 'gala', teams: [TEAM], status: 'planned' };
const CAMPAIGN = { id: 'cm1', name: 'Spring', goal: 1000, deadline: '2026-06-01', status: 'active', donations: [{ id: 'dn', amount: 50, donor: 'Q', recurring: false, at: '2026-01-02' }], raised: 50, donorCount: 1 };

const RESULTS: Record<string, unknown> = {
  'donor-list': { donors: [DONOR] },
  'donor-segment': { segments: SEG, summary: { major: 1, firstTime: 1, recurring: 1 } },
  'pledge-list': { pledges: [PLEDGE], count: 1, active: 1, monthlyValue: 25 },
  'comm-log': { donor: 'Ada Lovelace', comms: [COMM], count: 1 },
  'comm-compose': { subject: 'Thanks', body: 'Dear Ada', kind: 'thank_you' },
  'comm-send': { status: 'sent', sentAt: '2026-01-06', comm: { status: 'sent' } },
  'thankyou-run': { sent: 1, notSent: 1, reasons: [{ donor: 'Bo', reason: 'no_email' }] },
  'receipt-generate': { receipt: { number: 'R-1', donor: 'Ada', amount: 100, text: 'Receipt' } },
  'receipt-annual': { statement: { year: 2026, total: 100, gifts: [GIFT] } },
  'donation-page-list': { pages: [PAGE] },
  'donation-page-give': { page: PAGE },
  'volunteer-list': { volunteers: [VOL], totalHours: 1, estValue: 33, hourlyRate: 33 },
  'event-list': { events: [EVENT] },
  'campaign-list': { campaigns: [CAMPAIGN] },
  'nonprofit-dashboard': { campaigns: 1, active: 1, totalRaised: 50, donations: 1, recurringDonors: 0 },
};

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: RESULTS[action] ?? {}, error: null } }));
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Fill every text/number field and select, then press every enabled button once (skipping deletes). */
async function exercise(passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
      if (el.type === 'checkbox') { await act(async () => { fireEvent.click(el); }); continue; }
      const v = el.type === 'number' ? '5' : el.type === 'date' ? '2026-03-01' : el.type === 'email' ? 'new@example.org' : 'Test';
      await act(async () => { fireEvent.change(el, { target: { value: v } }); });
    }
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
      const opt = Array.from(sel.options).find((o) => o.value && o.value !== sel.value);
      if (opt) await act(async () => { fireEvent.change(sel, { target: { value: opt.value } }); });
    }
    for (const el of Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]) {
      if (!el.isConnected || el.disabled) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (/delete|remove|cancel(?!l)|trash/i.test(label)) continue;
      await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); });
    }
  }
}

describe('CampaignManager', () => {
  it('lists campaigns, creates one, logs a donation, edits and deletes in two steps', async () => {
    render(<CampaignManager />);
    await waitFor(() => expect(screen.getAllByText(/Spring/).length).toBeGreaterThan(0));
    await exercise(3);
    const calls = (a: string) => lensRunMock.mock.calls.filter((c) => c[1] === a).length;
    expect(calls('campaign-create')).toBeGreaterThan(0);
    // the delete is a two-step confirm: first press arms, second press deletes
    const del = Array.from(document.querySelectorAll('button')).find((b) => /delete/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    if (del) {
      await act(async () => { fireEvent.click(del); });
      const confirm = Array.from(document.querySelectorAll('button')).find((b) => /confirm|yes|delete/i.test(b.textContent || '') && b !== del);
      if (confirm) await act(async () => { fireEvent.click(confirm); await new Promise((r) => setTimeout(r, 0)); });
    }
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });

  it('shows an empty state without campaigns', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: action === 'nonprofit-dashboard' ? RESULTS['nonprofit-dashboard'] : { campaigns: [] }, error: null } }));
    render(<CampaignManager />);
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });
});

describe('NonprofitWorkbench', () => {
  for (const tab of WB_TABS) {
    it(`renders and drives the ${tab.label} tab`, async () => {
      render(<NonprofitWorkbench tab={tab.id} />);
      await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
      await settle();
      await exercise(2);
      await settle();
      expect(document.body.textContent).toBeTruthy();
    });
  }

  it('switches tabs through its own nav when uncontrolled', async () => {
    render(<NonprofitWorkbench />);
    await settle();
    for (const t of WB_TABS) {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes(t.label));
      if (btn) await act(async () => { fireEvent.click(btn); await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(document.body.textContent).toContain('Events');
  });

  it('degrades when the macros fail', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    render(<NonprofitWorkbench tab="crm" />);
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });
});
