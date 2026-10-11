import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

const paginated = vi.fn();
const create = vi.fn();
const remove = vi.fn();

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ totalCount, itemContent }: { totalCount: number; itemContent: (index: number) => React.ReactNode }) => (
    <div>
      {Array.from({ length: totalCount }, (_, i) => (
        <div key={i}>{itemContent(i)}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: () => null,
}));

vi.mock('@/components/scope/VisibilityScopePicker', () => ({
  VisibilityScopePicker: () => <div>scope</div>,
}));

vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  ContentClassLicenseFields: () => null,
  buildContentLicensePayload: () => ({
    contentClass: 'generic',
    licenseScopes: ['private'],
    scopes: {},
    license: {},
    meta: {},
  }),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: {
      paginated: (...args: unknown[]) => paginated(...args),
      create: (...args: unknown[]) => create(...args),
      delete: (...args: unknown[]) => remove(...args),
      get: vi.fn(),
    },
  },
  lensRun: vi.fn(),
}));

import { BrowserPanel } from '@/components/dtus/BrowserPanel';

const created = {
  id: 'dtu-new',
  title: 'Fresh note',
  summary: 'a fresh body',
  content: 'a fresh body',
  tier: 'regular',
  tags: [],
  createdAt: '2020-01-02T03:04:05.000Z',
  timestamp: '2020-01-02T03:04:05.000Z',
  parents: [],
  children: [],
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <BrowserPanel />
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

describe('BrowserPanel create and delete', () => {
  beforeEach(() => {
    paginated.mockReset();
    create.mockReset();
    remove.mockReset();
    paginated.mockResolvedValue({
      data: { ok: true, items: [], pagination: { total: 0, hasNext: false } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('creates from New DTU, then deletes the row so a reload does not bring it back', async () => {
    renderPanel();
    expect((await screen.findAllByText('0 DTUs')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'New DTU' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create New DTU' });
    fireEvent.change(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'Fresh note' } });
    fireEvent.change(screen.getByPlaceholderText('The thought content...'), { target: { value: 'a fresh body' } });

    create.mockImplementation(async () => {
      paginated.mockResolvedValue({
        data: { ok: true, items: [created], pagination: { total: 1, hasNext: false } },
      });
      return { data: { ok: true, dtu: created } };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create DTU' }));

    expect(await screen.findByText('Fresh note')).toBeTruthy();
    expect(create).toHaveBeenCalled();
    const payload = create.mock.calls[0][0] as { title?: string; content?: string };
    expect(payload.title).toBe('Fresh note');
    expect(payload.content).toBe('a fresh body');
    expect(screen.getAllByText('Showing 1–1 of 1').length).toBeGreaterThan(0);

    remove.mockImplementation(async () => {
      paginated.mockResolvedValue({
        data: { ok: true, items: [], pagination: { total: 0, hasNext: false } },
      });
      return { data: { ok: true } };
    });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('dtu-new'));
    await waitFor(() => expect(screen.queryByText('Fresh note')).toBeNull());

    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(screen.getAllByText('0 DTUs').length).toBeGreaterThan(0));
    expect(screen.queryByText('Fresh note')).toBeNull();
  });

  it('leaves the row in place when delete is refused with 403', async () => {
    paginated.mockResolvedValue({
      data: { ok: true, items: [created], pagination: { total: 1, hasNext: false } },
    });
    remove.mockRejectedValue({ response: { status: 403 } });
    renderPanel();
    expect(await screen.findByText('Fresh note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByText('Delete'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/only delete your own/i);
    expect(screen.getByText('Fresh note')).toBeTruthy();
    expect(remove).toHaveBeenCalledWith('dtu-new');
  });
});
