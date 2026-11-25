// The Star Chart: the sky reads graph.sky and says honestly how much of the
// lattice it shows; an empty lattice is a dark sky, not a fake one; a star's
// card reads graph.star (lineage included) and adds a new star linked from
// it; a route is plotted between two chosen stars; the survey runs the
// graph's own analysis over exactly the charted stars. Mocked at the network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
const dtusCreate = vi.fn();
const graphSearch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  apiHelpers: { dtus: { create: (...a: unknown[]) => dtusCreate(...a) }, graph: { search: (...a: unknown[]) => graphSearch(...a) } },
  api: { post: vi.fn(), get: vi.fn() },
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => <div data-testid="dtu-detail" /> }));
vi.mock('@/components/graph/MindMapBuilder', () => ({ MindMapBuilder: () => <div data-testid="mindmap" /> }));
vi.mock('@/components/graph/GraphParityPanel', () => ({ GraphParityPanel: () => <div data-testid="maps" /> }));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import Observatory from '@/components/graph/sky/Observatory';
import { CatalogueCard } from '@/components/graph/sky/CatalogueCard';
import { Survey } from '@/components/graph/sky/Survey';
import { catalogueNo, coords } from '@/components/graph/sky/gx';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const calls = (a: string) => lensRun.mock.calls.filter((c) => c[1] === a).map((c) => c[2]);
const STAR = (id: string, o: Record<string, unknown> = {}) => ({ id, title: `Star ${id}`, shelf: 'knowledge', spectral: 'A', colour: '#cad7ff', magnitude: 3, links: 2, citations: 0, constellation: null, x: 0.5, y: 0.5, ...o });
const SKY = { visibleTotal: 120, shown: 3, stars: [STAR('a', { magnitude: 1.2 }), STAR('b'), STAR('c', { magnitude: 5.1 })], constellations: [{ id: 'a', name: 'Star a', size: 3 }], lines: [{ a: 'a', b: 'b', within: true }, { a: 'b', b: 'c', within: true }] };

beforeEach(() => { lensRun.mockReset(); dtusCreate.mockReset(); graphSearch.mockReset(); graphSearch.mockResolvedValue({ data: { results: [] } }); });

describe('helpers', () => {
  it('catalogue numbers come from the id and coordinates read like an atlas', () => {
    expect(catalogueNo('dtu_5f26f1edfb65')).toBe('CC 5F26F1');
    expect(coords(0, 0)).toBe('00h00m +90.0°');
    expect(coords(0.5, 1)).toBe('12h00m −90.0°');
  });
});

describe('the sky', () => {
  it('reads graph.sky, says how much it shows, lists the brightest', async () => {
    lensRun.mockImplementation((_d: string, a: string) => (a === 'sky' ? ok(SKY) : a === 'my-constellations' ? ok({ constellations: [] }) : ok({})));
    render(<Observatory />);
    expect(await screen.findByTestId('sk-counts')).toHaveTextContent('3 of 120 stars · 1 constellations');
    const list = screen.getByTestId('sk-brightest');
    expect(list.textContent?.indexOf('Star a')).toBeLessThan(list.textContent!.indexOf('Star c'));
    expect(calls('sky')[0]).toEqual(expect.objectContaining({ limit: 600, include: [] }));
  });
  it('an empty lattice is a dark sky, honestly', async () => {
    lensRun.mockImplementation((_d: string, a: string) => (a === 'sky' ? ok({ visibleTotal: 0, shown: 0, stars: [], constellations: [], lines: [] }) : ok({ constellations: [] })));
    render(<Observatory />);
    expect(await screen.findByTestId('sk-empty')).toHaveTextContent('The sky is dark.');
  });
  it('turning on one of your constellations asks the sky to include its stars', async () => {
    lensRun.mockImplementation((_d: string, a: string) => (a === 'sky' ? ok(SKY) : a === 'my-constellations' ? ok({ constellations: [{ id: 'm1', title: 'Load path', stars: ['a', 'zz'], lines: [['a', 'zz']], nodes: 3 }] }) : ok({})));
    render(<Observatory />);
    fireEvent.click(await screen.findByRole('button', { name: /Load path/ }));
    await waitFor(() => expect(calls('sky').some((i) => (i as { include: string[] }).include.includes('zz'))).toBe(true));
  });
  it('the Chart room holds your maps and mind maps', async () => {
    lensRun.mockImplementation(() => ok(SKY));
    render(<Observatory />);
    fireEvent.click(screen.getByTestId('sk-room-charts'));
    expect(screen.getByTestId('maps')).toBeTruthy();
    expect(screen.getByTestId('mindmap')).toBeTruthy();
  });
});

describe('a catalogue card', () => {
  const CARD = { id: 'a', title: 'Arches', shelf: 'knowledge', spectral: 'A', colour: '#cad7ff', charted: true, magnitude: 2.31, links: 4, citations: 1, tier: 'regular', createdAt: '2026-11-01T00:00:00Z', tags: ['structures'], summary: 'How arches carry load.', owner: 'ada', isMine: false, parents: [{ id: 'p', title: 'Statics' }], children: [{ id: 'c', title: 'Beams' }], relations: [], charts: [{ id: 'm1', title: 'Load path' }] };
  it('shows magnitude with its cause, the lineage and your charts', async () => {
    lensRun.mockImplementation((_d: string, a: string) => (a === 'star' ? ok({ star: CARD }) : ok({})));
    const onPoint = vi.fn();
    render(<CatalogueCard id="a" star={null} onClose={() => {}} onPoint={onPoint} onRouteFrom={() => {}} routingFrom={null} onOpen={() => {}} onCreated={() => {}} />);
    expect(await screen.findByText('Arches')).toBeTruthy();
    expect(screen.getByText(/from 4 links and 1 citation/)).toBeTruthy();
    expect(screen.getByTestId('sk-parents')).toHaveTextContent('Statics');
    expect(screen.getByTestId('sk-children')).toHaveTextContent('Beams');
    expect(screen.getByText(/On your chart: Load path/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Beams' }));
    expect(onPoint).toHaveBeenCalledWith('c');
  });
  it('a new star from here is a DTU whose parent is this star', async () => {
    lensRun.mockImplementation(() => ok({ star: CARD }));
    dtusCreate.mockResolvedValue({ data: { dtu: { id: 'new1' } } });
    const onCreated = vi.fn();
    render(<CatalogueCard id="a" star={null} onClose={() => {}} onPoint={() => {}} onRouteFrom={() => {}} routingFrom={null} onOpen={() => {}} onCreated={onCreated} />);
    await screen.findByText('Arches');
    fireEvent.click(screen.getByTestId('sk-add-toggle'));
    fireEvent.change(screen.getByTestId('sk-add-title'), { target: { value: 'Flying buttresses' } });
    fireEvent.click(screen.getByTestId('sk-add-go'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new1'));
    expect(dtusCreate.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'Flying buttresses', parents: ['a'] }));
  });
  it('a star you may not see says so', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'star not found' } });
    render(<CatalogueCard id="x" star={null} onClose={() => {}} onPoint={() => {}} onRouteFrom={() => {}} routingFrom={null} onOpen={() => {}} onCreated={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('star not found');
  });
});

describe('the survey', () => {
  it('runs the graph’s own analysis over exactly the charted stars and links', async () => {
    lensRun.mockImplementation((_d: string, a: string) => (a === 'graphMetrics'
      ? ok({ metrics: { density: 0.667, densityLabel: 'moderate', averageDegree: 1.333, maxDegree: 2, diameter: 2, averagePathLength: 1.333, clusteringCoefficient: 0, isConnected: true } })
      : ok({})));
    render(<Survey stars={SKY.stars as never} lines={SKY.lines} onPoint={() => {}} />);
    fireEvent.click(screen.getByTestId('sk-survey-graphMetrics'));
    expect(await screen.findByTestId('sk-survey-result')).toHaveTextContent('Over the 3 stars and 2 links on the chart');
    expect(calls('graphMetrics')[0]).toEqual({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] });
    expect(screen.getByText(/0.667 \(moderate\)/)).toBeTruthy();
  });
});
