/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AnalyzeLibrarySection } from './ResearchLibraryPanel';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const REF = {
  id: 'ref-1', title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017,
  type: 'article', journal: 'NeurIPS', doi: '10.48550/arXiv.1706.03762', tags: ['ml'], status: 'read',
};

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}
function fail(error: string) {
  return { data: { ok: false, result: null, error } };
}

async function openSection() {
  fireEvent.click(screen.getByRole('button', { name: /analyze library/i }));
}

describe('AnalyzeLibrarySection (research.find-gaps / match-questions / evaluate-source)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('find-gaps calls research.find-gaps and renders the returned gaps', async () => {
    lensRunMock.mockResolvedValue(ok({
      referenceCount: 5, topic: null,
      gaps: [
        { kind: 'missing_abstract', count: 2, referenceIds: ['a', 'b'] },
        { kind: 'year_gap', year: 2019 },
        { kind: 'singleton_tags', tags: ['obscure'] },
      ],
      byYear: { 2017: 3, 2020: 2 },
    }));
    render(<AnalyzeLibrarySection references={[REF]} onOpenReference={vi.fn()} />);
    await openSection();
    fireEvent.click(screen.getByRole('button', { name: 'Find gaps' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('research', 'find-gaps', {}));
    await waitFor(() => expect(screen.getByText(/2 references missing an abstract/)).toBeInTheDocument());
    expect(screen.getByText(/No references from 2019/)).toBeInTheDocument();
    expect(screen.getByText(/Tags used only once: obscure/)).toBeInTheDocument();
  });

  it('find-gaps surfaces the backend error instead of a fake result (empty library)', async () => {
    lensRunMock.mockResolvedValue(fail('references required'));
    render(<AnalyzeLibrarySection references={[]} onOpenReference={vi.fn()} />);
    await openSection();
    fireEvent.click(screen.getByRole('button', { name: 'Find gaps' }));
    await waitFor(() => expect(screen.getByText('references required')).toBeInTheDocument());
  });

  it('match-questions calls research.match-questions and a match click opens the reference', async () => {
    const onOpen = vi.fn();
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'match-questions') {
        return Promise.resolve(ok({
          question: 'how do transformers scale', matchCount: 1,
          matches: [{ referenceId: 'ref-1', title: 'Attention Is All You Need', score: 2, matchedTokens: ['transformers', 'scale'] }],
        }));
      }
      if (action === 'reference-detail') return Promise.resolve(ok({ reference: REF }));
      return Promise.resolve(ok(null));
    });
    render(<AnalyzeLibrarySection references={[REF]} onOpenReference={onOpen} />);
    await openSection();
    fireEvent.change(screen.getByPlaceholderText(/what are you trying to answer/i), { target: { value: 'how do transformers scale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Match' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('research', 'match-questions', { question: 'how do transformers scale' }));
    const matchBtn = await screen.findByRole('button', { name: /Attention Is All You Need/ });
    fireEvent.click(matchBtn);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(REF));
  });

  it('evaluate-source calls research.evaluate-source for the chosen reference and renders credibility + signals', async () => {
    lensRunMock.mockResolvedValue(ok({
      referenceId: 'ref-1', title: 'Attention Is All You Need', credibility: 'high',
      signals: ['has_doi', 'has_venue', 'has_year', 'has_authors'], status: 'read',
    }));
    render(<AnalyzeLibrarySection references={[REF]} onOpenReference={vi.fn()} />);
    await openSection();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ref-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('research', 'evaluate-source', { id: 'ref-1' }));
    await waitFor(() => expect(screen.getByText(/high credibility/i)).toBeInTheDocument());
    expect(screen.getByText('DOI')).toBeInTheDocument();
    expect(screen.getByText('Venue')).toBeInTheDocument();
  });
});
