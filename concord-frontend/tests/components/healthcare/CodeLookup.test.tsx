import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { CodeLookup } from '@/components/healthcare/CodeLookup';

describe('CodeLookup', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders empty state initially', () => {
    render(<CodeLookup />);
    expect(screen.getByText(/Run a search to see ICD-10 matches/i)).toBeInTheDocument();
  });

  it('does not search when query is shorter than 2 chars', () => {
    render(<CodeLookup />);
    const input = screen.getByPlaceholderText(/Search by code or description/i);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.submit(input.closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders matches with source when search returns results', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { matches: [
        { code: 'E11.9', description: 'Type 2 diabetes mellitus' },
        { code: 'I10', description: 'Essential hypertension' },
      ], source: 'NLM Clinical Tables' } },
    });
    render(<CodeLookup />);
    fireEvent.change(screen.getByPlaceholderText(/Search by code or description/i), { target: { value: 'diabetes' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(screen.getByText('E11.9')).toBeInTheDocument());
    expect(screen.getByText('Type 2 diabetes mellitus')).toBeInTheDocument();
    expect(screen.getByText(/Source: NLM Clinical Tables/)).toBeInTheDocument();
  });

  it('copies a code to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    lensRun.mockResolvedValue({
      data: { ok: true, result: { matches: [{ code: 'I10', description: 'HTN' }], source: '' } },
    });
    render(<CodeLookup />);
    fireEvent.change(screen.getByPlaceholderText(/Search by code or description/i), { target: { value: 'htn' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(screen.getByText('I10')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Copy code'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('I10'));
  });

  it('alerts when the macro returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockResolvedValue({ data: { ok: false, error: 'lookup failed' } });
    render(<CodeLookup />);
    fireEvent.change(screen.getByPlaceholderText(/Search by code or description/i), { target: { value: 'xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('lookup failed'));
    alertSpy.mockRestore();
  });

  it('handles a thrown error from the macro gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('network'));
    render(<CodeLookup />);
    fireEvent.change(screen.getByPlaceholderText(/Search by code or description/i), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });
});
