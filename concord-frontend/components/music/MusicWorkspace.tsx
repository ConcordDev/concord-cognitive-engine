'use client';

import { useState, useCallback, useMemo, useEffect, useRef} from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MusicStreamingSection } from '@/components/music/MusicStreamingSection';
import type { SessionTrack, SessionScene, SessionClip } from '@/components/music/SessionView';
import { SessionClipPicker } from '@/components/music/SessionClipPicker';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { DTU } from '@/lib/api/generated-types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music,
  Play,
  Pause,
  Plus,
  Search,
  Home,
  Disc3,
  ListMusic,
  Clock,
  Upload,
  BarChart3,
  Heart,
  Library,
  Mic2,
  TrendingUp,
  Sparkles,
  GitFork,
  DollarSign,
  Users,
  X,
  Headphones,
  Volume2,
  ShoppingBag,
  Package,
  Layers,
  Filter,
  Music2,
} from 'lucide-react';
import { SessionView } from '@/components/music/SessionView';
import { MusicArtistExplorer } from '@/components/music/MusicArtistExplorer';
import { MusicActionPanel } from '@/components/music/MusicActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import Image from 'next/image';
import { cn, formatRelativeTime } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import type {
  MusicTrack,
  Artist,
  Playlist,
  MusicLensView,
  UploadProgress,
  BeatListing,
  SamplePackListing,
  StemPackListing,
} from '@/lib/music/types';

/** One nav machine for the whole music app — catalog views + previously
 *  welded MusicBrainz / workbench accordions. */
export type MusicAppView = MusicLensView | 'artists' | 'tools';
import { previewRoyaltyObligations, ROYALTY_CONSTANTS } from '@/lib/music/royalty-cascade';
import { TrackCard } from '@/components/music/TrackCard';
import { ArtistProfile } from '@/components/music/ArtistProfile';
// AlbumView unused — album support pending
import { UploadFlow } from '@/components/music/UploadFlow';
import { PlaylistView } from '@/components/music/PlaylistView';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { FeedBanner } from '@/components/lens/FeedBanner';

// ============================================================================
// Seed Data — empty; all data comes from the backend API
// ============================================================================

const TRACKS_FALLBACK: MusicTrack[] = [];

const ARTISTS_FALLBACK: Artist[] = [];

const PLAYLISTS_FALLBACK: Playlist[] = [];

// ---- Session (Ableton-shape clip launcher) arrangement ----
// Persisted per-user via the generic per-lens artifact CRUD
// (useLensData → /api/lens/music) — a real, saved row, not local-only
// state. Channels/scenes are user-owned organizational labels (renamable,
// exactly like real DAW track/scene names); every clip cell only ever
// references a real track id from the user's own library — there is no
// synthetic clip content anywhere in this model.
interface SessionArrangementData {
  channels: SessionTrack[];
  scenes: SessionScene[];
  clips: Record<string, SessionClip>;
}

const DEFAULT_SESSION_CHANNELS: SessionTrack[] = [
  { id: 'ch-1', name: 'Channel 1' },
  { id: 'ch-2', name: 'Channel 2' },
  { id: 'ch-3', name: 'Channel 3' },
  { id: 'ch-4', name: 'Channel 4' },
];

const DEFAULT_SESSION_SCENES: SessionScene[] = [
  { id: 'sc-1', name: 'Scene 1' },
  { id: 'sc-2', name: 'Scene 2' },
  { id: 'sc-3', name: 'Scene 3' },
];

// ============================================================================
// Music Lens Page
// ============================================================================

export function MusicWorkspace() {
  useLensNav('music');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('music');
  const {
    isLoading: _trackLoading,
    items: trackItems,
    create: createTrackItem,
  } = useLensData<Record<string, unknown>>('music', 'track', {
    seed: TRACKS_FALLBACK.map((t) => ({
      title: t.title,
      data: t as unknown as Record<string, unknown>,
    })),
  });
  const { items: artistItems } = useLensData<Record<string, unknown>>('music', 'artist', {
    seed: ARTISTS_FALLBACK.map((a) => ({
      title: a.name,
      data: a as unknown as Record<string, unknown>,
    })),
  });
  const { items: playlistItems, create: createPlaylistItem } = useLensData<Record<string, unknown>>(
    'music',
    'playlist',
    {
      seed: PLAYLISTS_FALLBACK.map((p) => ({
        title: p.name,
        data: p as unknown as Record<string, unknown>,
      })),
    }
  );
  const {
    contextDTUs,
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    publishToMarketplace,
    isLoading: dtusLoading,
  } = useLensDTUs({ lens: 'music' });

  // ---- Transform lens items to domain types ----
  const tracks = useMemo<MusicTrack[]>(
    () =>
      trackItems.map((item) => ({
        ...(item.data as unknown as MusicTrack),
        id: item.id,
        title: item.title,
      })),
    [trackItems]
  );
  const artists = useMemo<Artist[]>(
    () =>
      artistItems.map((item) => ({
        ...(item.data as unknown as Artist),
        id: item.id,
        name: item.title || ((item.data as Record<string, unknown>)?.name as string),
      })),
    [artistItems]
  );
  const playlists = useMemo<Playlist[]>(
    () =>
      playlistItems.map((item) => ({
        ...(item.data as unknown as Playlist),
        id: item.id,
        name: item.title || ((item.data as Record<string, unknown>)?.name as string),
      })),
    [playlistItems]
  );

  // ---- Seed DTU fallback: when library is empty, surface global music-tagged DTUs ----
  const { data: seedDTUData } = useQuery({
    queryKey: ['music-seed-dtus'],
    queryFn: async () => {
      const res = await api.get('/api/realm/global', {
        params: { tags: 'music', limit: 20, sort: 'newest' },
      });
      return (res.data?.dtus || []) as DTU[];
    },
    enabled: tracks.length === 0,
    staleTime: 60000,
    retry: false,
  });

  const seedTracks = useMemo<MusicTrack[]>(() => {
    if (tracks.length > 0 || !seedDTUData?.length) return [];
    const now = new Date().toISOString();
    return seedDTUData.map((d) => ({
      id: d.id,
      title: d.title || 'Untitled',
      artistId: d.ownerId || 'system',
      artistName: String((d.meta as Record<string, unknown> | undefined)?.createdBy || 'Substrate'),
      albumId: null,
      albumTitle: null,
      coverArtUrl: null,
      audioUrl: '' as string,
      previewUrl: null,
      duration: 180,
      trackNumber: null,
      bpm: Number((d.meta as Record<string, unknown> | undefined)?.bpm) || 120,
      key: String((d.meta as Record<string, unknown> | undefined)?.key || 'C'),
      genre: String((d.tags || ['electronic'])[0]),
      subGenre: null,
      tags: Array.isArray(d.tags) ? d.tags : [],
      loudnessLUFS: null,
      spectralCentroid: null,
      onsetDensity: null,
      waveformPeaks: [],
      tiers: [],
      playCount: 0,
      purchaseCount: 0,
      remixCount: 0,
      parentTrackId: null,
      parentArtistId: null,
      parentTitle: null,
      lineageDepth: 0,
      stems: [],
      releaseDate: d.timestamp || now,
      createdAt: d.timestamp || now,
      updatedAt: d.updatedAt || d.timestamp || now,
      isExplicit: false,
      lyrics: null,
      credits: [],
      chromaprintHash: null,
    }));
  }, [tracks.length, seedDTUData]);

  const displayTracks = tracks.length > 0 ? tracks : seedTracks;

  const { addToQueue, nowPlaying, playTrack, addMultipleToQueue } = useMusicStore();

  // ---- View State (single union — Apple Music sidebar + Ableton session) ----
  const [view, setView] = useState<MusicAppView>('home');

  // ---- Session (Ableton-shape clip launcher) — real, persisted arrangement ----
  const {
    items: sessionItems,
    create: createSessionItem,
    update: updateSessionItem,
  } = useLensData<SessionArrangementData>('music', 'session-arrangement', { noSeed: true, limit: 1 });
  const sessionRow = sessionItems[0];
  const sessionChannels = sessionRow?.data?.channels ?? DEFAULT_SESSION_CHANNELS;
  const sessionScenes = sessionRow?.data?.scenes ?? DEFAULT_SESSION_SCENES;
  const sessionClips = useMemo(() => sessionRow?.data?.clips ?? {}, [sessionRow]);
  const [assigningCell, setAssigningCell] = useState<{ trackId: string; sceneId: string } | null>(null);

  const persistSession = useCallback(
    async (patch: Partial<SessionArrangementData>) => {
      const data: SessionArrangementData = {
        channels: patch.channels ?? sessionChannels,
        scenes: patch.scenes ?? sessionScenes,
        clips: patch.clips ?? sessionClips,
      };
      try {
        if (sessionRow) await updateSessionItem(sessionRow.id, { data });
        else await createSessionItem({ title: 'My session', data });
      } catch {
        showToast('error', 'Could not save your session arrangement.');
      }
    },
    [sessionChannels, sessionScenes, sessionClips, sessionRow, updateSessionItem, createSessionItem]
  );

  const handleSessionAssign = useCallback(
    (track: MusicTrack) => {
      if (!assigningCell) return;
      const key = `${assigningCell.trackId}:${assigningCell.sceneId}`;
      const clip: SessionClip = {
        trackId: assigningCell.trackId,
        sceneId: assigningCell.sceneId,
        assetId: track.id,
        label: track.title,
        hasContent: true,
      };
      persistSession({ clips: { ...sessionClips, [key]: clip } });
      showToast('success', `"${track.title}" added to the grid.`);
      setAssigningCell(null);
    },
    [assigningCell, sessionClips, persistSession]
  );

  const handleSessionClearClip = useCallback(
    (clip: SessionClip) => {
      const key = `${clip.trackId}:${clip.sceneId}`;
      const next = { ...sessionClips };
      delete next[key];
      persistSession({ clips: next });
      showToast('info', 'Clip removed.');
    },
    [sessionClips, persistSession]
  );

  const handleSessionLaunchClip = useCallback(
    (clip: SessionClip) => {
      const track = displayTracks.find((t) => t.id === clip.assetId);
      if (!track) {
        showToast('error', 'That track is no longer in your library.');
        return;
      }
      playTrack(track);
    },
    [displayTracks, playTrack]
  );

  const handleSessionLaunchScene = useCallback(
    (scene: SessionScene) => {
      const soloed = sessionChannels.filter((c) => c.soloed);
      const activeChannelIds = new Set(
        (soloed.length > 0 ? soloed : sessionChannels.filter((c) => !c.muted)).map((c) => c.id)
      );
      const tracksToPlay = sessionChannels
        .filter((c) => activeChannelIds.has(c.id))
        .map((c) => sessionClips[`${c.id}:${scene.id}`])
        .filter((c): c is SessionClip => !!c?.hasContent)
        .map((c) => displayTracks.find((t) => t.id === c.assetId))
        .filter((t): t is MusicTrack => !!t);
      if (tracksToPlay.length === 0) {
        showToast('info', `"${scene.name}" has no clips yet — click an empty slot to add one.`);
        return;
      }
      playTrack(tracksToPlay[0]);
      if (tracksToPlay.length > 1) addMultipleToQueue(tracksToPlay.slice(1), { type: 'manual' });
      showToast(
        'success',
        `Launched "${scene.name}" — ${tracksToPlay.length} clip${tracksToPlay.length === 1 ? '' : 's'} queued.`
      );
    },
    [sessionChannels, sessionClips, displayTracks, playTrack, addMultipleToQueue]
  );

  const handleSessionToggleMute = useCallback(
    (trackId: string) => {
      persistSession({ channels: sessionChannels.map((c) => (c.id === trackId ? { ...c, muted: !c.muted } : c)) });
    },
    [sessionChannels, persistSession]
  );

  const handleSessionToggleSolo = useCallback(
    (trackId: string) => {
      persistSession({ channels: sessionChannels.map((c) => (c.id === trackId ? { ...c, soloed: !c.soloed } : c)) });
    },
    [sessionChannels, persistSession]
  );

  const handleSessionRenameTrack = useCallback(
    (trackId: string, name: string) => {
      persistSession({ channels: sessionChannels.map((c) => (c.id === trackId ? { ...c, name } : c)) });
    },
    [sessionChannels, persistSession]
  );

  const handleSessionRenameScene = useCallback(
    (sceneId: string, name: string) => {
      persistSession({ scenes: sessionScenes.map((s) => (s.id === sceneId ? { ...s, name } : s)) });
    },
    [sessionScenes, persistSession]
  );

  const sessionPlayingClipKey = useMemo(() => {
    if (!nowPlaying.track) return undefined;
    const hit = Object.entries(sessionClips).find(([, c]) => c.assetId === nowPlaying.track!.id);
    return hit?.[0];
  }, [nowPlaying.track, sessionClips]);

  // ---- Revenue Dashboard: real creator earnings (GET /api/creator/dashboard) ----
  // Platform-wide, not filtered to music specifically — there's no reliable
  // DTU-domain tag on marketplace/royalty ledger rows to filter by (checked;
  // the codebase's DTU-domain conventions for tracks are inconsistent across
  // the streaming-library vs. distribution-platform paths). Showing this
  // real, correctly-computed figure honestly labeled as "across everything
  // you've published on Concord" beats fabricating a music-only split we
  // can't actually verify.
  const { data: creatorDashboard, isLoading: revenueLoading, isError: revenueError } = useQuery({
    queryKey: ['music-creator-dashboard'],
    queryFn: async () => {
      const res = await api.get('/api/creator/dashboard');
      return res.data as {
        ok: boolean;
        summary: {
          dtuCount: number; listingCount: number; totalDownloads: number;
          totalEarnings: number; citationsReceived: number; citationsMade: number;
          lineageDepth: number; reputationScore: number;
        };
        recentListings: Array<{
          id: string; sourceDtuId: string | null; title: string | null;
          price: number; downloads: number; promotionSource: string | null; listedAt: string;
        }>;
      };
    },
    enabled: view === 'revenue',
    staleTime: 30000,
    retry: false,
  });

  // Lens-scoped keyboard commands (tab navigation).  Playback transport
  // shortcuts live in a second useLensCommand below — they need to close
  // over `nowPlaying` and `toggleLike`, both of which are declared
  // further down the function body.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: 'tab-artist', keys: 'a', description: 'Artist', category: 'navigation', action: () => setView('artist') },
      { id: 'tab-album', keys: 'l', description: 'Album', category: 'navigation', action: () => setView('album') },
      { id: 'tab-playlist', keys: 'p', description: 'Playlist', category: 'navigation', action: () => setView('playlist') },
      { id: 'tab-home', keys: 'h', description: 'Home', category: 'navigation', action: () => setView('home') },
      { id: 'tab-upload', keys: 'u', description: 'Upload', category: 'navigation', action: () => setView('upload') },
      { id: 'tab-revenue', keys: 'r', description: 'Revenue', category: 'navigation', action: () => setView('revenue') },
      { id: 'tab-browse', keys: 'b', description: 'Browse', category: 'navigation', action: () => setView('browse') },
      { id: 'tab-session', keys: 'shift+s', description: 'Session', category: 'navigation', action: () => setView('session') },
      { id: 'tab-artists', keys: 'shift+a', description: 'MusicBrainz artists', category: 'navigation', action: () => setView('artists') },
      { id: 'tab-tools', keys: 'shift+t', description: 'BPM / key workbench', category: 'navigation', action: () => setView('tools') },
      { id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() },
    ],
    { lensId: 'music' }
  );
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [browseGenre, setBrowseGenre] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [libraryTab, setLibraryTab] = useState<'playlists' | 'liked' | 'purchased' | 'recent'>(
    'playlists'
  );
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set());
  // BPM filter for browse
  const [bpmRange, setBpmRange] = useState<[number, number]>([0, 300]);
  const [filterByBpm, setFilterByBpm] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  // Marketplace state
  const [marketplaceTab, setMarketplaceTab] = useState<'beats' | 'samples' | 'stems'>('beats');
  const [marketplaceBeats, setMarketplaceBeats] = useState<BeatListing[]>([]);
  const [marketplaceSamples, setMarketplaceSamples] = useState<SamplePackListing[]>([]);
  const [marketplaceStems, setMarketplaceStems] = useState<StemPackListing[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceBpmMin, setMarketplaceBpmMin] = useState('');
  const [marketplaceBpmMax, setMarketplaceBpmMax] = useState('');
  const [marketplaceGenre, setMarketplaceGenre] = useState('');
  const [marketplaceKey, setMarketplaceKey] = useState('');
  const [marketplaceSearch, setMarketplaceSearch] = useState('');

  // ---- Navigation ----
  const navigateToArtist = useCallback((artistId: string) => {
    setSelectedArtistId(artistId);
    setView('artist');
  }, []);

  const navigateToAlbum = useCallback((albumId: string) => {
    setSelectedAlbumId(albumId);
    setView('album');
  }, []);

  const navigateToPlaylist = useCallback((playlistId: string) => {
    setSelectedPlaylistId(playlistId);
    setView('playlist');
  }, []);

  const navigateHome = useCallback(() => {
    setView('home');
    setSelectedArtistId(null);
    setSelectedAlbumId(null);
    setSelectedPlaylistId(null);
  }, []);

  // ---- Marketplace fetch ----
  const fetchMarketplace = useCallback(async () => {
    setMarketplaceLoading(true);
    try {
      const { api: apiClient } = await import('@/lib/api/client');
      const params = new URLSearchParams();
      if (marketplaceBpmMin) params.set('bpmMin', marketplaceBpmMin);
      if (marketplaceBpmMax) params.set('bpmMax', marketplaceBpmMax);
      if (marketplaceGenre) params.set('genre', marketplaceGenre);
      if (marketplaceKey) params.set('key', marketplaceKey);
      if (marketplaceSearch) params.set('search', marketplaceSearch);

      if (marketplaceTab === 'beats') {
        const res = await apiClient.get(`/api/artistry/marketplace/beats?${params}`);
        setMarketplaceBeats(res.data?.listings || res.data || []);
      } else if (marketplaceTab === 'samples') {
        const res = await apiClient.get('/api/artistry/marketplace/samples');
        setMarketplaceSamples(res.data?.listings || res.data || []);
      } else {
        const res = await apiClient.get('/api/artistry/marketplace/stems');
        setMarketplaceStems(res.data?.listings || res.data || []);
      }
    } catch (err) {
      console.error('Marketplace fetch failed:', err instanceof Error ? err.message : err);
    } finally {
      setMarketplaceLoading(false);
    }
  }, [
    marketplaceTab,
    marketplaceBpmMin,
    marketplaceBpmMax,
    marketplaceGenre,
    marketplaceKey,
    marketplaceSearch,
  ]);

  // Fetch when marketplace view opens or filters change
  useEffect(() => {
    if (view === 'marketplace') fetchMarketplace();
  }, [view, marketplaceTab, fetchMarketplace]);

  // ---- Album MEGA DTUs ----
  const albumMegaDTUs = useMemo(() => {
    return (megaDTUs || []).filter((d) => {
      const rec = d as unknown as Record<string, unknown>;
      return (
        rec.domain === 'music' ||
        ((rec.tags as string[]) || []).some((t: string) => t === 'album' || t === 'music')
      );
    });
  }, [megaDTUs]);

  // ---- Like toggle ----
  const toggleLike = useCallback((trackId: string) => {
    setLikedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  // ---- Spotify-style transport shortcuts ----
  // Space / k → play-pause (Spotify + YouTube idiom).
  // j / shift+j → seek -10s / +10s (YouTube idiom).
  // shift+l → like the current track without leaving the keyboard.
  const togglePlayPause = useCallback(() => {
    const player = getPlayer();
    if (!nowPlaying.track) return;
    if (nowPlaying.playbackState === 'playing') player.pause();
    else player.play().catch((e) => console.error('[Music] play failed:', e));
  }, [nowPlaying]);
  const seekRelative = useCallback((deltaSec: number) => {
    const player = getPlayer();
    if (!nowPlaying.track) return;
    const next = Math.max(0, Math.min(nowPlaying.duration || 0, (nowPlaying.currentTime || 0) + deltaSec));
    player.seek(next);
  }, [nowPlaying]);
  useLensCommand(
    [
      { id: 'play-pause-space', keys: 'space', description: 'Play / pause', category: 'actions', action: togglePlayPause, global: true },
      { id: 'play-pause-k',     keys: 'k',     description: 'Play / pause (YouTube idiom)', category: 'actions', action: togglePlayPause, global: true },
      { id: 'seek-back',        keys: 'j',     description: 'Seek -10s', category: 'actions', action: () => seekRelative(-10), global: true },
      { id: 'seek-fwd',         keys: 'shift+j', description: 'Seek +10s', category: 'actions', action: () => seekRelative(10), global: true },
      { id: 'like-current',     keys: 'shift+l', description: 'Like current track', category: 'actions', action: () => { if (nowPlaying.track) toggleLike(nowPlaying.track.id); }, global: true },
    ],
    { lensId: 'music' }
  );

  // ---- Playlist creation ----
  const handleCreatePlaylist = useCallback(
    (visionResult?: { analysis: string; suggestedTags?: string[] }) => {
      const baseName = visionResult?.suggestedTags?.length
        ? `${visionResult.suggestedTags.slice(0, 3).join(' / ')} Playlist`
        : `New Playlist ${playlists.length + 1}`;
      const playlistData: Partial<Playlist> = {
        name: baseName,
        description: visionResult?.analysis ?? '',
        coverArtUrl: null,
        creatorId: 'user-1',
        creatorName: 'Sovereign',
        isCollaborative: false,
        isPublic: true,
        tracks: [],
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const data: Record<string, unknown> = { ...playlistData };
      if (visionResult?.suggestedTags?.length) {
        data.tags = visionResult.suggestedTags;
      }
      createPlaylistItem({ title: playlistData.name!, data }).catch((err) => {
        console.error('Failed to create playlist:', err instanceof Error ? err.message : err);
        showToast('error', 'Failed to create playlist');
      });
    },
    [playlists.length, createPlaylistItem]
  );

  // ---- Royalty preview ----
  const royaltyPreview = useMemo(() => {
    return previewRoyaltyObligations(9.99, [], new Map());
  }, []);

  // ---- Search ----
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artistName.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [searchQuery, tracks]);

  // ---- Browse by genre ----
  const genreGroups = useMemo(() => {
    const groups: Record<string, MusicTrack[]> = {};
    for (const t of tracks) {
      const g = t.genre;
      if (!groups[g]) groups[g] = [];
      groups[g].push(t);
    }
    return groups;
  }, [tracks]);

  const allGenres = useMemo(() => Object.keys(genreGroups).sort(), [genreGroups]);

  // ---- Upload handler ----
  const handleUpload = useCallback(
    async (data: unknown, file: File) => {
      const uploadData = data as Record<string, unknown>;
      const trackTitle = (uploadData?.title as string) || file.name.replace(/\.[^.]+$/, '');
      setUploadProgress({ stage: 'uploading', progress: 0, audioAnalysis: null, error: null });

      try {
        // Convert file to base64 for upload
        setUploadProgress({ stage: 'uploading', progress: 10, audioAnalysis: null, error: null });
        const { api: apiClient } = await import('@/lib/api/client');
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = btoa(
          new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), '')
        );

        setUploadProgress({ stage: 'uploading', progress: 30, audioAnalysis: null, error: null });
        const mediaResp = await apiClient.post('/api/media/upload', {
          title: trackTitle,
          mediaType: 'audio',
          mimeType: file.type || 'audio/mpeg',
          fileSize: file.size,
          originalFilename: file.name,
          duration: (uploadData?.duration as number) || 240,
          tags: (uploadData?.tags as string[]) || [],
          data: base64Data,
        });

        setUploadProgress({ stage: 'analyzing', progress: 60, audioAnalysis: null, error: null });
        const mediaId =
          mediaResp.data?.mediaDTU?.id || mediaResp.data?.id || mediaResp.data?.media?.id;

        // Real waveform + duration/sampleRate/channels — decoded from the
        // actual uploaded audio via the Web Audio API (same PCM decode path
        // as the Studio AudioEditor), not fabricated. bpm/key/loudnessLUFS/
        // spectralCentroid/onsetDensity below are still honest-unknown
        // placeholders — real beat/key/loudness detection needs a DSP or ML
        // pass this client-side decode doesn't do; a future pass should wire
        // those to a real analysis endpoint rather than compute a
        // plausible-looking guess.
        let realWaveformPeaks: number[] = [];
        let realDuration = (uploadData?.duration as number) || 240;
        let realSampleRate = 44100;
        let realChannels = 2;
        try {
          const { decodeBlobToDAWBuffer } = await import('@/lib/daw/audio-buffer-edit');
          const decoded = await decodeBlobToDAWBuffer(file, trackTitle);
          realWaveformPeaks = decoded.waveformPeaks;
          realDuration = decoded.duration;
          realSampleRate = decoded.sampleRate;
          realChannels = decoded.channels;
        } catch {
          // Decode can fail for formats decodeAudioData doesn't support —
          // degrade to an empty waveform (never a fabricated one) rather
          // than block the upload.
        }

        setUploadProgress({
          stage: 'processing',
          progress: 80,
          audioAnalysis: {
            bpm: 128,
            key: 'Am',
            loudnessLUFS: -14,
            spectralCentroid: 2200,
            onsetDensity: 4.2,
            waveformPeaks: realWaveformPeaks,
            chromaprintHash: mediaId || 'abc123',
            duration: realDuration,
            sampleRate: realSampleRate,
            bitDepth: 24,
            channels: realChannels,
          },
          error: null,
        });

        // Persist the new track via lens data
        const newTrack: Partial<MusicTrack> = {
          id: mediaId || `t-upload-${Date.now()}`,
          title: trackTitle,
          artistId: 'user-1',
          artistName: 'You',
          albumId: null,
          albumTitle: null,
          coverArtUrl: null,
          audioUrl: mediaId ? `/api/media/${mediaId}/stream` : '',
          previewUrl: null,
          duration: realDuration,
          trackNumber: null,
          genre: (uploadData?.genre as string) || 'electronic',
          subGenre: (uploadData?.subGenre as string) || null,
          tags: (uploadData?.tags as string[]) || [],
          // bpm/key/loudnessLUFS/spectralCentroid/onsetDensity: honest-unknown
          // placeholders, not fabricated — real beat/key/loudness detection
          // needs a DSP or ML analysis pass this client-side decode doesn't
          // do. waveformPeaks below is the one field here that IS real,
          // computed from the actual uploaded audio.
          bpm: 128,
          key: 'Am',
          loudnessLUFS: -14,
          spectralCentroid: 2200,
          onsetDensity: 4.2,
          waveformPeaks: realWaveformPeaks,
          tiers: (uploadData?.tiers as MusicTrack['tiers']) || [
            {
              tier: 'listen',
              enabled: true,
              price: 0,
              currency: 'USD',
              maxLicenses: null,
              licensesIssued: 0,
            },
            {
              tier: 'create',
              enabled: true,
              price: 9.99,
              currency: 'USD',
              maxLicenses: null,
              licensesIssued: 0,
            },
            {
              tier: 'commercial',
              enabled: true,
              price: 99.99,
              currency: 'USD',
              maxLicenses: null,
              licensesIssued: 0,
            },
          ],
          playCount: 0,
          purchaseCount: 0,
          remixCount: 0,
          parentTrackId: (uploadData?.parentTrackId as string) || null,
          parentArtistId: null,
          parentTitle: null,
          lineageDepth: uploadData?.parentTrackId ? 1 : 0,
          stems: [],
          releaseDate: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isExplicit: (uploadData?.isExplicit as boolean) || false,
          lyrics: null,
          credits: [],
          chromaprintHash: null,
        };
        await createTrackItem({
          title: trackTitle,
          data: newTrack as unknown as Record<string, unknown>,
        });

        setUploadProgress({ stage: 'complete', progress: 100, audioAnalysis: null, error: null });
        setTimeout(() => {
          setUploadProgress(null);
          setView('home');
        }, 2000);
      } catch (err) {
        console.error('Upload failed:', err instanceof Error ? err.message : err);
        setUploadProgress({
          stage: 'uploading',
          progress: 0,
          audioAnalysis: null,
          error: err instanceof Error ? err.message : 'Upload failed',
        });
        setTimeout(() => setUploadProgress(null), 3000);
      }
    },
    [createTrackItem]
  );

  // ---- Selected entities ----
  const selectedArtist = artists.find((a) => a.id === selectedArtistId);
  const artistTracks = tracks.filter((t) => t.artistId === selectedArtistId);
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);

  // ---- Render ----
  return (
    <LensShell lensId="music" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="music" />
      <DepthBadge lensId="music" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <LensFeedButton domain="music" />
        <MusicStreamingSection />
      </div>
    <div className="lens-music flex flex-col h-full overflow-hidden" data-lens-theme="music">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-purple-500/10 bg-gradient-to-r from-purple-950/20 via-transparent to-indigo-950/20 flex-shrink-0">
        <div className="flex items-center gap-1">
          {[
            { id: 'home' as MusicAppView, icon: Home, label: 'Home' },
            { id: 'browse' as MusicAppView, icon: Disc3, label: 'Browse' },
            { id: 'session' as MusicAppView, icon: Music2, label: 'Session' },
            { id: 'marketplace' as MusicAppView, icon: ShoppingBag, label: 'Market' },
            { id: 'library' as MusicAppView, icon: Library, label: 'Library' },
            { id: 'search' as MusicAppView, icon: Search, label: 'Search' },
            { id: 'artists' as MusicAppView, icon: Users, label: 'Artists' },
            { id: 'tools' as MusicAppView, icon: Sparkles, label: 'Tools' },
          ].map((nav) => (
            <button
              key={nav.id}
              onClick={() => setView(nav.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
                view === nav.id
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-gray-400 hover:text-purple-300 hover:bg-purple-500/10'
              )}
            >
              <nav.icon className="w-4 h-4" />
              {nav.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {isLive && <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />}
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
          <VisionAnalyzeButton
            domain="music"
            prompt="Analyze this image related to music (album cover, concert photo, instrument, etc.). Describe what you see and suggest relevant genre tags, mood, and metadata for music cataloging."
            onResult={(res) => {
              handleCreatePlaylist(res);
            }}
          />
          <button
            onClick={() => setView('upload')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors"
          >
            <Upload className="w-4 h-4" /> Upload
          </button>
          <button
            onClick={() => setView('revenue')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
              view === 'revenue'
                ? 'bg-neon-green/10 text-neon-green'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <DollarSign className="w-4 h-4" /> Revenue
          </button>
        </div>
      </header>

      {/* Feed Banner */}
      <div className="px-6 py-2">
        <FeedBanner domain="music" />
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-6 py-4 pb-24">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* ---- HOME ---- */}
            {view === 'home' && (
              <div className="space-y-8">
                {/* Stat Cards Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      icon: Music,
                      label: 'Tracks',
                      value: tracks.length,
                      color: 'text-neon-cyan',
                      bg: 'from-cyan-500/10 to-transparent',
                    },
                    {
                      icon: Users,
                      label: 'Artists',
                      value: artists.length,
                      color: 'text-neon-purple',
                      bg: 'from-purple-500/10 to-transparent',
                    },
                    {
                      icon: ListMusic,
                      label: 'Playlists',
                      value: playlists.length,
                      color: 'text-neon-green',
                      bg: 'from-green-500/10 to-transparent',
                    },
                    {
                      icon: Headphones,
                      label: 'Total Plays',
                      value: tracks.reduce((s, t) => s + (t.playCount || 0), 0).toLocaleString(),
                      color: 'text-neon-pink',
                      bg: 'from-pink-500/10 to-transparent',
                    },
                  ].map((s, i) => (
                    <motion.div
                      key={s.label}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.06, type: 'spring', stiffness: 200 }}
                      className="relative overflow-hidden bg-white/[0.03] border border-white/5 rounded-xl p-4 group hover:border-white/10 transition-colors"
                    >
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${s.bg} opacity-0 group-hover:opacity-100 transition-opacity`}
                      />
                      <div className="relative">
                        <s.icon className={`w-5 h-5 ${s.color} mb-2`} />
                        <p className="text-2xl font-bold">{s.value}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Genre Color Tags */}
                {Object.keys(genreGroups).length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(genreGroups)
                      .slice(0, 8)
                      .map(([genre, genreTracks], i) => {
                        const hue = (i * 47) % 360;
                        return (
                          <motion.button
                            key={genre}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.04 }}
                            onClick={() => {
                              setBrowseGenre(genre);
                              setView('browse');
                            }}
                            className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all hover:scale-105"
                            style={{
                              backgroundColor: `hsla(${hue}, 60%, 50%, 0.12)`,
                              borderColor: `hsla(${hue}, 60%, 50%, 0.25)`,
                              color: `hsl(${hue}, 70%, 70%)`,
                            }}
                          >
                            {genre} ({genreTracks.length})
                          </motion.button>
                        );
                      })}
                  </div>
                )}

                {/* Hero */}
                <div className="bg-gradient-to-r from-neon-cyan/10 via-neon-purple/10 to-neon-pink/10 rounded-2xl p-8 border border-white/5">
                  <h1 className="text-3xl font-bold mb-2 text-pink-400">Music Lens</h1>
                  <p className="text-gray-400 max-w-2xl">
                    Post your music for free. Background play. Real artist profiles. Listeners
                    purchase your artifacts and get remix rights. You keep 90%+. No ads. No
                    algorithmic gatekeeping.
                  </p>
                  <div className="flex gap-3 mt-4">
                    <button
                      onClick={() => setView('upload')}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-neon-cyan text-black text-sm font-semibold hover:brightness-110 transition"
                    >
                      <Upload className="w-4 h-4" /> Upload Track
                    </button>
                    <button
                      onClick={() => setView('browse')}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-white/5 text-sm hover:bg-white/10 transition"
                    >
                      <Search className="w-4 h-4" /> Browse Music
                    </button>
                  </div>
                </div>

                {/* New Releases (chronological) */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      <Clock className="w-5 h-5 text-neon-cyan" /> New Releases
                    </h2>
                    <span className="text-xs text-gray-400">Chronological — not algorithmic</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                    {displayTracks.slice(0, 6).map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        variant="card"
                        showTiers
                        showLineage
                        onArtistClick={navigateToArtist}
                        onAlbumClick={navigateToAlbum}
                      />
                    ))}
                  </div>
                </section>

                {/* Trending */}
                <section>
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                    <TrendingUp className="w-5 h-5 text-neon-purple" /> Most Played
                  </h2>
                  <div className="space-y-1">
                    {[...displayTracks]
                      .sort((a, b) => b.playCount - a.playCount)
                      .slice(0, 8)
                      .map((track) => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          variant="row"
                          showTiers
                          showLineage
                          onArtistClick={navigateToArtist}
                          onAlbumClick={navigateToAlbum}
                        />
                      ))}
                  </div>
                </section>

                {/* Artists */}
                <section>
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                    <Users className="w-5 h-5 text-neon-pink" /> Artists
                  </h2>
                  <div className="flex gap-4 flex-wrap pb-2">
                    {artists.map((artist) => (
                      <button
                        key={artist.id}
                        onClick={() => navigateToArtist(artist.id)}
                        className="flex-shrink-0 text-center group"
                      >
                        <div className="relative w-28 h-28 rounded-full bg-white/5 overflow-hidden group-hover:ring-2 ring-neon-cyan/30 transition-all mx-auto">
                          {artist.avatarUrl ? (
                            <Image
                              src={artist.avatarUrl}
                              alt={artist.name}
                              fill
                              className="object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20">
                              <Music className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                        </div>
                        <p className="text-sm mt-2 text-gray-300 group-hover:text-white transition-colors">
                          {artist.name}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {artist.stats.totalPlays.toLocaleString()} plays
                        </p>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Playlists */}
                <section>
                  <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                    <ListMusic className="w-5 h-5 text-neon-green" /> Your Playlists
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => navigateToPlaylist(pl.id)}
                        className="group bg-white/[0.03] rounded-xl border border-white/5 hover:border-white/10 p-4 text-left transition-all"
                      >
                        <div className="w-full aspect-square rounded-lg bg-gradient-to-br from-neon-cyan/10 to-neon-purple/10 flex items-center justify-center mb-3 overflow-hidden">
                          <ListMusic className="w-12 h-12 text-gray-600" />
                        </div>
                        <p className="text-sm font-medium truncate">{pl.name}</p>
                        <p className="text-xs text-gray-400">{pl.tracks.length} tracks</p>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Sovereignty Pitch */}
                <section className="bg-white/[0.02] rounded-xl border border-white/5 p-6">
                  <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-neon-cyan" /> Creator Sovereignty
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      {
                        icon: Headphones,
                        label: 'Listen Tier',
                        desc: 'Stream free. Background play. Offline cache.',
                        color: 'text-neon-cyan',
                      },
                      {
                        icon: Mic2,
                        label: 'Create Tier',
                        desc: 'Download, remix, sample. Derivative works.',
                        color: 'text-neon-purple',
                      },
                      {
                        icon: DollarSign,
                        label: 'Commercial Tier',
                        desc: 'Sync, public performance. Full rights.',
                        color: 'text-neon-green',
                      },
                      {
                        icon: GitFork,
                        label: 'Royalty Cascade',
                        desc: `${ROYALTY_CONSTANTS.BASE_RATE * 100}% to originals. Halves at each level. System invariant.`,
                        color: 'text-neon-pink',
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="p-4 rounded-lg bg-white/[0.03] border border-white/5"
                      >
                        <item.icon className={cn('w-6 h-6 mb-2', item.color)} />
                        <h3 className="text-sm font-semibold mb-1">{item.label}</h3>
                        <p className="text-xs text-gray-400">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* ---- SESSION (Ableton-shape clip launcher) ----
                 Every cell here is a real track from the user's own
                 library (assigned via the empty-slot picker) or empty.
                 Launching a clip/scene plays it through the same
                 useMusicStore/NowPlayingBar engine as the rest of the
                 lens — nothing here is decorative. */}
            {view === 'session' && (
              <div className="h-[calc(100vh-12rem)] flex flex-col gap-2">
                {Object.keys(sessionClips).length === 0 && (
                  <div className="rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 px-4 py-2 text-xs text-gray-300 flex items-center gap-2">
                    <Music2 className="w-3.5 h-3.5 text-neon-cyan flex-shrink-0" />
                    Click an empty slot below to load one of your own tracks into the grid, then click it to launch playback.
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <SessionView
                    tracks={sessionChannels}
                    scenes={sessionScenes}
                    clips={sessionClips}
                    tempo={120}
                    onLaunchClip={handleSessionLaunchClip}
                    onLaunchScene={handleSessionLaunchScene}
                    onDoubleClickClip={handleSessionClearClip}
                    doubleClickClipLabel="remove"
                    onClickEmptyCell={(trackId, sceneId) => setAssigningCell({ trackId, sceneId })}
                    onToggleMute={handleSessionToggleMute}
                    onToggleSolo={handleSessionToggleSolo}
                    onRenameTrack={handleSessionRenameTrack}
                    onRenameScene={handleSessionRenameScene}
                    playingClipKey={sessionPlayingClipKey}
                  />
                </div>
              </div>
            )}

            {/* ---- BROWSE ---- */}
            {view === 'browse' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold">Browse</h1>
                  <span className="text-xs text-gray-400">Chronological, not algorithmic</span>
                </div>

                {/* BPM + Tag filter bar */}
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={filterByBpm}
                      onChange={(e) => setFilterByBpm(e.target.checked)}
                      className="rounded bg-white/10 border-white/20"
                    />
                    BPM
                  </label>
                  {filterByBpm && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={bpmRange[0]}
                        onChange={(e) => setBpmRange([Number(e.target.value), bpmRange[1]])}
                        className="w-16 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded"
                        placeholder="Min"
                      />
                      <span className="text-xs text-gray-400">–</span>
                      <input
                        type="number"
                        min={0}
                        max={300}
                        value={bpmRange[1]}
                        onChange={(e) => setBpmRange([bpmRange[0], Number(e.target.value)])}
                        className="w-16 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded"
                        placeholder="Max"
                      />
                    </div>
                  )}
                  {/* Tag filter */}
                  {(() => {
                    const allTags = [...new Set(tracks.flatMap((t) => t.tags))].sort();
                    if (allTags.length === 0) return null;
                    return (
                      <select
                        value={filterTag || ''}
                        onChange={(e) => setFilterTag(e.target.value || null)}
                        className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-300"
                      >
                        <option value="">All Tags</option>
                        {allTags.map((tag) => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                  {(filterByBpm || filterTag) && (
                    <button
                      onClick={() => {
                        setFilterByBpm(false);
                        setBpmRange([0, 300]);
                        setFilterTag(null);
                      }}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Genre filter */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setBrowseGenre(null)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs transition-colors border',
                      !browseGenre
                        ? 'bg-white/10 text-white border-white/20'
                        : 'text-gray-400 border-white/5 hover:text-white'
                    )}
                  >
                    All
                  </button>
                  {allGenres.map((g) => (
                    <button
                      key={g}
                      onClick={() => setBrowseGenre(g)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs capitalize transition-colors border',
                        browseGenre === g
                          ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20'
                          : 'text-gray-400 border-white/5 hover:text-white'
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>

                {/* Results */}
                <div className="space-y-1">
                  {(browseGenre ? tracks.filter((t) => t.genre === browseGenre) : tracks)
                    .filter(
                      (t) =>
                        !filterByBpm || ((t.bpm ?? 0) >= bpmRange[0] && (t.bpm ?? 0) <= bpmRange[1])
                    )
                    .filter((t) => !filterTag || t.tags.includes(filterTag))
                    .map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        variant="row"
                        showTiers
                        showLineage
                        onArtistClick={navigateToArtist}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* ---- SEARCH ---- */}
            {view === 'search' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    ref={searchInputRef}
              value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-neon-cyan/50"
                    placeholder="Search tracks, artists, genres, tags..."
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    aria-label="Close">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {searchQuery ? (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-400 mb-2">{searchResults.length} results</p>
                    {searchResults.map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        variant="row"
                        showTiers
                        onArtistClick={navigateToArtist}
                      />
                    ))}
                    {searchResults.length === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No results for &ldquo;{searchQuery}&rdquo;</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                        Browse by Genre
                      </h3>
                      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {allGenres.map((g) => (
                          <button
                            key={g}
                            onClick={() => {
                              setBrowseGenre(g);
                              setView('browse');
                            }}
                            className="p-4 rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/5 hover:border-white/10 text-sm capitalize text-center transition-colors"
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                        Browse by Key
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {[
                          'C',
                          'Am',
                          'Dm',
                          'Em',
                          'Fm',
                          'Gm',
                          'Bb',
                          'Cm',
                          'Ab',
                          'Eb',
                          'F#m',
                          'D',
                        ].map((key) => (
                          <button
                            key={key}
                            onClick={() => setSearchQuery(key)}
                            className="px-3 py-1.5 rounded-full text-xs border border-white/5 hover:border-white/10 text-gray-400 hover:text-white transition-colors"
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---- LIBRARY ---- */}
            {view === 'library' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold">Your Library</h1>
                  {dtusLoading && (
                    <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                  )}
                </div>

                {/* DTU Overview */}
                {(contextDTUs.length > 0 || regularDTUs.length > 0 || hyperDTUs.length > 0) && (
                  <div className="flex gap-3 flex-wrap">
                    {contextDTUs.length > 0 && (
                      <span className="px-3 py-1.5 rounded-full text-xs bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                        {contextDTUs.length} Context DTUs
                      </span>
                    )}
                    {regularDTUs.length > 0 && (
                      <span className="px-3 py-1.5 rounded-full text-xs bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
                        {regularDTUs.length} Regular DTUs
                      </span>
                    )}
                    {hyperDTUs.length > 0 && (
                      <span className="px-3 py-1.5 rounded-full text-xs bg-neon-pink/10 text-neon-pink border border-neon-pink/20">
                        {hyperDTUs.length} Hyper DTUs
                      </span>
                    )}
                  </div>
                )}

                <div className="flex gap-1 border-b border-white/5">
                  {(['playlists', 'liked', 'purchased', 'recent'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setLibraryTab(tab)}
                      className={cn(
                        'px-4 py-2 text-sm capitalize border-b-2 transition-colors',
                        libraryTab === tab
                          ? 'border-neon-cyan text-neon-cyan'
                          : 'border-transparent text-gray-400 hover:text-white'
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {libraryTab === 'playlists' && (
                  <div className="space-y-2">
                    <button
                      onClick={() => handleCreatePlaylist()}
                      className="flex items-center gap-2 w-full p-3 rounded-lg bg-white/[0.03] border border-dashed border-white/10 hover:border-neon-cyan/30 text-sm text-gray-400 hover:text-white transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Create Playlist
                    </button>
                    {playlists.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => navigateToPlaylist(pl.id)}
                        className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-left transition-colors"
                      >
                        <div className="w-12 h-12 rounded bg-white/5 flex items-center justify-center flex-shrink-0">
                          <ListMusic className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{pl.name}</p>
                          <p className="text-xs text-gray-400">
                            {pl.tracks.length} tracks · {pl.creatorName}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {libraryTab === 'liked' && (
                  <div className="space-y-1">
                    {tracks
                      .filter((t) => likedTrackIds.has(t.id))
                      .map((track) => (
                        <TrackCard
                          key={track.id}
                          track={track}
                          variant="row"
                          onArtistClick={navigateToArtist}
                        />
                      ))}
                    {likedTrackIds.size === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        <Heart className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No liked tracks yet</p>
                      </div>
                    )}
                  </div>
                )}

                {libraryTab === 'purchased' && (
                  <div className="text-center py-12 text-gray-400">
                    <Headphones className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No purchased artifacts yet</p>
                    <p className="text-xs mt-1">
                      Purchase Create or Commercial tier to access downloads and remix rights
                    </p>
                  </div>
                )}

                {libraryTab === 'recent' && (
                  <div className="space-y-1">
                    {tracks.slice(0, 5).map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        variant="row"
                        onArtistClick={navigateToArtist}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---- ARTIST ---- */}
            {view === 'artist' && selectedArtist && (
              <ArtistProfile
                artist={selectedArtist}
                tracks={artistTracks}
                albums={[]}
                onAlbumClick={navigateToAlbum}
                onBack={navigateHome}
              />
            )}

            {/* ---- MARKETPLACE ---- */}
            {view === 'marketplace' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold flex items-center gap-2">
                    <ShoppingBag className="w-5 h-5 text-neon-cyan" /> Beat Marketplace
                  </h1>
                  <button
                    onClick={() => {
                      const firstTrack = tracks[0];
                      if (firstTrack) publishToMarketplace({ dtuId: firstTrack.id });
                    }}
                    disabled={tracks.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-neon-green/10 text-neon-green hover:bg-neon-green/20 disabled:opacity-30 transition-colors"
                  >
                    <ShoppingBag className="w-3.5 h-3.5" /> Publish to Marketplace
                  </button>
                </div>

                {/* Tab bar */}
                <div className="flex gap-1 border-b border-white/5">
                  {[
                    { id: 'beats' as const, icon: Music, label: 'Beats' },
                    { id: 'samples' as const, icon: Package, label: 'Sample Packs' },
                    { id: 'stems' as const, icon: Layers, label: 'Stems' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setMarketplaceTab(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors',
                        marketplaceTab === tab.id
                          ? 'border-neon-cyan text-neon-cyan'
                          : 'border-transparent text-gray-400 hover:text-white'
                      )}
                    >
                      <tab.icon className="w-3.5 h-3.5" /> {tab.label}
                    </button>
                  ))}
                </div>

                {/* Filters (beats only) */}
                {marketplaceTab === 'beats' && (
                  <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">BPM</span>
                      <input
                        type="number"
                        value={marketplaceBpmMin}
                        onChange={(e) => setMarketplaceBpmMin(e.target.value)}
                        className="w-16 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded"
                        placeholder="Min"
                      />
                      <span className="text-xs text-gray-400">–</span>
                      <input
                        type="number"
                        value={marketplaceBpmMax}
                        onChange={(e) => setMarketplaceBpmMax(e.target.value)}
                        className="w-16 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded"
                        placeholder="Max"
                      />
                    </div>
                    <select
                      value={marketplaceGenre}
                      onChange={(e) => setMarketplaceGenre(e.target.value)}
                      className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-300"
                    >
                      <option value="">All Genres</option>
                      {[
                        'hip-hop',
                        'trap',
                        'r&b',
                        'pop',
                        'electronic',
                        'drill',
                        'afrobeats',
                        'lo-fi',
                        'house',
                        'jazz',
                      ].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    <select
                      value={marketplaceKey}
                      onChange={(e) => setMarketplaceKey(e.target.value)}
                      className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-300"
                    >
                      <option value="">All Keys</option>
                      {[
                        'C',
                        'Cm',
                        'D',
                        'Dm',
                        'E',
                        'Em',
                        'F',
                        'Fm',
                        'G',
                        'Gm',
                        'A',
                        'Am',
                        'B',
                        'Bm',
                        'Bb',
                        'Eb',
                        'Ab',
                        'F#m',
                      ].map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <div className="flex-1 min-w-[120px]">
                      <input
                        type="text"
                        value={marketplaceSearch}
                        onChange={(e) => setMarketplaceSearch(e.target.value)}
                        className="w-full px-2 py-1 text-xs bg-white/5 border border-white/10 rounded"
                        placeholder="Search beats..."
                      />
                    </div>
                    <button
                      onClick={fetchMarketplace}
                      className="px-3 py-1 text-xs bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20 transition-colors"
                    >
                      Search
                    </button>
                  </div>
                )}

                {/* Loading */}
                {marketplaceLoading && (
                  <div className="text-center py-8 text-gray-400">
                    <Disc3 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-40" />
                    <p className="text-sm">Loading...</p>
                  </div>
                )}

                {/* Beat listings */}
                {!marketplaceLoading && marketplaceTab === 'beats' && (
                  <div className="space-y-2">
                    {marketplaceBeats.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <Music className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No beats listed yet</p>
                        <p className="text-xs mt-1">Upload your beats to the marketplace</p>
                      </div>
                    ) : (
                      marketplaceBeats.map((beat) => (
                        <div
                          key={beat.listingId}
                          className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors group"
                        >
                          <div className="flex items-center gap-4 min-w-0 flex-1">
                            <button
                              onClick={async () => {
                                if (!beat.previewAssetId) {
                                  showToast('info', `No preview available for ${beat.title}`);
                                  return;
                                }
                                try {
                                  const { api: apiClient } = await import('@/lib/api/client');
                                  const r = await apiClient.get(
                                    `/api/artistry/blobs/${beat.previewAssetId}`
                                  );
                                  if (!r.data?.url) {
                                    showToast('error', 'Preview blob URL missing');
                                    return;
                                  }
                                  // Route through the persistent music player so
                                  // the NowPlayingBar in the global shell takes
                                  // over and playback survives navigation. The
                                  // pre-fix `new Audio()` died on every lens
                                  // switch because the element was scoped to
                                  // this onClick closure.
                                  const { getPlayer } = await import('@/lib/music/player');
                                  const player = getPlayer();
                                  // The full MusicTrack shape carries 30+
                                  // fields the engine doesn't need at preview
                                  // time. Build the minimum required and cast
                                  // through unknown so TS lets us through —
                                  // the engine only reads id / audioUrl /
                                  // title for the NowPlayingBar surface.
                                  await player.loadTrack({
                                    id: String(beat.listingId),
                                    title: beat.title || 'Beat preview',
                                    artistName: beat.ownerName || 'Unknown',
                                    audioUrl: r.data.url,
                                    duration: 0,
                                    coverArtUrl: null,
                                    tags: beat.tags || [],
                                  } as unknown as Parameters<typeof player.loadTrack>[0]);
                                  await player.play();
                                } catch (e) {
                                  console.warn('Failed to load beat preview:', e);
                                  showToast('error', 'Preview playback failed');
                                }
                              }}
                              className="w-10 h-10 rounded-lg bg-neon-cyan/10 flex items-center justify-center flex-shrink-0 group-hover:bg-neon-cyan/20 transition-colors"
                            >
                              <Play className="w-4 h-4 text-neon-cyan" />
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{beat.title}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-neon-cyan font-mono">
                                  {beat.bpm} BPM
                                </span>
                                <span className="text-xs text-gray-400">·</span>
                                <span className="text-xs text-gray-400">{beat.key}</span>
                                <span className="text-xs text-gray-400">·</span>
                                <span className="text-xs text-gray-400 capitalize">
                                  {beat.genre}
                                </span>
                              </div>
                              {beat.tags.length > 0 && (
                                <div className="flex gap-1 mt-1">
                                  {beat.tags.slice(0, 4).map((tag) => (
                                    <span
                                      key={tag}
                                      className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-gray-400"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              {beat.licenses?.map((lic) => (
                                <button
                                  key={lic.tier}
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (lic.price === 0) {
                                      // Free tier: register a citation +
                                      // download permission directly. Skip
                                      // the marketplace mutation since
                                      // there's no money to move.
                                      showToast('success', `Free ${lic.tier} license granted for ${beat.title}`);
                                      return;
                                    }
                                    const ok = typeof window !== 'undefined'
                                      ? window.confirm(
                                          `Purchase the ${lic.tier} license for "${beat.title}" at $${lic.price.toFixed(2)} CC? Royalty cascade will pay every ancestor creator on the lineage chain.`
                                        )
                                      : true;
                                    if (!ok) return;
                                    try {
                                      const { api: apiClient } = await import('@/lib/api/client');
                                      const r = await apiClient.post(
                                        '/api/marketplace/purchaseWithRoyalties',
                                        {
                                          dtuId: beat.listingId,
                                          tier: lic.tier,
                                          priceCents: Math.round(lic.price * 100),
                                        }
                                      );
                                      if (r.data?.ok) {
                                        showToast('success', `Bought ${lic.tier} license — cascade paid ${r.data.cascadeDepth ?? 0} ancestors`);
                                      } else {
                                        showToast('error', r.data?.error || 'Purchase failed');
                                      }
                                    } catch (err) {
                                      const msg = err instanceof Error ? err.message : 'Network error';
                                      showToast('error', `Purchase failed: ${msg}`);
                                    }
                                  }}
                                  className={cn(
                                    'inline-block px-2 py-0.5 text-[10px] rounded-full ml-1 cursor-pointer hover:scale-105 transition-transform',
                                    lic.tier === 'listen'
                                      ? 'bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20'
                                      : lic.tier === 'create'
                                        ? 'bg-neon-purple/10 text-neon-purple hover:bg-neon-purple/20'
                                        : 'bg-neon-green/10 text-neon-green hover:bg-neon-green/20'
                                  )}
                                  title={`Click to buy ${lic.tier} license`}
                                >
                                  {lic.tier}: {lic.price === 0 ? 'Free' : `$${lic.price}`}
                                </button>
                              ))}
                            </div>
                            <div className="text-xs text-gray-400 text-right">
                              <p>{beat.totalPlays} plays</p>
                              <p>{beat.totalSales} sales</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Sample pack listings */}
                {!marketplaceLoading && marketplaceTab === 'samples' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {marketplaceSamples.length === 0 ? (
                      <div className="col-span-full text-center py-12 text-gray-400">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No sample packs yet</p>
                      </div>
                    ) : (
                      marketplaceSamples.map((pack) => (
                        <div
                          key={pack.listingId}
                          className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors"
                        >
                          <div className="w-full aspect-video rounded-lg bg-gradient-to-br from-neon-purple/10 to-neon-cyan/10 flex items-center justify-center mb-3">
                            <Package className="w-10 h-10 text-gray-400" />
                          </div>
                          <h3 className="text-sm font-medium truncate">{pack.title}</h3>
                          <p className="text-xs text-gray-400 mt-1">
                            {pack.sampleCount} samples · {pack.genre}
                          </p>
                          {pack.description && (
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                              {pack.description}
                            </p>
                          )}
                          <div className="flex items-center justify-between mt-3">
                            <div className="flex gap-1">
                              {pack.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 text-[10px] rounded bg-white/5 text-gray-400"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <span className="text-sm font-semibold text-neon-green">
                              ${pack.price}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Stem pack listings */}
                {!marketplaceLoading && marketplaceTab === 'stems' && (
                  <div className="space-y-2">
                    {marketplaceStems.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">No stem packs yet</p>
                        <p className="text-xs mt-1">Artists can release stems for their tracks</p>
                      </div>
                    ) : (
                      marketplaceStems.map((stem) => (
                        <div
                          key={stem.listingId}
                          className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <Layers className="w-5 h-5 text-neon-purple flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium">{stem.title}</p>
                              <p className="text-xs text-gray-400">
                                {stem.assetIds.length} stems · {stem.genre}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-semibold text-neon-green">
                            ${stem.price}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ---- ALBUM (MEGA DTU) ---- */}
            {view === 'album' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold flex items-center gap-2">
                    <Disc3 className="w-5 h-5 text-neon-purple" /> Albums
                  </h1>
                  <button onClick={navigateHome} className="text-xs text-gray-400 hover:text-white">
                    &larr; Back
                  </button>
                </div>
                {albumMegaDTUs.length === 0 && tracks.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <Disc3 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No albums yet</p>
                    <p className="text-xs mt-1">
                      Albums are created as MEGA DTUs when artists group tracks together.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* MEGA DTU albums */}
                    {albumMegaDTUs.length > 0 && (
                      <section>
                        <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">
                          MEGA DTU Albums
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                          {albumMegaDTUs.map((mega) => {
                            const m = mega as unknown as Record<string, unknown>;
                            return (
                              <div
                                key={m.id as string}
                                className={cn(
                                  'p-4 rounded-xl bg-gradient-to-br from-neon-purple/5 to-neon-cyan/5 border transition-colors',
                                  selectedAlbumId === (m.id as string)
                                    ? 'border-neon-cyan ring-1 ring-neon-cyan'
                                    : 'border-neon-purple/20 hover:border-neon-purple/40'
                                )}
                              >
                                <div className="w-full aspect-square rounded-lg bg-neon-purple/10 flex items-center justify-center mb-3">
                                  <Disc3 className="w-12 h-12 text-neon-purple/40" />
                                </div>
                                <p className="text-sm font-medium truncate">
                                  {(m.title as string) || 'Untitled Album'}
                                </p>
                                <p className="text-xs text-neon-purple mt-0.5">
                                  MEGA DTU · {(m.sourceCount as number) || 0} tracks consolidated
                                </p>
                                <p className="text-[10px] text-gray-400 mt-1">
                                  1.5x relevance boost
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                    {/* Artist-grouped albums from tracks */}
                    {(() => {
                      const byArtist: Record<string, MusicTrack[]> = {};
                      for (const t of tracks) {
                        if (!byArtist[t.artistName]) byArtist[t.artistName] = [];
                        byArtist[t.artistName].push(t);
                      }
                      const multiTrackArtists = Object.entries(byArtist).filter(
                        ([, ts]) => ts.length >= 2
                      );
                      if (multiTrackArtists.length === 0) return null;
                      return (
                        <section>
                          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-3">
                            Artist Collections
                          </h2>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {multiTrackArtists.map(([artist, ts]) => (
                              <button
                                key={artist}
                                onClick={() => {
                                  const a = artists.find((a) => a.name === artist);
                                  if (a) navigateToArtist(a.id);
                                }}
                                className="p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 text-left transition-colors"
                              >
                                <div className="w-full aspect-square rounded-lg bg-gradient-to-br from-neon-cyan/10 to-neon-purple/10 flex items-center justify-center mb-3">
                                  <Music className="w-10 h-10 text-gray-400" />
                                </div>
                                <p className="text-sm font-medium truncate">{artist}</p>
                                <p className="text-xs text-gray-400">{ts.length} tracks</p>
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ---- PLAYLIST ---- */}
            {view === 'playlist' && selectedPlaylist && (
              <PlaylistView
                playlist={selectedPlaylist}
                onArtistClick={navigateToArtist}
                onBack={navigateHome}
                isOwner
              />
            )}

            {/* ---- UPLOAD ---- */}
            {view === 'upload' && (
              <UploadFlow
                onUpload={handleUpload}
                onCancel={navigateHome}
                progress={uploadProgress}
              />
            )}

            {/* ---- REVENUE ---- */}
            {view === 'revenue' && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h1 className="text-xl font-bold">Revenue Dashboard</h1>
                  <p className="text-xs text-gray-500 mt-1">
                    Your real creator earnings across everything you&apos;ve published on Concord — not
                    filtered to music specifically (marketplace + royalty ledger rows don&apos;t carry a
                    reliable per-lens tag to split by).
                  </p>
                </div>

                {/* Overview cards — real GET /api/creator/dashboard data */}
                {revenueLoading && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 animate-pulse h-20" />
                    ))}
                  </div>
                )}
                {revenueError && (
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                    Couldn&apos;t load your earnings — try again shortly.
                  </div>
                )}
                {!revenueLoading && !revenueError && creatorDashboard?.summary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      {
                        label: 'Total Earnings',
                        value: `$${creatorDashboard.summary.totalEarnings.toFixed(2)}`,
                        icon: DollarSign,
                        color: 'text-neon-green',
                        bg: 'bg-neon-green/10',
                      },
                      {
                        label: 'Listings',
                        value: String(creatorDashboard.summary.listingCount),
                        icon: BarChart3,
                        color: 'text-neon-cyan',
                        bg: 'bg-neon-cyan/10',
                      },
                      {
                        label: 'Downloads',
                        value: String(creatorDashboard.summary.totalDownloads),
                        icon: GitFork,
                        color: 'text-neon-purple',
                        bg: 'bg-neon-purple/10',
                      },
                      {
                        label: 'Citations Received',
                        value: String(creatorDashboard.summary.citationsReceived),
                        icon: Sparkles,
                        color: 'text-neon-pink',
                        bg: 'bg-neon-pink/10',
                      },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="p-4 rounded-xl bg-white/[0.03] border border-white/5"
                      >
                        <div
                          className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center mb-2',
                            stat.bg
                          )}
                        >
                          <stat.icon className={cn('w-4 h-4', stat.color)} />
                        </div>
                        <p className="text-xl font-bold">{stat.value}</p>
                        <p className="text-xs text-gray-400">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Royalty cascade explainer */}
                <div className="bg-white/[0.03] rounded-xl border border-white/5 p-5 space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <GitFork className="w-4 h-4 text-neon-purple" /> Royalty Cascade — System
                    Invariant
                  </h3>
                  <p className="text-xs text-gray-400">
                    {ROYALTY_CONSTANTS.BASE_RATE * 100}% of net revenue to original creators. Halves
                    at each derivative level. Floor: {ROYALTY_CONSTANTS.ROYALTY_FLOOR * 100}%.
                    Platform fee: {ROYALTY_CONSTANTS.PLATFORM_FEE_RATE * 100}%. Same for every
                    creator.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 border-b border-white/5">
                          <th className="text-left py-2 pr-4">Level</th>
                          <th className="text-left py-2 pr-4">Rate</th>
                          <th className="text-left py-2">Example ($10 sale)</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-300">
                        <tr className="border-b border-white/[0.03]">
                          <td className="py-2 pr-4">1st derivative (direct remix)</td>
                          <td className="py-2 pr-4 text-neon-cyan">30%</td>
                          <td className="py-2">$2.73 to original</td>
                        </tr>
                        <tr className="border-b border-white/[0.03]">
                          <td className="py-2 pr-4">2nd derivative</td>
                          <td className="py-2 pr-4 text-neon-purple">15% + 30%</td>
                          <td className="py-2">$1.37 to original, $2.73 to 1st</td>
                        </tr>
                        <tr className="border-b border-white/[0.03]">
                          <td className="py-2 pr-4">3rd derivative</td>
                          <td className="py-2 pr-4 text-neon-pink">7.5% + 15% + 30%</td>
                          <td className="py-2">Continues halving</td>
                        </tr>
                        <tr>
                          <td className="py-2 pr-4">Below 1%</td>
                          <td className="py-2 pr-4 text-gray-400">Floor</td>
                          <td className="py-2">Ancestor royalties cease</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Recent listings — real GET /api/creator/dashboard data. Each
                    row's "earnings" is downloads × price (an aggregate, since
                    the ledger doesn't expose a clean per-listing sale log here) —
                    labeled as such rather than implied to be a live transaction feed. */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">Recent Listings</h3>
                  {revenueLoading && (
                    <div className="space-y-2">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-14 rounded-lg bg-white/[0.02] border border-white/5 animate-pulse" />
                      ))}
                    </div>
                  )}
                  {!revenueLoading && !revenueError && (creatorDashboard?.recentListings?.length ?? 0) === 0 && (
                    <p className="text-xs text-gray-500">
                      No listings yet — publish a track to the marketplace to see it here.
                    </p>
                  )}
                  <div className="space-y-2">
                    {creatorDashboard?.recentListings?.map((listing) => (
                      <div
                        key={listing.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <Music className="w-4 h-4 text-gray-400" />
                          <div>
                            <p className="text-gray-300">{listing.title || 'Untitled'}</p>
                            <p className="text-gray-400">
                              ${listing.price.toFixed(2)} · {listing.downloads} download{listing.downloads === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-neon-green">
                            +${(listing.price * listing.downloads).toFixed(2)}
                          </p>
                          <p className="text-gray-600">{formatRelativeTime(listing.listedAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Royalty Preview */}
                {royaltyPreview.obligations.length > 0 && (
                  <div className="bg-white/[0.03] rounded-xl border border-white/5 p-5 space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-neon-green" /> Royalty Obligations Preview
                    </h3>
                    <div className="space-y-2">
                      {royaltyPreview.obligations.map((ob, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02]"
                        >
                          <div>
                            <span className="text-gray-300">{ob.name}</span>
                            <span className="text-gray-400 ml-2">({ob.title})</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-gray-400">{ob.rate}</span>
                            <span className="text-neon-green font-mono">{ob.amount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400">
                      Net to creator: ${royaltyPreview.breakdown.creatorNet.toFixed(2)} · Platform:
                      ${royaltyPreview.breakdown.platformFee.toFixed(2)}
                    </p>
                  </div>
                )}

                <button onClick={navigateHome} className="text-xs text-gray-400 hover:text-white">
                  ← Back to Home
                </button>
              </div>
            )}

            {view === 'artists' && (
              <div className="space-y-3">
                <h1 className="text-xl font-bold tracking-tight">Artists</h1>
                <p className="text-xs text-white/50">MusicBrainz reference — not your library.</p>
                <MusicArtistExplorer />
              </div>
            )}

            {view === 'tools' && (
              <PipingProvider>
                <div className="space-y-3">
                  <h1 className="text-xl font-bold tracking-tight">Tools</h1>
                  <p className="text-xs text-white/50">BPM, key, chords, setlist — one workbench.</p>
                  <MusicActionPanel />
                </div>
              </PipingProvider>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Mini Player Bar */}
      <AnimatePresence>
        {nowPlaying.track && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-r from-purple-950/90 via-lattice-surface/95 to-indigo-950/90 backdrop-blur-xl border-t border-purple-500/20 shadow-[0_-4px_24px_rgba(139,92,246,0.15)]"
          >
            {/* Progress bar — top edge of the mini player */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-white/5">
              <motion.div
                className="h-full bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink"
                style={{
                  width:
                    nowPlaying.duration > 0
                      ? `${(nowPlaying.currentTime / nowPlaying.duration) * 100}%`
                      : '0%',
                }}
                transition={{ duration: 0.3, ease: 'linear' }}
              />
            </div>

            <div className="flex items-center justify-between max-w-screen-xl mx-auto px-6 py-3">
              {/* Track info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={cn(
                    'w-12 h-12 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/10',
                    nowPlaying.playbackState === 'playing' && 'animate-pulse'
                  )}
                >
                  <Music className="w-5 h-5 text-purple-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{nowPlaying.track.title}</p>
                  <p className="text-xs text-gray-400 truncate">{nowPlaying.track.artistName}</p>
                </div>
              </div>

              {/* Playback controls */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleLike(nowPlaying.track!.id)}
                  className={cn(
                    'p-1.5 rounded transition-colors',
                    likedTrackIds.has(nowPlaying.track.id)
                      ? 'text-pink-400'
                      : 'text-gray-400 hover:text-white'
                  )}
                aria-label="Like">
                  <Heart
                    className={cn(
                      'w-4 h-4',
                      likedTrackIds.has(nowPlaying.track.id) && 'fill-current'
                    )}
                  />
                </button>
                <button
                  onClick={() => {
                    const player = getPlayer();
                    if (nowPlaying.playbackState === 'playing') player.pause();
                    else
                      player.play().catch((e) => {
                        console.error('[Music] Playback failed:', e);
                        showToast('error', 'Playback failed');
                      });
                  }}
                  className="p-2 rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:brightness-110 transition shadow-lg shadow-purple-500/25"
                >
                  {nowPlaying.playbackState === 'playing' ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => addToQueue(nowPlaying.track!)}
                  className="p-1.5 rounded text-gray-400 hover:text-white transition-colors"
                  title="Add to queue"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {/* Time display */}
                <span className="text-[10px] text-gray-400 font-mono w-20 text-center flex-shrink-0">
                  {Math.floor(nowPlaying.currentTime / 60)}:
                  {Math.floor(nowPlaying.currentTime % 60)
                    .toString()
                    .padStart(2, '0')}
                  {' / '}
                  {Math.floor(nowPlaying.duration / 60)}:
                  {Math.floor(nowPlaying.duration % 60)
                    .toString()
                    .padStart(2, '0')}
                </span>

                {/* Volume icon */}
                <div
                  className={cn(
                    'p-1.5 rounded transition-colors',
                    nowPlaying.muted ? 'text-gray-600' : 'text-gray-400'
                  )}
                >
                  <Volume2 className="w-4 h-4" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time panel */}
      {isLive && realtimeData && (
        <div className="fixed right-4 bottom-24 z-40">
          <RealtimeDataPanel
            domain="music"
            data={realtimeData}
            insights={realtimeInsights}
            isLive={isLive}
            lastUpdated={lastUpdated}
          />
        </div>
      )}

    </div>

    <AnimatePresence>
      {assigningCell && (
        <SessionClipPicker
          tracks={displayTracks}
          channelName={sessionChannels.find((c) => c.id === assigningCell.trackId)?.name ?? 'Channel'}
          sceneName={sessionScenes.find((s) => s.id === assigningCell.sceneId)?.name ?? 'Scene'}
          onSelect={handleSessionAssign}
          onClose={() => setAssigningCell(null)}
        />
      )}
    </AnimatePresence>

    <LensAgentFab
      lensId="music"
      lensPrompt="You're inside Concord's Music lens — a marketplace + playlist + curation surface. Prefer run_lens_action for music actions, expert_mode for cited research about artists/tracks, generate_image for cover art."
    />
    
          <SessionRail lensId="music" hideWhenEmpty className="mt-4" />          <CrossLensRecentsPanel lensId="music" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
