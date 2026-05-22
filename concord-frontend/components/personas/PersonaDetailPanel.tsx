'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PersonaDetailPanel — full persona view: chat preview, usage/popularity
 * stats, version history, ratings + reviews, portrait regeneration. Wires
 * personas.get / stats / versions / rate / install / publish / regenerate_portrait.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { PersonaChat } from './PersonaChat';
import type { PersonaDetail } from './PersonaEditor';

interface Review { userId: string; stars: number; review: string; at: number }
interface VersionRow { version: number; changelog: string; contentHash: string; at: number }
interface StatRow {
  installCount: number; chatCount: number; version: number;
  rating: number; ratingCount: number;
  distribution: Array<{ stars: number; count: number }>;
  published: boolean; isAuthor: boolean;
}

export function PersonaDetailPanel({
  personaId,
  onEdit,
  onChanged,
  onClose,
}: {
  personaId: string;
  onEdit: (p: PersonaDetail) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<StatRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [tab, setTab] = useState<'chat' | 'stats' | 'versions' | 'reviews'>('chat');
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const [g, s, v] = await Promise.all([
      lensRun('personas', 'get', { personaId }),
      lensRun('personas', 'stats', { personaId }),
      lensRun('personas', 'versions', { personaId }),
    ]);
    if (g.data?.ok) {
      const res = g.data.result as any;
      setPersona(res.persona as PersonaDetail);
      setReviews((res.reviews || []) as Review[]);
    }
    if (s.data?.ok) setStats(s.data.result as StatRow);
    if (v.data?.ok) setVersions(((v.data.result as any)?.versions || []) as VersionRow[]);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  const flash = (t: string) => { setMsg(t); window.setTimeout(() => setMsg(null), 3500); };

  const togglePublish = async () => {
    if (!persona) return;
    const r = await lensRun('personas', 'publish', {
      personaId, published: !persona.published,
    });
    if (r.data?.ok) {
      flash((r.data.result as any)?.published ? 'Published to marketplace' : 'Unpublished');
      await load();
      onChanged();
    } else flash(`Failed: ${r.data?.error}`);
  };

  const doInstall = async () => {
    const r = await lensRun('personas', 'install', { personaId });
    if (r.data?.ok) {
      flash(`Installed (v${(r.data.result as any)?.version})`);
      await load();
      onChanged();
    } else flash(`Failed: ${r.data?.error}`);
  };

  const submitRate = async () => {
    const r = await lensRun('personas', 'rate', { personaId, stars, review });
    if (r.data?.ok) {
      flash('Rating submitted');
      setReview('');
      await load();
    } else flash(`Failed: ${r.data?.error}`);
  };

  const regenPortrait = async () => {
    const r = await lensRun('personas', 'regenerate_portrait', { personaId });
    if (r.data?.ok) { flash('Portrait regenerated'); await load(); }
    else flash(`Failed: ${r.data?.error}`);
  };

  const uploadPortrait = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUri = String(reader.result || '');
      const r = await lensRun('personas', 'regenerate_portrait', { personaId, dataUri });
      if (r.data?.ok) { flash('Portrait uploaded'); await load(); }
      else flash(`Failed: ${r.data?.error}`);
    };
    reader.readAsDataURL(file);
  };

  if (loading) return <div className="text-zinc-500 py-8 text-center">Loading persona…</div>;
  if (!persona) return <div className="text-red-300 py-8 text-center">Persona not found or not visible.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={persona.portrait} alt={persona.name} className="h-20 w-20 rounded-xl flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-zinc-100">{persona.name}</h2>
            <span className="text-[10px] uppercase tracking-wider text-purple-300 bg-purple-950/60 rounded px-1.5 py-0.5">
              v{persona.version}
            </span>
            {persona.published
              ? <span className="text-[10px] text-emerald-300 bg-emerald-950/60 rounded px-1.5 py-0.5">published</span>
              : <span className="text-[10px] text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">draft</span>}
          </div>
          {persona.tagline && <p className="text-sm text-zinc-400">{persona.tagline}</p>}
          <p className="mt-1 text-xs text-zinc-500">
            ★ {persona.rating || '—'} ({persona.ratingCount}) · {persona.installCount} installs · {persona.chatCount} chats
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {persona.tags.map((t) => (
              <span key={t} className="text-[10px] text-cyan-300 bg-cyan-950/40 rounded px-1.5 py-0.5">#{t}</span>
            ))}
          </div>
        </div>
        <button
          type="button" onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm"
        >✕</button>
      </div>

      {persona.personality && (
        <p className="text-xs text-zinc-400 bg-zinc-900/60 rounded-lg p-2 border border-zinc-800">
          {persona.personality}
        </p>
      )}

      {msg && (
        <div className="bg-purple-950/50 border border-purple-700/50 text-purple-200 px-3 py-2 rounded-lg text-sm">
          {msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {persona.isAuthor && (
          <>
            <button
              type="button" onClick={() => onEdit(persona)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >Edit</button>
            <button
              type="button" onClick={togglePublish}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100"
            >{persona.published ? 'Unpublish' : 'Publish'}</button>
            <button
              type="button" onClick={regenPortrait}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >Regenerate portrait</button>
            <label className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer">
              Upload portrait
              <input
                type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPortrait(f); }}
              />
            </label>
          </>
        )}
        {!persona.isAuthor && persona.published && (
          <button
            type="button" onClick={doInstall}
            className="text-xs px-3 py-1.5 rounded-lg bg-cyan-800 hover:bg-cyan-700 text-cyan-100"
          >Install persona</button>
        )}
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {(['chat', 'stats', 'versions', 'reviews'] as const).map((t) => (
          <button
            key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs capitalize ${
              tab === t
                ? 'border-b-2 border-purple-500 text-purple-200'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >{t}</button>
        ))}
      </div>

      {tab === 'chat' && (
        <PersonaChat personaId={persona.id} personaName={persona.name} portrait={persona.portrait} />
      )}

      {tab === 'stats' && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Installs" value={stats.installCount} />
            <Stat label="Chats" value={stats.chatCount} />
            <Stat label="Avg rating" value={stats.rating || 0} />
          </div>
          {stats.ratingCount > 0 ? (
            <ChartKit
              kind="bar"
              data={stats.distribution.map((d) => ({ stars: `${d.stars}★`, count: d.count }))}
              xKey="stars"
              series={[{ key: 'count', label: 'Reviews', color: '#a855f7' }]}
              height={180}
            />
          ) : (
            <p className="text-xs text-zinc-500 italic">No ratings yet.</p>
          )}
        </div>
      )}

      {tab === 'versions' && (
        <ul className="space-y-1.5">
          {versions.slice().reverse().map((v) => (
            <li key={v.version + v.contentHash} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
              <div className="flex justify-between">
                <span className="font-semibold text-zinc-200">v{v.version}</span>
                <span className="text-zinc-500">{new Date(v.at * 1000).toLocaleDateString()}</span>
              </div>
              <div className="text-zinc-400">{v.changelog}</div>
              <div className="text-[10px] text-zinc-600 font-mono break-all">sha {v.contentHash.slice(0, 16)}…</div>
            </li>
          ))}
        </ul>
      )}

      {tab === 'reviews' && (
        <div className="space-y-3">
          {!persona.isAuthor && persona.published && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s} type="button" onClick={() => setStars(s)}
                    className={`text-lg ${s <= stars ? 'text-amber-400' : 'text-zinc-700'}`}
                  >★</button>
                ))}
              </div>
              <textarea
                value={review} onChange={(e) => setReview(e.target.value)}
                rows={2} placeholder="Write a review (optional)…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
              />
              <button
                type="button" onClick={submitRate}
                className="text-xs px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-white"
              >Submit rating</button>
            </div>
          )}
          {reviews.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No reviews yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {reviews.map((r, i) => (
                <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-amber-400">{'★'.repeat(r.stars)}</span>
                    <span className="text-zinc-600">{new Date(r.at * 1000).toLocaleDateString()}</span>
                  </div>
                  <p className="text-zinc-300">{r.review}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-center">
      <div className="text-lg font-bold text-zinc-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
