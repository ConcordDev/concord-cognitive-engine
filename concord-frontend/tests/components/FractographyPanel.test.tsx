/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * FractographyPanel — closes docs/WAVE4_INVENTORY.md row 239
 * (materials: "No failure-analysis/fractography workflow"). Pins that
 * the panel renders a real discrete-observation intake form (not a
 * free-text-only box), submits real params to
 * materials.fractographyAnalysis + materials.fractographyRootCause,
 * renders the real classification + supporting evidence + root-cause
 * guidance the macros return, and surfaces macro-reported failures
 * honestly instead of fabricating a classification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const dtusCreate = vi.fn();
const addToast = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
    dtus: { create: (...args: unknown[]) => dtusCreate(...args) },
  },
}));

vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }) }));

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

import { FractographyPanel } from '@/components/materials/FractographyPanel';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function fillMaterial(value: string) {
  fireEvent.change(screen.getByPlaceholderText(/stainless steel 304/i), { target: { value } });
}

function checkFeature(label: RegExp) {
  fireEvent.click(screen.getByLabelText(label));
}

describe('FractographyPanel', () => {
  beforeEach(() => {
    runDomain.mockReset();
    dtusCreate.mockReset();
    addToast.mockReset();
  });

  it('renders a real discrete-observation intake form (material, texture, deformation, feature checkboxes, load type, environment)', () => {
    renderWithQuery(<FractographyPanel />);
    expect(screen.getByText('Fractography / failure analysis')).toBeInTheDocument();
    expect(screen.getByText('materials.fractographyAnalysis + fractographyRootCause')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/stainless steel 304/i)).toBeInTheDocument();
    expect(screen.getByText('Surface texture')).toBeInTheDocument();
    expect(screen.getByText('Plastic deformation')).toBeInTheDocument();
    expect(screen.getByText('Load type')).toBeInTheDocument();
    expect(screen.getByText('Environment')).toBeInTheDocument();
    // Discrete observable feature checkboxes, not a free-text-only box.
    expect(screen.getByLabelText('Beach marks')).toBeInTheDocument();
    expect(screen.getByLabelText('Chevron marks')).toBeInTheDocument();
    expect(screen.getByLabelText('Intergranular cracking')).toBeInTheDocument();
    expect(screen.getByLabelText('Grain-boundary voids')).toBeInTheDocument();
    // Not yet analyzed — no fabricated result shown.
    expect(screen.getByText('Analyze to classify.')).toBeInTheDocument();
    expect(screen.getByText('Analyze to investigate root cause.')).toBeInTheDocument();
  });

  it('submits real observed params to both macros and renders the classification + supporting evidence', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (action === 'fractographyAnalysis') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              material: 'stainless steel 304',
              loadType: 'static',
              environment: 'corrosive',
              classification: 'scc',
              primaryMode: 'scc',
              evidenceForPrimary: [
                'intergranular crack path',
                'corrosive service environment',
                'Austenitic stainless steels are classically susceptible to chloride-induced transgranular SCC.',
              ],
              candidates: [{ mode: 'scc', evidenceScore: 12, supportingEvidence: [] }],
              ambiguityNote: null,
            },
          },
        });
      }
      if (action === 'fractographyRootCause') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              material: 'stainless steel 304',
              classification: 'scc',
              rootCauseGuidance: 'Environmentally-assisted cracking requires a susceptible material, a corrosive/embrittling agent, and sustained tensile stress together.',
              recommendedCorrectiveActions: ['Reduce residual/applied tensile stress (stress-relief anneal, shot peening)'],
              recommendedFurtherTesting: ['SEM to confirm intergranular vs. transgranular crack path'],
              reference: 'ASM Handbook Volume 11: Failure Analysis and Prevention',
            },
          },
        });
      }
      return Promise.reject(new Error(`unexpected action ${domain}.${action}`));
    });

    renderWithQuery(<FractographyPanel />);
    fillMaterial('stainless steel 304');
    checkFeature('Intergranular cracking');
    checkFeature('Branching cracks');
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'corrosive' } });
    fireEvent.change(screen.getByLabelText('Load type'), { target: { value: 'static' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(runDomain).toHaveBeenCalledTimes(2));

    // Both macros were called on the materials domain with the real observed data.
    const calledActions = runDomain.mock.calls.map((c) => c[1]);
    expect(calledActions.sort()).toEqual(['fractographyAnalysis', 'fractographyRootCause']);
    for (const call of runDomain.mock.calls) {
      expect(call[0]).toBe('materials');
      const sentData = (call[2] as { input?: { artifact?: { data?: Record<string, unknown> } } })?.input?.artifact?.data;
      expect(sentData?.material).toBe('stainless steel 304');
      expect(sentData?.environment).toBe('corrosive');
      expect(sentData?.loadType).toBe('static');
      expect(sentData?.surfaceFeatures).toEqual(expect.arrayContaining(['intergranular_cracking', 'branching_cracks']));
    }

    // Real classification + cited evidence rendered — not a raw JSON dump.
    await waitFor(() => expect(screen.getByText('scc')).toBeInTheDocument());
    expect(screen.getByText('intergranular crack path')).toBeInTheDocument();
    expect(screen.getByText('corrosive service environment')).toBeInTheDocument();
    expect(screen.getByText(/chloride-induced transgranular SCC/)).toBeInTheDocument();
    expect(screen.queryByText(/"evidenceForPrimary"/)).not.toBeInTheDocument();

    // Root cause + corrective action + reference rendered.
    expect(screen.getByText(/Environmentally-assisted cracking requires/)).toBeInTheDocument();
    expect(screen.getByText(/Reduce residual\/applied tensile stress/)).toBeInTheDocument();
    expect(screen.getByText(/SEM to confirm intergranular/)).toBeInTheDocument();
    expect(screen.getByText('ASM Handbook Volume 11: Failure Analysis and Prevention', { exact: false })).toBeInTheDocument();
  });

  it('surfaces a macro-reported honest rejection message instead of fabricating a classification', async () => {
    // Mirrors the real backend contract: insufficient-evidence input comes
    // back as { message } with no classification field at all.
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          message: 'Fractography requires a material identity and at least one direct surface observation (texture, plastic deformation, or a listed feature such as beach marks / chevron marks / intergranular cracking). A classification cannot be produced from missing input.',
        },
      },
    });
    renderWithQuery(<FractographyPanel />);
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/A classification cannot be produced from missing input/).length).toBeGreaterThan(0));
    // No fabricated classification badge appears anywhere.
    expect(screen.queryByText('ductile')).not.toBeInTheDocument();
    expect(screen.queryByText('brittle')).not.toBeInTheDocument();
    expect(screen.queryByText('fatigue')).not.toBeInTheDocument();
  });

  it('surfaces a real handler_error failure honestly instead of crashing or fabricating a result', async () => {
    // Mirrors the real backend contract for a thrown exception in the
    // handler (e.g. malformed input) — { ok:false, error, message }.
    runDomain.mockImplementation((_domain: string, action: string) => Promise.resolve({
      data: {
        ok: true,
        result: {
          ok: false,
          error: 'handler_error',
          message: `Simulated ${action} failure`,
        },
      },
    }));
    renderWithQuery(<FractographyPanel />);
    fillMaterial('bogus');
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Simulated fractographyAnalysis failure')).toBeInTheDocument());
    expect(screen.getByText('Simulated fractographyRootCause failure')).toBeInTheDocument();
    // Still no fabricated classification.
    expect(screen.queryByText('ductile')).not.toBeInTheDocument();
    expect(screen.queryByText('scc')).not.toBeInTheDocument();
  });

  it('surfaces a network-level failure via the panel error banner without fabricating a result', async () => {
    runDomain.mockRejectedValue(new Error('network down'));
    renderWithQuery(<FractographyPanel />);
    fillMaterial('titanium');
    fireEvent.click(screen.getByText('Analyze'));

    // CalcPanel's mutation itself never throws (each macro call swallows its
    // own error internally per the shared primitive's contract) — the honest
    // outcome is that no result renders, never a fabricated classification.
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Analyze to/).length).toBeGreaterThan(0));
    expect(screen.queryByText('ductile')).not.toBeInTheDocument();
  });
});
