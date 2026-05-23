import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// AdvancedAccountingPanel calls lensRun(domain, action, input) positionally.
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AdvancedAccountingPanel } from '@/components/accounting/AdvancedAccountingPanel';

// default: every macro resolves to an ok-but-empty envelope
function defaultImpl(action: string) {
  const empty: Record<string, unknown> = {
    'bank-feeds-institutions-list': { institutions: [], aggregatorConfigured: false },
    'currency-list': { base: 'USD', rates: [] },
    'dimension-list': { dimensions: [] },
    'payrun-list': { runs: [] },
    'recurring-bills-list': { recurringBills: [] },
    'vendors-list': { vendors: [] },
    'coa-list': { accounts: [] },
    'audit-log-list': { entries: [] },
  };
  return { data: { ok: true, result: empty[action] ?? {} } };
}

beforeEach(() => {
  vi.clearAllMocks();
  lensRun.mockImplementation((_d: string, action: string) => Promise.resolve(defaultImpl(action)));
});

describe('AdvancedAccountingPanel', () => {
  it('renders all eight feature tabs and defaults to bank feeds', async () => {
    render(<AdvancedAccountingPanel />);
    expect(screen.getByText('Bank feeds')).toBeInTheDocument();
    expect(screen.getByText('Multi-currency')).toBeInTheDocument();
    expect(screen.getByText('1099 / W-2')).toBeInTheDocument();
    expect(await screen.findByText(/Link an institution/)).toBeInTheDocument();
  });

  it('shows the not-configured aggregator banner and links an institution', async () => {
    render(<AdvancedAccountingPanel />);
    expect(await screen.findByText(/Live aggregator not configured/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Institution name/), { target: { value: 'Chase' } });
    fireEvent.click(screen.getByText('Link account'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('accounting', 'bank-feeds-link-institution', expect.objectContaining({ name: 'Chase' })),
    );
  });

  it('renders linked institutions and surfaces a link error', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'bank-feeds-institutions-list') {
        return Promise.resolve({ data: { ok: true, result: { aggregatorConfigured: true, institutions: [
          { id: 'b1', name: 'Chase', accountMask: '1234', status: 'linked', linkedAt: '2026-05-01', lastSyncAt: null, lastSyncCount: 0 },
        ] } } });
      }
      if (action === 'bank-feeds-link-institution') return Promise.resolve({ data: { ok: false, error: 'link failed' } });
      return Promise.resolve(defaultImpl(action));
    });
    render(<AdvancedAccountingPanel />);
    expect(await screen.findByText('Chase ····1234')).toBeInTheDocument();
    expect(screen.getByText(/Live aggregator configured/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Institution name/), { target: { value: 'Wells' } });
    fireEvent.click(screen.getByText('Link account'));
    expect(await screen.findByText('link failed')).toBeInTheDocument();
  });

  it('switches to the multi-currency tab and refreshes FX rates', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Multi-currency'));
    expect(await screen.findByText(/No FX rates loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Refresh FX rates'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('accounting', 'currency-refresh-rates', {}),
    );
  });

  it('runs an FX revaluation and shows the position error when empty', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Multi-currency'));
    await screen.findByText('FX revaluation');
    fireEvent.click(screen.getByText('Revalue'));
    expect(await screen.findByText(/Add at least one foreign-currency position/)).toBeInTheDocument();
  });

  it('switches to dimensions and creates a dimension tag', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Dimensions'));
    expect(await screen.findByText(/New dimension tag/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Tag name'), { target: { value: 'West Region' } });
    fireEvent.click(screen.getByText('Dimensions').closest('div')!.parentElement!.querySelector('button.bg-emerald-600')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('accounting', 'dimension-create', expect.objectContaining({ name: 'West Region' })),
    );
  });

  it('switches to payroll tax and prepares Form 941', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'payroll-tax-efile') {
        return Promise.resolve({ data: { ok: true, result: { filing: {
          form: '941', year: 2026, quarter: 2, employeeCount: 3, grossWages: 30000,
          federalIncomeTaxWithheld: 4000, totalTaxLiability: 8000, status: 'ready', note: 'review',
        } } } });
      }
      return Promise.resolve(defaultImpl(action));
    });
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Payroll tax'));
    await screen.findByText(/Form 941/);
    fireEvent.click(screen.getByText('Prepare 941'));
    expect(await screen.findByText(/ready — review/)).toBeInTheDocument();
  });

  it('switches to recurring bills and shows the empty state', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Recurring bills'));
    expect(await screen.findByText('No recurring bills scheduled.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Run due now'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('accounting', 'recurring-bills-run-due', {}),
    );
  });

  it('switches to receipt OCR and errors on an empty paste', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Receipt OCR'));
    await screen.findByText(/Receipt OCR text/);
    // scan button disabled when textarea is empty — type then clear is overkill; assert disabled
    expect(screen.getByText('Parse receipt')).toBeDisabled();
  });

  it('parses a receipt when OCR text is provided', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'receipt-ocr') {
        return Promise.resolve({ data: { ok: true, result: { parsed: {
          vendor: 'Staples', date: '2026-05-12', total: 14.06, tax: 1.07, missing: [], confidence: 0.9,
        } } } });
      }
      return Promise.resolve(defaultImpl(action));
    });
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Receipt OCR'));
    await screen.findByText(/Receipt OCR text/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'STAPLES\nTOTAL 14.06' } });
    fireEvent.click(screen.getByText('Parse receipt'));
    expect(await screen.findByText('Staples')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('switches to the audit log tab and shows the empty state', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('Audit log'));
    expect(await screen.findByText(/No edits recorded yet/)).toBeInTheDocument();
  });

  it('switches to the 1099 / W-2 tab and toggles modes', async () => {
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('1099 / W-2'));
    expect(await screen.findByText(/IRS FIRE-format/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('W-2'));
    expect(await screen.findByText(/SSA EFW2-format/)).toBeInTheDocument();
    // generate disabled until entity name + 9-digit EIN
    expect(screen.getByText('Generate file')).toBeDisabled();
  });

  it('generates a 1099 FIRE file and renders the result', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'efile-1099-fire') {
        return Promise.resolve({ data: { ok: true, result: {
          form: '1099-NEC', year: 2025, format: 'FIRE', payeeCount: 2, totalReported: 9000,
          fireFile: 'LINE1\nLINE2', filename: '1099.txt', note: 'submit to IRS FIRE',
        } } });
      }
      return Promise.resolve(defaultImpl(action));
    });
    render(<AdvancedAccountingPanel />);
    await screen.findByText(/Link an institution/);
    fireEvent.click(screen.getByText('1099 / W-2'));
    await screen.findByText(/IRS FIRE-format/);
    fireEvent.change(screen.getByPlaceholderText('Payer name'), { target: { value: 'My Co' } });
    fireEvent.change(screen.getByPlaceholderText(/Payer EIN/), { target: { value: '123456789' } });
    fireEvent.click(screen.getByText('Generate file'));
    expect(await screen.findByText('1099-NEC')).toBeInTheDocument();
    expect(screen.getByText(/submit to IRS FIRE/)).toBeInTheDocument();
  });
});
