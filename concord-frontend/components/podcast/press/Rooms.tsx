'use client';

/**
 * The listener's rooms: the Front page (what you were in the middle of, Up
 * next, new from your shows, recommendations) and Shows (the directory, a
 * show's own page with its episodes, reviews and support, and adding shows
 * from Apple's directory or any RSS feed).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Lock, Play, Plus, Rss, Search, Star, X } from 'lucide-react';
import { onPodcastChanged } from '../podcast-events';
import { SupportBox } from './SupportBox';
import { clock, dateline, length, pc, pcw, usePlayer, writeAddress, type Episode, type Show } from './pc';

/** Load on mount, when `key` changes, and whenever another room changes something. */
function useLoad<T>(fn: () => Promise<T>, key: string): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => { void fnRef.current().then((d) => { setData(d); setLoading(false); }); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => onPodcastChanged(reload), [reload]);
  return { data, loading, reload };
}

export function Cover({ src, title, size = 64 }: { src: string | null; title: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className="tp-cover shrink-0" style={{ width: size, height: size }} loading="lazy" />
    : <span aria-hidden className="tp-cover tp-display flex shrink-0 items-center justify-center text-[color:var(--tp-faint)]" style={{ width: size, height: size, fontSize: size / 2.4 }}>{title.slice(0, 1).toUpperCase()}</span>;
}

/** One episode as a story on a front page. */
export function Story({ ep, cover, extra }: { ep: Episode; cover?: string | null; extra?: ReactNode }) {
  const player = usePlayer();
  const here = player.episodeId === ep.id;
  return (
    <li className="tp-story">
      <Cover src={cover ?? ep.coverUrl ?? null} title={ep.showTitle} />
      <div className="min-w-0">
        <p className="tp-kicker !text-[10px]">{ep.showTitle}</p>
        <h3><button type="button" className="text-left hover:underline" onClick={() => writeAddress({ ep: ep.id })}>{ep.title}</button></h3>
        <p className="tp-mono mt-1 text-[11.5px] text-[color:var(--tp-muted)]">
          {dateline(ep.publishDate)} · {length(ep.durationSec)}{ep.positionSec > 0 && !ep.played ? ` · ${clock(ep.durationSec - ep.positionSec)} left` : ''}{ep.played ? ' · played' : ''}{ep.hasTranscript ? ' · transcript' : ''}
        </p>
        {ep.progressPct > 0 && !ep.played && <div className="tp-progress mt-2 w-40" aria-label={`${ep.progressPct}% listened`}><span style={{ width: `${ep.progressPct}%` }} /></div>}
      </div>
      <div className="flex items-center gap-1">
        {extra}
        {ep.locked && <Lock className="h-3.5 w-3.5 text-[color:var(--tp-muted)]" aria-label="Supporters-only" />}
        <button type="button" className="tp-btn h-9 w-9 !rounded-full !p-0" disabled={!ep.audioUrl} aria-label={`${here && player.playing ? 'Pause' : 'Play'} ${ep.title}`}
          onClick={() => (here ? player.toggle() : player.load(ep.id, { autoplay: true }))}>
          <Play className="ml-0.5 h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function Column({ title, children, empty, loading, count }: { title: string; children: ReactNode; empty: string; loading: boolean; count: number }) {
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[22px]">{title}</h2>
      {loading ? <div className="mt-3 space-y-3" role="status" aria-label={`Loading ${title}`}>{[0, 1, 2].map((i) => <div key={i} className="tp-skeleton h-16" />)}</div>
        : count === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">{empty}</p>
        : <ul>{children}</ul>}
    </section>
  );
}

export function FrontPage() {
  const cont = useLoad(() => pc<{ episodes: Episode[] }>('continue-listening'), '');
  const queue = useLoad(() => pc<{ episodes: Episode[] }>('queue-list'), '');
  const fresh = useLoad(() => pc<{ episodes: Episode[] }>('new-episodes'), '');
  const recs = useLoad(() => pc<{ recommendations: (Show & { reason: string })[]; basedOn: string }>('recommendations'), '');
  const stats = useLoad(() => pc<{ listenedHours: number; episodesCompleted: number; subscriptions: number }>('listening-stats'), '');
  const move = async (episodeId: string, direction: 'up' | 'down') => { await pcw('queue-reorder', { episodeId, direction }); };
  const lead = cont.data?.result?.episodes?.[0];

  return (
    <div className="space-y-10" data-testid="tp-front">
      {lead && (
        <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <p className="tp-kicker">Where you left off</p>
            <button type="button" className="tp-display mt-1 text-left text-[34px] leading-[1.05] hover:underline sm:text-[40px]" onClick={() => writeAddress({ ep: lead.id })}>{lead.title}</button>
            <p className="tp-dek mt-2">{lead.showTitle} · {clock(lead.durationSec - lead.positionSec)} left</p>
            <div className="tp-progress mt-3 max-w-md"><span style={{ width: `${lead.progressPct}%` }} /></div>
          </div>
          {stats.data?.result && (
            <dl className="tp-card grid grid-cols-3 gap-2 self-start p-3 text-center">
              <div><dt className="tp-label">Hours</dt><dd className="tp-display text-[26px]">{stats.data.result.listenedHours}</dd></div>
              <div><dt className="tp-label">Finished</dt><dd className="tp-display text-[26px]">{stats.data.result.episodesCompleted}</dd></div>
              <div><dt className="tp-label">Shows</dt><dd className="tp-display text-[26px]">{stats.data.result.subscriptions}</dd></div>
            </dl>
          )}
        </section>
      )}
      <div className="grid gap-10 lg:grid-cols-3">
        <Column title="In progress" loading={cont.loading} count={cont.data?.result?.episodes?.length || 0} empty="Nothing half-heard. Start an episode and it waits for you here.">
          {(cont.data?.result?.episodes || []).map((ep) => <Story key={ep.id} ep={ep} />)}
        </Column>
        <Column title="Up next" loading={queue.loading} count={queue.data?.result?.episodes?.length || 0} empty="Your queue is empty. Add episodes with “Up next”.">
          {(queue.data?.result?.episodes || []).map((ep, i, all) => (
            <Story key={ep.id} ep={ep} extra={<>
              <button type="button" className="tp-btn tp-btn-quiet h-8 w-8 !p-0" aria-label={`Move ${ep.title} up`} disabled={i === 0} onClick={() => void move(ep.id, 'up')}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" className="tp-btn tp-btn-quiet h-8 w-8 !p-0" aria-label={`Move ${ep.title} down`} disabled={i === all.length - 1} onClick={() => void move(ep.id, 'down')}><ArrowDown className="h-3.5 w-3.5" /></button>
            </>} />
          ))}
        </Column>
        <Column title="New from your shows" loading={fresh.loading} count={fresh.data?.result?.episodes?.length || 0} empty="Follow shows and their new episodes land here.">
          {(fresh.data?.result?.episodes || []).slice(0, 12).map((ep) => <Story key={ep.id} ep={ep} />)}
        </Column>
      </div>
      <section>
        <h2 className="tp-display tp-rule pt-2 text-[22px]">You might like</h2>
        {recs.loading ? <div className="tp-skeleton mt-3 h-24" role="status" aria-label="Loading recommendations" />
          : !recs.data?.result?.recommendations?.length ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">No suggestions yet: there are no shows you don’t already follow.</p>
          : (
            <>
              <p className="mt-1 text-[12.5px] text-[color:var(--tp-muted)]">Picked from your {recs.data.result.basedOn}.</p>
              <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {recs.data.result.recommendations.slice(0, 8).map((s) => (
                  <li key={s.id}><button type="button" className="flex w-full gap-3 text-left" onClick={() => writeAddress({ room: 'shows', show: s.id })}>
                    <Cover src={s.coverUrl} title={s.title} size={56} />
                    <span className="min-w-0"><span className="tp-display block truncate text-[17px]">{s.title}</span><span className="block text-[12px] text-[color:var(--tp-muted)]">{s.reason}</span></span>
                  </button></li>
                ))}
              </ul>
            </>
          )}
      </section>
    </div>
  );
}

// ── Shows ────────────────────────────────────────────────────────────────

interface Review { id: string; userId: string; rating: number; text: string; createdAt: string }
interface ApplePodcast { collectionId: number; title: string; artist: string; genre: string; artwork: string | null; feedUrl: string | null; episodeCount: number | null }

export function ShowsRoom({ showId }: { showId: string | null }) {
  return showId ? <ShowPage showId={showId} /> : <Directory />;
}

function Directory() {
  const [cat, setCat] = useState<string>('all');
  const [mine, setMine] = useState(false);
  const list = useLoad(() => pc<{ shows: Show[] }>('show-list', mine ? { subscribed: true } : {}), mine ? 'mine' : 'all');
  const shows = list.data?.result?.shows || [];
  const cats = ['all', ...Array.from(new Set(shows.map((s) => s.category).filter(Boolean))).sort()];
  const shown = cat === 'all' ? shows : shows.filter((s) => s.category === cat);
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="tp-shows">
      <section>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="tp-chip" aria-pressed={!mine} onClick={() => setMine(false)}>All shows</button>
          <button type="button" className="tp-chip" aria-pressed={mine} onClick={() => setMine(true)}>Following</button>
          <span className="mx-2 h-4 w-px bg-[var(--tp-rule-2)]" aria-hidden />
          {cats.map((c) => <button key={c} type="button" className="tp-chip capitalize" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        {list.loading ? <div className="mt-4 grid gap-4 sm:grid-cols-2" role="status" aria-label="Loading shows">{[0, 1, 2, 3].map((i) => <div key={i} className="tp-skeleton h-24" />)}</div>
          : shown.length === 0 ? <p className="mt-4 text-[14px] text-[color:var(--tp-muted)]">{mine ? 'You don’t follow any shows yet.' : 'No shows here yet. Add one from Apple’s directory or an RSS feed.'}</p>
          : (
            <ul className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {shown.map((s) => (
                <li key={s.id} className="tp-hair flex gap-3 pt-4">
                  <Cover src={s.coverUrl} title={s.title} size={72} />
                  <div className="min-w-0">
                    <button type="button" className="tp-display text-left text-[19px] leading-tight hover:underline" onClick={() => writeAddress({ show: s.id })}>{s.title}</button>
                    <p className="text-[12.5px] text-[color:var(--tp-muted)]">{s.author || (s.isCreatorShow ? 'Made on Concord' : 'From an RSS feed')}</p>
                    <p className="tp-mono mt-1 text-[11.5px] text-[color:var(--tp-muted)]">{s.episodeCount} episodes · {s.subscriberCount} following{s.rating ? ` · ★ ${s.rating}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>
      <aside className="space-y-8">
        <AppleDirectory onAdded={list.reload} />
        <AddByFeed onAdded={list.reload} />
      </aside>
    </div>
  );
}

function AppleDirectory({ onAdded }: { onAdded: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ApplePodcast[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const search = async () => {
    setBusy(true); setErr(null);
    const r = await pc<{ podcasts: ApplePodcast[] }>('itunes-search', { query: q.trim(), limit: 12 });
    setBusy(false);
    if (r.ok) setRes(r.result?.podcasts || []); else { setErr(r.error); setRes(null); }
  };
  const add = async (p: ApplePodcast) => {
    setAdding(p.collectionId); setErr(null);
    const a = await pc<{ show: Show }>('show-add', { title: p.title, author: p.artist, category: p.genre, feedUrl: p.feedUrl, artworkUrl: p.artwork });
    if (!a.ok || !a.result?.show?.id) { setAdding(null); setErr(a.error || 'Could not add it.'); return; }
    if (p.feedUrl) {
      const f = await pc('rss-refresh', { showId: a.result.show.id });
      if (!f.ok) setErr(`Added, but its feed did not load: ${f.error}`);
    }
    if (!a.result.show.subscribed) await pc('show-subscribe', { id: a.result.show.id });
    await pcw('show-detail', { id: a.result.show.id });
    setAdding(null);
    setAdded((s) => new Set(s).add(p.collectionId));
    onAdded();
  };
  return (
    <section>
      <h2 className="tp-display tp-rule pt-2 text-[20px]">Apple Podcasts directory</h2>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void search(); }}>
        <input className="tp-input" placeholder="A show or a topic" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Apple Podcasts" />
        <button type="submit" className="tp-btn" disabled={!q.trim() || busy} aria-label="Search"><Search className="h-4 w-4" /></button>
      </form>
      {err && <p className="tp-error mt-2" role="alert">{err}</p>}
      {busy && <div className="tp-skeleton mt-3 h-20" role="status" aria-label="Searching" />}
      {res && !busy && (res.length === 0 ? <p className="mt-2 text-[13px] text-[color:var(--tp-muted)]">Nothing found for “{q}”.</p> : (
        <ul className="mt-2">
          {res.map((p) => (
            <li key={p.collectionId} className="tp-hair flex items-center gap-3 py-2">
              <Cover src={p.artwork} title={p.title} size={44} />
              <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-semibold">{p.title}</p><p className="truncate text-[11.5px] text-[color:var(--tp-muted)]">{p.artist}{p.episodeCount ? ` · ${p.episodeCount} episodes` : ''}</p></div>
              <button type="button" className="tp-btn h-8 !px-2.5 text-[12px]" disabled={!p.feedUrl || added.has(p.collectionId) || adding === p.collectionId} onClick={() => void add(p)} title={p.feedUrl ? 'Follow and pull its episodes' : 'Apple lists no public feed for this show'}>
                {added.has(p.collectionId) ? 'Following' : adding === p.collectionId ? 'Adding…' : <><Plus className="h-3.5 w-3.5" /> Follow</>}
              </button>
            </li>
          ))}
        </ul>
      ))}
    </section>
  );
}

function AddByFeed({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const add = async () => {
    setBusy(true); setMsg(null);
    const a = await pc<{ show: Show }>('show-add', { title: title.trim() || url.trim(), feedUrl: url.trim() });
    if (!a.ok || !a.result?.show?.id) { setBusy(false); setMsg({ ok: false, text: a.error || 'Could not add it.' }); return; }
    const f = await pc<{ ingested: number }>('rss-refresh', { showId: a.result.show.id });
    if (!a.result.show.subscribed) await pc('show-subscribe', { id: a.result.show.id });
    setBusy(false);
    setMsg(f.ok && f.result ? { ok: true, text: `Following. ${f.result.ingested} episodes pulled from the feed.` } : { ok: false, text: `Added, but the feed did not load: ${f.error}` });
    setUrl(''); setTitle('');
    onAdded();
  };
  return (
    <section>
      <h2 className="tp-display tp-rule flex items-center gap-2 pt-2 text-[20px]"><Rss className="h-4 w-4" /> Any RSS feed</h2>
      <div className="mt-2 space-y-2">
        <input className="tp-input" placeholder="https://… feed address" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Feed address" inputMode="url" />
        <input className="tp-input" placeholder="Name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Show name" />
        <button type="button" className="tp-btn w-full" disabled={busy || !/^https?:\/\/\S+$/i.test(url.trim())} onClick={() => void add()}>{busy ? 'Reading the feed…' : 'Follow this feed'}</button>
      </div>
      {msg && <p className={`${msg.ok ? 'tp-ok' : 'tp-error'} mt-2`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </section>
  );
}

function ShowPage({ showId }: { showId: string }) {
  const detail = useLoad(() => pc<{ show: Show; reviews: Review[] }>('show-detail', { id: showId }), showId);
  const eps = useLoad(() => pc<{ episodes: Episode[] }>('episode-list', { showId }), showId);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const show = detail.data?.result?.show;
  if (detail.data && !detail.data.ok) return <div><p className="tp-error" role="alert">{detail.data.error}</p><button type="button" className="tp-btn mt-3" onClick={() => writeAddress({ show: null })}>All shows</button></div>;
  if (!show) return <div className="space-y-3" role="status" aria-label="Loading the show"><div className="tp-skeleton h-40" /><div className="tp-skeleton h-24" /></div>;
  const follow = async () => { const r = await pcw('show-subscribe', { id: show.id }); if (!r.ok) setMsg({ ok: false, text: r.error || 'Could not follow.' }); };
  const refresh = async () => { const r = await pcw<{ ingested: number }>('rss-refresh', { showId: show.id }); setMsg(r.ok && r.result ? { ok: true, text: `${r.result.ingested} episodes in the feed.` } : { ok: false, text: r.error || 'The feed did not load.' }); };
  const review = async () => {
    const r = await pcw('show-rate', { showId: show.id, rating, text });
    setMsg(r.ok ? { ok: true, text: 'Review saved.' } : { ok: false, text: r.error || 'Could not save your review.' });
    if (r.ok) { setText(''); setRating(0); }
  };
  const episodes = (eps.data?.result?.episodes || []).slice().sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)));
  return (
    <div data-testid="tp-show">
      <button type="button" className="tp-btn tp-btn-quiet -ml-3 mb-3" onClick={() => writeAddress({ show: null })}><X className="h-4 w-4" /> All shows</button>
      <header className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)_300px]">
        <Cover src={show.coverUrl} title={show.title} size={180} />
        <div className="min-w-0">
          <p className="tp-kicker">{show.isCreatorShow ? 'Made on Concord' : 'From an RSS feed'}{show.category && show.category !== 'general' ? ` · ${show.category}` : ''}</p>
          <h1 className="tp-display mt-1 text-[36px] leading-[1.05] sm:text-[44px]">{show.title}</h1>
          {show.author && <p className="tp-dek mt-1">by {show.author}</p>}
          {show.description && <p className="tp-read mt-3 text-[16px] leading-relaxed text-[color:var(--tp-ink-2)]">{show.description}</p>}
          <p className="tp-mono mt-3 text-[12px] text-[color:var(--tp-muted)]">{show.episodeCount} episodes · {show.subscriberCount} following · {show.reviewCount ? `★ ${show.rating} from ${show.reviewCount}` : 'no reviews yet'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={show.subscribed ? 'tp-btn' : 'tp-btn tp-btn-signal'} onClick={() => void follow()} aria-pressed={show.subscribed}>{show.subscribed ? 'Following' : 'Follow'}</button>
            {show.feedUrl && <button type="button" className="tp-btn" onClick={() => void refresh()}>Check the feed for new episodes</button>}
          </div>
          {msg && <p className={`${msg.ok ? 'tp-ok' : 'tp-error'} mt-3`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        </div>
        <SupportBox show={show} />
      </header>

      <section className="mt-10">
        <h2 className="tp-display tp-rule pt-2 text-[22px]">Episodes</h2>
        {eps.loading ? <div className="tp-skeleton mt-3 h-40" role="status" aria-label="Loading episodes" />
          : episodes.length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">No episodes yet.</p>
          : <ul>{episodes.map((ep) => <Story key={ep.id} ep={ep} cover={show.coverUrl} />)}</ul>}
      </section>

      <section className="mt-10 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="tp-display tp-rule pt-2 text-[22px]">Reviews</h2>
          {(detail.data?.result?.reviews || []).length === 0 ? <p className="mt-3 text-[14px] text-[color:var(--tp-muted)]">No reviews yet.</p> : (
            <ul>{detail.data!.result!.reviews.slice(0, 10).map((r) => (
              <li key={r.id} className="tp-hair py-3"><p className="tp-mono text-[12px]" aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>{r.text && <p className="tp-read mt-1 text-[15px]">{r.text}</p>}<p className="mt-1 text-[11px] text-[color:var(--tp-faint)]">{dateline(r.createdAt)}</p></li>
            ))}</ul>
          )}
        </div>
        <div>
          <h2 className="tp-display tp-rule pt-2 text-[22px]">Your review</h2>
          <div className="mt-3 flex gap-1" role="radiogroup" aria-label="Your rating">
            {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="tp-btn tp-btn-quiet h-9 w-9 !p-0" onClick={() => setRating(n)}><Star className="h-4 w-4" fill={n <= rating ? 'currentColor' : 'none'} /></button>)}
          </div>
          <textarea className="tp-input mt-2 h-24 py-2" maxLength={1000} placeholder="What makes it worth the time?" value={text} onChange={(e) => setText(e.target.value)} aria-label="Review" />
          <button type="button" className="tp-btn mt-2" disabled={!rating} onClick={() => void review()}>Save review</button>
        </div>
      </section>
    </div>
  );
}
