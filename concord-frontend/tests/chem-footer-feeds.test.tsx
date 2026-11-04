/**
 * chem-footer-feeds.test.tsx — the footer feeds land (Chem S2+S3, the one
 * integration item: join the PubChem/arXiv pipes).
 *
 * Both panels read their records off the lensRun WRAPPER ({ data: { ok,
 * result } }) instead of the unwrapped result — so the PubChem footer
 * reported "No PubChem records for that name" for caffeine (CID 2519, one
 * of the most-deposited compounds in the database) and the arXiv footer
 * stood empty while its Refresh visibly fetched. These tests hand each
 * panel the real envelope and require the records to render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  lensRun,
  api: { post: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { PubChemPanel } from '@/components/chem/PubChemPanel';
import { ArxivPanel } from '@/components/research/ArxivPanel';

function callName(spec: unknown, action?: string): string {
  if (typeof spec === 'string') return action || '';
  const s = spec as { name?: string; action?: string };
  return s.name || s.action || '';
}

beforeEach(() => {
  vi.clearAllMocks();
  lensRun.mockImplementation(async (spec: unknown, action?: string) => {
    const name = callName(spec, action);
    if (name === 'live_pubchem') {
      return {
        data: {
          ok: true,
          result: {
            ok: true, source: 'PubChem (NIH)', fetchedAt: 1793753705, query: 'caffeine', total: 1,
            compounds: [{
              cid: 2519, molecularFormula: 'C8H10N4O2', molecularWeight: 194.19,
              smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', inchiKey: 'RYYVLZVUVIJVGH-UHFFFAOYSA-N',
              iupacName: '1,3,7-trimethylpurine-2,6-dione', pubchemUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/2519',
            }],
          },
        },
      };
    }
    if (name === 'live_arxiv') {
      return {
        data: {
          ok: true,
          result: {
            ok: true, source: 'arXiv', category: 'physics.chem-ph', fetchedAt: 1793753705, total: 1,
            papers: [{
              arxivId: '2511.00001', title: 'Graphene oxide membranes for desalination',
              summary: 'We study graphene oxide membranes.', published: '2026-11-01T00:00:00Z',
              updated: '2026-11-01T00:00:00Z', authors: ['A. Chemist'],
              abstractUrl: 'https://arxiv.org/abs/2511.00001', pdfUrl: 'https://arxiv.org/pdf/2511.00001',
            }],
          },
        },
      };
    }
    throw new Error(`unexpected macro ${name}`);
  });
});

describe('PubChem footer (F4)', () => {
  it('renders the caffeine record — CID 2519 — instead of "No PubChem records"', async () => {
    render(<PubChemPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Compound name/), { target: { value: 'caffeine' } });
    expect(await screen.findByText(/1,3,7-trimethylpurine-2,6-dione/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/CID:\s*2519/)).toBeTruthy();
    expect(screen.queryByText(/No PubChem records/)).toBeNull();
  });
});

describe('arXiv footer (F5)', () => {
  it('renders the papers the macro returns', async () => {
    render(<ArxivPanel domain="chem" title="arXiv · Chemical Physics" />);
    expect(await screen.findByText(/Graphene oxide membranes for desalination/)).toBeTruthy();
    expect(screen.queryByText(/No papers returned/)).toBeNull();
  });
});
