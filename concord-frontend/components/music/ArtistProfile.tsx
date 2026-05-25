'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Music, Disc3, BarChart3, ExternalLink, CheckCircle2,
  PlayCircle, DollarSign, GitFork,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Artist, MusicTrack, Album } from '@/lib/music/types';
import { TrackCard } from './TrackCard';

type ArtistTab = 'tracks' | 'albums' | 'about';

interface ArtistProfileProps {
  artist: Artist;
  tracks: MusicTrack[];
  albums: Album[];
  onAlbumClick: (albumId: string) => void;
  onBack: () => void;
}

export function ArtistProfile({ artist, tracks, albums, onAlbumClick, onBack }: ArtistProfileProps) {
  const [tab, setTab] = useState<ArtistTab>('tracks');

  return (
    <div className="space-y-6">
      {/* Banner & header */}
      <div className="relative">
        <div
          className="h-48 bg-gradient-to-b from-neon-purple/20 to-transparent rounded-xl overflow-hidden"
          style={artist.bannerUrl ? { backgroundImage: `url(${artist.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        />
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-4 flex items-end gap-4">
          <div className="relative w-28 h-28 rounded-full bg-lattice-surface border-4 border-lattice-void overflow-hidden shadow-xl -mb-4">
            {artist.avatarUrl ? (
              <Image src={artist.avatarUrl} alt={artist.name} fill className="object-cover" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-cyan/30 to-neon-purple/30">
                <Music className="w-10 h-10 text-gray-400" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{artist.name}</h1>
              {artist.verified && <CheckCircle2 className="w-5 h-5 text-neon-cyan" />}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
              {artist.genres.slice(0, 3).map(g => (
                <span key={g} className="px-2 py-0.5 rounded-full bg-white/5 capitalize">{g}</span>
              ))}
            </div>
          </div>
          <button onClick={onBack} className="text-xs text-gray-400 hover:text-white">Back</button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 px-6 pt-4">
        {[
          { icon: Music, label: 'Tracks', value: artist.stats.totalTracks },
          { icon: Disc3, label: 'Albums', value: artist.stats.totalAlbums },
          { icon: PlayCircle, label: 'Total Plays', value: artist.stats.totalPlays.toLocaleString() },
          { icon: DollarSign, label: 'Revenue', value: `$${artist.stats.totalRevenue.toFixed(2)}` },
          { icon: GitFork, label: 'Remixes of Work', value: artist.stats.remixesOfWork },
        ].map(stat => (
          <div key={stat.label} className="text-center">
            <div className="flex items-center justify-center gap-1 text-gray-400 mb-0.5">
              <stat.icon className="w-3 h-3" />
              <span className="text-[10px] uppercase">{stat.label}</span>
            </div>
            <span className="text-sm font-semibold">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 border-b border-white/5">
        {(['tracks', 'albums', 'about'] as ArtistTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm capitalize border-b-2 transition-colors',
              tab === t ? 'border-neon-cyan text-neon-cyan' : 'border-transparent text-gray-400 hover:text-white',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-6">
        {tab === 'tracks' && (
          <div className="space-y-1">
            {tracks.map(track => (
              <TrackCard
                key={track.id}
                track={track}
                variant="row"
                showTiers
                showLineage
              />
            ))}
            {tracks.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <Music className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No tracks published yet</p>
              </div>
            )}
          </div>
        )}

        {tab === 'albums' && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {albums.map(album => (
              <button
                key={album.id}
                onClick={() => onAlbumClick(album.id)}
                className="group bg-white/[0.03] rounded-xl border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all overflow-hidden text-left"
              >
                <div className="relative aspect-square bg-white/5 overflow-hidden">
                  {album.coverArtUrl ? (
                    <Image src={album.coverArtUrl} alt={album.title || 'Album cover'} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-purple/20 to-neon-cyan/20">
                      <Disc3 className="w-12 h-12 text-gray-600" />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium truncate">{album.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {album.type.toUpperCase()} · {album.trackCount} tracks · {album.releaseDate.slice(0, 4)}
                  </p>
                </div>
              </button>
            ))}
            {albums.length === 0 && (
              <div className="col-span-full text-center py-12 text-gray-400">
                <Disc3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No albums yet</p>
              </div>
            )}
          </div>
        )}

        {tab === 'about' && (
          <div className="max-w-2xl space-y-4">
            {artist.bio && <p className="text-sm text-gray-300 leading-relaxed">{artist.bio}</p>}

            {artist.links.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Links</h3>
                <div className="flex flex-wrap gap-2">
                  {artist.links.map(link => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {artist.associatedLenses.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Lenses</h3>
                <div className="flex flex-wrap gap-2">
                  {artist.associatedLenses.map(lens => (
                    <a
                      key={lens}
                      href={`/lenses/${lens}`}
                      className="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-neon-cyan hover:bg-neon-cyan/10 transition-colors capitalize"
                    >
                      {lens}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Revenue breakdown (artist's own view) */}
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Revenue</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Direct Sales', value: artist.stats.totalRevenue, icon: DollarSign },
                  { label: 'Citation Royalties', value: artist.stats.citationRoyaltyIncome, icon: BarChart3 },
                  { label: 'Remix Royalties', value: artist.stats.remixRoyaltyIncome, icon: GitFork },
                ].map(stat => (
                  <div key={stat.label} className="p-3 rounded-lg bg-white/5 border border-white/5">
                    <stat.icon className="w-4 h-4 text-neon-green mb-1" />
                    <p className="text-lg font-semibold">${stat.value.toFixed(2)}</p>
                    <p className="text-[10px] text-gray-400">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-gray-400 pt-4">
              Joined {new Date(artist.joinedAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
