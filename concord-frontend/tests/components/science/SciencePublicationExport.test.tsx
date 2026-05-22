import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SciencePublicationExport } from '@/components/science/SciencePublicationExport';

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: null } });
});

describe('SciencePublicationExport', () => {
  it('renders the form fields', () => {
    render(<SciencePublicationExport />);
    expect(screen.getByText('Publication Export')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Manuscript title')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Abstract')).toBeInTheDocument();
  });

  it('shows error when title is empty', async () => {
    render(<SciencePublicationExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(screen.getByText('Title required')).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('exports a markdown bundle and parses comma lists', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: {
        format: 'markdown', bundle: '# My Paper\n\nbody', figureCount: 0,
        wordCount: 42, exportedAt: 't', filename: 'my-paper.md',
      } },
    });
    render(<SciencePublicationExport />);
    fireEvent.change(screen.getByPlaceholderText('Manuscript title'), { target: { value: 'My Paper' } });
    fireEvent.change(screen.getByPlaceholderText('Authors, comma separated'), { target: { value: 'A, B ,  ' } });
    fireEvent.change(screen.getByPlaceholderText('Keywords, comma separated'), { target: { value: 'k1, k2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(screen.getByText(/42 words/)).toBeInTheDocument());
    expect(screen.getByText('my-paper.md')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('science', 'publication-export', expect.objectContaining({
      title: 'My Paper', authors: ['A', 'B'], keywords: ['k1', 'k2'], format: 'markdown',
    }));
  });

  it('shows error from a failed export', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'export blew up' } });
    render(<SciencePublicationExport />);
    fireEvent.change(screen.getByPlaceholderText('Manuscript title'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(screen.getByText('export blew up')).toBeInTheDocument());
  });

  it('shows default error string when export fails without message', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    render(<SciencePublicationExport />);
    fireEvent.change(screen.getByPlaceholderText('Manuscript title'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(screen.getByText('Export failed')).toBeInTheDocument());
  });

  it('adds, edits and removes figures', async () => {
    render(<SciencePublicationExport />);
    fireEvent.click(screen.getByText(/Add figure/));
    const caption = screen.getByPlaceholderText('Caption');
    fireEvent.change(caption, { target: { value: 'Fig 1' } });
    fireEvent.change(screen.getByPlaceholderText('Chart kind'), { target: { value: 'bar' } });
    fireEvent.change(screen.getByPlaceholderText('Ref'), { target: { value: 'r1' } });
    expect(screen.getByDisplayValue('Fig 1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove figure'));
    expect(screen.queryByPlaceholderText('Caption')).not.toBeInTheDocument();
  });

  it('filters out blank figures before export', async () => {
    render(<SciencePublicationExport />);
    fireEvent.click(screen.getByText(/Add figure/)); // blank figure
    fireEvent.change(screen.getByPlaceholderText('Manuscript title'), { target: { value: 'T' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    const call = lensRun.mock.calls[0][2] as { figures: unknown[] };
    expect(call.figures).toHaveLength(0);
  });

  it('switches format to json and downloads an object bundle', async () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag === 'a') (el as HTMLAnchorElement).click = clickSpy;
      return el;
    });
    const origCreateURL = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    lensRun.mockResolvedValue({
      data: { ok: true, result: {
        format: 'json', bundle: { hello: 'world' }, figureCount: 1,
        wordCount: 10, exportedAt: 't', filename: 'paper.json',
      } },
    });
    render(<SciencePublicationExport />);
    fireEvent.change(screen.getByPlaceholderText('Manuscript title'), { target: { value: 'T' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build Bundle' }));
    await waitFor(() => expect(screen.getByText('paper.json')).toBeInTheDocument());
    fireEvent.click(screen.getByText('paper.json'));
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalled();

    URL.createObjectURL = origCreateURL;
    URL.revokeObjectURL = origRevoke;
    vi.restoreAllMocks();
  });
});
