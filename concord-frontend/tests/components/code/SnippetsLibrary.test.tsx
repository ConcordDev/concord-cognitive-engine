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

import { SnippetsLibrary, snippetCommandLabel } from '@/components/code/SnippetsLibrary';

const SNIPPETS = [
  { id: 's1', title: 'Fetch helper', language: 'typescript', code: 'fetch("/x")' },
  { id: 's2', title: 'Loop', language: 'python', code: 'for i in range(3): pass' },
];

describe('SnippetsLibrary', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the empty state when no snippets exist', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: [] } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No snippets yet.')).toBeInTheDocument());
  });

  it('renders a populated snippet list and inserts on title click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: SNIPPETS } } });
    const onInsert = vi.fn();
    render(<SnippetsLibrary onInsert={onInsert} />);
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Fetch helper'));
    expect(onInsert).toHaveBeenCalledWith('fetch("/x")');
  });

  it('filters snippets by query and shows "No matches."', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: SNIPPETS } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Filter snippets…'), {
      target: { value: 'loop' },
    });
    expect(screen.getByText('Loop')).toBeInTheDocument();
    expect(screen.queryByText('Fetch helper')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Filter snippets…'), {
      target: { value: 'zzz-no-match' },
    });
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('expands a snippet to reveal its code', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: SNIPPETS } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText('Expand')[0]);
    expect(screen.getByText('fetch("/x")')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Collapse'));
    expect(screen.queryByText('fetch("/x")')).not.toBeInTheDocument();
  });

  it('creates a new snippet through the form', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { snippets: [] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: {} } })
      .mockResolvedValueOnce({ data: { ok: true, result: { snippets: SNIPPETS } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No snippets yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New snippet'));
    fireEvent.change(screen.getByPlaceholderText('Snippet title…'), {
      target: { value: 'New one' },
    });
    fireEvent.change(screen.getByPlaceholderText('// Paste or type code…'), {
      target: { value: 'console.log(1)' },
    });
    fireEvent.click(screen.getByText('Save snippet'));
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
  });

  it('cancels the create form', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: [] } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No snippets yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New snippet'));
    expect(screen.getByPlaceholderText('Snippet title…')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('Snippet title…')).not.toBeInTheDocument();
  });

  it('seeds new code from currentSelection prop', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: [] } } });
    render(<SnippetsLibrary onInsert={vi.fn()} currentSelection="selected code" currentLanguage="rust" />);
    await waitFor(() => expect(screen.getByText('No snippets yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New snippet'));
    expect(screen.getByDisplayValue('selected code')).toBeInTheDocument();
  });

  it('deletes a snippet after confirm', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: SNIPPETS } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
    const delBtn = screen.getAllByTitle('Delete')[0];
    fireEvent.click(delBtn);
    await waitFor(() => expect(screen.queryByText('Fetch helper')).not.toBeInTheDocument());
  });

  it('skips delete when confirm cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValue({ data: { ok: true, result: { snippets: SNIPPETS } } });
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Fetch helper')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(screen.getByText('Fetch helper')).toBeInTheDocument();
  });

  it('handles a rejected snippet load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('load fail')));
    render(<SnippetsLibrary onInsert={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No snippets yet.')).toBeInTheDocument());
  });

  it('snippetCommandLabel builds an insert label', () => {
    expect(snippetCommandLabel(SNIPPETS[0])).toContain('Fetch helper');
    expect(snippetCommandLabel(SNIPPETS[0])).toContain('typescript');
  });
});
