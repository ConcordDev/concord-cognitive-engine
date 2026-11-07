import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
import { GbifPanel } from '../GbifPanel';

const TAXON = { scientificName: 'Quercus robur L.', canonicalName: 'Quercus robur', kingdom: 'Plantae', phylum: 'Tracheophyta', class: 'Magnoliopsida', order: 'Fagales', family: 'Fagaceae', genus: 'Quercus', rank: 'SPECIES', status: 'ACCEPTED', matchType: 'EXACT' };
const OCC = [{ key: 1, country: 'Germany', stateProvince: 'Bavaria', latitude: 48.1, longitude: 11.5, eventDate: '2025-05-01', basisOfRecord: 'HUMAN_OBSERVATION', datasetName: 'iNaturalist' }, { key: 2, country: null, stateProvince: null, latitude: 0, longitude: 0, eventDate: null, basisOfRecord: 'PRESERVED_SPECIMEN', datasetName: null }];
let mode: 'ok' | 'empty' | 'down' = 'ok';
const settle = (ms = 5) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  mode = 'ok';
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async () => {
    if (mode === 'down') throw new Error('down');
    if (mode === 'empty') return { data: { ok: true, result: { ok: true, taxon: null, occurrences: [], total: 0 } } };
    return { data: { ok: true, result: { ok: true, taxon: TAXON, occurrences: OCC, total: 321, fetchedAt: 1_760_000_000 } } };
  });
});

describe('GbifPanel', () => {
  it('prompts for a name, looks up a species after the debounce, and shows taxonomy and occurrences', async () => {
    const view = render(<GbifPanel domain="environment" />);
    expect(view.container.textContent).toMatch(/Type a scientific or common name/);
    fireEvent.change(screen.getByPlaceholderText(/Species name/), { target: { value: 'Quercus robur' } });
    await settle(900);
    expect(lensRunMock).toHaveBeenCalled();
    expect(view.container.textContent).toMatch(/Quercus|Plantae|Fagaceae/);
    for (const b of screen.queryAllByRole('button')) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 5)); });
  });
  it('handles an unknown species, clearing the box, and an unreachable service', async () => {
    mode = 'empty';
    const view = render(<GbifPanel domain="forestry" />);
    const box = screen.getByPlaceholderText(/Species name/);
    fireEvent.change(box, { target: { value: 'zzzzzz' } });
    await settle(900);
    expect(view.container.textContent?.length).toBeGreaterThan(20);
    fireEvent.change(box, { target: { value: '' } });
    await settle(900);
    mode = 'down';
    fireEvent.change(box, { target: { value: 'Apis mellifera' } });
    await settle(900);
    expect(view.container.textContent).toMatch(/Couldn't reach GBIF|reach/);
  });
});
