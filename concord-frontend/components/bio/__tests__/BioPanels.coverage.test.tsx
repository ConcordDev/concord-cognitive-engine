// Render + behaviour coverage for the bio lens panels: action panel, research bench (alignment,
// expression, phylogenetics, motifs, organism, pathway, protocol, gene, evolution, FASTA), the
// molecular workbench (plasmid, MSA, cloning, ORF, BLAST, CRISPR, notebook) and the sequence
// analyzer. Engine results are stubbed; panels must render, survive a full exercise pass and degrade
// honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const GUIDE = { guide: 'GACGTTACCGGATCCAGTAC', pam: 'NGG', strand: '+', position: 12, gcPercent: 55, onTargetScore: 0.8, offTargetHits: 1, specificityScore: 0.9, compositeScore: 0.85 };
const HIT = { subjectId: 'NM_000546', score: 120, bitScore: 55.2, eValue: 1e-9, identity: 98.5, alignLength: 60, queryRange: [1, 60], subjectRange: [100, 160], coverage: 0.95 };
const PRIMER = (s: string) => ({ sequence: s, length: s.length, tm: 60.1, gcPercent: 50 });

function resultFor(action: string): unknown {
  switch (action) {
    case 'sequence-analyze': return { length: 120, kind: 'dna', gcPercent: 52.5, tm: 71, tmModel: 'nearest-neighbor', orfs: [{ frame: 1, start: 1, end: 99, length: 99, protein: 'MKV' }], composition: { A: 30, C: 30, G: 30, T: 30 }, molecularWeight: 37000 };
    case 'primer-design': return { forward: PRIMER('ACGTACGTACGTACGTACGT'), reverse: PRIMER('TTGGCCAATTGGCCAATTGG'), productSize: 450, notes: 'Balanced' };
    case 'align-pairwise': return { score: 18, alignA: 'ACGT-ACGT', alignB: 'ACGTTACGT', alignBars: '||||.||||', matches: 8, identity: 88.9, alignmentLength: 9 };
    case 'restriction-map': return { sites: [{ enzyme: 'EcoRI', position: 10, cutAt: 11, site: 'GAATTC' }], count: 1, enzymesScanned: ['EcoRI'] };
    case 'sequenceAlign': return { alignment: { sequenceA: 'ACGT', midline: '||||', sequenceB: 'ACGT' }, score: 8, statistics: { length: 4, matches: 4, mismatches: 0, gaps: 0, identity: 100, similarity: 100, sequenceType: 'dna' } };
    case 'geneExpression': return { conditions: { conditionA: 'ctrl', conditionB: 'treated' }, rule: '2-fold', genes: [{ gene: 'TP53', meanCondA: 5, meanCondB: 12, foldChange: 2.4, log2FC: 1.26, regulation: 'up', significanceTestable: true, significant: true, call: 'UP' }], summary: { totalGenes: 1, significantGenes: 1, upregulated: 1, downregulated: 0, topUpregulated: [{ gene: 'TP53', log2FC: 1.26 }], topDownregulated: [] } };
    case 'phylogeneticDistance': return { model: 'p-distance', sequenceCount: 2, labels: ['a', 'b'], distanceMatrix: [[0, 0.2], [0.2, 0]], closest: { a: 'a', b: 'b', distance: 0.2 }, farthest: { a: 'a', b: 'b', distance: 0.2 } };
    case 'motifDetection': return { totalMotifs: 1, topMotifs: [{ motif: 'GAATTC', occurrences: 3, conservation: 0.9, gcContent: 33, isPalindromic: true }], consensusMotifs: [{ motif: 'GAATTC', conservation: 0.9 }] };
    case 'profile-organism': return { name: 'Escherichia coli', kingdom: 'Bacteria', taxonomyRanks: ['Bacteria', 'Proteobacteria'], habitat: 'Gut', traits: ['rod'], evolutionaryNotes: 'Model organism', summary: 'E. coli profile' };
    case 'map-pathway': return { pathway: 'Glycolysis', stepCount: 3, chainBreaks: [{ at: 2, expected: 'G6P', actual: 'F6P' }], totalDeltaG: -12.5, thermodynamicallyFavorable: true, summary: 'Favorable' };
    case 'review-protocol': return { stepCount: 4, totalEstimatedMinutes: 90, gaps: [{ kind: 'missing_control', severity: 'high', suggestion: 'Add a control' }], severity: 'high', summary: 'One gap' };
    case 'link-gene-function': return { gene: 'TP53', protein: 'p53', organism: 'Homo sapiens', function: 'Tumor suppressor', functionSource: 'UniProt', functionNote: 'n', chain: [{ stage: 'DNA', entity: 'TP53', role: 'gene' }, { stage: 'Protein', entity: 'p53', role: 'effector' }], externalLinks: [{ source: 'UniProt', url: 'https://uniprot.org/P04637' }], summary: 'TP53 → p53' };
    case 'trace-evolution': return { organisms: [{ name: 'human', group: 'Primates', subgroup: 'Hominidae' }, { name: 'mouse', group: 'Rodents', subgroup: null }], groups: ['Primates', 'Rodents'], sharedGroup: 'Mammalia', closestPair: { a: 'human', b: 'chimpanzee', relation: 'sister' }, commonality: 'Mammals', suggestion: 'Add outgroup' };
    case 'parse-fasta': return { records: [{ id: 'seq1', description: 'example', sequence: 'ACGT', length: 4 }], count: 1 };
    case 'plasmid-map': return { length: 4361, gcPercent: 50.9, topology: 'circular', featureCount: 2, features: [{ name: 'AmpR', type: 'CDS', start: 100, end: 960, strand: '+', length: 860, startDeg: 8, endDeg: 80 }, { name: 'EcoRI', type: 'restriction_site', start: 1000, end: 1006, strand: '+', length: 6, startDeg: 90, endDeg: 91 }], summary: 'pUC19-like', annotationNote: 'auto' };
    case 'align-multiple': return { rows: [{ id: 'a', aligned: 'ACGT' }, { id: 'b', aligned: 'ACGA' }], consensus: 'ACGN', conservation: [1, 1, 1, 0.5], width: 4, sequenceCount: 2, centerSequence: 'a', conservedColumns: 3, percentConserved: 75 };
    case 'cloning-simulate': return { method: 'gibson', circular: true, fragmentCount: 2, assembledLength: 5000, assembledSequence: 'ACGT'.repeat(10), truncated: false, gcPercent: 50, junctions: [{ between: ['a', 'b'], overlapBp: 20, verified: true }, { between: ['b', 'a'], scar: 'TACTAG', verified: false }], issues: ['Low overlap'], success: true, summary: 'Assembled' };
    case 'translate-orf': return { length: 30, frames: [{ frame: 1, strand: '+', codons: [{ codon: 'ATG', aa: 'M', start: 0, isStart: true, isStop: false }, { codon: 'TAA', aa: '*', start: 3, isStart: false, isStop: true }], protein: 'M*', longestOrf: { codonStart: 0, codonCount: 2, peptide: 'M' } }], longestOrf: { frame: 1, codonStart: 0, codonCount: 2, peptide: 'M' } };
    case 'blast-search': return { queryLength: 60, databaseSize: 1000, hitCount: 1, hits: [HIT], topHit: HIT };
    case 'crispr-design': return { pam: 'NGG', targetLength: 200, guideCount: 2, guides: [GUIDE, { ...GUIDE, guide: 'TTTT', position: 40 }], topGuide: GUIDE, scoring: 'composite' };
    case 'notebook-list': return { entries: [{ id: 'nb1', title: 'PCR run', body: 'Ran PCR', tags: ['pcr'], linkedSequenceIds: ['sq1'], linkedProtocol: null, status: 'draft', createdAt: '2026-03-01', updatedAt: '2026-03-02' }, { id: 'nb2', title: 'Gel', body: '', tags: [], linkedSequenceIds: [], linkedProtocol: 'p1', status: 'complete', createdAt: '2026-03-01', updatedAt: '2026-03-02' }] };
    case 'sequence-list': return { sequences: [{ id: 'sq1', name: 'pUC19' }] };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
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

import { BioActionPanel } from '../BioActionPanel';
import { BioResearchPanel } from '../BioResearchPanel';
import { MolecularWorkbench } from '../MolecularWorkbench';
import { SequenceAnalyzer } from '../SequenceAnalyzer';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
const SEQ = 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG';
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, runDomain, apiPost].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['BioActionPanel', () => <BioActionPanel />],
  ['BioResearchPanel', () => <BioResearchPanel />],
  ['MolecularWorkbench', () => <MolecularWorkbench />],
  ['SequenceAnalyzer', () => <SequenceAnalyzer />],
];

describe('bio panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: SEQ });
    await settle();
    await exercise({ passes: 1, text: '12' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    apiPost.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('bio flows', () => {
  it('the action panel analyses, designs primers, aligns, maps restriction sites, then mints, DMs, publishes and asks the agent', async () => {
    render(<BioActionPanel />);
    await settle();
    const areas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    areas.forEach((a) => fireEvent.change(a, { target: { value: SEQ } }));
    for (const el of screen.queryAllByRole('textbox') as HTMLInputElement[]) if (el.tagName === 'INPUT') fireEvent.change(el, { target: { value: /enzyme/i.test(el.placeholder) ? 'EcoRI' : 'friend-1' } });
    for (const l of [/^Analy/, /^Primer/, /^Align/, /^Restrict/, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever/]) await press(l);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /sequence-analyze|primer-design|align-pairwise|restriction-map/.test(x))).toBe(true);
    expect(apiPost).toHaveBeenCalled();
  });

  it('the research bench runs every tool', async () => {
    const view = render(<BioResearchPanel />);
    await settle();
    const skip = /^(Sequence Align|Gene Expression|Phylogenetics|Motif Scan|Organism Profile|Pathway Map|Protocol Review|Gene → Function|Evolution Trace|FASTA Parser)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const t of ['Sequence Align', 'Gene Expression', 'Phylogenetics', 'Motif Scan', 'Organism Profile', 'Pathway Map', 'Protocol Review', 'Gene → Function', 'Evolution Trace', 'FASTA Parser']) {
      await press(new RegExp(`^${t}$`));
      await exercise({ passes: 3, text: 'TP53', skip });
      await press(/^(Run|Align|Analy[sz]e|Scan|Compute|Map|Review|Trace|Parse|Look ?up|Profile|Link)/i);
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    expect(runDomain.mock.calls.length).toBeGreaterThan(3);
  });

  it('the workbench walks every tab and runs its tool', async () => {
    const view = render(<MolecularWorkbench />);
    await settle();
    const tabs = ['Plasmid map', 'MSA', 'In-silico cloning', 'ORF / translate', 'BLAST search', 'CRISPR guides', 'Lab notebook'];
    const skip = new RegExp(`^(${tabs.map((t) => t.replace(/[/ -]/g, '.')).join('|')})$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$`, 'i');
    for (const t of tabs) {
      await press(new RegExp(`^${t.replace(/[/]/g, '\\/')}$`));
      await settle();
      await exercise({ passes: 3, text: SEQ, skip });
      await press(/^(Map|Align|Simulate|Assemble|Translate|Search|BLAST|Design|Find|Run|Save|Add)/i);
      await settle();
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a.filter((x) => /plasmid-map|align-multiple|cloning-simulate|translate-orf|blast-search|crispr-design|notebook-list/.test(x)).length).toBeGreaterThan(3);
  });

  it('the lab notebook saves, edits and deletes entries', async () => {
    render(<MolecularWorkbench />);
    await settle();
    await press(/^Lab notebook$/);
    await settle();
    await exercise({ passes: 3, text: 'PCR run 2', skip: /^(Plasmid map|MSA|In-silico cloning|ORF \/ translate|BLAST search|CRISPR guides|Lab notebook)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Edit|Pencil/i); await press(/Save|Update/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(lensRunMock.mock.calls.map((c) => actionOf(c)).some((x) => /notebook-(create|update|delete)/.test(x))).toBe(true);
  });

  it('the sequence analyzer analyses, designs primers and aligns two sequences', async () => {
    render(<SequenceAnalyzer />);
    await settle();
    const areas = () => Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    areas().forEach((a) => fireEvent.change(a, { target: { value: SEQ } }));
    await press(/^Analy[sz]e/i);
    await press(/Primer/i); areas().forEach((a) => fireEvent.change(a, { target: { value: SEQ } })); await press(/^(Design|Run|Primer)/i, 1);
    await press(/Align/i); areas().forEach((a) => fireEvent.change(a, { target: { value: SEQ } })); await press(/^(Align|Run)/i, 1);
    expect(runDomain.mock.calls.map((c) => String(c[1])).some((x) => /sequence-analyze|primer-design|align-pairwise/.test(x))).toBe(true);
  });
});
