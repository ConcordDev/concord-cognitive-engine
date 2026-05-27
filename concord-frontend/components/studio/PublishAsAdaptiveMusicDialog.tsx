'use client';

/**
 * PublishAsAdaptiveMusicDialog — Concordia content-engine bridge UI
 * for the studio (DAW) lens. Bounces the current studio project to a
 * reference stem in-browser via OfflineAudioContext, captures the
 * manifest (tracks/clips/fx as JSON), and submits both to
 * studio.publish-as-adaptive-music.
 *
 * Frontend AdaptiveMusicBridge picks up the published DTUs by
 * region+intensity tag on world-region transitions and crossfades the
 * reference stem in over the procedural fallback floor. Royalty
 * cascade tracks every derivative.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const REGIONS = ['tavern', 'archive', 'forge', 'market', 'tower', 'plaza', 'wilderness', 'arena', 'underground'] as const;
const INTENSITIES = ['ambient', 'active', 'battle'] as const;

type Region = typeof REGIONS[number];
type Intensity = typeof INTENSITIES[number];

interface PublishResult {
  dtuId: string;
  artifactId: string;
  region: Region;
  intensity: Intensity;
  durationMs: number;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PublishAsAdaptiveMusicDialogProps {
  projectId: string;
  projectTitle?: string;
  /** Project manifest — tracks/clips/effects JSON. Caller passes from the studio state. */
  manifest: Record<string, unknown>;
  /** Caller-supplied audio buffer for the reference stem. The component
   *  handles WAV encoding + data-URL conversion before submit. */
  referenceBuffer: AudioBuffer | null;
  onClose: () => void;
}

/** Encode an AudioBuffer to a 16-bit PCM WAV data URL. Browser-side. */
function encodeWavDataUrl(buffer: AudioBuffer): string {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataLen = numFrames * blockAlign;
  const totalLen = 44 + dataLen;
  const bytes = new Uint8Array(totalLen);
  const view = new DataView(bytes.buffer);
  let p = 0;
  const wstr = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  wstr('RIFF'); view.setUint32(p, totalLen - 8, true); p += 4;
  wstr('WAVE');
  wstr('fmt '); view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2;            // PCM
  view.setUint16(p, numCh, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, byteRate, true); p += 4;
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, bytesPerSample * 8, true); p += 2;
  wstr('data'); view.setUint32(p, dataLen, true); p += 4;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  // Convert to base64 — chunked to avoid call-stack overflow on large stems
  let binary = '';
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return `data:audio/wav;base64,${typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64')}`;
}

export function PublishAsAdaptiveMusicDialog({
  projectId, projectTitle, manifest, referenceBuffer, onClose,
}: PublishAsAdaptiveMusicDialogProps) {
  const [region, setRegion] = useState<Region>('tavern');
  const [intensity, setIntensity] = useState<Intensity>('ambient');
  const [moodTagsRaw, setMoodTagsRaw] = useState('');
  const [title, setTitle] = useState(projectTitle || 'Adaptive music');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  useEffect(() => {
    if (referenceBuffer) setDurationMs(Math.round(referenceBuffer.duration * 1000));
    else setDurationMs(0);
  }, [referenceBuffer]);

  const submit = useCallback(async () => {
    if (!projectId || !referenceBuffer) return;
    setError(null); setSubmitting(true);
    try {
      const dataUrl = encodeWavDataUrl(referenceBuffer);
      const moodTags = moodTagsRaw
        .split(',')
        .map((m) => m.trim().toLowerCase())
        .filter((m) => m.length > 0)
        .slice(0, 6);
      const r = await lensRun('studio', 'publish-as-adaptive-music', {
        projectId,
        soundscapeRegion: region,
        intensity,
        referenceStemDataUrl: dataUrl,
        manifest,
        durationMs,
        title,
        moodTags,
      });
      if (r.data?.ok === false) {
        setError(r.data.error || 'publish failed');
      } else {
        setResult(r.data?.result as PublishResult);
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSubmitting(false);
    }
  }, [projectId, referenceBuffer, region, intensity, moodTagsRaw, manifest, durationMs, title]);

  return (
    <div
      role="dialog"
      aria-label="Publish project as adaptive music"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-xl p-5 text-zinc-200">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            Publish as adaptive music
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xs">close</button>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] leading-tight text-zinc-500">
            Your bounced project rides into Concordia as a region-aware
            adaptive-music DTU. AdaptiveMusicBridge crossfades it in over
            the procedural floor when players enter the matching region.
          </p>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Region</span>
            <div className="grid grid-cols-5 gap-1">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegion(r)}
                  className={
                    'rounded px-2 py-1.5 text-xs border ' +
                    (region === r
                      ? 'bg-violet-600/30 border-violet-400 text-violet-100'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700')
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Intensity</span>
            <div className="grid grid-cols-3 gap-1">
              {INTENSITIES.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIntensity(i)}
                  className={
                    'rounded px-2 py-1.5 text-xs border ' +
                    (intensity === i
                      ? 'bg-violet-600/30 border-violet-400 text-violet-100'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700')
                  }
                >
                  {i}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Mood tags (comma-separated, optional)</span>
            <input
              type="text"
              value={moodTagsRaw}
              onChange={(e) => setMoodTagsRaw(e.target.value)}
              maxLength={200}
              placeholder="calm, cozy, foreboding"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <div className="text-[11px] text-zinc-500">
            Reference stem: {referenceBuffer ? `${referenceBuffer.duration.toFixed(1)}s, ${referenceBuffer.numberOfChannels}ch, ${referenceBuffer.sampleRate}Hz` : 'no buffer (bounce first)'}
          </div>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {result && (
            <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/60 rounded px-2 py-1.5 space-y-1">
              <div>Published as DTU <span className="font-mono">{result.dtuId}</span></div>
              <div className="text-zinc-400 font-mono text-[10px]">
                region: {result.region} / intensity: {result.intensity} / {result.durationMs}ms
              </div>
              <div className="text-zinc-400 font-mono text-[10px] break-all">{result.downloadUrl}</div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!referenceBuffer || !projectId || submitting}
              className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
