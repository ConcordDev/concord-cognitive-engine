'use client';

/**
 * SongArtifactPlayer — plays a studio.compose song inline.
 *
 * The server returns the composition (notes + drum pattern); this renders it
 * to a real WAV in the browser with Concord Studio's own synth/drum engines
 * (OfflineAudioContext), then offers inline playback, the global mini-player,
 * WAV download, "Save to Concord" (studio.bounce stores the audio
 * server-side), and "Open in Studio" (/lenses/studio?project=<id>).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { Play, Download, Save, Disc, Loader2, AlertCircle } from 'lucide-react';
import { useMediaStore } from '@/store/media';
import { lensRun } from '@/lib/api/client';
import { renderSongToWav } from '@/lib/daw/render-song';
import type { ComposedSong } from '@/lib/daw/render-song';

export interface SongArtifact {
  kind: 'song';
  projectId: string;
  title: string;
  bpm: number;
  key: string;
  durationSec: number;
  song: ComposedSong;
}

interface SongArtifactPlayerProps {
  artifact: SongArtifact;
}

/** studio.bounce rides /api/lens/run (10 MB JSON cap); keep the upload well under. */
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function cleanFileName(title: string): string {
  return (title || 'concord-song').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || 'concord-song';
}

export function SongArtifactPlayer({ artifact }: SongArtifactPlayerProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const renderPromise = useRef<Promise<string | null> | null>(null);

  const ensureRendered = useCallback((): Promise<string | null> => {
    if (!renderPromise.current) {
      renderPromise.current = (async () => {
        try {
          const { blob } = await renderSongToWav(artifact.song);
          blobRef.current = blob;
          const url = URL.createObjectURL(blob);
          setObjectUrl(url);
          return url;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Rendering failed');
          return null;
        }
      })();
    }
    return renderPromise.current;
  }, [artifact.song]);

  // Render as soon as the card mounts so the inline player is ready.
  useEffect(() => { void ensureRendered(); }, [ensureRendered]);

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const loading = !objectUrl && !error;

  const handleMiniPlayer = useCallback(async () => {
    const url = await ensureRendered();
    if (!url) return;
    useMediaStore.getState().play({
      id: `song-${artifact.projectId || artifact.title}`,
      src: url,
      title: artifact.title,
      artist: 'Concord Studio',
      lens: 'chat',
      duration: artifact.durationSec,
    });
  }, [ensureRendered, artifact.projectId, artifact.title, artifact.durationSec]);

  const handleDownload = useCallback(async () => {
    const url = await ensureRendered();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanFileName(artifact.title)}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [ensureRendered, artifact.title]);

  const handleSave = useCallback(async () => {
    const url = await ensureRendered();
    if (!url || !blobRef.current) return;
    setSaving(true);
    setSavedUrl(null);
    setError(null);
    try {
      let blob = blobRef.current;
      if (blob.size > MAX_UPLOAD_BYTES) {
        // Long songs: store a compact mono 22.05 kHz bounce instead.
        blob = (await renderSongToWav(artifact.song, { sampleRate: 22050, channels: 1 })).blob;
      }
      const audioDataUrl = await blobToDataUrl(blob);
      const r = await lensRun<{ render?: { artifactId?: string; downloadUrl?: string; error?: string } }>(
        'studio',
        'bounce',
        { projectId: artifact.projectId, audioDataUrl },
      );
      const downloadUrl = r.data?.result?.render?.downloadUrl;
      if (!r.data?.ok || !downloadUrl) {
        throw new Error(r.data?.error || r.data?.result?.render?.error || 'Save did not return a download link');
      }
      setSavedUrl(downloadUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [ensureRendered, artifact.projectId, artifact.song]);

  const genre = artifact.song?.genre;

  return (
    <div className="rounded-lg overflow-hidden ring-1 ring-zinc-800 bg-zinc-900/50 p-3 space-y-2" data-testid="song-artifact">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-zinc-100 truncate">{artifact.title}</div>
          <div className="text-[11px] text-zinc-400">
            {genre ? `${genre} · ` : ''}{artifact.key} · {artifact.bpm} BPM · ~{Math.round(artifact.durationSec)}s
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleMiniPlayer}
            disabled={!!error}
            className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs disabled:opacity-50"
            title="Play in mini-player"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Mini-player
          </button>
          <button
            onClick={handleDownload}
            disabled={!objectUrl}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs disabled:opacity-50"
            title="Download WAV"
          >
            <Download className="w-3 h-3" />
            Download
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Rendering with Concord Studio…
        </div>
      )}
      {objectUrl && (
        <audio controls preload="auto" src={objectUrl} className="w-full h-8" data-testid="song-audio" />
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !objectUrl}
          className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs disabled:opacity-50"
          title="Save the rendered WAV to your Concord Studio project"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save to Concord
        </button>
        {artifact.projectId && (
          <Link
            href={`/lenses/studio?project=${encodeURIComponent(artifact.projectId)}`}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs"
            title="Open in Studio"
          >
            <Disc className="w-3 h-3" />
            Open in Studio
          </Link>
        )}
      </div>

      {savedUrl && (
        <div className="text-xs text-zinc-400">
          Saved to Concord —{' '}
          <a href={savedUrl} className="text-amber-400 hover:text-amber-300 underline" download>
            download saved WAV
          </a>
        </div>
      )}
    </div>
  );
}
