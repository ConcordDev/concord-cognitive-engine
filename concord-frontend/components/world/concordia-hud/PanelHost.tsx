'use client';

/**
 * PanelHost — Layer 5 of the dynamic HUD.
 *
 * Hosts ONE single-purpose modal panel at a time. Listens for
 * `concordia:panel-open` CustomEvent (dispatched by Command Palette
 * Layer 3 + Action Wheel Layer 4 + Context Prompt Layer 2). Esc closes.
 *
 * Each panel is a standalone component under ./panels/. No tab-strip;
 * the player invokes one named panel at a time.
 *
 * Mode-aware: closes automatically on transition to combat / dialogue /
 * vehicle / photo (the underlying mode owns the screen).
 */

import { useEffect, useState } from 'react';
import { useHUDContext } from './HUDContextProvider';
import { BloodlinePanel } from './panels/BloodlinePanel';
import { SchemesPanel } from './panels/SchemesPanel';
import { HooksPanel } from './panels/HooksPanel';
import { JobsPanel } from './panels/JobsPanel';
import { CraftsPanel } from './panels/CraftsPanel';
import { DynastyPanel } from './panels/DynastyPanel';
import { MarriagePanel } from './panels/MarriagePanel';
import { RealmPanel } from './panels/RealmPanel';
import { CouncilPanel } from './panels/CouncilPanel';
import { CalendarPanel } from './panels/CalendarPanel';
import { StaminaPanel } from './panels/StaminaPanel';
import { UnderwaterPanel } from './panels/UnderwaterPanel';
import { HUDSettingsPanel } from './panels/HUDSettingsPanel';
import { DecreePanel } from './panels/DecreePanel';
import { ConcordLinkPanel } from './panels/ConcordLinkPanel';
import { DreamPanel } from './panels/DreamPanel';
import { WarPanel } from './panels/WarPanel';
import { CharacterCustomizerPanel } from './panels/CharacterCustomizerPanel';
import {
  SchemeBoardPanel, SecretsCodexPanel, AtrophyWarningPanel,
  MountDesignerPanel, NPCShopModalPanel, WagerModalPanel, TransitHubPanel,
  QuestComposerPanel, NPCComposerPanel, GoddessArcComposerPanel, CommuneComposerPanel,
  PatternFeedPanel, SkillMarketplacePanel, SkillEffectivenessPanelPanel,
  MessagingChannelsPanelPanel, PersonalAgentPanelPanel, FlywheelDashboardPanel,
  PredictionCardsPanel, RegionalLeaderboardPanel,
} from './panels/SubstrateRevealPanels';

const PANEL_REGISTRY: Record<string, { label: string; Component: React.ComponentType }> = {
  bloodline:    { label: 'Bloodline',  Component: BloodlinePanel },
  schemes:      { label: 'Schemes',    Component: SchemesPanel },
  hooks:        { label: 'Hooks',      Component: HooksPanel },
  jobs:         { label: 'Jobs',       Component: JobsPanel },
  crafts:       { label: 'Crafts',     Component: CraftsPanel },
  dynasty:      { label: 'Dynasty',    Component: DynastyPanel },
  marriage:     { label: 'Marriage',   Component: MarriagePanel },
  realm:        { label: 'Realm',      Component: RealmPanel },
  council:      { label: 'Council',    Component: CouncilPanel },
  calendar:     { label: 'Calendar',   Component: CalendarPanel },
  stamina:      { label: 'Stamina',    Component: StaminaPanel },
  underwater:   { label: 'Underwater', Component: UnderwaterPanel },
  'hud-settings':{ label: 'HUD Settings', Component: HUDSettingsPanel },
  decree:       { label: 'Issue Decree', Component: DecreePanel },
  'concord-link':{ label: 'Concord Link', Component: ConcordLinkPanel },
  dreams:       { label: 'Dreams & Anticipations', Component: DreamPanel },
  war:          { label: 'War Council',  Component: WarPanel },
  'character-customizer': { label: 'Character Customizer', Component: CharacterCustomizerPanel },
  // Phase G — 19 substrate-reveal + composer + utility panels.
  'scheme-board':        { label: 'Schemes Board',       Component: SchemeBoardPanel },
  secrets:               { label: 'Secrets Codex',       Component: SecretsCodexPanel },
  atrophy:               { label: 'Skill Atrophy',       Component: AtrophyWarningPanel },
  mounts:                { label: 'Mount Designer',      Component: MountDesignerPanel },
  'npc-shop':            { label: 'NPC Shop',            Component: NPCShopModalPanel },
  wagers:                { label: 'Wagers',              Component: WagerModalPanel },
  transit:               { label: 'Transit Hub',         Component: TransitHubPanel },
  'quest-composer':      { label: 'Quest Composer',      Component: QuestComposerPanel },
  'npc-composer':        { label: 'NPC Composer',        Component: NPCComposerPanel },
  'goddess-arc-composer':{ label: 'Goddess Arc Composer',Component: GoddessArcComposerPanel },
  'commune-composer':    { label: 'Commune Composer',    Component: CommuneComposerPanel },
  'pattern-feed':        { label: 'Pattern Feed',        Component: PatternFeedPanel },
  'skill-marketplace':   { label: 'Skill Marketplace',   Component: SkillMarketplacePanel },
  'skill-effectiveness': { label: 'Skill Effectiveness', Component: SkillEffectivenessPanelPanel },
  'messaging-channels':  { label: 'Messaging Channels',  Component: MessagingChannelsPanelPanel },
  'personal-agent':      { label: 'Personal Agent',      Component: PersonalAgentPanelPanel },
  flywheel:              { label: 'Flywheel Dashboard',  Component: FlywheelDashboardPanel },
  predictions:           { label: 'Predictions',         Component: PredictionCardsPanel },
  leaderboard:           { label: 'Regional Leaderboard',Component: RegionalLeaderboardPanel },
};

export function PanelHost() {
  const mode = useHUDContext((s) => s.inputMode);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { panelId?: string } | undefined;
      if (detail?.panelId && PANEL_REGISTRY[detail.panelId]) setActiveId(detail.panelId);
    }
    function onClose() { setActiveId(null); }
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);
      if (ev.key === 'Escape' && activeId) { setActiveId(null); return; }
      // Direct hotkeys for top-3 panels.
      if (inField) return;
      const lower = ev.key.toLowerCase();
      if (lower === 'b' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) setActiveId('bloodline');
      else if (lower === 'j' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) setActiveId('jobs');
      else if (lower === 'd' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) setActiveId('dynasty');
    }
    window.addEventListener('concordia:panel-open', onOpen);
    window.addEventListener('concordia:panel-close', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('concordia:panel-open', onOpen);
      window.removeEventListener('concordia:panel-close', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [activeId]);

  // Auto-close on mode transitions that own the screen.
  useEffect(() => {
    if (mode === 'combat' || mode === 'dialogue' || mode === 'vehicle' || mode === 'photo') setActiveId(null);
  }, [mode]);

  if (!activeId) return null;
  const entry = PANEL_REGISTRY[activeId];
  if (!entry) return null;
  const { label, Component } = entry;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      data-testid="hud-panel-host"
      data-panel-id={activeId}
      role="dialog"
      aria-label={label}
      onClick={(e) => { if (e.target === e.currentTarget) setActiveId(null); }}
    >
      <div className="w-[28rem] max-w-[90vw] max-h-[80vh] bg-zinc-950 border border-zinc-700/60 rounded-lg shadow-2xl flex flex-col">
        <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <h2 className="text-sm font-bold text-zinc-100">{label}</h2>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            aria-label="Close panel"
            className="text-xs text-zinc-500 hover:text-zinc-200"
          >✕ Esc</button>
        </header>
        <div className="flex-1 overflow-auto p-3">
          <Component />
        </div>
      </div>
    </div>
  );
}
