import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { DepartmentsPanel } from '@/components/government/DepartmentsPanel';

const DEPTS = [
  { id: 'd1', name: 'Public Works', shortCode: 'DPW', email: 'dpw@x.com', phone: '555-1', head: 'Jane', categories: [] },
  { id: 'd2', name: 'Parks', shortCode: '', email: '', phone: '', head: '', categories: [] },
];

describe('DepartmentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { departments: [] } } });
  });

  it('shows empty state', async () => {
    render(<DepartmentsPanel />);
    expect(await screen.findByText('No departments yet.')).toBeInTheDocument();
  });

  it('renders departments with contact details and shortcode fallback', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { departments: DEPTS } } });
    render(<DepartmentsPanel />);
    expect(await screen.findByText('Public Works')).toBeInTheDocument();
    expect(screen.getByText('DPW')).toBeInTheDocument();
    expect(screen.getByText('dpw@x.com')).toBeInTheDocument();
    expect(screen.getByText('Head: Jane')).toBeInTheDocument();
    // Parks has no shortCode -> first 3 letters uppercased
    expect(screen.getByText('PAR')).toBeInTheDocument();
  });

  it('does not add when name is empty', async () => {
    render(<DepartmentsPanel />);
    await screen.findByText('No departments yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'departments-add' }));
  });

  it('adds a department, uppercasing the short code', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'departments-add'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { departments: [] } } }),
    );
    render(<DepartmentsPanel />);
    await screen.findByText('No departments yet.');
    fireEvent.change(screen.getByPlaceholderText('Department name'), { target: { value: 'Fire' } });
    fireEvent.change(screen.getByPlaceholderText('DPW'), { target: { value: 'fd' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'departments-add', input: expect.objectContaining({ name: 'Fire', shortCode: 'FD' }) }),
      ),
    );
  });

  it('deletes a department', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { departments: DEPTS } } });
    render(<DepartmentsPanel />);
    await screen.findByText('Public Works');
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    const trash = document.querySelectorAll('li button');
    fireEvent.click(trash[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'departments-delete' })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<DepartmentsPanel />);
    expect(await screen.findByText('No departments yet.')).toBeInTheDocument();
  });
});
