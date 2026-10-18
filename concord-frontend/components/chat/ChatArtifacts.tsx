'use client';

/**
 * ChatArtifacts — playable / viewable results attached to a regular Chat reply
 * (INC-128). Same artifact shapes and players as Agent mode: a studio.compose
 * song renders with SongArtifactPlayer, an iTunes preview or stored audio file
 * plays inline (and in the global mini-player via useMediaStore), and a GPU
 * image shows inline. Unknown kinds render nothing.
 */

import dynamic from 'next/dynamic';
import { Play } from 'lucide-react';
import { useMediaStore } from '@/store/media';
import type { ComposedSong } from '@/lib/daw/render-song';
import { SongArtifactPlayer } from './SongArtifactPlayer';

// three.js only loads when a reply actually carries a 3D model.
const MeshArtifactView = dynamic(() => import('./MeshArtifactView'), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-lg bg-white/5" />,
});

export interface ChatArtifact {
  kind?: string;
  type?: string;
  id?: string;
  title?: string;
  url?: string;
  dataUrl?: string;
  image_b64?: string;
  prompt?: string;
  source?: string;
  mimeType?: string;
  artist?: string;
  projectId?: string;
  bpm?: number;
  key?: string;
  durationSec?: number;
  song?: Record<string, unknown>;
  /** kind 'mesh' (ConKay conkay_design): triangle mesh of the solved part. */
  positions?: number[];
  indices?: number[];
  color?: string | null;
  pass?: boolean | null;
  vertexCount?: number;
  triangleCount?: number;
}

const SAFE_SRC = /^(?:https?:\/\/|\/|data:(?:image|audio)\/)/i;

export function ChatArtifacts({ artifacts }: { artifacts?: ChatArtifact[] }) {
  const list = Array.isArray(artifacts) ? artifacts.filter(Boolean).slice(0, 6) : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-2 space-y-2" data-testid="chat-artifacts">
      {list.map((a, i) => {
        const kind = a.kind || a.type;
        const src = a.url || a.dataUrl || '';
        if (kind === 'song' && a.song) {
          return (
            <SongArtifactPlayer
              key={i}
              artifact={{
                kind: 'song',
                projectId: a.projectId || '',
                title: a.title || 'Concord Studio Song',
                bpm: a.bpm || 120,
                key: a.key || 'C',
                durationSec: a.durationSec || 0,
                song: a.song as unknown as ComposedSong,
              }}
            />
          );
        }
        if (kind === 'audio' && SAFE_SRC.test(src)) {
          return (
            <div key={i} className="rounded-lg ring-1 ring-zinc-800 bg-zinc-900/50 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate">{a.title || 'Audio'}</div>
                  {a.artist && <div className="text-[11px] text-zinc-400">{a.artist}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => useMediaStore.getState().play({
                    id: `audio-${src}`,
                    src,
                    title: a.title || 'Audio',
                    artist: a.artist || 'Concord',
                    lens: 'chat',
                  })}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs"
                  title="Play in mini-player"
                >
                  <Play className="w-3 h-3" />
                  Mini-player
                </button>
              </div>
              <audio controls preload="none" src={src} className="w-full h-8" />
            </div>
          );
        }
        if (kind === 'image' && (SAFE_SRC.test(src) || a.image_b64)) {
          return (
            <div key={i} className="rounded-lg overflow-hidden ring-1 ring-zinc-800 max-w-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src || `data:image/png;base64,${a.image_b64}`} alt={a.prompt || a.title || 'Generated image'} className="w-full h-auto" />
              {a.prompt && <div className="px-3 py-1.5 text-[11px] text-zinc-400 bg-zinc-900">{a.prompt}</div>}
            </div>
          );
        }
        if (kind === 'mesh' && Array.isArray(a.positions) && Array.isArray(a.indices) && a.positions.length >= 9) {
          return (
            <div key={i} className="max-w-md space-y-1">
              <MeshArtifactView positions={a.positions} indices={a.indices} color={a.color} title={a.title} />
              <div className="text-[11px] text-zinc-400">
                {a.title || '3D model'}
                {typeof a.triangleCount === 'number' ? ` · ${a.triangleCount} triangles` : ''}
                {a.pass === true ? ' · passes' : a.pass === false ? ' · fails the check' : ''}
                {' · drag to orbit'}
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export default ChatArtifacts;
