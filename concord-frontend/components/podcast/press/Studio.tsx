'use client';

/**
 * Your show: the creator's desk. The show's profile and cover, its public
 * RSS feed (with what Apple still needs before it will accept it), every
 * episode with its status, who can hear it and its transcript, a new
 * episode (record or upload), the supporter pass and what the show has
 * earned, and the production desk.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, FileUp, ImagePlus, Lock, Trash2 } from 'lucide-react';
import { uploadMediaRaw } from './upload';
import { onPodcastChanged } from '../podcast-events';
import { CreateEpisodePanel } from '../CreateEpisodePanel';
import { PodcastActionPanel } from '../PodcastActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { Cover } from './Rooms';
import { cc, dateline, length, pc, pcw, writeAddress, type Episode, type PassStatus, type Show } from './pc';

interface FeedInfo { feedPath: string; readiness: { id: string; ok: boolean; label: string }[]; ready: boolean; episodesInFeed: number; categories: string[] }
interface Earnings { tips: { count: number; total: number; recent: { contentId: string; amount: number; at: string }[] }; supporters: number; passPriceCC: number | null; note: string }

export function StudioRoom() {
  const [show, setShow] = useState<Show | null>(null);
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await pc<{ show: Show }>('my-show-ensure');
    if (!r.ok || !r.result?.show?.id) { setErr(r.error || 'Your show could not be opened.'); return; }
    const d = await pc<{ show: Show }>('show-detail', { id: r.result.show.id });
    setShow(d.result?.show || r.result.show);
    const e = await pc<{ episodes: Episode[] }>('episode-list', { showId: r.result.show.id });
    setEps((e.result?.episodes || []).slice().sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)) || String(b.id).localeCompare(String(a.id))));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onPodcastChanged(() => { void load(); }), [load]);

  if (err) return <p className="tp-error" role="alert">{err === 'anonymous callers can read, not write' || /sign in|auth/i.test(err) ? 'Sign in to make a show.' : err}</p>;
  if (!show) return <div className="space-y-3" role="status" aria-label="Opening your show"><div className="tp-skeleton h-40" /><div className="tp-skeleton h-24" /></div>;

  return (
    <div className="space-y-12" data-testid="tp-studio">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Profile show={show} onSaved={load} />
        <FeedPanel show={show} />
      </div>
      <section>
        <h2 className="tp-display tp-rule pt-2 text-[24px]">Episodes</h2>
        {!eps ? <div className="tp-skeleton mt-3 h-24" role="status" aria-label="Loading episodes" />
          : eps.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">No episodes yet. Record or upload the first one below.</p>
          : <ul>{eps.map((ep) => <EpisodeDesk key={ep.id} ep={ep} />)}</ul>}
      </section>
      <section>
        <h2 className="tp-display tp-rule pt-2 text-[24px]">New episode</h2>
        <div className="tp-new mt-3"><CreateEpisodePanel /></div>
      </section>
      <div className="grid gap-10 lg:grid-cols-2">
        <PassPanel show={show} />
        <EarningsPanel show={show} />
      </div>
      <details className="tp-hair pt-3">
        <summary className="tp-display cursor-pointer text-[20px]">Production desk</summary>
        <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">Analytics from your own numbers, guest prep, the production checklist and a sponsorship projection.</p>
        <div className="tp-new mt-3"><PipingProvider><PodcastActionPanel /></PipingProvider></div>
      </details>
    </div>
  );
}

function Profile({ show, onSaved }: { show: Show; onSaved: () => void }) {
  const [f, setF] = useState({ title: show.title, author: show.author || '', description: show.description || '', appleCategory: show.appleCategory || '', language: show.language || 'en', explicit: !!show.explicit });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cats, setCats] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void pc<FeedInfo>('show-feed-info', { showId: show.id }).then((r) => setCats(r.result?.categories || [])); }, [show.id]);
  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await pcw('show-update', { showId: show.id, ...f, appleCategory: f.appleCategory || null });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: r.error || 'Could not save.' });
    if (r.ok) onSaved();
  };
  const upload = async (fl: File) => {
    if (!/^image\/(png|jpeg)$/.test(fl.type)) { setMsg({ ok: false, text: 'Cover art must be a JPEG or PNG.' }); return; }
    if (fl.size > 8 * 1024 * 1024) { setMsg({ ok: false, text: 'Cover art must be under 8 MB.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const up = await uploadMediaRaw(fl, { title: `${show.title} cover`, filename: fl.name, mediaType: 'image', privacy: 'public', tags: ['podcast-cover'] });
      if (!up.ok) throw new Error(up.error);
      const u = await pcw('show-update', { showId: show.id, coverMediaId: up.mediaId });
      setMsg(u.ok ? { ok: true, text: 'Cover set.' } : { ok: false, text: u.error || 'Could not set the cover.' });
      if (u.ok) onSaved();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'The image did not upload.' }); }
    setBusy(false);
  };
  return (
    <section className="grid gap-6 sm:grid-cols-[160px_minmax(0,1fr)]">
      <div>
        <Cover src={show.coverUrl} title={show.title} size={160} />
        <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void upload(fl); e.target.value = ''; }} />
        <button type="button" className="tp-btn mt-2 w-full" disabled={busy} onClick={() => file.current?.click()}><ImagePlus className="h-4 w-4" /> Cover art</button>
      </div>
      <div className="space-y-3">
        <p className="tp-kicker">Your show</p>
        <label className="block"><span className="tp-label">Title</span><input className="tp-input tp-display mt-1 !text-[22px]" maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="block"><span className="tp-label">Author (as shown in podcast apps)</span><input className="tp-input mt-1" maxLength={120} value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
        <label className="block"><span className="tp-label">Description</span><textarea className="tp-input mt-1 h-28 py-2" maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="tp-label">Apple category</span>
            <select className="tp-input mt-1" value={f.appleCategory} onChange={(e) => setF({ ...f, appleCategory: e.target.value })}><option value="">Choose…</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="block"><span className="tp-label">Language</span><input className="tp-input tp-mono mt-1" maxLength={10} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} /></label>
          <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} /> Explicit</label>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="tp-btn tp-btn-signal" disabled={busy || !f.title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save the show'}</button>
          <button type="button" className="tp-btn tp-btn-quiet" onClick={() => writeAddress({ room: 'shows', show: show.id })}>See it as listeners do</button>
        </div>
        {msg && <p className={msg.ok ? 'tp-ok' : 'tp-error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      </div>
    </section>
  );
}

function FeedPanel({ show }: { show: Show }) {
  const [info, setInfo] = useState<FeedInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => { void pc<FeedInfo>('show-feed-info', { showId: show.id }).then((r) => setInfo(r.result)); }, [show.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onPodcastChanged(load), [load]);
  const url = info && typeof window !== 'undefined' ? `${window.location.origin}${info.feedPath}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* the URL stays visible to copy by hand */ } };
  return (
    <aside className="tp-card space-y-3 p-4" aria-label="Public feed">
      <p className="tp-kicker">Public RSS feed</p>
      {!info ? <div className="tp-skeleton h-24" role="status" aria-label="Checking the feed" /> : (
        <>
          <p className="tp-mono break-all text-[12px]" data-testid="tp-feed-url">{url}</p>
          <div className="flex gap-2">
            <button type="button" className="tp-btn" onClick={() => void copy()}>{copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy</>}</button>
            <a className="tp-btn tp-btn-quiet" href={info.feedPath} target="_blank" rel="noreferrer">Open</a>
          </div>
          <p className="text-[12.5px] text-[color:var(--tp-muted)]">{info.episodesInFeed ?? 0} episode{info.episodesInFeed === 1 ? '' : 's'} in the feed: published, for everyone, with audio uploaded here.</p>
          <ul className="space-y-1 text-[13px]" aria-label="Before Apple Podcasts accepts it">
            {(info.readiness || []).map((r) => <li key={r.id} className="flex items-start gap-2"><span aria-hidden className={r.ok ? 'text-[color:var(--tp-good)]' : 'text-[color:var(--tp-faint)]'}>{r.ok ? '✓' : '○'}</span><span className={r.ok ? '' : 'text-[color:var(--tp-ink-2)]'}>{r.label}</span></li>)}
          </ul>
          <p className={info.ready ? 'tp-ok' : 'text-[12.5px] text-[color:var(--tp-muted)]'}>{info.ready ? 'Ready: submit this address in Apple Podcasts Connect or Spotify for Creators.' : 'Fill in what’s missing, then submit the address to Apple and Spotify.'}</p>
        </>
      )}
    </aside>
  );
}

function EpisodeDesk({ ep }: { ep: Episode }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async (action: string, input: Record<string, unknown>, done: string) => {
    const r = await pcw(action, { episodeId: ep.id, ...input });
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error || 'That did not work.' });
  };
  const uploadTranscript = async (fl: File) => {
    const ext = fl.name.toLowerCase().split('.').pop();
    const fmt = ext === 'vtt' ? 'vtt' : ext === 'srt' ? 'srt' : ext === 'json' ? 'json' : ext === 'txt' ? 'text' : null;
    if (!fmt) { setMsg({ ok: false, text: 'Use a .vtt, .srt, .json or .txt file.' }); return; }
    if (fl.size > 2_000_000) { setMsg({ ok: false, text: 'Transcripts can be up to 2 MB.' }); return; }
    const body = await fl.text();
    const r = await pcw<{ segmentCount: number; timing: string }>('transcript-set', fmt === 'text' ? { episodeId: ep.id, text: body } : { episodeId: ep.id, [fmt]: body });
    setMsg(r.ok && r.result ? { ok: true, text: `Transcript set: ${r.result.segmentCount} passages, ${r.result.timing === 'timed' ? 'timed, so it follows along' : 'untimed (plain text cannot follow along)'}.` } : { ok: false, text: r.error || 'The transcript was refused.' });
  };
  const published = ep.status === 'published';
  return (
    <li className="tp-story !grid-cols-[minmax(0,1fr)]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="tp-kicker !text-[10px]">{published ? 'Published' : ep.status === 'scheduled' ? 'Scheduled' : 'Draft'}{ep.access === 'supporters' ? ' · Supporters only' : ''}</p>
          <h3><button type="button" className="text-left hover:underline" onClick={() => writeAddress({ ep: ep.id })}>{ep.title}</button></h3>
          <p className="tp-mono mt-1 text-[11.5px] text-[color:var(--tp-muted)]">{dateline(ep.publishDate)} · {length(ep.durationSec)} · {ep.playCount} finished · {ep.hasTranscript ? 'transcript' : 'no transcript'}{ep.mediaId ? '' : ' · no audio'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={published ? 'tp-btn' : 'tp-btn tp-btn-signal'} onClick={() => void run('episode-set-status', { status: published ? 'draft' : 'published' }, published ? 'Back to draft: off the feed.' : 'Published: in the feed and on your show.')}>{published ? 'Unpublish' : 'Publish'}</button>
          <button type="button" className="tp-btn" aria-pressed={ep.access === 'supporters'} onClick={() => void run('episode-set-access', { access: ep.access === 'supporters' ? 'everyone' : 'supporters' }, ep.access === 'supporters' ? 'Open to everyone.' : 'Supporters only: others hear a preview.')}><Lock className="h-3.5 w-3.5" /> {ep.access === 'supporters' ? 'Supporters' : 'Everyone'}</button>
          <input ref={file} type="file" accept=".vtt,.srt,.json,.txt,text/vtt,application/x-subrip,text/plain,application/json" hidden onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void uploadTranscript(fl); e.target.value = ''; }} />
          <button type="button" className="tp-btn" onClick={() => file.current?.click()} title="WebVTT or SRT from your editor follows along; plain text does not"><FileUp className="h-3.5 w-3.5" /> Transcript</button>
          {confirm
            ? <button type="button" className="tp-btn !border-[color:var(--tp-bad)] !text-[color:var(--tp-bad)]" onClick={() => void run('episode-delete', {}, 'Deleted.')}>Delete “{ep.title.slice(0, 24)}”?</button>
            : <button type="button" className="tp-btn tp-btn-quiet h-9 w-9 !p-0" aria-label={`Delete ${ep.title}`} onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
      {msg && <p className={`${msg.ok ? 'tp-ok' : 'tp-error'} mt-2`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </li>
  );
}

function PassPanel({ show }: { show: Show }) {
  const [pass, setPass] = useState<PassStatus | null>(null);
  const [price, setPrice] = useState('5');
  const [perks, setPerks] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void pc<PassStatus>('supporter-status', { showId: show.id }).then((r) => {
      if (!r.result) return;
      setPass(r.result);
      if (r.result.priceCC) setPrice(String(r.result.priceCC));
      if (r.result.perks) setPerks(r.result.perks);
    });
  }, [show.id]);
  const n = Number(price);
  const valid = price.trim() !== '' && Number.isFinite(n) && n >= 1 && n <= 500 && Math.round(n * 100) / 100 === n;
  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await pcw<PassStatus>('supporter-pass-set', { showId: show.id, priceCC: n, perks });
    setBusy(false);
    if (r.ok && r.result) { setPass(r.result); setMsg({ ok: true, text: pass?.hasPass ? 'Pass updated.' : 'Your supporter pass is on sale. Mark episodes “Supporters” to put them behind it.' }); }
    else setMsg({ ok: false, text: r.error || 'Could not set the pass.' });
  };
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[22px]">Supporter pass</h2>
      <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">One payment unlocks every supporters-only episode, now and later. Sold through the marketplace: you get 95%, withdrawable after 48 hours.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
        <label className="block"><span className="tp-label">Price in CC</span><input className="tp-input tp-mono mt-1" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} aria-invalid={!valid} /></label>
        <label className="block"><span className="tp-label">What supporters get</span><input className="tp-input mt-1" maxLength={600} placeholder="Bonus episodes, ad-free, early" value={perks} onChange={(e) => setPerks(e.target.value)} /></label>
      </div>
      <button type="button" className="tp-btn tp-btn-signal mt-3" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Saving…' : pass?.hasPass ? 'Update the pass' : 'Put a pass on sale'}</button>
      {!valid && <p className="mt-1 text-[12px] text-[color:var(--tp-muted)]">From 1 to 500 CC, in cents.</p>}
      {pass?.hasPass && <p className="tp-mono mt-2 text-[12px]">{pass.supporterCount ?? 0} supporter{pass.supporterCount === 1 ? '' : 's'} · {pass.supportersOnlyEpisodes} supporters-only episode{pass.supportersOnlyEpisodes === 1 ? '' : 's'}</p>}
      {msg && <p className={`${msg.ok ? 'tp-ok' : 'tp-error'} mt-2`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}

function EarningsPanel({ show }: { show: Show }) {
  const [e, setE] = useState<Earnings | null>(null);
  const load = useCallback(() => { void pc<Earnings>('show-earnings', { showId: show.id }).then((r) => setE(r.result)); }, [show.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onPodcastChanged(load), [load]);
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[22px]">What the show has earned</h2>
      {!e?.tips ? <div className="tp-skeleton mt-3 h-24" role="status" aria-label="Loading earnings" /> : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div><dt className="tp-label">Tips</dt><dd className="tp-display text-[28px]">{cc(e.tips.total)}</dd><dd className="tp-mono text-[11px] text-[color:var(--tp-muted)]">{e.tips.count} tip{e.tips.count === 1 ? '' : 's'} · as sent, before the transfer fee</dd></div>
            <div><dt className="tp-label">Supporters</dt><dd className="tp-display text-[28px]">{e.supporters}</dd></div>
            <div><dt className="tp-label">Passes</dt><dd className="tp-display text-[28px]">{e.passPriceCC ? cc(e.supporters * e.passPriceCC) : '—'}</dd><dd className="tp-mono text-[11px] text-[color:var(--tp-muted)]">before fees</dd></div>
          </dl>
          <p className="mt-2 text-[12px] text-[color:var(--tp-muted)]">{e.note}</p>
          {(e.tips.recent || []).length > 0 && <ul className="mt-2">{e.tips.recent.map((t, i) => <li key={i} className="tp-hair tp-mono flex justify-between py-1.5 text-[12.5px]"><span>{t.contentId === show.id ? 'The show' : 'An episode'}</span><span>{cc(t.amount)} · {dateline(t.at)}</span></li>)}</ul>}
        </>
      )}
    </section>
  );
}
