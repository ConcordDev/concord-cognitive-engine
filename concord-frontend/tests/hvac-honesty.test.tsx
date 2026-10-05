// HVAC honesty: the lens holds the user's own persisted records (jobs,
// estimates, CRM, field service, saved load estimates), so the header must not
// say "Simulated". The load calculator is a square-foot rule of thumb and
// must not be labelled "Manual J". Each estimate is saved to the user's load
// history (hvac.load-list) so it survives a reload, and errors are shown
// instead of falling back to the empty placeholder.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getLensManifest } from '@/lib/lenses/manifest';
import { loadReportDtuCall, loadBody } from '@/components/hvac/hvacLoadReport';

type Call = { action: string; input: Record<string, unknown> };
const calls: Call[] = [];
let loads: unknown[] = [];
let failCalc = false;

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: false, error: 'boom' } })) } },
  lensRun: vi.fn((domain: string, action: string, input: Record<string, unknown>) => {
    calls.push({ action: `${domain}.${action}`, input });
    if (domain === 'hvac' && action === 'load-list') return Promise.resolve({ data: { ok: true, result: { loads } } });
    if (domain === 'hvac' && action === 'loadCalculation') {
      if (failCalc) return Promise.resolve({ data: { ok: false, result: null, error: 'handler_error' } });
      const entry = {
        id: 'load_new_1',
        inputs: { squareFootage: input.squareFootage, stories: input.stories, insulation: input.insulation, climate: input.climate },
        result: { heatingBTU: 31875, coolingBTU: 37500, tonnageRecommended: '3.1 ton', equipmentSize: '3.5 ton system' },
        createdAt: '2026-10-05T19:00:00Z',
      };
      loads = [entry, ...loads];
      return Promise.resolve({ data: { ok: true, result: { ...entry.result, loadId: entry.id } } });
    }
    return Promise.resolve({ data: { ok: true, result: { drafts: [] } } });
  }),
}));

import { ManualJCalc } from '@/components/hvac/ManualJCalc';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ManualJCalc /></QueryClientProvider>);
}

const saved = {
  id: 'load_saved_9',
  inputs: { squareFootage: 1800, stories: 2, insulation: 'good', climate: 'hot-humid' },
  result: { heatingBTU: 47334, coolingBTU: 55688, tonnageRecommended: '4.6 ton', equipmentSize: '5 ton system' },
  createdAt: '2026-10-05T18:00:00Z',
};

describe('HVAC lens honesty', () => {
  beforeEach(() => { calls.length = 0; loads = []; failCalc = false; });

  it('is on the Real tier with copy that names what is not supported', () => {
    const m = getLensManifest('hvac')!;
    expect(m.dataTier).toBe('REAL_FREE');
    const copy = JSON.stringify([m.emptyState, m.firstRunGuide]);
    expect(copy).toMatch(/not an ACCA Manual J/);
    expect(copy).not.toMatch(/stream against real building data|Schedule optimization|maintenance pack/);
  });

  it('the load tab and widget are not labelled Manual J', () => {
    const page = readFileSync(join(__dirname, '../app/lenses/hvac/page.tsx'), 'utf8');
    expect(page).not.toMatch(/label: 'Manual J'/);
    expect(page).toMatch(/label: 'Loads'/);
    const calc = readFileSync(join(__dirname, '../components/hvac/ManualJCalc.tsx'), 'utf8');
    expect(calc).not.toMatch(/>Manual J load</);
  });

  it('restores the latest saved estimate on mount (survives a reload)', async () => {
    loads = [saved];
    mount();
    await waitFor(() => expect(screen.getByTestId('load-saved').textContent).toContain('load_saved_9'));
    expect(screen.getByText('55,688')).toBeTruthy();
    expect(screen.getByDisplayValue('1800')).toBeTruthy();
    expect(screen.getByTestId('load-history').textContent).toContain('load_saved_9');
  });

  it('a new calculation is saved to the account and listed', async () => {
    mount();
    fireEvent.change(screen.getAllByPlaceholderText('e.g. 1800')[0], { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate load' }));
    await waitFor(() => expect(screen.getByTestId('load-saved').textContent).toContain('load_new_1'));
    const calc = calls.find((c) => c.action === 'hvac.loadCalculation');
    expect(calc?.input.save).toBe(true);
    expect(calc?.input.squareFootage).toBe(1500);
    expect(screen.getByTestId('load-history').textContent).toContain('load_new_1');
  });

  it('shows the error instead of the empty placeholder when the calculation fails', async () => {
    failCalc = true;
    mount();
    fireEvent.change(screen.getAllByPlaceholderText('e.g. 1800')[0], { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate load' }));
    await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toMatch(/Not calculated\. handler_error/));
  });

  it('the kept DTU title carries the load id so identical estimates do not collide', () => {
    const facts = { inputs: { squareFootage: 1800, stories: 2, insulation: 'good', climate: 'hot-humid' }, result: saved.result, loadId: 'load_saved_9' };
    const call = loadReportDtuCall(facts)!;
    expect(String(call.input.title)).toMatch(/· load_saved_9$/);
    expect(loadBody(facts)).toMatch(/not an ACCA Manual J calculation/);
    expect(call.input.tags).not.toContain('manual-j');
  });
});
