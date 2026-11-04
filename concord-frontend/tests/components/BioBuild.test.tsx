/**
 * Bio full-lens build (GB-1021) — frontend behaviour tests.
 *
 * Pins: the literature panels read the lensRun payload at data.result
 * (F2 — every successful search previously rendered as an empty result);
 * the MSA control is runnable on arrival (F8); the CRISPR designer gates
 * on its own 30 bp minimum before the click (F12); notebook delete is a
 * two-step confirm with a receipt (F17); the bench mint renders the FULL
 * DTU id (F13).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const lensRun = vi.fn();
const apiPost = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: (...args: unknown[]) => apiPost(...args), delete: vi.fn(async () => ({ data: { ok: true } })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: { ok: true, result: null } } })) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { PubMedPanel } from '@/components/research/PubMedPanel';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { MolecularWorkbench } from '@/components/bio/MolecularWorkbench';
import { BioActionPanel } from '@/components/bio/BioActionPanel';

const envelope = (result: unknown) => ({ data: { ok: true, result, error: null } });

beforeEach(() => {
  lensRun.mockReset();
  apiPost.mockReset();
});

describe('F2 — literature panels read the payload, not the envelope', () => {
  it('PubMed renders the articles a successful search returns', async () => {
    lensRun.mockResolvedValue(envelope({
      ok: true, total: 42137, fetchedAt: 1762212000,
      articles: [{ pmid: '12345', title: 'CRISPR screens in human cells', journal: 'Nature', pubdate: '2026', authors: ['Doe J'], doi: null, pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/12345/' }],
    }));
    render(<PubMedPanel domain="bio" title="PubMed · biology" initialQuery="CRISPR" />);
    await waitFor(() => expect(screen.getByText('CRISPR screens in human cells')).toBeInTheDocument());
    expect(screen.queryByText(/No PubMed articles for that query/)).toBeNull();
  });

  it('arXiv renders the papers a successful fetch returns', async () => {
    lensRun.mockResolvedValue(envelope({
      ok: true, category: 'q-bio', fetchedAt: 1762212000, total: 1,
      papers: [{ arxivId: '2511.00001v1', title: 'Protein folding with diffusion models', summary: '…', published: '2026-11-01', updated: '2026-11-01', authors: ['Roe K'], abstractUrl: 'http://arxiv.org/abs/2511.00001v1', pdfUrl: 'https://arxiv.org/pdf/2511.00001v1.pdf' }],
    }));
    render(<ArxivPanel domain="bio" title="arXiv · Quantitative Biology" />);
    await waitFor(() => expect(screen.getByText('Protein folding with diffusion models')).toBeInTheDocument());
  });
});

describe('MolecularWorkbench tabs', () => {
  beforeEach(() => {
    lensRun.mockImplementation(async (_d: string, name: string) => {
      if (name === 'notebook-list') return envelope({ entries: [{ id: 'nb1', title: 'Throwaway entry', body: 'x', tags: [], linkedSequenceIds: [], linkedProtocol: null, status: 'draft', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z' }] });
      if (name === 'sequence-list') return envelope({ sequences: [] });
      if (name === 'notebook-delete') return envelope({ deleted: 'nb1' });
      if (name === 'align-multiple') return envelope({ rows: [], consensus: '', conservation: [], width: 0, sequenceCount: 3, centerSequence: 'seq1', conservedColumns: 0, percentConserved: 0 });
      return envelope({});
    });
  });

  it('F8: MSA Align is enabled on arrival — the example is a real prefilled value', async () => {
    render(<MolecularWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /MSA/ }));
    const alignBtn = await screen.findByRole('button', { name: /Align \(center-star progressive\)/ });
    expect(alignBtn).not.toBeDisabled();
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(box.value).toContain('>seq1');
    expect(box.value).toContain('ATGCATGC');
  });

  it('F12: CRISPR gates on the 30 bp minimum with the shortfall shown', async () => {
    render(<MolecularWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /CRISPR/ }));
    const designBtn = await screen.findByRole('button', { name: /Design guides/ });
    expect(designBtn).toBeDisabled();
    const box = document.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'ACGTACGTACGTACGTACGTACG' } }); // 23 bp
    expect(designBtn).toBeDisabled();
    expect(screen.getByText(/add 7 more bp/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'ACGTACGTACGTACGTACGTACGTACGTAC' } }); // 30 bp
    expect(designBtn).not.toBeDisabled();
  });

  it('F17: notebook delete asks first, then receipts', async () => {
    render(<MolecularWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Lab notebook/ }));
    await waitFor(() => expect(screen.getByText('Throwaway entry')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByLabelText('Delete')); });
    expect(screen.getByText('Throwaway entry')).toBeInTheDocument();
    expect(lensRun.mock.calls.some((c) => c[1] === 'notebook-delete')).toBe(false);
    await act(async () => { fireEvent.click(screen.getByText('Confirm delete')); });
    await waitFor(() => expect(screen.getByText(/Deleted notebook entry/)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[1] === 'notebook-delete')).toBe(true);
  });
});

describe('F13 — bench mint renders the full DTU id', () => {
  it('the receipt and the minted line carry the complete id', async () => {
    apiPost.mockResolvedValue({ data: { result: { dtu: { id: 'dtu_6f2f9a1b3c4d5e6f' } } } });
    render(<BioActionPanel />);
    const mintBtn = screen.getByRole('button', { name: /Mint/ });
    await act(async () => { fireEvent.click(mintBtn); });
    await waitFor(() => expect(screen.getByText(/Minted private DTU:/)).toBeInTheDocument());
    expect(screen.getAllByText(/dtu_6f2f9a1b3c4d5e6f/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/dtu_6f2f…/)).toBeNull();
  });
});
