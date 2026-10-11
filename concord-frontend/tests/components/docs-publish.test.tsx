import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { setLensState, clearLensState } from '@/lib/lens-state-persistence';
import { useUIStore } from '@/store/ui';

const BODY = 'The river was high at dawn.';

const dtuStore = vi.hoisted(() => new Map<string, { id: string; title: string; content: string; visibility: string }>());
const apiPost = vi.hoisted(() => vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]) })));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'ramaj', email: 'r@example.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/useConnectiveTissue', () => ({
  useTip: () => ({ mutate: vi.fn(), isPending: false }),
  usePostBounty: () => ({ mutate: vi.fn(), isPending: false }),
  useForkDTU: () => ({ mutate: vi.fn(), isPending: false }),
  useMeritCredit: () => ({ data: undefined }),
  useDTUSearch: () => ({ data: undefined }),
}));

vi.mock('@/components/dtu/DTUDetailView', () => ({
  DTUDetailView: () => null,
}));

vi.mock('@/components/docs/usePagePresence', () => ({
  usePagePresence: () => ({ cursors: [], ping: () => {} }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: apiPost, get: vi.fn() },
  lensRun: vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain === 'docs' && action === 'page-list') {
      return {
        data: {
          ok: true,
          result: {
            pages: [{ id: 'pg1', title: 'Field notes', icon: '📄', parentId: null, blockCount: 1 }],
          },
          error: null,
        },
      };
    }
    if (domain === 'docs' && action === 'page-detail') {
      return {
        data: {
          ok: true,
          result: {
            page: {
              id: 'pg1',
              title: 'Field notes',
              icon: '📄',
              parentId: null,
              blocks: [{ id: 'b1', type: 'paragraph', text: BODY, checked: false }],
            },
          },
          error: null,
        },
      };
    }
    if (domain === 'docs' && action === 'comment-list') {
      return { data: { ok: true, result: { count: 0 }, error: null } };
    }
    if (domain === 'dtu' && action === 'create') {
      const id = 'dtu_field_notes';
      const record = {
        id,
        title: String(input.title ?? ''),
        content: String(input.content ?? ''),
        visibility: String(input.visibility ?? ''),
      };
      dtuStore.set(id, record);
      return { data: { ok: true, result: { ok: true, dtu: record }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      const dtu = dtuStore.get(String(input.id ?? ''));
      if (!dtu) return { data: { ok: false, result: null, error: 'DTU not found' } };
      return { data: { ok: true, result: { ok: true, dtu }, error: null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  }),
}));

import { DocsWorkspace } from '@/components/docs/DocsWorkspace';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { getDocsPublishable, resetDocsWorkspaceSnapshot } from '@/components/docs/docsSession';
import { loadDocsExportPayload } from '@/components/docs/exportPages';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { Toasts } from '@/components/common/Toasts';
import { lensRun } from '@/lib/api/client';

describe('Docs publish', () => {
  beforeEach(() => {
    dtuStore.clear();
    apiPost.mockClear();
    resetDocsWorkspaceSnapshot();
    clearLensState('docs');
    useUIStore.setState({ toasts: [] });
    localStorage.clear();
  });

  it('restores the last-open page and publishes a DTU whose content equals the page body', async () => {
    setLensState('docs', { pageId: 'pg1' });
    render(
      <>
        <DocsWorkspace />
        <ConnectiveTissueBar lensId="docs" getPublishable={getDocsPublishable} />
        <Toasts />
      </>,
    );

    expect(await screen.findByDisplayValue('Field notes')).toBeInTheDocument();
    expect(screen.getByDisplayValue(BODY)).toBeInTheDocument();
    expect(getDocsPublishable()).toEqual({ title: 'Field notes', content: BODY });
    expect(screen.queryByRole('button', { name: 'Tip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Publish DTU' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByText('Private DTU dtu_field_notes')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open' });
    expect(open).toHaveAttribute('href', '/dtu/dtu_field_notes');

    const read = await lensRun('dtu', 'get', { id: 'dtu_field_notes' });
    expect(read.data.ok).toBe(true);
    expect(read.data.result?.dtu?.content).toBe(BODY);
    expect(dtuStore.get('dtu_field_notes')?.visibility).toBe('private');
  });

  it('includes workspace pages in the export payload', async () => {
    const payload = await loadDocsExportPayload({ alerts: 0 });
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0].title).toBe('Field notes');
    expect(payload.pages[0].blocks[0].text).toBe(BODY);

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:docs');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    render(<DTUExportButton domain="docs" data={{}} prepare={() => loadDocsExportPayload(null)} compact />);
    fireEvent.click(screen.getByTitle('Export as .dtu'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const body = apiPost.mock.calls[0][1] as { data: { pages: { title: string }[] } };
    expect(body.data.pages[0].title).toBe('Field notes');
    expect(body.data.pages[0]).toEqual(expect.objectContaining({
      blocks: [expect.objectContaining({ text: BODY })],
    }));
  });
});
