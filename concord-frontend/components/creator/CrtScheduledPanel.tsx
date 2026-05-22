'use client';

/**
 * CrtScheduledPanel — scheduled publishing. The creator queues artifacts
 * for a timed release; the panel lists the queue with overdue flags and
 * a "publish due now" action. All queued items are real user input.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, CalendarClock, PlayCircle, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface QueuedItem {
  id: string;
  title: string;
  format: string;
  platform: string | null;
  body: string | null;
  releaseAt: string;
  contentId: string | null;
  status: 'scheduled' | 'published' | 'cancelled';
  createdAt: string;
  publishedAt: string | null;
  overdue: boolean;
}
interface QueueResult {
  queue: QueuedItem[];
  count: number;
}

const FORMATS = ['video', 'short', 'post', 'article', 'podcast', 'stream', 'newsletter', 'other'];
const STATUS_FILTERS: { id: 'all' | 'scheduled' | 'published' | 'cancelled'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'published', label: 'Published' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function CrtScheduledPanel() {
  const [result, setResult] = useState<QueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'published' | 'cancelled'>('all');
  const [form, setForm] = useState({ title: '', format: 'post', releaseAt: '', body: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'publish-queue-list', { status: filter });
    if (r.data?.ok) setResult(r.data.result as QueueResult);
    else setResult(null);
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const queueItem = async () => {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!form.releaseAt) { setError('Pick a release date and time.'); return; }
    const iso = new Date(form.releaseAt).toISOString();
    const r = await lensRun('creator', 'publish-queue-add', {
      title: form.title.trim(),
      format: form.format,
      releaseAt: iso,
      body: form.body.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', format: 'post', releaseAt: '', body: '' });
    setError(null);
    await refresh();
  };

  const cancelItem = async (id: string) => {
    const r = await lensRun('creator', 'publish-queue-cancel', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  const runDue = async () => {
    const r = await lensRun('creator', 'publish-queue-run-due', {});
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const queue = result?.queue ?? [];
  const dueCount = queue.filter((q) => q.overdue).length;

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Queue a new release. */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5 text-red-400" /> Schedule a release
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <select
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize"
          >
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <input
            type="datetime-local"
            value={form.releaseAt}
            onChange={(e) => setForm({ ...form, releaseAt: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
        </div>
        <textarea
          placeholder="Draft body (optional)"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
        />
        <button
          type="button"
          onClick={queueItem}
          className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-3 py-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Queue release
        </button>
      </section>

      {/* Filter + due action. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-medium',
                filter === f.id ? 'bg-red-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {dueCount > 0 && (
          <button
            type="button"
            onClick={runDue}
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Publish {dueCount} due
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No scheduled releases yet.</p>
      ) : (
        <ul className="space-y-1">
          {queue.map((q) => (
            <li key={q.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-100 truncate">
                  {q.title}
                  <span className="text-zinc-500 capitalize"> · {q.format}</span>
                </p>
                <p className="text-[10px] text-zinc-600">
                  {q.status === 'published' && q.publishedAt
                    ? `published ${new Date(q.publishedAt).toLocaleString()}`
                    : `release ${new Date(q.releaseAt).toLocaleString()}`}
                </p>
              </div>
              {q.status === 'scheduled' && q.overdue && (
                <span className="text-[10px] text-amber-400 uppercase">due</span>
              )}
              {q.status === 'scheduled' && (
                <button
                  type="button"
                  onClick={() => cancelItem(q.id)}
                  title="Cancel scheduled release"
                  className="text-zinc-600 hover:text-rose-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              {q.status === 'published' && (
                <span className="text-[10px] text-emerald-400 uppercase">published</span>
              )}
              {q.status === 'cancelled' && (
                <span className="text-[10px] text-zinc-500 uppercase">cancelled</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
