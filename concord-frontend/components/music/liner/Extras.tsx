'use client';

/**
 * Library extras and discovery, each on its own real macro:
 *  - Replay: your listening numbers (listening-stats, top-tracks, top-artists).
 *  - Sound: EQ and karaoke, saved to your account (eq-set, karaoke-set) and
 *    applied to the platform player you are hearing.
 *  - MadeForYou: a daily mix from your own library (daily-mix).
 *  - OpenWeb: bring songs from Audius, iTunes previews or Jamendo into your
 *    library (ingest-*), with the source's own reason when it cannot answer.
 */

import { useEffect, useState } from 'react';
import { Globe2, Loader2, Play } from 'lucide-react';
import { showToast } from '@/components/common/Toasts';
import { getPlayer } from '@/lib/music/player';
import { libraryToPlayerTrack, music, type LibraryTrack } from './linerApi';
import { Cover, Empty } from './parts';
import { playQueue } from './play';

type PlayerTrack = NonNullable<ReturnType<typeof libraryToPlayerTrack>>;
const playable = (list: LibraryTrack[]) => list.map((t, i) => libraryToPlayerTrack(t, i)).filter(Boolean) as PlayerTrack[];

export function ReplayPanel() {
  const [stats, setStats] = useState<{ totalPlays: number; listenedMinutes: number; byGenre: Record<string, number>; libraryTracks: number } | null>(null);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [artists, setArtists] = useState<Array<{ artist: string; plays: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([
      music<typeof stats>('listening-stats'),
      music<{ tracks: LibraryTrack[] }>('top-tracks'),
      music<{ artists: Array<{ artist: string; plays: number }> }>('top-artists'),
    ]).then(([s, t, a]) => {
      if (!s.ok || !s.result) { setError(s.error || 'Could not load your listening.'); return; }
      setStats(s.result);
      setTracks(t.result?.tracks || []);
      setArtists(a.result?.artists || []);
    });
  }, []);
  if (error) return <Empty title="Replay is not loading">{error}</Empty>;
  if (!stats) return <p className="text-sm text-[color:var(--ln-muted)]" role="status">Counting your plays…</p>;
  if (!stats.totalPlays) return <Empty title="Nothing to replay yet">Play songs you have saved and your year in music builds up here.</Empty>;
  const genres = Object.entries(stats.byGenre).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="space-y-8" data-testid="ln-replay">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="ln-card p-4"><p className="ln-eyebrow">Minutes listened</p><p className="ln-mono mt-1 text-3xl">{stats.listenedMinutes}</p></div>
        <div className="ln-card p-4"><p className="ln-eyebrow">Plays</p><p className="ln-mono mt-1 text-3xl">{stats.totalPlays}</p></div>
        <div className="ln-card p-4"><p className="ln-eyebrow">Top genre</p><p className="ln-serif mt-1 text-3xl capitalize">{genres[0]?.[0] || '—'}</p></div>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="ln-eyebrow mb-2">Your top songs</h3>
          <ol className="space-y-1">{tracks.slice(0, 10).map((t, i) => (
            <li key={t.id} className="ln-row flex items-center gap-3 px-2 py-1.5"><span className="ln-mono w-5 text-right text-sm text-[color:var(--ln-muted)]">{i + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}<span className="font-normal text-[color:var(--ln-muted)]"> · {t.artist}</span></span><span className="ln-mono text-xs text-[color:var(--ln-muted)]">{t.playCount}</span></li>
          ))}</ol>
        </div>
        <div>
          <h3 className="ln-eyebrow mb-2">Your top artists</h3>
          <ol className="space-y-1">{artists.slice(0, 10).map((a, i) => (
            <li key={a.artist} className="ln-row flex items-center gap-3 px-2 py-1.5"><span className="ln-mono w-5 text-right text-sm text-[color:var(--ln-muted)]">{i + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-medium">{a.artist}</span><span className="ln-mono text-xs text-[color:var(--ln-muted)]">{a.plays}</span></li>
          ))}</ol>
        </div>
      </div>
    </div>
  );
}

type Bands = { bass: number; mid: number; treble: number };

export function SoundPanel() {
  const [eq, setEq] = useState<{ enabled: boolean; preset: string; bands: Bands } | null>(null);
  const [presets, setPresets] = useState<string[]>(['flat', 'bass_boost', 'treble_boost', 'vocal', 'lofi']);
  const [karaoke, setKaraoke] = useState(false);
  useEffect(() => {
    void music<{ settings: { eq?: { enabled: boolean; preset: string; bands: Bands }; karaoke?: { enabled: boolean } } }>('audio-settings-get').then((r) => {
      const st = r.result?.settings;
      setEq(st?.eq || { enabled: false, preset: 'flat', bands: { bass: 0, mid: 0, treble: 0 } });
      setKaraoke(!!st?.karaoke?.enabled);
    });
  }, []);
  const apply = (next: { enabled: boolean; bands: Bands }) => {
    const b = next.enabled ? next.bands : { bass: 0, mid: 0, treble: 0 };
    getPlayer().applyAudioSettings({ bassDb: b.bass, midDb: b.mid, trebleDb: b.treble });
  };
  const save = async (input: Record<string, unknown>) => {
    const r = await music<{ eq: { enabled: boolean; preset: string; bands: Bands }; presets: string[] }>('eq-set', input);
    if (!r.ok || !r.result) { showToast('error', r.error || 'EQ not saved.'); return; }
    setEq(r.result.eq);
    if (r.result.presets?.length) setPresets(r.result.presets);
    apply(r.result.eq);
  };
  const toggleKaraoke = async () => {
    const want = !karaoke;
    const r = await music<{ karaoke: { enabled: boolean } }>('karaoke-set', { enabled: want });
    if (!r.ok || !r.result) { showToast('error', r.error || 'Not saved.'); return; }
    setKaraoke(r.result.karaoke.enabled);
    getPlayer().setKaraoke(r.result.karaoke.enabled);
  };
  if (!eq) return <p className="text-sm text-[color:var(--ln-muted)]" role="status">Loading sound settings…</p>;
  return (
    <div className="grid max-w-3xl gap-6 lg:grid-cols-2" data-testid="ln-sound">
      <div className="ln-card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Equaliser</p>
          <button type="button" onClick={() => void save({ enabled: !eq.enabled })} aria-pressed={eq.enabled} className="ln-chip px-3 py-0.5 text-xs">{eq.enabled ? 'On' : 'Off'}</button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="EQ presets">
          {presets.map((p) => <button key={p} type="button" onClick={() => void save({ preset: p, enabled: true })} aria-pressed={eq.preset === p} className="ln-chip px-2.5 py-0.5 text-xs capitalize">{p.replace('_', ' ')}</button>)}
        </div>
        {(['bass', 'mid', 'treble'] as const).map((k) => (
          <label key={k} className="flex items-center gap-3 text-sm">
            <span className="w-14 capitalize">{k}</span>
            <input type="range" min={-12} max={12} step={1} value={eq.bands[k]} onChange={(e) => setEq({ ...eq, bands: { ...eq.bands, [k]: Number(e.target.value) } })} onPointerUp={() => void save({ bands: eq.bands, enabled: true })} onKeyUp={() => void save({ bands: eq.bands, enabled: true })} className="flex-1 accent-[var(--ln-accent)]" aria-label={`${k} gain`} />
            <span className="ln-mono w-12 text-right text-xs">{eq.bands[k] > 0 ? '+' : ''}{eq.bands[k]} dB</span>
          </label>
        ))}
        <p className="text-xs text-[color:var(--ln-muted)]">Applies to what you hear now and is saved to your account.</p>
      </div>
      <div className="ln-card space-y-2 p-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Sing along</p>
          <button type="button" onClick={() => void toggleKaraoke()} aria-pressed={karaoke} className="ln-chip px-3 py-0.5 text-xs">{karaoke ? 'On' : 'Off'}</button>
        </div>
        <p className="text-xs text-[color:var(--ln-muted)]">Turns down the centre-panned lead vocal (left minus right). Works best on stereo mixes with a centred voice.</p>
      </div>
    </div>
  );
}

export function MadeForYou() {
  const [mix, setMix] = useState<LibraryTrack[] | null>(null);
  useEffect(() => { void music<{ tracks: LibraryTrack[] }>('daily-mix').then((r) => setMix(r.ok ? r.result?.tracks || [] : [])); }, []);
  const tracks = playable(mix || []);
  if (!mix || tracks.length < 3) return null;
  return (
    <section className="ln-card mb-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-center" data-testid="ln-daily-mix">
      <div className="grid w-28 flex-shrink-0 grid-cols-2 gap-1">
        {mix.slice(0, 4).map((t) => <Cover key={t.id} url={t.coverUrl || t.artworkUrl || null} title={t.album || t.title} />)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="ln-eyebrow">Made for you</p>
        <p className="ln-serif text-2xl">Your daily mix</p>
        <p className="truncate text-sm text-[color:var(--ln-muted)]">{mix.slice(0, 4).map((t) => t.artist).filter((v, i, a) => a.indexOf(v) === i).join(', ')} and more, from your library</p>
      </div>
      <button type="button" onClick={() => playQueue(tracks, 0)} className="ln-btn ln-btn-primary h-10 px-5 text-sm"><Play className="h-4 w-4 fill-current" /> Play {tracks.length}</button>
    </section>
  );
}

const SOURCES = [
  { id: 'ingest-audius', label: 'Audius', note: 'full tracks' },
  { id: 'ingest-itunes', label: 'iTunes', note: '30 s previews' },
  { id: 'ingest-jamendo', label: 'Jamendo', note: 'free licensed tracks' },
] as const;

export function OpenWeb({ q }: { q: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<{ source: string; tracks: LibraryTrack[] } | null>(null);
  const run = async (id: string, label: string) => {
    setBusy(id);
    const r = await music<{ ingested: number; skipped: number; tracks: LibraryTrack[] }>(id, { term: q, limit: 12 });
    setBusy(null);
    if (!r.ok || !r.result) { showToast('warning', `${label}: ${r.error || 'no answer'}`); return; }
    setFound({ source: label, tracks: r.result.tracks || [] });
    showToast('success', `${label}: ${r.result.ingested} new song${r.result.ingested === 1 ? '' : 's'} saved to your library.`);
  };
  const list = playable(found?.tracks || []);
  return (
    <section className="mb-10" aria-labelledby="ln-openweb">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b ln-rule pb-2">
        <h2 id="ln-openweb" className="ln-serif flex items-center gap-2 text-2xl"><Globe2 className="h-5 w-5" aria-hidden /> From the open web</h2>
        <span className="text-xs text-[color:var(--ln-muted)]">Brings matching songs into your library</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <button key={s.id} type="button" onClick={() => void run(s.id, s.label)} disabled={!!busy} className="ln-chip flex items-center gap-1 px-3 py-0.5 text-xs" title={s.note}>
              {busy === s.id && <Loader2 className="h-3 w-3 animate-spin" />} {s.label}
            </button>
          ))}
        </div>
      </div>
      {found && (found.tracks.length ? (
        <ol className="grid gap-x-8 sm:grid-cols-2">
          {found.tracks.map((t, i) => (
            <li key={t.id} className="ln-row flex items-center gap-3 px-2 py-2">
              <Cover url={t.coverUrl || t.artworkUrl || null} title={t.title} size="sm" />
              <button type="button" disabled={!libraryToPlayerTrack(t, i)} onClick={() => playQueue(list, list.findIndex((x) => x.title === t.title && x.artistName === t.artist))} className="min-w-0 flex-1 text-left disabled:opacity-60" aria-label={`Play ${t.title}`}>
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="block truncate text-xs text-[color:var(--ln-muted)]">{t.artist} · {found.source}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-[color:var(--ln-muted)]">{found.source} had nothing new for “{q}”.</p>)}
    </section>
  );
}
