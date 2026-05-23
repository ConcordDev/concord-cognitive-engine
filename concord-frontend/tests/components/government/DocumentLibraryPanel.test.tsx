import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { DocumentLibraryPanel } from '@/components/government/DocumentLibraryPanel';

const DOCS = [
  {
    id: 'doc1', title: 'Building Permit Form', category: 'permit_form', bodyText: 'Fill this out.',
    fileUrl: 'https://x/pdf', requiresSignature: true, publishedAt: '2026-01-01',
    signatures: [{ id: 's1', signerName: 'Jane', signerEmail: 'j@x.com', signedAt: '2026-01-02', fingerprint: 'AB12' }],
  },
  {
    id: 'doc2', title: 'Policy Notice', category: 'policy', bodyText: 'Policy text.', fileUrl: '',
    requiresSignature: false, publishedAt: '2026-01-03', signatures: [],
  },
];

describe('DocumentLibraryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { documents: [] } } });
  });

  it('shows empty state', async () => {
    render(<DocumentLibraryPanel />);
    expect(await screen.findByText('No documents published yet.')).toBeInTheDocument();
  });

  it('renders documents with signable badge and signature count', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { documents: DOCS } } });
    render(<DocumentLibraryPanel />);
    expect(await screen.findByText('Building Permit Form')).toBeInTheDocument();
    expect(screen.getByText('Policy Notice')).toBeInTheDocument();
    expect(screen.getByText('signable')).toBeInTheDocument();
  });

  it('rejects publish with missing fields', async () => {
    render(<DocumentLibraryPanel />);
    await screen.findByText('No documents published yet.');
    fireEvent.click(screen.getByText('Publish document'));
    expect(await screen.findByText('Title and body text required.')).toBeInTheDocument();
  });

  it('publishes a document when title and body provided', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'documents-publish'
        ? Promise.resolve({ data: { ok: true } })
        : Promise.resolve({ data: { ok: true, result: { documents: [] } } }),
    );
    render(<DocumentLibraryPanel />);
    await screen.findByText('No documents published yet.');
    fireEvent.change(screen.getByPlaceholderText('Document title'), { target: { value: 'New Doc' } });
    fireEvent.change(screen.getByPlaceholderText('Document body / form text'), { target: { value: 'Body content' } });
    fireEvent.click(screen.getByText('Publish document'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'documents-publish', input: expect.objectContaining({ title: 'New Doc' }) }),
      ),
    );
  });

  it('surfaces a publish error on ok:false', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'documents-publish'
        ? Promise.resolve({ data: { ok: false, error: 'duplicate title' } })
        : Promise.resolve({ data: { ok: true, result: { documents: [] } } }),
    );
    render(<DocumentLibraryPanel />);
    await screen.findByText('No documents published yet.');
    fireEvent.change(screen.getByPlaceholderText('Document title'), { target: { value: 'Dup' } });
    fireEvent.change(screen.getByPlaceholderText('Document body / form text'), { target: { value: 'b' } });
    fireEvent.click(screen.getByText('Publish document'));
    expect(await screen.findByText('duplicate title')).toBeInTheDocument();
  });

  it('expands a document and e-signs it', async () => {
    lensRun.mockImplementation((spec: { action: string }) =>
      spec.action === 'documents-list'
        ? Promise.resolve({ data: { ok: true, result: { documents: DOCS } } })
        : Promise.resolve({ data: { ok: true } }),
    );
    render(<DocumentLibraryPanel />);
    fireEvent.click(await screen.findByText('Building Permit Form'));
    expect(await screen.findByText('Fill this out.')).toBeInTheDocument();
    // sign with missing fields -> error
    fireEvent.click(screen.getByText('Sign document'));
    expect(await screen.findByText('All signature fields required.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Full legal name'), { target: { value: 'Bob' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'b@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Type your full name to sign'), { target: { value: 'Bob' } });
    fireEvent.click(screen.getByText('Sign document'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'documents-sign' })),
    );
  });

  it('deletes a document', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { documents: DOCS } } });
    render(<DocumentLibraryPanel />);
    await screen.findByText('Building Permit Form');
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    const trash = document.querySelectorAll('li button.text-rose-400');
    fireEvent.click(trash[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'documents-delete' })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<DocumentLibraryPanel />);
    expect(await screen.findByText('No documents published yet.')).toBeInTheDocument();
  });
});
