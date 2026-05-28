'use client';

// Phase E3 — Mystery board launcher.
// A thin OverlayProps-compatible component the StationInteractionRouter
// mounts when the player walks up to a `mystery_board` building. It
// fetches the authored scene list, dispatches concordia:open-hidden-object
// with one of them, then closes itself so the HiddenObjectScenePanel
// takes over.

import { useEffect, useRef } from 'react';
import type { OverlayProps } from './StationInteractionRouter';

interface SceneRow { id: string; title: string; }

export function MysteryBoardLauncher({ onClose, building }: OverlayProps) {
  const launched = useRef(false);

  useEffect(() => {
    if (launched.current) return;
    launched.current = true;
    (async () => {
      try {
        // Pick a scene to launch. Pull the first authored scene via the
        // existing GET /api/hidden-object/scenes route, OR fallback to
        // a known scene id from the seeder (`hub_bazaar_morning`).
        let sceneId = 'hub_bazaar_morning';
        try {
          const j = await fetch('/api/hidden-object/scenes', { credentials: 'include' }).then((r) => r.ok ? r.json() : null);
          const list: SceneRow[] = j?.scenes || [];
          if (list.length > 0) {
            // Deterministic per-building pick so the same board always
            // shows the same first scene.
            const idx = Math.abs(hash(building.id)) % list.length;
            sceneId = list[idx].id;
          }
        } catch { /* fallback to default */ }
        window.dispatchEvent(new CustomEvent('concordia:open-hidden-object', { detail: { sceneId } }));
      } finally {
        onClose();
      }
    })();
  }, [onClose, building.id]);

  return null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
