import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceStats } from '@/components/science/ScienceStats';

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { mean: 5, n: 3 } } });
});

describe('ScienceStats', () => {
  it('renders descriptive test by default', () => {
    render(<ScienceStats />);
    expect(screen.getByText('Statistical Tests')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Numeric values/)).toBeInTheDocument();
  });

  it('runs descriptive computation and shows result block', async () => {
    render(<ScienceStats />);
    fireEvent.change(screen.getByPlaceholderText(/Numeric values/), { target: { value: '1, 2, 3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('mean')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('science', 'stats-descriptive', { data: [1, 2, 3] });
  });

  it('shows error when descriptive computation fails', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'bad data' } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('bad data')).toBeInTheDocument());
  });

  it('shows default error string when none provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('Computation failed')).toBeInTheDocument());
  });

  it('switches to CI test and includes confidence param', async () => {
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('Conf. Interval'));
    const conf = screen.getByDisplayValue('0.95');
    fireEvent.change(conf, { target: { value: '0.99' } });
    fireEvent.change(screen.getByPlaceholderText(/Numeric values/), { target: { value: '4 5 6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-ci', { data: [4, 5, 6], confidence: 0.99 }));
  });

  it('runs two-sample t-test by default and switches to one-sample', async () => {
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('t-test'));
    // two-sample: both samples shown
    fireEvent.change(screen.getByPlaceholderText('Sample A'), { target: { value: '1 2' } });
    fireEvent.change(screen.getByPlaceholderText('Sample B'), { target: { value: '3 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run t-test' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-ttest', { kind: 'two-sample', a: [1, 2], b: [3, 4] }));

    // switch to one-sample
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'one-sample' } });
    const mu = screen.getByPlaceholderText('μ');
    fireEvent.change(mu, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run t-test' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-ttest', { kind: 'one-sample', a: [1, 2], mu: 10 }));
  });

  it('shows t-test error', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 't err' } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('t-test'));
    fireEvent.click(screen.getByRole('button', { name: 'Run t-test' }));
    await waitFor(() => expect(screen.getByText('t err')).toBeInTheDocument());
  });

  it('runs correlation paired test', async () => {
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('Correlation'));
    fireEvent.change(screen.getByPlaceholderText('X values'), { target: { value: '1 2 3' } });
    fireEvent.change(screen.getByPlaceholderText('Y values'), { target: { value: '4 5 6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-correlation', { x: [1, 2, 3], y: [4, 5, 6] }));
  });

  it('runs regression paired test and shows error', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('Regression'));
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('Computation failed')).toBeInTheDocument());
  });

  it('runs ANOVA, adds and removes a group', async () => {
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('ANOVA'));
    // add a 3rd group → now removable
    fireEvent.click(screen.getByText('+ Add group'));
    const removeBtns = screen.getAllByLabelText('Remove group');
    expect(removeBtns.length).toBeGreaterThan(0);
    fireEvent.click(removeBtns[0]);
    const groups = screen.getAllByPlaceholderText(/Group/);
    fireEvent.change(groups[0], { target: { value: '1 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run ANOVA' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-anova', expect.objectContaining({ groups: expect.any(Array) })));
  });

  it('shows ANOVA error', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'anova err' } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('ANOVA'));
    fireEvent.click(screen.getByRole('button', { name: 'Run ANOVA' }));
    await waitFor(() => expect(screen.getByText('anova err')).toBeInTheDocument());
  });

  it('runs Mann-Whitney non-parametric test', async () => {
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('Mann–Whitney'));
    fireEvent.change(screen.getByPlaceholderText('Sample A'), { target: { value: '1 2' } });
    fireEvent.change(screen.getByPlaceholderText('Sample B'), { target: { value: '3 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'stats-nonparametric', { test: 'mann-whitney', a: [1, 2], b: [3, 4] }));
  });

  it('non-parametric shows error', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByText('Mann–Whitney'));
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }));
    await waitFor(() => expect(screen.getByText('Computation failed')).toBeInTheDocument());
  });

  it('result block renders arrays and objects', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { arr: [1, 2], obj: { a: 1 }, scalar: 7 } } });
    render(<ScienceStats />);
    fireEvent.click(screen.getByRole('button', { name: 'Compute' }));
    await waitFor(() => expect(screen.getByText('[1, 2]')).toBeInTheDocument());
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
