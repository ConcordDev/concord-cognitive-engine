'use client';

/**
 * Frontier — the ten backend "frontier engine" macro surfaces
 * (`lib/frontier-engines.ts`) presented as ONE destination. Reference app
 * (per `docs/UI_QUALITY_RUBRIC.md` §0): JUPYTER / JUPYTERLAB, inherited
 * from `components/frontier/FrontierEngineShell.tsx` — see that file's
 * header for the full Compute/Verify/Boundary notebook-cell rationale.
 * This page is deliberately thin: it owns engine SELECTION (which of the
 * ten tabs is active) and PANEL ROUTING (which real component, if any,
 * renders for the active engine); the shell owns the notebook chrome and
 * each panel owns its own compute form.
 *
 * The ten engines share workspace TABS switched by local state
 * (FrontierEngineShell's own `FrontierEngineTabs`), not ten separate
 * lens routes — `lib/destinations.ts`'s own comment on the `frontier`
 * entry explains why it has no `absorbs` list.
 *
 * Wave-1 physics engines (materials degradation, non-Newtonian FSI,
 * safety-envelope compiler) ship real Compute/Verify panels. The other
 * seven render `UnbuiltEnginePanel` — an honest "not built yet" state,
 * never fabricated data — until a real panel lands for them. Flip an
 * entry in `PANEL_BY_ENGINE_ID` below AND `built:true` in
 * `lib/frontier-engines.ts` together, in the same change.
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { FrontierEngineShell } from '@/components/frontier/FrontierEngineShell';
import { FRONTIER_ENGINES, DEFAULT_FRONTIER_ENGINE_ID, type FrontierEngineDef } from '@/lib/frontier-engines';
import MaterialsDegradationPanel from '@/components/frontier/panels/MaterialsDegradationPanel';
import FsiPanel from '@/components/frontier/panels/FsiPanel';
import SafetyEnvelopePanel from '@/components/frontier/panels/SafetyEnvelopePanel';
import QecDecoderPanel from '@/components/frontier/panels/QecDecoderPanel';
import ModelCheckerPanel from '@/components/frontier/panels/ModelCheckerPanel';
import ConsensusPanel from '@/components/frontier/panels/ConsensusPanel';
import MarketEquilibriumPanel from '@/components/frontier/panels/MarketEquilibriumPanel';
import ConstantTimePanel from '@/components/frontier/panels/ConstantTimePanel';
import PaillierPanel from '@/components/frontier/panels/PaillierPanel';
import SpikingNetworkPanel from '@/components/frontier/panels/SpikingNetworkPanel';
import UnbuiltEnginePanel from '@/components/frontier/panels/UnbuiltEnginePanel';

type EnginePanel = ComponentType<{ engine: FrontierEngineDef }>;

// The single place a new engine panel gets wired into the page. An id
// present here MUST also be `built:true` on that engine's entry in
// lib/frontier-engines.ts — the registry's own header comment calls a
// `true` with no panel behind it "the looks built, isn't trap"; this map
// is the other half of that contract (a panel with no `built:true` would
// just never render, which is safe but pointless — keep both in sync).
const PANEL_BY_ENGINE_ID: Partial<Record<string, EnginePanel>> = {
  'materials-degradation': MaterialsDegradationPanel,
  'non-newtonian-fsi': FsiPanel,
  'safety-envelope': SafetyEnvelopePanel,
  'qec-decoder': QecDecoderPanel,
  'ledger-model-checker': ModelCheckerPanel,
  'byzantine-consensus': ConsensusPanel,
  'economic-equilibrium': MarketEquilibriumPanel,
  'constant-time-analyzer': ConstantTimePanel,
  'paillier-aggregation': PaillierPanel,
  'spiking-neural': SpikingNetworkPanel,
};

// Digit-key tab switching, 1-9 then 0 for the tenth engine — matches
// FRONTIER_ENGINES' fixed registry order. Discoverable two ways: it
// registers into the global command-palette (useLensCommand →
// KeyboardContext) under the "navigation" category, AND the caption row
// below the tab strip spells out the mapping directly, per
// docs/UI_QUALITY_RUBRIC.md §2's "discoverable, not just functional"
// requirement for scoped keyboard commands.
const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export default function FrontierPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { isLive, lastUpdated } = useRealtimeLens('frontier');
  const [activeId, setActiveId] = useState<string>(DEFAULT_FRONTIER_ENGINE_ID);

  const activeEngine = useMemo(
    () => FRONTIER_ENGINES.find((e) => e.id === activeId) ?? FRONTIER_ENGINES[0],
    [activeId],
  );

  const selectEngine = useCallback((id: string) => setActiveId(id), []);

  useLensCommand(
    useMemo(
      () =>
        FRONTIER_ENGINES.map((engine, i) => ({
          id: `select-${engine.id}`,
          keys: DIGIT_KEYS[i] ?? '',
          description: `Frontier: switch to ${engine.name}`,
          category: 'navigation' as const,
          action: () => selectEngine(engine.id),
          enabled: Boolean(DIGIT_KEYS[i]),
        })),
      [selectEngine],
    ),
    { lensId: 'frontier' },
  );

  const Panel: EnginePanel = activeEngine.built
    ? PANEL_BY_ENGINE_ID[activeEngine.id] ?? UnbuiltEnginePanel
    : UnbuiltEnginePanel;

  return (
    <LensShell lensId="frontier" asMain={false}>
      <div data-lens-theme="frontier" className="relative flex min-h-full flex-col pt-6">
        <div className="flex items-start justify-between gap-4 px-8">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Frontier</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {activeEngine.name}{who && activeEngine.id === DEFAULT_FRONTIER_ENGINE_ID ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="frontier" data={{}} compact />
          </div>
        </div>
        <FrontierEngineShell engines={FRONTIER_ENGINES} activeId={activeEngine.id} onSelect={selectEngine}>
          <Panel key={activeEngine.id} engine={activeEngine} />
        </FrontierEngineShell>
      </div>
    </LensShell>
  );
}
