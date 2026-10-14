/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-SWEEP government F1 — BillTracker must render the real
 * government.bills-list payload (billId/title/latestAction, NO status/id)
 * without throwing, so BillsDesk can mount Save-as-DTU below it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import {
  BillTracker,
  normalizeBill,
  statusLabel,
  type BillsListRow,
} from '@/components/government/BillTracker';

/** Exact congress.gov shape from the strict walk (no status, no id). */
const REAL_PAYLOAD: BillsListRow[] = [
  {
    billId: 'S5626-119',
    congress: 119,
    type: 'S',
    number: '5626',
    title: 'Higher Education Grant Flexibility Act of 2026',
    introducedDate: '2026-01-15',
    latestAction: 'Read twice and referred to the Committee on Health.',
    latestActionDate: '2026-01-15',
    originChamber: 'Senate',
    url: 'https://www.congress.gov/bill/119th-congress/senate-bill/5626',
  },
  {
    billId: 'HR100-119',
    congress: 119,
    type: 'HR',
    number: 100,
    title: 'A bill with no status field at all',
    latestAction: null,
    latestActionDate: null,
  },
];

describe('normalizeBill / statusLabel (F1 payload shape)', () => {
  it('never crashes statusLabel on missing/undefined status', () => {
    expect(statusLabel(undefined)).toBe('unknown');
    expect(statusLabel(null)).toBe('unknown');
    expect(statusLabel('passed_chamber')).toBe('passed chamber');
  });

  it('maps billId → id and derives status when status is absent', () => {
    const b = normalizeBill(REAL_PAYLOAD[0]);
    expect(b.id).toBe('S5626-119');
    expect(b.title).toContain('Higher Education');
    expect(b.status).toBe('committee'); // "referred to the Committee"
    expect(() => statusLabel(b.status).replace(/_/g, ' ')).not.toThrow();
  });

  it('uses unknown when both status and latestAction are missing', () => {
    const b = normalizeBill(REAL_PAYLOAD[1]);
    expect(b.id).toBe('HR100-119');
    expect(b.status).toBe('unknown');
  });
});

describe('BillTracker', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { bills: REAL_PAYLOAD } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the real no-status payload without crashing (Save-as-DTU parent stays mounted)', async () => {
    render(
      <div>
        <BillTracker />
        <button type="button">Save as DTU</button>
      </div>
    );

    expect(await screen.findByText(/Higher Education Grant Flexibility Act/i)).toBeInTheDocument();
    expect(screen.getByText(/A bill with no status field/i)).toBeInTheDocument();
    // Status badges rendered (committee / unknown) — never threw on .replace
    expect(screen.getAllByText('committee').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('unknown').length).toBeGreaterThanOrEqual(1);
    // Sibling Save-as-DTU control remains reachable (F1: was behind error boundary)
    expect(screen.getByRole('button', { name: /Save as DTU/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'government', action: 'bills-list' }),
      );
    });
  });
});
