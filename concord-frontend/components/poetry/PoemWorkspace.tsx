'use client';

/**
 * PoemWorkspace — a personal poetry notebook: write and save poems,
 * then run built-in prosody analysis (meter, rhyme scheme, detected
 * form). Wires the poetry.poem-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Feather, Plus, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PoemMeta { id: string; title: string; form: string; status: string; lineCount: number }
interface Poem { id: string; title: string; body: string; form: string; status: string }
interface Analysis {
  lineCount: number; syllablesPerLine: number[]; avgSyllables: number;
  meterConsistency: string; rhymeScheme: string; rhyming: boolean; wordCount: number; detectedForm: string;
}

const FORMS = ['free-verse', 'sonnet', 'haiku', 'limerick', 'villanelle', 'tercet', 'ode'];
const STATUSES = ['draft', 'revising', 'finished'];

export function PoemWorkspace() {
  const [poems, setPoems] = useState<PoemMeta[]>([]);
  const [active, setActive] = useState<Poem | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ title: '', body: '', form: 'free-verse' });

  const refresh = useCallback(async () => {
    const r = await lensRun('poetry', 'poem-list', {});
    setPoems((r.data?.result?.poems as PoemMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function open(id: string) {
    const r = await lensRun('poetry', 'poem-detail', { id });
    if (r.data?.ok) {
      const p = r.data.result?.poem as Poem;
      setActive(p);
      setDraft({ title: p.title, body: p.body, form: p.form });
      setAnalysis(null);
    }
  }
  function newPoem() { setActive(null); setDraft({ title: '', body: '', form: 'free-verse' }); setAnalysis(null); }

  async function save() {
    if (!draft.title.trim()) return;
    if (active) {
      await lensRun('poetry', 'poem-update', { id: active.id, ...draft });
    } else {
      const r = await lensRun('poetry', 'poem-create', draft);
      if (r.data?.ok) setActive(r.data.result?.poem as Poem);
    }
    await refresh();
  }
  async function del(id: string) {
    await lensRun('poetry', 'poem-delete', { id });
    if (active?.id === id) newPoem();
    await refresh();
  }
  async function setStatus(status: string) {
    if (!active) return;
    await lensRun('poetry', 'poem-update', { id: active.id, status });
    setActive({ ...active, status });
    await refresh();
  }
  async function analyze() {
    if (!active) return;
    if (draft.body !== active.body || draft.title !== active.title) await save();
    const r = await lensRun('poetry', 'poem-analyze', { id: active.id });
    if (r.data?.ok) setAnalysis(r.data.result?.analysis as Analysis);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Feather className="w-4 h-4 text-violet-300" />
        <h3 className="text-sm font-bold text-zinc-100">Poem Workspace</h3>
        <button onClick={newPoem} className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New poem
        </button>
      </div>

      <div className="grid sm:grid-cols-[170px_1fr] gap-3">
        <ul className="space-y-1">
          {poems.length === 0 && <li className="text-[11px] text-zinc-400 italic">No poems yet.</li>}
          {poems.map(p => (
            <li key={p.id} className="group flex items-center gap-1">
              <button onClick={() => open(p.id)}
                className={cn('flex-1 text-left rounded-lg px-2 py-1.5 border', active?.id === p.id ? 'bg-violet-600/15 border-violet-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                <p className="text-[11px] font-semibold text-zinc-100 truncate">{p.title}</p>
                <p className="text-[9px] text-zinc-400">{p.form} · {p.lineCount} lines · {p.status}</p>
              </button>
              <button aria-label="Delete" onClick={() => del(p.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>

        <div>
          <div className="flex gap-1.5 mb-1.5">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Poem title"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
            <select value={draft.form} onChange={e => setDraft({ ...draft, form: e.target.value })}
              className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
              {FORMS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={9}
            placeholder="Write your poem — one line per line…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 font-serif leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500" />
          <div className="flex items-center gap-1.5 mt-1.5">
            <button onClick={save} disabled={!draft.title.trim()}
              className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">
              {active ? 'Save' : 'Create'}
            </button>
            <button onClick={analyze} disabled={!active}
              className="px-2.5 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" />Analyze
            </button>
            {active && (
              <select value={active.status} onChange={e => setStatus(e.target.value)}
                className="ml-auto bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>

          {analysis && (
            <div className="mt-2 bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5 text-[11px] text-zinc-300">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span>Lines: <strong className="text-zinc-100">{analysis.lineCount}</strong></span>
                <span>Avg syllables: <strong className="text-zinc-100">{analysis.avgSyllables}</strong></span>
                <span>Meter: <strong className="text-zinc-100">{analysis.meterConsistency}</strong></span>
                <span>Rhyme: <strong className="text-zinc-100">{analysis.rhymeScheme || '—'}</strong></span>
                <span>Detected: <strong className="text-violet-300">{analysis.detectedForm}</strong></span>
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">Syllables/line: {analysis.syllablesPerLine.join(' · ')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
