'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Play, Pause, Clock, ListMusic, Edit3, Trash2,
  Share2, Globe, Lock,
} from 'lucide-react';
import { useMusicStore } from '@/lib/music/store';
import type { Playlist } from '@/lib/music/types';
import { TrackCard } from './TrackCard';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

interface PlaylistViewProps {
  playlist: Playlist;
  onArtistClick: (artistId: string) => void;
  onRemoveTrack?: (trackId: string) => void;
  onUpdatePlaylist?: (updates: Partial<Playlist>) => void;
  onDeletePlaylist?: () => void;
  onBack: () => void;
  isOwner?: boolean;
}

export function PlaylistView({
  playlist,
  onArtistClick,
  onRemoveTrack,
  onUpdatePlaylist,
  onDeletePlaylist,
  onBack,
  isOwner = false,
}: PlaylistViewProps) {
  const { nowPlaying, playPlaylist } = useMusicStore();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(playlist.name);
  const [editDesc, setEditDesc] = useState(playlist.description || '');

  const tracks = playlist.tracks.map(pt => pt.track);
  const isPlaylistPlaying = tracks.some(
    t => t.id === nowPlaying.track?.id && nowPlaying.playbackState === 'playing'
  );

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playPlaylist(tracks, playlist.id, playlist.name, 0);
    }
  };

  const handleSaveEdit = () => {
    onUpdatePlaylist?.({ name: editName, description: editDesc || null });
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex gap-6">
        <div className="relative w-48 h-48 rounded-xl bg-white/5 overflow-hidden shadow-xl flex-shrink-0">
          {playlist.coverArtUrl ? (
            <Image src={playlist.coverArtUrl} alt={playlist.name || 'Playlist cover'} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20">
              <ListMusic className="w-16 h-16 text-gray-600" />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end space-y-2 flex-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>PLAYLIST</span>
            {playlist.isPublic ? (
              <span className="flex items-center gap-0.5"><Globe className="w-3 h-3" /> Public</span>
            ) : (
              <span className="flex items-center gap-0.5"><Lock className="w-3 h-3" /> Private</span>
            )}
            {playlist.isCollaborative && <span className="text-neon-purple">Collaborative</span>}
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="text-2xl font-bold bg-transparent border-b border-white/20 focus:border-neon-cyan/50 outline-none w-full"
              />
              <textarea
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                className="text-sm text-gray-400 bg-transparent border border-white/10 rounded-lg p-2 w-full resize-none focus:outline-none focus:border-neon-cyan/50"
                rows={2}
                placeholder="Add a description..."
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} className="text-xs px-3 py-1 bg-neon-cyan/10 text-neon-cyan rounded">Save</button>
                <button onClick={() => setEditing(false)} className="text-xs px-3 py-1 text-gray-400 hover:text-white">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold">{playlist.name}</h1>
              {playlist.description && <p className="text-sm text-gray-400">{playlist.description}</p>}
            </>
          )}

          <div className="text-xs text-gray-500">
            {playlist.creatorName} · {playlist.tracks.length} tracks · {formatDuration(playlist.totalDuration)}
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-6 py-2 rounded-full bg-neon-cyan text-black text-sm font-semibold hover:brightness-110 transition disabled:opacity-30"
            >
              {isPlaylistPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaylistPlaying ? 'Pause' : 'Play'}
            </button>
            {isOwner && (
              <>
                <button onClick={() => setEditing(!editing)} className="p-2 text-gray-400 hover:text-white">
                  <Edit3 className="w-4 h-4" />
                </button>
                <button onClick={onDeletePlaylist} className="p-2 text-gray-400 hover:text-red-400">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('playlist:share', { detail: { playlistId: playlist?.id } })); }}
              aria-label="Share playlist"
              className="p-2 text-gray-400 hover:text-white"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button onClick={onBack} className="text-xs text-gray-400 hover:text-white ml-auto">Back</button>
          </div>
        </div>
      </div>

      {/* Track list header */}
      <div className="flex items-center gap-4 px-3 py-2 text-[10px] text-gray-500 uppercase border-b border-white/5">
        <span className="w-8 text-center">#</span>
        <span className="flex-1">Title</span>
        <span className="w-24 text-right">Added</span>
        <span className="w-12 text-right"><Clock className="w-3 h-3 inline" /></span>
      </div>

      {/* Track list */}
      <div className="space-y-0.5">
        {playlist.tracks.map((pt, _i) => (
          <div key={pt.trackId} className="group flex items-center">
            <div className="flex-1">
              <TrackCard
                track={pt.track}
                variant="row"
                showTiers
                onArtistClick={onArtistClick}
              />
            </div>
            {isOwner && (
              <button
                onClick={() => onRemoveTrack?.(pt.trackId)}
                className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {tracks.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <ListMusic className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No tracks in this playlist yet</p>
            <p className="text-xs mt-1">Browse the Music Lens and add tracks</p>
          </div>
        )}
      </div>
    </div>
  );
}
