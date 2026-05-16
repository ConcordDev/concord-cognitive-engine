import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => create(...args) },
  },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// recharts is heavy and not interesting for these contract tests — stub it.
vi.mock('recharts', () => {
  const Stub = ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'recharts-stub', ...p }, children as React.ReactNode);
  return {
    Bar: Stub, BarChart: Stub, Cell: Stub, ResponsiveContainer: Stub,
    Tooltip: Stub, XAxis: Stub, YAxis: Stub,
  };
});

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { FdaDrugReference } from '@/components/pharmacy/FdaDrugReference';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('FdaDrugReference', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });

  it('renders empty state until a drug is searched', () => {
    renderWithQuery(<FdaDrugReference />);
    expect(screen.getByPlaceholderText(/Brand or generic name/i)).toBeInTheDocument();
    expect(screen.getByText(/Search any FDA-approved drug/i)).toBeInTheDocument();
  });

  it('fetches the label + adverse events on submit and renders drug header', async () => {
    runDomain.mockImplementation(async (_domain, action) => {
      if (action === 'drug-label') {
        return {
          data: {
            ok: true,
            result: {
              ok: true,
              result: {
                query: 'aspirin',
                genericName: 'aspirin',
                brandName: 'Bayer',
                manufacturer: 'Bayer HealthCare',
                productType: 'HUMAN OTC DRUG',
                route: 'ORAL',
                rxOtc: 'OTC',
                indications: 'For the temporary relief of minor aches and pains.',
                dosageAndAdministration: 'Adults: 1-2 tablets every 4 hours.',
                warnings: 'WARNINGS: Reye\'s syndrome. Children and teenagers should not use this medicine for chicken pox or flu symptoms.',
                contraindications: null,
                adverseReactions: 'GI bleeding, tinnitus',
                drugInteractions: 'Anticoagulants',
                mechanismOfAction: 'Cyclooxygenase inhibition',
                pregnancyCategory: null,
                source: 'openfda-drug-label',
              },
            },
          },
        };
      }
      if (action === 'adverse-events') {
        return {
          data: {
            ok: true,
            result: {
              ok: true,
              result: {
                drug: 'aspirin',
                reportCount: 1024,
                topReactions: [
                  { term: 'NAUSEA', count: 350 },
                  { term: 'HEADACHE', count: 200 },
                  { term: 'DIZZINESS', count: 100 },
                ],
                source: 'openfda-faers',
                disclaimer: 'FAERS reports are voluntary submissions and DO NOT establish causality.',
              },
            },
          },
        };
      }
      return { data: { ok: false } };
    });

    renderWithQuery(<FdaDrugReference />);
    fireEvent.change(screen.getByPlaceholderText(/Brand or generic name/i), { target: { value: 'aspirin' } });
    fireEvent.click(screen.getByRole('button', { name: /Lookup/i }));

    await waitFor(() => expect(screen.getByText('Bayer')).toBeInTheDocument());
    expect(screen.getByText(/Generic:/i)).toBeInTheDocument();
    // OTC chip
    expect(screen.getByText('OTC')).toBeInTheDocument();
    // Drug-label macro was called with the correct params shape
    const labelCall = runDomain.mock.calls.find((c) => c[1] === 'drug-label');
    expect(labelCall?.[2]).toMatchObject({ input: { drug: 'aspirin' } });
  });

  it('pins the boxed warning ABOVE the tab strip when WARNINGS contains a boxed pattern', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'drug-label') return { data: { ok: true, result: { ok: true, result: {
        query: 'x', genericName: 'x', brandName: 'X', manufacturer: null, productType: null,
        route: null, rxOtc: 'RX', indications: 'use', dosageAndAdministration: null,
        warnings: 'BOXED WARNING: increased risk of myocardial infarction and stroke. Do not exceed dose.',
        contraindications: null, adverseReactions: null, drugInteractions: null,
        mechanismOfAction: null, pregnancyCategory: null, source: 'openfda-drug-label',
      } } } };
      if (action === 'adverse-events') return { data: { ok: true, result: { ok: true, result: { drug: 'x', reportCount: 0, topReactions: [], source: 'openfda-faers', disclaimer: '' } } } };
      return { data: { ok: false } };
    });
    renderWithQuery(<FdaDrugReference />);
    fireEvent.change(screen.getByPlaceholderText(/Brand or generic name/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Lookup/i }));
    await waitFor(() => expect(screen.getByText(/^Boxed Warning$/)).toBeInTheDocument());
    expect(screen.getByText(/increased risk of myocardial infarction/i)).toBeInTheDocument();
  });

  it('switches to Interactions tab and posts both drugs to the cross-mention macro', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'drug-label') return { data: { ok: true, result: { ok: true, result: {
        query: 'aspirin', genericName: 'aspirin', brandName: 'Bayer', manufacturer: null, productType: null,
        route: null, rxOtc: null, indications: null, dosageAndAdministration: null,
        warnings: null, contraindications: null, adverseReactions: null, drugInteractions: null,
        mechanismOfAction: null, pregnancyCategory: null, source: 'openfda-drug-label',
      } } } };
      if (action === 'adverse-events') return { data: { ok: true, result: { ok: true, result: { drug: 'aspirin', reportCount: 0, topReactions: [], source: 'openfda-faers', disclaimer: '' } } } };
      if (action === 'drugInteractionCheck') return { data: { ok: true, result: { ok: true, result: {
        medicationsChecked: 2, interactionsFound: 1, severity: 'major',
        interactions: [{ drug1: 'aspirin', drug2: 'warfarin', severity: 'major', effect: 'Increased bleeding risk.' }],
      } } } };
      return { data: { ok: false } };
    });
    renderWithQuery(<FdaDrugReference />);
    fireEvent.change(screen.getByPlaceholderText(/Brand or generic name/i), { target: { value: 'aspirin' } });
    fireEvent.click(screen.getByRole('button', { name: /Lookup/i }));
    await waitFor(() => expect(screen.getByText('Bayer')).toBeInTheDocument());

    // Click the Interactions sub-tab
    fireEvent.click(screen.getByRole('button', { name: /Interactions/i }));
    const secondInput = await screen.findByPlaceholderText(/second drug/i);
    fireEvent.change(secondInput, { target: { value: 'warfarin' } });
    fireEvent.click(screen.getByRole('button', { name: /^Check$/ }));

    await waitFor(() => {
      const ixCall = runDomain.mock.calls.find((c) => c[1] === 'drugInteractionCheck');
      expect(ixCall?.[2]).toMatchObject({ input: { medications: ['aspirin', 'warfarin'] } });
    });
    await waitFor(() => expect(screen.getByText(/Increased bleeding risk/i)).toBeInTheDocument());
    expect(screen.getByText(/1 major/i)).toBeInTheDocument();
  });

  it('renders empty-state interactions card with calm green tone when no matches', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'drug-label') return { data: { ok: true, result: { ok: true, result: {
        query: 'tylenol', genericName: 'acetaminophen', brandName: 'Tylenol', manufacturer: null, productType: null,
        route: null, rxOtc: null, indications: null, dosageAndAdministration: null,
        warnings: null, contraindications: null, adverseReactions: null, drugInteractions: null,
        mechanismOfAction: null, pregnancyCategory: null, source: 'openfda-drug-label',
      } } } };
      if (action === 'adverse-events') return { data: { ok: true, result: { ok: true, result: { drug: 'tylenol', reportCount: 0, topReactions: [], source: 'openfda-faers', disclaimer: '' } } } };
      if (action === 'drugInteractionCheck') return { data: { ok: true, result: { ok: true, result: {
        medicationsChecked: 2, interactionsFound: 0, interactions: [],
      } } } };
      return { data: { ok: false } };
    });
    renderWithQuery(<FdaDrugReference />);
    fireEvent.change(screen.getByPlaceholderText(/Brand or generic name/i), { target: { value: 'tylenol' } });
    fireEvent.click(screen.getByRole('button', { name: /Lookup/i }));
    await waitFor(() => expect(screen.getByText('Tylenol')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Interactions/i }));
    const secondInput = await screen.findByPlaceholderText(/second drug/i);
    fireEvent.change(secondInput, { target: { value: 'water' } });
    fireEvent.click(screen.getByRole('button', { name: /^Check$/ }));
    await waitFor(() =>
      expect(screen.getByText(/No interaction mentions found/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/absence of data/i)).toBeInTheDocument();
  });

  it('surfaces an error message when the macro returns ok=false', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'no FDA label found for: zzzzz' } } });
    renderWithQuery(<FdaDrugReference />);
    fireEvent.change(screen.getByPlaceholderText(/Brand or generic name/i), { target: { value: 'zzzzz' } });
    fireEvent.click(screen.getByRole('button', { name: /Lookup/i }));
    await waitFor(() => expect(screen.getByText(/no FDA label found for: zzzzz/)).toBeInTheDocument());
  });
});
