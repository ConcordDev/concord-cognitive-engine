'use client';

/**
 * MarketingSocialPanel — multi-channel social post scheduler.
 * Wires: social-schedule, social-list, social-publish, social-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Share2, Trash2, CalendarClock, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const SOCIAL_CHANNELS = ['twitter', 'linkedin', 'facebook', 'instagram', 'tiktok', 'youtube', 'pinterest'] as const;

interface SocialPost {
  id: string; body: string; channels: string[]; scheduledAt: string;
  link: string | null; status: string; publishedAt?: string;
  reach?: Record<string, { impressions: number; engagements: number }>;
}

export function MarketingSocialPanel() {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [channels, setChannels] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'social-list', {});
    setPosts(r.data?.result?.posts || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleChannel = (c: string) =>
    setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const schedule = async () => {
    if (!body.trim()) { setError('Post body is required.'); return; }
    if (channels.length === 0) { setError('Select at least one channel.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'social-schedule', {
      body: body.trim(), channels, link: link.trim(),
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setBody(''); setLink(''); setScheduledAt(''); setChannels([]);
    await refresh();
  };

  const publish = async (id: string) => {
    const r = await lensRun('marketing', 'social-publish', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Publish failed'); return; }
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'social-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
        <Share2 className="w-3.5 h-3.5 text-orange-400" /> Social media scheduler
      </h3>

      {/* Composer */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
          placeholder="Compose your post…" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100" />
        <div className="grid grid-cols-2 gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex flex-wrap gap-1">
          {SOCIAL_CHANNELS.map((c) => (
            <button key={c} type="button" onClick={() => toggleChannel(c)}
              className={cn('text-[10px] capitalize rounded px-2 py-1 border',
                channels.includes(c)
                  ? 'bg-orange-600 border-orange-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white')}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={schedule} disabled={busy}
            className={cn('flex items-center gap-1 text-xs font-medium rounded-lg px-3 py-1.5 text-white',
              busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
            <CalendarClock className="w-3.5 h-3.5" /> {busy ? 'Scheduling…' : 'Schedule post'}
          </button>
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No scheduled posts yet.</p>
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-200 whitespace-pre-wrap">{p.body}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.channels.map((c) => (
                      <span key={c} className="text-[10px] capitalize bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{c}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    {p.status} · {new Date(p.scheduledAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {p.status !== 'published' && (
                    <button type="button" onClick={() => publish(p.id)}
                      className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800/60">
                      <Send className="w-3 h-3" /> Publish
                    </button>
                  )}
                  <button type="button" onClick={() => del(p.id)} aria-label="Delete post"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {p.reach && (
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-zinc-400 border-t border-zinc-800 pt-2">
                  {Object.entries(p.reach).map(([ch, r]) => (
                    <span key={ch} className="capitalize">
                      {ch}: {r.impressions.toLocaleString()} impr · {r.engagements} eng
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
