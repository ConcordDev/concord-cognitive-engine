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

    // Quest completion → fanfare + toast.
    const offQuestComplete = subscribe<{ questId: string; title: string }>(
      'quest:completed',
      (msg) => {
        addToast({ type: 'success', message: `Quest complete: ${msg.title ?? msg.questId}`, duration: 6000 });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'fanfare', opts: { value: msg.title ?? msg.questId } },
          }));
        } catch { /* ok */ }
      },
    );

    // Marketplace purchase → coin clink + toast (buyer only — server emits
    // the event scoped to the buyer's user room).
    const offPurchase = subscribe<{ listingId: string; title: string; price: number }>(
      'marketplace:purchase',
      (msg) => {
        addToast({ type: 'info', message: `Acquired: ${msg.title} for ${msg.price} CC`, duration: 5000 });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'coin-clink', opts: { value: msg.title } },
          }));
        } catch { /* ok */ }
      },
    );

    // Marketplace sale → seller side: fanfare + earnings toast.
    const offSale = subscribe<{ listingId: string; title: string; earnings: number }>(
      'marketplace:sale',
      (msg) => {
        addToast({ type: 'success', message: `Sold: ${msg.title} (+${msg.earnings} CC)`, duration: 6000 });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'fanfare', opts: { value: `+${msg.earnings} CC` } },
          }));
        } catch { /* ok */ }
      },
    );

    // Skill XP awarded → small chime, no toast (frequent).
    const offSkillXp = subscribe<{ dtuId: string; xp: number; leveledUp: boolean }>(
      'skill:xp-awarded',
      (msg) => {
        if (msg.leveledUp) {
          addToast({ type: 'success', message: 'Skill leveled up!', duration: 5000 });
        }
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: msg.leveledUp ? 'milestone' : 'snap-click' },
          }));
        } catch { /* ok */ }
      },
    );

    // Coop raid completion → world fanfare for all party members.
    const offRaid = subscribe<{ raidId: string; target: string }>(
      'coop:raid:completed',
      (msg) => {
        addToast({ type: 'success', message: `Raid complete: ${msg.target}`, duration: 8000 });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'fanfare', opts: { value: msg.target } },
          }));
        } catch { /* ok */ }
      },
    );

    // Citation chain quest materialized — small notification.
    const offLineageQuest = subscribe<{ questId: string; depth: number }>(
      'quest:lineage-quest',
      (msg) => {
        addToast({ type: 'info', message: `New lineage quest available (depth ${msg.depth})`, duration: 5000 });
      },
    );

    // Reputation badge earned — fanfare + toast.
    const offBadge = subscribe<{ key: string; label: string; tier: string; category: string }>(
      'reputation:badge-earned',
      (msg) => {
        addToast({
          type: 'success',
          message: `Badge earned — ${msg.label} (${msg.tier})`,
          duration: 8000,
        });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'fanfare', opts: { value: msg.label } },
          }));
        } catch { /* ok */ }
      },
    );

    // EvoAsset evolution promoted — "manifested fused power" notification.
    // Fired from server/lib/evo-asset/scheduler.js after a refinement pass
    // verifies through the Atlas 5-stage gate and the version row gets
    // promoted (asset's quality_level bumps).
    const offEvoAsset = subscribe<{
      assetId: string;
      versionId: string;
      passKind: string;
      diffSummary?: string | null;
    }>(
      'evo:asset-promoted',
      (msg) => {
        addToast({
          type: 'success',
          message: `Manifested fused power: ${msg.passKind}`,
          duration: 6000,
        });
        try {
          window.dispatchEvent(new CustomEvent('concordia:game-juice', {
            detail: { trigger: 'fanfare', opts: { value: msg.passKind } },
          }));
        } catch { /* ok */ }
      },
    );

    return () => {
      offLevelUp();
      offQualityApproved();
      offQuestComplete();
      offPurchase();
      offSale();
      offSkillXp();
      offRaid();
      offLineageQuest();
      offBadge();
      offEvoAsset();
    };
  }, []);

  return null;
}
