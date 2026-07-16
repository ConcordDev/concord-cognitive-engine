// Wave 4 gap-closure — shared config-gating hook for the Foundry Phase-7
// runtime HUDs (Status Window, Size Scaling, per-player Skill Affinity,
// Isekai Reincarnation) mounted in the world lens.
//
// server/lib/foundry/system-registry.js#SYSTEM_REGISTRY is the catalog a
// Foundry worldspec selects systems from; server/lib/foundry/compiler.js
// #compileWorldspec writes the exact list of selected (non-stub) system ids
// onto the published `worlds` row as `rule_modulators.foundry.systems`, and
// — for the three `rule_modulator`-activated Phase-7 systems (size-scaling,
// status-window, isekai-reincarnation) — also writes each system's own
// config under `rule_modulators[<activation.key>]`. That's the exact
// signal server/domains/foundry-systems.js's `worldSystemConfig()` reads
// per-macro-call. This hook reads the SAME published data so a HUD only
// ever renders for a world whose worldspec genuinely selected the system —
// never a fabricated control for a world that opted out.
//
// `skill-affinity-player` is `activation: { kind: 'always_on' }` (a
// player-scoped system with nothing to write per-world — see compiler.js's
// `case "always_on": break`), so its own rule_modulators key never exists.
// Its selection is still recorded in `rule_modulators.foundry.systems`
// (compiler.js pushes every non-stub id there regardless of activation
// kind), which is why `foundry.systems` — not "does the per-system key
// exist" — is the one gate this hook applies uniformly across all four
// systems.
//
// GET /api/worlds/:id (server/routes/worlds.js, unauthenticated,
// unmodified by this pass) already returns the live `rule_modulators`
// object via `loadWorld()` — no backend change was needed to read this.

import { useEffect, useState } from 'react';

export type FoundrySystemId =
  | 'status-window'
  | 'size-scaling'
  | 'skill-affinity-player'
  | 'isekai-reincarnation';

// Mirrors each system's `activation.key` in server/lib/foundry/system-registry.js.
// null = always_on (no per-world rule_modulators key to read).
const RULE_MODULATOR_KEY: Record<FoundrySystemId, string | null> = {
  'status-window': 'status_window',
  'size-scaling': 'size_scaling',
  'skill-affinity-player': null,
  'isekai-reincarnation': 'reincarnation',
};

export interface FoundrySystemGate {
  /** True once the world doc fetch has settled (success or failure). */
  loaded: boolean;
  /** True only when this world's published worldspec activated the system. */
  enabled: boolean;
  /** The system's own rule_modulators[<key>] config, when one exists. */
  config: Record<string, unknown>;
}

const IDLE_GATE: FoundrySystemGate = { loaded: false, enabled: false, config: {} };

export function useFoundrySystemGate(
  worldId: string | undefined | null,
  systemId: FoundrySystemId,
): FoundrySystemGate {
  const [gate, setGate] = useState<FoundrySystemGate>(IDLE_GATE);

  useEffect(() => {
    if (!worldId) {
      setGate({ loaded: true, enabled: false, config: {} });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/worlds/${encodeURIComponent(worldId)}`, { credentials: 'include' });
        if (!r.ok) {
          if (!cancelled) setGate({ loaded: true, enabled: false, config: {} });
          return;
        }
        const j = await r.json();
        const ruleModulators = j?.world?.rule_modulators as Record<string, unknown> | undefined;
        const foundry = ruleModulators?.foundry as { systems?: unknown } | undefined;
        const activated = Array.isArray(foundry?.systems) ? (foundry!.systems as unknown[]) : [];
        const enabled = activated.includes(systemId);
        const key = RULE_MODULATOR_KEY[systemId];
        const rawConfig = key ? ruleModulators?.[key] : undefined;
        const config = rawConfig && typeof rawConfig === 'object' ? (rawConfig as Record<string, unknown>) : {};
        if (!cancelled) setGate({ loaded: true, enabled, config });
      } catch {
        if (!cancelled) setGate({ loaded: true, enabled: false, config: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [worldId, systemId]);

  return gate;
}
