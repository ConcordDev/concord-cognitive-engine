'use client';

// concord-frontend/components/conkay/panels/ConKayTelemetryPanel.tsx
//
// Phase-2 telemetry panel — a small ledger of the most recent REAL macro runs
// (domain.action · ok/failed · elapsed ms). Every row is a `macro:completed`
// fact from the HUD store; there is no ambient/placeholder content, so the
// panel is empty until the backend actually reports a completed run.
//
// Extracted from ConKayOverlay.tsx (F1, ConKay cockpit) so it can be
// registered in `lib/panel-registry.ts` as `conkay.telemetry` and lazy-mounted
// in the cockpit's panel lanes (or anywhere else a panel can be cross-mounted).
// It is self-contained — reads `conkayHudStore` directly, takes no props —
// which is exactly the registry's eligibility bar.

import { useConkayHudStore } from '../conkayHudStore';

export function ConKayTelemetryPanel() {
  const telemetry = useConkayHudStore((s) => s.telemetry);
  if (!telemetry.length) return null;
  return (
    <div className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-2">
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">recent system work</div>
      <ul className="space-y-1">
        {telemetry.map((t, i) => (
          <li
            key={`${t.domain}.${t.action}-${i}`}
            className="flex items-center justify-between rounded-lg px-2 py-1 text-[11px]"
          >
            <span className="truncate text-cyan-100/80">{t.domain}.{t.action}</span>
            <span className="flex items-center gap-2">
              {t.ms != null && <span className="text-cyan-300/50">{t.ms} ms</span>}
              <span className={t.ok ? 'text-emerald-300' : 'text-rose-300'}>{t.ok ? 'ok' : 'failed'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ConKayTelemetryPanel;
