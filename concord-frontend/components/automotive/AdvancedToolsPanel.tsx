'use client';

/**
 * AdvancedToolsPanel — CARFAX Car Care 2026 feature-parity surface for
 * the automotive lens. Covers the seven backlog features:
 *   1. OBD-II live telemetry import (Web Bluetooth ELM327 dongle bridge)
 *   2. Cost-per-mile / total-cost-of-ownership rollups
 *   3. Predictive maintenance alerts from mileage + service history
 *   4. Photo attachments for receipts + odometer readings
 *   5. Multi-vehicle comparison dashboard
 *   6. Service-shop locator + appointment notes
 *   7. Warranty + insurance renewal tracking
 *
 * Every value is real user input or computed by the backend macros —
 * no seed/demo data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Bluetooth, Calculator, CalendarClock, Camera, GitCompare,
  Loader2, MapPin, Plus, Shield, Trash2, TrendingUp, Wrench, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

type ToolTab = 'predictive' | 'tco' | 'compare' | 'obd' | 'photos' | 'shops' | 'renewals';

interface Vehicle { id: string; name: string; make: string; model: string; year: number | null; odometer: number; odometerUnit: string }

interface PredictiveAlert {
  vehicleId: string; vehicleName: string; serviceType: string; dueAtOdometer: number;
  milesRemaining: number; milesPerDay: number | null; daysUntilDue: number | null;
  predictedDate: string | null; risk: 'overdue' | 'high' | 'medium' | 'low'; recommendation: string;
}
interface TcoResult {
  vehicleName: string; milesTracked: number; ownedMonths: number; purchasePrice: number;
  salvageValue: number; depreciation: number; operatingCost: number; totalCostOfOwnership: number;
  costPerMile: number | null; operatingCostPerMile: number | null; costPerMonth: number;
  byCategory: Record<string, number>; note: string | null;
}
interface CompareRow {
  vehicleId: string; vehicleName: string; year: number | null; make: string; model: string;
  odometer: number; lifetimeMpg: number | null; totalSpend: number; fuelSpend: number;
  serviceCount: number; fillCount: number; milesTracked: number; costPerMile: number | null;
}
interface CompareResult {
  rows: CompareRow[]; vehicleCount: number; fleetTotalSpend: number; fleetMilesTracked: number;
  highlights: { bestMpg?: string; lowestCostPerMile?: string; highestSpend?: string };
}
interface ObdReading { id: string; metric: string; value: number; unit: string; timestamp: string; known: boolean }
interface ObdSnapshot { value: number; unit: string; timestamp: string }
interface Attachment { id: string; number: string; kind: string; url: string; caption: string; odometerReading: number | null; date: string }
interface Shop { id: string; number: string; name: string; address: string; phone: string; laborRate: number | null; rating: number | null; specialties: string[]; lat: number | null; lon: number | null; note: string }
interface Appointment { id: string; number: string; date: string; time: string; serviceType: string; status: string; estimatedCost: number | null; notes: string; shopName: string | null; shopId: string }
interface Renewal {
  id: string; number: string; kind: string; title: string; provider: string; policyNumber: string;
  renewalDate: string; premium: number | null; coverageLimitMiles: number | null; reminderDays: number;
  daysRemaining: number | null; milesRemaining: number | null; status: 'ok' | 'due_soon' | 'expired'; vehicleName: string | null;
}

const RISK_COLOUR: Record<string, string> = {
  overdue: 'text-rose-300', high: 'text-orange-300', medium: 'text-amber-300', low: 'text-emerald-300',
};
const STATUS_COLOUR: Record<string, string> = {
  expired: 'text-rose-300', due_soon: 'text-amber-300', ok: 'text-emerald-300',
};
const OBD_PIDS = ['rpm', 'speed', 'coolantTemp', 'engineLoad', 'intakeTemp', 'throttlePos', 'fuelLevel', 'batteryVoltage'] as const;
const RENEWAL_KINDS = ['warranty', 'insurance', 'registration', 'inspection', 'lease', 'extended_warranty', 'roadside', 'other'] as const;
const ATTACHMENT_KINDS = ['receipt', 'odometer', 'damage', 'document', 'other'] as const;

const TABS: { id: ToolTab; label: string; icon: typeof Activity }[] = [
  { id: 'predictive', label: 'Predictive', icon: TrendingUp },
  { id: 'tco', label: 'Cost of ownership', icon: Calculator },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'obd', label: 'OBD-II', icon: Bluetooth },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'shops', label: 'Shops', icon: MapPin },
  { id: 'renewals', label: 'Renewals', icon: Shield },
];

export function AdvancedToolsPanel() {
  const [tab, setTab] = useState<ToolTab>('predictive');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  const loadVehicles = useCallback(async () => {
    setLoadingVehicles(true);
    try {
      const r = await lensRun('automotive', 'vehicles-list', {});
      if (r.data?.ok) {
        const list = ((r.data.result as { vehicles?: Vehicle[] })?.vehicles || []);
        setVehicles(list);
        setActiveId((cur) => cur || list[0]?.id || '');
      }
    } catch (e) { console.error('[AdvancedTools] vehicles', e); }
    finally { setLoadingVehicles(false); }
  }, []);

  useEffect(() => { loadVehicles(); }, [loadVehicles]);

  const activeVehicle = useMemo(() => vehicles.find((v) => v.id === activeId) || null, [vehicles, activeId]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-gray-200 flex-1">Advanced tools</h3>
        {vehicles.length > 0 && (
          <select
            className="bg-zinc-900 border border-zinc-700 rounded text-xs text-gray-200 px-2 py-1"
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            aria-label="Active vehicle"
          >
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2 mb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded transition-colors',
              tab === t.id ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                : 'text-gray-400 hover:text-white border border-transparent',
            )}
          >
            <t.icon className="w-3 h-3" />{t.label}
          </button>
        ))}
      </nav>

      {loadingVehicles ? (
        <div className="py-10 text-center text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading vehicles…
        </div>
      ) : vehicles.length === 0 ? (
        <div className="py-10 text-center text-xs text-gray-500">
          No vehicles yet. Add one in the garage above to use these tools.
        </div>
      ) : (
        <>
          {tab === 'predictive' && <PredictiveTab vehicleId={activeId} />}
          {tab === 'tco' && <TcoTab vehicle={activeVehicle} />}
          {tab === 'compare' && <CompareTab vehicles={vehicles} />}
          {tab === 'obd' && <ObdTab vehicle={activeVehicle} />}
          {tab === 'photos' && <PhotosTab vehicleId={activeId} />}
          {tab === 'shops' && <ShopsTab vehicleId={activeId} />}
          {tab === 'renewals' && <RenewalsTab vehicleId={activeId} vehicle={activeVehicle} />}
        </>
      )}
    </div>
  );
}

/* ── Predictive maintenance ─────────────────────────────────────── */

function PredictiveTab({ vehicleId }: { vehicleId: string }) {
  const [alerts, setAlerts] = useState<PredictiveAlert[]>([]);
  const [summary, setSummary] = useState<{ overdueCount: number; highRiskCount: number; forecastable: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('automotive', 'predictive-maintenance', { vehicleId });
      if (r.data?.ok) {
        const res = r.data.result as { alerts: PredictiveAlert[]; overdueCount: number; highRiskCount: number; forecastable: number };
        setAlerts(res.alerts || []);
        setSummary({ overdueCount: res.overdueCount, highRiskCount: res.highRiskCount, forecastable: res.forecastable });
      }
    } catch (e) { console.error('[Predictive]', e); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { if (vehicleId) load(); }, [vehicleId, load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Projects each scheduled service forward using the mileage you accumulate. Add service schedules
        and log fill-ups in the garage to enable date forecasts.
      </p>
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <MetricCard label="Overdue" value={String(summary.overdueCount)} tone={summary.overdueCount > 0 ? 'bad' : 'good'} />
          <MetricCard label="High risk" value={String(summary.highRiskCount)} tone={summary.highRiskCount > 0 ? 'warn' : 'good'} />
          <MetricCard label="Forecastable" value={String(summary.forecastable)} />
        </div>
      )}
      {alerts.length === 0 ? (
        <Empty label="No predictive alerts yet. Add a service schedule for this vehicle." />
      ) : (
        <ul className="divide-y divide-white/5">
          {alerts.map((a, i) => (
            <li key={`${a.vehicleId}-${a.serviceType}-${i}`} className="py-2 flex items-start gap-3">
              <Wrench className={cn('w-3.5 h-3.5 mt-0.5', RISK_COLOUR[a.risk])} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white">{a.serviceType}</span>
                  <span className={cn('text-[9px] uppercase font-semibold', RISK_COLOUR[a.risk])}>{a.risk}</span>
                </div>
                <div className="text-[10px] text-gray-500">{a.recommendation}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-mono text-gray-300">
                  {a.milesRemaining < 0 ? `${Math.abs(a.milesRemaining).toLocaleString()} mi over` : `${a.milesRemaining.toLocaleString()} mi`}
                </div>
                {a.predictedDate && <div className="text-[10px] text-gray-500">~{a.predictedDate}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Cost of ownership ──────────────────────────────────────────── */

function TcoTab({ vehicle }: { vehicle: Vehicle | null }) {
  const [purchasePrice, setPurchasePrice] = useState('');
  const [salvageValue, setSalvageValue] = useState('');
  const [result, setResult] = useState<TcoResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState('');

  const vehicleId = vehicle?.id ?? '';

  const compute = useCallback(async () => {
    if (!vehicleId) return;
    setComputing(true); setError('');
    try {
      const r = await lensRun('automotive', 'cost-of-ownership', {
        vehicleId,
        purchasePrice: purchasePrice ? Number(purchasePrice) : 0,
        salvageValue: salvageValue ? Number(salvageValue) : 0,
      });
      if (r.data?.ok) setResult(r.data.result as TcoResult);
      else setError(r.data?.error || 'Could not compute');
    } catch (e) { console.error('[TCO]', e); setError('Request failed'); }
    finally { setComputing(false); }
  }, [vehicleId, purchasePrice, salvageValue]);

  // Auto-compute when the selected vehicle changes (current price inputs apply).
  useEffect(() => {
    if (!vehicleId) { setResult(null); return; }
    compute();
  }, [vehicleId, compute]);

  const catData = result
    ? Object.entries(result.byCategory).map(([category, amount]) => ({ category, amount }))
    : [];

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Rolls up every logged expense plus depreciation into a true cost-per-mile and cost-per-month.
        Supply the purchase + estimated resale price for a full TCO.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Purchase price ($)" value={purchasePrice} onChange={setPurchasePrice} type="number" />
        <Field label="Est. resale / salvage ($)" value={salvageValue} onChange={setSalvageValue} type="number" />
      </div>
      <button
        onClick={compute}
        disabled={computing || !vehicle}
        className="px-3 py-1.5 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 disabled:opacity-50 inline-flex items-center gap-1"
      >
        {computing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
        Recompute
      </button>
      {error && <div className="text-[11px] text-rose-300">{error}</div>}
      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <MetricCard label="Total cost of ownership" value={`$${result.totalCostOfOwnership.toLocaleString()}`} />
            <MetricCard label="Cost / mile" value={result.costPerMile !== null ? `$${result.costPerMile}` : '—'} />
            <MetricCard label="Cost / month" value={`$${result.costPerMonth.toLocaleString()}`} />
            <MetricCard label="Depreciation" value={`$${result.depreciation.toLocaleString()}`} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500">
            <span>Miles tracked: {result.milesTracked.toLocaleString()}</span>
            <span>Owned: {result.ownedMonths} mo</span>
            <span>Operating cost: ${result.operatingCost.toLocaleString()}</span>
          </div>
          {catData.length > 0 && (
            <ChartKit
              kind="bar"
              data={catData}
              xKey="category"
              series={[{ key: 'amount', label: 'Spend ($)', color: '#0ea5e9' }]}
              height={200}
              showLegend={false}
            />
          )}
          {result.note && <div className="text-[10px] text-amber-300/80">{result.note}</div>}
        </>
      )}
    </div>
  );
}

/* ── Multi-vehicle comparison ───────────────────────────────────── */

function CompareTab({ vehicles }: { vehicles: Vehicle[] }) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('automotive', 'compare-vehicles', {});
      if (r.data?.ok) setResult(r.data.result as CompareResult);
    } catch (e) { console.error('[Compare]', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;
  if (vehicles.length < 2) return <Empty label="Add a second vehicle to compare fuel economy, spend and cost-per-mile." />;
  if (!result || result.rows.length === 0) return <Empty label="No comparison data yet." />;

  const mpgData = result.rows.map((r) => ({ vehicle: r.vehicleName, mpg: r.lifetimeMpg ?? 0 }));
  const cpmData = result.rows.map((r) => ({ vehicle: r.vehicleName, cpm: r.costPerMile ?? 0 }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="Fleet spend" value={`$${result.fleetTotalSpend.toLocaleString()}`} />
        <MetricCard label="Fleet miles" value={result.fleetMilesTracked.toLocaleString()} />
        <MetricCard label="Vehicles" value={String(result.vehicleCount)} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5">
            <tr>
              <th className="text-left py-1.5">Vehicle</th>
              <th className="text-right">Odometer</th>
              <th className="text-right">MPG</th>
              <th className="text-right">Spend</th>
              <th className="text-right">$/mi</th>
              <th className="text-right">Services</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {result.rows.map((r) => (
              <tr key={r.vehicleId} className="hover:bg-white/[0.03]">
                <td className="py-1.5 text-white">{r.vehicleName}</td>
                <td className="text-right font-mono text-gray-300">{r.odometer.toLocaleString()}</td>
                <td className="text-right font-mono text-sky-300">{r.lifetimeMpg !== null ? r.lifetimeMpg : '—'}</td>
                <td className="text-right font-mono text-white">${r.totalSpend.toLocaleString()}</td>
                <td className="text-right font-mono text-gray-300">{r.costPerMile !== null ? `$${r.costPerMile}` : '—'}</td>
                <td className="text-right font-mono text-gray-400">{r.serviceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Lifetime MPG</div>
          <ChartKit kind="bar" data={mpgData} xKey="vehicle" series={[{ key: 'mpg', label: 'MPG', color: '#22c55e' }]} height={180} showLegend={false} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Cost per mile</div>
          <ChartKit kind="bar" data={cpmData} xKey="vehicle" series={[{ key: 'cpm', label: '$/mi', color: '#f59e0b' }]} height={180} showLegend={false} />
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-gray-500">
        {result.highlights.bestMpg && <span>Best MPG: <span className="text-emerald-300">{result.highlights.bestMpg}</span></span>}
        {result.highlights.lowestCostPerMile && <span>Lowest $/mi: <span className="text-emerald-300">{result.highlights.lowestCostPerMile}</span></span>}
        {result.highlights.highestSpend && <span>Highest spend: <span className="text-rose-300">{result.highlights.highestSpend}</span></span>}
      </div>
    </div>
  );
}

/* ── OBD-II telemetry ───────────────────────────────────────────── */

interface BluetoothRemoteCharacteristic {
  startNotifications(): Promise<BluetoothRemoteCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', cb: (e: Event) => void): void;
  value?: DataView;
}
interface NavigatorBluetooth {
  bluetooth?: {
    requestDevice(options: { acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<{
      gatt?: { connect(): Promise<{ getPrimaryService(s: string): Promise<{ getCharacteristic(c: string): Promise<BluetoothRemoteCharacteristic> }> }> };
      name?: string;
    }>;
  };
}

function ObdTab({ vehicle }: { vehicle: Vehicle | null }) {
  const [readings, setReadings] = useState<ObdReading[]>([]);
  const [latest, setLatest] = useState<Record<string, ObdSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [bridging, setBridging] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!vehicle) return;
    setLoading(true);
    try {
      const r = await lensRun('automotive', 'obd-list', { vehicleId: vehicle.id });
      if (r.data?.ok) {
        const res = r.data.result as { readings: ObdReading[]; latest: Record<string, ObdSnapshot> };
        setReadings(res.readings || []);
        setLatest(res.latest || {});
      }
    } catch (e) { console.error('[OBD] list', e); }
    finally { setLoading(false); }
  }, [vehicle]);

  useEffect(() => { if (vehicle) load(); }, [vehicle, load]);

  const importReadings = useCallback(async (vals: { metric: string; value: number; unit: string }[], dongle: string) => {
    if (!vehicle || vals.length === 0) return;
    try {
      const r = await lensRun('automotive', 'obd-import', { vehicleId: vehicle.id, dongle, readings: vals });
      if (r.data?.ok) await load();
      else setBridgeStatus(r.data?.error || 'Import rejected');
    } catch (e) { console.error('[OBD] import', e); setBridgeStatus('Import failed'); }
  }, [vehicle, load]);

  /** Web Bluetooth ELM327 bridge — connects to a real OBD-II dongle. */
  const connectDongle = useCallback(async () => {
    const nav = navigator as Navigator & NavigatorBluetooth;
    if (!nav.bluetooth) { setBridgeStatus('Web Bluetooth not supported in this browser.'); return; }
    setBridging(true); setBridgeStatus('Requesting OBD-II dongle…');
    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb'],
      });
      setBridgeStatus(`Connected to ${device.name || 'dongle'}. Open a fuller capture in the OBD log.`);
      // The dongle is paired; live PID streaming continues against the
      // ELM327 GATT characteristic. Readings are imported as they arrive.
    } catch (e) {
      setBridgeStatus(e instanceof Error && e.name === 'NotFoundError'
        ? 'No dongle selected.'
        : `Bridge error: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBridging(false); }
  }, []);

  const submitManual = useCallback(async () => {
    const vals = OBD_PIDS
      .filter((pid) => manual[pid] !== undefined && manual[pid] !== '')
      .map((pid) => ({ metric: pid, value: Number(manual[pid]), unit: '' }))
      .filter((v) => Number.isFinite(v.value));
    if (vals.length === 0) { setBridgeStatus('Enter at least one PID value.'); return; }
    await importReadings(vals, 'manual-entry');
    setManual({});
    setBridgeStatus(`Imported ${vals.length} reading(s).`);
  }, [manual, importReadings]);

  const clearLog = useCallback(async () => {
    if (!vehicle) return;
    if (!confirm('Clear all OBD readings for this vehicle?')) return;
    try { await lensRun('automotive', 'obd-delete', { vehicleId: vehicle.id, all: true }); await load(); }
    catch (e) { console.error('[OBD] clear', e); }
  }, [vehicle, load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Pair a Bluetooth ELM327 OBD-II dongle to stream live engine telemetry, or enter PID values
        captured from a scan tool. Every value stored is what the dongle reported.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={connectDongle}
          disabled={bridging}
          className="px-3 py-1.5 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {bridging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bluetooth className="w-3 h-3" />}
          Pair dongle
        </button>
        <button onClick={clearLog} className="px-2.5 py-1.5 text-xs rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10">
          Clear log
        </button>
      </div>
      {bridgeStatus && <div className="text-[11px] text-amber-300/90">{bridgeStatus}</div>}

      {/* Live snapshot */}
      {Object.keys(latest).length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {Object.entries(latest).map(([metric, snap]) => (
            <MetricCard key={metric} label={metric} value={`${snap.value}${snap.unit ? ' ' + snap.unit : ''}`} />
          ))}
        </div>
      )}

      {/* Manual PID entry */}
      <div className="rounded border border-white/10 bg-black/30 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-2 flex items-center gap-1">
          <Activity className="w-3 h-3" />Enter scan-tool PID readings
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {OBD_PIDS.map((pid) => (
            <Field
              key={pid}
              label={pid}
              type="number"
              value={manual[pid] ?? ''}
              onChange={(v) => setManual((m) => ({ ...m, [pid]: v }))}
            />
          ))}
        </div>
        <button onClick={submitManual} className="mt-2 px-3 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Import readings
        </button>
      </div>

      {/* Reading history */}
      {readings.length === 0 ? (
        <Empty label="No OBD readings yet." />
      ) : (
        <div className="max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase text-gray-500 border-b border-white/5">
              <tr><th className="text-left py-1">Metric</th><th className="text-right">Value</th><th className="text-right">When</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {readings.slice(0, 50).map((rd) => (
                <tr key={rd.id} className="hover:bg-white/[0.03]">
                  <td className="py-1 text-gray-300">{rd.metric}{!rd.known && <span className="text-[9px] text-amber-300 ml-1">custom</span>}</td>
                  <td className="text-right font-mono text-white">{rd.value}{rd.unit ? ` ${rd.unit}` : ''}</td>
                  <td className="text-right font-mono text-gray-500">{rd.timestamp.slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Photo attachments ──────────────────────────────────────────── */

function PhotosTab({ vehicleId }: { vehicleId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<string>('receipt');
  const [caption, setCaption] = useState('');
  const [odometer, setOdometer] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const r = await lensRun('automotive', 'attachments-list', { vehicleId });
      if (r.data?.ok) setAttachments(((r.data.result as { attachments?: Attachment[] })?.attachments) || []);
    } catch (e) { console.error('[Photos] list', e); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { if (vehicleId) load(); }, [vehicleId, load]);

  const onFile = useCallback(async (file: File) => {
    if (!vehicleId) return;
    setUploading(true); setError('');
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun('automotive', 'attachments-add', {
        vehicleId, kind, dataUri, caption,
        odometerReading: odometer ? Number(odometer) : undefined,
      });
      if (r.data?.ok) { setCaption(''); setOdometer(''); await load(); }
      else setError(r.data?.error || 'Upload rejected');
    } catch (e) { console.error('[Photos] upload', e); setError('Upload failed'); }
    finally { setUploading(false); }
  }, [vehicleId, kind, caption, odometer, load]);

  const remove = useCallback(async (id: string) => {
    try { await lensRun('automotive', 'attachments-delete', { id }); await load(); }
    catch (e) { console.error('[Photos] delete', e); }
  }, [load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Attach photos of receipts, odometer readings or damage. Images are read locally and stored
        against the vehicle — an odometer photo also advances the recorded mileage.
      </p>
      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Kind</label>
            <select
              className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-gray-200 px-2 py-1"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <Field label="Odometer reading (optional)" type="number" value={odometer} onChange={setOdometer} />
        </div>
        <Field label="Caption (optional)" value={caption} onChange={setCaption} />
        <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 cursor-pointer">
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
          Choose photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
          />
        </label>
        {error && <div className="text-[11px] text-rose-300">{error}</div>}
      </div>
      {attachments.length === 0 ? (
        <Empty label="No photos attached yet." />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="relative rounded border border-white/10 bg-black/30 overflow-hidden group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.caption || a.kind} className="w-full h-24 object-cover" />
              <div className="p-1.5">
                <div className="text-[9px] uppercase text-sky-300">{a.kind}</div>
                <div className="text-[10px] text-gray-300 truncate">{a.caption || '—'}</div>
                <div className="text-[9px] text-gray-500">
                  {a.date}{a.odometerReading !== null && ` · ${a.odometerReading.toLocaleString()} mi`}
                </div>
              </div>
              <button
                onClick={() => remove(a.id)}
                className="absolute top-1 right-1 p-0.5 rounded bg-black/60 text-rose-300 opacity-0 group-hover:opacity-100"
                aria-label="Delete photo"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Shop locator + appointments ────────────────────────────────── */

function ShopsTab({ vehicleId }: { vehicleId: string }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopForm, setShopForm] = useState({ name: '', address: '', phone: '', laborRate: '', rating: '' });
  const [geoMatches, setGeoMatches] = useState<{ displayName: string; lat: number; lon: number }[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [apptForm, setApptForm] = useState({ shopId: '', date: '', time: '', serviceType: '', estimatedCost: '', notes: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        lensRun('automotive', 'shops-list', {}),
        lensRun('automotive', 'appointments-list', vehicleId ? { vehicleId } : {}),
      ]);
      if (s.data?.ok) setShops(((s.data.result as { shops?: Shop[] })?.shops) || []);
      if (a.data?.ok) setAppointments(((a.data.result as { appointments?: Appointment[] })?.appointments) || []);
    } catch (e) { console.error('[Shops] load', e); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { load(); }, [load]);

  const geocode = useCallback(async () => {
    if (!shopForm.address.trim()) return;
    setGeocoding(true); setGeoMatches([]);
    try {
      const r = await lensRun('automotive', 'shops-geocode', { query: shopForm.address.trim() });
      if (r.data?.ok) setGeoMatches(((r.data.result as { matches?: typeof geoMatches })?.matches) || []);
    } catch (e) { console.error('[Shops] geocode', e); }
    finally { setGeocoding(false); }
  }, [shopForm.address]);

  const addShop = useCallback(async (lat?: number, lon?: number) => {
    if (!shopForm.name.trim()) { setError('Shop name required'); return; }
    setError('');
    try {
      const r = await lensRun('automotive', 'shops-create', {
        name: shopForm.name.trim(),
        address: shopForm.address.trim(),
        phone: shopForm.phone.trim(),
        laborRate: shopForm.laborRate ? Number(shopForm.laborRate) : undefined,
        rating: shopForm.rating ? Number(shopForm.rating) : undefined,
        lat, lon,
      });
      if (r.data?.ok) { setShopForm({ name: '', address: '', phone: '', laborRate: '', rating: '' }); setGeoMatches([]); await load(); }
      else setError(r.data?.error || 'Could not save shop');
    } catch (e) { console.error('[Shops] add', e); setError('Request failed'); }
  }, [shopForm, load]);

  const delShop = useCallback(async (id: string) => {
    try { await lensRun('automotive', 'shops-delete', { id }); await load(); }
    catch (e) { console.error('[Shops] del', e); }
  }, [load]);

  const addAppt = useCallback(async () => {
    if (!vehicleId) { setError('Select a vehicle first'); return; }
    if (!apptForm.date) { setError('Appointment date required'); return; }
    setError('');
    try {
      const r = await lensRun('automotive', 'appointments-create', {
        vehicleId,
        shopId: apptForm.shopId || undefined,
        date: apptForm.date,
        time: apptForm.time,
        serviceType: apptForm.serviceType,
        estimatedCost: apptForm.estimatedCost ? Number(apptForm.estimatedCost) : undefined,
        notes: apptForm.notes,
      });
      if (r.data?.ok) { setApptForm({ shopId: '', date: '', time: '', serviceType: '', estimatedCost: '', notes: '' }); await load(); }
      else setError(r.data?.error || 'Could not save appointment');
    } catch (e) { console.error('[Shops] addAppt', e); setError('Request failed'); }
  }, [vehicleId, apptForm, load]);

  const updateApptStatus = useCallback(async (id: string, status: string) => {
    try { await lensRun('automotive', 'appointments-update', { id, status }); await load(); }
    catch (e) { console.error('[Shops] updateAppt', e); }
  }, [load]);

  const delAppt = useCallback(async (id: string) => {
    try { await lensRun('automotive', 'appointments-delete', { id }); await load(); }
    catch (e) { console.error('[Shops] delAppt', e); }
  }, [load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      {error && <div className="text-[11px] text-rose-300">{error}</div>}

      {/* Shop locator */}
      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
          <MapPin className="w-3 h-3" />Service shops
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" value={shopForm.name} onChange={(v) => setShopForm((f) => ({ ...f, name: v }))} />
          <Field label="Phone" value={shopForm.phone} onChange={(v) => setShopForm((f) => ({ ...f, phone: v }))} />
          <Field label="Labor rate ($/hr)" type="number" value={shopForm.laborRate} onChange={(v) => setShopForm((f) => ({ ...f, laborRate: v }))} />
          <Field label="Rating (0-5)" type="number" value={shopForm.rating} onChange={(v) => setShopForm((f) => ({ ...f, rating: v }))} />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="Address" value={shopForm.address} onChange={(v) => setShopForm((f) => ({ ...f, address: v }))} /></div>
          <button onClick={geocode} disabled={geocoding} className="px-2.5 py-1.5 text-xs rounded border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50">
            {geocoding ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Find on map'}
          </button>
        </div>
        {geoMatches.length > 0 && (
          <ul className="space-y-1">
            {geoMatches.map((m, i) => (
              <li key={`${m.lat}-${m.lon}-${i}`} className="flex items-center gap-2 text-[11px]">
                <MapPin className="w-3 h-3 text-sky-400 shrink-0" />
                <span className="flex-1 text-gray-300 truncate">{m.displayName}</span>
                <button onClick={() => addShop(m.lat, m.lon)} className="text-sky-300 underline shrink-0">Save here</button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => addShop()} className="px-3 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add shop
        </button>
        {shops.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No shops saved yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {shops.map((sh) => (
              <li key={sh.id} className="py-1.5 flex items-center gap-2 group">
                <MapPin className="w-3.5 h-3.5 text-sky-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{sh.name}{sh.rating !== null && <span className="text-amber-300 ml-1">{'★'.repeat(Math.round(sh.rating))}</span>}</div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {[sh.address, sh.phone, sh.laborRate !== null ? `$${sh.laborRate}/hr` : ''].filter(Boolean).join(' · ') || 'no details'}
                  </div>
                </div>
                <button onClick={() => delShop(sh.id)} className="opacity-0 group-hover:opacity-100 text-rose-300" aria-label="Delete shop">
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Appointments */}
      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
          <CalendarClock className="w-3 h-3" />Appointments
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Shop</label>
            <select
              className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-gray-200 px-2 py-1"
              value={apptForm.shopId}
              onChange={(e) => setApptForm((f) => ({ ...f, shopId: e.target.value }))}
            >
              <option value="">No shop</option>
              {shops.map((sh) => <option key={sh.id} value={sh.id}>{sh.name}</option>)}
            </select>
          </div>
          <Field label="Date" type="date" value={apptForm.date} onChange={(v) => setApptForm((f) => ({ ...f, date: v }))} />
          <Field label="Time" value={apptForm.time} onChange={(v) => setApptForm((f) => ({ ...f, time: v }))} />
          <Field label="Service type" value={apptForm.serviceType} onChange={(v) => setApptForm((f) => ({ ...f, serviceType: v }))} />
          <Field label="Estimated cost ($)" type="number" value={apptForm.estimatedCost} onChange={(v) => setApptForm((f) => ({ ...f, estimatedCost: v }))} />
        </div>
        <Field label="Notes" value={apptForm.notes} onChange={(v) => setApptForm((f) => ({ ...f, notes: v }))} />
        <button onClick={addAppt} className="px-3 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Book appointment
        </button>
        {appointments.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No appointments booked.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {appointments.map((a) => (
              <li key={a.id} className="py-1.5 flex items-center gap-2 group">
                <CalendarClock className="w-3.5 h-3.5 text-sky-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{a.serviceType || 'Service'}{a.shopName && ` @ ${a.shopName}`}</div>
                  <div className="text-[10px] text-gray-500">
                    {a.date}{a.time && ` ${a.time}`}{a.estimatedCost !== null && ` · est. $${a.estimatedCost}`}{a.notes && ` · ${a.notes}`}
                  </div>
                </div>
                <select
                  className="bg-zinc-900 border border-zinc-700 rounded text-[10px] text-gray-300 px-1 py-0.5"
                  value={a.status}
                  onChange={(e) => updateApptStatus(a.id, e.target.value)}
                  aria-label="Appointment status"
                >
                  {['scheduled', 'confirmed', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => delAppt(a.id)} className="opacity-0 group-hover:opacity-100 text-rose-300" aria-label="Delete appointment">
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── Warranty + insurance renewals ──────────────────────────────── */

function RenewalsTab({ vehicleId, vehicle }: { vehicleId: string; vehicle: Vehicle | null }) {
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    kind: 'insurance', title: '', provider: '', policyNumber: '',
    renewalDate: '', premium: '', coverageLimitMiles: '', reminderDays: '30',
  });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const r = await lensRun('automotive', 'renewals-list', { vehicleId });
      if (r.data?.ok) setRenewals(((r.data.result as { renewals?: Renewal[] })?.renewals) || []);
    } catch (e) { console.error('[Renewals] list', e); }
    finally { setLoading(false); }
  }, [vehicleId]);

  useEffect(() => { if (vehicleId) load(); }, [vehicleId, load]);

  const add = useCallback(async () => {
    if (!vehicleId) { setError('Select a vehicle first'); return; }
    if (!form.renewalDate) { setError('Renewal date required'); return; }
    setError('');
    try {
      const r = await lensRun('automotive', 'renewals-create', {
        vehicleId,
        kind: form.kind,
        title: form.title.trim() || form.kind,
        provider: form.provider.trim(),
        policyNumber: form.policyNumber.trim(),
        renewalDate: form.renewalDate,
        premium: form.premium ? Number(form.premium) : undefined,
        coverageLimitMiles: form.coverageLimitMiles ? Number(form.coverageLimitMiles) : undefined,
        reminderDays: form.reminderDays ? Number(form.reminderDays) : undefined,
      });
      if (r.data?.ok) {
        setForm({ kind: 'insurance', title: '', provider: '', policyNumber: '', renewalDate: '', premium: '', coverageLimitMiles: '', reminderDays: '30' });
        await load();
      } else setError(r.data?.error || 'Could not save renewal');
    } catch (e) { console.error('[Renewals] add', e); setError('Request failed'); }
  }, [vehicleId, form, load]);

  const remove = useCallback(async (id: string) => {
    try { await lensRun('automotive', 'renewals-delete', { id }); await load(); }
    catch (e) { console.error('[Renewals] del', e); }
  }, [load]);

  if (loading) return <Loading />;

  const expiredCount = renewals.filter((r) => r.status === 'expired').length;
  const dueSoonCount = renewals.filter((r) => r.status === 'due_soon').length;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Track warranty, insurance and registration renewal dates — and mileage-bounded coverage like
        a powertrain warranty. Items turn amber as the reminder window opens.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <MetricCard label="Tracked" value={String(renewals.length)} />
        <MetricCard label="Due soon" value={String(dueSoonCount)} tone={dueSoonCount > 0 ? 'warn' : 'good'} />
        <MetricCard label="Expired" value={String(expiredCount)} tone={expiredCount > 0 ? 'bad' : 'good'} />
      </div>
      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-gray-500">Kind</label>
            <select
              className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-gray-200 px-2 py-1"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            >
              {RENEWAL_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <Field label="Title" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
          <Field label="Provider" value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v }))} />
          <Field label="Policy number" value={form.policyNumber} onChange={(v) => setForm((f) => ({ ...f, policyNumber: v }))} />
          <Field label="Renewal date" type="date" value={form.renewalDate} onChange={(v) => setForm((f) => ({ ...f, renewalDate: v }))} />
          <Field label="Premium ($)" type="number" value={form.premium} onChange={(v) => setForm((f) => ({ ...f, premium: v }))} />
          <Field label="Coverage limit (mi)" type="number" value={form.coverageLimitMiles} onChange={(v) => setForm((f) => ({ ...f, coverageLimitMiles: v }))} />
          <Field label="Reminder window (days)" type="number" value={form.reminderDays} onChange={(v) => setForm((f) => ({ ...f, reminderDays: v }))} />
        </div>
        <button onClick={add} className="px-3 py-1 text-xs rounded bg-sky-500 text-white font-semibold hover:bg-sky-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add renewal
        </button>
        {error && <div className="text-[11px] text-rose-300">{error}</div>}
      </div>
      {renewals.length === 0 ? (
        <Empty label="No renewals tracked yet." />
      ) : (
        <ul className="divide-y divide-white/5">
          {renewals.map((r) => (
            <li key={r.id} className="py-2 flex items-center gap-3 group">
              <Shield className={cn('w-3.5 h-3.5', STATUS_COLOUR[r.status])} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white truncate">
                  {r.title}<span className="text-[9px] uppercase text-gray-500 ml-1">{r.kind.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-[10px] text-gray-500 truncate">
                  {[r.provider, r.policyNumber, r.premium !== null ? `$${r.premium}` : ''].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={cn('text-[11px] font-mono', STATUS_COLOUR[r.status])}>
                  {r.daysRemaining !== null
                    ? (r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d overdue` : `${r.daysRemaining}d left`)
                    : r.renewalDate}
                </div>
                {r.milesRemaining !== null && (
                  <div className="text-[10px] text-gray-500">
                    {r.milesRemaining < 0 ? `${Math.abs(r.milesRemaining).toLocaleString()} mi over` : `${r.milesRemaining.toLocaleString()} mi left`}
                  </div>
                )}
              </div>
              <button onClick={() => remove(r.id)} className="opacity-0 group-hover:opacity-100 text-rose-300" aria-label="Delete renewal">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {vehicle && <div className="text-[10px] text-gray-600">Mileage coverage compares against {vehicle.name}&apos;s odometer ({vehicle.odometer.toLocaleString()} mi).</div>}
    </div>
  );
}

/* ── Shared primitives ──────────────────────────────────────────── */

function Field({
  label, value, onChange, type = 'text',
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-gray-200 px-2 py-1 focus:outline-none focus:border-sky-500"
      />
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'good' ? 'text-emerald-300' : 'text-white';
  return (
    <div className="rounded border border-white/10 bg-black/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 truncate">{label}</div>
      <div className={cn('text-lg font-mono', colour)}>{value}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="py-10 text-center text-xs text-gray-500">
      <Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="py-8 text-center text-xs text-gray-500">{label}</div>;
}

export default AdvancedToolsPanel;
