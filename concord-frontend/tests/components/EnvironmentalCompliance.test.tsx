import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { EnvironmentalCompliance } from '@/components/mining/EnvironmentalCompliance';

const SITES = [
  { id: 'ms_1', name: 'North Pit', status: 'active' },
  { id: 'ms_2', name: 'South Quarry', status: 'reclamation' },
];

const RECORDS = [
  {
    id: 'cmp_1', siteId: 'ms_1', siteName: 'North Pit',
    category: 'blasting_permit', status: 'violation',
    permitNumber: 'BL-1', issuingAgency: 'MSHA District 7',
    inspectionDate: '2026-01-01', expiryDate: '2020-01-01',
    notes: 'cited for insufficient stemming',
    isOverdue: true, daysUntilExpiry: -100,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cmp_2', siteId: 'ms_1', siteName: 'North Pit',
    category: 'air_quality_permit', status: 'pending_review',
    permitNumber: 'AQ-2201', issuingAgency: 'State EPA',
    inspectionDate: '2026-01-15', expiryDate: '2027-06-01',
    notes: null,
    isOverdue: false, daysUntilExpiry: 300,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'cmp_3', siteId: 'ms_1', siteName: 'North Pit',
    category: 'other', status: 'compliant',
    permitNumber: null, issuingAgency: null,
    inspectionDate: '2026-02-01', expiryDate: null,
    notes: null,
    isOverdue: false, daysUntilExpiry: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const RECLAMATION_SITES = [
  {
    siteId: 'ms_1',
    reclamation: { phase: 'in_progress', acresDisturbed: 40, acresReclaimed: 10, bondAmount: 25000, bondStatus: 'posted' },
    reclamationPercent: 25,
  },
];

function mockDefaultResponses() {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'mining' && action === 'site-list') {
      return Promise.resolve({ data: { ok: true, result: { sites: SITES }, error: null } });
    }
    if (domain === 'mining' && action === 'compliance-list') {
      return Promise.resolve({
        data: {
          ok: true,
          result: { records: RECORDS, count: RECORDS.length, violationCount: 1, overdueCount: 1, byCategory: { blasting_permit: 1, air_quality_permit: 1, other: 1 } },
          error: null,
        },
      });
    }
    if (domain === 'mining' && action === 'reclamation-list') {
      return Promise.resolve({ data: { ok: true, result: { sites: RECLAMATION_SITES, count: RECLAMATION_SITES.length }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: null, error: null } });
  });
}

describe('EnvironmentalCompliance', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('loads the real site roster and compliance/reclamation data on mount, auto-selecting the first site', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(lensRunMock).toHaveBeenCalledWith('mining', 'site-list', {});
    expect(lensRunMock).toHaveBeenCalledWith('mining', 'compliance-list', { siteId: 'ms_1' });
    expect(lensRunMock).toHaveBeenCalledWith('mining', 'reclamation-list', {});
  });

  it('the site picker is a real select sourced from site-list, not free text', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    const select = screen.getByLabelText('Mine site') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('North Pit');
    expect(optionLabels).toContain('South Quarry');
  });

  it('surfaces the violationCount/overdueCount aggregate prominently', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getByText('Violations').previousElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Overdue renewals').previousElementSibling?.textContent).toBe('1');
  });

  it('renders violation/pending_review/compliant badges with distinct labels', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    // The status <select> also carries "Violation"/"Compliant" as option text,
    // so assert via badge-count rather than a single-match getByText.
    expect(screen.getAllByText('Violation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending Review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Compliant').length).toBeGreaterThan(0);
  });

  it('an overdue record additionally renders a distinct Overdue badge', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('category and status are real selects, not free text/JSON', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    const categorySelect = screen.getByLabelText('Compliance category') as HTMLSelectElement;
    const statusSelect = screen.getByLabelText('Compliance status') as HTMLSelectElement;
    expect(categorySelect.tagName).toBe('SELECT');
    expect(statusSelect.tagName).toBe('SELECT');
    expect(Array.from(categorySelect.options).map((o) => o.value)).toContain('blasting_permit');
    expect(Array.from(statusSelect.options).map((o) => o.value)).toContain('violation');
  });

  it('create flow: submitting calls compliance-log with the right params for the selected site', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'water_discharge_permit' } });
    fireEvent.change(screen.getByLabelText('Compliance status'), { target: { value: 'compliant' } });
    fireEvent.change(screen.getByPlaceholderText('Permit number'), { target: { value: 'WD-500' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { record: { id: 'cmp_new' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Log compliance record'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('mining', 'compliance-log', expect.objectContaining({
      siteId: 'ms_1', category: 'water_discharge_permit', status: 'compliant', permitNumber: 'WD-500',
    }));
  });

  it('a hard-rejected compliance-log call (e.g. unrecognized category) surfaces an inline error', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'unrecognized category: (none)' } });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'air_quality_permit' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Log compliance record'));
    });
    expect(screen.getByText('unrecognized category: (none)')).toBeInTheDocument();
  });

  it('renders the reclamation phase indicator and bond status badge from real data', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getByText('Bond: Posted')).toBeInTheDocument();
  });

  it('the acres-disturbed-vs-reclaimed progress bar reflects reclamationPercent', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    const bar = screen.getByRole('progressbar', { name: 'Acres reclaimed' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('10 / 40 acres reclaimed')).toBeInTheDocument();
  });

  it('reclamation save flow: submitting calls reclamation-update with the form fields', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Reclamation phase'), { target: { value: 'completed' } });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { reclamation: { phase: 'completed' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save reclamation status'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('mining', 'reclamation-update', expect.objectContaining({
      siteId: 'ms_1', phase: 'completed',
    }));
  });

  it('a site with no reclamation activity yet shows the honest "not recorded" message and 0%', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'mining' && action === 'site-list') {
        return Promise.resolve({ data: { ok: true, result: { sites: [{ id: 'ms_9', name: 'Fresh Pit', status: 'active' }] }, error: null } });
      }
      if (domain === 'mining' && action === 'compliance-list') {
        return Promise.resolve({ data: { ok: true, result: { records: [], count: 0, violationCount: 0, overdueCount: 0, byCategory: {} }, error: null } });
      }
      if (domain === 'mining' && action === 'reclamation-list') {
        return Promise.resolve({ data: { ok: true, result: { sites: [], count: 0 }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getByText('No reclamation activity recorded yet.')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Acres reclaimed' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
  });

  it('empty state renders a named message when there are no tracked compliance records', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'mining' && action === 'site-list') {
        return Promise.resolve({ data: { ok: true, result: { sites: SITES }, error: null } });
      }
      if (domain === 'mining' && action === 'compliance-list') {
        return Promise.resolve({ data: { ok: true, result: { records: [], count: 0, violationCount: 0, overdueCount: 0, byCategory: {} }, error: null } });
      }
      if (domain === 'mining' && action === 'reclamation-list') {
        return Promise.resolve({ data: { ok: true, result: { sites: [], count: 0 }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getByText('No compliance records logged for this site yet.')).toBeInTheDocument();
  });

  it('renders a prompt to add a site when no mine sites exist', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'mining' && action === 'site-list') {
        return Promise.resolve({ data: { ok: true, result: { sites: [] }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    await act(async () => {
      render(<EnvironmentalCompliance />);
    });
    expect(screen.getByText(/Add a mine site/)).toBeInTheDocument();
  });
});
