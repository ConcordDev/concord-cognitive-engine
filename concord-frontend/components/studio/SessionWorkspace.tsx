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

import { useMemo, useState } from 'react';
import { SessionView } from '@/components/music/SessionView';
import SessionBrowserRail from './SessionBrowserRail';
import SessionInspectorRail from './SessionInspectorRail';
import MixerPeekStrip from './MixerPeekStrip';
import type { DAWTrack, DAWProject } from '@/lib/daw/types';

interface SessionWorkspaceProps {
  project: DAWProject;
  bpm: number;
  selectedTrackId: string | null;
  onSelectTrack: (id: string | null) => void;
  onUpdateTrack: (id: string, patch: Partial<DAWTrack>) => void;
  onTempoChange?: (bpm: number) => void;
  onStopAll?: () => void;
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

  const handleLaunchClip = (clip: { trackId: string; sceneId: string }) => {
    const key = `${clip.trackId}:${clip.sceneId}`;
    setSelectedClipKey(key);
    onSelectTrack(clip.trackId);
    // Ableton-style "queue at next bar". For now, set queued; the
    // audio engine wire-up (lib/daw/engine.ts) will flip to playing
    // on the next bar tick.
    setQueuedClipKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // Simulate "launches on next bar" — flip after a beat duration
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
    // Fire every clip in the scene
    const sceneClipKeys = Object.keys(clips).filter(k => k.endsWith(`:${scene.id}`));
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
