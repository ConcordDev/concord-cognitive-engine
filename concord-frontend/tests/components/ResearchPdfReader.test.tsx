/**
 * ResearchPdfReader — the annotate form lays out in two columns on a
 * phone (quote/note full width, Add full width) and four from `sm` up,
 * and the reader's resolve / navigate / annotate flows stay honest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { ResearchPdfReader } from '@/components/research/ResearchPdfReader';

const PDF = '/api/artifact/abc/paper.pdf';

function mockRun(overrides: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, name: string) => {
    if (name in overrides) return overrides[name];
    if (name === 'annotation-list') return { data: { ok: true, result: { annotations: [] } } };
    return { data: { ok: true, result: {} } };
  });
}

describe('ResearchPdfReader', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('stacks the annotate form two-up on mobile and four-up from sm', () => {
    mockRun();
    render(<ResearchPdfReader referenceId="r1" title="Paper" initialPdfUrl={PDF} onClose={() => {}} />);
    const quote = screen.getByPlaceholderText('Quote — the passage, pasted');
    const note = screen.getByPlaceholderText('Your note');
    const add = screen.getByRole('button', { name: 'Add' });
    expect(quote.parentElement?.className).toContain('grid-cols-2');
    expect(quote.parentElement?.className).toContain('sm:grid-cols-4');
    expect(quote.className).toContain('col-span-2');
    expect(quote.className).toContain('sm:col-span-4');
    expect(note.className).toContain('col-span-2');
    expect(note.className).toContain('sm:col-span-3');
    expect(add.className).toContain('col-span-2');
    expect(add.className).toContain('sm:col-span-1');
  });

  it('renders the viewer at the initial page and pages with the arrows', () => {
    mockRun();
    render(<ResearchPdfReader referenceId="r1" title="Paper" initialPage={3} initialPdfUrl={PDF} onClose={() => {}} />);
    expect(screen.getByTitle('PDF — Paper').getAttribute('src')).toBe(`${PDF}#page=3`);
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByTitle('PDF — Paper').getAttribute('src')).toBe(`${PDF}#page=4`);
    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(screen.getByTitle('PDF — Paper').getAttribute('src')).toBe(`${PDF}#page=3`);
  });

  it('refuses an empty annotation, then saves one anchored to the page', async () => {
    mockRun();
    const onChanged = vi.fn();
    render(<ResearchPdfReader referenceId="r1" title="Paper" initialPage={2} initialPdfUrl={PDF} onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Add a quote or a note first.')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Quote — the passage, pasted'), { target: { value: ' a passage ' } });
    fireEvent.change(screen.getByPlaceholderText('Your note'), { target: { value: 'why' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('Annotation saved on page 2.')).toBeTruthy());
    expect(lensRun).toHaveBeenCalledWith('research', 'annotation-add', {
      referenceId: 'r1', page: 2, quote: 'a passage', text: 'why', anchor: { page: 2 },
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a save failure honestly', async () => {
    mockRun({ 'annotation-add': { data: { ok: false, error: 'nope' } } });
    render(<ResearchPdfReader referenceId="r1" title="Paper" initialPdfUrl={PDF} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Your note'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('nope')).toBeTruthy());
  });

  it('lists annotations and jumps to their page', async () => {
    mockRun({
      'annotation-list': { data: { ok: true, result: { annotations: [
        { id: 'a1', page: null, quote: 'quoted', text: 'noted', color: 'y', anchor: { page: 5, startOffset: null, endOffset: null } },
      ] } } },
    });
    render(<ResearchPdfReader referenceId="r1" title="Paper" initialPdfUrl={PDF} onClose={() => {}} />);
    const item = await screen.findByText(/quoted/);
    fireEvent.click(item);
    expect(screen.getByTitle('PDF — Paper').getAttribute('src')).toBe(`${PDF}#page=5`);
  });

  it('resolves a PDF when none is given and reports the source', async () => {
    mockRun({ 'reference-pdf': { data: { ok: true, result: { pdfUrl: 'https://arxiv.org/pdf/1.pdf', source: 'arxiv', pages: 9 } } } });
    render(<ResearchPdfReader referenceId="r1" title="Paper" onClose={() => {}} />);
    expect(await screen.findByText('arXiv PDF')).toBeTruthy();
    expect(screen.getByText('of 9')).toBeTruthy();
  });

  it('says so when no PDF exists and uploads one on request', async () => {
    const onUpload = vi.fn().mockResolvedValue(true);
    mockRun({ 'reference-pdf': { data: { ok: true, result: { pdfUrl: null, source: null, message: 'No PDF here' } } } });
    const { container } = render(<ResearchPdfReader referenceId="r1" title="Paper" onClose={() => {}} onUpload={onUpload} />);
    expect(await screen.findByText('No PDF here')).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'p.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
  });

  it('surfaces a resolve error and closes', async () => {
    const onClose = vi.fn();
    mockRun({ 'reference-pdf': { data: { ok: false, error: 'resolver down' } } });
    render(<ResearchPdfReader referenceId="r1" title="Paper" onClose={onClose} />);
    expect(await screen.findByText('resolver down')).toBeTruthy();
    fireEvent.click(screen.getByText('Back to the reference'));
    expect(onClose).toHaveBeenCalled();
  });
});
