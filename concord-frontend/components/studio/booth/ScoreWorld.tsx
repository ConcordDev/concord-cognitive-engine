'use client';

/**
 * Score a world: render the real song (or its loop) offline exactly as the
 * export does, and publish it as adaptive music for a Concordia region
 * through studio.publish-as-adaptive-music. The publish dialog encodes a
 * 16-bit WAV, so a stem must fit the server's 20 MB audio cap (~104 s of
 * stereo at 48 kHz); longer songs are asked to set a loop instead of being
 * silently cut.
 */

import { useState } from 'react';
import { Globe2, Loader2 } from 'lucide-react';
import { showToast } from '@/components/common/Toasts';
import type { DAWProject } from '@/lib/daw/types';
import { renderProject, type PcmAudio } from '@/lib/daw/render';
import { PublishAsAdaptiveMusicDialog } from '../PublishAsAdaptiveMusicDialog';
import { isSavedProject } from './boothApi';

const MAX_BYTES = 20 * 1024 * 1024;

/** Bytes of the 16-bit PCM WAV the publish dialog encodes. */
export function wavBytes(frames: number, channels: number): number {
  return 44 + frames * channels * 2;
}

/** What the world receives alongside the stem: the song's real structure, no audio. */
export function songManifest(project: DAWProject): Record<string, unknown> {
  return {
    title: project.title,
    bpm: project.bpm,
    key: project.key,
    scale: project.scale,
    timeSignature: project.timeSignature,
    loop: project.transport.loopEnabled ? { startBeat: project.transport.loopStart, endBeat: project.transport.loopEnd } : null,
    tracks: project.tracks.filter((t) => t.type !== 'master').map((t) => ({
      name: t.name,
      type: t.type,
      instrumentId: t.instrumentId,
      clips: t.clips.length,
      effects: (t.effectChain || []).map((e) => e.type),
    })),
  };
}

function toAudioBuffer(pcm: PcmAudio): AudioBuffer {
  const length = pcm.channels[0]?.length || 0;
  const buffer = new AudioBuffer({ length, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
  pcm.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return buffer;
}

export function ScoreWorld({ project, getAudio }: { project: DAWProject; getAudio: () => Map<string, PcmAudio> }) {
  const [rendering, setRendering] = useState(false);
  const [stem, setStem] = useState<AudioBuffer | null>(null);
  const saved = isSavedProject(project.id);
  const loop = project.transport.loopEnabled && project.transport.loopEnd > project.transport.loopStart;

  const render = async () => {
    setRendering(true);
    try {
      const pcm = await renderProject(project, getAudio(), loop ? { startBeat: project.transport.loopStart, endBeat: project.transport.loopEnd, tailSec: 0 } : {});
      const frames = pcm.channels[0]?.length || 0;
      if (!frames) { showToast('warning', 'The song rendered silent. Put something on the timeline first.'); return; }
      if (wavBytes(frames, pcm.channels.length) > MAX_BYTES) {
        const sec = frames / pcm.sampleRate;
        showToast('warning', `That is ${Math.round(sec)} s of audio, over the 20 MB stem limit (about 104 s). Loop the part the world should hear (L) and try again.`);
        return;
      }
      setStem(toAudioBuffer(pcm));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'The render failed.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <section className="bo-metal rounded-lg border p-2.5" data-testid="booth-score-world">
      <span className="bo-engrave flex items-center gap-1.5 text-sm"><Globe2 className="h-3.5 w-3.5" aria-hidden /> Score a world</span>
      <p className="mb-1.5 mt-0.5 text-[11px] leading-relaxed text-zinc-500">
        Publish {loop ? 'the looped section' : 'the song'} as music for a Concordia region. Players hear it there; every derivative pays you through the royalty cascade.
      </p>
      <button type="button" onClick={() => void render()} disabled={!saved || rendering} className="bo-key flex h-8 w-full items-center justify-center gap-1.5 rounded text-xs disabled:opacity-50" data-testid="booth-score-world-render">
        {rendering && <Loader2 className="h-3 w-3 animate-spin" />} {rendering ? 'Rendering the mix…' : `Render ${loop ? 'loop' : 'song'} for a region`}
      </button>
      {!saved && <p className="mt-1 text-[10px] text-zinc-500">Opens once the song is saved.</p>}
      {stem && (
        <PublishAsAdaptiveMusicDialog
          projectId={project.id}
          projectTitle={project.title}
          manifest={songManifest(project)}
          referenceBuffer={stem}
          onClose={() => setStem(null)}
        />
      )}
    </section>
  );
}
