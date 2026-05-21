'use client';

/* ChemStructureLab — wires the 2026 parity backlog macros:
   parse-smiles, structure-layout, save-structure, list-structures,
   delete-structure, resolve-structure, conformer-3d, stoichiometry,
   spectroscopy-reference, reaction-mechanism, notebook-add/list/delete.
   Every value rendered comes from a real chem-domain macro. */

import { useState, useCallback, useEffect, useRef } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  PenTool, Boxes, Search, Calculator, Activity, Workflow, NotebookPen,
  Loader2, Trash2, Save, RefreshCw, AlertTriangle,
} from 'lucide-react';

// ── shared types ──
interface LayoutAtom { index: number; element: string; aromatic: boolean; x: number; y: number }
interface LayoutBond { from: number; to: number; order: number; ring: boolean }
interface StructureLayout { smiles: string; formula: string; atoms: LayoutAtom[]; bonds: LayoutBond[] }
interface SavedStructure { id: string; name: string; smiles: string; formula: string; heavyAtomCount: number; createdAt: string }
interface Conformer3DAtom { element: string; x: number; y: number; z: number }
interface Conformer3DBond { from: number; to: number; order: number }
interface ResolveResult {
  query: string; cid: number; iupacName: string | null; molecularFormula: string | null;
  molecularWeight: number | null; canonicalSmiles: string | null; isomericSmiles: string | null;
  inchi: string | null; inchiKey: string | null; structureImage: string | null;
}
interface StoichProduct { formula: string; coefficient: number; molarMass: number | null; molesProduced: number; gramsProduced: number | null }
interface StoichResult {
  equation: string; limitingReagent: string; reactionExtent: number;
  suppliedReactants: { formula: string; moles: number; grams: number; molarMass: number | null; coefficient: number }[];
  products: StoichProduct[];
  leftoverReactants: { formula: string; remainingMoles: number; remainingGrams: number }[];
  percentYield: { compound: string; theoreticalMoles: number; actualMoles: number; percent: number } | null;
}
interface SpectroPeak { group: string; range: string; intensity: string; note: string }
interface SpectroResult { technique: string; unit: string; peaks: SpectroPeak[]; peakCount: number; availableTechniques: string[] }
interface MechStep { step: number; title: string; arrows: string[]; bondChanges: string[]; description: string }
interface MechResult { type: string; name: string; summary: string; kinetics: string; steps: MechStep[]; stepCount: number }
interface NotebookEntry {
  id: string; title: string; equation: string | null; procedure: string | null;
  observations: string | null; yieldPercent: number | null; tags: string[]; createdAt: string;
}

type LabTab = 'editor' | 'viewer3d' | 'resolve' | 'stoich' | 'spectro' | 'mechanism' | 'notebook';

const TABS: { id: LabTab; label: string; icon: typeof PenTool }[] = [
  { id: 'editor', label: '2D Editor', icon: PenTool },
  { id: 'viewer3d', label: '3D Viewer', icon: Boxes },
  { id: 'resolve', label: 'SMILES/InChI', icon: Search },
  { id: 'stoich', label: 'Stoichiometry', icon: Calculator },
  { id: 'spectro', label: 'Spectroscopy', icon: Activity },
  { id: 'mechanism', label: 'Mechanisms', icon: Workflow },
  { id: 'notebook', label: 'Lab Notebook', icon: NotebookPen },
];

const ELEMENT_COLOR: Record<string, string> = {
  C: '#5b6b7a', H: '#e5e7eb', O: '#ef4444', N: '#3b82f6', S: '#eab308',
  P: '#f97316', F: '#22c55e', Cl: '#16a34a', Br: '#a3551f', I: '#7c3aed',
};
function elColor(el: string): string { return ELEMENT_COLOR[el] || '#a855f7'; }

const inputCls = 'px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono w-full';
const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100 hover:bg-violet-500/25 transition disabled:opacity-50';

export default function ChemStructureLab() {
  const [tab, setTab] = useState<LabTab>('editor');

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <PenTool className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-gray-200">Structure Lab</h3>
        <span className="text-[10px] text-gray-500">draw · render · resolve · analyze</span>
      </div>

      <nav className="flex items-center gap-1 flex-wrap border-b border-white/10 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition ${
                active ? 'bg-violet-500/15 text-violet-200 border border-violet-500/40'
                       : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'editor' && <StructureEditorTab />}
      {tab === 'viewer3d' && <Viewer3DTab />}
      {tab === 'resolve' && <ResolveTab />}
      {tab === 'stoich' && <StoichTab />}
      {tab === 'spectro' && <SpectroTab />}
      {tab === 'mechanism' && <MechanismTab />}
      {tab === 'notebook' && <NotebookTab />}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 2D structure editor — structure-layout + parse-smiles + save/list/delete
// ─────────────────────────────────────────────────────────────
function StructureEditorTab() {
  const [smiles, setSmiles] = useState('CC(=O)Oc1ccccc1C(=O)O');
  const [layout, setLayout] = useState<StructureLayout | null>(null);
  const [parsed, setParsed] = useState<{ formula: string; molecularWeight: number | null; ringCount: number; aromatic: boolean; heavyAtomCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Aspirin');
  const [saved, setSaved] = useState<SavedStructure[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await lensRun<{ structures: SavedStructure[] }>('chem', 'list-structures', {});
    if (r.data.ok && r.data.result) setSaved(r.data.result.structures);
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const render = useCallback(async (smi: string) => {
    setError(null); setBusy(true); setSaveMsg(null);
    try {
      const [lay, par] = await Promise.all([
        lensRun<StructureLayout>('chem', 'structure-layout', { smiles: smi }),
        lensRun<{ formula: string; molecularWeight: number | null; ringCount: number; aromatic: boolean; heavyAtomCount: number }>('chem', 'parse-smiles', { smiles: smi }),
      ]);
      if (lay.data.ok && lay.data.result) setLayout(lay.data.result);
      else { setLayout(null); setError(lay.data.error || 'Could not lay out structure'); }
      if (par.data.ok && par.data.result) setParsed(par.data.result);
      else setParsed(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { render('CC(=O)Oc1ccccc1C(=O)O'); }, [render]);

  const save = async () => {
    setSaveMsg(null);
    const r = await lensRun<SavedStructure>('chem', 'save-structure', { smiles, name });
    if (r.data.ok) { setSaveMsg('Saved'); loadSaved(); }
    else setSaveMsg(r.data.error || 'Save failed');
  };

  const del = async (id: string) => {
    const r = await lensRun('chem', 'delete-structure', { id });
    if (r.data.ok) loadSaved();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Type a SMILES string — the backend lays out skeletal 2D coordinates and derives the formula. Try <code className="text-violet-300">CCO</code>, <code className="text-violet-300">c1ccccc1</code>, <code className="text-violet-300">CC(=O)O</code>.
      </p>
      <div className="flex gap-2">
        <input value={smiles} onChange={(e) => setSmiles(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') render(smiles); }}
          placeholder="SMILES" className={inputCls} />
        <button type="button" onClick={() => render(smiles)} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Render
        </button>
      </div>

      {error && <p className="text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {layout && <StructureCanvas layout={layout} />}

      {parsed && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { l: 'Formula', v: parsed.formula },
            { l: 'MW', v: parsed.molecularWeight != null ? `${parsed.molecularWeight}` : '—' },
            { l: 'Heavy atoms', v: `${parsed.heavyAtomCount}` },
            { l: 'Rings', v: `${parsed.ringCount}` },
            { l: 'Aromatic', v: parsed.aromatic ? 'yes' : 'no' },
          ].map((s) => (
            <div key={s.l} className="rounded border border-violet-500/20 bg-violet-500/5 p-2 text-center">
              <p className="text-sm font-mono text-violet-300">{s.v}</p>
              <p className="text-[10px] text-gray-500">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end pt-2 border-t border-white/10">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Structure name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <button type="button" onClick={save} disabled={!smiles} className={btnCls}>
          <Save className="w-3 h-3" /> Save
        </button>
        {saveMsg && <span className="text-[11px] text-gray-400 pb-1.5">{saveMsg}</span>}
      </div>

      {saved.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Saved structures ({saved.length})</p>
          {saved.map((s) => (
            <div key={s.id} className="flex items-center gap-2 text-xs rounded border border-white/10 bg-black/30 px-2 py-1.5">
              <span className="text-gray-200">{s.name}</span>
              <span className="font-mono text-violet-300">{s.formula}</span>
              <button type="button" onClick={() => { setSmiles(s.smiles); setName(s.name); render(s.smiles); }}
                className="ml-auto text-violet-300 hover:text-violet-200">open</button>
              <button type="button" onClick={() => del(s.id)} className="text-rose-400 hover:text-rose-300" aria-label="Delete structure">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StructureCanvas({ layout }: { layout: StructureLayout }) {
  const xs = layout.atoms.map((a) => a.x);
  const ys = layout.atoms.map((a) => a.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 40;
  const w = Math.max(60, maxX - minX) + pad * 2;
  const h = Math.max(60, maxY - minY) + pad * 2;
  const tx = (x: number) => x - minX + pad;
  const ty = (y: number) => y - minY + pad;

  return (
    <div className="rounded border border-violet-500/20 bg-black/40 p-2 overflow-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 320 }}>
        {layout.bonds.map((b, i) => {
          const a1 = layout.atoms[b.from], a2 = layout.atoms[b.to];
          if (!a1 || !a2) return null;
          const x1 = tx(a1.x), y1 = ty(a1.y), x2 = tx(a2.x), y2 = ty(a2.y);
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const ox = (-dy / len) * 3, oy = (dx / len) * 3;
          const lines = [];
          if (b.order >= 2) {
            lines.push(<line key={`${i}a`} x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy} stroke="#a78bfa" strokeWidth={1.6} />);
            lines.push(<line key={`${i}b`} x1={x1 - ox} y1={y1 - oy} x2={x2 - ox} y2={y2 - oy} stroke="#a78bfa" strokeWidth={1.6} />);
          } else {
            lines.push(<line key={`${i}c`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={b.ring ? '#7c3aed' : '#8b8b9a'} strokeWidth={1.8} />);
          }
          if (b.order === 3) {
            lines.push(<line key={`${i}d`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a78bfa" strokeWidth={1.6} />);
          }
          return <g key={i}>{lines}</g>;
        })}
        {layout.atoms.map((a) => (
          <g key={a.index}>
            <circle cx={tx(a.x)} cy={ty(a.y)} r={a.element === 'C' ? 5 : 9}
              fill={elColor(a.element)} stroke={a.aromatic ? '#fbbf24' : '#0d1117'} strokeWidth={a.aromatic ? 1.5 : 1} />
            {a.element !== 'C' && (
              <text x={tx(a.x)} y={ty(a.y) + 3} textAnchor="middle" fontSize={9} fontWeight="bold"
                fill={a.element === 'H' ? '#111' : '#fff'}>{a.element}</text>
            )}
          </g>
        ))}
      </svg>
      <p className="text-[10px] text-gray-500 text-center mt-1">
        {layout.formula} · {layout.atoms.length} heavy atoms · {layout.bonds.length} bonds
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 3D viewer — resolve-structure (name → CID) + conformer-3d
// ─────────────────────────────────────────────────────────────
function Viewer3DTab() {
  const [query, setQuery] = useState('caffeine');
  const [cid, setCid] = useState<number | null>(null);
  const [atoms, setAtoms] = useState<Conformer3DAtom[]>([]);
  const [bonds, setBonds] = useState<Conformer3DBond[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rot, setRot] = useState(0);
  const rafRef = useRef<number | null>(null);

  const load = useCallback(async (q: string) => {
    setError(null); setBusy(true); setAtoms([]); setBonds([]);
    try {
      const res = await lensRun<ResolveResult>('chem', 'resolve-structure', { query: q });
      if (!res.data.ok || !res.data.result) { setError(res.data.error || 'No PubChem match'); setBusy(false); return; }
      const found = res.data.result.cid;
      setCid(found);
      const conf = await lensRun<{ cid: number; atomCount: number; atoms: Conformer3DAtom[]; bonds: Conformer3DBond[] }>('chem', 'conformer-3d', { cid: found });
      if (conf.data.ok && conf.data.result) { setAtoms(conf.data.result.atoms); setBonds(conf.data.result.bonds); }
      else setError(conf.data.error || 'No 3D conformer available');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load('caffeine'); }, [load]);

  useEffect(() => {
    if (atoms.length === 0) return;
    const tick = () => { setRot((r) => r + 0.012); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [atoms.length]);

  // project rotated 3D coords to 2D
  const project = (a: Conformer3DAtom) => {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const x = a.x * cos - a.z * sin;
    const z = a.x * sin + a.z * cos;
    return { x, y: a.y, depth: z };
  };
  const projected = atoms.map(project);
  const cx2 = projected.length ? projected.reduce((s, p) => s + p.x, 0) / projected.length : 0;
  const cy2 = projected.length ? projected.reduce((s, p) => s + p.y, 0) / projected.length : 0;
  const span = projected.length
    ? Math.max(2, ...projected.flatMap((p) => [Math.abs(p.x - cx2), Math.abs(p.y - cy2)]))
    : 2;
  const scale = 120 / span;
  const sx = (p: { x: number }) => (p.x - cx2) * scale + 160;
  const sy = (p: { y: number }) => (p.y - cy2) * -scale + 160;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Look up a compound by name on PubChem and render its free 3D conformer record. Auto-rotates.
      </p>
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(query); }}
          placeholder="compound name (caffeine, aspirin, glucose…)" className={inputCls} />
        <button type="button" onClick={() => load(query)} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Boxes className="w-3 h-3" />} Load 3D
        </button>
      </div>

      {error && <p className="text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {atoms.length > 0 && (
        <div className="rounded border border-violet-500/20 bg-black/50 p-2">
          <svg viewBox="0 0 320 320" className="w-full mx-auto" style={{ maxHeight: 340 }}>
            {bonds.map((b, i) => {
              const a1 = projected[b.from], a2 = projected[b.to];
              if (!a1 || !a2) return null;
              return <line key={i} x1={sx(a1)} y1={sy(a1)} x2={sx(a2)} y2={sy(a2)} stroke="#6b7280" strokeWidth={2} />;
            })}
            {atoms
              .map((a, i) => ({ a, p: projected[i] }))
              .sort((u, v) => u.p.depth - v.p.depth)
              .map(({ a, p }, i) => {
                const r = (a.element === 'H' ? 5 : 9) * (1 + p.depth * 0.04);
                return (
                  <g key={i}>
                    <circle cx={sx(p)} cy={sy(p)} r={Math.max(3, r)} fill={elColor(a.element)}
                      stroke="#0d1117" strokeWidth={1} opacity={0.92} />
                    {a.element !== 'C' && a.element !== 'H' && (
                      <text x={sx(p)} y={sy(p) + 3} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#fff">{a.element}</text>
                    )}
                  </g>
                );
              })}
          </svg>
          <p className="text-[10px] text-gray-500 text-center mt-1">
            CID {cid} · {atoms.length} atoms · {bonds.length} bonds (PubChem 3D conformer)
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SMILES/InChI resolver — resolve-structure
// ─────────────────────────────────────────────────────────────
function ResolveTab() {
  const [query, setQuery] = useState('ibuprofen');
  const [bySmiles, setBySmiles] = useState(false);
  const [res, setRes] = useState<ResolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = useCallback(async (q: string, smi: boolean) => {
    setError(null); setBusy(true); setRes(null);
    try {
      const r = await lensRun<ResolveResult>('chem', 'resolve-structure', { query: q, bySmiles: smi });
      if (r.data.ok && r.data.result) setRes(r.data.result);
      else setError(r.data.error || 'No match');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { resolve('ibuprofen', false); }, [resolve]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Resolve a compound name or SMILES to canonical SMILES, InChI, InChIKey and IUPAC name via PubChem PUG-REST.
      </p>
      <div className="flex gap-2 items-center">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') resolve(query, bySmiles); }}
          placeholder={bySmiles ? 'SMILES e.g. CCO' : 'compound name'} className={inputCls} />
        <label className="flex items-center gap-1 text-[11px] text-gray-400 whitespace-nowrap">
          <input type="checkbox" checked={bySmiles} onChange={(e) => setBySmiles(e.target.checked)} />
          by SMILES
        </label>
        <button type="button" onClick={() => resolve(query, bySmiles)} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Resolve
        </button>
      </div>

      {error && <p className="text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {res && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 space-y-2 text-xs">
          {([
            ['IUPAC name', res.iupacName],
            ['Molecular formula', res.molecularFormula],
            ['Molecular weight', res.molecularWeight != null ? `${res.molecularWeight} g/mol` : null],
            ['CID', `${res.cid}`],
            ['Canonical SMILES', res.canonicalSmiles],
            ['Isomeric SMILES', res.isomericSmiles],
            ['InChI', res.inchi],
            ['InChIKey', res.inchiKey],
          ] as [string, string | null][]).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-gray-500 w-32 shrink-0">{k}</span>
              <span className="font-mono text-gray-200 break-all">{v || '—'}</span>
            </div>
          ))}
          {res.structureImage && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={res.structureImage} alt={`Structure of ${res.query}`}
              className="mt-2 rounded bg-white p-1 max-h-44" />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stoichiometry — stoichiometry macro
// ─────────────────────────────────────────────────────────────
function StoichTab() {
  const [equation, setEquation] = useState('2H2 + O2 -> 2H2O');
  const [amounts, setAmounts] = useState('H2:4, O2:40');
  const [actual, setActual] = useState('H2O:30');
  const [res, setRes] = useState<StoichResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compute = async () => {
    setError(null); setBusy(true); setRes(null);
    try {
      const amt: Record<string, { grams: number }> = {};
      amounts.split(',').forEach((part) => {
        const [f, g] = part.split(':').map((s) => s.trim());
        if (f && g && Number.isFinite(Number(g))) amt[f] = { grams: Number(g) };
      });
      const input: Record<string, unknown> = { equation, amounts: amt };
      const ay = actual.trim();
      if (ay.includes(':')) {
        const [c, g] = ay.split(':').map((s) => s.trim());
        if (c && Number.isFinite(Number(g))) input.actualYield = { compound: c, grams: Number(g) };
      }
      const r = await lensRun<StoichResult>('chem', 'stoichiometry', input);
      if (r.data.ok && r.data.result) setRes(r.data.result);
      else setError(r.data.error || 'Failed');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Balanced equation + reactant amounts → limiting reagent, theoretical yield, leftovers and percent yield.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Balanced equation</span>
        <input value={equation} onChange={(e) => setEquation(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Amounts (formula:grams)</span>
          <input value={amounts} onChange={(e) => setAmounts(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-500">Actual yield (optional)</span>
          <input value={actual} onChange={(e) => setActual(e.target.value)} className={inputCls} />
        </label>
      </div>
      <button type="button" onClick={compute} disabled={busy} className={btnCls}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />} Compute
      </button>

      {error && <p className="text-xs text-rose-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{error}</p>}

      {res && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap gap-2">
            <span className="rounded bg-amber-500/20 text-amber-300 px-2 py-1">
              Limiting reagent: <b>{res.limitingReagent}</b>
            </span>
            <span className="rounded bg-violet-500/20 text-violet-300 px-2 py-1">
              Reaction extent: {res.reactionExtent} mol
            </span>
            {res.percentYield && (
              <span className="rounded bg-emerald-500/20 text-emerald-300 px-2 py-1">
                {res.percentYield.compound} yield: {res.percentYield.percent}%
              </span>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Theoretical product yield</p>
            {res.products.map((p) => (
              <div key={p.formula} className="flex justify-between rounded border border-white/10 bg-black/30 px-2 py-1">
                <span className="font-mono text-gray-200">{p.coefficient} {p.formula}</span>
                <span className="font-mono text-violet-300">
                  {p.molesProduced} mol{p.gramsProduced != null ? ` · ${p.gramsProduced} g` : ''}
                </span>
              </div>
            ))}
          </div>
          {res.leftoverReactants.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Leftover reactants</p>
              {res.leftoverReactants.map((l) => (
                <div key={l.formula} className="flex justify-between rounded border border-white/10 bg-black/30 px-2 py-1">
                  <span className="font-mono text-gray-200">{l.formula}</span>
                  <span className="font-mono text-gray-400">{l.remainingMoles} mol · {l.remainingGrams} g</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Spectroscopy reference — spectroscopy-reference macro
// ─────────────────────────────────────────────────────────────
function SpectroTab() {
  const [technique, setTechnique] = useState('ir');
  const [filter, setFilter] = useState('');
  const [res, setRes] = useState<SpectroResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (tech: string, grp: string) => {
    setError(null);
    const r = await lensRun<SpectroResult>('chem', 'spectroscopy-reference', { technique: tech, group: grp });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setError(r.data.error || 'Failed'); }
  }, []);

  useEffect(() => { load('ir', ''); }, [load]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">Characteristic peak reference tables for IR, ¹H/¹³C NMR and MS.</p>
      <div className="flex gap-2">
        <select value={technique}
          onChange={(e) => { setTechnique(e.target.value); load(e.target.value, filter); }}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="ir">Infrared (IR)</option>
          <option value="nmr-1h">¹H NMR</option>
          <option value="nmr-13c">¹³C NMR</option>
          <option value="ms">Mass Spectrometry</option>
        </select>
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(technique, filter); }}
          placeholder="filter group (e.g. carbonyl)" className={inputCls} />
        <button type="button" onClick={() => load(technique, filter)} className={btnCls}>
          <Activity className="w-3 h-3" /> Apply
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {res && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3">
          <p className="text-xs text-gray-300 mb-2">{res.technique} · {res.peakCount} peaks · {res.unit}</p>
          <div className="space-y-1">
            {res.peaks.map((p) => (
              <div key={p.group} className="grid grid-cols-[1fr_auto] gap-2 text-xs rounded border border-white/10 bg-black/30 px-2 py-1.5">
                <span className="text-gray-200">{p.group}</span>
                <span className="font-mono text-violet-300">{p.range} {res.unit}</span>
                <span className="text-[10px] text-gray-500 col-span-2">{p.intensity !== '—' ? `${p.intensity} — ` : ''}{p.note}</span>
              </div>
            ))}
            {res.peaks.length === 0 && <p className="text-xs text-gray-500">No peaks match that filter.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Reaction mechanism — reaction-mechanism macro
// ─────────────────────────────────────────────────────────────
function MechanismTab() {
  const [available, setAvailable] = useState<{ key: string; name: string }[]>([]);
  const [type, setType] = useState('sn2');
  const [mech, setMech] = useState<MechResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await lensRun<{ available: { key: string; name: string }[] }>('chem', 'reaction-mechanism', {});
      if (r.data.ok && r.data.result) setAvailable(r.data.result.available);
    })();
  }, []);

  const load = useCallback(async (t: string) => {
    setError(null);
    const r = await lensRun<MechResult>('chem', 'reaction-mechanism', { type: t });
    if (r.data.ok && r.data.result) setMech(r.data.result);
    else { setMech(null); setError(r.data.error || 'Failed'); }
  }, []);

  useEffect(() => { load('sn2'); }, [load]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">Electron-pushing / curved-arrow step outlines for named reaction mechanisms.</p>
      <div className="flex flex-wrap gap-1">
        {available.map((m) => (
          <button key={m.key} type="button" onClick={() => { setType(m.key); load(m.key); }}
            className={`px-2 py-1 text-xs rounded transition ${
              type === m.key ? 'bg-violet-500/15 text-violet-200 border border-violet-500/40'
                             : 'text-gray-400 hover:text-gray-200 border border-white/10'
            }`}>
            {m.key.toUpperCase()}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {mech && (
        <div className="space-y-3">
          <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3">
            <p className="text-sm text-gray-200 font-semibold">{mech.name}</p>
            <p className="text-xs text-gray-400 mt-1">{mech.summary}</p>
            <p className="text-[11px] text-violet-300 mt-1 font-mono">{mech.kinetics}</p>
          </div>
          <div className="space-y-2">
            {mech.steps.map((s) => (
              <div key={s.step} className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-xs font-semibold text-gray-200">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 mr-2">{s.step}</span>
                  {s.title}
                </p>
                <p className="text-[11px] text-gray-400 mt-1.5">{s.description}</p>
                {s.arrows.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Curved arrows</p>
                    {s.arrows.map((a, i) => (
                      <p key={i} className="text-[11px] text-cyan-300 font-mono">↪ {a}</p>
                    ))}
                  </div>
                )}
                {s.bondChanges.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.bondChanges.map((b, i) => (
                      <span key={i} className="text-[10px] rounded bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5">{b}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Lab notebook — notebook-add / notebook-list / notebook-delete
// ─────────────────────────────────────────────────────────────
function NotebookTab() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [title, setTitle] = useState('');
  const [equation, setEquation] = useState('');
  const [procedure, setProcedure] = useState('');
  const [observations, setObservations] = useState('');
  const [yieldPercent, setYieldPercent] = useState('');
  const [tags, setTags] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    const r = await lensRun<{ entries: NotebookEntry[] }>('chem', 'notebook-list', q ? { query: q } : {});
    if (r.data.ok && r.data.result) setEntries(r.data.result.entries);
  }, []);

  useEffect(() => { load(''); }, [load]);

  const add = async () => {
    setError(null);
    if (!title.trim()) { setError('Title required'); return; }
    const input: Record<string, unknown> = { title, equation, procedure, observations };
    if (yieldPercent && Number.isFinite(Number(yieldPercent))) input.yieldPercent = Number(yieldPercent);
    if (tags.trim()) input.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('chem', 'notebook-add', input);
    if (r.data.ok) {
      setTitle(''); setEquation(''); setProcedure(''); setObservations(''); setYieldPercent(''); setTags('');
      load(query);
    } else setError(r.data.error || 'Add failed');
  };

  const del = async (id: string) => {
    const r = await lensRun('chem', 'notebook-delete', { id });
    if (r.data.ok) load(query);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">Log reactions: equation, procedure, observations, yield and tags.</p>
      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reaction title *" className={inputCls} />
        <input value={equation} onChange={(e) => setEquation(e.target.value)} placeholder="Equation (optional)" className={inputCls} />
        <textarea value={procedure} onChange={(e) => setProcedure(e.target.value)} placeholder="Procedure" rows={2}
          className={inputCls + ' resize-y'} />
        <textarea value={observations} onChange={(e) => setObservations(e.target.value)} placeholder="Observations" rows={2}
          className={inputCls + ' resize-y'} />
        <div className="grid grid-cols-2 gap-2">
          <input type="number" value={yieldPercent} onChange={(e) => setYieldPercent(e.target.value)}
            placeholder="Yield %" className={inputCls} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma-sep" className={inputCls} />
        </div>
        <button type="button" onClick={add} className={btnCls}>
          <NotebookPen className="w-3 h-3" /> Add entry
        </button>
        {error && <p className="text-xs text-rose-300">{error}</p>}
      </div>

      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(query); }}
          placeholder="search entries" className={inputCls} />
        <button type="button" onClick={() => load(query)} className={btnCls}>
          <Search className="w-3 h-3" /> Search
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">{entries.length} entries</p>
        {entries.length === 0 && <p className="text-xs text-gray-500">No entries yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="rounded border border-white/10 bg-black/30 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-200">{e.title}</span>
              {e.yieldPercent != null && (
                <span className="text-[10px] rounded bg-emerald-500/15 text-emerald-300 px-1.5 py-0.5">{e.yieldPercent}% yield</span>
              )}
              <span className="ml-auto text-[10px] text-gray-500">{new Date(e.createdAt).toLocaleDateString()}</span>
              <button type="button" onClick={() => del(e.id)} className="text-rose-400 hover:text-rose-300" aria-label="Delete entry">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            {e.equation && <p className="text-[11px] font-mono text-violet-300 mt-1">{e.equation}</p>}
            {e.procedure && <p className="text-[11px] text-gray-400 mt-1">{e.procedure}</p>}
            {e.observations && <p className="text-[11px] text-gray-500 mt-1 italic">{e.observations}</p>}
            {e.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {e.tags.map((t) => (
                  <span key={t} className="text-[10px] rounded bg-violet-500/15 text-violet-300 px-1.5 py-0.5">#{t}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
