'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * CBTPanel — guided CBT thought records (Woebot parity). For each of the
 * 8 cognitive-distortion field kinds the panel surfaces the authored
 * Socratic challenge set + reframe scaffold, then walks the user through a
 * thought record (situation -> automatic thought -> evidence -> reframe ->
 * intensity before/after). Wired to wellness.cbt-prompts /
 * cbt-record-create / cbt-record-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Brain, Loader2, Plus, ChevronRight, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface KindStub { fieldKind: string; label: string; distortion: string }
interface KindPrompts { fieldKind: string; label: string; distortion: string; challenges: string[]; reframe: string }
interface ThoughtRecord {
  id: string; number: string; fieldKind: string; distortionLabel: string;
  situation: string; emotion: string; automaticThought: string;
  evidenceFor: string; evidenceAgainst: string; reframe: string;
  intensityBefore: number; intensityAfter: number | null; relief: number | null;
  date: string; at: string;
}
interface RecordList { records: ThoughtRecord[]; total: number; completed: number; avgRelief: number | null }

const EMPTY_FORM = {
  fieldKind: 'binary_thinking', situation: '', emotion: '', automaticThought: '',
  evidenceFor: '', evidenceAgainst: '', reframe: '',
  intensityBefore: 60, intensityAfter: 30,
};

export function CBTPanel() {
  const [kinds, setKinds] = useState<KindStub[]>([]);
  const [prompts, setPrompts] = useState<KindPrompts | null>(null);
  const [list, setList] = useState<RecordList | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const r = await lensRun({ domain: 'wellness', action: 'cbt-record-list', input: { days: 90 } });
    if (r.data?.ok && r.data.result) setList(r.data.result as RecordList);
  }, []);

  const loadKinds = useCallback(async () => {
    setLoading(true);
    const r = await lensRun({ domain: 'wellness', action: 'cbt-prompts', input: {} });
    if (r.data?.ok && r.data.result) setKinds(((r.data.result as any).kinds || []) as KindStub[]);
    await loadList();
    setLoading(false);
  }, [loadList]);

  useEffect(() => { void loadKinds(); }, [loadKinds]);

  const loadPrompts = useCallback(async (kind: string) => {
    const r = await lensRun({ domain: 'wellness', action: 'cbt-prompts', input: { fieldKind: kind } });
    if (r.data?.ok && r.data.result) setPrompts(r.data.result as KindPrompts);
  }, []);

  useEffect(() => { if (open) void loadPrompts(form.fieldKind); }, [open, form.fieldKind, loadPrompts]);

  async function save() {
    if (!form.situation.trim() || !form.automaticThought.trim()) {
      setErr('Situation and automatic thought are required.');
      return;
    }
    setBusy(true); setErr(null);
    const r = await lensRun({
      domain: 'wellness', action: 'cbt-record-create',
      input: { ...form },
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ ...EMPTY_FORM });
      setOpen(false);
      await loadList();
    } else {
      setErr(r.data?.error || 'Could not save thought record.');
    }
  }

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <Brain className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Guided CBT thought records</h3>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        {list && (
          <span className="ml-auto text-[10px] text-zinc-500">
            {list.completed}/{list.total} completed
            {list.avgRelief !== null && ` · avg relief ${list.avgRelief}`}
          </span>
        )}
      </header>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-1.5 rounded font-semibold">
          <Plus className="w-3 h-3" /> Start a thought record
        </button>
      ) : (
        <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1">Distortion to work on</label>
            <select value={form.fieldKind} onChange={e => setForm({ ...form, fieldKind: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white">
              {kinds.map(k => <option key={k.fieldKind} value={k.fieldKind}>{k.label}</option>)}
            </select>
          </div>

          {prompts && (
            <div className="rounded bg-indigo-500/5 border border-indigo-500/20 p-2 space-y-1.5">
              <div className="text-[10px] text-indigo-300 italic">{prompts.distortion}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Socratic challenges</div>
              <ul className="space-y-0.5">
                {prompts.challenges.map((c, i) => (
                  <li key={i} className="text-[11px] text-zinc-300 flex gap-1.5">
                    <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-indigo-400" />{c}
                  </li>
                ))}
              </ul>
              <div className="text-[11px] text-emerald-300 pt-0.5"><span className="font-semibold">Reframe:</span> {prompts.reframe}</div>
            </div>
          )}

          <input type="text" value={form.situation} maxLength={280}
            onChange={e => setForm({ ...form, situation: e.target.value })}
            placeholder="Situation — what happened?"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white" />
          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={form.emotion} maxLength={80}
              onChange={e => setForm({ ...form, emotion: e.target.value })}
              placeholder="Emotion (e.g. anxious)"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white" />
            <input type="text" value={form.automaticThought} maxLength={280}
              onChange={e => setForm({ ...form, automaticThought: e.target.value })}
              placeholder="Automatic thought"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea value={form.evidenceFor} rows={2} maxLength={600}
              onChange={e => setForm({ ...form, evidenceFor: e.target.value })}
              placeholder="Evidence for the thought"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white resize-none" />
            <textarea value={form.evidenceAgainst} rows={2} maxLength={600}
              onChange={e => setForm({ ...form, evidenceAgainst: e.target.value })}
              placeholder="Evidence against the thought"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white resize-none" />
          </div>
          <textarea value={form.reframe} rows={2} maxLength={600}
            onChange={e => setForm({ ...form, reframe: e.target.value })}
            placeholder="Balanced reframe — what is a fairer way to see this?"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white resize-none" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold flex justify-between">
                <span>Intensity before</span><span className="text-zinc-300 font-mono">{form.intensityBefore}</span>
              </label>
              <input type="range" min={0} max={100} value={form.intensityBefore}
                onChange={e => setForm({ ...form, intensityBefore: Number(e.target.value) })}
                className="w-full accent-rose-500" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold flex justify-between">
                <span>Intensity after</span><span className="text-zinc-300 font-mono">{form.intensityAfter}</span>
              </label>
              <input type="range" min={0} max={100} value={form.intensityAfter}
                onChange={e => setForm({ ...form, intensityAfter: Number(e.target.value) })}
                className="w-full accent-emerald-500" />
            </div>
          </div>
          {err && <div className="text-[10px] text-rose-300">{err}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs py-1.5 rounded font-semibold">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Save record
            </button>
            <button type="button" onClick={() => { setOpen(false); setErr(null); }}
              className="px-3 text-xs text-zinc-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {list && list.records.length > 0 && (
        <ul className="space-y-1.5">
          {list.records.slice(0, 8).map(r => (
            <li key={r.id} className="rounded border border-white/10 bg-black/30 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-zinc-500">{r.number}</span>
                <span className="text-[11px] text-indigo-300 flex-1 truncate">{r.distortionLabel}</span>
                <span className="text-[9px] font-mono text-zinc-500">{r.date}</span>
                {r.relief !== null && (
                  <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded',
                    r.relief > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-zinc-400')}>
                    {r.relief > 0 ? `−${r.relief} relief` : 'no change'}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-300 mt-1 truncate">{r.situation}</div>
              {r.reframe && <div className="text-[10px] text-emerald-300/80 mt-0.5 truncate">↳ {r.reframe}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CBTPanel;
