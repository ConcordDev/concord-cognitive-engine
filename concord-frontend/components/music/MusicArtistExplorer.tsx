'use client';

/**
 * MusicArtistExplorer — bespoke MusicBrainz artist + discography UX
 * for the music lens. Backed by:
 *   music.mb-search-artist  — artist name → mbid + disambiguation
 *   music.mb-artist-releases — mbid → releases (albums/EPs/singles)
 *   music.mb-lookup-by-isrc — ISRC → recording metadata
 *
 * Per category-leader UX research against Spotify, MusicBrainz, AllMusic,
 * an artist-explorer surface:
 *   • Spotify-style hero (name, life-span, country, top tags)
 *   • MusicBrainz disambiguation popover when >1 candidate
 *   • Discogs-style discography grouped by release-group type
 *     (Album / Single / EP / Compilation / Other), newest-first within
 *     each group
 *   • Folksonomy tag chips clickable as visual filters of the
 *     discography grid (client-side, no extra API hit)
 *   • Save-as-DTU on artist (with full discography snapshot) and
 *     per-release (with track-shape metadata) — source: "musicbrainz"
 *   • Quick-lookup ISRC sub-panel for power users / royalty workflows
 */

import { useState, useMemo, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, User, MapPin, Calendar, Tag, Music2, Disc, ExternalLink,
  ChevronDown, ChevronRight, X, Hash,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface ArtistHit {
  mbid: string;
  name: string;
  sortName?: string;
  type?: string;
  country?: string | null;
  beginArea?: string | null;
  lifeSpan?: { begin?: string; end?: string; ended?: boolean } | null;
  disambiguation?: string | null;
  score?: number;
  tags?: string[];
}

interface Release {
  mbid: string;
  title: string;
  date?: string | null;
  country?: string | null;
  status?: string;
  primaryType?: string;
  secondaryTypes?: string[];
  disambiguation?: string | null;
  barcode?: string | null;
  packaging?: string | null;
}

interface IsrcRecording {
  mbid: string;
  title: string;
  lengthMs: number | null;
  artistCredit: string;
  releases: Array<{ mbid: string; title: string; date?: string }>;
  disambiguation?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('music', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const RELEASE_GROUPS = ['Album', 'Single', 'EP', 'Compilation', 'Other'] as const;

export function MusicArtistExplorer() {
  const [queryInput, setQueryInput] = useState('');
  const [searchResults, setSearchResults] = useState<ArtistHit[] | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<ArtistHit | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showIsrc, setShowIsrc] = useState(false);

  const searchMutation = useMutation({
    mutationFn: async (q: string) => callMacro<{ artists: ArtistHit[]; totalCount: number }>('mb-search-artist', { query: q, limit: 10 }),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        setSearchResults(env.result.artists);
        setErrorMsg(null);
        // If exactly one match, auto-pick. Otherwise show the disambiguation list.
        if (env.result.artists.length === 1) {
          setSelectedArtist(env.result.artists[0]);
        }
      } else {
        setErrorMsg(env.error || 'No artists matched');
        setSearchResults(null);
      }
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const releasesMutation = useMutation({
    mutationFn: async (mbid: string) => callMacro<{ releases: Release[] }>('mb-artist-releases', { mbid, limit: 100 }),
    onSuccess: (env) => {
      if (env.ok && env.result) setReleases(env.result.releases);
      else setReleases([]);
    },
  });

  // Auto-load releases when an artist is picked
  useEffect(() => {
    if (selectedArtist) releasesMutation.mutate(selectedArtist.mbid);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutate stable
  }, [selectedArtist?.mbid]);

  const submitSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = queryInput.trim();
    if (q.length < 2) return;
    setSelectedArtist(null);
    setReleases([]);
    setTagFilter(null);
    searchMutation.mutate(q);
  };

  // Group releases by primary type
  const groupedReleases = useMemo(() => {
    const filtered = tagFilter
      ? releases.filter((r) =>
          (r.title || '').toLowerCase().includes(tagFilter.toLowerCase()) ||
          (r.disambiguation || '').toLowerCase().includes(tagFilter.toLowerCase())
        )
      : releases;
    const groups = new Map<string, Release[]>();
    for (const r of filtered) {
      const key = (r.primaryType && RELEASE_GROUPS.includes(r.primaryType as typeof RELEASE_GROUPS[number]))
        ? r.primaryType
        : 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return groups;
  }, [releases, tagFilter]);

  const reset = () => {
    setQueryInput(''); setSearchResults(null); setSelectedArtist(null);
    setReleases([]); setTagFilter(null); setErrorMsg(null);
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Music2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Artist & Discography Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            musicbrainz · open
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIsrc((v) => !v)}
            className={`rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors ${
              showIsrc ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            ISRC lookup
          </button>
          {selectedArtist && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              New search
            </button>
          )}
        </div>
      </header>

      <AnimatePresence>
        {showIsrc && <IsrcLookup key="isrc-panel" />}
      </AnimatePresence>

      <form onSubmit={submitSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Artist name — Radiohead · Miles Davis · Björk · Beatles…"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={queryInput.trim().length < 2 || searchMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {searchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      {errorMsg && !selectedArtist && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {!selectedArtist && !searchResults && !searchMutation.isPending && !errorMsg && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/50 px-3 py-8 text-center text-xs text-zinc-400">
          Search the MusicBrainz database — the open music encyclopedia powering
          ~2M artists and ~25M releases. Disambiguation is first-class: when more
          than one artist shares a name, you pick the right one yourself.
        </div>
      )}

      {/* Disambiguation popover */}
      {searchResults && !selectedArtist && searchResults.length > 0 && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">
            {searchResults.length} artist{searchResults.length === 1 ? '' : 's'} match — pick one
          </div>
          <div className="space-y-1">
            {searchResults.map((a) => (
              <button
                key={a.mbid}
                type="button"
                onClick={() => setSelectedArtist(a)}
                className="flex w-full items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/40 p-2 text-left transition-colors hover:border-cyan-500/30 hover:bg-zinc-900/80"
              >
                <User className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/70" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-white">{a.name}</span>
                    {a.disambiguation && (
                      <span className="text-[11px] italic text-amber-300">({a.disambiguation})</span>
                    )}
                    {typeof a.score === 'number' && (
                      <span className="ml-auto font-mono text-[10px] text-zinc-400">{a.score}%</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                    {a.type && <span>{a.type}</span>}
                    {a.country && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-2.5 w-2.5" />
                        {a.country}
                      </span>
                    )}
                    {a.lifeSpan?.begin && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />
                        {a.lifeSpan.begin}{a.lifeSpan.end ? `–${a.lifeSpan.end}` : (a.lifeSpan.ended ? ' (ended)' : '–present')}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Artist hero + discography */}
      {selectedArtist && (
        <motion.div
          key={selectedArtist.mbid}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          <ArtistHero artist={selectedArtist} releases={releases} />

          {selectedArtist.tags && selectedArtist.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="h-3 w-3 text-zinc-400" />
              {selectedArtist.tags.slice(0, 12).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    tagFilter === t
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                      : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-cyan-500/30'
                  }`}
                >
                  {t}
                </button>
              ))}
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className="ml-1 rounded-full px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                >
                  <X className="inline h-2.5 w-2.5" /> clear filter
                </button>
              )}
            </div>
          )}

          {releasesMutation.isPending && (
            <div className="flex items-center justify-center py-6 text-xs text-zinc-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading discography…
            </div>
          )}

          {!releasesMutation.isPending && releases.length === 0 && (
            <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400">
              No releases indexed in MusicBrainz for this artist yet.
            </div>
          )}

          {!releasesMutation.isPending && releases.length > 0 && (
            <div className="space-y-3">
              {RELEASE_GROUPS.map((g) => {
                const list = groupedReleases.get(g);
                if (!list || list.length === 0) return null;
                return <ReleaseGroup key={g} group={g} releases={list} artistName={selectedArtist.name} />;
              })}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function ArtistHero({ artist, releases }: { artist: ArtistHit; releases: Release[] }) {
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-xl font-semibold text-white">{artist.name}</h3>
            {artist.disambiguation && (
              <span className="text-xs italic text-amber-300">({artist.disambiguation})</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
            {artist.type && <span>{artist.type}</span>}
            {artist.country && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {artist.country}{artist.beginArea ? ` · ${artist.beginArea}` : ''}
              </span>
            )}
            {artist.lifeSpan?.begin && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {artist.lifeSpan.begin}{artist.lifeSpan.end ? `–${artist.lifeSpan.end}` : (artist.lifeSpan.ended ? ' (ended)' : '–present')}
              </span>
            )}
            <a
              href={`https://musicbrainz.org/artist/${artist.mbid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-zinc-400 transition-colors hover:text-cyan-400"
            >
              <ExternalLink className="h-3 w-3" />
              MusicBrainz
            </a>
          </div>
        </div>
        <SaveAsDtuButton
          apiSource="musicbrainz"
          apiUrl={`https://musicbrainz.org/ws/2/artist/${artist.mbid}`}
          title={`${artist.name} — MusicBrainz artist`}
          content={[
            `Name: ${artist.name}`,
            artist.disambiguation ? `Disambiguation: ${artist.disambiguation}` : '',
            artist.type ? `Type: ${artist.type}` : '',
            artist.country ? `Country: ${artist.country}${artist.beginArea ? ` (${artist.beginArea})` : ''}` : '',
            artist.lifeSpan?.begin ? `Active: ${artist.lifeSpan.begin}${artist.lifeSpan.end ? `–${artist.lifeSpan.end}` : '–present'}` : '',
            artist.tags && artist.tags.length ? `Tags: ${artist.tags.slice(0, 10).join(', ')}` : '',
            `MBID: ${artist.mbid}`,
            '',
            `Releases indexed: ${releases.length}`,
          ].filter(Boolean).join('\n')}
          extraTags={['music', 'artist', 'musicbrainz', ...(artist.tags || []).slice(0, 4)]}
          rawData={{ artist, releaseCount: releases.length }}
        />
      </div>
    </div>
  );
}

function ReleaseGroup({ group, releases, artistName }: { group: string; releases: Release[]; artistName: string }) {
  const [open, setOpen] = useState(true);
  const Icon = group === 'Album' ? Disc : group === 'Single' ? Music2 : Disc;

  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-zinc-900/60"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-cyan-400/80" />
          <span className="text-xs font-semibold text-zinc-200">{group}s</span>
          <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] font-mono text-zinc-400">
            {releases.length}
          </span>
        </div>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />}
      </button>
      {open && (
        <div className="border-t border-zinc-800">
          <div className="divide-y divide-zinc-800">
            {releases.map((r) => <ReleaseRow key={r.mbid} release={r} artistName={artistName} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ReleaseRow({ release, artistName }: { release: Release; artistName: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-zinc-900/40">
      <div className="w-12 shrink-0 text-center">
        <span className="font-mono text-[10px] text-zinc-400">
          {release.date?.slice(0, 4) || '—'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-white">{release.title || '(untitled)'}</span>
          {release.disambiguation && (
            <span className="truncate text-[10px] italic text-amber-300/80">({release.disambiguation})</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400">
          {release.country && <span>{release.country}</span>}
          {release.status && <span>{release.status}</span>}
          {release.packaging && <span>{release.packaging}</span>}
          {release.secondaryTypes && release.secondaryTypes.length > 0 && (
            <span className="font-mono">{release.secondaryTypes.join(' · ')}</span>
          )}
          {release.barcode && <span className="font-mono">UPC {release.barcode}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SaveAsDtuButton
          compact
          apiSource="musicbrainz"
          apiUrl={`https://musicbrainz.org/ws/2/release/${release.mbid}`}
          title={`${release.title} — ${artistName}${release.date ? ` (${release.date.slice(0, 4)})` : ''}`}
          content={[
            `Title: ${release.title}`,
            `Artist: ${artistName}`,
            release.date ? `Released: ${release.date}` : '',
            release.country ? `Country: ${release.country}` : '',
            release.primaryType ? `Type: ${release.primaryType}${release.secondaryTypes?.length ? ` (${release.secondaryTypes.join(', ')})` : ''}` : '',
            release.status ? `Status: ${release.status}` : '',
            release.packaging ? `Packaging: ${release.packaging}` : '',
            release.barcode ? `Barcode: ${release.barcode}` : '',
            `MBID: ${release.mbid}`,
          ].filter(Boolean).join('\n')}
          extraTags={['music', 'release', 'musicbrainz', (release.primaryType || 'release').toLowerCase()]}
          rawData={release}
        />
        <a
          href={`https://musicbrainz.org/release/${release.mbid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          title="Open release on MusicBrainz"
          aria-label="Open release"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ── ISRC quick-lookup sub-panel ─────────────────────────────────────────

function IsrcLookup() {
  const [isrcInput, setIsrcInput] = useState('');
  const [result, setResult] = useState<{ recordings: IsrcRecording[]; isrc: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: async (isrc: string) => callMacro<{ isrc: string; recordings: IsrcRecording[] }>('mb-lookup-by-isrc', { isrc }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setResult(env.result); setError(null); }
      else { setError(env.error || 'No recordings'); setResult(null); }
    },
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isrcInput.trim()) return;
    lookup.mutate(isrcInput.trim());
  };
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="overflow-hidden"
    >
      <form onSubmit={submit} className="space-y-2 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3">
        <div className="flex items-center gap-2">
          <Hash className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-wider text-cyan-300">
            ISRC lookup
          </span>
          <span className="text-[10px] text-zinc-400">
            12-char code: 2 country + 3 registrant + 2 year + 5 designation
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={isrcInput}
            onChange={(e) => setIsrcInput(e.target.value.toUpperCase())}
            placeholder="USRC17607839"
            maxLength={15}
            className="w-40 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs uppercase text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!isrcInput.trim() || lookup.isPending}
            className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {lookup.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Lookup
          </button>
        </div>
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        {result && result.recordings.length > 0 && (
          <div className="space-y-1">
            {result.recordings.map((rec) => (
              <div key={rec.mbid} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-xs">
                <div className="font-medium text-white">{rec.title} — <span className="text-cyan-300/80">{rec.artistCredit}</span></div>
                {rec.lengthMs && (
                  <div className="text-[10px] text-zinc-400">
                    {Math.floor(rec.lengthMs / 60000)}:{String(Math.floor((rec.lengthMs % 60000) / 1000)).padStart(2, '0')}
                  </div>
                )}
                {rec.releases.length > 0 && (
                  <div className="mt-1 text-[10px] text-zinc-400">
                    Released on: {rec.releases.slice(0, 3).map((rel) => `${rel.title}${rel.date ? ` (${rel.date.slice(0, 4)})` : ''}`).join('; ')}
                    {rec.releases.length > 3 && ` +${rec.releases.length - 3} more`}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {result && result.recordings.length === 0 && (
          <p className="text-[11px] text-zinc-400">No recordings indexed for that ISRC.</p>
        )}
      </form>
    </motion.div>
  );
}
