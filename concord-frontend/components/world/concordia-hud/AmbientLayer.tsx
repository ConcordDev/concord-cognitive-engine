'use client';

/**
 * AmbientLayer — Layer 1 of the dynamic HUD.
 *
 * Minimal corner badges that fade in when a signal warrants and fade
 * out when at rest. Anchored to corners; no central screen real-estate
 * consumed unless something is happening.
 *
 * Mode-aware via useHUDContext.inputMode:
 *   - exploration: full set
 *   - combat:     health + stamina + targets only
 *   - dialogue:   bloodline + opinion only (not rendered here; DialoguePanel handles)
 *   - vehicle:    speed + fare only
 *   - photo:      hide all
 */

import { useHUDContext } from './HUDContextProvider';
import { StaminaWheel } from '@/components/concordia/StaminaWheel';
import { useHudSettings } from '@/lib/concordia/hud-settings';

export function AmbientLayer() {
  const mode = useHUDContext((s) => s.inputMode);
  const expertise = useHUDContext((s) => s.expertiseLevel);
  // HUD settings gate each ambient signal — this is the real consumer of the
  // HUDSettingsPanel toggles (concordia:hud-settings-changed). A toggled-off
  // signal is suppressed here even when its underlying condition fires.
  const settings = useHudSettings();

  if (mode === 'photo') return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-20"
      data-testid="hud-ambient-layer"
      aria-hidden="false"
    >
      {/* Top-left — calendar / month + festival */}
      {settings.ambient_calendar && mode !== 'combat' && mode !== 'dialogue' && <CalendarBadge />}

      {/* Top-right — refusal field warning + realm border. We already
          returned early on photo mode above. */}
      {settings.ambient_refusal && <RefusalBadge />}
      <RealmExileTint />

      {/* Bottom-left — stamina wheel (reused) + active substrate badges */}
      <div className="absolute left-3 bottom-3 flex flex-col items-start gap-2 pointer-events-auto">
        <StaminaSlot />
        {settings.ambient_schemes && mode === 'exploration' && expertise !== 'newcomer' && <ActiveSchemeBadge />}
        {settings.ambient_crafts && mode === 'exploration' && expertise !== 'newcomer' && <ActiveCraftBadge />}
        <PendingHeirBadge />
      </div>

      {/* Bottom-right — health bar (only when damaged) + oxygen (only when diving) + pain */}
      <div className="absolute right-3 bottom-3 flex flex-col items-end gap-2">
        {settings.ambient_health && <HealthBar />}
        {settings.ambient_oxygen && <OxygenBadge />}
        {settings.ambient_pain && mode !== 'combat' && expertise !== 'newcomer' && <PainBadge />}
      </div>
    </div>
  );
}

function CalendarBadge() {
  const monthName = useHUDContext((s) => s.tunyanMonthName);
  const civic = useHUDContext((s) => s.civicBlockLabel);
  const festival = useHUDContext((s) => s.festivalActive);
  return (
    <div className="absolute left-3 top-3 inline-flex items-center gap-2 text-xs text-zinc-400/80 bg-zinc-950/40 backdrop-blur-sm rounded px-2 py-1" data-testid="hud-calendar-badge">
      <span className="font-medium text-amber-300/80">{monthName}</span>
      <span className="text-zinc-400">·</span>
      <span className="font-mono">{civic}</span>
      {festival && (
        <span className="ml-1 text-amber-200 animate-pulse" aria-label={`Festival: ${festival}`}>✦ {festival}</span>
      )}
    </div>
  );
}

function RefusalBadge() {
  const strength = useHUDContext((s) => s.refusalCompoundStrength);
  if (strength < 6) return null;
  return (
    <div className="absolute right-3 top-3 inline-flex items-center gap-1 text-xs text-cyan-200 bg-cyan-950/60 border border-cyan-700/40 rounded px-2 py-1 backdrop-blur-sm" data-testid="hud-refusal-badge" role="status" aria-live="polite">
      <span aria-hidden="true">❄</span>
      <span>Refusal · {strength}/9</span>
    </div>
  );
}

function RealmExileTint() {
  const exiled = useHUDContext((s) => s.exiledFromCurrentRealm);
  if (!exiled) return null;
  return (
    <div className="absolute inset-0 pointer-events-none ring-4 ring-inset ring-red-800/40" data-testid="hud-realm-exile-tint" aria-label="Exiled from current realm" />
  );
}

function StaminaSlot() {
  const state = useHUDContext((s) => s.staminaState);
  const value = useHUDContext((s) => s.staminaValue);
  const max = useHUDContext((s) => s.staminaMax);
  return <StaminaWheel value={value} max={max} state={state} />;
}

function HealthBar() {
  const pct = useHUDContext((s) => s.healthPct);
  if (pct >= 80) return null;
  const w = Math.max(4, Math.min(100, pct));
  return (
    <div className="w-32 h-2 bg-zinc-950/70 border border-zinc-700/50 rounded-full overflow-hidden" data-testid="hud-health-bar" role="meter" aria-label={`Health ${Math.round(pct)} percent`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-red-500/80 transition-all duration-300" style={{ width: `${w}%` }} />
    </div>
  );
}

function OxygenBadge() {
  const depth = useHUDContext((s) => s.depthM);
  const pct = useHUDContext((s) => s.oxygenPct);
  if (depth <= 4) return null;
  const tone = pct < 30 ? 'text-red-400' : pct < 60 ? 'text-amber-300' : 'text-cyan-300';
  return (
    <div className={`inline-flex items-center gap-1 text-xs ${tone} bg-zinc-950/70 border border-zinc-700/50 rounded px-2 py-0.5 backdrop-blur-sm`} data-testid="hud-oxygen-badge" role="status" aria-live="polite">
      <span aria-hidden="true">≈</span>
      <span>{Math.round(pct)}% · {Math.round(depth)}m</span>
    </div>
  );
}

function PainBadge() {
  const pain = useHUDContext((s) => s.painBudget);
  if (pain <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1 text-[10px] text-red-300/80 bg-red-950/40 border border-red-900/50 rounded px-1.5 py-0.5" data-testid="hud-pain-badge" role="status">
      <span aria-hidden="true">×</span>
      <span>pain · {pain}</span>
    </div>
  );
}

function ActiveSchemeBadge() {
  const schemes = useHUDContext((s) => s.activeSchemes);
  if (!schemes || schemes.length === 0) return null;
  const first = schemes[0];
  return (
    <div className="inline-flex items-center gap-1 text-[10px] text-amber-200 bg-amber-950/50 border border-amber-800/50 rounded px-1.5 py-0.5" data-testid="hud-scheme-badge">
      <span aria-hidden="true">⚐</span>
      <span>{first.kind} · {first.phase}</span>
      {schemes.length > 1 && <span className="text-amber-300/60">+{schemes.length - 1}</span>}
    </div>
  );
}

function ActiveCraftBadge() {
  const jobs = useHUDContext((s) => s.activeCraftJobs);
  if (!jobs || jobs.length === 0) return null;
  const first = jobs[0];
  return (
    <div className="inline-flex items-center gap-1 text-[10px] text-emerald-200 bg-emerald-950/40 border border-emerald-800/40 rounded px-1.5 py-0.5" data-testid="hud-craft-badge">
      <span aria-hidden="true">⚒</span>
      <span>{first.chain_id} · step {first.current_step}</span>
      {jobs.length > 1 && <span className="text-emerald-300/60">+{jobs.length - 1}</span>}
    </div>
  );
}

function PendingHeirBadge() {
  const pending = useHUDContext((s) => s.hasPendingHeir);
  if (!pending) return null;
  return (
    <div className="inline-flex items-center gap-1 text-xs text-amber-100 bg-amber-900/60 border border-amber-700/60 rounded px-2 py-1 animate-pulse" data-testid="hud-pending-heir-badge" role="alert">
      <span aria-hidden="true">⚱</span>
      <span>Heir awaits acceptance</span>
    </div>
  );
}
