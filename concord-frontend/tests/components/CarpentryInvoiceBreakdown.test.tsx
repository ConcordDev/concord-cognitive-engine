// CarpentryInvoiceBreakdown.test.tsx
//
// FIX-carpentry-009: an invoice card showed only the total ($100),
// though the invoice carries subtotal and tax. The card now renders
// Subtotal / Tax (rate) / Total lines — at 0% tax the audit's exact
// case reads Subtotal $100.00 · Tax (0%) $0.00 · Total $100.00.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  const names = ['Scissors', 'ClipboardList', 'CalendarClock', 'Timer', 'Camera', 'Receipt',
    'Plus', 'Trash2', 'Loader2', 'Play', 'Square', 'PenLine', 'Link2', 'Check', 'X',
    'UserPlus', 'FileSignature'];
  return Object.fromEntries(names.map((n) => [n, createIcon(n)]));
});

vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));

const INVOICE = {
  id: 'inv_1', invoiceNumber: 'INV-1002', estimateId: 'est_1', client: 'Ada',
  subtotal: 100, tax: 0, taxPct: 0, total: 100,
  depositPct: 0, depositDue: 0, status: 'issued', signature: null,
};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string) => {
    if (action === 'invoiceList') {
      return { data: { ok: true, result: { invoices: [INVOICE], outstanding: 100, collected: 0 }, error: null } };
    }
    if (action === 'portalList') {
      return { data: { ok: true, result: { shares: [] }, error: null } };
    }
    return { data: { ok: true, result: null, error: null } };
  }),
}));

import { JobOps } from '@/components/carpentry/JobOps';

describe('Carpentry invoice breakdown (FIX-carpentry-009)', () => {
  afterEach(() => cleanup());

  it('renders subtotal, tax, and total lines on the invoice card', async () => {
    render(React.createElement(JobOps));
    fireEvent.click(screen.getByText('Invoicing'));
    await screen.findByText('INV-1002 · Ada');
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getByText('Tax (0%)')).toBeTruthy();
    expect(screen.getAllByText('$100.00')).toHaveLength(2); // subtotal + total
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
  });
});
