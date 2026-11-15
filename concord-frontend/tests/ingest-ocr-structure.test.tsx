/**
 * OCR / PDF tab — the structured output is shown for review
 * (FIX-ingest-008).
 *
 * ingest.ocrIngest returns the full structure (per-page fields, the
 * chunk texts, the document text), but the tab rendered only the
 * count tiles — Pages / Words / Chunks / Avg confidence — so a
 * structured document showed nothing reviewable: no fields, no chunk
 * text, and for a document with no detected headings, nothing else at
 * all. The tab now renders the per-page fields and every chunk's text
 * under the tiles. These pins drive the real tab against a macro
 * result in the server's own shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

let handlers: Record<string, (input: unknown) => unknown> = {};

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (domain: string, action: string, input: unknown) => {
    const h = handlers[`${domain}.${action}`];
    const result = h ? h(input) : {};
    return { data: { ok: true, result } };
  }),
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));

import { PipelinePanel } from '@/components/ingest/PipelinePanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const OCR_RESULT = {
  pageCount: 1, totalWords: 13, totalChars: 71, emptyPages: 0,
  avgConfidence: null, lowConfidencePages: [],
  headings: [],
  perPage: [{ page: 1, wordCount: 13, charCount: 71, lineCount: 2, headingCount: 0, confidence: null, empty: false }],
  chunkCount: 1,
  chunks: ['The quick brown fox jumps over the lazy dog near the river bank today.'],
  documentText: 'The quick brown fox jumps over the lazy dog near the river bank today.',
};

beforeEach(() => {
  handlers = { 'ingest.ocrIngest': () => OCR_RESULT };
});

describe('OCR tab structured review (FIX-ingest-008)', () => {
  it('shows the per-page fields and the chunk text, not only the counts', async () => {
    wrap(<PipelinePanel />);
    fireEvent.click(screen.getByRole('button', { name: /OCR \/ PDF/ }));
    fireEvent.change(screen.getByLabelText('Paste extracted document text'), {
      target: { value: 'Seed text for the structure run.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Structure Document/ }));

    // The tiles still show…
    await waitFor(() => expect(screen.getByText('Chunks')).toBeInTheDocument());
    // …and now the structure itself is reviewable:
    expect(screen.getByRole('heading', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByText('13 words')).toBeInTheDocument();
    expect(screen.getByText('2 lines')).toBeInTheDocument();
    expect(screen.getByText('no confidence reported')).toBeInTheDocument();
    expect(screen.getByText('Chunks for review')).toBeInTheDocument();
    expect(screen.getByText('Chunk 1 · 70 chars')).toBeInTheDocument();
    expect(screen.getByText('The quick brown fox jumps over the lazy dog near the river bank today.')).toBeInTheDocument();
  });
});
