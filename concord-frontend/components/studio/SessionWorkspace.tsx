'use client';

// SessionWorkspace — the Ableton-Session-View-as-hero default surface
// for the Studio lens. Composes:
//
//   ┌──────────┬─────────────────────────────────┬──────────┐
//   │ Browser  │       SESSION CLIP GRID          │Inspector│
//   │ (left)   │       (60-65% of viewport)       │ (right)  │
//   │ ~220px   │       Click cell → queue → fire  │ ~280px   │
//   └──────────┴─────────────────────────────────┴──────────┘
//   ┌──────────────────────────────────────────────────────────┐
//   │   Mixer peek strip (32px collapsed / 280px expanded)     │
//   └──────────────────────────────────────────────────────────┘
//
// Wires the lens-level project state (DAWTrack[] / sceneId space /
// active clip slots) into SessionView's track/scene/clip shape, plus
// the surrounding rails. Lifts selectedClip / selectedTrack so the
// Inspector can edit either.
//
// Drag-drop: the Browser rail's drag handle carries
// `application/x-concord-asset` JSON; cells in SessionView receive
// the drop and call onDropAsset(clipKey, payload).

import { useMemo, useState, useEffect } from 'react';
import { SessionView } from '@/components/music/SessionView';
import SessionBrowserRail from './SessionBrowserRail';
import SessionInspectorRail from './SessionInspectorRail';
import MixerPeekStrip from './MixerPeekStrip';
import type { DAWTrack, DAWProject } from '@/lib/daw/types';
import type { TransportEngine, ClipQuantization } from '@/lib/daw/engine';

interface SessionWorkspaceProps {
  project: DAWProject;
  bpm: number;
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrack: (id: string, patch: Partial<DAWTrack>) => void;
  onTempoChange?: (bpm: number) => void;
  onStopAll?: () => void;
  /**
   * Live transport engine. When passed, clip launches are routed
   * through `transport.launchClip(...)` and the engine drives
   * playing/queued state via `clipLaunched` / `clipQueued` events.
   * If omitted, we fall back to the visual setTimeout simulation
   * (covers the read-only preview case).
   */
  transport?: TransportEngine | null;
  /** Quantization for clip launches. Defaults to '1' (next bar) per Ableton. */
  launchQuantization?: ClipQuantization;
}

// Synthesize a flat clip lookup from the project's tracks.
// SessionView expects `${trackId}:${sceneId}` → SessionClip. We use
// scene 0..N from the project's section/marker conventions and roll
// per-track clips into scenes by index.
function buildSessionModel(project: DAWProject) {
  const tracks = (project.tracks || []).map((t, i) => ({
    id: t.id,
    name: t.name || `Track ${i + 1}`,
    color: t.color || undefined,
    muted: !!t.mute,
    soloed: !!t.solo,
    armed: !!t.armed,
  }));
  // 8 scenes default (Ableton's session length); pull from
  // arrangement.sections if present.
  const sectionsList = project.arrangement?.sections || [];
  const sceneCount = Math.max(8, sectionsList.length);
  const scenes = Array.from({ length: sceneCount }).map((_, i) => ({
    id: `scene-${i + 1}`,
    name: sectionsList[i]?.name || `Scene ${i + 1}`,
  }));
  const clips: Record<string, {
    trackId: string;
    sceneId: string;
    /** Real DAWClip.id — needed so the studio-page session dispatcher
     *  can resolve scene-grid launches back to the underlying clip. */
    realClipId: string;
    assetId?: string;
    label?: string;
    hasContent: boolean;
    durationBeats?: number;
    color?: string;
  }> = {};
  for (const t of project.tracks || []) {
    (t.clips || []).slice(0, sceneCount).forEach((c, i) => {
      const sceneId = scenes[i].id;
      clips[`${t.id}:${sceneId}`] = {
        trackId: t.id,
        sceneId,
        realClipId: c.id,
        assetId: c.audioBufferId || c.id,
        label: c.name,
        hasContent: true,
        durationBeats: c.lengthBeats,
        color: c.color,
      };
    });
  }
  return { tracks, scenes, clips };
}

export default function SessionWorkspace({
  project,
  bpm,
  selectedTrackId,
  onSelectTrack,
  onUpdateTrack,
  onTempoChange,
  onStopAll,
  transport,
  launchQuantization = '1',
}: SessionWorkspaceProps) {
  const { tracks, scenes, clips } = useMemo(() => buildSessionModel(project), [project]);

  const [selectedClipKey, setSelectedClipKey] = useState<string | null>(null);
  const [playingClipKey, setPlayingClipKey] = useState<string | undefined>(undefined);
  const [queuedClipKeys, setQueuedClipKeys] = useState<Set<string>>(new Set());
  const [mixerExpanded, setMixerExpanded] = useState(false);

  const selectedClip = selectedClipKey ? clips[selectedClipKey] || null : null;
  const selectedTrack = selectedTrackId
    ? (project.tracks || []).find(t => t.id === selectedTrackId) || null
    : null;

  // Subscribe to engine-driven clip events. The engine flips queued →
  // playing exactly at the next-bar boundary; we mirror that into the
  // local state the grid renders against. The engine emits with the
  // real DAWClip.id; we map back to the scene-grid key so the UI
  // highlights the right cell.
  useEffect(() => {
    if (!transport) return;
    const sceneKeyFor = (trackId: string, realClipId: string): string | null => {
      for (const [k, c] of Object.entries(clips)) {
        if (c.trackId === trackId && c.realClipId === realClipId) return k;
      }
      return null;
    };
    const offLaunched = transport.on('clipLaunched', (data) => {
      const key = sceneKeyFor(String(data.trackId), String(data.clipId));
      if (!key) return;
      setPlayingClipKey(key);
      setQueuedClipKeys(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    });
    const offQueued = transport.on('clipQueued', (data) => {
      const key = sceneKeyFor(String(data.trackId), String(data.clipId));
      if (!key) return;
      setQueuedClipKeys(prev => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    });
    const offAllStopped = transport.on('allClipsStopped', () => {
      setPlayingClipKey(undefined);
      setQueuedClipKeys(new Set());
    });
    return () => { offLaunched(); offQueued(); offAllStopped(); };
  }, [transport, clips]);

  const handleLaunchClip = (clip: { trackId: string; sceneId: string }) => {
    const key = `${clip.trackId}:${clip.sceneId}`;
    setSelectedClipKey(key);
    onSelectTrack(clip.trackId);

    if (transport) {
      // Real audio path — engine handles quantization + state flip.
      // Pass the real DAWClip.id so the dispatcher can resolve it
      // back to track.clips[].midiNotes for audio playback.
      const realClipId = clips[key]?.realClipId || clip.sceneId;
      transport.launchClip(clip.trackId, realClipId, launchQuantization);
      return;
    }

    // Engine-less preview path (read-only / mock). Visual-only.
    setQueuedClipKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    const beatMs = Math.max(50, 60_000 / Math.max(60, bpm));
    setTimeout(() => {
      setPlayingClipKey(key);
      setQueuedClipKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, beatMs);
  };

  const handleLaunchScene = (scene: { id: string }) => {
    const sceneClipKeys = Object.keys(clips).filter(k => k.endsWith(`:${scene.id}`));

    if (transport) {
      for (const key of sceneClipKeys) {
        const c = clips[key];
        if (!c) continue;
        transport.launchClip(c.trackId, c.realClipId, launchQuantization);
      }
      return;
    }

    setQueuedClipKeys(new Set(sceneClipKeys));
    const beatMs = Math.max(50, 60_000 / Math.max(60, bpm));
    setTimeout(() => {
      setQueuedClipKeys(new Set());
      setPlayingClipKey(sceneClipKeys[sceneClipKeys.length - 1]); // last one wins display
    }, beatMs);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 grid grid-cols-[220px_1fr_280px] overflow-hidden">
        <SessionBrowserRail />

        <div className="overflow-auto bg-black/40 p-3">
          <SessionView
            tracks={tracks}
            scenes={scenes}
            clips={clips}
            tempo={bpm}
            onLaunchClip={handleLaunchClip}
            onLaunchScene={handleLaunchScene}
            onStopAll={() => {
              transport?.stopAllClips();
              setPlayingClipKey(undefined);
              setQueuedClipKeys(new Set());
              onStopAll?.();
            }}
            onTempoChange={onTempoChange}
            playingClipKey={playingClipKey}
            queuedClipKeys={queuedClipKeys}
          />
        </div>

        <SessionInspectorRail
          selectedClip={selectedClip}
          selectedTrack={selectedTrack}
          onCloseInspector={() => { setSelectedClipKey(null); onSelectTrack(null); }}
          onUpdateTrack={(patch) => selectedTrackId && onUpdateTrack(selectedTrackId, patch)}
          onDeleteClip={selectedClip ? () => setSelectedClipKey(null) : undefined}
        />
      </div>

      <MixerPeekStrip
        tracks={project.tracks || []}
        selectedTrackId={selectedTrackId}
        onSelectTrack={onSelectTrack}
        onUpdateTrack={onUpdateTrack}
        expanded={mixerExpanded}
        onToggleExpanded={() => setMixerExpanded(v => !v)}
      />
    </div>
  );
}
