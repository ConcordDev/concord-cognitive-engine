'use client';

/**
 * The Desk: everything that is not the map, in the room's own voice.
 *   Briefing — the daily briefing (live feed) and today's library digest.
 *   Watch    — alerts (breaking / topic / outlet) and what you follow.
 *   Library  — add a story, search, saved, history, recommended, trending, offline.
 *   Analyst  — events, narrative shifts, story clusters and the bias spectrum,
 *              run over the stories on the map right now.
 *   Delivery — when your digest arrives.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Bell, BellOff, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { news, since, type LibArticle, type Story } from './roomApi';

export type DeskTab = 'briefing' | 'watch' | 'library' | 'analyst' | 'delivery';
const TABS: { id: DeskTab; label: string }[] = [
  { id: 'briefing', label: 'Briefing' }, { id: 'watch', label: 'Watch' }, { id: 'library', label: 'Library' },
  { id: 'analyst', label: 'Analyst' }, { id: 'delivery', label: 'Delivery' },
];

export function DeskDrawer({ tab, setTab, onClose, stories, notify, onChanged }: {
  tab: DeskTab; setTab: (t: DeskTab) => void; onClose: () => void;
  stories: Story[]; notify: (m: string) => void; onChanged: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button type="button" className="sr-scrim absolute inset-0" aria-label="Close the desk" onClick={onClose} />
      <aside className="sr-drawer relative flex h-full w-full max-w-[480px] flex-col" role="dialog" aria-label="Desk" data-testid="sr-desk" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <header className="flex items-center justify-between border-b sr-rule px-4 py-3">
          <h2 className="sr-display text-[22px] font-semibold tracking-wide">THE DESK</h2>
          <button type="button" className="sr-btn sr-btn-ghost h-8 w-8 justify-center px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <nav className="flex gap-1 border-b sr-rule px-3 py-2" role="tablist" aria-label="Desk sections">
          {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="sr-btn h-7 px-2.5 text-[11.5px]" onClick={() => setTab(t.id)} data-testid={`sr-desk-${t.id}`}>{t.label}</button>)}
        </nav>
        <div className="sr-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === 'briefing' && <Briefing />}
          {tab === 'watch' && <Watch notify={notify} />}
          {tab === 'library' && <LibraryTab notify={notify} onChanged={onChanged} />}
          {tab === 'analyst' && <Analyst stories={stories} />}
          {tab === 'delivery' && <Delivery notify={notify} />}
        </div>
      </aside>
    </div>
  );
}

const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="sr-label mb-2 mt-5 first:mt-0">{children}</h3>;
const Loading = () => <div className="h-16 animate-pulse rounded-sm bg-[var(--sr-raised)]" role="status" aria-label="Loading" />;

function ArticleRow({ a, right }: { a: Pick<LibArticle, 'title' | 'source' | 'publishedAt' | 'url'>; right?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 border-b sr-rule py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium leading-snug hover:underline">{a.title}</a> : <p className="text-[13.5px] font-medium leading-snug">{a.title}</p>}
        <p className="sr-mono mt-0.5 text-[11px] sr-muted">{a.source} · {since(a.publishedAt)}</p>
      </div>
      {right}
    </li>
  );
}

// ── Briefing ───────────────────────────────────────────────────────────
interface BriefSection { heading: string; bullets: string[]; status?: string; unavailableReason?: string }
function Briefing() {
  const [b, setB] = useState<Record<string, unknown> | null>(null);
  const [digest, setDigest] = useState<{ topStories: LibArticle[]; totalArticles: number } | null>(null);
  useEffect(() => {
    void news<Record<string, unknown>>('daily-briefing').then((r) => setB(r.ok ? r.result : {}));
    void news<{ topStories: LibArticle[]; totalArticles: number }>('today-digest').then((r) => setDigest(r.ok ? r.result : { topStories: [], totalArticles: 0 }));
  }, []);
  const sections = b ? (Object.values(b).filter((v) => v && typeof v === 'object' && 'bullets' in (v as object)) as BriefSection[]) : [];
  return (
    <div data-testid="sr-briefing">
      {!b && <Loading />}
      {b && <p className="sr-display text-[17px] font-medium sr-text-2">{String(b.greeting || '')}</p>}
      {sections.map((s) => (
        <section key={s.heading}>
          <H3>{s.heading}</H3>
          {s.bullets.length ? <ul className="list-disc space-y-1 pl-4 text-[13px]">{s.bullets.map((x, i) => <li key={i}>{x}</li>)}</ul>
            : <p className="text-[12.5px] sr-faint">Nothing came in for this section{s.unavailableReason ? ' — the live feed is unreachable right now' : ''}.</p>}
        </section>
      ))}
      <H3>Today in your library</H3>
      {!digest && <Loading />}
      {digest && (digest.topStories.length ? <ul>{digest.topStories.map((a) => <ArticleRow key={a.id} a={a} />)}</ul> : <p className="text-[12.5px] sr-faint">Nothing kept in the library today.</p>)}
    </div>
  );
}

// ── Watch ──────────────────────────────────────────────────────────────
interface Sub { id: string; kind: string; target: string }
interface AlertItem { id: string; title: string; source: string; kind: string; deliveredAt: string; read: boolean }
function Watch({ notify }: { notify: (m: string) => void }) {
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [topics, setTopics] = useState<{ topic: string; articleCount: number; followed: boolean }[]>([]);
  const [channels, setChannels] = useState<{ source: string; articleCount: number; followed: boolean }[]>([]);
  const [kind, setKind] = useState<'topic' | 'channel' | 'breaking'>('topic');
  const [target, setTarget] = useState('');
  const load = useCallback(async () => {
    const [s, a, t, c] = await Promise.all([
      news<{ subscriptions: Sub[] }>('alert-list'), news<{ alerts: AlertItem[] }>('alert-feed'),
      news<{ topics: typeof topics }>('topic-list'), news<{ channels: typeof channels }>('channel-list'),
    ]);
    setSubs(s.ok ? s.result.subscriptions : []);
    if (a.ok) setAlerts(a.result.alerts);
    if (t.ok) setTopics(t.result.topics);
    if (c.ok) setChannels(c.result.channels);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const subscribe = async () => {
    const r = await news('alert-subscribe', { kind, target: kind === 'breaking' ? '*' : target.trim() });
    if (!r.ok) { notify(r.message); return; }
    setTarget(''); void load();
  };
  return (
    <div data-testid="sr-watch">
      <H3>Alert me</H3>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void subscribe(); }}>
        <select className="sr-input w-28 flex-shrink-0" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Alert on">
          <option value="topic">Topic</option><option value="channel">Outlet</option><option value="breaking">Breaking</option>
        </select>
        {kind !== 'breaking' && <input className="sr-input" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === 'topic' ? 'world, climate…' : 'Reuters, BBC News…'} aria-label="Alert target" />}
        <button type="submit" className="sr-btn flex-shrink-0" disabled={kind !== 'breaking' && !target.trim()}><Bell className="h-3.5 w-3.5" />Watch</button>
      </form>
      {subs && subs.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {subs.map((s) => (
            <li key={s.id}><button type="button" className="sr-tag hover:text-[color:var(--sr-text)]" onClick={async () => { await news('alert-subscribe', { kind: s.kind, target: s.target }); void load(); }} aria-label={`Stop watching ${s.target}`}><BellOff className="mr-1 h-3 w-3" />{s.kind === 'breaking' ? 'breaking' : `${s.kind}: ${s.target}`}</button></li>
          ))}
        </ul>
      )}
      <H3>Alerts {alerts.filter((a) => !a.read).length ? <span className="sr-live-text">· {alerts.filter((a) => !a.read).length} new</span> : null}</H3>
      {alerts.length ? <ul>{alerts.slice(0, 20).map((a) => <ArticleRow key={a.id} a={{ title: a.title, source: `${a.source} · ${a.kind}`, publishedAt: a.deliveredAt, url: null }} />)}</ul> : <p className="text-[12.5px] sr-faint">No alerts yet. They come from stories added to the library that match what you watch.</p>}
      <H3>Follow topics</H3>
      <div className="flex flex-wrap gap-1.5">
        {topics.map((t) => <button key={t.topic} type="button" className="sr-btn h-7 px-2 text-[11px]" aria-pressed={t.followed} onClick={async () => { await news('topic-follow', { topic: t.topic }); void load(); }}>{t.topic} <span className="sr-mono sr-faint">{t.articleCount}</span></button>)}
        {!topics.length && <p className="text-[12.5px] sr-faint">Topics appear as stories are kept.</p>}
      </div>
      <H3>Follow outlets</H3>
      <div className="flex flex-wrap gap-1.5">
        {channels.map((c) => <button key={c.source} type="button" className="sr-btn h-7 px-2 text-[11px] normal-case" aria-pressed={c.followed} onClick={async () => { await news('channel-follow', { source: c.source }); void load(); }}>{c.source} <span className="sr-mono sr-faint">{c.articleCount}</span></button>)}
        {!channels.length && <p className="text-[12.5px] sr-faint">Outlets appear as stories are kept.</p>}
      </div>
    </div>
  );
}

// ── Library ────────────────────────────────────────────────────────────
type LibView = 'saved' | 'recent' | 'for-you' | 'trending' | 'offline' | 'search';
function LibraryTab({ notify, onChanged }: { notify: (m: string) => void; onChanged: () => void }) {
  const [view, setView] = useState<LibView>('saved');
  const [items, setItems] = useState<LibArticle[] | null>(null);
  const [stats, setStats] = useState<{ totalRead: number; thisWeek: number; saved: number; topTopics: { topic: string; count: number }[] } | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ title: '', source: '', url: '', summary: '', topic: '' });
  const load = useCallback(async () => {
    setItems(null);
    const map: Record<LibView, [string, Record<string, unknown>, string]> = {
      saved: ['saved-list', {}, 'articles'], recent: ['reading-history', {}, 'history'], 'for-you': ['recommended', {}, 'articles'],
      trending: ['trending', {}, 'articles'], offline: ['offline-list', {}, 'articles'], search: ['article-search', { query: q }, 'articles'],
    };
    const [action, input, key] = map[view];
    const r = await news<Record<string, unknown>>(action, input);
    const rows = r.ok ? ((r.result[key] as Array<LibArticle & { articleId?: string }>) || []).map((a) => ({ ...a, id: a.id || a.articleId || '' })) : [];
    setItems(rows);
    const s = await news<NonNullable<typeof stats>>('reading-stats');
    if (s.ok) setStats(s.result);
  }, [view, q]);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    if (!form.title.trim()) return;
    const r = await news('article-add', { ...form, topic: form.topic || 'general' });
    if (!r.ok) { notify(r.message); return; }
    setForm({ title: '', source: '', url: '', summary: '', topic: '' });
    notify('Added to the library. If it names a place, it is on the map.');
    onChanged(); void load();
  };
  const remove = async (id: string) => {
    const r = await news('article-delete', { id });
    if (!r.ok) { notify(r.message); return; }
    onChanged(); void load();
  };
  return (
    <div data-testid="sr-library">
      {stats && (
        <dl className="mb-4 grid grid-cols-3 gap-2">
          {[['Read', stats.totalRead], ['This week', stats.thisWeek], ['Saved', stats.saved]].map(([k, v]) => (
            <div key={k as string} className="sr-raised rounded-sm px-2.5 py-2"><dt className="sr-label text-[9.5px]">{k}</dt><dd className="sr-display text-[22px] font-semibold leading-none">{v as number}</dd></div>
          ))}
        </dl>
      )}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Library view">
        {(['saved', 'recent', 'for-you', 'trending', 'offline', 'search'] as LibView[]).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className="sr-btn h-7 px-2 text-[11px]" onClick={() => setView(v)}>{v.replace('-', ' ')}</button>)}
      </div>
      {view === 'search' && (
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <input className="sr-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" aria-label="Search the library" />
          <button type="submit" className="sr-btn"><Search className="h-3.5 w-3.5" /></button>
        </form>
      )}
      <div className="mt-2">
        {items === null && <Loading />}
        {items && !items.length && <p className="py-2 text-[12.5px] sr-faint">Nothing here yet.</p>}
        <ul>{items?.map((a) => <ArticleRow key={a.id} a={a} right={<button type="button" className="rounded p-1 sr-faint hover:text-[color:var(--sr-live)]" onClick={() => void remove(a.id)} aria-label={`Delete ${a.title}`}><Trash2 className="h-3.5 w-3.5" /></button>} />)}</ul>
      </div>
      <RecordsExport />
      <H3>Add a story</H3>
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void add(); }} data-testid="sr-add-story">
        <input className="sr-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Headline" aria-label="Headline" required />
        <div className="flex gap-1.5">
          <input className="sr-input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Outlet" aria-label="Outlet" />
          <input className="sr-input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Topic" aria-label="Topic" />
        </div>
        <input className="sr-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Link (optional)" aria-label="Link" />
        <textarea className="sr-input" rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Summary (optional)" aria-label="Summary" />
        <button type="submit" className="sr-btn" disabled={!form.title.trim()}><Plus className="h-3.5 w-3.5" />Add to library</button>
      </form>
    </div>
  );
}

/**
 * The reader's own records — library, saved, alert subscriptions, digest
 * schedule — as one JSON file that actually downloads, with the counts said
 * back. A failed read says so and downloads nothing.
 */
function RecordsExport() {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setNote(null);
    const [articles, saved, alerts, digest] = await Promise.all([
      news<{ articles: LibArticle[] }>('article-list'), news<{ articles: LibArticle[] }>('saved-list'),
      news<{ subscriptions: unknown[] }>('alert-list'), news<Record<string, unknown>>('digest-schedule-get'),
    ]);
    setBusy(false);
    const failed = [articles, saved, alerts, digest].find((r) => !r.ok);
    if (failed && !failed.ok) { setNote(`Export failed — ${failed.message}. Nothing was downloaded.`); return; }
    if (!articles.ok || !saved.ok || !alerts.ok || !digest.ok) return;
    const payload = { kind: 'concord-news-my-records', exportedAt: new Date().toISOString(), articles: articles.result.articles, saved: saved.result.articles, alertSubscriptions: alerts.result.subscriptions, digestSchedule: digest.result };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'news-my-records.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setNote(`Exported ${payload.articles.length} stories · ${payload.saved.length} saved · ${payload.alertSubscriptions.length} alert subscriptions. The file is in your downloads.`);
  };
  return (
    <div className="mt-4">
      <button type="button" className="sr-btn" onClick={() => void run()} disabled={busy} data-testid="sr-export">{busy ? 'Preparing…' : 'Export my records'}</button>
      {note && <p className="mt-1.5 text-[12px] sr-text-2" role="status" data-testid="sr-export-note">{note}</p>}
    </div>
  );
}

// ── Analyst ────────────────────────────────────────────────────────────
function Analyst({ stories }: { stories: Story[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<{ eventsExtracted?: number; topEntities?: { entity: string; mentions: number }[]; timeline?: { when?: string; action?: string; who?: string[]; where?: string }[]; message?: string } | null>(null);
  const [narrative, setNarrative] = useState<{ stabilityLevel?: string; narrativeStability?: number; shiftCount?: number; message?: string } | null>(null);
  const [clusters, setClusters] = useState<{ headline: string; articleCount: number; sourceCount: number; sources: string[] }[] | null>(null);
  const [spectrum, setSpectrum] = useState<{ left: number; center: number; right: number; unscored: number } | null>(null);
  const set = stories.slice(0, 60).map((s) => ({ title: s.title, body: s.title, source: s.source, date: s.at }));
  const run = async (what: string) => {
    setBusy(what);
    if (what === 'events') { const r = await news<NonNullable<typeof events>>('eventExtraction', { articles: set }); setEvents(r.ok ? r.result : { message: r.message }); }
    if (what === 'narrative') { const r = await news<NonNullable<typeof narrative>>('narrativeTracking', { articles: set }); setNarrative(r.ok ? r.result : { message: r.message }); }
    if (what === 'clusters') { const r = await news<{ clusters: NonNullable<typeof clusters> }>('story-clusters'); setClusters(r.ok ? r.result.clusters : []); }
    if (what === 'spectrum') {
      const r = await news<{ columns: Record<string, unknown[]> }>('bias-spectrum');
      if (r.ok) { const c = r.result.columns; setSpectrum({ left: c.left?.length || 0, center: c.center?.length || 0, right: c.right?.length || 0, unscored: c.unscored?.length || 0 }); }
    }
    setBusy(null);
  };
  const runBtn = (id: string, label: string) => <button type="button" className="sr-btn h-7 px-2.5 text-[11px]" onClick={() => void run(id)} disabled={!!busy}>{busy === id ? 'Working…' : label}</button>;
  return (
    <div data-testid="sr-analyst">
      <p className="text-[12.5px] sr-muted">Runs over the <span className="sr-mono sr-text-2">{set.length}</span> stories on the map in the current span, or over the library where noted.</p>
      <H3>Who did what, where</H3>
      {runBtn('events', 'Extract events')}
      {events && (events.message ? <p className="mt-2 text-[12.5px] sr-faint">{events.message}</p> : (
        <div className="mt-2 text-[12.5px]">
          <p className="sr-text-2"><span className="sr-mono">{events.eventsExtracted}</span> events. Most named: {(events.topEntities || []).slice(0, 6).map((e) => `${e.entity} (${e.mentions})`).join(', ') || 'none'}.</p>
          <ul className="mt-1 space-y-0.5">{(events.timeline || []).slice(0, 6).map((t, i) => <li key={i} className="sr-muted">{[t.who?.join(', '), t.action, t.where].filter(Boolean).join(' · ')}</li>)}</ul>
        </div>
      ))}
      <H3>Is the story shifting?</H3>
      {runBtn('narrative', 'Track narrative')}
      {narrative && <p className="mt-2 text-[12.5px] sr-text-2">{narrative.message || `Framing is ${narrative.stabilityLevel} (stability ${narrative.narrativeStability}), ${narrative.shiftCount} shift${narrative.shiftCount === 1 ? '' : 's'}.`}</p>}
      <H3>Same story, many outlets <span className="normal-case tracking-normal sr-faint">· library</span></H3>
      {runBtn('clusters', 'Group stories')}
      {clusters && (clusters.length ? <ul className="mt-2 space-y-1.5">{clusters.slice(0, 8).map((c, i) => <li key={i} className="text-[12.5px]"><p className="font-medium">{c.headline}</p><p className="sr-mono text-[11px] sr-muted">{c.articleCount} stories · {c.sourceCount} outlets: {c.sources.join(', ')}</p></li>)}</ul> : <p className="mt-2 text-[12.5px] sr-faint">Nothing in the library yet.</p>)}
      <H3>Where the library leans <span className="normal-case tracking-normal sr-faint">· library</span></H3>
      {runBtn('spectrum', 'Show spectrum')}
      {spectrum && (
        <div className="mt-2">
          <div className="flex h-2.5 overflow-hidden rounded-sm bg-[var(--sr-raised)]" aria-hidden>
            {(['left', 'center', 'right'] as const).map((k) => { const tot = spectrum.left + spectrum.center + spectrum.right; return tot ? <span key={k} className={cn('h-full', k === 'left' ? 'bg-[var(--sr-heat-2)]' : k === 'center' ? 'bg-[var(--sr-outlet)]' : 'bg-[var(--sr-heat-4)]')} style={{ width: `${(spectrum[k] / tot) * 100}%` }} /> : null; })}
          </div>
          <p className="sr-mono mt-1 text-[11px] sr-muted">left {spectrum.left} · center {spectrum.center} · right {spectrum.right} · not measurable {spectrum.unscored}</p>
        </div>
      )}
    </div>
  );
}

// ── Delivery ───────────────────────────────────────────────────────────
function Delivery({ notify }: { notify: (m: string) => void }) {
  const [sched, setSched] = useState<{ schedule: { cadence: string; hour: number; topicsOnly: boolean } | null; nextDelivery: string | null } | null>(null);
  const [cadence, setCadence] = useState('daily');
  const [hour, setHour] = useState(7);
  const [topicsOnly, setTopicsOnly] = useState(false);
  const load = useCallback(async () => {
    const r = await news<NonNullable<typeof sched>>('digest-schedule-get');
    if (r.ok) { setSched(r.result); if (r.result.schedule) { setCadence(r.result.schedule.cadence); setHour(r.result.schedule.hour); setTopicsOnly(r.result.schedule.topicsOnly); } }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    const r = await news('digest-schedule-set', { cadence, hour, topicsOnly });
    notify(r.ok ? 'Delivery updated.' : r.message);
    void load();
  };
  return (
    <div data-testid="sr-delivery">
      <H3>Your digest</H3>
      <div className="flex gap-1" role="radiogroup" aria-label="How often">
        {['daily', 'weekdays', 'weekly', 'off'].map((c) => <button key={c} type="button" role="radio" aria-checked={cadence === c} className="sr-btn h-7 px-2.5 text-[11px]" aria-pressed={cadence === c} onClick={() => setCadence(c)}>{c}</button>)}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px]">At
        <input type="number" min={0} max={23} className="sr-input sr-mono w-16" value={hour} onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))} aria-label="Hour" />:00
      </label>
      <label className="mt-2 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={topicsOnly} onChange={(e) => setTopicsOnly(e.target.checked)} />Only topics I follow</label>
      <button type="button" className="sr-btn mt-3" onClick={() => void save()}>Save delivery</button>
      {sched?.nextDelivery && <p className="sr-mono mt-3 text-[12px] sr-text-2">Next: {new Date(sched.nextDelivery).toLocaleString()}</p>}
    </div>
  );
}
