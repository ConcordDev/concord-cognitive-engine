'use client';

/**
 * CinematicCaptureBootstrap — mount-once activator for the auto-capture
 * pipeline. Calls `startCinematicCapture()` when the world lens mounts
 * and `stopCinematicCapture()` on unmount.
 *
 * Privacy-gated: capture is OFF by default and only starts when the
 * user has explicitly opted in via localStorage flag
 * `concordia:capture-enabled` === '1'. This is set by a settings panel
 * (or the player can toggle it in the captures lens). MediaRecorder
 * + storage of WebM blobs without consent would be a privacy
 * regression, even though the canvas stream is video-only.
 *
 * No JSX surface; pure side-effect component.
 */

import { useEffect } from 'react';
import { startCinematicCapture, stopCinematicCapture } from '@/lib/capture/cinematic-capture';

const OPT_IN_KEY = 'concordia:capture-enabled';

export function CinematicCaptureBootstrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(OPT_IN_KEY) !== '1') {
        // Capture disabled — log once for debug + bail.
        return;
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — fail safe by
      // staying off rather than silently recording.
      return;
    }
    // Wait for the canvas to mount. Three.js canvas typically appears
    // 1-2 frames after the lens mounts; a small delay gives reliable
    // pickup without over-engineering a MutationObserver.
    const t = setTimeout(() => {
      try { startCinematicCapture(); } catch { /* ok */ }
    }, 1500);
    return () => {
      clearTimeout(t);
      try { stopCinematicCapture(); } catch { /* ok */ }
    };
  }, []);
  return null;
}
