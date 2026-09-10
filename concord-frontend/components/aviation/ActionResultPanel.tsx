'use client';

import { X } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { STATUS_COLORS } from './aviation-ops';

export function ActionResultPanel({
  result,
  onClose,
}: {
  result: Record<string, unknown>;
  onClose: () => void;
}) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center justify-between mb-2">
        <h3 className={ds.heading3}>Action Result</h3>
        <button onClick={onClose} className={ds.btnGhost} aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      {result.checks !== undefined && result.allCurrent !== undefined && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${result.allCurrent ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{result.allCurrent ? 'All Current' : 'Attention Needed'}</span>
            <span className="text-xs text-gray-400">{String(result.crewMember)}</span>
          </div>
          {(result.checks as { type: string; current: boolean; daysRemaining?: number | null }[]).map((c, i) => (
            <div key={i} className="flex items-center justify-between p-1.5 bg-lattice-surface rounded">
              <span className="text-xs text-gray-300">{c.type}</span>
              <div className="flex items-center gap-2">
                {c.daysRemaining != null && <span className="text-[10px] text-gray-400">{c.daysRemaining}d left</span>}
                <span className={`text-[10px] font-semibold ${c.current ? 'text-green-400' : 'text-red-400'}`}>{c.current ? '✓' : '!'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {result.items !== undefined && result.overdueCount !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-gray-400">{String(result.aircraft)}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${Number(result.overdueCount) > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{String(result.overdueCount)} Overdue</span>
          </div>
          {(result.items as { type: string; overdue: boolean; hoursRemaining?: number; dueIn?: number }[]).map((item, i) => (
            <div key={i} className={`flex items-center justify-between p-1.5 rounded ${item.overdue ? 'bg-red-500/10' : 'bg-lattice-surface'}`}>
              <span className="text-xs text-gray-300">{item.type}</span>
              <span className={`text-[10px] font-semibold ${item.overdue ? 'text-red-400' : 'text-green-400'}`}>{item.overdue ? 'OVERDUE' : item.hoursRemaining != null ? `${item.hoursRemaining}h left` : item.dueIn != null ? `${item.dueIn}d left` : 'OK'}</span>
            </div>
          ))}
        </div>
      )}
      {result.totalTime !== undefined && result.picTime !== undefined && (
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.totalTime)}h</p>
            <p className="text-[10px] text-gray-400">Total Time</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.picTime)}h</p>
            <p className="text-[10px] text-gray-400">PIC Time</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.nightTime)}h</p>
            <p className="text-[10px] text-gray-400">Night Time</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.instrumentTime)}h</p>
            <p className="text-[10px] text-gray-400">Instrument</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.crossCountry)}h</p>
            <p className="text-[10px] text-gray-400">Cross-Country</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.totalFlights)}</p>
            <p className="text-[10px] text-gray-400">Total Flights</p>
          </div>
        </div>
      )}
      {result.utilization !== undefined && result.marina !== undefined && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{String(result.marina)}</span>
            <span className="text-sm font-bold text-neon-cyan">{String(result.utilization)}% Utilized</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-neon-cyan rounded-full transition-all" style={{ width: `${result.utilization}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-green-400">{String(result.occupied)}</p>
              <p className="text-[10px] text-gray-400">Occupied</p>
            </div>
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-amber-400">{String(result.vacant)}</p>
              <p className="text-[10px] text-gray-400">Vacant</p>
            </div>
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">${String(result.monthlyRevenue)}</p>
              <p className="text-[10px] text-gray-400">Monthly Rev</p>
            </div>
          </div>
        </div>
      )}
      {result.grossWeight !== undefined && result.cg !== undefined && result.stations !== undefined && (
        <div className="space-y-2" data-testid="wb-result">
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">{String(result.grossWeight)}<span className="text-[10px] text-gray-400"> lb</span></p>
              <p className="text-[10px] text-gray-400">Gross Weight</p>
            </div>
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">{String(result.cg)}<span className="text-[10px] text-gray-400"> in</span></p>
              <p className="text-[10px] text-gray-400">CG</p>
            </div>
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">{String(result.totalMoment)}</p>
              <p className="text-[10px] text-gray-400">Total Moment</p>
            </div>
          </div>
          {result.maxGrossWeight != null && (
            <div className="text-[10px] text-gray-400">Max Gross: {String(result.maxGrossWeight)} lb</div>
          )}
          <div className="space-y-1">
            {(result.stations as { station: string; weight: number; arm: number; moment: number }[]).map((st, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 bg-lattice-surface rounded text-xs">
                <span className="text-gray-300">{st.station}</span>
                <span className="text-gray-400 font-mono">{st.weight} lb @ {st.arm} in · {st.moment} lb-in</span>
              </div>
            ))}
          </div>
          {!!result.summary && <p className="text-[11px] text-gray-300">{String(result.summary)}</p>}
        </div>
      )}
      {result.withinEnvelope !== undefined && result.issues !== undefined && (
        <div className="space-y-2" data-testid="wb-validate-result">
          <div className="flex items-center gap-3">
            <span className={cn(
              'px-2 py-0.5 rounded text-xs font-semibold',
              result.overallSeverity === 'critical' ? 'bg-red-500/20 text-red-400'
                : result.overallSeverity === 'warning' ? 'bg-amber-500/20 text-amber-400'
                : 'bg-green-500/20 text-green-400'
            )}>
              {result.withinEnvelope ? 'Within Envelope' : 'OUT OF ENVELOPE'}
            </span>
            <span className="text-xs text-gray-400">{String(result.aircraft ?? '')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">{String(result.grossWeight)}<span className="text-[10px] text-gray-400"> lb</span></p>
              <p className="text-[10px] text-gray-400">Gross Weight</p>
            </div>
            <div className="p-2 bg-lattice-surface rounded text-center">
              <p className="text-sm font-bold text-neon-cyan">{String(result.cg)}<span className="text-[10px] text-gray-400"> in</span></p>
              <p className="text-[10px] text-gray-400">CG</p>
            </div>
          </div>
          {(result.issues as { severity: string; kind: string; message: string }[]).length === 0 ? (
            <p className="text-[11px] text-gray-300">{String(result.message ?? 'Within limits.')}</p>
          ) : (
            <div className="space-y-1">
              {(result.issues as { severity: string; kind: string; message: string }[]).map((iss, i) => (
                <div key={i} className={cn(
                  'p-1.5 rounded text-[11px]',
                  iss.severity === 'critical' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
                )}>
                  {iss.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {result.totalHours !== undefined && result.averageDuration !== undefined && (
        <div className="grid grid-cols-3 gap-2" data-testid="flight-summary-result">
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.totalHours)}h</p>
            <p className="text-[10px] text-gray-400">Total Hours</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.totalFlights)}</p>
            <p className="text-[10px] text-gray-400">Total Flights</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.averageDuration)}h</p>
            <p className="text-[10px] text-gray-400">Avg Duration</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.longestFlight)}h</p>
            <p className="text-[10px] text-gray-400">Longest</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.totalFuelConsumed)}</p>
            <p className="text-[10px] text-gray-400">Fuel (gal)</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-sm font-bold text-neon-cyan">{String(result.avgFuelPerHour)}</p>
            <p className="text-[10px] text-gray-400">Gal/hr</p>
          </div>
        </div>
      )}
      {result.flightCategory !== undefined && result.windComponents !== undefined && (
        <div className="space-y-2" data-testid="weather-check-result">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold bg-${(STATUS_COLORS[String(result.flightCategory)] || 'gray-400').replace('-400', '-500')}/20 text-${STATUS_COLORS[String(result.flightCategory)] || 'gray-400'}`}>{String(result.flightCategory)}</span>
            <span className="text-xs text-gray-400">{String(result.station ?? '')}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-1.5 bg-lattice-surface rounded"><span className="text-gray-400">Wind </span><span className="font-mono text-white">{String(result.wind)}</span></div>
            <div className="p-1.5 bg-lattice-surface rounded"><span className="text-gray-400">Vis </span><span className="font-mono text-white">{String(result.visibility)}</span></div>
            <div className="p-1.5 bg-lattice-surface rounded"><span className="text-gray-400">Ceil </span><span className="font-mono text-white">{String(result.ceiling)}</span></div>
          </div>
        </div>
      )}
      {result.limits !== undefined && result.compliant !== undefined && (
        <div className="space-y-2" data-testid="duty-time-result">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${result.compliant ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{result.compliant ? 'Compliant' : 'LIMIT EXCEEDED'}</span>
            <span className="text-xs text-gray-400">{String(result.crewMember ?? '')}</span>
          </div>
          {Object.entries(result.limits as Record<string, { limit: number; actual: number; exceeded: boolean }>).map(([k, l]) => (
            <div key={k} className={`flex items-center justify-between p-1.5 rounded text-xs ${l.exceeded ? 'bg-red-500/10' : 'bg-lattice-surface'}`}>
              <span className="text-gray-300">{k}</span>
              <span className={`font-mono ${l.exceeded ? 'text-red-400' : 'text-gray-300'}`}>{l.actual} / {l.limit}h</span>
            </div>
          ))}
        </div>
      )}
      {result.alerts !== undefined && result.allClear !== undefined && (
        <div className="space-y-1" data-testid="maintenance-alert-result">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-gray-400">{String(result.aircraft ?? '')}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${result.allClear ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{result.allClear ? 'All Clear' : `${String(result.overdueCount)} Overdue`}</span>
          </div>
          {(result.alerts as { name: string; category: string; priority: string; reasons: string[] }[]).map((a, i) => (
            <div key={i} className="p-1.5 bg-red-500/10 rounded">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-300">{a.name}</span>
                <span className="text-[10px] font-semibold text-red-400 uppercase">{a.priority}</span>
              </div>
              <div className="text-[10px] text-gray-400">{a.reasons.join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
