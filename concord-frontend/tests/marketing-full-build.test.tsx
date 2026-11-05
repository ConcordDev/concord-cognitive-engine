/**
 * build(marketing) GB-1088 — FE behaviour pins for the full lens build.
 *
 * The lens-states suite stubs panels as inert; this suite does the
 * opposite: it mocks only the transport (`lensRun`) and renders the REAL
 * panels, pinning the behaviours the build changed:
 *   S3 — the Gmail panel's Send history renders ALWAYS, with an honest
 *        "No sends yet" empty state (it used to mount only after a send).
 *   S2 — the send surface names the connected Gmail account, read from
 *        the existing gmail `profile` verb (no new server machinery).
 *   S6 — a segment row carries a delete control wired to segment-delete.
 *   S8 — the SEO headings field derives a count from pasted headings
 *        (one per line) and shows the derivation, instead of Number(text)
 *        silently auditing pasted text as zero headings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({
  state: {
    segments: [] as Array<{ id: string; name: string; criteria?: string; size: number }>,
    history: [] as Array<{ id: string; at: string; sent: number; failed: number }>,
    calls: [] as Array<[string, string, Record<string, unknown>]>,
  },
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (domain: string, name: string, input: Record<string, unknown> = {}) => {
    h.state.calls.push([domain, name, input]);
    if (domain === 'marketing' && name === 'campaign-gmail-send-history') {
      return { data: { ok: true, result: { sends: h.state.history } } };
    }
    if (domain === 'gmail' && name === 'profile') {
      return { data: { ok: true, result: { profile: { emailAddress: 'founder@example.com' } } } };
    }
    if (domain === 'marketing' && name === 'segment-list') {
      return { data: { ok: true, result: { segments: h.state.segments, totalReach: 0 } } };
    }
    if (domain === 'marketing' && name === 'channel-performance') {
      return { data: { ok: true, result: { channels: [] } } };
    }
    if (domain === 'marketing' && name === 'segment-delete') {
      h.state.segments = h.state.segments.filter((s) => s.id !== input.id);
      return { data: { ok: true, result: { deleted: input.id } } };
    }
    if (domain === 'marketing' && name === 'seo-audit-list') {
      return { data: { ok: true, result: { audits: [], avgScore: 0 } } };
    }
    return { data: { ok: true, result: {} } };
  },
}));

import { MarketingGmailSendPanel } from '@/components/marketing/MarketingGmailSendPanel';
import { MarketingChannelsPanel } from '@/components/marketing/MarketingChannelsPanel';
import { MarketingSEOPanel } from '@/components/marketing/MarketingSEOPanel';

beforeEach(() => {
  h.state.segments = [];
  h.state.history = [];
  h.state.calls = [];
});

describe('build(marketing) S3+S2 — Gmail send panel', () => {
  it('renders the Send history block with an honest empty state before any send', async () => {
    render(<MarketingGmailSendPanel campaignId="camp_1" campaignName="Launch" />);
    const block = await screen.findByTestId('gmail-send-history');
    expect(block).toBeTruthy();
    expect(block.textContent).toContain('No sends yet');
  });

  it('names the connected account at the send surface', async () => {
    render(<MarketingGmailSendPanel campaignId="camp_1" campaignName="Launch" />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('founder@example.com');
    });
    expect(h.state.calls.some(([d, n]) => d === 'gmail' && n === 'profile')).toBe(true);
  });
});

describe('build(marketing) S6 — segment delete control', () => {
  it('deletes a segment through the verb and the row leaves the list', async () => {
    h.state.segments = [{ id: 'seg_1', name: 'VIP buyers', size: 250 }];
    render(<MarketingChannelsPanel />);
    const btn = await screen.findByLabelText('Delete segment');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(h.state.calls.some(([d, n, i]) => d === 'marketing' && n === 'segment-delete' && i.id === 'seg_1')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText('VIP buyers')).toBeNull();
    });
  });
});

describe('build(marketing) S8 — SEO headings derivation', () => {
  it('counts pasted headings one per line and shows the derivation', async () => {
    render(<MarketingSEOPanel />);
    const field = await screen.findByPlaceholderText(/Headings — enter a count/);
    fireEvent.change(field, { target: { value: 'Welcome to the guide\nPricing explained\n\nGet started' } });
    expect(await screen.findByText('Counts as 3 headings.')).toBeTruthy();
  });

  it('a plain number is itself the count', async () => {
    render(<MarketingSEOPanel />);
    const field = await screen.findByPlaceholderText(/Headings — enter a count/);
    fireEvent.change(field, { target: { value: '6' } });
    expect(await screen.findByText('Counts as 6 headings.')).toBeTruthy();
  });
});
