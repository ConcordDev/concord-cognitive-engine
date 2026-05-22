import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'chartkit', 'data-kind': props.kind }),
}));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceCharts } from '@/components/science/ScienceCharts';

const DATASETS = [
  { id: 'd1', name: 'Trial A', columns: ['x', 'y', 'cat'], rowCount: 3, createdAt: 't' },
];

function mockList(datasets = DATASETS) {
  lensRun.mockImplementation(async (_d: string, action: string) => {
    if (action === 'dataset-list') return { data: { ok: true, result: { datasets } } };
    return { data: { ok: true, result: {} } };
  });
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { datasets: [] } } });
});

describe('ScienceCharts', () => {
  it('shows the no-datasets hint when none exist', async () => {
    render(<ScienceCharts />);
    await waitFor(() => expect(screen.getByText(/No datasets yet/)).toBeInTheDocument());
  });

  it('renders dataset + chart-type selectors once datasets exist', async () => {
    mockList();
    render(<ScienceCharts />);
    await waitFor(() => expect(screen.getByText('Chart Rendering')).toBeInTheDocument());
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('errors when render clicked without a dataset selected', async () => {
    mockList();
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText('Select a dataset')).toBeInTheDocument());
  });

  it('renders a bar chart with x/y columns', async () => {
    mockList();
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'bar', xKey: 'x', n: 3, points: [{ x: 1, y: 2 }],
        series: [{ key: 'y', label: 'Y' }],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    await waitFor(() => screen.getByRole('button', { name: /Render Chart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByTestId('chartkit')).toBeInTheDocument());
    expect(screen.getByText('3 points')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('science', 'chart-render', expect.objectContaining({
      datasetId: 'd1', kind: 'bar', xColumn: 'x', yColumn: 'y',
    }));
  });

  it('renders a histogram result', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'histogram', valueColumn: 'y', n: 10, bins: 4,
        points: [{ bin: 0, binEnd: 5, count: 3 }, { bin: 5, binEnd: 10, count: 7 }],
        xKey: 'bin', series: [{ key: 'count', label: 'Frequency' }],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'histogram' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText(/10 values, 4 bins/)).toBeInTheDocument());
    expect(screen.getByTestId('chartkit')).toBeInTheDocument();
  });

  it('renders a box-plot result with outliers', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'box', valueColumn: 'y', n: 8, min: 1, max: 9, q1: 2,
        median: 5, q3: 7, whiskerLow: 1, whiskerHigh: 9, outliers: [99],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'box' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText(/Box plot/)).toBeInTheDocument());
    expect(screen.getByText(/Outliers: 99/)).toBeInTheDocument();
  });

  it('renders a box plot with no outliers', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'box', valueColumn: 'y', n: 8, min: 1, max: 9, q1: 2,
        median: 5, q3: 7, whiskerLow: 1, whiskerHigh: 9, outliers: [],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'box' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText(/Outliers: none/)).toBeInTheDocument());
  });

  it('renders a pie result with blank-name slice', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'pie', categoryColumn: 'cat', total: 10,
        slices: [{ name: 'A', count: 6 }, { name: '', count: 4 }],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'pie' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText(/10 rows/)).toBeInTheDocument());
    expect(screen.getByText('(blank)')).toBeInTheDocument();
  });

  it('renders a pie with zero total (pct fallback)', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'pie', categoryColumn: 'cat', total: 0,
        slices: [{ name: 'A', count: 0 }],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'pie' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText(/0 rows/)).toBeInTheDocument());
  });

  it('shows error from a failed chart render', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      return { data: { ok: false, error: 'render fail' } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByText('render fail')).toBeInTheDocument());
  });

  it('renders a scatter and line chart kind variants', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') return { data: { ok: true, result: { datasets: DATASETS } } };
      if (action === 'chart-render') return { data: { ok: true, result: {
        kind: 'scatter', xKey: 'x', n: 2, points: [{ x: 1, y: 2 }],
        series: [{ key: 'y', label: 'Y' }],
      } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceCharts />);
    await waitFor(() => screen.getByText('Chart Rendering'));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'd1' } });
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'scatter' } });
    fireEvent.click(screen.getByRole('button', { name: /Render Chart/ }));
    await waitFor(() => expect(screen.getByTestId('chartkit')).toHaveAttribute('data-kind', 'scatter'));
  });
});
