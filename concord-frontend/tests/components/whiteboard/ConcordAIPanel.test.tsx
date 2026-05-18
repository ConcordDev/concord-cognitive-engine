/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConcordAIPanel } from '@/components/whiteboard/ConcordAIPanel';

// Stub the api client at the module level so we don't need a real
// fetch. Real round-trip is exercised in dev-server e2e.
vi.mock('@/lib/api/client', () => ({
  api: {
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api/client';

const mkRes = (body: unknown) => Promise.resolve({ data: body });

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe('ConcordAIPanel — Sprint A integration shape', () => {
  it('Brainstorm path: typing prompt + Generate calls whiteboard.brainstorm and surfaces ideas', async () => {
    vi.mocked(api.post).mockImplementation(((_url: string, body: unknown) => {
      const b = body as { domain?: string; name?: string };
      if (b.domain === 'whiteboard' && b.name === 'brainstorm') {
        return mkRes({ ok: true, ideas: ['Idea A', 'Idea B', 'Idea C'], source: 'llm' });
      }
      return mkRes({ ok: false });
    }) as typeof api.post);

    const onAdd = vi.fn();
    render(
      <ConcordAIPanel boardId={null} elements={[]} onAddStickies={onAdd} />
    );
    const textarea = screen.getByPlaceholderText(/Topic for brainstorm/i);
    fireEvent.change(textarea, { target: { value: 'coffee shop' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => {
      expect(screen.getByText('Idea A')).toBeTruthy();
      expect(screen.getByText('Idea B')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add all to board/i }));
    expect(onAdd).toHaveBeenCalledWith(['Idea A', 'Idea B', 'Idea C']);
  });

  it('Cluster path: calls whiteboard.clusterGroup with mode=semantic by default', async () => {
    vi.mocked(api.post).mockImplementation(((_url: string, body: unknown) => {
      const b = body as { domain?: string; name?: string; input?: { mode?: string } };
      if (b.name === 'clusterGroup') {
        expect(b.input?.mode).toBe('semantic');
        return mkRes({ ok: true, result: { clusters: [{ clusterId: 0, label: 'theme A', elements: ['e1', 'e2'] }] } });
      }
      return mkRes({ ok: false });
    }) as typeof api.post);
    render(
      <ConcordAIPanel boardId={null} elements={[{ id: 'e1', text: 'first' }, { id: 'e2', text: 'second' }]} onAddStickies={() => undefined} />
    );
    // Switch to cluster tab
    fireEvent.click(screen.getByRole('button', { name: /^CLUSTER$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cluster 2/i }));
    await waitFor(() => expect(screen.getByText('theme A')).toBeTruthy());
  });

  it('Summarize path: calls whiteboard.summarize with element text only', async () => {
    vi.mocked(api.post).mockImplementation(((_url: string, body: unknown) => {
      const b = body as { domain?: string; name?: string; input?: { elements?: Array<{ id: string; text: string }> } };
      if (b.name === 'summarize') {
        expect(b.input?.elements?.[0].text).toBe('hello');
        return mkRes({ ok: true, summary: 'all hello', action_items: ['greet'], decisions: [], themes: ['greetings'], source: 'llm' });
      }
      return mkRes({ ok: false });
    }) as typeof api.post);
    render(
      <ConcordAIPanel boardId={null} elements={[{ id: 'e1', text: 'hello' }]} onAddStickies={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^SUMMARIZE$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Summarize 1 elements/i }));
    await waitFor(() => {
      expect(screen.getByText('all hello')).toBeTruthy();
      // li renders as "• greet" — match substring; ok toast also contains "greet" so use getAllByText
      expect(screen.getAllByText(/greet/).length).toBeGreaterThan(0);
    });
  });

  it('Mint tab shows the "save to DB first" hint when no boardId', () => {
    render(
      <ConcordAIPanel boardId={null} elements={[]} onAddStickies={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^MINT$/i }));
    expect(screen.getByText(/Mint requires a DB-backed board/i)).toBeTruthy();
  });

  it('Mint tab shows real export form when boardId present + dispatches export_as_dtu', async () => {
    vi.mocked(api.post).mockImplementation(((_url: string, body: unknown) => {
      const b = body as { name?: string; input?: { boardId?: string; scope?: string } };
      if (b.name === 'export_as_dtu') {
        expect(b.input?.boardId).toBe('wb_abc');
        expect(b.input?.scope).toBe('personal');
        return mkRes({ ok: true, dtuId: 'whiteboard_board:00000000-0000-0000-0000-000000000000' });
      }
      return mkRes({ ok: false });
    }) as typeof api.post);
    render(
      <ConcordAIPanel boardId="wb_abc" elements={[]} onAddStickies={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: /^MINT$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mint as DTU/i }));
    // DTU id shows in BOTH the green ok toast AND the bottom DTU line; both
    // are correct UX — assert at least one renders.
    await waitFor(() => expect(screen.getAllByText(/whiteboard_board:/).length).toBeGreaterThan(0));
  });
});
