/**
 * Carpentry full-build slices — build(carpentry), GB-1088 (B7).
 * Behaviour pins for Review 5's first-pass findings against the rebuilt
 * panels (JobOps · CarpentryShop · WoodSpeciesReference):
 *   F2 pin — the board-foot card sends EVERY complete piece to the tally.
 *   F3 — the takeoff offers an Overhead % input, sends it, and prints a
 *        numbered breakdown that reconciles to the total.
 *   F4 — an invoice renders its deposit as a line (deposit · balance due)
 *        and its signature.
 *   F5 — a scheduled job opens an edit form and saves field changes
 *        through scheduleUpdate.
 *   F6 — a species card for a covered species prints Janka · density ·
 *        workability from the lens's own table.
 *   F7 — invoices and (revoked) portal entries carry two-step remove
 *        controls wired to invoiceDelete / portalDelete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunCalls: { action: string; input: Record<string, unknown> }[] = [];
const runDomainCalls: { action: string; input: Record<string, unknown> }[] = [];

const TAKEOFF = {
  projectName: 'Fixture', materialSubtotal: 180, materialWithWaste: 198,
  laborCost: 650, overhead: 101.76, margin: 189.95, total: 1139.71,
  wastePct: 10, overheadPct: 12, marginPct: 20,
  items: [{ name: 'materials', quantity: 1, unit: 'lot', unitCost: 180, lineTotal: 180 }],
};
const SCHED_ENTRY = {
  id: 'sch_1', title: 'Fixture Job', date: '2026-11-10', startTime: '08:00', endTime: '16:00',
  crewIds: [], crewNames: [], jobId: '', address: '1 Old St', status: 'scheduled', notes: '',
};
const INVOICE = {
  id: 'inv_1', invoiceNumber: 'INV-1001', estimateId: 'est_1', client: 'Pat Client',
  subtotal: 1100, tax: 0, total: 1100, depositPct: 25, depositDue: 275, status: 'issued',
  signature: { signedBy: 'Pat Client', decision: 'approved' },
};
const REVOKED_SHARE = {
  token: 'tok_revoked', client: 'Pat Client', estimateId: 'est_1', estimateAmount: 1100,
  jobName: 'Fixture Project', progressPct: 75, status: 'revoked', clientDecision: null, milestones: [],
};
const SPECIES = [
  { name: 'Oak', janka: 1290, densityKgM3: 720, workability: 'good', cost: 'medium', bestFor: 'furniture, flooring, cabinetry' },
  { name: 'Pine', janka: 380, densityKgM3: 510, workability: 'excellent', cost: 'low', bestFor: 'shelving, framing' },
];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    lensRunCalls.push({ action, input });
    const results: Record<string, unknown> = {
      crewList: { members: [] },
      scheduleList: { entries: [SCHED_ENTRY] },
      timeEntryList: { entries: [], running: [], totalHours: 0, totalCost: 0, byJob: [] },
      photoLogList: { entries: [] },
      invoiceList: { invoices: [INVOICE], outstanding: 825, collected: 0 },
      portalList: { shares: [REVOKED_SHARE] },
      materialTakeoff: TAKEOFF,
      speciesReference: { species: SPECIES },
    };
    return { data: { ok: true, result: results[action] ?? {}, error: null } };
  }),
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async (_domain: string, action: string, body: { input: Record<string, unknown> }) => {
        runDomainCalls.push({ action, input: body.input });
        if (action === 'boardFootCalc') {
          return { data: { ok: true, result: {
            pieces: [
              { species: 'pine', dimensions: '2" x 6" x 96"', quantity: 1, boardFeetEach: 8, totalBoardFeet: 8, cost: 40 },
              { species: 'pine', dimensions: '1" x 6" x 96"', quantity: 1, boardFeetEach: 4, totalBoardFeet: 4, cost: 20 },
            ],
            totalBoardFeet: 12, wasteAllowance: 1.8, totalWithWaste: 13.8, totalCost: 60,
          } } };
        }
        return { data: { ok: true, result: {} } };
      }),
    },
  },
}));

vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
vi.mock('@/lib/public-lookup', () => ({
  wikiSummary: vi.fn(async (species: string) => ({
    title: species, description: 'Genus of trees', extract: `About ${species}.`,
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${species}` } },
  })),
  lookupMeta: () => null,
}));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => null }));

import { JobOps } from '@/components/carpentry/JobOps';
import { CarpentryShop } from '@/components/carpentry/CarpentryShop';
import { WoodSpeciesReference } from '@/components/carpentry/WoodSpeciesReference';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => { lensRunCalls.length = 0; runDomainCalls.length = 0; });

describe('F3 — takeoff breakdown + overhead input', () => {
  it('sends overheadPct and prints every numbered component', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Takeoff/i }));
    const qty = await screen.findByPlaceholderText('40');
    fireEvent.change(qty, { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('4.50'), { target: { value: '180' } });
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'Fixture' } });
    // labor hours input is the first labelled numeric in the % grid — set via label text parent
    const laborLabel = screen.getByText('Labor hrs');
    const laborInput = laborLabel.querySelector('input') as HTMLInputElement;
    fireEvent.change(laborInput, { target: { value: '10' } });
    expect(screen.getByText('Overhead %')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Build estimate' }));
    await screen.findByText('Materials with waste');
    expect(screen.getByText('$198.00')).toBeInTheDocument();
    expect(screen.getByText('Overhead (12%)')).toBeInTheDocument();
    expect(screen.getByText('+$101.76')).toBeInTheDocument();
    expect(screen.getByText('+$189.95')).toBeInTheDocument();
    expect(screen.getByText('$1,139.71')).toBeInTheDocument();
    const call = lensRunCalls.find((c) => c.action === 'materialTakeoff');
    expect(call?.input.overheadPct).toBe(12);
  });
});

describe('F5 — schedule field editing', () => {
  it('opens an edit form on the row and saves the new title via scheduleUpdate', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/i }));
    await screen.findByText('Fixture Job');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const titleInput = screen.getByDisplayValue('Fixture Job');
    fireEvent.change(titleInput, { target: { value: 'Fixture Job v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      const call = lensRunCalls.find((c) => c.action === 'scheduleUpdate' && (c.input as { title?: string }).title === 'Fixture Job v2');
      expect(call).toBeTruthy();
      expect(call?.input.id).toBe('sch_1');
      expect(call?.input.address).toBe('1 Old St');
    });
  });
});

describe('F4/F7 — invoice deposit line, signature, and exit paths', () => {
  it('renders the deposit line and signature; two-step delete calls invoiceDelete', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Invoicing/i }));
    await screen.findByText(/Deposit \(25%\)/);
    expect(screen.getByText('$275.00')).toBeInTheDocument();
    expect(screen.getByText(/Balance due/)).toBeInTheDocument();
    expect(screen.getByText('$825.00')).toBeInTheDocument();
    expect(screen.getByText(/signed by Pat Client/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => {
      expect(lensRunCalls.some((c) => c.action === 'invoiceDelete' && c.input.id === 'inv_1')).toBe(true);
    });
  });

  it('a revoked portal entry can be removed via portalDelete', async () => {
    wrap(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Invoicing/i }));
    await screen.findByText('Link revoked');
    fireEvent.click(screen.getByRole('button', { name: 'Remove entry' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => {
      expect(lensRunCalls.some((c) => c.action === 'portalDelete' && c.input.token === 'tok_revoked')).toBe(true);
    });
  });
});

describe('F2 pin — board-foot card sends every complete piece', () => {
  it('two filled pieces are both sent to boardFootCalc and the total renders', async () => {
    wrap(<CarpentryShop />);
    const lengths = screen.getAllByPlaceholderText('96');
    const widths = screen.getAllByPlaceholderText('6');
    const thicks = screen.getAllByPlaceholderText('1');
    const prices = screen.getAllByPlaceholderText('0');
    fireEvent.change(thicks[0], { target: { value: '2' } });
    fireEvent.change(widths[0], { target: { value: '6' } });
    fireEvent.change(lengths[0], { target: { value: '96' } });
    fireEvent.change(prices[0], { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Add piece/i }));
    const lengths2 = screen.getAllByPlaceholderText('96');
    const widths2 = screen.getAllByPlaceholderText('6');
    const thicks2 = screen.getAllByPlaceholderText('1');
    const prices2 = screen.getAllByPlaceholderText('0');
    fireEvent.change(thicks2[1], { target: { value: '1' } });
    fireEvent.change(widths2[1], { target: { value: '6' } });
    fireEvent.change(lengths2[1], { target: { value: '96' } });
    fireEvent.change(prices2[1], { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tally' }));
    await waitFor(() => {
      const call = runDomainCalls.find((c) => c.action === 'boardFootCalc');
      expect(call).toBeTruthy();
      expect((call?.input.pieces as unknown[]).length).toBe(2);
    });
    expect(await screen.findByText('$60')).toBeInTheDocument();
  });
});

describe('F6 — species cards carry trade properties for covered species', () => {
  it('Oak shows Janka, density and workability chips', async () => {
    wrap(<WoodSpeciesReference />);
    fireEvent.click(screen.getByRole('button', { name: 'Oak' }));
    expect(await screen.findByText('Janka 1,290')).toBeInTheDocument();
    expect(screen.getByText('720 kg/m³')).toBeInTheDocument();
    expect(screen.getByText(/Workability: good/)).toBeInTheDocument();
  });

  it('an uncovered preset (Mahogany) shows no fabricated properties', async () => {
    wrap(<WoodSpeciesReference />);
    fireEvent.click(screen.getByRole('button', { name: 'Mahogany' }));
    await screen.findByText(/About Mahogany/);
    expect(screen.queryByText(/Janka/)).toBeNull();
  });
});
