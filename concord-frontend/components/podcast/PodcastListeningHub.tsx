'use client';

/**
 * PodcastListeningHub — the listening-app surface that wires the
 * feature-parity backlog: RSS feed ingestion + auto-refresh, streaming
 * player with chapters, episode transcripts, personalized
 * recommendations, cross-device sync, and smart download rules.
 *
 * Every show / episode / position is real user data persisted by the
 * podcast domain macros — no seed or mock content.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Rss, Loader2, RefreshCw, Sparkles, MonitorSmartphone,
  DownloadCloud, FileText, Radio, Headphones, ChevronRight, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PodcastStreamPlayer } from './PodcastStreamPlayer';
import { PodcastTranscriptPanel } from './PodcastTranscriptPanel';

interface Show {
  id: string; title: string; author: string | null; category: string;
  feedUrl: string | null; episodeCount: number; subscribed: boolean;
  lastRefreshedAt?: string;
}
interface Episode {
  id: string; title: string; showTitle: string; durationSec: number;
  publishDate: string; played: boolean; progressPct: number;
  audioUrl?: string | null;
}
interface Recommendation extends Show { score: number; reason: string }
interface SyncPosition {
  episodeId: string; episodeTitle: string | null; showTitle: string | null;
  positionSec: number; played: boolean; updatedAt: string | null;
}
interface DownloadRule {
  showId: string; showTitle: string | null; autoDownload: boolean;
  keepRecent: number; updatedAt: string;
}

type HubTab = 'feeds' | 'discover' | 'sync' | 'rules';

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// A stable per-browser device label for cross-device sync attribution.
function deviceLabel(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = window.localStorage.getItem('podcast:deviceLabel');
    if (!id) {
      const ua = window.navigator.userAgent;
      const kind = /Mobi|Android/i.test(ua) ? 'phone' : 'desktop';
      id = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
      window.localStorage.setItem('podcast:deviceLabel', id);
    }
    return id;
  } catch {
    return 'web';
  }
}

export function PodcastListeningHub() {
  const [tab, setTab] = useState<HubTab>('feeds');
  const device = useMemo(() => deviceLabel(), []);

  // Shared state
  const [shows, setShows] = useState<Show[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recsBasedOn, setRecsBasedOn] = useState('');
  const [sync, setSync] = useState<{ positions: SyncPosition[]; nowResuming: SyncPosition | null; playbackSpeed: number } | null>(null);
  const [rules, setRules] = useState<DownloadRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-show drill-down
  const [openShowId, setOpenShowId] = useState<string | null>(null);
  const [openEpisodes, setOpenEpisodes] = useState<Episode[]>([]);
  const [streamEpisodeId, setStreamEpisodeId] = useState<string | null>(null);
  const [transcriptEp, setTranscriptEp] = useState<Episode | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [sh, rc, sy, rl] = await Promise.all([
      lensRun<{ shows: Show[] }>('podcast', 'show-list', {}),
      lensRun<{ recommendations: Recommendation[]; basedOn: string }>('podcast', 'recommendations', {}),
      lensRun<{ positions: SyncPosition[]; nowResuming: SyncPosition | null; playbackSpeed: number }>('podcast', 'sync-state', {}),
      lensRun<{ rules: DownloadRule[] }>('podcast', 'download-rule-list', {}),
    ]);
    setShows(sh.data?.result?.shows || []);
    setRecs(rc.data?.result?.recommendations || []);
    setRecsBasedOn(rc.data?.result?.basedOn || '');
    setSync(sy.data?.ok ? sy.data.result : null);
    setRules(rl.data?.result?.rules || []);
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── RSS feed ingestion + auto-refresh ──
  const [feedDraft, setFeedDraft] = useState({ title: '', feedUrl: '' });

  const addFeed = useCallback(async () => {
    const url = feedDraft.feedUrl.trim();
    if (!/^https?:\/\//i.test(url)) { setError('Enter a valid RSS feed URL (https://…).'); return; }
    setBusy('addFeed'); setError(null);
    // Create the show, then immediately ingest its RSS feed.
    const created = await lensRun<{ show: Show }>('podcast', 'show-add', {
      title: feedDraft.title.trim() || url,
      feedUrl: url,
    });
    const newShow = created.data?.result?.show;
    if (!newShow) { setError(created.data?.error || 'Could not add show'); setBusy(null); return; }
    const ingested = await lensRun<{ ingested: number }>('podcast', 'rss-refresh', { showId: newShow.id });
    setBusy(null);
    if (ingested.data?.ok) {
      // Title-cleanup: if user left title blank the show may need a friendlier label.
      await lensRun('podcast', 'show-subscribe', { id: newShow.id });
      setFeedDraft({ title: '', feedUrl: '' });
      flash(`Ingested ${ingested.data.result?.ingested ?? 0} episodes from feed`);
      await loadAll();
    } else {
      setError(ingested.data?.error || 'Feed could not be parsed');
    }
  }, [feedDraft, flash, loadAll]);

  const refreshFeed = useCallback(async (showId: string) => {
    setBusy(`refresh-${showId}`); setError(null);
    const r = await lensRun<{ ingested: number }>('podcast', 'rss-refresh', { showId });
    setBusy(null);
    if (r.data?.ok) {
      flash(`Refreshed — ${r.data.result?.ingested ?? 0} episodes`);
      await loadAll();
      if (openShowId === showId) await openShow(showId);
    } else {
      setError(r.data?.error || 'Refresh failed');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash, loadAll, openShowId]);

  const openShow = useCallback(async (showId: string) => {
    if (openShowId === showId) { setOpenShowId(null); return; }
    setOpenShowId(showId);
    const r = await lensRun<{ episodes: Episode[] }>('podcast', 'episode-list', { showId });
    setOpenEpisodes(r.data?.result?.episodes || []);
  }, [openShowId]);

  // ── Recommendations ──
  const subscribeRec = useCallback(async (showId: string) => {
    setBusy(`sub-${showId}`);
    await lensRun('podcast', 'show-subscribe', { id: showId });
    setBusy(null);
    await loadAll();
  }, [loadAll]);

  // ── Smart download rules ──
  const setRule = useCallback(async (showId: string, autoDownload: boolean, keepRecent: number) => {
    setBusy(`rule-${showId}`);
    await lensRun('podcast', 'download-rule-set', { showId, autoDownload, keepRecent });
    setBusy(null);
    await loadAll();
  }, [loadAll]);

  const runRules = useCallback(async () => {
    setBusy('runRules'); setError(null);
    const r = await lensRun<{ added: number; pruned: number }>('podcast', 'download-rule-run', {});
    setBusy(null);
    if (r.data?.ok) flash(`Smart download: +${r.data.result?.added ?? 0} downloaded, ${r.data.result?.pruned ?? 0} pruned`);
    else setError(r.data?.error || 'Rule run failed');
  }, [flash]);

  const tabs: Array<{ id: HubTab; label: string; icon: React.ReactNode }> = [
    { id: 'feeds', label: 'Feeds', icon: <Rss className="w-3.5 h-3.5" /> },
    { id: 'discover', label: 'For You', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'sync', label: 'Sync', icon: <MonitorSmartphone className="w-3.5 h-3.5" /> },
    { id: 'rules', label: 'Auto-download', icon: <DownloadCloud className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="rounded-xl border border-violet-500/20 bg-zinc-950/60 p-4 space-y-3">
      <header className="flex items-center gap-2 border-b border-violet-500/10 pb-2">
        <Radio className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-semibold text-white">Listening hub</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">rss · streaming · sync</span>
        <span className="ml-auto text-[10px] text-zinc-400">this device: {device}</span>
      </header>

      <div className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id} type="button" onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              tab === t.id ? 'bg-violet-600/20 text-violet-200' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900')}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {error && <div className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-2.5 py-1.5">{error}</div>}
      {notice && <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-2.5 py-1.5">{notice}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <>
          {/* ── FEEDS: RSS ingestion + auto-refresh + streaming + transcripts ── */}
          {tab === 'feeds' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_auto] gap-2">
                <input
                  value={feedDraft.title}
                  onChange={(e) => setFeedDraft({ ...feedDraft, title: e.target.value })}
                  placeholder="Show name (optional)"
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100"
                />
                <input
                  value={feedDraft.feedUrl}
                  onChange={(e) => setFeedDraft({ ...feedDraft, feedUrl: e.target.value })}
                  placeholder="https://feeds.example.com/show.xml"
                  className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono"
                />
                <button
                  type="button" onClick={addFeed} disabled={busy === 'addFeed'}
                  className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg"
                >
                  {busy === 'addFeed' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
                  Ingest feed
                </button>
              </div>

              {shows.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic py-4 text-center">No shows yet. Paste a podcast RSS feed URL above to ingest its episodes.</p>
              ) : (
                <ul className="space-y-2">
                  {shows.map((sh) => (
                    <li key={sh.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2.5">
                        <button type="button" onClick={() => openShow(sh.id)} className="flex items-center gap-2 min-w-0 text-left flex-1">
                          <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform shrink-0', openShowId === sh.id && 'rotate-90')} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-zinc-100 truncate">{sh.title}</p>
                            <p className="text-[10px] text-zinc-400 truncate">
                              {sh.episodeCount} episodes
                              {sh.feedUrl ? ' · RSS linked' : ' · no feed'}
                              {sh.lastRefreshedAt && ` · refreshed ${new Date(sh.lastRefreshedAt).toLocaleDateString()}`}
                            </p>
                          </div>
                        </button>
                        {sh.feedUrl && (
                          <button
                            type="button" onClick={() => refreshFeed(sh.id)} disabled={busy === `refresh-${sh.id}`}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg shrink-0"
                          >
                            {busy === `refresh-${sh.id}`
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />}
                            Refresh
                          </button>
                        )}
                      </div>
                      {openShowId === sh.id && (
                        <div className="border-t border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
                          {openEpisodes.length === 0 ? (
                            <p className="text-[11px] text-zinc-400 italic">No episodes. Refresh the RSS feed to ingest them.</p>
                          ) : (
                            <ul className="space-y-1">
                              {openEpisodes.map((ep) => (
                                <li key={ep.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-[12px] text-zinc-200 truncate">{ep.title}</p>
                                      <p className="text-[10px] text-zinc-400">{fmtDur(ep.durationSec)} · {ep.publishDate}{ep.progressPct > 0 ? ` · ${ep.progressPct}% played` : ''}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setStreamEpisodeId(streamEpisodeId === ep.id ? null : ep.id)}
                                      disabled={!ep.audioUrl}
                                      title={ep.audioUrl ? 'Stream episode' : 'No audio enclosure — refresh RSS'}
                                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 disabled:opacity-30 text-white rounded shrink-0"
                                    >
                                      <Headphones className="w-3 h-3" /> Play
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTranscriptEp(transcriptEp?.id === ep.id ? null : ep)}
                                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded shrink-0"
                                    >
                                      <FileText className="w-3 h-3" /> Transcript
                                    </button>
                                  </div>
                                  {streamEpisodeId === ep.id && (
                                    <div className="mt-2">
                                      <PodcastStreamPlayer
                                        episodeId={ep.id}
                                        deviceLabel={device}
                                        onClose={() => setStreamEpisodeId(null)}
                                        onProgress={loadAll}
                                      />
                                    </div>
                                  )}
                                  {transcriptEp?.id === ep.id && (
                                    <div className="mt-2">
                                      <PodcastTranscriptPanel
                                        episodeId={ep.id}
                                        episodeTitle={ep.title}
                                      />
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── DISCOVER: personalized recommendations ── */}
          {tab === 'discover' && (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-400">
                {recs.length > 0
                  ? `Recommended based on ${recsBasedOn}.`
                  : 'Recommendations appear once you subscribe to shows or listen to episodes.'}
              </p>
              {recs.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic py-6 text-center">No recommendations yet.</p>
              ) : (
                <ul className="space-y-2">
                  {recs.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-100 truncate">{r.title}</p>
                        <p className="text-[10px] text-zinc-400 truncate">{r.author || 'Unknown'} · {r.category}</p>
                        <p className="text-[11px] text-violet-400 mt-0.5">{r.reason}</p>
                      </div>
                      <span className="text-[10px] text-zinc-400 font-mono shrink-0">match {r.score}</span>
                      <button
                        type="button" onClick={() => subscribeRec(r.id)} disabled={busy === `sub-${r.id}`}
                        className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg shrink-0"
                      >
                        {busy === `sub-${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Subscribe
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── SYNC: cross-device playback positions ── */}
          {tab === 'sync' && (
            <div className="space-y-2">
              {sync?.nowResuming && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-950/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-violet-400 mb-0.5">Resume here</p>
                  <p className="text-sm font-semibold text-zinc-100 truncate">{sync.nowResuming.episodeTitle || 'Episode'}</p>
                  <p className="text-[11px] text-zinc-400">
                    {sync.nowResuming.showTitle} · at {fmtClock(sync.nowResuming.positionSec)}
                  </p>
                </div>
              )}
              <p className="text-[11px] text-zinc-400">
                Positions sync across every device. Playback speed: {sync?.playbackSpeed ?? 1}×.
              </p>
              {(sync?.positions || []).length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic py-6 text-center">No playback positions yet. Start streaming an episode.</p>
              ) : (
                <ul className="space-y-1">
                  {(sync?.positions || []).map((p) => (
                    <li key={p.episodeId} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[12px] text-zinc-200 truncate">{p.episodeTitle || 'Episode'}</p>
                        <p className="text-[10px] text-zinc-400 truncate">{p.showTitle}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-[11px] font-mono', p.played ? 'text-emerald-400' : 'text-violet-300')}>
                          {p.played ? 'finished' : fmtClock(p.positionSec)}
                        </p>
                        {p.updatedAt && <p className="text-[9px] text-zinc-400">{new Date(p.updatedAt).toLocaleString()}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ── RULES: smart auto-download ── */}
          {tab === 'rules' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-400">Auto-download the newest episodes of chosen shows.</p>
                <button
                  type="button" onClick={runRules} disabled={busy === 'runRules' || rules.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg"
                >
                  {busy === 'runRules' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DownloadCloud className="w-3.5 h-3.5" />}
                  Run rules now
                </button>
              </div>
              {shows.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic py-6 text-center">Add shows in the Feeds tab first.</p>
              ) : (
                <ul className="space-y-2">
                  {shows.map((sh) => {
                    const rule = rules.find((r) => r.showId === sh.id);
                    const on = rule?.autoDownload ?? false;
                    const keep = rule?.keepRecent ?? 3;
                    return (
                      <li key={sh.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-xl px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-zinc-100 truncate">{sh.title}</p>
                          <p className="text-[10px] text-zinc-400">{sh.episodeCount} episodes available</p>
                        </div>
                        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 shrink-0">
                          Keep
                          <select
                            value={keep}
                            onChange={(e) => setRule(sh.id, on, Number(e.target.value))}
                            className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100"
                          >
                            {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => setRule(sh.id, !on, keep)}
                          disabled={busy === `rule-${sh.id}`}
                          className={cn('flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border shrink-0',
                            on
                              ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300'
                              : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}
                        >
                          {busy === `rule-${sh.id}`
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : on ? <Check className="w-3 h-3" /> : <DownloadCloud className="w-3 h-3" />}
                          {on ? 'Auto on' : 'Auto off'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
