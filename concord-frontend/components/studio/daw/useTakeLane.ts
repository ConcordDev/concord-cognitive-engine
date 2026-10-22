'use client';

import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { DAWProject } from '@/lib/daw/types';
import type { assetMeta } from '@/lib/daw/project';
import { projectTempoPoints } from '@/lib/daw/tempo-map';
import { cycleCompTake, renderCompMix, swipeTrack } from '@/lib/daw/takes';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { showToast } from '@/components/common/Toasts';
import * as ops from './ops';

type StoreAudio = (name: string, channels: Float32Array[], sampleRate: number) => Promise<{ id: string; meta: ReturnType<typeof assetMeta> }>;

export function useTakeLane(
  projectRef: MutableRefObject<DAWProject>,
  edit: (fn: (p: DAWProject) => DAWProject, key?: string) => void,
  storeAudio: StoreAudio,
) {
  const [audition, setAudition] = useState<{ trackId: string; takeId: string } | null>(null);
  const engine = getStudioEngine();

  const onAudition = useCallback((trackId: string, takeId: string) => {
    setAudition((cur) => {
      const next = cur && cur.trackId === trackId && cur.takeId === takeId ? null : { trackId, takeId };
      engine.setAudition(next);
      return next;
    });
  }, [engine]);

  const onSwipe = useCallback((trackId: string, takeId: string, startBeat: number, endBeat: number) => {
    edit((p) => ops.mapTrack(p, trackId, (t) => {
      const take = (t.takes || []).find((x) => x.id === takeId);
      if (!take) return t;
      const a = Math.max(take.startBeat, Math.min(startBeat, endBeat));
      const b = Math.min(take.startBeat + take.lengthBeats, Math.max(startBeat, endBeat));
      return b > a ? swipeTrack(t, takeId, a, b) : t;
    }));
  }, [edit]);

  const onRename = useCallback((trackId: string, takeId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    edit((p) => ops.mapTrack(p, trackId, (t) => ({
      ...t,
      takes: (t.takes || []).map((tk) => (tk.id === takeId ? { ...tk, name: trimmed } : tk)),
    })));
  }, [edit]);

  const onDelete = useCallback((trackId: string, takeId: string) => {
    setAudition((cur) => {
      if (cur && cur.trackId === trackId && cur.takeId === takeId) {
        engine.setAudition(null);
        return null;
      }
      return cur;
    });
    edit((p) => ops.mapTrack(p, trackId, (t) => ({
      ...t,
      takes: (t.takes || []).filter((tk) => tk.id !== takeId),
      comp: (t.comp || []).filter((r) => r.takeId !== takeId),
    })));
  }, [edit, engine]);

  const onStar = useCallback((trackId: string, takeId: string) => {
    edit((p) => ops.mapTrack(p, trackId, (t) => ({
      ...t,
      takes: (t.takes || []).map((tk) => (tk.id === takeId ? { ...tk, rating: tk.rating === 1 ? undefined : 1 } : tk)),
    })));
  }, [edit]);

  const onCycle = useCallback((trackId: string, beat: number, dir: 1 | -1) => {
    edit((p) => ops.mapTrack(p, trackId, (t) => ({ ...t, comp: cycleCompTake(t.comp || [], t.takes || [], beat, dir) })));
  }, [edit]);

  const onFlatten = useCallback(async (trackId: string) => {
    const project = projectRef.current;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track?.comp?.length) {
      showToast('info', 'Swipe across a take to build a comp first.');
      return;
    }
    const audio = engine.audioMap();
    const buffers = new Map<string, Float32Array[]>();
    for (const take of track.takes || []) {
      const a = audio.get(take.audioBufferId);
      if (a) buffers.set(take.audioBufferId, a.channels);
    }
    const sr = audio.get(track.takes?.[0]?.audioBufferId || '')?.sampleRate || project.sampleRate || 48000;
    const mix = renderCompMix(track.takes || [], track.comp, buffers, sr, projectTempoPoints(project));
    if (!mix || !mix.channels[0]?.length) {
      showToast('warning', 'The comp audio is not loaded, so it was not flattened.');
      return;
    }
    const name = `${track.name} comp`;
    const { id, meta } = await storeAudio(name, mix.channels, sr);
    edit((q) => {
      const withAsset = { ...q, audioAssets: { ...(q.audioAssets || {}), [id]: meta }, sampleRate: q.sampleRate || sr };
      const added = ops.addAudioClip(withAsset, trackId, mix.startBeat, mix.lengthBeats, id, name);
      return ops.mapTrack(added.project, trackId, (t) => ({ ...t, comp: [] }));
    });
    engine.setAudition(null);
    setAudition(null);
    showToast('success', 'Comp flattened to a clip. The takes are still here.');
  }, [edit, engine, projectRef, storeAudio]);

  return { audition, onAudition, onSwipe, onRename, onDelete, onStar, onCycle, onFlatten };
}
