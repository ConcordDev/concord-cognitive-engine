import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { RoutingRulesPanel } from '@/components/government/RoutingRulesPanel';

const RULES = [
  { id: 'r1', category: 'pothole', departmentId: 'd1', departmentName: 'DPW' },
  { id: 'r2', category: 'graffiti', departmentId: 'd2', departmentName: 'Parks' },
];
const DEPTS = [{ id: 'd1', name: 'DPW' }, { id: 'd2', name: 'Parks' }];

function mockBoth(rules: unknown[], depts: unknown[]) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'routing-rules-list') return Promise.resolve({ data: { ok: true, result: { rules } } });
    if (spec.action === 'departments-list') return Promise.resolve({ data: { ok: true, result: { departments: depts } } });
    return Promise.resolve({ data: { ok: true } });
  });
}

describe('RoutingRulesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBoth([], []);
  });

  it('shows empty state', async () => {
    render(<RoutingRulesPanel />);
    expect(await screen.findByText(/No routing rules yet/)).toBeInTheDocument();
  });

  it('renders rules with category and department', async () => {
    mockBoth(RULES, DEPTS);
    render(<RoutingRulesPanel />);
    // department name appears in both the rule row and the <option>
    expect((await screen.findAllByText('DPW')).length).toBeGreaterThan(1);
    expect(screen.getAllByText('Parks').length).toBeGreaterThan(1);
    expect(screen.getAllByText('graffiti').length).toBeGreaterThan(0);
  });

  it('disables Set rule until a department is chosen, then sets', async () => {
    mockBoth([], DEPTS);
    render(<RoutingRulesPanel />);
    await screen.findByText(/No routing rules yet/);
    const btn = screen.getByText('Set rule');
    expect(btn).toBeDisabled();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'd1' } });
    expect(btn).not.toBeDisabled();
    lensRun.mockClear();
    mockBoth([], DEPTS);
    fireEvent.click(btn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'routing-rules-set', input: { category: 'pothole', departmentId: 'd1' } }),
      ),
    );
  });

  it('deletes a rule', async () => {
    mockBoth(RULES, DEPTS);
    render(<RoutingRulesPanel />);
    await waitFor(() => expect(screen.getAllByText('graffiti').length).toBeGreaterThan(0));
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    const trash = document.querySelectorAll('li button');
    fireEvent.click(trash[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'routing-rules-delete' })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<RoutingRulesPanel />);
    expect(await screen.findByText(/No routing rules yet/)).toBeInTheDocument();
  });
});
