'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { Creator } from './DiscoverPanel';

interface FeedPost { id: string; creatorId: string; title: string; body: string | null; minTier: string; kind: string; publishedAt: number; locked: boolean; }
interface SponsorRow { userId: string; tier: string; badge: string; totalContributed: number; monthsSponsoring: number; rank: number; }

const BADGE_COLOR: Record<string, string> = {
  bronze: 'bg-amber-900/60 text-amber-300',
  silver: 'bg-zinc-700/60 text-zinc-200',
  gold: 'bg-yellow-800/60 text-yellow-300',
};

export function CreatorHub() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [creatorId, setCreatorId] = useState('');
  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [board, setBoard] = useState<SponsorRow[]>([]);
  const [form, setForm] = useState({ title: '', body: '', minTier: 'public', kind: 'post' });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('sponsorship', 'discover', {});
      if (r.data?.ok && r.data.result) {
        const list: Creator[] = r.data.result.creators || [];
        setCreators(list);
        if (list.length && !creatorId) setCreatorId(list[0].creatorId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCreator = async (cid: string) => {
    if (!cid) return;
    const f = await lensRun('sponsorship', 'feed', { creatorId: cid });
    if (f.data?.ok && f.data.result) setFeed(f.data.result.posts || []);
    const l = await lensRun('sponsorship', 'leaderboard', { creatorId: cid });
    if (l.data?.ok && l.data.result) setBoard(l.data.result.sponsors || []);
  };

  useEffect(() => { void loadCreator(creatorId); }, [creatorId]);

  const flash = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };

  const publish = async () => {
    if (!creatorId || !form.title.trim()) return;
    const r = await lensRun('sponsorship', 'publish_post', {
      creatorId,
      title: form.title.trim(),
      body: form.body,
      minTier: form.minTier,
      kind: form.kind,
    });
    if (r.data?.ok) {
      flash('Published.');
      setForm({ title: '', body: '', minTier: 'public', kind: 'post' });
      await loadCreator(creatorId);
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400">Creator</label>
        <select
          value={creatorId}
          onChange={(e) => setCreatorId(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100"
        >
          {creators.map((c) => <option key={c.creatorId} value={c.creatorId}>{c.name}</option>)}
        </select>
      </div>

      {msg && (
        <div className="bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{msg}</div>
      )}

      <section className="bg-zinc-900/80 border border-emerald-800/50 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Publish sponsor-only content</h3>
        <input
          type="text" placeholder="Post title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-100"
        />
        <textarea
          placeholder="Post body…"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-100"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={form.minTier}
            onChange={(e) => setForm({ ...form, minTier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-100"
          >
            <option value="public">Public</option>
            <option value="bronze">Bronze+</option>
            <option value="silver">Silver+</option>
            <option value="gold">Gold only</option>
          </select>
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-100"
          >
            <option value="post">Post</option>
            <option value="dispatch">Dispatch</option>
          </select>
          <button
            type="button" onClick={() => void publish()}
            disabled={!form.title.trim()}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[12px] px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Publish</button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">Creator feed (your access)</h3>
        {feed.length === 0 ? (
          <p className="text-[11px] text-zinc-600 italic">No posts from this creator yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {feed.map((p) => (
              <li key={p.id} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex justify-between items-baseline">
                  <p className="text-[12px] text-zinc-200 font-medium">
                    {p.title}
                    <span className="ml-1.5 text-[9px] uppercase text-zinc-500">{p.kind}</span>
                  </p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${p.locked ? 'bg-rose-900/60 text-rose-300' : 'bg-emerald-900/60 text-emerald-300'}`}>
                    {p.locked ? `locked · ${p.minTier}+` : p.minTier}
                  </span>
                </div>
                {p.locked ? (
                  <p className="text-[11px] text-zinc-600 italic mt-0.5">Subscribe at {p.minTier}+ to unlock this content.</p>
                ) : (
                  p.body && <p className="text-[11px] text-zinc-400 mt-0.5">{p.body}</p>
                )}
                <p className="text-[9px] text-zinc-600 mt-0.5">{new Date(p.publishedAt * 1000).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">Sponsor leaderboard</h3>
        {board.length === 0 ? (
          <p className="text-[11px] text-zinc-600 italic">No sponsors yet for this creator.</p>
        ) : (
          <ul className="space-y-1">
            {board.map((s) => (
              <li key={`${s.userId}-${s.rank}`} className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[12px] flex items-center gap-2">
                <span className="font-mono text-zinc-500 w-6">#{s.rank}</span>
                <span className="text-zinc-200 flex-1 truncate">{s.userId}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${BADGE_COLOR[s.badge] || BADGE_COLOR.bronze}`}>{s.badge}</span>
                <span className="font-mono text-amber-300 text-[11px]">{s.totalContributed} CC</span>
                <span className="text-zinc-600 text-[10px]">{s.monthsSponsoring}mo</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
