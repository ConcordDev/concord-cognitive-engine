'use client';

/**
 * Library: what you keep (downloads), the lists you make (playlists), the
 * shows you have kept fresh automatically (auto-download rules), and where
 * you are on every device (sync).
 */

import { useCallback, useEffect, useState } from 'react';
import { ListPlus, RefreshCw, Trash2 } from 'lucide-react';
import { onPodcastChanged } from '../podcast-events';
import { Story } from './Rooms';
import { clock, dateline, length, pc, pcw, writeAddress, type Episode, type Show } from './pc';

interface Playlist { id: string; name: string; episodeIds: string[]; createdAt: string }
interface Rule { showId: string; showTitle: string; autoDownload: boolean; keepRecent: number }
interface SyncPos { episodeId: string; episodeTitle: string | null; showTitle: string | null; positionSec: number; played: boolean; updatedAt: string | null; device?: string | null }

function useReload(fn: () => void) {
  useEffect(() => { fn(); }, [fn]);
  useEffect(() => onPodcastChanged(fn), [fn]);
}

export function LibraryRoom() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="tp-library">
      <div className="space-y-10"><Downloads /><Playlists /></div>
      <aside className="space-y-10"><Rules /><Sync /></aside>
    </div>
  );
}

function Downloads() {
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [total, setTotal] = useState(0);
  const load = useCallback(() => { void pc<{ episodes: Episode[]; totalSec: number }>('download-list').then((r) => { setEps(r.result?.episodes || []); setTotal(r.result?.totalSec || 0); }); }, []);
  useReload(load);
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[22px]">Kept for later</h2>
      <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">Episodes you have kept to hear later{eps?.length ? ` · ${length(total)} in all` : ''}.</p>
      {!eps ? <div className="tp-skeleton mt-3 h-24" role="status" aria-label="Loading downloads" />
        : eps.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">Nothing kept. Use “Keep” on an episode’s page.</p>
        : <ul>{eps.map((ep) => <Story key={ep.id} ep={ep} extra={<button type="button" className="tp-btn tp-btn-quiet h-8 w-8 !p-0" aria-label={`Remove ${ep.title} from kept`} onClick={() => void pcw('download-remove', { episodeId: ep.id })}><Trash2 className="h-3.5 w-3.5" /></button>} />)}</ul>}
    </section>
  );
}

function Playlists() {
  const [lists, setLists] = useState<Playlist[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [eps, setEps] = useState<Episode[]>([]);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { void pc<{ playlists: Playlist[] }>('playlist-list').then((r) => setLists(r.result?.playlists || [])); }, []);
  useReload(load);
  useEffect(() => {
    if (!open) { setEps([]); return; }
    void pc<{ episodes: Episode[] }>('playlist-detail', { id: open }).then((r) => setEps(r.result?.episodes || []));
  }, [open, lists]);
  const create = async () => {
    setErr(null);
    const r = await pcw<{ playlist: Playlist }>('playlist-create', { name: name.trim() });
    if (r.ok && r.result?.playlist?.id) { setName(''); setOpen(r.result.playlist.id); } else setErr(r.error || 'The playlist was not made.');
  };
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[22px]">Playlists</h2>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void create(); }}>
        <input className="tp-input" placeholder="Name a new playlist" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} aria-label="New playlist name" />
        <button type="submit" className="tp-btn" disabled={!name.trim()}><ListPlus className="h-4 w-4" /> Make</button>
      </form>
      {err && <p className="tp-error mt-2" role="alert">{err}</p>}
      {!lists ? <div className="tp-skeleton mt-3 h-16" role="status" aria-label="Loading playlists" />
        : lists.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">No playlists yet. Make one, then add episodes from Up next or an episode page.</p>
        : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {lists.map((p) => <button key={p.id} type="button" className="tp-chip" aria-pressed={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>{p.name} <span className="tp-mono opacity-70">{p.episodeIds.length}</span></button>)}
          </div>
        )}
      {open && (eps.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">This playlist is empty.</p>
        : <ul className="mt-2">{eps.map((ep) => <Story key={ep.id} ep={ep} extra={<button type="button" className="tp-btn tp-btn-quiet h-8 w-8 !p-0" aria-label={`Take ${ep.title} off the playlist`} onClick={() => void pcw('playlist-add-episode', { playlistId: open, episodeId: ep.id, remove: true })}><Trash2 className="h-3.5 w-3.5" /></button>} />)}</ul>)}
      {open && <AddToPlaylist playlistId={open} have={new Set(eps.map((e) => e.id))} />}
    </section>
  );
}

/** Add from what you're already listening to (Up next + in progress). */
function AddToPlaylist({ playlistId, have }: { playlistId: string; have: Set<string> }) {
  const [cands, setCands] = useState<Episode[]>([]);
  useEffect(() => {
    void Promise.all([pc<{ episodes: Episode[] }>('queue-list'), pc<{ episodes: Episode[] }>('continue-listening')]).then(([q, c]) => {
      const seen = new Set<string>(); const all: Episode[] = [];
      for (const e of [...(q.result?.episodes || []), ...(c.result?.episodes || [])]) if (!seen.has(e.id)) { seen.add(e.id); all.push(e); }
      setCands(all);
    });
  }, [playlistId]);
  const left = cands.filter((e) => !have.has(e.id));
  if (!left.length) return null;
  return (
    <div className="mt-3">
      <p className="tp-label mb-1">Add from Up next and In progress</p>
      <div className="flex flex-wrap gap-1.5">
        {left.slice(0, 10).map((e) => <button key={e.id} type="button" className="tp-chip" onClick={() => void pcw('playlist-add-episode', { playlistId, episodeId: e.id })}>+ {e.title}</button>)}
      </div>
    </div>
  );
}

function Rules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [shows, setShows] = useState<Show[]>([]);
  const [pick, setPick] = useState('');
  const [keep, setKeep] = useState(3);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    void pc<{ rules: Rule[] }>('download-rule-list').then((r) => setRules(r.result?.rules || []));
    void pc<{ shows: Show[] }>('show-list', { subscribed: true }).then((r) => setShows(r.result?.shows || []));
  }, []);
  useReload(load);
  const save = async (showId: string, autoDownload: boolean, keepRecent: number) => {
    const r = await pcw('download-rule-set', { showId, autoDownload, keepRecent });
    setMsg(r.ok ? null : r.error);
  };
  const run = async () => {
    const r = await pcw<{ added: number; pruned: number; totalDownloads: number }>('download-rule-run');
    setMsg(r.ok && r.result ? `Kept ${r.result.added} new, let go of ${r.result.pruned} old; ${r.result.totalDownloads} kept in all.` : r.error);
  };
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[20px]">Keep shows fresh</h2>
      <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">Keep the newest episodes of a show and let older ones go.</p>
      {(rules || []).map((r) => (
        <div key={r.showId} className="tp-hair mt-2 flex items-center gap-2 pt-2 text-[13px]">
          <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={r.autoDownload} onChange={(e) => void save(r.showId, e.target.checked, r.keepRecent)} /> <span className="truncate">{r.showTitle}</span></label>
          <span className="text-[color:var(--tp-muted)]">newest</span>
          <input className="tp-input tp-mono !min-h-0 w-14 !py-1" type="number" min={1} max={25} defaultValue={r.keepRecent} onBlur={(e) => void save(r.showId, r.autoDownload, Number(e.target.value) || 3)} aria-label={`Keep how many of ${r.showTitle}`} />
        </div>
      ))}
      {shows.filter((s) => !(rules || []).some((r) => r.showId === s.id)).length > 0 && (
        <div className="mt-3 flex gap-2">
          <select className="tp-input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Show to keep fresh">
            <option value="">A show you follow…</option>
            {shows.filter((s) => !(rules || []).some((r) => r.showId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <input className="tp-input tp-mono w-16" type="number" min={1} max={25} value={keep} onChange={(e) => setKeep(Math.max(1, Math.min(25, Number(e.target.value) || 1)))} aria-label="Episodes to keep" />
          <button type="button" className="tp-btn" disabled={!pick} onClick={() => { void save(pick, true, keep); setPick(''); }}>Add</button>
        </div>
      )}
      {!!rules?.length && <button type="button" className="tp-btn mt-3 w-full" onClick={() => void run()}><RefreshCw className="h-4 w-4" /> Apply now</button>}
      {msg && <p className="mt-2 text-[13px]" role="status">{msg}</p>}
    </section>
  );
}

function Sync() {
  const [data, setData] = useState<{ positions: SyncPos[]; syncedAt: string; playbackSpeed: number } | null>(null);
  const load = useCallback(() => { void pc<{ positions: SyncPos[]; syncedAt: string; playbackSpeed: number }>('sync-state').then((r) => setData(r.result)); }, []);
  useReload(load);
  const recent = (data?.positions || []).filter((p) => p.episodeTitle).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8);
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[20px]">On every device</h2>
      <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">Where you are in each episode, saved to your account as you listen{data ? ` · checked ${new Date(data.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.</p>
      {!data ? <div className="tp-skeleton mt-3 h-20" role="status" aria-label="Loading sync" />
        : recent.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">Nothing listened to yet.</p>
        : (
          <ul className="mt-2">{recent.map((p) => (
            <li key={p.episodeId} className="tp-hair py-2">
              <button type="button" className="block w-full text-left" onClick={() => writeAddress({ ep: p.episodeId })}>
                <span className="block truncate text-[13.5px] font-semibold">{p.episodeTitle}</span>
                <span className="tp-mono block text-[11.5px] text-[color:var(--tp-muted)]">{p.played ? 'finished' : `at ${clock(p.positionSec)}`}{p.device ? ` · ${p.device}` : ''}{p.updatedAt ? ` · ${dateline(p.updatedAt)}` : ''}</span>
              </button>
            </li>
          ))}</ul>
        )}
    </section>
  );
}
