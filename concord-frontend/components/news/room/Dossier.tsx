'use client';

/**
 * The dossier beside the map: the world (busiest places, what could not be
 * placed) or one selected place (its numbers and stories). Opening a story
 * says why it sits where it does, which other outlets told it, and offers
 * what can really be done with it: open the original, keep it in the
 * library, save, steer recommendations, listen, keep for offline, look at
 * the source, weigh the coverage's bias.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Bookmark, BookmarkCheck, Volume2, Square, Download, ThumbsUp, ThumbsDown, Library, Scale, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { basisLine, news, since, type LibArticle, type Region, type Situation, type Story } from './roomApi';
import { placeName } from './WorldMap';
import { biasUnavailableText } from './bias-unavailable';

type Lib = Record<string, string>; // story id -> library article id

export function Dossier({ situation, regions, stories, selected, onSelect, openStory, setOpenStory, lib, setLib, notify }: {
  situation: Situation | null;
  regions: Region[];
  stories: Story[];
  selected: string | null;
  onSelect: (k: string | null) => void;
  openStory: Story | null;
  setOpenStory: (s: Story | null) => void;
  lib: Lib;
  setLib: (fn: (l: Lib) => Lib) => void;
  notify: (m: string) => void;
}) {
  const region = selected ? regions.find((r) => r.key === selected) || null : null;
  const [sort, setSort] = useState<'newest' | 'oldest' | 'coverage' | 'source'>('newest');
  const [source, setSource] = useState('');
  const scoped = useMemo(() => (selected ? stories.filter((s) => s.places.some((p) => p.key === selected)) : stories), [stories, selected]);
  const sources = useMemo(() => [...new Set(scoped.map((s) => s.source).filter(Boolean))].sort(), [scoped]);
  const list = useMemo(() => {
    const l = scoped.filter((s) => !source || s.source === source);
    const by = { newest: (a: Story, b: Story) => b.at.localeCompare(a.at), oldest: (a: Story, b: Story) => a.at.localeCompare(b.at), coverage: (a: Story, b: Story) => b.coverage - a.coverage || b.at.localeCompare(a.at), source: (a: Story, b: Story) => a.source.localeCompare(b.source) || b.at.localeCompare(a.at) }[sort];
    return [...l].sort(by);
  }, [scoped, source, sort]);
  useEffect(() => { if (source && !sources.includes(source)) setSource(''); }, [sources, source]);
  const unplaced = useMemo(() => stories.filter((s) => !s.places.length), [stories]);

  if (openStory) return <StoryCard story={openStory} all={stories} back={() => setOpenStory(null)} lib={lib} setLib={setLib} notify={notify} onPlace={(k) => { setOpenStory(null); onSelect(k); }} />;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sr-dossier">
      <header className="border-b sr-rule px-4 pb-3 pt-4">
        {selected ? (
          <>
            <button type="button" className="sr-btn sr-btn-ghost mb-2 h-6 px-1.5 text-[11px]" onClick={() => onSelect(null)}><ArrowLeft className="h-3 w-3" />World<span className="sr-kbd">esc</span></button>
            <h2 className="sr-display text-[30px] font-semibold leading-none" data-testid="sr-region-name">{placeName(selected)}</h2>
          </>
        ) : (
          <>
            <p className="sr-label">Dossier</p>
            <h2 className="sr-display mt-1 text-[30px] font-semibold leading-none">The World</h2>
          </>
        )}
        <dl className="mt-3 grid grid-cols-4 gap-2" data-testid="sr-region-stats">
          {(region
            ? [['Stories', region.count], ['Sources', region.sources], ['Last 3h', region.last3h], ['By outlet', region.outlet]]
            : [['Stories', stories.length], ['Places', regions.length], ['Placed', stories.filter((s) => s.places.length).length], ['Unplaced', unplaced.length]]
          ).map(([k, v]) => (
            <div key={k as string}>
              <dt className="sr-label text-[9.5px]">{k}</dt>
              <dd className={cn('sr-display text-[22px] font-semibold leading-tight', k === 'Last 3h' && Number(v) > 0 && 'sr-live-text', k === 'By outlet' && Number(v) > 0 && 'sr-outlet-text')}>{v as number}</dd>
            </div>
          ))}
        </dl>
        {region && Object.keys(region.categories).length > 0 && (
          <div className="mt-3 space-y-1" aria-label="What the coverage is about">
            {Object.entries(region.categories).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => (
              <div key={c} className="flex items-center gap-2 text-[11px]">
                <span className="sr-label w-16 text-[10px]">{c}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-sm bg-[var(--sr-raised)]"><span className="block h-full bg-[var(--sr-heat-3)]" style={{ width: `${(n / region.count) * 100}%` }} /></span>
                <span className="sr-mono w-6 text-right sr-muted">{n}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      <div className="sr-scroll min-h-0 flex-1 overflow-y-auto">
        {!selected && regions.length > 0 && (
          <section className="border-b sr-rule px-4 py-3" aria-label="Busiest places">
            <p className="sr-label mb-1.5">Busiest places</p>
            <ol className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {regions.slice(0, 10).map((r, i) => (
                <li key={r.key}>
                  <button type="button" className="flex w-full items-baseline gap-1.5 py-0.5 text-left text-[13px] hover:text-[color:var(--sr-text)]" onClick={() => onSelect(r.key)} data-testid="sr-busiest">
                    <span className="sr-mono w-4 text-[10px] sr-faint">{i + 1}</span>
                    <span className="sr-display min-w-0 flex-1 truncate text-[15px] font-medium sr-text-2">{placeName(r.key)}</span>
                    <span className="sr-mono text-[11px] sr-muted">{r.count}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section aria-label="Stories">
          <div className="flex items-center gap-2 px-4 pb-1 pt-3">
            <p className="sr-label min-w-0 flex-1 truncate">{selected ? `Stories from ${placeName(selected)}` : 'Stories'} <span className="sr-mono normal-case tracking-normal sr-faint">{list.length}</span></p>
            <select className="sr-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort stories" data-testid="sr-sort">
              <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="coverage">Most covered</option><option value="source">Outlet A–Z</option>
            </select>
            <select className="sr-select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Only this outlet" data-testid="sr-source-filter">
              <option value="">All outlets</option>{sources.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          {situation === null && <div className="space-y-2 px-4 py-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-sm bg-[var(--sr-raised)]" role="status" aria-label="Loading" />)}</div>}
          {situation && list.length === 0 && <p className="px-4 py-4 text-[13px] sr-muted">{selected ? 'Nothing from here in this span.' : 'No stories in this span.'}</p>}
          <ul>
            {list.slice(0, 60).map((s) => (
              <li key={s.id}>
                <button type="button" className="sr-story w-full px-4 py-2.5 text-left" onClick={() => setOpenStory(s)} data-testid="sr-story">
                  <p className="text-[14px] font-medium leading-snug">{s.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] sr-muted">
                    <span className="sr-mono">{since(s.at)}</span>
                    <span>·</span>
                    <span className="truncate">{s.source}</span>
                    {s.coverage > 1 && <span className="sr-mono sr-text-2">· {s.coverage} outlets</span>}
                    {s.basis && <span className="sr-tag" data-basis={s.basis}>{s.basis === 'mentioned' ? s.places.map((p) => placeName(p.key)).slice(0, 2).join(' · ') : `outlet: ${placeName(s.places[0].key)}`}</span>}
                    {s.kind === 'library' && <span className="sr-tag">library</span>}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {!selected && unplaced.length > 0 && (
            <p className="px-4 pb-4 pt-2 text-[11.5px] sr-faint">{unplaced.length} of these name no place and have no known outlet country, so the map leaves them off rather than guess.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function StoryCard({ story, all, back, lib, setLib, notify, onPlace }: { story: Story; all: Story[]; back: () => void; lib: Lib; setLib: (fn: (l: Lib) => Lib) => void; notify: (m: string) => void; onPlace: (k: string) => void }) {
  const libId = story.kind === 'library' ? story.id : lib[story.id] || null;
  const [art, setArt] = useState<LibArticle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ articleCount: number; factualityLabel: string; factualityRating: number; biasLean: string | null; biasReason: string | null; topicSpread: { topic: string; count: number }[] } | null>(null);
  const [bias, setBias] = useState<{ biasLevel: string | null; overallBiasScore: number | null; overallBiasReason?: string | null; sourceDiversity?: { uniqueSources: number; assessment: string } } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [offline, setOffline] = useState(false);
  const versions = all.filter((s) => s.clusterId === story.clusterId);

  useEffect(() => {
    setProfile(null); setBias(null); setArt(null);
    if (!libId) return;
    void (async () => {
      await news('article-mark-read', { id: libId });
      const r = await news<{ article: LibArticle }>('article-detail', { id: libId });
      if (r.ok) setArt(r.result.article);
    })();
  }, [libId]);
  useEffect(() => () => { if (typeof window !== 'undefined') window.speechSynthesis?.cancel(); }, []);

  /** A live story becomes a library article (source, link and time kept) so it can be saved, listened to and kept offline. */
  const keep = async (): Promise<string | null> => {
    if (libId) return libId;
    setBusy('keep');
    const r = await news<{ article: LibArticle }>('article-add', { title: story.title, source: story.source, url: story.url || '', publishedAt: story.at, topic: story.category });
    setBusy(null);
    if (!r.ok) { notify(r.message); return null; }
    setLib((l) => ({ ...l, [story.id]: r.result.article.id }));
    notify('Kept in your library.');
    return r.result.article.id;
  };
  const act = async (name: string, input: (id: string) => Record<string, unknown>, done: (res: Record<string, unknown>) => void) => {
    const id = await keep(); if (!id) return;
    setBusy(name);
    const r = await news<Record<string, unknown>>(name, input(id));
    setBusy(null);
    if (r.ok) done(r.result); else notify(r.message);
    const d = await news<{ article: LibArticle }>('article-detail', { id });
    if (d.ok) setArt(d.result.article);
  };
  const listen = async () => {
    if (speaking) { window.speechSynthesis?.cancel(); setSpeaking(false); return; }
    const id = await keep(); if (!id) return;
    const r = await news<{ segments: string[]; estimatedSeconds: number }>('article-audio', { id });
    if (!r.ok) { notify(r.message); return; }
    if (typeof window === 'undefined' || !window.speechSynthesis) { notify('This browser cannot read aloud.'); return; }
    window.speechSynthesis.cancel();
    const segs = r.result.segments;
    segs.forEach((t, i) => {
      const u = new SpeechSynthesisUtterance(t);
      if (i === segs.length - 1) u.onend = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    });
    setSpeaking(true);
  };
  const loadProfile = async () => {
    setBusy('profile');
    const r = await news<NonNullable<typeof profile>>('source-profile', { source: story.source });
    setBusy(null);
    if (r.ok) setProfile(r.result); else notify(r.message);
  };
  const weigh = async () => {
    setBusy('bias');
    const r = await news<NonNullable<typeof bias>>('biasDetection', { articles: versions.map((v) => ({ title: v.title, body: v.title, source: v.source, date: v.at })) });
    setBusy(null);
    if (r.ok) setBias(r.result); else notify(r.message);
  };

  return (
    <article className="sr-rise flex h-full min-h-0 flex-col" data-testid="sr-story-card">
      <div className="border-b sr-rule px-4 py-3">
        <button type="button" className="sr-btn sr-btn-ghost mb-2 h-6 px-1.5 text-[11px]" onClick={back}><ArrowLeft className="h-3 w-3" />Back<span className="sr-kbd">esc</span></button>
        <p className="sr-mono text-[11px] sr-muted">{new Date(story.at).toUTCString().slice(5, 22)} UTC · {story.source}</p>
        <h2 className="sr-display mt-1 text-[24px] font-semibold leading-[1.1]">{story.title}</h2>
        {art?.summary && <p className="mt-2 text-[13.5px] leading-relaxed sr-text-2">{art.summary}</p>}
      </div>
      <div className="sr-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section aria-label="Why it is on the map">
          <p className="sr-label mb-1">On the map</p>
          <p className="text-[13px] sr-text-2" data-testid="sr-basis">{basisLine(story, placeName)}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {story.places.map((p) => <button key={p.key} type="button" className="sr-tag hover:text-[color:var(--sr-text)]" data-basis={story.basis || undefined} onClick={() => onPlace(p.key)}>{placeName(p.key)}</button>)}
          </div>
        </section>

        <section aria-label="Who covered it">
          <p className="sr-label mb-1">Covered by {versions.length > 1 ? `${new Set(versions.map((v) => v.source)).size} outlets` : 'one outlet'}</p>
          <ul className="space-y-1">
            {versions.slice(0, 8).map((v) => (
              <li key={v.id} className="text-[12.5px]">
                {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="hover:underline">{v.source}</a> : <span>{v.source}</span>}
                <span className="sr-muted"> — {v.title}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-wrap gap-1.5" aria-label="Actions">
          {story.url && <a className="sr-btn" href={story.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Original</a>}
          {!libId && <button type="button" className="sr-btn" onClick={() => void keep()} disabled={busy === 'keep'} data-testid="sr-keep"><Library className="h-3.5 w-3.5" />Keep</button>}
          <button type="button" className="sr-btn" aria-pressed={!!art?.saved} onClick={() => void act('article-save', (id) => ({ id }), (r) => notify(r.saved ? 'Saved.' : 'Removed from saved.'))} disabled={!!busy} data-testid="sr-save">
            {art?.saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}{art?.saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="sr-btn" onClick={() => void listen()} aria-pressed={speaking}>{speaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}{speaking ? 'Stop' : 'Listen'}</button>
          <button type="button" className="sr-btn" aria-pressed={offline} onClick={() => void act('offline-sync', (id) => ({ id }), (r) => { setOffline(!!r.synced); notify(r.synced ? 'Kept for offline reading.' : 'Removed from offline.'); })} disabled={!!busy}><Download className="h-3.5 w-3.5" />Offline</button>
          <button type="button" className="sr-btn sr-btn-ghost" onClick={() => void act('article-react', (id) => ({ id, kind: 'more' }), () => notify('More like this.'))} disabled={!!busy} aria-label="More like this"><ThumbsUp className="h-3.5 w-3.5" /></button>
          <button type="button" className="sr-btn sr-btn-ghost" onClick={() => void act('article-react', (id) => ({ id, kind: 'less' }), () => notify('Less like this.'))} disabled={!!busy} aria-label="Less like this"><ThumbsDown className="h-3.5 w-3.5" /></button>
        </section>

        <section aria-label="The source">
          <div className="flex items-center justify-between">
            <p className="sr-label">The source</p>
            {!profile && <button type="button" className="sr-btn sr-btn-ghost h-6 px-2 text-[11px]" onClick={() => void loadProfile()} disabled={busy === 'profile'}><Building2 className="h-3 w-3" />Profile {story.source}</button>}
          </div>
          {profile && (
            <p className="mt-1 text-[12.5px] sr-text-2" data-testid="sr-profile">
              {profile.articleCount ? <>From {profile.articleCount} of its stories in your library: factuality <span className="sr-mono">{profile.factualityRating}</span> ({profile.factualityLabel}); lean {profile.biasLean || biasUnavailableText(profile.biasReason).toLowerCase()}.</> : 'None of its stories are in the library yet, so there is nothing to profile.'}
            </p>
          )}
        </section>

        <section aria-label="Bias in the coverage">
          <div className="flex items-center justify-between">
            <p className="sr-label">Bias in the coverage</p>
            {!bias && <button type="button" className="sr-btn sr-btn-ghost h-6 px-2 text-[11px]" onClick={() => void weigh()} disabled={busy === 'bias'}><Scale className="h-3 w-3" />Weigh {versions.length} version{versions.length === 1 ? '' : 's'}</button>}
          </div>
          {bias && (
            <p className="mt-1 text-[12.5px] sr-text-2" data-testid="sr-bias">
              {bias.overallBiasScore == null
                ? `${biasUnavailableText(bias.overallBiasReason || 'no_bias_terms')}. That is not the same as neutral.`
                : <>Bias {bias.biasLevel} (<span className="sr-mono">{bias.overallBiasScore}</span>).</>}
              {bias.sourceDiversity && <> Source diversity: {bias.sourceDiversity.assessment} ({bias.sourceDiversity.uniqueSources} source{bias.sourceDiversity.uniqueSources === 1 ? '' : 's'}).</>}
            </p>
          )}
        </section>
      </div>
    </article>
  );
}
