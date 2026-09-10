'use client';

import { useCallback, useState } from 'react';
import {
  Plane, Navigation, Users, DollarSign, Clock, Fuel, Wrench, TrendingUp,
  Shield, FileText, CloudRain, UserCheck, Calculator, ShieldCheck,
  Clipboard, Timer, AlertTriangle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { showToast } from '@/components/common/Toasts';
import AvShell, { type AvAircraft, type AvTrack } from './AvShell';
import { ActionResultPanel } from './ActionResultPanel';
import {
  currencyStatus, daysUntil, statusBadge,
  type PilotData, type AircraftData, type MaintenanceData, type WeatherData,
} from './aviation-ops';
import type { AvView } from './aviation-nav';

export function DashboardPanel({
  onNavigate,
  recentSafetyAlerts = 0,
}: {
  onNavigate: (view: AvView) => void;
  recentSafetyAlerts?: number;
}) {
  const flightQuery = useLensData('aviation', 'Flight');
  const pilotQuery = useLensData('aviation', 'Pilot');
  const fleetQuery = useLensData('aviation', 'Aircraft');
  const mxQuery = useLensData('aviation', 'WorkOrder');
  const charterQuery = useLensData('aviation', 'Charter');
  const wbQuery = useLensData('aviation', 'WeightBalance');
  const weatherQuery = useLensData('aviation', 'Weather');
  const runAction = useRunArtifact('aviation');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    pilotCurrency: true,
    upcomingMx: true,
    fleetStatus: true,
    weatherSummary: true,
  });

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const flights = flightQuery.items;
  const pilots = pilotQuery.items;
  const fleet = fleetQuery.items;
  const workOrders = mxQuery.items;
  const charters = charterQuery.items;
  const weatherBriefings = weatherQuery.items;

  const activeFlights = flights.filter((f) => f.meta?.status === 'airborne' || f.meta?.status === 'dispatched').length;
  const completedFlights = flights.filter((f) => f.meta?.status === 'completed').length;
  const totalFlightHours = flights.reduce((sum, f) => {
    const d = f.data as Record<string, unknown>;
    const hobbs = ((d.hobbsEnd as number) || 0) - ((d.hobbsStart as number) || 0);
    return sum + (hobbs > 0 ? hobbs : 0);
  }, 0);
  const totalFuelBurn = flights.reduce((sum, f) => sum + ((f.data as Record<string, unknown>).fuelBurn as number || 0), 0);
  const latestFlightMs = flights.reduce((m, f) => {
    const t = new Date(f.updatedAt).getTime();
    return Number.isFinite(t) ? Math.max(m, t) : m;
  }, 0);
  const hours30d = flights.reduce((sum, f) => {
    const d = f.data as Record<string, unknown>;
    const when = d.date ? new Date(d.date as string) : new Date(f.updatedAt);
    if (Number.isNaN(when.getTime()) || (latestFlightMs && latestFlightMs - when.getTime() > 30 * 86_400_000)) return sum;
    const hobbs = ((d.hobbsEnd as number) || 0) - ((d.hobbsStart as number) || 0);
    return sum + (hobbs > 0 ? hobbs : 0);
  }, 0);
  const airworthyAircraft = fleet.filter((f) => f.meta?.status === 'airworthy').length;
  const groundedAircraft = fleet.filter((f) => f.meta?.status === 'grounded' || f.meta?.status === 'in-maintenance').length;
  const currentPilots = pilots.filter((p) => {
    const d = p.data as Record<string, unknown>;
    return currencyStatus(d.medicalExpiry as string) !== 'expired' && currencyStatus(d.bfrDate as string) !== 'expired';
  }).length;
  const openWorkOrders = workOrders.filter((w) => !w.meta?.status?.includes('closed')).length;
  const aogItems = workOrders.filter((w) => (w.data as Record<string, unknown>).priority === 'AOG').length;
  const pendingCharters = charters.filter((c) => c.meta?.status === 'confirmed' || c.meta?.status === 'quoted').length;
  const charterRevenue = charters.filter((c) => c.meta?.status === 'completed').reduce(
    (sum, c) => sum + ((c.data as Record<string, unknown>).totalPrice as number || 0), 0,
  );
  const ifrStations = weatherBriefings.filter((w) => {
    const d = w.data as unknown as WeatherData;
    return d.flightCategory === 'IFR' || d.flightCategory === 'LIFR';
  }).length;

  const handleAction = async (action: string, artifactId?: string) => {
    const targetId = artifactId
      || (action === 'currencyCheck' ? pilots[0]?.id : undefined)
      || (action === 'maintenanceAlert' ? fleet[0]?.id || workOrders[0]?.id : undefined)
      || (action === 'flightSummary' ? flights[0]?.id : undefined)
      || (action === 'dutyTimeCheck' ? pilots[0]?.id : undefined)
      || (action.includes('wb') ? wbQuery.items[0]?.id : undefined)
      || flights[0]?.id;
    if (!targetId) return;
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      if (result.ok === false) {
        setActionResult({ message: `Action failed: ${(result as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setActionResult(result.result as Record<string, unknown>);
      }
    } catch (err) {
      console.error('Action failed:', err);
      showToast('error', 'Action failed');
    }
  };

  const today = new Date();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const expiringPilots = pilots.filter((p) => {
    const exp = (p.data as Record<string, unknown>).medicalExpiry
      ? new Date((p.data as Record<string, unknown>).medicalExpiry as string)
      : null;
    return exp && exp > today && exp < in30;
  }).length;
  const overdueMaint = workOrders.filter((m) => {
    const dh = Number((m.data as Record<string, unknown>).dueHobbs || 0);
    const cur = Number((m.data as Record<string, unknown>).currentHobbs || 0);
    return dh > 0 && cur >= dh;
  }).length;

  const queueItems = [
    expiringPilots > 0 && {
      label: `${expiringPilots} pilot${expiringPilots === 1 ? '' : 's'} medical expiring in 30 days`,
      action: () => { onNavigate('pilots'); handleAction('currencyCheck'); },
      color: 'text-amber-300',
    },
    overdueMaint > 0 && {
      label: `${overdueMaint} aircraft maintenance overdue (Hobbs)`,
      action: () => { onNavigate('maintenance'); handleAction('maintenanceAlert'); },
      color: 'text-rose-300',
    },
    recentSafetyAlerts > 0 && {
      label: `${recentSafetyAlerts} NTSB/FAA alert${recentSafetyAlerts === 1 ? '' : 's'} this week — review`,
      action: () => { /* feed is in the shell above */ },
      color: 'text-sky-300',
    },
  ].filter(Boolean) as Array<{ label: string; action: () => void; color: string }>;

  const avAircraft: AvAircraft[] = fleet.map((a) => {
    const d = a.data as unknown as AircraftData;
    return {
      id: a.id,
      tail: d.tailNumber || a.title,
      make: d.make || '',
      model: d.model || '',
      hobbsHours: d.totalTime || 0,
      cruiseKts: 0,
      fuelBurnGph: 0,
    };
  });
  const avTracks: AvTrack[] = flights.slice(0, 8).map((f) => {
    const d = f.data as Record<string, unknown>;
    return {
      id: f.id,
      tail: (d.tailNumber as string) || undefined,
      from: (d.departure as string) || null,
      to: (d.arrival as string) || null,
      endedAt: f.meta?.status === 'completed' ? f.updatedAt : null,
      totalDistanceNm: Number(d.distanceNM || 0),
    };
  });

  return (
    <div className="space-y-6">
      <AvShell
        totalHours={totalFlightHours}
        hours30d={hours30d}
        aircraftCount={fleet.length}
        activeTracks={activeFlights}
        totalFlights={flights.length}
        aircraft={avAircraft}
        tracks={avTracks}
      />

      <section className="rounded-xl border border-white/10 bg-gradient-to-br from-sky-900/20 via-zinc-900/40 to-amber-900/15 backdrop-blur-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-sky-300/80 mb-1">Flight ops</div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-light text-zinc-100 font-mono tabular-nums">{fleet.length}</span>
              <span className="text-sm text-zinc-400">aircraft · {pilots.length} pilot{pilots.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[10px] text-zinc-400 uppercase">Maintenance</div>
                <div className="text-zinc-200 font-medium font-mono">{workOrders.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 uppercase">W&amp;B configs</div>
                <div className="text-zinc-200 font-medium font-mono">{wbQuery.items.length}</div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-400 uppercase">Safety wire</div>
                <div className="text-zinc-200 font-medium font-mono">{recentSafetyAlerts}/7d</div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80 mb-1">Pre-flight queue</div>
            {queueItems.length === 0 ? (
              <div className="mt-2 text-sm text-zinc-400">
                {fleet.length === 0 ? 'Add an aircraft to begin flight ops tracking.' : "All clear. Run W&B for today's flight to add it here."}
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {queueItems.map((item, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={item.action}
                      className={cn('w-full text-left text-sm px-3 py-1.5 rounded border border-white/10 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] transition-colors flex items-center justify-between gap-2', item.color)}
                    >
                      <span>{item.label}</span>
                      <span className="text-xs opacity-60">→</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className={ds.grid4}>
        <Kpi icon={Plane} label="Active Flights" value={String(activeFlights)} caption={`${completedFlights} completed this period`} tone="text-sky-400" />
        <Kpi icon={Navigation} label="Fleet Available" value={String(airworthyAircraft)} caption={`${groundedAircraft} grounded / in maintenance`} tone="text-green-400" />
        <Kpi icon={Users} label="Pilots Current" value={String(currentPilots)} caption={`${pilots.length} total on roster`} tone="text-blue-400" />
        <Kpi icon={DollarSign} label="Charter Revenue" value={`$${charterRevenue.toLocaleString()}`} caption={`${pendingCharters} pending bookings`} tone="text-emerald-400" />
      </div>
      <div className={ds.grid4}>
        <Kpi icon={Clock} label="Hours Flown" value={totalFlightHours.toFixed(1)} tone="text-cyan-400" />
        <Kpi icon={Fuel} label="Fuel Burned (gal)" value={totalFuelBurn.toFixed(0)} tone="text-amber-400" />
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Open Work Orders</span>
          </div>
          <div className="text-2xl font-bold text-orange-400 font-mono tabular-nums">{openWorkOrders}</div>
          {aogItems > 0 && <div className="text-xs text-red-400 mt-1">{aogItems} AOG items</div>}
        </div>
        <Kpi icon={TrendingUp} label="Total Flights" value={String(flights.length)} tone="text-purple-400" />
      </div>

      <div className={ds.panel}>
        <button type="button" onClick={() => toggle('pilotCurrency')} className="flex items-center gap-2 w-full text-left">
          {expanded.pilotCurrency ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Shield className="w-5 h-5 text-yellow-400" />
          <h3 className={ds.heading3}>Pilot Currency Status</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{pilots.length} pilots</span>
        </button>
        {expanded.pilotCurrency && (
          <div className="mt-4 space-y-2">
            {pilots.length === 0 ? (
              <p className={ds.textMuted}>No pilots on roster. Add pilots in the Pilots tab.</p>
            ) : pilots.map((p) => {
              const d = p.data as unknown as PilotData;
              const medStatus = currencyStatus(d.medicalExpiry);
              const bfrStatus = currencyStatus(d.bfrDate);
              const ipcStatus = currencyStatus(d.ipcDate);
              return (
                <div key={p.id} className="flex items-center gap-4 py-2 border-b border-lattice-border last:border-0">
                  <UserCheck className="w-4 h-4 text-sky-400" />
                  <span className="text-white font-medium w-40 truncate">{d.name || p.title}</span>
                  <span className={cn('text-xs', ds.textMuted)}>{d.certificate || '--'}</span>
                  <div className="flex gap-2 ml-auto">
                    <span className={statusBadge(medStatus)}>Medical: {medStatus}</span>
                    <span className={statusBadge(bfrStatus)}>BFR: {bfrStatus}</span>
                    {d.ratings?.includes('IFR') && <span className={statusBadge(ipcStatus)}>IPC: {ipcStatus}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={ds.panel}>
        <button type="button" onClick={() => toggle('upcomingMx')} className="flex items-center gap-2 w-full text-left">
          {expanded.upcomingMx ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Wrench className="w-5 h-5 text-orange-400" />
          <h3 className={ds.heading3}>Upcoming Maintenance</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{openWorkOrders} open</span>
        </button>
        {expanded.upcomingMx && (
          <div className="mt-4 space-y-2">
            {workOrders.length === 0 ? (
              <p className={ds.textMuted}>No work orders. Add maintenance items in the Maintenance tab.</p>
            ) : workOrders.slice(0, 10).map((wo) => {
              const d = wo.data as unknown as MaintenanceData;
              return (
                <div key={wo.id} className="flex items-center gap-4 py-2 border-b border-lattice-border last:border-0">
                  <FileText className="w-4 h-4 text-orange-400" />
                  <span className="text-white font-medium truncate flex-1">{wo.title}</span>
                  <span className={ds.textMuted}>{d.tailNumber || '--'}</span>
                  <span className={statusBadge(d.priority || 'routine')}>{d.priority || 'routine'}</span>
                  {d.melReference && <span className="text-xs text-yellow-400">MEL: {d.melReference}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={ds.panel}>
        <button type="button" onClick={() => toggle('fleetStatus')} className="flex items-center gap-2 w-full text-left">
          {expanded.fleetStatus ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <Navigation className="w-5 h-5 text-cyan-400" />
          <h3 className={ds.heading3}>Fleet Status</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{fleet.length} aircraft</span>
        </button>
        {expanded.fleetStatus && (
          <div className="mt-4">
            {fleet.length === 0 ? (
              <p className={ds.textMuted}>No aircraft in fleet. Add aircraft in the Fleet tab.</p>
            ) : (
              <div className={ds.grid3}>
                {fleet.map((ac) => {
                  const d = ac.data as unknown as AircraftData;
                  const annualDays = daysUntil(d.nextAnnual);
                  return (
                    <div key={ac.id} className={cn(ds.panel, 'border-l-4', ac.meta?.status === 'airworthy' ? 'border-l-green-500' : ac.meta?.status === 'grounded' ? 'border-l-red-500' : 'border-l-orange-500')}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-bold text-sm font-mono">{d.tailNumber || ac.title}</span>
                        <span className={statusBadge(ac.meta?.status || 'airworthy')}>{ac.meta?.status}</span>
                      </div>
                      <div className={ds.textMuted}>{d.make} {d.model} ({d.year || '--'})</div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                        <span className="text-gray-400">Total Time:</span>
                        <span className="text-white font-mono">{d.totalTime?.toFixed(1) || '0'}h</span>
                        <span className="text-gray-400">TSMOH:</span>
                        <span className="text-white font-mono">{d.tsmoh?.toFixed(1) || '0'}h</span>
                        <span className="text-gray-400">Next Annual:</span>
                        <span className={cn(annualDays < 30 ? 'text-red-400' : annualDays < 60 ? 'text-yellow-400' : 'text-white')}>
                          {d.nextAnnual || 'N/A'} {annualDays < 60 && `(${annualDays}d)`}
                        </span>
                      </div>
                      {(d.squawks?.length || 0) > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-yellow-400">
                          <AlertTriangle className="w-3 h-3" /> {d.squawks.length} open squawk{d.squawks.length > 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={ds.panel}>
        <button type="button" onClick={() => toggle('weatherSummary')} className="flex items-center gap-2 w-full text-left">
          {expanded.weatherSummary ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          <CloudRain className="w-5 h-5 text-cyan-400" />
          <h3 className={ds.heading3}>Weather Briefings</h3>
          <span className={cn(ds.textMuted, 'ml-auto')}>{weatherBriefings.length} stations{ifrStations > 0 ? ` (${ifrStations} IFR/LIFR)` : ''}</span>
        </button>
        {expanded.weatherSummary && (
          <div className="mt-4">
            {weatherBriefings.length === 0 ? (
              <p className={ds.textMuted}>No weather briefings. Add stations in the Weather tab.</p>
            ) : (
              <div className={ds.grid3}>
                {weatherBriefings.slice(0, 6).map((w) => {
                  const d = w.data as unknown as WeatherData;
                  const cat = d.flightCategory || 'VFR';
                  const catColor = cat === 'VFR' ? 'text-green-400' : cat === 'MVFR' ? 'text-blue-400' : cat === 'IFR' ? 'text-red-400' : 'text-purple-400';
                  return (
                    <div key={w.id} className="flex items-center gap-3 p-2 bg-lattice-elevated rounded-lg">
                      <CloudRain className={cn('w-4 h-4', catColor)} />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-sm font-bold text-white">{d.stationId || w.title}</span>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{d.windDirection || '--'}°/{d.windSpeed || '--'}kt</span>
                          <span>{d.visibility || '--'}SM</span>
                          <span>{d.ceiling ? `${d.ceiling}ft` : 'CLR'}</span>
                        </div>
                      </div>
                      <span className={cn('text-xs font-bold', catColor)}>{cat}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3')}>Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => handleAction('calculate-wb')} className={ds.btnSecondary}><Calculator className="w-4 h-4" /> W&B Calculate</button>
          <button type="button" onClick={() => handleAction('validate-wb')} className={ds.btnSecondary}><ShieldCheck className="w-4 h-4" /> W&B Validate</button>
          <button type="button" onClick={() => handleAction('currencyCheck')} className={ds.btnSecondary}><Shield className="w-4 h-4" /> Currency Check</button>
          <button type="button" onClick={() => handleAction('maintenanceAlert')} className={ds.btnSecondary}><AlertTriangle className="w-4 h-4" /> Maintenance Alert</button>
          <button type="button" onClick={() => handleAction('flightSummary')} className={ds.btnSecondary}><Clipboard className="w-4 h-4" /> Flight Summary</button>
          <button type="button" onClick={() => handleAction('dutyTimeCheck')} className={ds.btnSecondary}><Timer className="w-4 h-4" /> Duty Time Check</button>
        </div>
      </div>

      {actionResult && <ActionResultPanel result={actionResult} onClose={() => setActionResult(null)} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, caption, tone }: { icon: typeof Plane; label: string; value: string; caption?: string; tone: string }) {
  return (
    <div className={ds.panel}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('w-5 h-5', tone)} />
        <span className={ds.textMuted}>{label}</span>
      </div>
      <div className={cn('text-2xl font-bold font-mono tabular-nums', tone)}>{value}</div>
      {caption && <div className="text-xs text-gray-400 mt-1">{caption}</div>}
    </div>
  );
}

export default DashboardPanel;
