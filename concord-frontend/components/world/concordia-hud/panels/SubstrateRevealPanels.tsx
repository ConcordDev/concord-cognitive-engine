'use client';

/**
 * Phase G — substrate-reveal + composer panel wrappers.
 *
 * Each wrapper adapts an orphaned component into the PanelHost
 * `{ label, Component }` contract (no props; uses macros + state).
 *
 * One file per panel would bloat the tree. This bundle exports all
 * 19 thin wrappers so PanelHost can import them as a batch.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// ── Dynamic imports for orphan components ──────────────────────
const SchemeBoardImpl = dynamic(() => import('@/components/concordia/hud/SchemeBoard'), { ssr: false });
const SecretsCodexImpl = dynamic(() => import('@/components/concordia/hud/SecretsCodex'), { ssr: false });
const AtrophyWarningImpl = dynamic(() => import('@/components/concordia/hud/AtrophyWarning').then((m) => ({ default: m.AtrophyWarning })), { ssr: false });
const MountDesignerImpl = dynamic(() => import('@/components/concordia/mounts/MountDesigner').then((m) => ({ default: m.MountDesigner })), { ssr: false });
const NPCShopModalImpl = dynamic(() => import('@/components/concordia/economy/NPCShopModal').then((m) => ({ default: m.NPCShopModal })), { ssr: false });
const WagerModalImpl = dynamic(() => import('@/components/concordia/economy/WagerModal').then((m) => ({ default: m.WagerModal })), { ssr: false });
const TransitHubImpl = dynamic(() => import('@/components/concordia/transit/TransitHub'), { ssr: false });
const QuestComposerImpl = dynamic(() => import('@/components/concordia/quests/QuestComposer'), { ssr: false });
const NPCComposerImpl = dynamic(() => import('@/components/concordia/npcs/NPCComposer'), { ssr: false });
const GoddessArcComposerImpl = dynamic(() => import('@/components/concordia/arcs/GoddessArcComposer'), { ssr: false });
const CommuneComposerImpl = dynamic(() => import('@/components/concordia/commune/CommuneComposer'), { ssr: false });
const PatternFeedImpl = dynamic(() => import('@/components/concordia/genesis/PatternFeed'), { ssr: false });
const SkillMarketplaceImpl = dynamic(() => import('@/components/concordia/skills/SkillMarketplace'), { ssr: false });
const SkillEffectivenessPanelImpl = dynamic(() => import('@/components/concordia/skills/SkillEffectivenessPanel'), { ssr: false });
const MessagingChannelsPanelImpl = dynamic(() => import('@/components/messaging/MessagingChannelsPanel').then((m) => ({ default: m.MessagingChannelsPanel })), { ssr: false });
const PersonalAgentPanelImpl = dynamic(() => import('@/components/agent/PersonalAgentPanel').then((m) => ({ default: m.PersonalAgentPanel })), { ssr: false });
const FlywheelDashboardImpl = dynamic(() => import('@/components/flywheel/FlywheelDashboard').then((m) => ({ default: m.FlywheelDashboard })), { ssr: false });
const PredictionCardsImpl = dynamic(() => import('@/components/brief/PredictionCards').then((m) => ({ default: m.PredictionCards })), { ssr: false });
const RegionalLeaderboardImpl = dynamic(() => import('@/components/federation/RegionalLeaderboard'), { ssr: false });

// ── Wrappers ───────────────────────────────────────────────────

function useWorldId(): string {
  const [worldId, setWorldId] = useState<string>('concordia-hub');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWorldId(window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub');
  }, []);
  return worldId;
}

function useUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    // Best-effort cookie read; fall back to anonymous.
    try {
      const match = document.cookie.match(/concord_user_id=([^;]+)/);
      if (match) setUserId(decodeURIComponent(match[1]));
    } catch { /* noop */ }
  }, []);
  return userId;
}

export function SchemeBoardPanel() {
  return <SchemeBoardImpl open={true} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function SecretsCodexPanel() {
  return <SecretsCodexImpl open={true} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function AtrophyWarningPanel() {
  const [risk, setRisk] = useState<{ daysUnused: number | null; projectedLoss: number; immune: boolean } | null>(null);
  useEffect(() => {
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'skills', name: 'atrophy_risk', input: {} }),
    }).then((r) => r.json()).then((j) => {
      const r = j?.result;
      if (r && typeof r === 'object') {
        setRisk({
          daysUnused: r.daysUnused ?? null,
          projectedLoss: r.projectedLoss ?? r.risk ?? 0,
          immune: !!r.immune,
        });
      }
    }).catch(() => { /* macro optional */ });
  }, []);
  return (
    <div className="text-sm">
      <p className="text-xs text-zinc-400 mb-3">Skill atrophy risk per the skill substrate.</p>
      <AtrophyWarningImpl risk={risk} />
    </div>
  );
}

export function MountDesignerPanel() {
  return <MountDesignerImpl />;
}

export function NPCShopModalPanel() {
  const [npcId, setNpcId] = useState<string | null>(null);
  useEffect(() => {
    // Surface a small picker — pull last-interacted NPC from a global hint.
    const hint = (globalThis as { __CONCORD_LAST_NPC_ID__?: string }).__CONCORD_LAST_NPC_ID__;
    if (hint) setNpcId(hint);
  }, []);
  if (!npcId) return <p className="text-xs text-zinc-500 italic">Click an NPC then re-open this panel to shop.</p>;
  return <NPCShopModalImpl npcId={npcId} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function WagerModalPanel() {
  const worldId = useWorldId();
  return <WagerModalImpl opponentId="" opponentName="(pick an opponent)" worldId={worldId} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function TransitHubPanel() {
  const worldId = useWorldId();
  return <TransitHubImpl currentWorldId={worldId} onTravelled={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function QuestComposerPanel() {
  return <QuestComposerImpl onAuthored={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function NPCComposerPanel() {
  return <NPCComposerImpl onAuthored={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function GoddessArcComposerPanel() {
  return <GoddessArcComposerImpl onAuthored={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function CommuneComposerPanel() {
  return <CommuneComposerImpl onAuthored={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} onClose={() => window.dispatchEvent(new CustomEvent('concordia:panel-close'))} />;
}

export function PatternFeedPanel() {
  return <PatternFeedImpl />;
}

export function SkillMarketplacePanel() {
  const worldId = useWorldId();
  const userId = useUserId();
  return <SkillMarketplaceImpl currentUserId={userId ?? ''} currentWorldId={worldId} />;
}

export function SkillEffectivenessPanelPanel() {
  const worldId = useWorldId();
  const [skills, setSkills] = useState<unknown[]>([]);
  useEffect(() => {
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'cross_world_effectiveness', name: 'for_player', input: { worldId } }),
    }).then((r) => r.json()).then((j) => {
      const rows = j?.result?.rows;
      if (Array.isArray(rows)) setSkills(rows);
    }).catch(() => { /* optional */ });
  }, [worldId]);
  return <SkillEffectivenessPanelImpl skills={skills as never} currentWorldId={worldId} />;
}

export function MessagingChannelsPanelPanel() {
  return <MessagingChannelsPanelImpl />;
}

export function PersonalAgentPanelPanel() {
  return <PersonalAgentPanelImpl />;
}

export function FlywheelDashboardPanel() {
  return <FlywheelDashboardImpl />;
}

export function PredictionCardsPanel() {
  const [predictions, setPredictions] = useState<Array<{ dtuId: string; lens: string; action: string; title: string }>>([]);
  useEffect(() => {
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'dreams', name: 'predictions', input: { limit: 20 } }),
    }).then((r) => r.json()).then((j) => {
      const list = j?.result?.predictions;
      if (Array.isArray(list)) {
        setPredictions(list.map((p: { id: string; subject_kind: string; subject_id: string; anticipated: string }) => ({
          dtuId: p.id,
          lens: p.subject_kind,
          action: 'view',
          title: p.anticipated,
        })));
      }
    }).catch(() => { /* optional */ });
  }, []);
  return <PredictionCardsImpl predictions={predictions} onDismiss={() => undefined} onView={() => undefined} />;
}

export function RegionalLeaderboardPanel() {
  return <RegionalLeaderboardImpl />;
}
