'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, Dna, FileText, Scissors, GitMerge, Save, Trash2, Plus,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SavedSequence {
  id: string;
  name: string;
  sequence: string;
  kind: 'dna' | 'rna' | 'protein';
  description: string;
  length: number;
  createdAt: string;
  updatedAt: string;
}

export interface SequenceAnalysis {
  length: number;
  kind: string;
  gcPercent?: number;
  tm?: number;
  orfs?: { frame: number; start: number; end: number; length: number }[];
  molecularWeight?: number;
  composition?: Record<string, number>;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'analyzer' | 'primer' | 'align' | 'restriction' | 'library';

export function BioWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('analyzer');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-emerald-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-emerald-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-gray-200">Bio Workbench</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {([
          { id: 'analyzer',     label: 'Analyzer',     icon: Dna },
          { id: 'primer',       label: 'Primer design', icon: GitMerge },
          { id: 'align',        label: 'Alignment',    icon: GitMerge },
          { id: 'restriction',  label: 'Restriction',  icon: Scissors },
          { id: 'library',      label: 'Library',      icon: FileText },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'analyzer' && <AnalyzerTab />}
        {tab === 'primer' && <PrimerTab />}
        {tab === 'align' && <AlignTab />}
        {tab === 'restriction' && <RestrictionTab />}
        {tab === 'library' && <LibraryTab />}
      </div>
    </div>
  );
}


function AnalyzerTab() {
  const [seq, setSeq] = useState('');
  const [kind, setKind] = useState<'dna' | 'rna' | 'protein'>('dna');
  const [result, setResult] = useState<SequenceAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'bio', action: 'sequence-analyze',
        input: { sequence: seq, kind },
      });
      setResult(((r.data as { result?: SequenceAnalysis }).result) || null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="dna">DNA</option>
          <option value="rna">RNA</option>
          <option value="protein">Protein</option>
        </select>
        <button type="button" onClick={analyze} disabled={loading || !seq.trim()}
          className="px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 disabled:opacity-40">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Analyze'}
        </button>
      </div>

      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4}
        placeholder="Paste sequence here (DNA/RNA/protein)"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />

      {result && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-gray-400">Length</span><p className="text-gray-100 font-mono">{result.length}</p></div>
            {result.gcPercent !== undefined && (
              <div><span className="text-gray-400">GC%</span><p className="text-gray-100 font-mono">{result.gcPercent}</p></div>
            )}
            {result.tm !== undefined && (
              <div><span className="text-gray-400">Tm</span><p className="text-gray-100 font-mono">{result.tm}°C</p></div>
            )}
            {result.molecularWeight && (
              <div><span className="text-gray-400">MW</span><p className="text-gray-100 font-mono">{result.molecularWeight.toLocaleString()} Da</p></div>
            )}
          </div>
          {result.orfs && result.orfs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Open Reading Frames (≥30 aa)</p>
              {result.orfs.map((o, i) => (
                <p key={i} className="text-xs font-mono text-gray-200">
                  Frame {o.frame}: {o.start}–{o.end} ({o.length} bp / {Math.floor(o.length / 3)} aa)
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrimerTab() {
  const [seq, setSeq] = useState('');
  const [length, setLength] = useState(20);
  const [primers, setPrimers] = useState<{
    forward: { sequence: string; tm: number; gcPercent: number; length: number };
    reverse: { sequence: string; tm: number; gcPercent: number; length: number };
    productSize: number;
  } | null>(null);

  const design = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'bio', action: 'primer-design',
        input: { sequence: seq, targetLength: length },
      });
      setPrimers(((r.data as { result?: typeof primers }).result) || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input type="number" value={length} min="18" max="28"
          onChange={(e) => setLength(Number(e.target.value))}
          className="w-24 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <button type="button" onClick={design}
          className="px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100">
          Design primers
        </button>
      </div>

      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4}
        placeholder="Paste a DNA / RNA / protein sequence"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />

      {primers && (
        <div className="space-y-2">
          {[
            { label: 'Forward', data: primers.forward, color: 'emerald' },
            { label: 'Reverse', data: primers.reverse, color: 'cyan' },
          ].map(({ label, data }) => (
            <div key={label} className="rounded border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-400">{label} primer</p>
              <p className="text-sm font-mono text-gray-100 break-all">{data.sequence}</p>
              <div className="flex gap-4 mt-1 text-[11px] text-gray-400 font-mono">
                <span>{data.length} bp</span>
                <span>Tm {data.tm}°C</span>
                <span>GC {data.gcPercent}%</span>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-gray-400">Product size: <span className="font-mono text-gray-300">{primers.productSize} bp</span></p>
        </div>
      )}
    </div>
  );
}

function AlignTab() {
  const [a, setA] = useState('GATTACA');
  const [b, setB] = useState('GCATGCU');
  const [result, setResult] = useState<{
    score: number;
    alignA: string;
    alignB: string;
    alignBars: string;
    identity: number;
    alignmentLength: number;
  } | null>(null);

  const align = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'bio', action: 'align-pairwise',
        input: { seqA: a, seqB: b },
      });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <textarea value={a} onChange={(e) => setA(e.target.value)} placeholder="Sequence A" rows={3}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
        <textarea value={b} onChange={(e) => setB(e.target.value)} placeholder="Sequence B" rows={3}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
      </div>
      <button type="button" onClick={align}
        className="px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100">
        Align (Needleman-Wunsch)
      </button>

      {result && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-gray-400">Score</span><p className="text-gray-100 font-mono">{result.score}</p></div>
            <div><span className="text-gray-400">Identity</span><p className="text-gray-100 font-mono">{result.identity}%</p></div>
            <div><span className="text-gray-400">Length</span><p className="text-gray-100 font-mono">{result.alignmentLength}</p></div>
          </div>
          <pre className="text-[11px] font-mono text-gray-300 mt-2 overflow-x-auto whitespace-pre">
{result.alignA}
{result.alignBars}
{result.alignB}
          </pre>
        </div>
      )}
    </div>
  );
}

function RestrictionTab() {
  const [seq, setSeq] = useState('');
  const [sites, setSites] = useState<{ enzyme: string; position: number; cutAt: number; site: string }[]>([]);

  const map = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'bio', action: 'restriction-map',
        input: { sequence: seq },
      });
      setSites(((r.data as { result?: { sites?: typeof sites } }).result?.sites) || []);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <button type="button" onClick={map}
        className="px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100">
        Map restriction sites
      </button>

      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4}
        placeholder="Paste a DNA / RNA / protein sequence"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />

      {sites.length > 0 ? (
        <div className="border border-white/10 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-black/40 text-gray-400 uppercase text-[10px]">
              <tr><th className="text-left px-2 py-1">Enzyme</th><th className="text-left px-2 py-1">Site</th><th className="text-right px-2 py-1">Pos</th><th className="text-right px-2 py-1">Cut at</th></tr>
            </thead>
            <tbody>
              {sites.map((s, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-2 py-1 text-gray-200">{s.enzyme}</td>
                  <td className="px-2 py-1 text-cyan-300 font-mono">{s.site}</td>
                  <td className="px-2 py-1 text-right font-mono text-gray-300">{s.position}</td>
                  <td className="px-2 py-1 text-right font-mono text-emerald-300">{s.cutAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-4">No sites mapped yet.</p>
      )}
    </div>
  );
}

function LibraryTab() {
  const [seqs, setSeqs] = useState<SavedSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; sequence: string; kind: 'dna' | 'rna' | 'protein'; description: string }>({
    name: '', sequence: '', kind: 'dna', description: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'bio', action: 'sequence-list', input: {} });
      setSeqs(((r.data as { result?: { sequences?: SavedSequence[] } }).result?.sequences) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await api.post('/api/lens/run', { domain: 'bio', action: 'sequence-save', input: draft });
      setCreating(false);
      setDraft({ name: '', sequence: '', kind: 'dna', description: '' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    try {
      await api.post('/api/lens/run', { domain: 'bio', action: 'sequence-delete', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200">
        <Plus className="w-3 h-3" /> Save sequence
      </button>

      {creating && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Name" maxLength={80}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as typeof draft.kind })}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
            <option value="dna">DNA</option><option value="rna">RNA</option><option value="protein">Protein</option>
          </select>
          <textarea value={draft.sequence} onChange={(e) => setDraft({ ...draft, sequence: e.target.value })}
            placeholder="Sequence" rows={3}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
          <input type="text" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description (optional)" maxLength={200}
            className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100" />
          <button type="button" onClick={save} disabled={!draft.name.trim() || !draft.sequence.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-xs text-emerald-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : seqs.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No saved sequences yet.</p>
      ) : (
        seqs.map((s) => (
          <div key={s.id} className="rounded border border-white/10 bg-black/20 p-3 group">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-100">{s.name}</p>
                <p className="text-[10px] uppercase text-gray-400">{s.kind} · {s.length} {s.kind === 'protein' ? 'aa' : 'bp'}</p>
                {s.description && <p className="text-[11px] text-gray-400 mt-1">{s.description}</p>}
                <p className="text-[10px] font-mono text-gray-400 mt-1 truncate">{s.sequence.slice(0, 80)}{s.sequence.length > 80 ? '…' : ''}</p>
              </div>
              <button aria-label="Delete" type="button" onClick={() => remove(s.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default BioWorkbench;
