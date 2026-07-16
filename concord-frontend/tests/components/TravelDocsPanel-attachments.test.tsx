/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the Wave 4 gap-closure of docs/WAVE4_INVENTORY.md line 323 /
// travel-capability-map.md item 8 ("No binary attachment support on
// travel documents"). TravelDocsPanel now lets a user attach a scan /
// boarding pass / QR-code photo to a travel document (FileReader ->
// base64 -> travel-doc-attachment-upload), lists what's attached
// per-document, downloads a file back to base64 -> Blob, and deletes an
// attachment. Every assertion checks the ACTUAL macro call the UI made
// and that nothing renders as "attached"/"downloaded" until the backend
// macro call itself resolves ok:true — no fabricated success states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { TravelDocsPanel } from '@/components/travel/TravelDocsPanel';

const PASSPORT_NO_ATTACHMENTS = {
  id: 'doc_1', title: 'Passport', kind: 'passport', number: 'X1', expiryDate: '2030-01-01',
  expiryStatus: 'valid', attachments: [], attachmentCount: 0,
};
const PASSPORT_WITH_ATTACHMENT = {
  ...PASSPORT_NO_ATTACHMENTS,
  attachments: [{ id: 'att_1', fileName: 'passport-scan.pdf', mimeType: 'application/pdf', bytes: 2048, createdAt: '2026-01-01T00:00:00.000Z' }],
  attachmentCount: 1,
};

function mockList(documents: unknown[]) {
  return { data: { ok: true, result: { documents, count: documents.length } } };
}

function makeFile(name: string, content: string, type: string) {
  return new File([content], name, { type });
}

describe('TravelDocsPanel — document attachments', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders an empty attachment state and an "attach file" affordance per document', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'travel-doc-list') return mockList([PASSPORT_NO_ATTACHMENTS]);
      return { data: { ok: true, result: {} } };
    });
    render(<TravelDocsPanel />);
    await screen.findByText('Passport');
    expect(screen.getByText(/Attach file/i)).toBeInTheDocument();
  });

  it('renders attached files with their size, and offers download + delete', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'travel-doc-list') return mockList([PASSPORT_WITH_ATTACHMENT]);
      return { data: { ok: true, result: {} } };
    });
    render(<TravelDocsPanel />);
    await screen.findByText('passport-scan.pdf');
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete attachment')).toBeInTheDocument();
    expect(screen.getByText(/Attach another file/i)).toBeInTheDocument();
  });

  it('selecting a file reads it as base64 and calls travel-doc-attachment-upload with the right payload, then refreshes', async () => {
    let listCallCount = 0;
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'travel-doc-list') {
        listCallCount += 1;
        return mockList(listCallCount === 1 ? [PASSPORT_NO_ATTACHMENTS] : [PASSPORT_WITH_ATTACHMENT]);
      }
      if (action === 'travel-doc-attachment-upload') {
        expect(params.docId).toBe('doc_1');
        expect(params.fileName).toBe('scan.pdf');
        expect(String(params.data)).toMatch(/^data:application\/pdf;base64,/);
        return { data: { ok: true, result: { attachment: { id: 'att_1', docId: 'doc_1', kind: 'binary', fileName: 'scan.pdf', mimeType: 'application/pdf', bytes: 11, createdAt: '' } } } };
      }
      return { data: { ok: true, result: {} } };
    });

    const { container } = render(<TravelDocsPanel />);
    await screen.findByText('Passport');

    // Selecting a file first requires clicking "Attach file" (this arms
    // pendingDocIdRef with the target document's id — the hidden input
    // is otherwise a no-op, by design, so a bare change event can't be
    // mistaken for an upload against the wrong document).
    fireEvent.click(screen.getByText(/Attach file/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('scan.pdf', 'hello world', 'application/pdf');
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'travel-doc-attachment-upload',
        expect.objectContaining({ docId: 'doc_1', fileName: 'scan.pdf', mimeType: 'application/pdf' })),
    );
    // Refreshed the document list after a real ok:true — not before.
    await waitFor(() => expect(screen.getByText('passport-scan.pdf')).toBeInTheDocument());
  });

  it('rejects an oversized file client-side without ever calling the upload macro', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'travel-doc-list') return mockList([PASSPORT_NO_ATTACHMENTS]);
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<TravelDocsPanel />);
    await screen.findByText('Passport');

    fireEvent.click(screen.getByText(/Attach file/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('huge.bin', 'x', 'application/octet-stream');
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/exceeds the 5 MB limit/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some(([, action]) => action === 'travel-doc-attachment-upload')).toBe(false);
  });

  it('surfaces the server\'s honest rejection (e.g. malformed base64) without fabricating a success state', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'travel-doc-list') return mockList([PASSPORT_NO_ATTACHMENTS]);
      if (action === 'travel-doc-attachment-upload') return { data: { ok: false, result: null, error: 'data must be base64' } };
      return { data: { ok: true, result: {} } };
    });
    const { container } = render(<TravelDocsPanel />);
    await screen.findByText('Passport');

    fireEvent.click(screen.getByText(/Attach file/i));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('scan.pdf', 'hello', 'application/pdf');
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    expect(await screen.findByText('data must be base64')).toBeInTheDocument();
    // Still shows the empty state — no attachment was fabricated into the list.
    expect(screen.queryByLabelText('Delete attachment')).not.toBeInTheDocument();
  });

  it('downloading an attachment calls travel-doc-attachment-download and triggers a browser download', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'travel-doc-list') return mockList([PASSPORT_WITH_ATTACHMENT]);
      if (action === 'travel-doc-attachment-download') {
        expect(params.id).toBe('att_1');
        return { data: { ok: true, result: { id: 'att_1', fileName: 'passport-scan.pdf', mimeType: 'application/pdf', bytes: 2048, data: Buffer.from('scan-bytes').toString('base64') } } };
      }
      return { data: { ok: true, result: {} } };
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TravelDocsPanel />);
    await screen.findByText('passport-scan.pdf');

    fireEvent.click(screen.getByText('passport-scan.pdf'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'travel-doc-attachment-download', { id: 'att_1' }),
    );
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    clickSpy.mockRestore();
  });

  it('deleting an attachment calls travel-doc-attachment-delete and refreshes the list', async () => {
    let listCallCount = 0;
    lensRun.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
      if (action === 'travel-doc-list') {
        listCallCount += 1;
        return mockList(listCallCount === 1 ? [PASSPORT_WITH_ATTACHMENT] : [PASSPORT_NO_ATTACHMENTS]);
      }
      if (action === 'travel-doc-attachment-delete') {
        expect(params.id).toBe('att_1');
        return { data: { ok: true, result: { deleted: 'att_1' } } };
      }
      return { data: { ok: true, result: {} } };
    });
    render(<TravelDocsPanel />);
    await screen.findByText('passport-scan.pdf');

    fireEvent.click(screen.getByLabelText('Delete attachment'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('travel', 'travel-doc-attachment-delete', { id: 'att_1' }),
    );
    await waitFor(() => expect(screen.queryByText('passport-scan.pdf')).not.toBeInTheDocument());
  });
});
