'use client';

/**
 * RulerOverlay — Layer 1 ambient component that surfaces ONLY when
 * the player is the current_head of a realm. Reads the kingdom slice
 * of HUDContextProvider (populated via kingdoms.my_realm macro every
 * 6s).
 *
 * Top-right corner panel with:
 *   - Realm name + legitimacy bar (red < 30, amber < 60, green ≥ 60)
 *   - Treasury value
 *   - Citizen loyalty aggregate
 *   - Rebellion risk meter (red at ≥ 0.7 "REBELLION IMMINENT")
 *   - Pending threats list (up to 3)
 *   - "Issue decree" button → opens DecreePanel via PanelHost
 *
 * Hidden in combat/dialogue/vehicle/photo modes (caller's screen owns
 * the surface).
 */

import { useHUDContext } from './HUDContextProvider';

function dispatchPanelOpen(panelId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:panel-open', { detail: { panelId } }));
  }
}

export function RulerOverlay() {
  const mode = useHUDContext((s) => s.inputMode);
  const rulerOfRealmId = useHUDContext((s) => s.rulerOfRealmId);
  const myRealm = useHUDContext((s) => s.myRealm);
  const loyalty = useHUDContext((s) => s.realmLoyalty);
  const rebellionRisk = useHUDContext((s) => s.realmRebellionRisk);
  const decrees = useHUDContext((s) => s.activeDecrees);
  const threats = useHUDContext((s) => s.pendingThreats);

  if (!rulerOfRealmId || !myRealm) return null;
  if (mode === 'combat' || mode === 'dialogue' || mode === 'vehicle' || mode === 'photo') return null;

  const legitimacyTone =
    myRealm.legitimacy < 30 ? 'bg-red-600' :
    myRealm.legitimacy < 60 ? 'bg-amber-500' : 'bg-emerald-500';
  const rebellionPct = Math.round(rebellionRisk * 100);
  const rebellionTone =
    rebellionRisk >= 0.7 ? 'bg-red-600' :
    rebellionRisk >= 0.4 ? 'bg-amber-500' : 'bg-zinc-700';
  const loyaltyAvg = Math.round(loyalty?.avg_loyalty ?? 50);

  return (
    <div
      className="fixed right-3 top-12 z-30 w-64 bg-zinc-950/90 border border-zinc-700/60 rounded-lg backdrop-blur-md p-3 pointer-events-auto"
      data-testid="hud-ruler-overlay"
      data-realm-id={myRealm.id}
      role="status"
      aria-label={`Ruling ${myRealm.name}`}
    >
      <header className="mb-2">
        <h3 className="text-sm font-bold text-amber-200 truncate">{myRealm.name}</h3>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">You rule</p>
      </header>

      <div className="space-y-2 text-xs">
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-zinc-400">Legitimacy</span>
            <span className="font-mono text-zinc-300">{myRealm.legitimacy}/100</span>
          </div>
          <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden" role="meter" aria-valuenow={myRealm.legitimacy} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${legitimacyTone} transition-all`} style={{ width: `${myRealm.legitimacy}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Treasury</span>
          <span className="font-mono text-amber-300">{myRealm.treasury.toLocaleString()} CC</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Tax rate</span>
          <span className="font-mono text-zinc-300">{(myRealm.tax_rate * 100).toFixed(0)}%</span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-zinc-400">Citizen loyalty</span>
            <span className="font-mono text-zinc-300">{loyaltyAvg} · n={loyalty?.citizen_count ?? 0}</span>
          </div>
          <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${loyaltyAvg}%` }} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-zinc-400">Rebellion risk</span>
            <span className={`font-mono ${rebellionRisk >= 0.7 ? 'text-red-300 font-bold' : 'text-zinc-300'}`}>{rebellionPct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
            <div className={`h-full ${rebellionTone} transition-all`} style={{ width: `${rebellionPct}%` }} />
          </div>
          {rebellionRisk >= 0.7 && (
            <p className="mt-1 text-[10px] text-red-300 uppercase tracking-wider animate-pulse">⚠ Rebellion imminent</p>
          )}
        </div>

        {threats.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Threats</p>
            <ul className="space-y-0.5">
              {threats.slice(0, 3).map((t, i) => (
                <li key={`${t.source}-${i}`} className="text-[10px] text-red-300/90 truncate" data-threat-source={t.source}>
                  <span className="text-zinc-500">{t.kind}:</span> {t.source}
                </li>
              ))}
              {threats.length > 3 && <li className="text-[10px] text-zinc-500">+{threats.length - 3} more</li>}
            </ul>
          </div>
        )}

        {decrees.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Active decrees</p>
            <ul className="space-y-0.5">
              {decrees.slice(0, 3).map((d) => (
                <li key={d.id} className="text-[10px] text-zinc-400 truncate">
                  <span className="text-emerald-300/80">{d.kind}</span>
                  {d.popularity_delta !== 0 && (
                    <span className={`ml-1 ${d.popularity_delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {d.popularity_delta > 0 ? '+' : ''}{d.popularity_delta}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => dispatchPanelOpen('decree')}
        aria-label="Issue decree"
        className="mt-3 w-full text-xs px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium"
      >
        Issue decree
      </button>
    </div>
  );
}
