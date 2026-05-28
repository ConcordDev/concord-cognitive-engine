'use client';

// Phase G4.2 — Bare HUD mount route.
//
// /hud/<name> renders one Phase F/G HUD component with no nav, no
// chrome. Mobile WebView wrappers (concord-mobile/src/surface/screens/
// <Hud>Screen.tsx) iframe this URL. JWT is injected client-side via
// window.__CONCORD_JWT__ by AuthedWebView before content loads.

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

// All target HUD components are client-only dynamic imports.
const DreamReader = dynamic(() => import('@/components/world/DreamReader').then((m) => ({ default: m.DreamReader })), { ssr: false });
const StrategicWarBanner = dynamic(() => import('@/components/world/StrategicWarBanner').then((m) => ({ default: m.StrategicWarBanner })), { ssr: false });
const ForwardPredictionsPanel = dynamic(() => import('@/components/world/ForwardPredictionsPanel').then((m) => ({ default: m.ForwardPredictionsPanel })), { ssr: false });
const NPCSchemeOverhearTip = dynamic(() => import('@/components/world/NPCSchemeOverhearTip').then((m) => ({ default: m.NPCSchemeOverhearTip })), { ssr: false });
const LFGBoardPanel = dynamic(() => import('@/components/world/LFGBoardPanel').then((m) => ({ default: m.LFGBoardPanel })), { ssr: false });
const BrawlMatchmakingQueue = dynamic(() => import('@/components/world/BrawlMatchmakingQueue').then((m) => ({ default: m.BrawlMatchmakingQueue })), { ssr: false });
const SpectatorOverlay = dynamic(() => import('@/components/world/SpectatorOverlay').then((m) => ({ default: m.SpectatorOverlay })), { ssr: false });
const EmergentEventFeed = dynamic(() => import('@/components/world/EmergentEventFeed').then((m) => ({ default: m.EmergentEventFeed })), { ssr: false });
const PersonalBeatWidget = dynamic(() => import('@/components/world/PersonalBeatWidget').then((m) => ({ default: m.PersonalBeatWidget })), { ssr: false });

const HUD_MAP: Record<string, React.ComponentType> = {
  'dream-reader': DreamReader,
  'war-banner': StrategicWarBanner,
  'forward-predictions': ForwardPredictionsPanel,
  'scheme-overhear': NPCSchemeOverhearTip,
  'lfg-board': LFGBoardPanel,
  'brawl-queue': BrawlMatchmakingQueue,
  'spectator': SpectatorOverlay,
  'event-feed': EmergentEventFeed,
  'personal-beat': PersonalBeatWidget,
};

export default function HudMountPage() {
  const params = useParams<{ name: string }>();
  const name = params?.name;

  useEffect(() => {
    // Force-trigger the LFGBoardPanel / BrawlMatchmakingQueue open
    // events on mount, since the dedicated HUD page is the surface.
    if (name === 'lfg-board') {
      window.dispatchEvent(new CustomEvent('concordia:open-lfg-board'));
    } else if (name === 'brawl-queue') {
      window.dispatchEvent(new CustomEvent('concordia:open-brawl-queue'));
    }
  }, [name]);

  const Comp = HUD_MAP[name];
  if (!Comp) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Unknown HUD: <code className="ml-2">{name}</code>
      </div>
    );
  }
  return (
    <main className="min-h-screen bg-zinc-950">
      <Comp />
    </main>
  );
}
