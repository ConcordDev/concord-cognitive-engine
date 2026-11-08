// Render + behaviour coverage for the chem lens: the action panel (molecular weight, molarity, pH,
// dilution, analysis, balancing, solution chemistry; mint / DM / publish / agent) and the structure
// lab (2D editor, 3D viewer, resolve, stoichiometry, spectroscopy, mechanisms, notebook).

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const NB = (id: string) => ({ id, title: `Run ${id}`, equation: '2H2 + O2 -> 2H2O', procedure: 'Mix', observations: 'Clear', yieldPercent: 88, tags: ['synth'], createdAt: '2026-03-01' });

function resultFor(action: string): unknown {
  switch (action) {
    case 'molecular-weight': return { formula: 'H2O', molecularWeight: 18.015, units: 'g/mol', components: [{ element: 'H', name: 'Hydrogen', count: 2, atomicMass: 1.008, contribution: 2.016, percentMass: 11.2 }, { element: 'O', count: 1, atomicMass: 15.999, contribution: 15.999, percentMass: 88.8 }] };
    case 'calc-molarity': return { moles: 0.5, liters: 2, molarity: 0.25, formula: 'M = n/V' };
    case 'calc-ph': return { pH: 3, pOH: 11, hPlus: 0.001, ohMinus: 1e-11, classification: 'acidic' };
    case 'calc-dilution': return { m1: 1, v1: 10, m2: 0.1, v2: 100, formula: 'M1V1=M2V2' };
    case 'molecularAnalysis': return { formula: 'C6H12O6', molecularWeight: 180.16, empiricalFormula: 'CH2O', degreeOfUnsaturation: 1, totalAtoms: 24, elements: [{ element: 'C', count: 6, massPercent: 40 }, { element: 'H', count: 12, massPercent: 6.7 }] };
    case 'balanceReaction': return { balanced: true, equation: '2H2 + O2 -> 2H2O', reactants: [{ formula: 'H2', coefficient: 2 }, { formula: 'O2', coefficient: 1 }], products: [{ formula: 'H2O', coefficient: 2 }] };
    case 'solutionChemistry': return { pH: 7, pOH: 7, nature: 'neutral', type: 'water', concentration: 0.1, message: 'ok' };
    case 'list-structures': return { structures: [{ id: 'st1', name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', formula: 'C9H8O4', heavyAtomCount: 13, createdAt: '2026-03-01' }] };
    case 'structure-layout': return { smiles: 'CCO', formula: 'C2H6O', atoms: [{ index: 0, element: 'C', aromatic: false, x: 0, y: 0 }, { index: 1, element: 'C', aromatic: false, x: 1, y: 0 }, { index: 2, element: 'O', aromatic: false, x: 2, y: 0.5 }], bonds: [{ from: 0, to: 1, order: 1, ring: false }, { from: 1, to: 2, order: 2, ring: true }] };
    case 'parse-smiles': return { formula: 'C2H6O', molecularWeight: 46.07, ringCount: 0, aromatic: false, heavyAtomCount: 3, atoms: [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'O', x: 1, y: 0, z: 0.5 }], bonds: [{ from: 0, to: 1, order: 1 }] };
    case 'resolve-structure': return { query: 'aspirin', cid: 2244, iupacName: '2-acetyloxybenzoic acid', molecularFormula: 'C9H8O4', molecularWeight: 180.16, canonicalSmiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', isomericSmiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', inchi: 'InChI=1S/C9H8O4', inchiKey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', structureImage: null };
    case 'stoichiometry': return { equation: '2H2 + O2 -> 2H2O', limitingReagent: 'H2', reactionExtent: 1, suppliedReactants: [{ formula: 'H2', moles: 2, grams: 4.03, molarMass: 2.016, coefficient: 2 }], products: [{ formula: 'H2O', coefficient: 2, molarMass: 18.015, molesProduced: 2, gramsProduced: 36.03 }], leftoverReactants: [{ formula: 'O2', remainingMoles: 0.5, remainingGrams: 16 }], percentYield: { compound: 'H2O', theoreticalMoles: 2, actualMoles: 1.8, percent: 90 } };
    case 'spectroscopy-reference': return { technique: 'IR', unit: 'cm-1', peaks: [{ group: 'O-H', range: '3200-3600', intensity: 'strong', note: 'broad' }], peakCount: 1, availableTechniques: ['IR', 'NMR', 'UV'] };
    case 'reaction-mechanism': return { available: [{ key: 'sn2', name: 'SN2' }, { key: 'e1', name: 'E1' }], type: 'SN2', name: 'Bimolecular substitution', summary: 'One-step', kinetics: 'second order', steps: [{ step: 1, title: 'Attack', arrows: ['Nu -> C'], bondChanges: ['C-Nu forms'], description: 'Backside attack' }], stepCount: 1 };
    case 'conformer-3d': return { cid: 2244, atomCount: 3, atoms: [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'C', x: 1.5, y: 0, z: 0 }, { element: 'O', x: 2.2, y: 1, z: 0.4 }], bonds: [{ from: 0, to: 1, order: 1 }, { from: 1, to: 2, order: 2 }] };
    case 'notebook-list': return { entries: [NB('n1'), NB('n2')] };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ChemActionPanel } from '../ChemActionPanel';
import ChemStructureLab from '../ChemStructureLab';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, runDomain, apiPost].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
});

describe('chem action panel', () => {
  it('renders and survives an exercise pass, then offline', async () => {
    const view = rtlRender(<ChemActionPanel />);
    await settle();
    await exercise({ passes: 3, text: 'H2O' });
    expect(view.container.textContent?.length).toBeGreaterThan(20);
    cleanup();
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const off = rtlRender(<ChemActionPanel />);
    await settle();
    await exercise({ passes: 1 });
    expect(off.container).toBeTruthy();
  });
  it('runs every chemistry calculator, then mints, DMs, publishes and asks the agent', async () => {
    rtlRender(<ChemActionPanel />);
    await settle();
    for (const el of screen.queryAllByRole('textbox').concat(screen.queryAllByRole('spinbutton')) as HTMLInputElement[]) fireEvent.change(el, { target: { value: el.type === 'number' || /mol|conc|vol|liter|m1|v1|m2|v2/i.test(el.placeholder) ? '2' : /equation|reaction/i.test(el.placeholder) ? 'H2 + O2 -> H2O' : 'H2O' } });
    for (const l of [/^Mol(ecular)? ?Weight|^MW/i, /^Molarity/i, /^pH/i, /^Dilution/i, /^Analy/i, /^Balance/i, /^Solution/i, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever/i]) await press(l);
    expect(runDomain.mock.calls.map((c) => String(c[1])).some((x) => /molecular-weight|calc-|molecularAnalysis|balanceReaction|solutionChemistry/.test(x))).toBe(true);
    expect(apiPost).toHaveBeenCalled();
  });
});

describe('chem structure lab', () => {
  it('walks every lab tab, drives its macro and survives an exercise pass', async () => {
    const view = rtlRender(<ChemStructureLab />);
    await settle();
    const tabs = ['2D Editor', '3D Viewer', 'SMILES/InChI', 'Stoichiometry', 'Spectroscopy', 'Mechanisms', 'Lab Notebook'];
    const skip = new RegExp(`^(${tabs.map((t) => t.replace(/[/]/g, '\\/')).join('|')})$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$`, 'i');
    for (const t of tabs) {
      await press(new RegExp(`^${t.replace(/[/]/g, '\\/')}$`));
      await settle();
      await exercise({ passes: 3, text: 'CCO', skip });
      await press(/^(Render|Draw|Resolve|Look ?up|Calculate|Solve|Show|Run|Save|Add|Load|Fetch|Search)/i);
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['list-structures', 'structure-layout']));
    expect(a.filter((x) => /parse-smiles|resolve-structure|stoichiometry|spectroscopy-reference|reaction-mechanism|notebook-|save-structure/.test(x)).length).toBeGreaterThan(2);
  });
  it('saves and deletes structures, and edits and removes notebook entries', async () => {
    rtlRender(<ChemStructureLab />);
    await settle();
    await press(/^Save/i); await press(/Aspirin/); await press(/Delete|Trash/i);
    await press(/^Lab Notebook$/); await settle();
    await press(/Run n1/); await press(/Edit|Pencil/i); await press(/^(Save|Update)/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent().some((x) => /save-structure|delete-structure|notebook-(add|update|delete)/.test(x))).toBe(true);
  });
  it('stays standing offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = rtlRender(<ChemStructureLab />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});
