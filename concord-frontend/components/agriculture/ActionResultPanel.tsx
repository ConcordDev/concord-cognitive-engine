'use client';

import { X } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useFarmDesk } from './FarmDeskContext';

export function ActionResultPanel() {
  const { actionResult, clearResult } = useFarmDesk();
  if (!actionResult) return null;

  return (
    <div className={ds.panel}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={ds.heading3}>Action Result</h3>
        <button type="button" onClick={clearResult} className={ds.btnGhost} aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      {actionResult.fields !== undefined &&
        Array.isArray(actionResult.fields) &&
        (actionResult.fields as { fieldName?: string }[]).length > 0 &&
        !(actionResult.totalAcreage !== undefined) && (
          <div className="space-y-2">
            {(
              actionResult.fields as {
                fieldName?: string;
                lastCrop?: string;
                suggestedNext?: string[];
                soilNote?: string;
              }[]
            ).map((f, i) => (
              <div key={i} className="p-2 bg-lattice-surface rounded">
                <p className="text-xs font-semibold text-neon-cyan">{f.fieldName}</p>
                <p className="text-[10px] text-gray-400">
                  Last crop: <span className="text-gray-200">{f.lastCrop}</span>
                </p>
                <p className="text-[10px] text-gray-400">
                  Suggested:{' '}
                  <span className="text-green-400">
                    {(f.suggestedNext || []).slice(0, 3).join(', ') || 'none'}
                  </span>
                </p>
                {f.soilNote && <p className="text-[10px] text-amber-400 mt-0.5">{f.soilNote}</p>}
              </div>
            ))}
          </div>
        )}
      {actionResult.fieldsAnalyzed !== undefined && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Stat label="Fields Analyzed" value={String(actionResult.fieldsAnalyzed)} />
          <Stat label="Total Acreage" value={`${String(actionResult.totalAcreage)} ac`} />
          <Stat label="Actual Yield" value={String(actionResult.totalActualYield)} />
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p
              className={`text-sm font-bold ${Number(actionResult.overallVariancePct) >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {String(actionResult.overallVariancePct)}%
            </p>
            <p className="text-[10px] text-gray-400">Variance vs Expected</p>
          </div>
        </div>
      )}
      {actionResult.overdueCount !== undefined && actionResult.totalGallonsAllFields === undefined && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Overdue" value={String(actionResult.overdueCount)} tone="text-red-400" />
          <Stat label="Upcoming" value={String(actionResult.upcomingCount)} tone="text-amber-400" />
          <Stat label="Total Equipment" value={String(actionResult.totalEquipment)} />
        </div>
      )}
      {actionResult.totalGallonsAllFields !== undefined && (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Total Gallons"
            value={Number(actionResult.totalGallonsAllFields).toLocaleString()}
          />
          <Stat label="Days Scheduled" value={String(actionResult.daysAhead)} />
        </div>
      )}
      {actionResult.recommended !== undefined && actionResult.plantingWindow !== undefined && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Recommended Next" value={String(actionResult.recommended)} tone="text-green-400 capitalize" />
            <Stat
              label="Planting Window"
              value={`${String((actionResult.plantingWindow as { start?: string })?.start)}–${String((actionResult.plantingWindow as { end?: string })?.end)}`}
            />
            <Stat
              label="Expected Yield"
              value={`${String((actionResult.expectedYield as { low?: number })?.low)}–${String((actionResult.expectedYield as { high?: number })?.high)} ${String((actionResult.expectedYield as { unit?: string })?.unit || '')}`}
            />
          </div>
          {Array.isArray(actionResult.candidates) &&
            (actionResult.candidates as { crop?: string; soilFit?: string }[]).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(actionResult.candidates as { crop?: string; soilFit?: string }[]).map((c, i) => (
                  <span
                    key={i}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      c.crop === actionResult.recommended
                        ? 'border-green-500/40 bg-green-500/10 text-green-300'
                        : 'border-lattice-border text-gray-400',
                    )}
                  >
                    {c.crop} · soil {c.soilFit}
                  </span>
                ))}
              </div>
            )}
          {typeof actionResult.rationale === 'string' && (
            <p className="text-[11px] text-gray-400">{actionResult.rationale}</p>
          )}
        </div>
      )}
      {actionResult.estimatedYieldPerAcre !== undefined && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Per Acre"
              value={`${String(actionResult.estimatedYieldPerAcre)} ${String(actionResult.unit || '')}/ac`}
            />
            <Stat
              label="Total Yield"
              value={`${String(actionResult.totalYield)} ${String(actionResult.unit || '')}`}
              tone="text-green-400"
            />
            <Stat
              label="Reference Band"
              value={`${String((actionResult.band as { low?: number })?.low)}–${String((actionResult.band as { high?: number })?.high)}`}
              tone="text-gray-200"
            />
          </div>
          {typeof actionResult.summary === 'string' && (
            <p className="text-[11px] text-gray-400">{actionResult.summary}</p>
          )}
        </div>
      )}
      {actionResult.recommendations !== undefined && actionResult.trends !== undefined && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(
              actionResult.trends as Record<string, { latest?: number | null; status?: string }>,
            ).map(([key, t]) => (
              <div key={key} className="p-2 bg-lattice-surface rounded text-center">
                <p
                  className={cn(
                    'text-sm font-bold',
                    t.status === 'low' ? 'text-red-400' : t.status === 'high' ? 'text-amber-400' : 'text-green-400',
                  )}
                >
                  {t.latest ?? '—'}
                </p>
                <p className="text-[10px] text-gray-400">{key}</p>
              </div>
            ))}
          </div>
          {Array.isArray(actionResult.recommendations) &&
            (actionResult.recommendations as { priority?: string; action?: string }[]).length > 0 && (
              <ul className="space-y-1">
                {(actionResult.recommendations as { priority?: string; action?: string }[]).map((r, i) => (
                  <li key={i} className="text-[11px] flex items-center gap-1.5">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] uppercase',
                        r.priority === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300',
                      )}
                    >
                      {r.priority}
                    </span>
                    <span className="text-gray-300">{r.action}</span>
                  </li>
                ))}
              </ul>
            )}
          {typeof actionResult.summary === 'string' && (
            <p className="text-[11px] text-gray-400">{actionResult.summary}</p>
          )}
        </div>
      )}
      {actionResult.fields === undefined &&
        actionResult.fieldsAnalyzed === undefined &&
        actionResult.overdueCount === undefined &&
        actionResult.totalGallonsAllFields === undefined &&
        actionResult.recommended === undefined &&
        actionResult.estimatedYieldPerAcre === undefined &&
        actionResult.recommendations === undefined && (
          <div className="space-y-1.5 text-sm">
            {typeof actionResult.message === 'string' && (
              <p className="text-gray-200">{actionResult.message}</p>
            )}
            {typeof actionResult.note === 'string' && (
              <p className="text-gray-400 text-xs">{actionResult.note}</p>
            )}
            {typeof actionResult.message !== 'string' && typeof actionResult.note !== 'string' && (
              <pre className="text-[10px] text-gray-400 whitespace-pre-wrap break-words bg-lattice-surface rounded p-2 max-h-64 overflow-y-auto">
                {JSON.stringify(actionResult, null, 2)}
              </pre>
            )}
          </div>
        )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="p-2 bg-lattice-surface rounded text-center">
      <p className={cn('text-sm font-bold text-neon-cyan', tone)}>{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

export default ActionResultPanel;
