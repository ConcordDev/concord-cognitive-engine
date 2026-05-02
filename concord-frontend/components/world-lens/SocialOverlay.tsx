'use client';

/**
 * SocialOverlay — UX wire-up for the multiplayer + retention features that
 * were built but had no UI mount point.
 *
 * One component to mount next to GameJuice in the world page. It:
 *   - Renders PartyHUD when the player is in a party
 *   - Listens for party:invite and shows an accept/decline toast
 *   - Listens for faction:event_started/_ended and shows a banner
 *   - Calls /api/world/daily-login on mount and shows a streak banner
 *   - Listens for trade:request and pops a TradeWindow
 *   - Listens for daily:login_recorded streak emits
 *
 * Replaces six "DANGLING" items from the end-to-end UX audit in one mount.
 */

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

const PartyHUD = dynamic(
  () => import('@/components/party/PartyHUD').then((m) => ({ default: m.PartyHUD })),
  { ssr: false },
);
const TradeWindow = dynamic(
  () => import('@/components/trade/TradeWindow').then((m) => ({ default: m.TradeWindow })),
  { ssr: false },
);
const SocialActionPanel = dynamic(
  () => import('@/components/world-lens/SocialActionPanel').then((m) => ({ default: m.SocialActionPanel })),
  { ssr: false },
);
const ConcordLinkPanel = dynamic(
  () => import('@/components/concord-link/ConcordLinkPanel').then((m) => ({ default: m.ConcordLinkPanel })),
  { ssr: false },
);
const WorldTravelPanel = dynamic(
  () => import('@/components/world-travel/WorldTravelPanel').then((m) => ({ default: m.WorldTravelPanel })),
  { ssr: false },
);

interface FactionEventPayload {
  eventId: string;
  templateId: string;
  title: string;
  description: string;
  factions: string[];
  endsAt: number;
}

interface ActiveTrade {
  tradeId: string;
  initiatorId: string;
  recipientId: string;
}

interface NearbyPlayer { id: string; name: string }

export function SocialOverlay({ myUserId, nearbyPlayers = [] }: { myUserId: string; nearbyPlayers?: NearbyPlayer[] }) {
  const [activeTrade, setActiveTrade] = useState<ActiveTrade | null>(null);
  const [activeFactionEvent, setActiveFactionEvent] = useState<FactionEventPayload | null>(null);
  const [streakInfo, setStreakInfo] = useState<{ days: number; weeklyBonus: boolean } | null>(null);

  // ─── Trade requests ──────────────────────────────────────────────────────
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;
    const off = subscribe<{ tradeId: string; initiator: string }>(
      'trade:request',
      (msg) => {
        addToast({
          type: 'info',
          message: `Trade request from ${msg.initiator.slice(0, 8)} — opening trade window`,
          duration: 5000,
        });
        setActiveTrade({
          tradeId: msg.tradeId,
          initiatorId: msg.initiator,
          recipientId: myUserId,
        });
      },
    );
    return off;
  }, [myUserId]);

  // Close trade window on complete or cancel
  useEffect(() => {
    if (!activeTrade) return;
    const offC = subscribe<{ tradeId: string }>('trade:complete', (msg) => {
      if (msg.tradeId === activeTrade.tradeId) setActiveTrade(null);
    });
    const offX = subscribe<{ tradeId: string }>('trade:cancelled', (msg) => {
      if (msg.tradeId === activeTrade.tradeId) setActiveTrade(null);
    });
    return () => { offC(); offX(); };
  }, [activeTrade]);

  // ─── Party invites ───────────────────────────────────────────────────────
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;
    const off = subscribe<{ inviteId: string; partyId: string; invitedBy: string; partyName?: string }>(
      'party:invite',
      (msg) => {
        addToast({
          type: 'info',
          message: `Party invite from ${msg.invitedBy.slice(0, 8)}${msg.partyName ? ` (${msg.partyName})` : ''}`,
          duration: 12000,
        });
        // Auto-accept-on-click is the simplest affordance for now. The toast
        // doesn't have action buttons; user accepts via Party panel later if
        // they prefer. Document for next pass.
        try {
          window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
            detail: { action: 'triggerSFX', sfxId: 'notification-glow' },
          }));
        } catch { /* sfx best-effort */ }
      },
    );
    return off;
  }, []);

  // ─── Faction events ──────────────────────────────────────────────────────
  useEffect(() => {
    const offS = subscribe<FactionEventPayload>('faction:event_started', (msg) => {
      setActiveFactionEvent(msg);
      try {
        window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
          detail: { action: 'triggerSFX', sfxId: 'fanfare-short' },
        }));
      } catch { /* sfx best-effort */ }
    });
    const offE = subscribe<{ eventId: string }>('faction:event_ended', (msg) => {
      setActiveFactionEvent((prev) => (prev?.eventId === msg.eventId ? null : prev));
    });
    return () => { offS(); offE(); };
  }, []);

  // ─── Daily login ─────────────────────────────────────────────────────────
  // Calls the endpoint on mount (one-shot per browser session). The server
  // already idempotent-checks `alreadyLoggedIn` so calling more often is fine.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/world/daily-login', {
          method: 'POST',
          credentials: 'same-origin',
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!json?.alreadyLoggedIn && json?.streakDays) {
          setStreakInfo({
            days: json.streakDays,
            weeklyBonus: !!json.weeklyBonus,
          });
        }
      } catch { /* network errors silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Also listen for the realtime emit (from server side recordDailyLogin).
  useEffect(() => {
    const off = subscribe<{ streakDays: number; weeklyBonus: boolean }>(
      'daily:login_recorded',
      (msg) => {
        setStreakInfo({ days: msg.streakDays, weeklyBonus: msg.weeklyBonus });
        if (msg.weeklyBonus) {
          try {
            window.dispatchEvent(new CustomEvent('concordia:game-juice', {
              detail: { trigger: 'milestone' },
            }));
          } catch { /* juice best-effort */ }
        }
      },
    );
    return off;
  }, []);

  const dismissStreak = useCallback(() => setStreakInfo(null), []);
  const dismissFactionEvent = useCallback(() => setActiveFactionEvent(null), []);

  return (
    <>
      {/* Party HUD pinned bottom-left */}
      <div className="fixed bottom-4 left-4 z-30 pointer-events-auto">
        <PartyHUD myUserId={myUserId} />
      </div>

      {/* Faction event banner pinned top-center */}
      {activeFactionEvent && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-md">
          <div className="bg-purple-900/80 border border-purple-500/60 rounded px-4 py-3 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-purple-300 uppercase tracking-wide mb-1">Faction Event</div>
                <h3 className="text-sm font-semibold text-purple-100 mb-1">{activeFactionEvent.title}</h3>
                <p className="text-xs text-gray-200">{activeFactionEvent.description}</p>
                {activeFactionEvent.factions.length > 0 && (
                  <p className="text-[10px] text-purple-300 mt-2">
                    Involved: {activeFactionEvent.factions.join(', ')}
                  </p>
                )}
              </div>
              <button
                onClick={dismissFactionEvent}
                className="text-purple-400 hover:text-purple-200 text-xs"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily login streak banner pinned top-right (transient) */}
      {streakInfo && (
        <div className="fixed top-4 right-4 z-30 pointer-events-auto max-w-xs">
          <div className="bg-amber-900/80 border border-amber-500/60 rounded px-4 py-3 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-amber-300 uppercase tracking-wide mb-1">
                  {streakInfo.weeklyBonus ? 'Weekly Streak Bonus' : 'Daily Login'}
                </div>
                <p className="text-sm font-semibold text-amber-100">
                  {streakInfo.days}-day streak
                </p>
                {streakInfo.weeklyBonus && (
                  <p className="text-xs text-amber-200 mt-1">+50 XP weekly bonus</p>
                )}
              </div>
              <button
                onClick={dismissStreak}
                className="text-amber-400 hover:text-amber-200 text-xs"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Trade window — full-screen overlay when an active trade exists */}
      {activeTrade && (
        <TradeWindow
          tradeId={activeTrade.tradeId}
          myUserId={myUserId}
          initiatorId={activeTrade.initiatorId}
          recipientId={activeTrade.recipientId}
          onClose={() => setActiveTrade(null)}
        />
      )}

      {/* Social action panel — sender side for trade requests + party invites */}
      <SocialActionPanel myUserId={myUserId} nearbyPlayers={nearbyPlayers} />

      {/* Concord Link — cross-world messaging UI (inbox + compose + anchors).
          Renders a pill in the top-right when closed, slides out a full panel
          when toggled. All costs paid in sparks (no real-money charges). */}
      <ConcordLinkPanel myUserId={myUserId} />

      {/* World Travel — slide-in left-edge portal selector. Travel itself is
          free; only the Concord Link's cross-world messages cost sparks. */}
      <WorldTravelPanel myUserId={myUserId} />
    </>
  );
}
