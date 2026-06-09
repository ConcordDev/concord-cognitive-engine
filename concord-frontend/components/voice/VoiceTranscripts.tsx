'use client';

/**
 * VoiceTranscripts — Otter.ai 2026-shape transcript workspace: a
 * recording list, a speaker-labelled transcript with inline editing
 * and highlights, a deterministic summary + action items, and
 * cross-recording search. Wires the voice.recording-*, voice.segment-*,
 * voice.highlight-toggle, voice.recording-summary, voice.transcript-search
 * macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Mic, Plus, Trash2, Star, Sparkles, Search, Loader2, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RecMeta { id: string; title: string; folder: string; durationSec: number; segmentCount: number; speakerCount: number; highlightCount: number; hasSummary: boolean }
interface Segment { id: string; speaker: string; text: string; startSec: number; highlighted: boolean }
interface Summary { keyPoints: string[]; actionItems: { text: string; speaker: string }[]; speakers: string[] }
interface Recording { id: string; title: string; durationSec: number; segments: Segment[]; summary: Summary | null }

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export function VoiceTranscripts() {
  const [recordings, setRecordings] = useState<RecMeta[]>([]);
  const [active, setActive] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: '', transcript: '' });
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<{ recordingId: string; recordingTitle: string; text: string }[] | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('voice', 'recording-list', {});
    setRecordings((r.data?.result?.recordings as RecMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('voice', 'recording-detail', { id });
    if (r.data?.ok) setActive(r.data.result?.recording as Recording);
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function create() {
    if (!draft.title.trim() || !draft.transcript.trim()) return;
    const r = await lensRun('voice', 'recording-create', { title: draft.title.trim(), transcript: draft.transcript.trim() });
    setDraft({ title: '', transcript: '' }); setShowNew(false);
    await refresh();
    if (r.data?.ok) await open(r.data.result?.recording.id);
  }
  async function del(id: string) {
    if (!confirm('Delete this recording?')) return;
    await lensRun('voice', 'recording-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function editSegment(segmentId: string, text: string) {
    if (!active) return;
    await lensRun('voice', 'segment-edit', { recordingId: active.id, segmentId, text });
    await reload();
  }
  async function toggleHighlight(segmentId: string) {
    if (!active) return;
    await lensRun('voice', 'highlight-toggle', { recordingId: active.id, segmentId });
    await reload();
  }
  async function summarize() {
    if (!active) return;
    await lensRun('voice', 'recording-summary', { id: active.id });
    await reload();
    await refresh();
  }
  async function runSearch() {
    if (!search.trim()) { setHits(null); return; }
    const r = await lensRun('voice', 'transcript-search', { query: search.trim() });
    setHits((r.data?.result?.hits as { recordingId: string; recordingTitle: string; text: string }[]) || []);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Mic className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Transcripts</h3>
        <span className="text-[11px] text-zinc-400">Otter.ai shape</span>
        <button onClick={() => setShowNew(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </div>

      {showNew && (
        <div className="bg-zinc-900/70 border border-sky-800/40 rounded-lg p-3 mb-3 space-y-2">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Recording title"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
          <textarea value={draft.transcript} onChange={e => setDraft({ ...draft, transcript: e.target.value })} rows={4}
            placeholder="Paste a transcript — sentences become segments"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
          <button onClick={create} disabled={!draft.title.trim() || !draft.transcript.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40">Add recording</button>
        </div>
      )}

      <div className="flex gap-1 mb-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
            placeholder="Search all transcripts" className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-200" />
        </div>
        {hits && <button onClick={() => { setHits(null); setSearch(''); }} className="px-2 text-xs text-zinc-400">clear</button>}
      </div>

      {hits ? (
        <div className="space-y-1">
          {hits.length === 0 && <p className="text-xs text-zinc-400 italic">No matches.</p>}
          {hits.map((h, i) => (
            <button key={i} onClick={() => { open(h.recordingId); setHits(null); }} className="block w-full text-left bg-zinc-900/60 rounded px-2 py-1.5 hover:bg-zinc-800">
              <p className="text-[10px] text-sky-400">{h.recordingTitle}</p>
              <p className="text-xs text-zinc-300">{h.text}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-[200px_1fr] gap-3">
          <ul className="space-y-1">
            {recordings.length === 0 && <li className="text-[11px] text-zinc-400 italic">No recordings yet.</li>}
            {recordings.map(r => (
              <li key={r.id} className="group flex items-center gap-1">
                <button onClick={() => open(r.id)}
                  className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active?.id === r.id ? 'bg-sky-600/15 border-sky-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                  <p className="text-xs font-semibold text-zinc-100 truncate">{r.title}</p>
                  <p className="text-[10px] text-zinc-400 inline-flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />{ts(r.durationSec)} · {r.speakerCount} spk
                    {r.highlightCount > 0 && <span className="text-amber-400"> · ★{r.highlightCount}</span>}
                  </p>
                </button>
                <button aria-label="Delete" onClick={() => del(r.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>

          {active ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-bold text-zinc-100 flex-1 truncate">{active.title}</h4>
                <button onClick={summarize} className="px-2.5 py-1 text-xs rounded bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />Summarize
                </button>
              </div>

              {active.summary && (
                <div className="bg-violet-950/20 border border-violet-900/40 rounded-lg p-2 mb-2">
                  <p className="text-[10px] uppercase tracking-wide text-violet-300 mb-1">Key points</p>
                  {active.summary.keyPoints.map((k, i) => <p key={i} className="text-[11px] text-violet-100">• {k}</p>)}
                  {active.summary.actionItems.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-emerald-300 mt-2 mb-1">Action items</p>
                      {active.summary.actionItems.map((a, i) => (
                        <p key={i} className="text-[11px] text-emerald-100">☐ {a.text} <span className="text-emerald-500/70">— {a.speaker}</span></p>
                      ))}
                    </>
                  )}
                </div>
              )}

              <div className="space-y-1 max-h-72 overflow-y-auto">
                {active.segments.map(g => (
                  <div key={g.id} className={cn('group flex items-start gap-2 rounded px-1.5 py-1', g.highlighted && 'bg-amber-900/15')}>
                    <button aria-label="Favorite" onClick={() => toggleHighlight(g.id)} className={cn('mt-0.5', g.highlighted ? 'text-amber-400' : 'text-zinc-700 hover:text-amber-400')}>
                      <Star className="w-3 h-3" fill={g.highlighted ? 'currentColor' : 'none'} />
                    </button>
                    <span className="text-[10px] font-mono text-zinc-400 mt-0.5 w-9 shrink-0">{ts(g.startSec)}</span>
                    <span className="text-[10px] font-semibold text-sky-400 mt-0.5 w-16 shrink-0 truncate">{g.speaker}</span>
                    <textarea defaultValue={g.text} rows={1}
                      onBlur={e => { if (e.target.value !== g.text) void editSegment(g.id, e.target.value); }}
                      className="flex-1 bg-transparent text-xs text-zinc-200 resize-none focus:outline-none focus:bg-zinc-800/40 rounded px-1" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[140px]">
              Select a recording.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
