'use client';

/**
 * CrtPipelinePanel — the content pipeline as stage columns.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ChevronRight, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Content {
  id: string; title: string; format: string; platform: string | null; stage: string;
}

const STAGES = [
  { id: 'idea', label: 'Ideas', color: 'border-zinc-600' },
  { id: 'scripted', label: 'Scripted', color: 'border-sky-600' },
  { id: 'in_production', label: 'In production', color: 'border-amber-600' },
  { id: 'scheduled', label: 'Scheduled', color: 'border-violet-600' },
  { id: 'published', label: 'Published', color: 'border-emerald-600' },
];
const FORMATS = ['video', 'short', 'post', 'article', 'podcast', 'stream', 'newsletter', 'other'];

export function CrtPipelinePanel({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', format: 'video', scheduledDate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'content-list', {});
    setItems(r.data?.result?.items || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addContent = async () => {
    if (!form.title.trim()) { setError('Content title is required.'); return; }
    const r = await lensRun('creator', 'content-add', {
      title: form.title.trim(), format: form.format, scheduledDate: form.scheduledDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', format: 'video', scheduledDate: '' });
    setError(null);
    await refresh();
  };

  const advance = async (id: string) => {
    await lensRun('creator', 'content-advance', { id });
    await refresh();
  };
  const del = async (id: string) => {
    await lensRun('creator', 'content-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Content title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addContent}
          className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Idea
        </button>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {STAGES.map((stage) => {
          const stageItems = items.filter((x) => x.stage === stage.id);
          return (
            <div key={stage.id} className={cn('bg-zinc-900/50 border-t-2 rounded-lg p-2', stage.color)}>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1.5">
                {stage.label} <span className="text-zinc-600">{stageItems.length}</span>
              </p>
              <ul className="space-y-1.5">
                {stageItems.map((c) => (
                  <li key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                    <p className="text-xs text-zinc-100">{c.title}</p>
                    <p className="text-[10px] text-zinc-400 capitalize">{c.format}{c.platform && ` · ${c.platform}`}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      {stage.id !== 'published' && (
                        <button type="button" onClick={() => advance(c.id)}
                          className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">
                          Advance <ChevronRight className="w-3 h-3" />
                        </button>
                      )}
                      <div className="flex-1" />
                      <button aria-label="Delete" type="button" onClick={() => del(c.id)} className="text-zinc-600 hover:text-rose-400">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </li>
                ))}
                {stageItems.length === 0 && <li className="text-[10px] text-zinc-400 italic px-1">Empty</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
