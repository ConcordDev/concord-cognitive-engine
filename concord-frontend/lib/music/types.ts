// ============================================================================
// Music Lens — Complete Type System
// Covers: streaming, playback, queue, artist profiles, albums, playlists,
// artifact tiers, licensing, royalty cascade, upload, and DTU integration.
// ============================================================================

// ============================================================================
// Artifact Sovereignty Tiers
// ============================================================================

export type ArtifactTier = 'listen' | 'create' | 'commercial';

export interface TierConfig {
  tier: ArtifactTier;
  enabled: boolean;
  price: number; // 0 = free
  currency: string;
  maxLicenses: number | null; // null = unlimited
  licensesIssued: number;
}

export interface TierRights {
  stream: boolean;
  backgroundPlay: boolean;
  addToPlaylist: boolean;
  offlineCache: boolean;
  download: boolean;
  remix: boolean;
  sample: boolean;
  derivativeWorks: boolean;
  commercialUse: boolean;
  syncLicense: boolean;
  publicPerformance: boolean;
}

export const TIER_RIGHTS: Record<ArtifactTier, TierRights> = {
  listen: {
    stream: true,
    backgroundPlay: true,
    addToPlaylist: true,
    offlineCache: true,
    download: false,
    remix: false,
    sample: false,
    derivativeWorks: false,
    commercialUse: false,
    syncLicense: false,
    publicPerformance: false,
  },
  create: {
    stream: true,
    backgroundPlay: true,
    addToPlaylist: true,
    offlineCache: true,
    download: true,
    remix: true,
    sample: true,
    derivativeWorks: true,
    commercialUse: false,
    syncLicense: false,
    publicPerformance: false,
  },
  commercial: {
    stream: true,
    backgroundPlay: true,
    addToPlaylist: true,
    offlineCache: true,
    download: true,
    remix: true,
    sample: true,
    derivativeWorks: true,
    commercialUse: true,
    syncLicense: true,
    publicPerformance: true,
  },
};

// ============================================================================
// Tracks & Albums
// ============================================================================

export interface MusicTrack {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  albumId: string | null;
  albumTitle: string | null;
  coverArtUrl: string | null;
  audioUrl: string; // streaming endpoint
  previewUrl: string | null; // 30s preview for Artistry
  duration: number; // seconds
  trackNumber: number | null;
  genre: string;
  subGenre: string | null;
  tags: string[];

  // Audio analysis (from Audio DTU)
  bpm: number | null;
  key: string | null;
  loudnessLUFS: number | null;
  spectralCentroid: number | null;
  onsetDensity: number | null;
  waveformPeaks: number[]; // downsampled for display

  // Tiers & pricing
  tiers: TierConfig[];

  // Stats
  playCount: number;
  purchaseCount: number;
  remixCount: number;

  // Lineage
  parentTrackId: string | null; // if this is a derivative
  parentArtistId: string | null;
  parentTitle: string | null;
  lineageDepth: number; // 0 = original, 1 = first remix, etc.

  // Stems (available with Create/Commercial tier)
  stems: StemFile[];

  // Metadata
  releaseDate: string; // ISO datetime
  createdAt: string;
  updatedAt: string;
  isExplicit: boolean;
  lyrics: string | null;
  credits: TrackCredit[];

  // Dedup
  chromaprintHash: string | null;
}

export interface StemFile {
  id: string;
  name: string; // e.g. "Drums", "Bass", "Vocals"
  url: string;
  format: 'wav' | 'flac';
  sampleRate: number;
  bitDepth: number;
}

export interface TrackCredit {
  role: string; // producer, vocalist, guitarist, etc.
  name: string;
  userId: string | null;
}

export interface Album {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  coverArtUrl: string | null;
  releaseDate: string;
  type: 'album' | 'single' | 'ep';
  tracks: MusicTrack[];
  genre: string;
  description: string | null;
  totalDuration: number;
  trackCount: number;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// Artist
// ============================================================================

export interface Artist {
  id: string;
  name: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  verified: boolean;
  genres: string[];
  links: ArtistLink[];
  associatedLenses: string[]; // studio, art, etc.
  stats: ArtistStats;
  joinedAt: string;
}

export interface ArtistLink {
  platform: string;
  url: string;
  label: string;
}

export interface ArtistStats {
  totalTracks: number;
  totalAlbums: number;
  totalPlays: number;
  totalPurchases: number;
  totalRevenue: number;
  citationRoyaltyIncome: number;
  remixRoyaltyIncome: number;
  remixesOfWork: number;
}

// ============================================================================
// Playback & Queue
// ============================================================================

export type RepeatMode = 'off' | 'all' | 'one';
export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'loading' | 'buffering';

export interface NowPlayingState {
  track: MusicTrack | null;
  playbackState: PlaybackState;
  currentTime: number; // seconds
  duration: number;
  volume: number; // 0-1
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
}

export interface QueueItem {
  id: string; // unique queue item id (track can appear multiple times)
  track: MusicTrack;
  addedAt: number; // timestamp
  source: QueueSource;
}

export interface QueueSource {
  type: 'album' | 'playlist' | 'artist' | 'search' | 'manual' | 'autoplay';
  id?: string;
  name?: string;
}

export interface QueueState {
  items: QueueItem[];
  currentIndex: number;
  history: QueueItem[]; // previously played
}

// ============================================================================
// Playlists
// ============================================================================

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  coverArtUrl: string | null;
  creatorId: string;
  creatorName: string;
  isCollaborative: boolean;
  isPublic: boolean;
  tracks: PlaylistTrack[];
  totalDuration: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistTrack {
  trackId: string;
  track: MusicTrack;
  addedAt: string;
  addedBy: string;
  position: number;
}

// ============================================================================
// Library
// ============================================================================

export interface UserLibrary {
  purchasedTracks: LicensedTrack[];
  likedTracks: string[]; // track IDs
  playlists: Playlist[];
  recentlyPlayed: PlayHistoryEntry[];
  offlineTracks: string[]; // track IDs cached in IndexedDB
}

export interface LicensedTrack {
  trackId: string;
  track: MusicTrack;
  licenseId: string;
  tier: ArtifactTier;
  rights: TierRights;
  purchasedAt: string;
}

export interface PlayHistoryEntry {
  trackId: string;
  track: MusicTrack;
  playedAt: string;
  duration: number; // how long they listened
}

// ============================================================================
// License DTU
// ============================================================================

export interface LicenseDTU {
  id: string;
  licenseeId: string;
  artifactId: string;
  tier: ArtifactTier;
  rights: TierRights;
  royaltyRate: 0.30; // system invariant — always 30%
  attributionRequired: true; // system invariant — always true
  purchasedAt: string;
  txId: string;
}

// ============================================================================
// Royalty Cascade
// ============================================================================

export interface LineageEdge {
  derivativeArtifactId: string;
  sourceArtifactId: string;
  licenseId: string;
  depth: number; // 1 = direct remix, 2 = remix of remix, etc.
}

export interface RoyaltyDistribution {
  recipientId: string;
  recipientName: string;
  artifactId: string;
  artifactTitle: string;
  depth: number;
  rate: number; // 0.30, 0.15, 0.075, etc.
  amount: number;
}

export interface RoyaltyCascadeResult {
  grossRevenue: number;
  platformFee: number; // < 10%
  platformFeeRate: number;
  netRevenue: number;
  distributions: RoyaltyDistribution[];
  creatorNet: number; // what the direct seller keeps
}

// ============================================================================
// Upload
// ============================================================================

export interface UploadTrackData {
  title: string;
  genre: string;
  subGenre: string | null;
  tags: string[];
  albumId: string | null;
  trackNumber: number | null;
  isExplicit: boolean;
  lyrics: string | null;
  credits: TrackCredit[];
  tiers: TierConfig[];
  previewStart: number; // seconds offset for Artistry preview
  previewDuration: number; // seconds
  crossPostToArtistry: boolean;
  parentTrackId: string | null; // if derivative
  parentLicenseId: string | null; // license DTU for derivative
}

export interface UploadProgress {
  stage: 'uploading' | 'analyzing' | 'processing' | 'complete' | 'error';
  progress: number; // 0-100
  audioAnalysis: AudioAnalysisResult | null;
  error: string | null;
}

export interface AudioAnalysisResult {
  bpm: number;
  key: string;
  loudnessLUFS: number;
  spectralCentroid: number;
  onsetDensity: number;
  waveformPeaks: number[];
  chromaprintHash: string;
  duration: number;
  sampleRate: number;
  bitDepth: number;
  channels: number;
}

// ============================================================================
// Music Lens Views
// ============================================================================

export type MusicLensView =
  | 'home'
  | 'browse'
  | 'library'
  | 'artist'
  | 'album'
  | 'playlist'
  | 'upload'
  | 'track'
  | 'search'
  | 'queue'
  | 'revenue'
  | 'marketplace'
  | 'session';   // Session view: clip-launching grid

// ---------- Marketplace types ----------

export interface BeatListing {
  listingId: string;
  title: string;
  assetId: string;
  bpm: number;
  key: string;
  genre: string;
  tags: string[];
  licenses: { tier: ArtifactTier; price: number; currency: string }[];
  ownerId: string;
  ownerName?: string;
  previewAssetId?: string;
  totalSales: number;
  totalPlays: number;
  createdAt: string;
  status: string;
}

export interface SamplePackListing {
  listingId: string;
  title: string;
  assetIds: string[];
  sampleCount: number;
  genre: string;
  tags: string[];
  price: number;
  description: string;
  ownerId: string;
  ownerName?: string;
  createdAt: string;
  status: string;
}

export interface StemPackListing {
  listingId: string;
  title: string;
  assetIds: string[];
  parentTrackId: string;
  genre: string;
  tags: string[];
  price: number;
  ownerId: string;
  ownerName?: string;
  createdAt: string;
  status: string;
}

export interface MusicLensState {
  view: MusicLensView;
  selectedArtistId: string | null;
  selectedAlbumId: string | null;
  selectedTrackId: string | null;
  selectedPlaylistId: string | null;
  searchQuery: string;
  browseGenre: string | null;
  browseMood: string | null;
}
