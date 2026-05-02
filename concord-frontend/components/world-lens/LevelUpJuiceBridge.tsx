'use client';

/**
 * Wave 1 deferral 3 — bridge realtime events to GameJuice triggers.
 *
 * Subscribes to `level:up` and `quality:approved` socket events and
 * dispatches `concordia:game-juice` window events so the existing
 * GameJuice provider plays the corresponding fanfare/SFX/visual.
 *
 * No JSX. Mount once near GameJuice in the world page.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

export function LevelUpJuiceBridge() {
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;

    const offLevelUp = subscribe<{ newRank: number; title: string; totalXP: number }>(
      'level:up',
      (msg) => {
        addToast({
          type: 'success',
          message: `Level up! ${msg.title} (rank ${msg.newRank})`,
          duration: 7000,
        });
        try {
          window.dispatchEvent(
            new CustomEvent('concordia:game-juice', { detail: { trigger: 'milestone' } }),
          );
        } catch { /* juice is best-effort */ }
      },
    );

    const offQualityApproved = subscribe<{ dtuId?: string }>(
      'quality:approved',
      () => {
        try {
          window.dispatchEvent(
            new CustomEvent('concordia:game-juice', { detail: { trigger: 'validate-pass' } }),
          );
        } catch { /* juice is best-effort */ }
      },
    );

    return () => {
      offLevelUp();
      offQualityApproved();
    };
  }, []);

  return null;
}
