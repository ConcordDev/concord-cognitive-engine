'use client';

/**
 * ThreadComposer — Typefully 2026-shape thread writing: a distraction-
 * free editor that auto-splits long text into numbered posts with a
 * live preview, a drafts list, a schedule queue and best-time hints.
 * Wires the thread.thread-draft, thread.draft-*, thread.split-preview,
 * thread.queue-list and thread.best-time macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { PenSquare, Plus, Trash2, Calendar, Send, Loader2, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Post { index: number; text: string; chars: number }
interface DraftMeta { id: string; title: string; platform: string; status: string; postCount: number; scheduledAt: string | null }
interface Draft { id: string; title: string; content: string; platform: string; status: string; posts: Post[] }
interface Slot { day: string; time: string; score: number }
interface Dash { drafts: number; scheduled: number; published: number; total: number }

const PLATFORMS = ['x', 'threads', 'linkedin', 'bluesky', 'mastodon'];

export function ThreadComposer() {
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<Draft | null>(null);
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState('x');
  const [preview, setPreview] = useState<Post[]>([]);
  const [bestSlots, setBestSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [schedAt, setSchedAt] = useState('');

  const refresh = useCallback(async () => {
    const [dl, d, bt] = await Promise.all([
      lensRun('thread', 'draft-list', {}),
      lensRun('thread', 'thread-dashboard', {}),
      lensRun('thread', 'best-time', {}),
    ]);
    setDrafts((dl.data?.result?.drafts as DraftMeta[]) || []);
    setDash((d.data?.result as Dash) || null);
    setBestSlots((bt.data?.result?.slots as Slot[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Live split preview as the user types (debounced).
  useEffect(() => {
    if (!content.trim()) { setPreview([]); return; }
    const limit = platform === 'linkedin' ? 2800 : platform === 'bluesky' ? 300 : 270;
    const h = setTimeout(() => {
      void lensRun('thread', 'split-preview', { content, limit }).then(r => setPreview((r.data?.result?.posts as Post[]) || []));
    }, 250);
    return () => clearTimeout(h);
  }, [content, platform]);

  async function open(id: string) {
    const r = await lensRun('thread', 'draft-detail', { id });
    if (r.data?.ok) {
      const d = r.data.result?.draft as Draft;
      setActive(d); setContent(d.content); setPlatform(d.platform);
    }
  }
  function newDraft() { setActive(null); setContent(''); }

  async function save() {
    if (!content.trim()) return;
    if (active) {
      await lensRun('thread', 'draft-update', { id: active.id, content });
    } else {
      const r = await lensRun('thread', 'thread-draft', { content, platform });
      if (r.data?.ok) setActive(r.data.result?.draft as Draft);
    }
    await refresh();
  }
  async function del(id: string) {
    await lensRun('thread', 'draft-delete', { id });
    if (active?.id === id) newDraft();
    await refresh();
  }
  async function schedule() {
    if (!active || !schedAt) return;
    await lensRun('thread', 'draft-schedule', { id: active.id, scheduledAt: new Date(schedAt).toISOString() });
    setSchedAt('');
    await refresh();
  }
  async function publish() {
    if (!active) return;
    await lensRun('thread', 'draft-publish', { id: active.id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PenSquare className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Thread Composer</h3>
        <span className="text-[11px] text-zinc-400">Typefully shape</span>
        {dash && <span className="ml-auto text-[10px] text-zinc-400">{dash.drafts} drafts · {dash.scheduled} queued · {dash.published} published</span>}
      </div>

      <div className="grid sm:grid-cols-[180px_1fr_1fr] gap-3">
        {/* Drafts list */}
        <div>
          <button onClick={newDraft} className="w-full mb-2 px-2 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />New thread
          </button>
          <ul className="space-y-1">
            {drafts.map(d => (
              <li key={d.id} className="group flex items-center gap-1">
                <button onClick={() => open(d.id)}
                  className={cn('flex-1 text-left rounded-lg px-2 py-1.5 border', active?.id === d.id ? 'bg-sky-600/15 border-sky-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                  <p className="text-[11px] font-semibold text-zinc-100 truncate">{d.title}</p>
                  <p className="text-[9px] text-zinc-400">{d.postCount} posts · {d.status}</p>
                </button>
                <button aria-label="Delete" onClick={() => del(d.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        </div>

        {/* Editor */}
        <div>
          <div className="flex gap-1.5 mb-1.5">
            <select value={platform} onChange={e => setPlatform(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={save} disabled={!content.trim()}
              className="flex-1 px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">
              {active ? 'Save' : 'Create draft'}
            </button>
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} rows={11}
            placeholder="Write your thread — paragraphs and long text auto-split into numbered posts…"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          {active && (
            <div className="flex gap-1.5 mt-1.5">
              <input type="datetime-local" value={schedAt} onChange={e => setSchedAt(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200" />
              <button onClick={schedule} disabled={!schedAt} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />Queue
              </button>
              <button onClick={publish} className="px-2 py-1 text-[11px] rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1">
                <Send className="w-3 h-3" />Publish
              </button>
            </div>
          )}
          {bestSlots.length > 0 && (
            <p className="text-[10px] text-zinc-400 mt-1 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />Best time: {bestSlots[0].day} {bestSlots[0].time}
            </p>
          )}
        </div>

        {/* Live preview */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Preview · {preview.length} post{preview.length === 1 ? '' : 's'}</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {preview.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">Start writing to see the split.</p>
            ) : preview.map(p => (
              <div key={p.index} className="bg-zinc-950 border border-zinc-800 rounded-lg p-2">
                <p className="text-xs text-zinc-200 whitespace-pre-wrap">{p.text}</p>
                <p className={cn('text-[9px] mt-1', p.chars > 280 ? 'text-rose-400' : 'text-zinc-600')}>{p.chars} chars</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
