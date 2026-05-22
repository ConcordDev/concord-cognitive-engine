import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn(async () => ({ data: { ok: true, result: {} } }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a), api: {} }));

import {
  ScienceWorkbench,
  useDatasets,
  RunButton,
} from '@/components/science/ScienceWorkbench';
import { renderHook, act } from '@testing-library/react';

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { datasets: [] } } });
});

describe('ScienceWorkbench', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<ScienceWorkbench open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel and default datagrid tab when open', () => {
    render(<ScienceWorkbench open onClose={vi.fn()} />);
    expect(screen.getByText('Science Workbench')).toBeInTheDocument();
    expect(screen.getByText('Data Grid')).toBeInTheDocument();
  });

  it('fires onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<ScienceWorkbench open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('switches between every tab', async () => {
    render(<ScienceWorkbench open onClose={vi.fn()} />);
    for (const label of ['Charts', 'Statistics', 'Notebook', 'Protocol Runs', 'Reagents', 'Publication', 'Data Grid']) {
      fireEvent.click(screen.getByText(label));
      await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    }
  });
});

describe('RunButton', () => {
  it('renders children and fires onClick', () => {
    const onClick = vi.fn();
    render(<RunButton onClick={onClick}>Go</RunButton>);
    const btn = screen.getByRole('button', { name: /go/i });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it('is disabled and shows spinner when busy', () => {
    render(<RunButton onClick={vi.fn()} busy>Wait</RunButton>);
    expect(screen.getByRole('button', { name: /wait/i })).toBeDisabled();
  });

  it('applies extra className', () => {
    render(<RunButton onClick={vi.fn()} className="extra-cls">X</RunButton>);
    expect(screen.getByRole('button').className).toContain('extra-cls');
  });
});

describe('useDatasets', () => {
  it('loads datasets on refresh (success path)', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { datasets: [{ id: 'd1', name: 'A', columns: ['x'], rowCount: 1, createdAt: 't' }] } },
    });
    const { result } = renderHook(() => useDatasets());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.datasets).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('handles missing datasets array', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    const { result } = renderHook(() => useDatasets());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.datasets).toEqual([]);
  });

  it('sets error on failed response', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'boom' } });
    const { result } = renderHook(() => useDatasets());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe('boom');
  });

  it('sets default error string when none provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    const { result } = renderHook(() => useDatasets());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe('Failed to load datasets');
  });
});
