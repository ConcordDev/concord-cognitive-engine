/**
 * News full build — reader export leg (B6, F-B row 9).
 *
 * S3/F5: MyReaderDesk carries an own-records export — the caller's
 * articles + saved + alert subscriptions + digest schedule as a JSON
 * download that files, with the counts receipted in the surface. A
 * failed read says so in words and downloads nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun: lensRunMock }));
vi.mock('@/components/news/ArticleDetailContext', () => ({
  ArticleDetailProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/news/ArticleDetailModal', () => ({ ArticleDetailModal: () => null }));
vi.mock('@/components/news/NewsSearchBar', () => ({ NewsSearchBar: () => null }));
vi.mock('@/components/news/NewsReaderSection', () => ({ NewsReaderSection: () => null }));
vi.mock('@/components/news/NewsParitySuite', () => ({ NewsParitySuite: () => null }));

import { MyReaderDesk } from '@/components/news/MyReaderDesk';

const OK_BY_ACTION: Record<string, unknown> = {
  'article-list': { articles: [{ id: 'a1', title: 'Saved Story One' }, { id: 'a2', title: 'Pulled Story Two' }], count: 2 },
  'saved-list': { articles: [{ id: 'a1', title: 'Saved Story One' }], count: 1 },
  'alert-list': { subscriptions: [{ keyword: 'drought' }], count: 1 },
  'digest-schedule-get': { schedule: { cadence: 'weekdays', hour: 7 }, nextDelivery: '2026-11-09T07:00:00.000Z' },
};

let capturedBlob: Blob | null;
let createObjectURLSpy: ReturnType<typeof vi.fn>;
let anchorClicks: number;

beforeEach(() => {
  capturedBlob = null;
  anchorClicks = 0;
  createObjectURLSpy = vi.fn((blob: Blob) => { capturedBlob = blob; return 'blob:news'; });
  URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { anchorClicks += 1; });
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: OK_BY_ACTION[action] } }));
});

describe('Export my records (S3/F5)', () => {
  it('downloads a JSON holding the reader records and receipts the counts', async () => {
    render(<MyReaderDesk />);
    fireEvent.click(screen.getByRole('button', { name: /Export my records/ }));
    await waitFor(() => expect(screen.getByText(/Exported 2 articles · 1 saved · 1 alert subscriptions/)).toBeInTheDocument());
    expect(anchorClicks).toBe(1);
    expect(capturedBlob).not.toBeNull();
    const text = await capturedBlob!.text();
    expect(text).toContain('concord-news-my-records');
    expect(text).toContain('Saved Story One');
    expect(text).toContain('Pulled Story Two');
    expect(text).toContain('drought');
  });

  it('a failed read states the failure and downloads nothing', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => (action === 'article-list'
      ? { data: { ok: false, error: 'STATE unavailable' } }
      : { data: { ok: true, result: OK_BY_ACTION[action] } }));
    render(<MyReaderDesk />);
    fireEvent.click(screen.getByRole('button', { name: /Export my records/ }));
    await waitFor(() => expect(screen.getByText(/Export failed — STATE unavailable/)).toBeInTheDocument());
    expect(createObjectURLSpy).not.toHaveBeenCalled();
    expect(anchorClicks).toBe(0);
  });
});
