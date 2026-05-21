'use client';

/**
 * MusicParityPanel — surfaces the 17 Spotify-parity backlog features:
 * free-API ingestion, auto lyrics, playback engine config, offline
 * downloads, device handoff, karaoke, AI DJ voice, AI playlist,
 * scheduled playlists, smart recommendations, Jam, friend activity,
 * collaborative editing, share cards, stream analytics, artist
 * canvas/profile, and concert listings. Every action wires a real
 * `music` macro via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Download, Smartphone, Mic, Radio, ListMusic, Calendar,
  Sparkles, Users, Share2, BarChart3, Palette, Globe, Plug, Music2,
  SlidersHorizontal, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── shared types ────────────────────────────────────────────────────
interface Track {
  id: string; title: string; artist: string; genre: string;
  durationSec: number; playCount?: number; liked?: boolean;
  previewUrl?: string | null; artworkUrl?: string | null;
}
interface DownloadEntry { trackId: string; title: string; artist: string; sizeKb: number }
interface Device { id: string; name: string; kind: string; active: boolean }
interface ScheduledPlaylist { kind: string; refreshedAt: string; nextRefreshAt: string; mood: string | null; trackCount: number; due: boolean }
interface FriendActivity { userId: string; kind: string; track: { title: string; artist: string; genre: string }; at: string }
interface ShareCard { id: string; kind: string; title: string; subtitle: string; gradient: string[]; shareUrl: string }
interface StreamAnalytics {
  totalStreams: number; uniqueListeners: number; catalogSize: number;
  avgStreamsPerTrack: number; bySource: Record<string, number>;
  topTracks: { title: string; streams: number }[]; genreSplit: Record<string, number>;
}
interface ArtistProfile { bio: string; canvasUrl: string | null; pickTrackId: string | null; links: { label: string; url: string }[] }
interface ConcertEvent { mbid: string; name: string; date: string | null; time: string | null }
interface EngineConfig {
  config: {
    crossfadeSec: number; gapless: boolean; normalize: boolean; quality: string;
    eq?: { enabled: boolean; preset: string; bands: { bass: number; mid: number; treble: number } };
    karaoke?: { enabled: boolean; vocalReductionPct: number; scrollLyrics: boolean };
  };
  normalizeTargetDb: number; crossfadeMs: number;
}

function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

type SubTab = 'ingest' | 'engine' | 'discover' | 'social' | 'artist';
const SUBTABS: { id: SubTab; label: string; icon: typeof Radio }[] = [
  { id: 'ingest', label: 'Catalog', icon: Globe },
  { id: 'engine', label: 'Playback', icon: SlidersHorizontal },
  { id: 'discover', label: 'Discover', icon: Sparkles },
  { id: 'social', label: 'Social', icon: Users },
  { id: 'artist', label: 'Artist', icon: BarChart3 },
];

export function MusicParityPanel({ onChange }: { onChange: () => void }) {
  const [sub, setSub] = useState<SubTab>('ingest');
  return (
    <div className="space-y-3">
      <nav className="flex gap-1 overflow-x-auto">
        {SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setSub(t.id)}
              className={cn('flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500',
                active ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-700/50' : 'text-zinc-400 hover:text-zinc-200 border border-transparent')}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>
      {sub === 'ingest' && <CatalogTab onChange={onChange} />}
      {sub === 'engine' && <EngineTab />}
      {sub === 'discover' && <DiscoverTab onChange={onChange} />}
      {sub === 'social' && <SocialTab onChange={onChange} />}
      {sub === 'artist' && <ArtistTab onChange={onChange} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// CATALOG — iTunes ingestion (1), LRCLIB auto-lyrics (2), downloads (4)
// ════════════════════════════════════════════════════════════════════
function CatalogTab({ onChange }: { onChange: () => void }) {
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState('');
  const [ingested, setIngested] = useState<Track[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [downloadKb, setDownloadKb] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lyricsMsg, setLyricsMsg] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [t, d] = await Promise.all([
      lensRun('music', 'track-list', {}),
      lensRun('music', 'download-list', {}),
    ]);
    setTracks(t.data?.result?.tracks || []);
    setDownloads(d.data?.result?.downloads || []);
    setDownloadKb(d.data?.result?.totalSizeKb || 0);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const ingest = async () => {
    if (!term.trim()) return;
    setBusy(true); setIngestMsg('');
    const r = await lensRun('music', 'ingest-itunes', { term: term.trim(), limit: 12 });
    if (r.data?.ok) {
      setIngested(r.data.result?.tracks || []);
      setIngestMsg(`Ingested ${r.data.result?.ingested || 0} tracks (${r.data.result?.skipped || 0} already in library).`);
      await refresh();
    } else {
      setIngestMsg(r.data?.error || 'iTunes ingestion failed.');
    }
    setBusy(false); onChange();
  };

  const fetchLyrics = async (id: string) => {
    setLyricsMsg((m) => ({ ...m, [id]: 'fetching…' }));
    const r = await lensRun('music', 'lyrics-autofetch', { id });
    if (r.data?.ok) {
      const res = r.data.result as { found: boolean; lineCount?: number; synced?: boolean };
      setLyricsMsg((m) => ({ ...m, [id]: res.found ? `${res.lineCount} lines${res.synced ? ' (synced)' : ''}` : 'no lyrics found' }));
    } else {
      setLyricsMsg((m) => ({ ...m, [id]: r.data?.error || 'lookup failed' }));
    }
  };

  const download = async (id: string) => {
    await lensRun('music', 'download-add', { trackId: id });
    await refresh(); onChange();
  };
  const removeDownload = async (id: string) => {
    await lensRun('music', 'download-remove', { trackId: id });
    await refresh(); onChange();
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-4">
      {/* iTunes ingestion */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Globe} title="Free-API Catalog Ingestion" hint="iTunes Search — real previewable tracks, no key" />
        <div className="flex gap-2">
          <input value={term} onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void ingest(); }}
            placeholder="Search iTunes for tracks to ingest…"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button type="button" onClick={ingest} disabled={busy || !term.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Ingest'}
          </button>
        </div>
        {ingestMsg && <p className="mt-2 text-[11px] text-emerald-300">{ingestMsg}</p>}
        {ingested.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
            {ingested.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-[11px] text-zinc-300">
                {t.artworkUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.artworkUrl} alt="" className="w-6 h-6 rounded shrink-0" />
                )}
                <span className="truncate flex-1">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
                <span className="text-[10px] text-zinc-600">{dur(t.durationSec)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Auto-lyrics + downloads, per track */}
      <section>
        <Head icon={Mic} title="Auto Lyrics & Offline Downloads" hint="LRCLIB synced lyrics · device-side cache" />
        {tracks.length === 0 ? (
          <Empty text="No tracks in your library yet." />
        ) : (
          <ul className="space-y-1">
            {tracks.slice(0, 20).map((t) => {
              const isDownloaded = downloads.some((d) => d.trackId === t.id);
              return (
                <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <Music2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-[11px] text-zinc-200 truncate flex-1">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
                  {lyricsMsg[t.id] && <span className="text-[10px] text-violet-300">{lyricsMsg[t.id]}</span>}
                  <button type="button" onClick={() => fetchLyrics(t.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 hover:bg-violet-800/50">Lyrics</button>
                  <button type="button" onClick={() => isDownloaded ? removeDownload(t.id) : download(t.id)}
                    className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded',
                      isDownloaded ? 'bg-emerald-900/60 text-emerald-300' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
                    <Download className="w-3 h-3" /> {isDownloaded ? 'Saved' : 'Save'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {downloads.length > 0 && (
          <p className="mt-2 text-[10px] text-zinc-500">
            {downloads.length} tracks offline · {(downloadKb / 1024).toFixed(1)} MB cached
          </p>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ENGINE — playback config/EQ (3), karaoke (6), device handoff (5)
// ════════════════════════════════════════════════════════════════════
function EngineTab() {
  const [cfg, setCfg] = useState<EngineConfig | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  const [deviceKind, setDeviceKind] = useState('web');

  const refresh = useCallback(async () => {
    const [c, d] = await Promise.all([
      lensRun('music', 'engine-config', {}),
      lensRun('music', 'device-list', {}),
    ]);
    setCfg((c.data?.result as EngineConfig | null) || null);
    setDevices(d.data?.result?.devices || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const setEq = async (patch: Record<string, unknown>) => {
    await lensRun('music', 'eq-set', patch);
    await refresh();
  };
  const setKaraoke = async (patch: Record<string, unknown>) => {
    await lensRun('music', 'karaoke-set', patch);
    await refresh();
  };
  const registerDevice = async () => {
    if (!deviceName.trim()) return;
    await lensRun('music', 'device-register', { name: deviceName.trim(), kind: deviceKind });
    setDeviceName('');
    await refresh();
  };
  const transfer = async (deviceId: string) => {
    await lensRun('music', 'device-transfer', { deviceId });
    await refresh();
  };

  if (loading) return <Spin />;
  const eq = cfg?.config.eq;
  const karaoke = cfg?.config.karaoke;
  return (
    <div className="space-y-4">
      {/* Equalizer */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={SlidersHorizontal} title="Equalizer" hint={`crossfade ${cfg?.crossfadeMs ?? 0}ms · normalize ${cfg?.normalizeTargetDb ?? 0}dB`} />
        <label className="flex items-center justify-between text-[11px] text-zinc-300 mb-2">
          <span>Equalizer enabled</span>
          <Toggle on={!!eq?.enabled} onClick={() => setEq({ enabled: !eq?.enabled })} />
        </label>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {['flat', 'bass_boost', 'treble_boost', 'vocal', 'lofi'].map((p) => (
            <button key={p} type="button" onClick={() => setEq({ preset: p })}
              className={cn('text-[10px] px-2 py-1 rounded-full border',
                eq?.preset === p ? 'bg-emerald-600/20 text-emerald-300 border-emerald-700' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>
              {p.replace('_', ' ')}
            </button>
          ))}
        </div>
        {(['bass', 'mid', 'treble'] as const).map((band) => (
          <label key={band} className="block text-[11px] text-zinc-400 mb-1.5">
            <span className="capitalize">{band}: {eq?.bands[band] ?? 0} dB</span>
            <input type="range" min={-12} max={12} value={eq?.bands[band] ?? 0}
              onChange={(e) => setEq({ bands: { [band]: Number(e.target.value) } })}
              className="w-full accent-emerald-500" />
          </label>
        ))}
      </section>

      {/* Karaoke */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Mic} title="Karaoke Mode" hint="mid-side vocal cancellation" />
        <label className="flex items-center justify-between text-[11px] text-zinc-300 mb-2">
          <span>Karaoke enabled</span>
          <Toggle on={!!karaoke?.enabled} onClick={() => setKaraoke({ enabled: !karaoke?.enabled })} />
        </label>
        <label className="block text-[11px] text-zinc-400 mb-2">
          <span>Vocal reduction: {karaoke?.vocalReductionPct ?? 80}%</span>
          <input type="range" min={0} max={100} value={karaoke?.vocalReductionPct ?? 80}
            onChange={(e) => setKaraoke({ vocalReductionPct: Number(e.target.value) })}
            className="w-full accent-emerald-500" />
        </label>
        <label className="flex items-center justify-between text-[11px] text-zinc-300">
          <span>Scroll lyrics with playback</span>
          <Toggle on={!!karaoke?.scrollLyrics} onClick={() => setKaraoke({ scrollLyrics: !karaoke?.scrollLyrics })} />
        </label>
      </section>

      {/* Device handoff */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Plug} title="Connect — Cross-Device Handoff" hint="control playback on another device" />
        <div className="flex gap-2 mb-2">
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)}
            placeholder="Device name…"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <select value={deviceKind} onChange={(e) => setDeviceKind(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
            {['web', 'phone', 'desktop', 'tablet', 'speaker', 'tv'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" onClick={registerDevice}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Add</button>
        </div>
        {devices.length === 0 ? (
          <Empty text="No registered devices." />
        ) : (
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-1.5">
                <Smartphone className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-[11px] text-zinc-200 truncate flex-1">{d.name} <span className="text-zinc-500">· {d.kind}</span></span>
                {d.active ? (
                  <span className="text-[10px] text-emerald-300">● Playing here</span>
                ) : (
                  <button type="button" onClick={() => transfer(d.id)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">Transfer</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// DISCOVER — AI DJ voice (7), AI playlist (8), scheduled (9), smart rec (10)
// ════════════════════════════════════════════════════════════════════
function DiscoverTab({ onChange }: { onChange: () => void }) {
  const [djBusy, setDjBusy] = useState(false);
  const [djLine, setDjLine] = useState('');
  const [djTracks, setDjTracks] = useState<Track[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [scheduled, setScheduled] = useState<ScheduledPlaylist[]>([]);
  const [recs, setRecs] = useState<Track[]>([]);
  const [recBasis, setRecBasis] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [sp, sr] = await Promise.all([
      lensRun('music', 'scheduled-playlist-list', {}),
      lensRun('music', 'smart-recommend', {}),
    ]);
    setScheduled(sp.data?.result?.playlists || []);
    setRecs(sr.data?.result?.tracks || []);
    setRecBasis(sr.data?.result?.basis || '');
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const runDj = async () => {
    setDjBusy(true);
    const r = await lensRun('music', 'dj-session', { limit: 12 });
    if (r.data?.ok) {
      const res = r.data.result as { tracks: Track[]; voice: { text: string } };
      setDjTracks(res.tracks || []);
      setDjLine(res.voice?.text || '');
      // route the DJ narration through Web Speech for spoken playback
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && res.voice?.text) {
        try {
          const utter = new SpeechSynthesisUtterance(res.voice.text);
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utter);
        } catch { /* speech unavailable */ }
      }
    } else {
      setDjLine(r.data?.error || 'Need 2+ tracks for a DJ session.');
      setDjTracks([]);
    }
    setDjBusy(false); onChange();
  };

  const runAiPlaylist = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true);
    const r = await lensRun('music', 'ai-playlist', { prompt: aiPrompt.trim() });
    setAiMsg(r.data?.ok
      ? `Created "${(r.data.result as { playlist: { name: string } }).playlist.name}" — ${(r.data.result as { trackCount: number }).trackCount} tracks (${(r.data.result as { basis: string }).basis}).`
      : (r.data?.error || 'AI playlist failed.'));
    setAiBusy(false); onChange();
  };

  const refreshScheduled = async (kind: string) => {
    await lensRun('music', 'scheduled-playlist-refresh', { kind });
    await refresh(); onChange();
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-4">
      {/* AI DJ with voice */}
      <section className="bg-gradient-to-br from-violet-900/40 to-zinc-900 border border-violet-800/40 rounded-xl p-4">
        <Head icon={Radio} title="AI DJ with Voice" hint="spoken narration via Web Speech" />
        <button type="button" onClick={runDj} disabled={djBusy}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
          {djBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
          Start DJ session
        </button>
        {djLine && <p className="mt-3 text-xs italic text-violet-200 bg-violet-950/40 rounded-lg px-3 py-2">&ldquo;{djLine}&rdquo;</p>}
        {djTracks.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto">
            {djTracks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 text-[11px] text-zinc-300">
                <span className="text-zinc-600 w-4 text-right">{i + 1}</span>
                <span className="truncate flex-1">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* AI playlist */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Sparkles} title="AI Playlist" hint="prompt → playlist" />
        <div className="flex gap-2">
          <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void runAiPlaylist(); }}
            placeholder="e.g. upbeat focus music for deep work"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button type="button" onClick={runAiPlaylist} disabled={aiBusy || !aiPrompt.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate'}
          </button>
        </div>
        {aiMsg && <p className="mt-2 text-[11px] text-emerald-300">{aiMsg}</p>}
      </section>

      {/* Scheduled playlists */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Calendar} title="Scheduled Playlists" hint="Discover Weekly · Release Radar · Daylist" />
        <div className="grid grid-cols-3 gap-2">
          {(['discover_weekly', 'release_radar', 'daylist'] as const).map((kind) => {
            const sp = scheduled.find((s) => s.kind === kind);
            return (
              <div key={kind} className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-2.5">
                <p className="text-[11px] font-semibold text-zinc-200 capitalize">{kind.replace('_', ' ')}</p>
                {sp ? (
                  <p className="text-[10px] text-zinc-500 mt-0.5">{sp.trackCount} tracks{sp.mood ? ` · ${sp.mood}` : ''}</p>
                ) : (
                  <p className="text-[10px] text-zinc-600 mt-0.5">Not generated</p>
                )}
                <button type="button" onClick={() => refreshScheduled(kind)}
                  className="mt-1.5 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/50">
                  <RefreshCw className="w-2.5 h-2.5" /> Refresh
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Smart recommendations */}
      <section>
        <Head icon={ListMusic} title="Smart Recommendations" hint={recBasis ? `basis: ${recBasis}` : 'collaborative + recency model'} />
        {recs.length === 0 ? (
          <Empty text="Play some tracks to train the recommender." />
        ) : (
          <ul className="space-y-1">
            {recs.slice(0, 10).map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <Music2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-[11px] text-zinc-200 truncate flex-1">{t.title} <span className="text-zinc-500">— {t.artist}</span></span>
                <span className="text-[10px] text-zinc-600 capitalize">{t.genre}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SOCIAL — Jam (11), friend activity (12), collab edit (13), share (14)
// ════════════════════════════════════════════════════════════════════
function SocialTab({ onChange }: { onChange: () => void }) {
  const [jam, setJam] = useState<{ id: string; code: string; name: string; participants: string[] } | null>(null);
  const [jamName, setJamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [jamMsg, setJamMsg] = useState('');
  const [activity, setActivity] = useState<FriendActivity[]>([]);
  const [cards, setCards] = useState<ShareCard[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string; collaborative: boolean }[]>([]);
  const [collabPlaylist, setCollabPlaylist] = useState('');
  const [collabTrack, setCollabTrack] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [collabMsg, setCollabMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [fa, pl, tr] = await Promise.all([
      lensRun('music', 'friend-activity', {}),
      lensRun('music', 'playlist-list', {}),
      lensRun('music', 'track-list', {}),
    ]);
    setActivity(fa.data?.result?.activity || []);
    setPlaylists(pl.data?.result?.playlists || []);
    setTracks(tr.data?.result?.tracks || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const createJam = async () => {
    const r = await lensRun('music', 'jam-create', { name: jamName.trim() || 'Listening Jam' });
    if (r.data?.ok) { setJam(r.data.result?.jam || null); setJamMsg(''); }
    onChange();
  };
  const joinJam = async () => {
    if (!joinCode.trim()) return;
    const r = await lensRun('music', 'jam-join', { code: joinCode.trim() });
    if (r.data?.ok) { setJam(r.data.result?.jam || null); setJamMsg(''); }
    else setJamMsg(r.data?.error || 'Could not join jam.');
    onChange();
  };
  const leaveJam = async () => {
    await lensRun('music', 'jam-leave', {});
    setJam(null); onChange();
  };

  const collabEdit = async () => {
    if (!collabPlaylist || !collabTrack) return;
    const r = await lensRun('music', 'playlist-collab-edit', { playlistId: collabPlaylist, trackId: collabTrack, op: 'add' });
    setCollabMsg(r.data?.ok
      ? `Added — playlist now has ${(r.data.result as { trackCount: number }).trackCount} tracks.`
      : (r.data?.error || 'Collaborative edit failed.'));
    onChange();
  };

  const makeCard = async (kind: string) => {
    const params: Record<string, unknown> = { kind };
    if (kind === 'track' && tracks[0]) params.id = tracks[0].id;
    if (kind === 'playlist' && playlists[0]) params.id = playlists[0].id;
    const r = await lensRun('music', 'share-card', params);
    if (r.data?.ok) setCards((c) => [r.data!.result!.card as ShareCard, ...c].slice(0, 8));
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-4">
      {/* Jam */}
      <section className="bg-gradient-to-br from-pink-900/40 to-zinc-900 border border-pink-800/40 rounded-xl p-4">
        <Head icon={Users} title="Jam — Group Listening" hint="real-time synchronized sessions" />
        {jam ? (
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-200">
              <strong>{jam.name}</strong> · code <span className="font-mono text-pink-300">{jam.code}</span>
            </p>
            <p className="text-[11px] text-zinc-400">{jam.participants.length} participant{jam.participants.length !== 1 ? 's' : ''}</p>
            <button type="button" onClick={leaveJam}
              className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Leave jam</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={jamName} onChange={(e) => setJamName(e.target.value)} placeholder="Jam name…"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-pink-500" />
              <button type="button" onClick={createJam}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-500 text-white">Host</button>
            </div>
            <div className="flex gap-2">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Join with a code…"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:ring-2 focus:ring-pink-500" />
              <button type="button" onClick={joinJam} disabled={!joinCode.trim()}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50">Join</button>
            </div>
            {jamMsg && <p className="text-[11px] text-pink-300">{jamMsg}</p>}
          </div>
        )}
      </section>

      {/* Friend activity */}
      <section>
        <Head icon={Users} title="Friend Activity" hint="what others on the substrate are playing" />
        {activity.length === 0 ? (
          <Empty text="No friend activity yet." />
        ) : (
          <ul className="space-y-1">
            {activity.slice(0, 10).map((a, i) => (
              <li key={`${a.userId}-${i}`} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', a.kind === 'now_playing' ? 'bg-emerald-400' : 'bg-zinc-600')} />
                <span className="text-[11px] text-zinc-300 truncate flex-1">
                  {a.track.title} <span className="text-zinc-500">— {a.track.artist}</span>
                </span>
                <span className="text-[10px] text-zinc-600">{a.kind === 'now_playing' ? 'now' : 'recent'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Collaborative editing */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={ListMusic} title="Collaborative Playlist Editing" hint="multi-user live edits" />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select value={collabPlaylist} onChange={(e) => setCollabPlaylist(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
            <option value="">Pick a playlist…</option>
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.collaborative ? ' (collab)' : ''}</option>)}
          </select>
          <select value={collabTrack} onChange={(e) => setCollabTrack(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
            <option value="">Pick a track…</option>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        <button type="button" onClick={collabEdit} disabled={!collabPlaylist || !collabTrack}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
          Add to playlist
        </button>
        {collabMsg && <p className="mt-2 text-[11px] text-emerald-300">{collabMsg}</p>}
      </section>

      {/* Share cards */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Share2} title="Share Cards" hint="story cards for social" />
        <div className="flex gap-2 mb-2">
          {(['track', 'playlist', 'wrapped'] as const).map((k) => (
            <button key={k} type="button" onClick={() => makeCard(k)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 capitalize">
              <Share2 className="w-3 h-3" /> {k}
            </button>
          ))}
        </div>
        {cards.length > 0 && (
          <ul className="space-y-1.5">
            {cards.map((c) => (
              <li key={c.id} className="rounded-lg p-2.5 border border-zinc-800"
                style={{ background: `linear-gradient(135deg, ${c.gradient[0]}33, ${c.gradient[1]}33)` }}>
                <p className="text-xs font-bold text-zinc-100">{c.title}</p>
                <p className="text-[10px] text-zinc-400">{c.subtitle} · {c.kind}</p>
                <p className="text-[10px] text-emerald-300 font-mono mt-0.5 truncate">{c.shareUrl}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ARTIST — stream analytics (15), canvas/profile (16), concerts (17)
// ════════════════════════════════════════════════════════════════════
function ArtistTab({ onChange }: { onChange: () => void }) {
  const [analytics, setAnalytics] = useState<StreamAnalytics | null>(null);
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [pickTracks, setPickTracks] = useState<Track[]>([]);
  const [bio, setBio] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [pickId, setPickId] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [concertArtist, setConcertArtist] = useState('');
  const [concertBusy, setConcertBusy] = useState(false);
  const [concerts, setConcerts] = useState<ConcertEvent[]>([]);
  const [concertMsg, setConcertMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [an, pr, tr] = await Promise.all([
      lensRun('music', 'stream-analytics', {}),
      lensRun('music', 'artist-profile-get', {}),
      lensRun('music', 'track-list', {}),
    ]);
    setAnalytics((an.data?.result as StreamAnalytics | null) || null);
    const p = (pr.data?.result?.profile as ArtistProfile) || null;
    setProfile(p);
    if (p) { setBio(p.bio || ''); setCanvasUrl(p.canvasUrl || ''); setPickId(p.pickTrackId || ''); }
    setPickTracks(tr.data?.result?.tracks || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const saveProfile = async () => {
    const r = await lensRun('music', 'artist-profile-set', {
      bio, canvasUrl: canvasUrl || null, pickTrackId: pickId || null,
    });
    setProfileMsg(r.data?.ok ? 'Profile saved.' : (r.data?.error || 'Save failed.'));
    await refresh(); onChange();
  };

  const lookupConcerts = async () => {
    if (!concertArtist.trim()) return;
    setConcertBusy(true); setConcertMsg('');
    const r = await lensRun('music', 'concert-listings', { artist: concertArtist.trim() });
    if (r.data?.ok) {
      const res = r.data.result as { events: ConcertEvent[]; count: number; message?: string };
      setConcerts(res.events || []);
      setConcertMsg(res.message || (res.count === 0 ? 'No upcoming events found.' : `${res.count} upcoming events.`));
    } else {
      setConcerts([]);
      setConcertMsg(r.data?.error || 'Concert lookup failed.');
    }
    setConcertBusy(false);
  };

  if (loading) return <Spin />;
  return (
    <div className="space-y-4">
      {/* Stream analytics */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={BarChart3} title="Streaming Analytics" hint="listeners · sources · top tracks" />
        {analytics && analytics.catalogSize > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Metric label="Streams" value={analytics.totalStreams} />
              <Metric label="Listeners" value={analytics.uniqueListeners} />
              <Metric label="Avg/track" value={analytics.avgStreamsPerTrack} />
            </div>
            {Object.keys(analytics.bySource).length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-zinc-500 uppercase mb-1">Stream sources</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(analytics.bySource).map(([src, n]) => (
                    <span key={src} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">{src}: {n}</span>
                  ))}
                </div>
              </div>
            )}
            {analytics.topTracks.length > 0 && (
              <ul className="space-y-1">
                {analytics.topTracks.slice(0, 5).map((t, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px] text-zinc-300">
                    <span className="w-4 text-zinc-600">{i + 1}</span>
                    <span className="truncate flex-1">{t.title}</span>
                    <span className="text-zinc-500">{t.streams} streams</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Empty text="Upload tracks to your catalog to see analytics." />
        )}
      </section>

      {/* Artist profile + canvas */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Palette} title="Artist Profile & Canvas" hint="bio · looping cover visual · artist pick" />
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3}
          placeholder="Artist bio…"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <input value={canvasUrl} onChange={(e) => setCanvasUrl(e.target.value)}
          placeholder="Canvas video / loop URL…"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <select value={pickId} onChange={(e) => setPickId(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 mb-2">
          <option value="">No artist pick</option>
          {pickTracks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <button type="button" onClick={saveProfile}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Save profile</button>
        {profileMsg && <p className="mt-2 text-[11px] text-emerald-300">{profileMsg}</p>}
        {profile?.canvasUrl && (
          <p className="mt-2 text-[10px] text-zinc-500 truncate">Canvas: {profile.canvasUrl}</p>
        )}
      </section>

      {/* Concert listings */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <Head icon={Calendar} title="Concert Listings" hint="MusicBrainz events — free, no key" />
        <div className="flex gap-2">
          <input value={concertArtist} onChange={(e) => setConcertArtist(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void lookupConcerts(); }}
            placeholder="Artist name…"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button type="button" onClick={lookupConcerts} disabled={concertBusy || !concertArtist.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {concertBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find shows'}
          </button>
        </div>
        {concertMsg && <p className="mt-2 text-[11px] text-zinc-400">{concertMsg}</p>}
        {concerts.length > 0 && (
          <ul className="mt-2 space-y-1">
            {concerts.map((e) => (
              <li key={e.mbid} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-3 py-1.5">
                <Calendar className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-[11px] text-zinc-200 truncate flex-1">{e.name}</span>
                <span className="text-[10px] text-zinc-500">{e.date}{e.time ? ` ${e.time}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────
function Spin() {
  return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
}
function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-zinc-500 italic">{text}</p>;
}
function Head({ icon: Icon, title, hint }: { icon: typeof Radio; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon className="w-4 h-4 text-emerald-300" />
      <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
      {hint && <span className="text-[10px] text-zinc-500 truncate">{hint}</span>}
    </div>
  );
}
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('w-9 h-5 rounded-full transition-colors relative', on ? 'bg-emerald-600' : 'bg-zinc-700')}>
      <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', on ? 'left-4' : 'left-0.5')} />
    </button>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-2 text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
