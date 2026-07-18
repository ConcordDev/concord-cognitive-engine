import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProducerCompliance } from '@/components/insurance/ProducerCompliance';

const AGENTS = [
  { id: 'agt_1', name: 'Jordan Reyes' },
  { id: 'agt_2', name: 'Priya Nair' },
];

const RECORDS = [
  {
    id: 'pc_1', agentId: 'agt_1', agentName: 'Jordan Reyes', agentFound: true,
    category: 'license_renewal', notes: null, status: 'overdue',
    licenseNumber: 'LIC-1', state: 'TX', expiryDate: '2020-01-01',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pc_2', agentId: 'agt_2', agentName: 'Priya Nair', agentFound: true,
    category: 'ce_credits', notes: null, status: 'scheduled',
    periodLabel: '2026-2027 cycle', creditsCompleted: 6, creditsRequired: 24,
    creditsPercent: 25, creditsComplete: false, expiryDate: '2027-06-01',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'pc_3', agentId: 'agt_1', agentName: null, agentFound: false,
    category: 'carrier_appointment', notes: null, status: 'due_soon',
    carrierName: 'Progressive', appointmentNumber: null, expiryDate: '2026-08-01',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function mockDefaultResponses() {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'insurance' && action === 'agent-list') {
      return Promise.resolve({ data: { ok: true, result: { agents: AGENTS }, error: null } });
    }
    if (domain === 'insurance' && action === 'producer-compliance-list') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            records: RECORDS, overdueCount: 1, dueSoonCount: 1,
            byCategory: { license_renewal: 1, ce_credits: 1, carrier_appointment: 1 },
          },
          error: null,
        },
      });
    }
    return Promise.resolve({ data: { ok: true, result: null, error: null } });
  });
}

describe('ProducerCompliance', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('loads the real agent roster and compliance records on mount', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'agent-list', {});
    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'producer-compliance-list', {});
    expect(screen.getAllByText('Jordan Reyes').length).toBeGreaterThan(0);
    expect(screen.getByText(/2026-2027 cycle/)).toBeInTheDocument();
  });

  it('surfaces the overdueCount/dueSoonCount aggregate prominently', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(screen.getByText('Overdue items').previousElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Due within 30 days').previousElementSibling?.textContent).toBe('1');
  });

  it('the producer picker is a real select sourced from agent-list, not free text', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    const select = screen.getByLabelText('Producer') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain('Jordan Reyes');
    expect(optionLabels).toContain('Priya Nair');
  });

  it('the category select is adaptive: ce_credits fields show by default', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(screen.getByPlaceholderText('Period label (e.g. 2026-2027 cycle)')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('License number')).not.toBeInTheDocument();
  });

  it('switching category to license_renewal swaps the form fields entirely', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'license_renewal' } });
    expect(screen.getByPlaceholderText('License number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('State')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Period label (e.g. 2026-2027 cycle)')).not.toBeInTheDocument();
  });

  it('switching category to eo_insurance shows carrier + policy number fields', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'eo_insurance' } });
    expect(screen.getByPlaceholderText('E&O carrier')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Policy number')).toBeInTheDocument();
  });

  it('switching category to carrier_appointment shows carrierName + optional appointment #', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'carrier_appointment' } });
    expect(screen.getByPlaceholderText('Carrier name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Appointment # (optional)')).toBeInTheDocument();
  });

  it('create flow (ce_credits): submitting calls producer-compliance-add with the right params', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Producer'), { target: { value: 'agt_1' } });
    fireEvent.change(screen.getByPlaceholderText('Period label (e.g. 2026-2027 cycle)'), { target: { value: 'Test Cycle' } });
    fireEvent.change(screen.getByPlaceholderText('Credits completed'), { target: { value: '10' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { record: { id: 'pc_new' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add compliance record'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'producer-compliance-add', expect.objectContaining({
      agentId: 'agt_1', category: 'ce_credits', periodLabel: 'Test Cycle', creditsCompleted: 10,
    }));
  });

  it('create flow (license_renewal): submitting calls producer-compliance-add with license fields', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByLabelText('Producer'), { target: { value: 'agt_2' } });
    fireEvent.change(screen.getByLabelText('Compliance category'), { target: { value: 'license_renewal' } });
    fireEvent.change(screen.getByPlaceholderText('License number'), { target: { value: 'LIC-500' } });
    fireEvent.change(screen.getByPlaceholderText('State'), { target: { value: 'CA' } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2027-01-01' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { record: { id: 'pc_new2' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Add compliance record'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'producer-compliance-add', expect.objectContaining({
      agentId: 'agt_2', category: 'license_renewal', licenseNumber: 'LIC-500', state: 'CA', expiryDate: '2027-01-01',
    }));
  });

  it('rejects submitting without selecting a producer (inline error, no API call)', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    fireEvent.change(screen.getByPlaceholderText('Period label (e.g. 2026-2027 cycle)'), { target: { value: 'No Producer' } });
    lensRunMock.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByText('Add compliance record'));
    });
    expect(screen.getByText('Select a producer first.')).toBeInTheDocument();
    expect(lensRunMock).not.toHaveBeenCalledWith('insurance', 'producer-compliance-add', expect.anything());
  });

  it('update flow: editing a record sends only a partial payload (id + changed fields)', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    const editButton = screen.getByLabelText('Edit CE Credits record');
    const editListItem = editButton.closest('li') as HTMLElement;
    fireEvent.click(editButton);
    const creditsInput = within(editListItem).getByPlaceholderText('Credits completed') as HTMLInputElement;
    expect(creditsInput.value).toBe('6');
    fireEvent.change(creditsInput, { target: { value: '18' } });

    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { record: { id: 'pc_2' } }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'producer-compliance-update', expect.objectContaining({
      id: 'pc_2', creditsCompleted: 18,
    }));
    // Category/agentId are never editable — a partial update never re-sends them.
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'producer-compliance-update');
    expect(call?.[2]).not.toHaveProperty('category');
    expect(call?.[2]).not.toHaveProperty('agentId');
  });

  it('delete flow: removing a record calls producer-compliance-remove and refreshes', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: { deleted: 'pc_3' }, error: null } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Remove Carrier Appointment record'));
    });
    expect(lensRunMock).toHaveBeenCalledWith('insurance', 'producer-compliance-remove', { id: 'pc_3' });
  });

  it('status badges render overdue/due_soon/scheduled with distinct labels', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Due soon')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('a since-removed agent (agentFound:false) is shown honestly, not a stale name', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(screen.getByText('Unknown producer (removed)')).toBeInTheDocument();
  });

  it('the ce_credits progress bar reflects creditsPercent', async () => {
    mockDefaultResponses();
    await act(async () => {
      render(<ProducerCompliance />);
    });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '25');
  });

  it('empty state renders a named message when there are no tracked items', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'insurance' && action === 'agent-list') {
        return Promise.resolve({ data: { ok: true, result: { agents: AGENTS }, error: null } });
      }
      if (domain === 'insurance' && action === 'producer-compliance-list') {
        return Promise.resolve({ data: { ok: true, result: { records: [], overdueCount: 0, dueSoonCount: 0, byCategory: {} }, error: null } });
      }
      return Promise.resolve({ data: { ok: true, result: null, error: null } });
    });
    await act(async () => {
      render(<ProducerCompliance />);
    });
    expect(screen.getByText('No compliance items tracked yet.')).toBeInTheDocument();
  });
});
