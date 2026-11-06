/**
 * News full build — desk legs (B6, F-B row 9).
 *
 * S1/F3: the BriefingCard states the situation when no section carries
 * stories (warming / unavailable, from the payload's own status) instead
 * of presenting greeting + date + sign-off as a quiet news day; a stale
 * briefing is marked stale.
 * S4/F6: the analysis set persists — the picked headline objects live in
 * localStorage, so the set (and the workbench's input) survives a reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Headline, DailyBriefing } from '@/components/news/intel/intel-api';

const H1: Headline = {
  id: 'hl_tech_aaa', category: 'tech', title: 'PR2 Set Headline',
  url: 'https://example.com/a', source: 'example.com', sourceCountry: 'US',
  publishedAt: '2026-11-06T14:00:00.000Z', contentPolicy: 'full',
  snippet: null, summary: null, attribution: 'GDELT Project · example.com', socialImageUrl: null,
};

const BRIEFING_OK: DailyBriefing = {
  greeting: 'Good afternoon — here is what is happening today.', date: 'Friday, November 6, 2026',
  topStories: { heading: 'Top stories', bullets: ['A real top story'] },
  business: { heading: 'Business & markets', bullets: [] },
  tech: { heading: 'Technology', bullets: [] },
  science: { heading: 'Science & health', bullets: [] },
  closing: 'That is the briefing.', source: 'GDELT Project', status: 'fresh',
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => (queryKey[0] === 'intel-headlines'
    ? { data: { ok: true, result: { headlines: [H1], total: 1, status: 'fresh', fetchedAt: '2026-11-06T15:00:00.000Z', nextCursor: 0 } }, isLoading: false, isSuccess: true, isFetching: false, isRefetching: false, refetch: vi.fn() }
    : { data: { ok: true, result: BRIEFING_OK }, isLoading: false }),
}));
vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })) }));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/components/news/intel/CitationChainPanel', () => ({ CitationChainPanel: () => null }));
vi.mock('@/components/news/MyReaderDesk', () => ({ MyReaderDesk: () => null }));
vi.mock('@/components/news/intel/AnalysisWorkbench', () => ({
  AnalysisWorkbench: ({ selected }: { selected: Headline[] }) => (
    <div data-testid="workbench">{selected.map((h) => <span key={h.id}>{h.title}</span>)}</div>
  ),
}));

import { IntelDesk, BriefingCard } from '@/components/news/intel/IntelDesk';

const EMPTY = { heading: '', bullets: [] };
function briefingWith(patch: Partial<DailyBriefing>): DailyBriefing {
  return {
    greeting: 'Good morning — here is what is happening today.', date: 'Friday, November 6, 2026',
    topStories: { ...EMPTY, heading: 'Top stories' }, business: { ...EMPTY, heading: 'Business & markets' },
    tech: { ...EMPTY, heading: 'Technology' }, science: { ...EMPTY, heading: 'Science & health' },
    closing: 'That is the briefing.', source: 'GDELT Project', ...patch,
  };
}

describe('BriefingCard — the briefing never renders silently empty (S1/F3)', () => {
  it('states the warming situation when every section is empty', () => {
    render(<BriefingCard briefing={briefingWith({ status: 'unavailable', degradedReason: 'warming' })} loading={false} />);
    expect(screen.getByText(/Still warming up/)).toBeInTheDocument();
  });

  it('states an unavailable briefing with its reason', () => {
    render(<BriefingCard briefing={briefingWith({ status: 'unavailable', degradedReason: 'gdelt_timeout' })} loading={false} />);
    expect(screen.getByText(/No stories reached the briefing this time \(gdelt_timeout\)/)).toBeInTheDocument();
  });

  it('renders stories and marks a stale briefing stale', () => {
    render(<BriefingCard briefing={{ ...BRIEFING_OK, stale: true, status: 'stale' }} loading={false} />);
    expect(screen.getByText(/A real top story/)).toBeInTheDocument();
    expect(screen.getByText(/Stale — showing the last good briefing/)).toBeInTheDocument();
    expect(screen.queryByText(/Still warming up/)).not.toBeInTheDocument();
  });
});

describe('the analysis set persists (S4/F6)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('a picked headline survives an unmount + remount (a reload)', () => {
    const first = render(<IntelDesk />);
    expect(screen.getByTestId('workbench').textContent).not.toContain('PR2 Set Headline');
    fireEvent.click(screen.getByLabelText('Add to analysis set'));
    expect(screen.getByTestId('workbench').textContent).toContain('PR2 Set Headline');
    expect(localStorage.getItem('concord:news:analysis-set:v1')).toContain('PR2 Set Headline');
    first.unmount();
    render(<IntelDesk />);
    expect(screen.getByTestId('workbench').textContent).toContain('PR2 Set Headline');
  });

  it('a stored set renders on first mount and its chip removes it', () => {
    localStorage.setItem('concord:news:analysis-set:v1', JSON.stringify([H1]));
    render(<IntelDesk />);
    expect(screen.getByTestId('workbench').textContent).toContain('PR2 Set Headline');
    fireEvent.click(screen.getByLabelText('Remove from analysis set: PR2 Set Headline'));
    expect(screen.getByTestId('workbench').textContent).not.toContain('PR2 Set Headline');
    expect(localStorage.getItem('concord:news:analysis-set:v1')).toBe('[]');
  });
});
