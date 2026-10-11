/**
 * Paper item actions — open a library paper, Save as DTU, then Draft in Thread.
 * The DTU payload is the paper the library already loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PaperLibrary } from '@/components/paper/PaperLibrary';
import { paperItemKeepRecord, recordDtuCall, recordThreadDraftCall } from '@/components/lens/recordKeep';

const paper = {
  id: 'pp_1',
  title: 'Night methods',
  authors: ['Ada'],
  year: 2024,
  venue: 'Vault',
  abstract: 'the actual abstract',
  doi: '10.1000/night',
  url: null,
  status: 'to_read',
  rating: null,
  tags: ['methods'],
  notes: '',
  collectionIds: [],
};

const save = () => screen.getByRole('button', { name: 'Save as DTU' });
const draft = () => screen.getByRole('button', { name: 'Draft in Thread' });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, input?: { content?: string; citedDtuId?: string }) => {
    if (domain === 'paper' && action === 'paper-list') {
      return { data: { ok: true, result: { papers: [paper] }, error: null } };
    }
    if (domain === 'paper' && action === 'collection-list') {
      return { data: { ok: true, result: { collections: [] }, error: null } };
    }
    if (domain === 'paper' && action === 'library-dashboard') {
      return { data: { ok: true, result: { totalPapers: 1, toRead: 1, reading: 0, read: 0, collections: 0 }, error: null } };
    }
    if (domain === 'paper' && action === 'paper-version-list') {
      return { data: { ok: true, result: { versions: [] }, error: null } };
    }
    if (domain === 'dtu' && action === 'create') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_paper_1' } }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_paper_1' } }, error: null } };
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return {
        data: {
          ok: true,
          result: {
            draft: {
              id: 'th_paper_1',
              status: 'draft',
              citedDtuId: input?.citedDtuId,
              content: input?.content,
            },
          },
          error: null,
        },
      };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
});

describe('paper item keep', () => {
  it('saves the open paper as a private DTU, then drafts that DTU in Thread', async () => {
    render(<PaperLibrary />);
    fireEvent.click(await screen.findByRole('button', { name: /Night methods/ }));
    await waitFor(() => expect(save()).toBeTruthy());
    expect(draft()).toBeDisabled();

    const record = paperItemKeepRecord(paper);
    expect(record?.body).toContain('Night methods');
    expect(record?.body).toContain('the actual abstract');
    expect(record?.body).toContain('10.1000/night');
    expect(record?.body).not.toMatch(/lorem|placeholder|Untitled/i);

    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_paper_1\./)).toBeTruthy());

    const created = lensRunMock.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(created?.[2]).toEqual(recordDtuCall(record)?.input);
    expect((created?.[2] as { visibility?: string }).visibility).toBe('private');
    expect(String((created?.[2] as { content?: string }).content)).toContain('the actual abstract');

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_paper_1, citing dtu_paper_1\. Not posted\./)).toBeTruthy());

    const drafted = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(drafted?.[2]).toEqual(recordThreadDraftCall(record, 'dtu_paper_1')?.input);
    expect((drafted?.[2] as { citedDtuId?: string }).citedDtuId).toBe('dtu_paper_1');
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('DTU dtu_paper_1');
  });

  it('does not offer Save as DTU until a paper is open', async () => {
    render(<PaperLibrary />);
    await screen.findByRole('button', { name: /Night methods/ });
    expect(screen.queryByRole('button', { name: 'Save as DTU' })).toBeNull();
  });
});
