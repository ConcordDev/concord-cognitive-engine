/**
 * Saved item actions — Save as DTU, then Draft in Thread.
 * The DTU payload is the item the card already loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SavedItem } from '@/components/saved/types';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SavedItemCard } from '@/components/saved/SavedItemCard';
import { recordDtuCall, recordThreadDraftCall, savedItemKeepRecord } from '@/components/lens/recordKeep';

const item: SavedItem = {
  id: 'svd_1',
  kind: 'article',
  refId: null,
  title: 'Concord paper',
  url: 'https://example.com/concord',
  author: 'Ada',
  excerpt: 'the actual excerpt',
  mediaType: 'text',
  folderId: null,
  tags: ['research'],
  note: 'why I kept it',
  state: 'unread',
  sourceLens: 'paper',
  clipStartMs: null,
  clipEndMs: null,
  provenance: null,
  savedAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  readAt: null,
};

const save = () => screen.getByRole('button', { name: 'Save as DTU' });
const draft = () => screen.getByRole('button', { name: 'Draft in Thread' });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, input?: { content?: string; citedDtuId?: string }) => {
    if (domain === 'dtu' && action === 'create') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_saved_1' } }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_saved_1' } }, error: null } };
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return {
        data: {
          ok: true,
          result: {
            draft: {
              id: 'th_saved_1',
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

describe('saved item keep', () => {
  it('saves the loaded item as a private DTU, then drafts that DTU in Thread', async () => {
    render(
      <SavedItemCard item={item} folders={[]} onRemove={() => {}} onUpdate={() => {}} />,
    );
    expect(save()).toBeTruthy();
    expect(draft()).toBeDisabled();

    const record = savedItemKeepRecord(item);
    expect(record?.body).toContain('Concord paper');
    expect(record?.body).toContain('the actual excerpt');
    expect(record?.body).toContain('why I kept it');
    expect(record?.body).not.toMatch(/lorem|placeholder|Untitled/i);

    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_saved_1\./)).toBeTruthy());

    const created = lensRunMock.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(created?.[2]).toEqual(recordDtuCall(record)?.input);
    expect((created?.[2] as { visibility?: string }).visibility).toBe('private');
    expect(String((created?.[2] as { content?: string }).content)).toContain('the actual excerpt');

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_saved_1, citing dtu_saved_1\. Not posted\./)).toBeTruthy());

    const drafted = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(drafted?.[2]).toEqual(recordThreadDraftCall(record, 'dtu_saved_1')?.input);
    expect((drafted?.[2] as { citedDtuId?: string }).citedDtuId).toBe('dtu_saved_1');
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('DTU dtu_saved_1');
  });
});
