import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AcPayrollPanel } from '@/components/accounting/AcPayrollPanel';

const EMPLOYEES = [
  { id: 'e1', name: 'Ada', payType: 'salary', rate: 120000, title: 'Engineer', active: true },
  { id: 'e2', name: 'Bob', payType: 'hourly', rate: 35, title: null, active: true },
];
const RUNS = [
  { id: 'r1', periodStart: '2026-05-01', periodEnd: '2026-05-15', payDate: '2026-05-16', employeeCount: 2, totalGross: 8000, totalNet: 6000 },
];
const DETAIL = {
  stubs: [
    { employeeName: 'Ada', hours: null, gross: 5000, withholding: 1000, net: 4000 },
    { employeeName: 'Bob', hours: 80, gross: 2800, withholding: 800, net: 2000 },
  ],
};

function wire(opts: { employees?: unknown; runs?: unknown; detail?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'employee-list') return Promise.resolve({ data: { ok: true, result: { employees: opts.employees ?? EMPLOYEES } } });
    if (spec.action === 'payrun-list') return Promise.resolve({ data: { ok: true, result: { runs: opts.runs ?? RUNS } } });
    if (spec.action === 'payrun-detail') return Promise.resolve({ data: { ok: true, result: { run: opts.detail ?? DETAIL } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('AcPayrollPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AcPayrollPanel />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders employees and pay-run history', async () => {
    wire();
    render(<AcPayrollPanel />);
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // salary vs hourly rate formats
    expect(screen.getByText('$120,000/yr')).toBeInTheDocument();
    expect(screen.getByText('$35/hr')).toBeInTheDocument();
    expect(screen.getByText('2026-05-01 → 2026-05-15')).toBeInTheDocument();
  });

  it('renders the no-pay-runs empty state', async () => {
    wire({ runs: [] });
    render(<AcPayrollPanel />);
    expect(await screen.findByText('No pay runs yet.')).toBeInTheDocument();
  });

  it('shows the hourly-rate placeholder when payType is hourly', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    // default payType is salary -> Annual placeholder
    expect(screen.getByPlaceholderText('Annual')).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'hourly' } });
    expect(screen.getByPlaceholderText('Rate/hr')).toBeInTheDocument();
  });

  it('does not add an employee with a blank name', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'employee-create' })),
    );
  });

  it('adds an employee with a name entered', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Cara' } });
    fireEvent.change(screen.getByPlaceholderText('Annual'), { target: { value: '90000' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'employee-create', input: expect.objectContaining({ name: 'Cara', rate: 90000 }) }),
      ),
    );
  });

  it('deletes an employee', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'employee-delete' })),
    );
  });

  it('runs payroll for active employees', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payrun-create' }),
      ),
    );
  });

  it('does not run payroll when there are no active employees', async () => {
    wire({ employees: [{ id: 'e9', name: 'Inactive', payType: 'salary', rate: 1, title: null, active: false }] });
    render(<AcPayrollPanel />);
    await screen.findByText('Inactive');
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'payrun-create' })),
    );
  });

  it('opens a pay-run detail and renders stubs', async () => {
    wire();
    render(<AcPayrollPanel />);
    await screen.findByText('Ada');
    fireEvent.click(screen.getByText('2026-05-01 → 2026-05-15'));
    expect(await screen.findByText('Pay stubs')).toBeInTheDocument();
    expect(screen.getByText('gross $5,000')).toBeInTheDocument();
    expect(screen.getByText('net $2,000')).toBeInTheDocument();
  });
});
