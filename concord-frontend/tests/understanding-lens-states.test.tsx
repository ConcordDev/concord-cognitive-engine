/**
 * /lenses/understanding — four-UX-state contract.
 *
 * Pins that the Understanding lens renders genuine loading / error (with a
 * working Retry) / empty / populated states against the real macro surface.
 *
 * The lens's default landing tab is "Notes" (NotesWorkbench), the genuine,
 * correctly-wired knowledge-notes surface. It reaches the backend ONLY through
 * lensRun('understanding', …) → POST /api/lens/run, resolving to the path-3
 * domain handlers in server/domains/understanding.js (list / tags / search /
 * create / get / backlinks). The page header also calls macro(...) (api.post)
 * for subject_kinds / evolution_stats + lensRun('understanding','overview').
 *
 * No fabricated data: every state is driven by a mocked lensRun / api standing
 * in for the real backend, exactly the shape the domain returns
 * ({ data: { ok, result } }). Heavy shell + artifact hooks are stubbed so the
 * test stays on the page's state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── backend channels ─────────────────────────────────────────────────────────
const lensRun = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

// ── headless shell + chrome stubs ────────────────────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false }),
  useCreateArtifact: () => ({ mutate: () => {} }),
}));
vi.mock('@/components/understanding/KnowledgeGraph', () => ({ KnowledgeGraph: () => null }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import UnderstandingPage from '@/app/lenses/understanding/page';

// lensRun returns an axios-shaped { data: { ok, result } }.
function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}
// api.post (the page header path) resolves { data } directly.
function apiReply(data: Record<string, unknown>) {
  return Promise.resolve({ data });
}

const NOTE = {
  id: 'und_abc123',
  title: 'Spaced repetition',
  body: 'Recall over time wins.',
  tags: ['memory', 'study'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  revisionCount: 1,
  wordCount: 4,
};

// Header always resolves cleanly (subject_kinds + evolution_stats via api.post).
function headerOk() {
  apiPost.mockImplementation((_url: string, body: { name?: string }) => {
    if (body?.name === 'subject_kinds') return apiReply({ ok: true, kinds: ['dtu', 'raw'] });
    if (body?.name === 'evolution_stats') return apiReply({ ok: true, stats: { totalUnderstandings: 0, promotedCount: 0 } });
    return apiReply({ ok: true });
  });
}

beforeEach(() => {
  lensRun.mockReset();
  apiPost.mockReset();
  headerOk();
});

describe('understanding lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the notes list is in flight', async () => {
    // list never resolves → NotesWorkbench stays in the loading state.
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return new Promise(() => {});
      if (name === 'tags') return reply({ tags: [] });
      if (name === 'overview') return reply({ noteCount: 0 });
      return reply({});
    });
    const { container } = render(<UnderstandingPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: shows the honest "No notes yet" CTA when the list is empty', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ notes: [], count: 0 });
      if (name === 'tags') return reply({ tags: [] });
      if (name === 'overview') return reply({ noteCount: 0 });
      return reply({});
    });
    const { getByText } = render(<UnderstandingPage />);
    await waitFor(() => expect(getByText(/No notes yet/i)).toBeInTheDocument());
  });

  it('ERROR: a failed list load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') {
        if (fail) return Promise.reject(new Error('network down'));
        return reply({ notes: [NOTE], count: 1 });
      }
      if (name === 'tags') return reply({ tags: [] });
      if (name === 'overview') return reply({ noteCount: 0 });
      return reply({});
    });
    const { getByText, getByRole, container } = render(<UnderstandingPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/network down/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.filter((c) => c[1] === 'list').length;
    fail = false;
    await act(async () => { fireEvent.click(getByRole('button', { name: /Retry/i })); });
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'list').length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Spaced repetition')).toBeInTheDocument());
  });

  it('POPULATED: renders the real note from list data', async () => {
    lensRun.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return reply({ notes: [NOTE], count: 1 });
      if (name === 'tags') return reply({ tags: [{ tag: 'memory', count: 1 }] });
      if (name === 'overview') return reply({ noteCount: 1, manualLinkCount: 0, wikiLinkCount: 0, tagCount: 1 });
      return reply({});
    });
    const { getByText, getAllByText } = render(<UnderstandingPage />);
    await waitFor(() => expect(getByText('Spaced repetition')).toBeInTheDocument());
    // tag chip + note tag both surface from the real macro data
    expect(getAllByText('memory').length).toBeGreaterThan(0);
  });
});
