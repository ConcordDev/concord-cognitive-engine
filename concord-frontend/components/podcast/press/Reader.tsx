'use client';

/**
 * The page: an episode set as a magazine feature. Kicker (the show),
 * headline, dek, byline, then the transcript as the body, with timecodes in
 * the margin and chapters as section heads. While it plays, the passage
 * being said is underlined in signal orange as the audio moves through it;
 * tap any passage to hear it from there. Only real timings do this: an
 * untimed transcript reads as text and says it can't follow along, and a
 * supporters-only episode shows only its preview to a non-supporter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ListPlus, Search, Check, FileText, Play, Pause } from 'lucide-react';
import { SupportBox } from './SupportBox';
import { clock, dateline, length, pc, pcw, usePlayer, writeAddress, type Episode, type Segment, type Show, type Transcript } from './pc';
import { onPodcastChanged } from '../podcast-events';

export function Reader({ episodeId }: { episodeId: string }) {
  const player = usePlayer();
  const [ep, setEp] = useState<Episode | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [tr, setTr] = useState<Transcript | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Set<number>>(new Set());
  const [follow, setFollow] = useState(true);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const nowRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    const e = await pc<{ episode: Episode }>('episode-detail', { id: episodeId });
    if (!e.ok || !e.result) { setErr(e.error); return; }
    setEp(e.result.episode);
    const [s, t] = await Promise.all([
      pc<{ show: Show }>('show-detail', { id: e.result.episode.showId }),
      pc<Transcript>('transcript-get', { episodeId }),
    ]);
    if (s.ok && s.result) setShow(s.result.show);
    setTr(t.ok ? t.result : null);
  }, [episodeId]);
  useEffect(() => { setEp(null); setTr(null); setErr(null); void load(); }, [load]);
  useEffect(() => onPodcastChanged(() => { void load(); }), [load]);

  const segs = tr?.segments || [];
  const timed = tr?.timing === 'timed';
  const here = player.episodeId === episodeId;
  const pos = here ? player.position : -1;
  const nowIdx = useMemo(() => {
    if (!timed || pos < 0) return -1;
    let idx = -1;
    for (let i = 0; i < segs.length; i++) { const s = segs[i].startSec; if (s != null && s <= pos) idx = i; else if (s != null && s > pos) break; }
    return idx;
  }, [segs, timed, pos]);

  // Keep the passage being said in view while following.
  useEffect(() => {
    if (follow && nowRef.current && player.playing) nowRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [nowIdx, follow, player.playing]);

  const search = async () => {
    if (!q.trim()) { setHits(new Set()); return; }
    const r = await pc<{ matches: { startSec: number | null; text: string }[] }>('transcript-search', { episodeId, query: q.trim() });
    const set = new Set<number>();
    for (const m of r.result?.matches || []) { const i = segs.findIndex((x) => x.text === m.text && x.startSec === m.startSec); if (i >= 0) set.add(i); }
    setHits(set);
    setNote(r.ok ? `${set.size} passage${set.size === 1 ? '' : 's'} match “${q.trim()}”.` : r.error);
    const first = [...set][0];
    if (first != null) document.getElementById(`tp-seg-${first}`)?.scrollIntoView({ block: 'center' });
  };

  const importFeed = async () => {
    setImporting(true);
    const r = await pcw<{ segmentCount: number; timing: string }>('transcript-import', { episodeId });
    setImporting(false);
    setNote(r.ok && r.result ? `Fetched the feed's transcript: ${r.result.segmentCount} passages${r.result.timing === 'timed' ? ', timed' : ', untimed'}.` : r.error);
    if (r.ok) void load();
  };

  const act = async (action: string, input: Record<string, unknown>, done: string) => {
    const r = await pcw(action, input);
    setNote(r.ok ? done : r.error);
    if (r.ok) void load();
  };

  if (err) return <div className="tp-article px-4 py-10"><p className="tp-error" role="alert">{err}</p><button type="button" className="tp-btn mt-3" onClick={() => writeAddress({ ep: null })}>Back</button></div>;
  if (!ep) return <div className="tp-article space-y-3 px-4 py-10" aria-label="Loading the episode" role="status"><div className="tp-skeleton h-4 w-32" /><div className="tp-skeleton h-12 w-full" /><div className="tp-skeleton h-24 w-full" /></div>;

  const chapterAt = (i: number) => {
    const s = segs[i]?.startSec;
    if (!timed || s == null || !ep.chapters?.length) return null;
    const prev = i > 0 ? segs[i - 1].startSec ?? -1 : -1;
    return ep.chapters.find((c) => c.startSec > prev && c.startSec <= s) || null;
  };
  const progressIn = (seg: Segment, i: number) => {
    if (i !== nowIdx || seg.startSec == null) return 0;
    const end = seg.endSec ?? segs[i + 1]?.startSec ?? seg.startSec + 6;
    return Math.max(0, Math.min(100, ((pos - seg.startSec) / Math.max(0.5, end - seg.startSec)) * 100));
  };
  const playFrom = (sec: number) => { if (here) { player.seek(sec); if (!player.playing) player.toggle(); } else player.load(episodeId, { at: sec, autoplay: true }); };

  return (
    <article className="px-4 pb-16 pt-6 sm:px-8" data-testid="tp-reader">
      <div className="tp-article">
        <button type="button" className="tp-btn tp-btn-quiet -ml-3 mb-4" onClick={() => writeAddress({ ep: null })}><ArrowLeft className="h-4 w-4" /> Back</button>
        <button type="button" className="tp-kicker hover:underline" onClick={() => writeAddress({ room: 'shows', show: ep.showId, ep: null })}>{ep.showTitle}</button>
        <h1 className="tp-display mt-2 text-[34px] leading-[1.08] sm:text-[44px]">{ep.title}</h1>
        {ep.description && <p className="tp-dek mt-3">{ep.description}</p>}
        <p className="tp-label tp-rule mt-5 pt-2 !tracking-[0.08em]">
          {show?.author ? `${show.author} · ` : ''}{dateline(ep.publishDate)} · {length(ep.durationSec)}
          {ep.episodeNumber ? ` · Episode ${ep.episodeNumber}` : ''}{ep.access === 'supporters' ? ' · Supporters' : ''}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="tp-btn tp-btn-signal" disabled={!ep.audioUrl} onClick={() => (here ? player.toggle() : player.load(episodeId, { autoplay: true }))} data-testid="tp-listen">
            {here && player.playing ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> {ep.positionSec > 0 && !ep.played ? `Resume at ${clock(ep.positionSec)}` : ep.locked ? `Listen to the ${Math.round((ep.previewSec || 0) / 60 * 10) / 10}-minute preview` : 'Listen'}</>}
          </button>
          <button type="button" className="tp-btn" onClick={() => act(ep.inQueue ? 'queue-remove' : 'queue-add', { episodeId }, ep.inQueue ? 'Taken off Up next.' : 'Added to Up next.')}><ListPlus className="h-4 w-4" /> {ep.inQueue ? 'In Up next' : 'Up next'}</button>
          <button type="button" className="tp-btn" onClick={() => act(ep.downloaded ? 'download-remove' : 'download-episode', { episodeId }, ep.downloaded ? 'Removed from downloads.' : 'Kept for offline.')}><Download className="h-4 w-4" /> {ep.downloaded ? 'Kept' : 'Keep'}</button>
          <button type="button" className="tp-btn tp-btn-quiet" onClick={() => act('episode-mark-played', { episodeId, unplayed: ep.played }, ep.played ? 'Marked unplayed.' : 'Marked played.')}><Check className="h-4 w-4" /> {ep.played ? 'Played' : 'Mark played'}</button>
          {!ep.audioUrl && <span className="text-[12.5px] text-[color:var(--tp-muted)]">No audio on this episode yet.</span>}
        </div>
        {note && <p className="mt-3 text-[13px] text-[color:var(--tp-ink-2)]" role="status">{note}</p>}

        {/* The body: the transcript */}
        <section className="mt-10" aria-label="Transcript">
          <div className="tp-hair mb-4 flex flex-wrap items-center gap-2 pt-3">
            <p className="tp-label mr-auto flex items-center gap-1"><FileText className="h-3 w-3" /> Transcript{tr?.source === 'feed' ? ' · from the show’s feed' : ''}</p>
            {timed && segs.length > 0 && (
              <>
                <form className="relative" onSubmit={(e) => { e.preventDefault(); void search(); }}>
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--tp-faint)]" />
                  <input className="tp-input !min-h-[32px] w-48 pl-7 text-[13px]" placeholder="Find in transcript" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in transcript" />
                </form>
                <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow along</label>
              </>
            )}
          </div>

          {!tr?.hasTranscript ? (
            <div className="tp-body text-[color:var(--tp-muted)]">
              <p>No transcript yet.</p>
              {ep.feedTranscript && <button type="button" className="tp-btn mt-3" onClick={importFeed} disabled={importing}>{importing ? 'Fetching…' : 'Fetch the transcript this show publishes'}</button>}
              {ep.canEdit && <p className="mt-2 text-[14px]">Add one from Your show: upload the WebVTT or SRT file your editor exports, and it will follow along as people listen.</p>}
            </div>
          ) : !timed ? (
            <div className="tp-body">
              <p className="tp-label mb-3 !normal-case !tracking-normal">This transcript has no timings, so it can’t follow along or jump to a moment.</p>
              {segs.map((s, i) => <p key={i} className="tp-seg tp-untimed">{s.speaker && <span className="tp-speaker">{s.speaker}</span>}{s.text}</p>)}
            </div>
          ) : (
            <div className="tp-body sm:pl-[84px]" data-testid="tp-transcript">
              {segs.map((s, i) => {
                const ch = chapterAt(i);
                const speakerChanged = s.speaker && s.speaker !== segs[i - 1]?.speaker;
                return (
                  <div key={i}>
                    {ch && <h2 className="tp-chapter">{ch.title}</h2>}
                    {speakerChanged && <span className="tp-speaker">{s.speaker}</span>}
                    <button
                      id={`tp-seg-${i}`}
                      ref={i === nowIdx ? nowRef : undefined}
                      type="button"
                      className="tp-seg"
                      data-now={i === nowIdx}
                      data-past={nowIdx >= 0 && i < nowIdx}
                      data-hit={hits.has(i)}
                      aria-current={i === nowIdx ? 'true' : undefined}
                      onClick={() => s.startSec != null && playFrom(s.startSec)}
                      title={`Listen from ${clock(s.startSec)}`}
                    >
                      <span className="tp-tc tp-mono" aria-hidden>{clock(s.startSec)}</span>
                      <span className="tp-said" style={{ ['--tp-said' as string]: `${progressIn(s, i)}%` }}>{s.text}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tr?.locked && (
            <div className="tp-lock" data-testid="tp-locked">
              <p className="tp-kicker">Supporters read on</p>
              <p className="tp-read mt-1 text-[17px]">You’ve reached the end of the preview{typeof tr.totalSegments === 'number' ? `: ${tr.totalSegments - segs.length} more passages` : ''}. The rest of this episode is for the show’s supporters.</p>
              {show && <div className="mt-3"><SupportBox show={show} episodeId={episodeId} compact onSupported={() => void load()} /></div>}
            </div>
          )}
        </section>

        {show && !tr?.locked && <div className="mt-12"><SupportBox show={show} episodeId={episodeId} /></div>}
      </div>
    </article>
  );
}
