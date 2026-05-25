'use client';

import Image from 'next/image';
import {
  Play, Pause, Clock, Disc3,
} from 'lucide-react';
import { useMusicStore } from '@/lib/music/store';
import type { Album, ArtifactTier } from '@/lib/music/types';
import { TrackCard } from './TrackCard';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

interface AlbumViewProps {
  album: Album;
  onArtistClick: (artistId: string) => void;
  onPurchase?: (trackId: string, tier: ArtifactTier) => void;
  onBack: () => void;
}

export function AlbumView({ album, onArtistClick, onPurchase, onBack }: AlbumViewProps) {
  const { nowPlaying, playAlbum } = useMusicStore();

  const isAlbumPlaying = album.tracks.some(
    t => t.id === nowPlaying.track?.id && nowPlaying.playbackState === 'playing'
  );

  const handlePlayAll = () => {
    if (album.tracks.length > 0) {
      playAlbum(album.tracks, 0);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex gap-6">
        {/* Cover */}
        <div className="relative w-56 h-56 rounded-xl bg-white/5 overflow-hidden shadow-2xl flex-shrink-0">
          {album.coverArtUrl ? (
            <Image src={album.coverArtUrl} alt={album.title} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20">
              <Disc3 className="w-20 h-20 text-gray-600" />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end space-y-2">
          <span className="text-xs text-gray-400 uppercase">{album.type}</span>
          <h1 className="text-3xl font-bold">{album.title}</h1>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span
              className="cursor-pointer hover:text-white transition-colors"
              onClick={() => onArtistClick(album.artistId)}
            >
              {album.artistName}
            </span>
            <span>·</span>
            <span>{album.releaseDate.slice(0, 4)}</span>
            <span>·</span>
            <span>{album.trackCount} tracks, {formatDuration(album.totalDuration)}</span>
          </div>
          {album.genre && (
            <span className="inline-block px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-400 w-fit capitalize">
              {album.genre}
            </span>
          )}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handlePlayAll}
              className="flex items-center gap-2 px-6 py-2 rounded-full bg-neon-cyan text-black text-sm font-semibold hover:brightness-110 transition"
            >
              {isAlbumPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isAlbumPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={onBack} className="text-xs text-gray-400 hover:text-white">Back</button>
          </div>
          {album.description && (
            <p className="text-xs text-gray-400 max-w-lg">{album.description}</p>
          )}
        </div>
      </div>

      {/* Track list */}
      <div>
        <div className="flex items-center gap-4 px-3 py-2 text-[10px] text-gray-400 uppercase border-b border-white/5">
          <span className="w-8 text-center">#</span>
          <span className="flex-1">Title</span>
          <span className="w-20 text-right">Plays</span>
          <span className="w-12 text-right"><Clock className="w-3 h-3 inline" /></span>
          <span className="w-20 text-right">Tiers</span>
        </div>
        <div className="space-y-0.5 mt-1">
          {album.tracks.map((track, i) => (
            <TrackCard
              key={track.id}
              track={{ ...track, trackNumber: track.trackNumber || i + 1 }}
              variant="row"
              showTiers
              showLineage
              onArtistClick={onArtistClick}
              onPurchase={(t, tier) => onPurchase?.(t.id, tier)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
