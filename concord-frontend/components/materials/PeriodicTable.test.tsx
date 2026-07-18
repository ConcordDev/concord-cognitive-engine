/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// PeriodicTable is backed by the curated 118-element dataset
// (server/lib/periodic-table-data.js) via materials.element-list /
// materials.element-detail, and deep-links "find materials" into the
// EXISTING materials.mp-search macro rather than a duplicate client.
// These tests pin: the grid renders real data, clicking an element opens
// a real detail panel, the mp-search deep-link fires the real macro, and
// a genuinely-unmeasured superheavy element renders an honest
// "not authoritatively known" state instead of a blank or a fabricated 0.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { PeriodicTable } from './PeriodicTable';

const ok = <T,>(result: T) => ({ data: { ok: true, result } });

type Handler = unknown | ((input: Record<string, unknown>) => unknown);
function route(handlers: Record<string, Handler>) {
  lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
    if (action in handlers) {
      const h = handlers[action];
      return Promise.resolve(typeof h === 'function' ? (h as (i: Record<string, unknown>) => unknown)(input) : h);
    }
    return Promise.reject(new Error(`unexpected action ${action}`));
  });
}

const hydrogen = {
  z: 1, symbol: 'H', name: 'Hydrogen', category: 'diatomic nonmetal', categoryGroup: 'nonmetal',
  group: 1, period: 1, block: 's', phase: 'Gas', gridCol: 1, gridRow: 1,
  electronConfiguration: '1s1', standardAtomicWeight: 1.008, massNumberOfLongestLivedIsotope: null,
  density: 0.08988, densityUnit: 'g/L (gas, 0C 1atm)', meltingPointC: -259.16, boilingPointC: -252.88,
  unmeasuredBulkProperties: false, predictedNotMeasured: false,
};
const gold = {
  z: 79, symbol: 'Au', name: 'Gold', category: 'transition metal', categoryGroup: 'transition-metal',
  group: 11, period: 6, block: 'd', phase: 'Solid', gridCol: 11, gridRow: 6,
  electronConfiguration: '[Xe] 4f14 5d10 6s1', standardAtomicWeight: 196.9666, massNumberOfLongestLivedIsotope: null,
  density: 19.3, densityUnit: 'g/cm3', meltingPointC: 1064.18, boilingPointC: 2969.85,
  unmeasuredBulkProperties: false, predictedNotMeasured: false,
};
const oganesson = {
  z: 118, symbol: 'Og', name: 'Oganesson', category: 'unknown, predicted to be noble gas', categoryGroup: 'unknown',
  group: 18, period: 7, block: 'p', gridCol: 18, gridRow: 7, phase: 'Solid',
  electronConfiguration: '[Rn] 5f14 6d10 7s2 7p6', standardAtomicWeight: null, massNumberOfLongestLivedIsotope: 294,
  density: null, densityUnit: null, meltingPointC: null, boilingPointC: null,
  unmeasuredBulkProperties: true, predictedNotMeasured: false,
};

describe('PeriodicTable', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('loads and renders the real element grid', async () => {
    route({ 'element-list': ok({ elements: [hydrogen, gold], count: 2, totalElements: 118 }) });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('H')).toBeInTheDocument());
    expect(screen.getByText('Au')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('materials', 'element-list', {});
  });

  it('clicking an element opens a detail panel with its real properties', async () => {
    route({
      'element-list': ok({ elements: [gold], count: 1, totalElements: 118 }),
      'element-detail': (input: Record<string, unknown>) => {
        expect(input.symbol).toBe('Au');
        return ok({ element: gold, findMaterials: { macro: 'materials.mp-search', params: { elements: ['Au'] } } });
      },
    });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('Au')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Gold (Z=79)'));

    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument());
    expect(screen.getByText('19.300 g/cm3')).toBeInTheDocument();
    expect(screen.getByText('1064.18 °C')).toBeInTheDocument();
  });

  it('a genuinely-unmeasured superheavy element renders an honest "not authoritatively known" state, never a fabricated value', async () => {
    route({
      'element-list': ok({ elements: [oganesson], count: 1, totalElements: 118 }),
      'element-detail': ok({ element: oganesson, findMaterials: { macro: 'materials.mp-search', params: { elements: ['Og'] } } }),
    });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('Og')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Oganesson (Z=118)'));

    await waitFor(() => expect(screen.getByText('Oganesson')).toBeInTheDocument());
    // Three properties (density, melting, boiling) are honestly unknown —
    // never rendered as 0 or blank.
    const unknowns = screen.getAllByText('not authoritatively known');
    expect(unknowns.length).toBe(3);
    expect(screen.queryByText('0 g/cm3')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 °C')).not.toBeInTheDocument();
    // The explanatory note about never having a macroscopic sample appears.
    expect(screen.getByText(/never been produced in a macroscopic/i)).toBeInTheDocument();
    // The mass-number-in-brackets fact is shown instead of a fabricated
    // standard atomic weight.
    expect(screen.getByText(/\[294\]/)).toBeInTheDocument();
  });

  it('"Find materials containing X" calls the existing materials.mp-search macro, not a duplicate client', async () => {
    route({
      'element-list': ok({ elements: [gold], count: 1, totalElements: 118 }),
      'element-detail': ok({ element: gold, findMaterials: { macro: 'materials.mp-search', params: { elements: ['Au'] } } }),
      'mp-search': (input: Record<string, unknown>) => {
        expect(input.elements).toEqual(['Au']);
        return ok({ materials: [{ materialId: 'mp-81', formula: 'Au', crystalSystem: 'Cubic', isStable: true }], count: 1 });
      },
    });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('Au')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Gold (Z=79)'));
    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument());

    fireEvent.click(screen.getByText(/Find materials containing Au/i));
    await waitFor(() => expect(screen.getByText('mp-81')).toBeInTheDocument());
    expect(lensRun).toHaveBeenCalledWith('materials', 'mp-search', { elements: ['Au'], limit: 12 });
  });

  it('filters the grid by category legend click', async () => {
    route({ 'element-list': ok({ elements: [hydrogen, gold], count: 2, totalElements: 118 }) });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('H')).toBeInTheDocument());

    const goldTile = screen.getByTitle('Gold (Z=79)');
    fireEvent.click(screen.getByText('Transition metal'));
    // Gold (transition-metal) should no longer be dimmed; Hydrogen (nonmetal) should be.
    await waitFor(() => expect(goldTile.className).not.toMatch(/opacity-20/));
    expect(screen.getByTitle('Hydrogen (Z=1)').className).toMatch(/opacity-20/);
  });

  it('surfaces a load error honestly instead of rendering an empty grid silently', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'db unavailable' } });
    render(<PeriodicTable />);
    await waitFor(() => expect(screen.getByText('db unavailable')).toBeInTheDocument());
  });
});
