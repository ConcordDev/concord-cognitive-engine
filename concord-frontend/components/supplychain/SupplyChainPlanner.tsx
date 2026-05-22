'use client';

/**
 * SupplyChainPlanner — SAP-IBP-parity planning workbench.
 *
 * Wires the STATE-backed `supplychain` planning macros:
 *  - Shipment tracking (shipmentCreate / shipmentCheckpoint / shipmentList / shipmentDelete)
 *  - Supply network / BOM graph (networkSet / networkGraph)
 *  - Multi-echelon inventory optimization (multiEchelonOptimize)
 *  - What-if scenario planning (scenarioSimulate / scenarioList / scenarioDelete)
 *  - Seasonal forecasting (seasonalForecast)
 *  - Exception management (exceptionScan)
 *  - Order→PO→receipt workflow (workOrderCreate / workOrderAdvance / workOrderList / workOrderDelete)
 *  - Spend analytics (spendAnalytics)
 *
 * Every rendered value comes from a real macro call. No mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Ship, Network, Layers, FlaskConical, TrendingUp, AlertTriangle,
  ClipboardList, DollarSign, Loader2, Plus, Trash2, ArrowRight, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView, TreeDiagram, MapView } from '@/components/viz';
import type { TreeNode, TimelineEvent, MapMarker } from '@/components/viz';
import { cn } from '@/lib/utils';

/* ──────────────────────────── shared types ─────────────────────────── */

type PlannerTab =
  | 'shipments' | 'network' | 'echelon' | 'scenario'
  | 'forecast' | 'exceptions' | 'workorders' | 'spend';

interface Shipment {
  id: string; reference: string; carrier: string; trackingNumber: string;
  origin: string; destination: string; status: string; value: number;
  plannedEtaDays: number; createdAt: number; etaAt: number; deliveredAt?: number;
  etaDriftDays: number; late: boolean; health: string;
  checkpoints: { at: number; status: string; location: string }[];
  route: MapMarker[];
}
interface ShipmentList { shipments: Shipment[]; inTransit: number; delivered: number; delayed: number }

interface NetworkGraph {
  tree: TreeNode[]; markers: MapMarker[];
  counts: { supplier: number; factory: number; warehouse: number; customer: number };
  edgeCount: number; criticalLeadTime: number; orphans: string[];
}

interface Echelon {
  location: string; tier: string; dailyDemand: number; leadTimeDays: number;
  currentStock: number; cycleStock: number; safetyStock: number; reorderPoint: number;
  targetStock: number; daysOfStock: number; imbalance: number; needsReplenish: boolean;
}
interface EchelonResult {
  echelons: Echelon[]; totalSafetyStock: number; totalTargetStock: number;
  needsReplenish: number; rebalanceTransfers: { from: string; to: string; units: number }[];
  serviceLevelZ: number; message?: string;
}

interface ScenarioOption {
  source: string; effectiveLeadTimeDays: number; effectiveUnitCost: number;
  demandDuringLead: number; projectedStockoutUnits: number; daysToStockout: number;
  replenishCost: number; stocksOut: boolean;
}
interface Scenario {
  id: string; name: string; disruption: string; baseDemand: number;
  baseLeadTime: number; baseUnitCost: number; onHand: number;
  options: ScenarioOption[]; recommendation: string; resilient: boolean; createdAt: number;
}

interface ForecastPt { period: string; predicted: number; confidence: string }
interface SeasonalResult {
  method: string; seasonLength: number; alpha: number; beta: number; gamma: number;
  mapePct: number; accuracy: string; trend: string; seasonalIndices: number[];
  fitted: number[]; forecast: ForecastPt[]; message?: string;
}

interface ExceptionAlert {
  id: string; severity: string; kind: string; subject: string; message: string; detail: string;
}
interface ExceptionResult {
  alerts: ExceptionAlert[]; critical: number; warning: number; byKind: Record<string, number>;
}

interface WorkOrder {
  id: string; poNumber: string; item: string; supplier: string; quantity: number;
  unitCost: number; totalCost: number; stage: string; createdAt: number; dueAt: number;
  receivedQty: number; overdue: boolean; progressPct: number;
  history: { at: number; stage: string }[];
}
interface WorkOrderList {
  workOrders: WorkOrder[]; byStage: Record<string, number>; stages: string[];
  openValue: number; overdueCount: number;
}

interface SpendRow { name: string; amount: number; sharePct: number }
interface SpendResult {
  totalSpend: number; lineItems: number; supplierCount: number;
  bySupplier: SpendRow[]; byCategory: SpendRow[]; topSupplier: SpendRow | null;
  avgLineItem: number; paretoSupplierCount: number; paretoConcentration: number;
  message?: string;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

/* ─────────────────────────── macro helper ──────────────────────────── */

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('supplychain', action, input);
  if (!r.data?.ok) throw new Error(r.data?.error || `${action} failed`);
  return r.data.result;
}

function num(v: string, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }
function parseNumberList(text: string): number[] {
  return text.split(/[\s,]+/).map((t) => Number(t)).filter((n) => Number.isFinite(n));
}

/* ─────────────────────────── small atoms ───────────────────────────── */

const INPUT = 'w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white';
const LABEL = 'text-[9px] uppercase tracking-wider text-zinc-500 font-semibold';
const BTN = 'flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
      <div className={LABEL}>{label}</div>
      <div className={cn('text-lg font-bold', tone || 'text-white')}>{value}</div>
    </div>
  );
}

/* ───────────────────────── 1. Shipments ────────────────────────────── */

function ShipmentsPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [data, setData] = useState<ShipmentList | null>(null);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState(''); const [carrier, setCarrier] = useState('');
  const [origin, setOrigin] = useState(''); const [dest, setDest] = useState('');
  const [eta, setEta] = useState(''); const [value, setValue] = useState('');

  const load = useCallback(async () => {
    try { setData(await run<ShipmentList>('shipmentList')); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!ref.trim() && !origin.trim()) { notify({ kind: 'err', text: 'Enter a reference or origin.' }); return; }
    setBusy(true);
    try {
      await run('shipmentCreate', {
        reference: ref, carrier, origin, destination: dest,
        plannedEtaDays: num(eta, 14), value: num(value),
      });
      setRef(''); setCarrier(''); setOrigin(''); setDest(''); setEta(''); setValue('');
      await load(); notify({ kind: 'ok', text: 'Shipment booked.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const checkpoint = async (id: string, status: string, location: string) => {
    try { await run('shipmentCheckpoint', { shipmentId: id, status, location }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  };
  const del = async (id: string) => {
    try { await run('shipmentDelete', { shipmentId: id }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  };

  const STATUSES = ['picked_up', 'in_transit', 'customs', 'out_for_delivery', 'delivered', 'exception'];
  const allMarkers: MapMarker[] = (data?.shipments || []).flatMap((s) => s.route);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="In transit" value={data?.inTransit ?? 0} tone="text-blue-300" />
        <Stat label="Delivered" value={data?.delivered ?? 0} tone="text-emerald-300" />
        <Stat label="Delayed" value={data?.delayed ?? 0} tone="text-rose-300" />
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 grid grid-cols-2 md:grid-cols-3 gap-2">
        <div><div className={LABEL}>Reference</div><input className={INPUT} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        <div><div className={LABEL}>Carrier</div><input className={INPUT} value={carrier} onChange={(e) => setCarrier(e.target.value)} /></div>
        <div><div className={LABEL}>Cargo value</div><input className={INPUT} type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        <div><div className={LABEL}>Origin</div><input className={INPUT} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="e.g. Shanghai" /></div>
        <div><div className={LABEL}>Destination</div><input className={INPUT} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="e.g. Los Angeles" /></div>
        <div><div className={LABEL}>Planned ETA (days)</div><input className={INPUT} type="number" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
        <button onClick={create} disabled={busy} className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-500 col-span-2 md:col-span-1 justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Book shipment
        </button>
      </div>

      {allMarkers.length > 0 && (
        <div>
          <div className={cn(LABEL, 'mb-1')}>Live route map</div>
          <MapView markers={allMarkers} height={220} />
        </div>
      )}

      <div className="space-y-2">
        {(data?.shipments || []).map((s) => (
          <div key={s.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-blue-400" />
                <span className="text-[12px] font-semibold text-white">{s.reference}</span>
                <span className="text-[10px] text-zinc-500">{s.carrier}</span>
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase',
                  s.health === 'delivered' ? 'bg-emerald-500/20 text-emerald-300'
                    : s.health === 'delayed' ? 'bg-amber-500/20 text-amber-300'
                      : s.health === 'exception' ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-blue-500/20 text-blue-300')}>{s.status.replace(/_/g, ' ')}</span>
              </div>
              <button onClick={() => del(s.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete shipment"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {s.origin || '?'} <ArrowRight className="inline w-2.5 h-2.5" /> {s.destination || '?'}
              {s.etaDriftDays !== 0 && (
                <span className={cn('ml-2 font-mono', s.etaDriftDays > 0 ? 'text-rose-300' : 'text-emerald-300')}>
                  {s.etaDriftDays > 0 ? `+${s.etaDriftDays}d late` : `${s.etaDriftDays}d early`}
                </span>
              )}
            </div>
            {s.checkpoints.length > 0 && (
              <div className="mt-1.5">
                <TimelineView height={88} events={s.checkpoints.map((c, i): TimelineEvent => ({
                  id: `${s.id}_${i}`, label: c.status.replace(/_/g, ' '), time: c.at,
                  detail: c.location, tone: c.status === 'delivered' ? 'good' : c.status === 'exception' ? 'bad' : 'info',
                }))} />
              </div>
            )}
            {s.status !== 'delivered' && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {STATUSES.map((st) => (
                  <button key={st} onClick={() => checkpoint(s.id, st, st === 'delivered' ? s.destination : 'in transit')}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 hover:bg-zinc-700 hover:text-white">
                    {st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {data && data.shipments.length === 0 && <p className="text-[11px] text-zinc-600 py-3 text-center">No shipments tracked yet.</p>}
      </div>
    </div>
  );
}

/* ───────────────────────── 2. Network / BOM ────────────────────────── */

function NetworkPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [graph, setGraph] = useState<NetworkGraph | null>(null);
  const [busy, setBusy] = useState(false);
  const [nodesText, setNodesText] = useState('');
  const [edgesText, setEdgesText] = useState('');

  const load = useCallback(async () => {
    try { setGraph(await run<NetworkGraph>('networkGraph')); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // Each node line:  id | label | kind(supplier/factory/warehouse/customer) | location | capacity
  // Each edge line:  fromId > toId | leadTimeDays | volume
  const save = async () => {
    const nodes = nodesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [id, label, kind, location, capacity] = l.split('|').map((x) => x.trim());
      return { id, label, kind, location, capacity: Number(capacity) || 0 };
    });
    const edges = edgesText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [route, lt, vol] = l.split('|').map((x) => x.trim());
      const [from, to] = (route || '').split('>').map((x) => x.trim());
      return { from, to, leadTimeDays: Number(lt) || 7, volume: Number(vol) || 0 };
    });
    if (nodes.length === 0) { notify({ kind: 'err', text: 'Add at least one node.' }); return; }
    setBusy(true);
    try {
      const res = await run<{ nodeCount: number; edgeCount: number }>('networkSet', { nodes, edges });
      await load();
      notify({ kind: 'ok', text: `Network saved: ${res?.nodeCount} nodes, ${res?.edgeCount} edges.` });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 space-y-2">
        <div>
          <div className={LABEL}>Nodes — one per line: <span className="text-zinc-600 normal-case">id | label | kind | location | capacity</span></div>
          <textarea className={cn(INPUT, 'font-mono')} rows={4} value={nodesText} onChange={(e) => setNodesText(e.target.value)}
            placeholder={'s1 | Shenzhen Mill | supplier | Shenzhen | 5000\nw1 | LA DC | warehouse | Los Angeles | 8000\nc1 | West Retail | customer | San Francisco | 0'} />
        </div>
        <div>
          <div className={LABEL}>Edges — one per line: <span className="text-zinc-600 normal-case">fromId &gt; toId | leadTimeDays | volume</span></div>
          <textarea className={cn(INPUT, 'font-mono')} rows={3} value={edgesText} onChange={(e) => setEdgesText(e.target.value)}
            placeholder={'s1 > w1 | 21 | 4000\nw1 > c1 | 3 | 3500'} />
        </div>
        <button onClick={save} disabled={busy} className={cn(BTN, 'bg-indigo-600 text-white hover:bg-indigo-500')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />} Save network
        </button>
      </div>

      {graph && (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <Stat label="Suppliers" value={graph.counts.supplier} tone="text-indigo-300" />
            <Stat label="Factories" value={graph.counts.factory} tone="text-amber-300" />
            <Stat label="Warehouses" value={graph.counts.warehouse} tone="text-zinc-200" />
            <Stat label="Customers" value={graph.counts.customer} tone="text-emerald-300" />
            <Stat label="Edges" value={graph.edgeCount} />
            <Stat label="Critical lead" value={`${graph.criticalLeadTime}d`} tone="text-rose-300" />
          </div>
          {graph.orphans.length > 0 && (
            <div className="rounded-md border border-amber-700/50 bg-amber-950/30 px-2.5 py-1.5 text-[10px] text-amber-300">
              Disconnected nodes: {graph.orphans.join(', ')}
            </div>
          )}
          {graph.markers.length > 0 && (
            <div><div className={cn(LABEL, 'mb-1')}>Network geography</div><MapView markers={graph.markers} height={220} /></div>
          )}
          <div><div className={cn(LABEL, 'mb-1')}>Supplier → warehouse → customer flow</div>
            <TreeDiagram root={graph.tree} />
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────── 3. Multi-echelon inventory ───────────────────── */

function EchelonPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [result, setResult] = useState<EchelonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [zText, setZText] = useState('1.65');

  // line: location | tier | dailyDemand | leadTimeDays | currentStock | demandStdDev
  const optimize = async () => {
    const echelons = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [location, tier, dd, lt, cur, sd] = l.split('|').map((x) => x.trim());
      return {
        location, tier, dailyDemand: Number(dd) || 0, leadTimeDays: Number(lt) || 7,
        currentStock: Number(cur) || 0, demandStdDev: sd ? Number(sd) : undefined,
      };
    });
    if (echelons.length === 0) { notify({ kind: 'err', text: 'Add at least one echelon line.' }); return; }
    setBusy(true);
    try {
      setResult(await run<EchelonResult>('multiEchelonOptimize', { echelons, serviceLevelZ: num(zText, 1.65) }));
      notify({ kind: 'ok', text: 'Multi-echelon optimization complete.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 space-y-2">
        <div className={LABEL}>Echelons — one per line: <span className="text-zinc-600 normal-case">location | tier | dailyDemand | leadTimeDays | currentStock | demandStdDev</span></div>
        <textarea className={cn(INPUT, 'font-mono')} rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'LA DC | regional | 120 | 7 | 900 | 40\nDallas DC | regional | 80 | 5 | 250 | 25\nCentral Hub | central | 220 | 14 | 4000 | 90'} />
        <div className="flex items-center gap-2">
          <div className="w-40"><div className={LABEL}>Service-level Z (1.65 ≈ 95%)</div><input className={INPUT} type="number" step="0.01" value={zText} onChange={(e) => setZText(e.target.value)} /></div>
          <button onClick={optimize} disabled={busy} className={cn(BTN, 'bg-emerald-600 text-white hover:bg-emerald-500 mt-3')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />} Optimize network
          </button>
        </div>
      </div>

      {result?.message && <p className="text-[11px] text-zinc-500">{result.message}</p>}
      {result && !result.message && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total safety stock" value={result.totalSafetyStock} tone="text-emerald-300" />
            <Stat label="Total target stock" value={result.totalTargetStock} />
            <Stat label="Need replenish" value={result.needsReplenish} tone="text-rose-300" />
          </div>
          <ChartKit kind="bar" height={200} xKey="location"
            data={result.echelons.map((e) => ({ location: e.location, current: e.currentStock, target: e.targetStock, safety: e.safetyStock }))}
            series={[{ key: 'current', label: 'On hand', color: '#06b6d4' }, { key: 'target', label: 'Target', color: '#22c55e' }, { key: 'safety', label: 'Safety', color: '#f59e0b' }]} />
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                <th className="py-1">Echelon</th><th>Tier</th><th>On hand</th><th>ROP</th><th>Safety</th><th>Target</th><th>Days</th><th>Imbalance</th>
              </tr></thead>
              <tbody>
                {result.echelons.map((e) => (
                  <tr key={e.location} className="border-t border-zinc-800 text-zinc-300">
                    <td className="py-1 font-semibold text-white">{e.location}</td>
                    <td>{e.tier}</td><td>{e.currentStock}</td><td>{e.reorderPoint}</td>
                    <td>{e.safetyStock}</td><td>{e.targetStock}</td><td>{e.daysOfStock}</td>
                    <td className={e.imbalance < 0 ? 'text-rose-300' : 'text-emerald-300'}>{e.imbalance > 0 ? `+${e.imbalance}` : e.imbalance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rebalanceTransfers.length > 0 && (
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-2.5">
              <div className={cn(LABEL, 'text-cyan-300 mb-1')}>Recommended rebalancing transfers</div>
              {result.rebalanceTransfers.map((t, i) => (
                <div key={i} className="text-[11px] text-zinc-300">
                  {t.from} <ArrowRight className="inline w-3 h-3 text-cyan-400" /> {t.to}: <span className="font-mono text-cyan-200">{t.units} units</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────── 4. What-if scenarios ────────────────────────── */

const DISRUPTIONS = ['none', 'port_closure', 'supplier_failure', 'demand_spike', 'transport_strike', 'material_shortage'];

function ScenarioPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [disruption, setDisruption] = useState('port_closure');
  const [demand, setDemand] = useState('100'); const [lead, setLead] = useState('14');
  const [cost, setCost] = useState('10'); const [stock, setStock] = useState('');
  const [altLead, setAltLead] = useState(''); const [altCost, setAltCost] = useState('');

  const load = useCallback(async () => {
    try { const r = await run<{ scenarios: Scenario[] }>('scenarioList'); setScenarios(r?.scenarios || []); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const simulate = async () => {
    setBusy(true);
    try {
      await run('scenarioSimulate', {
        name, disruption, baseDailyDemand: num(demand, 100), baseLeadTimeDays: num(lead, 14),
        baseUnitCost: num(cost, 10), currentStock: stock ? num(stock) : undefined,
        altLeadTimeDays: altLead ? num(altLead) : 0, altUnitCost: altCost ? num(altCost) : 0,
      });
      setName('');
      await load(); notify({ kind: 'ok', text: 'Scenario simulated.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const del = async (id: string) => {
    try { await run('scenarioDelete', { scenarioId: id }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><div className={LABEL}>Scenario name</div><input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><div className={LABEL}>Disruption</div>
          <select className={INPUT} value={disruption} onChange={(e) => setDisruption(e.target.value)}>
            {DISRUPTIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div><div className={LABEL}>Daily demand</div><input className={INPUT} type="number" value={demand} onChange={(e) => setDemand(e.target.value)} /></div>
        <div><div className={LABEL}>Base lead (days)</div><input className={INPUT} type="number" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
        <div><div className={LABEL}>Base unit cost</div><input className={INPUT} type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div><div className={LABEL}>Current stock</div><input className={INPUT} type="number" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="auto" /></div>
        <div><div className={LABEL}>Alt source lead</div><input className={INPUT} type="number" value={altLead} onChange={(e) => setAltLead(e.target.value)} placeholder="optional" /></div>
        <div><div className={LABEL}>Alt source cost</div><input className={INPUT} type="number" value={altCost} onChange={(e) => setAltCost(e.target.value)} placeholder="optional" /></div>
        <button onClick={simulate} disabled={busy} className={cn(BTN, 'bg-purple-600 text-white hover:bg-purple-500 col-span-2 md:col-span-4 justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />} Simulate disruption
        </button>
      </div>

      <div className="space-y-2">
        {scenarios.map((s) => (
          <div key={s.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">{s.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase">{s.disruption.replace(/_/g, ' ')}</span>
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold', s.resilient ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>
                  {s.resilient ? 'resilient' : 'at risk'}
                </span>
              </div>
              <button onClick={() => del(s.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete scenario"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="text-[10px] text-emerald-300 mt-0.5">Recommendation: {s.recommendation}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1.5">
              {s.options.map((o) => (
                <div key={o.source} className={cn('rounded border p-2 text-[10px]', o.stocksOut ? 'border-rose-700/50 bg-rose-950/20' : 'border-emerald-700/50 bg-emerald-950/20')}>
                  <div className="font-semibold text-white">{o.source}</div>
                  <div className="text-zinc-400">Eff. lead {o.effectiveLeadTimeDays}d · unit ${o.effectiveUnitCost}</div>
                  <div className="text-zinc-400">Days to stockout: {o.daysToStockout}</div>
                  <div className={o.stocksOut ? 'text-rose-300' : 'text-emerald-300'}>
                    {o.stocksOut ? `Stockout ${o.projectedStockoutUnits} units` : 'No stockout'} · replenish ${o.replenishCost.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {scenarios.length === 0 && <p className="text-[11px] text-zinc-600 py-3 text-center">No scenarios run yet.</p>}
      </div>
    </div>
  );
}

/* ────────────────────── 5. Seasonal forecast ───────────────────────── */

function ForecastPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [result, setResult] = useState<SeasonalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [season, setSeason] = useState('4');
  const [horizon, setHorizon] = useState('4');

  const forecast = async () => {
    const values = parseNumberList(text);
    if (values.length < 4) { notify({ kind: 'err', text: 'Enter at least 4 demand values.' }); return; }
    setBusy(true);
    try {
      setResult(await run<SeasonalResult>('seasonalForecast', {
        history: values, seasonLength: num(season, 4), horizon: num(horizon, 4),
      }));
      notify({ kind: 'ok', text: 'Holt-Winters forecast computed.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const chartData: Array<{ idx: string; actual?: number; fitted: number }> = result && !result.message
    ? [
      ...result.fitted.map((f, i) => ({ idx: `t${i + 1}`, actual: parseNumberList(text)[i], fitted: f })),
      ...result.forecast.map((p) => ({ idx: p.period, fitted: p.predicted })),
    ]
    : [];

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 space-y-2">
        <div className={LABEL}>Demand history — space/comma-separated values (oldest first)</div>
        <textarea className={cn(INPUT, 'font-mono')} rows={2} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="120 95 140 180 130 100 155 200" />
        <div className="flex items-center gap-2">
          <div className="w-32"><div className={LABEL}>Season length</div><input className={INPUT} type="number" value={season} onChange={(e) => setSeason(e.target.value)} /></div>
          <div className="w-32"><div className={LABEL}>Horizon</div><input className={INPUT} type="number" value={horizon} onChange={(e) => setHorizon(e.target.value)} /></div>
          <button onClick={forecast} disabled={busy} className={cn(BTN, 'bg-cyan-600 text-white hover:bg-cyan-500 mt-3')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />} Forecast
          </button>
        </div>
      </div>

      {result?.message && <p className="text-[11px] text-zinc-500">{result.message}</p>}
      {result && !result.message && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Method" value="Holt-Winters" tone="text-cyan-300" />
            <Stat label="MAPE" value={`${result.mapePct}%`} tone={result.mapePct <= 20 ? 'text-emerald-300' : 'text-amber-300'} />
            <Stat label="Accuracy" value={result.accuracy} />
            <Stat label="Trend" value={result.trend} />
          </div>
          <ChartKit kind="line" height={220} xKey="idx" data={chartData}
            series={[{ key: 'actual', label: 'Actual', color: '#06b6d4' }, { key: 'fitted', label: 'Fitted / forecast', color: '#a855f7' }]} />
          <div className="flex flex-wrap gap-2">
            {result.forecast.map((p) => (
              <div key={p.period} className="rounded border border-cyan-700/40 bg-cyan-950/20 px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-wider text-cyan-400">{p.period}</div>
                <div className="text-base font-bold text-cyan-200">{p.predicted}</div>
                <div className="text-[9px] text-zinc-500">{p.confidence}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-500">Seasonal indices: {result.seasonalIndices.join(', ')}</div>
        </>
      )}
    </div>
  );
}

/* ───────────────────── 6. Exceptions dashboard ─────────────────────── */

function ExceptionsPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [result, setResult] = useState<ExceptionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [invText, setInvText] = useState('');
  const [supText, setSupText] = useState('');

  // inventory line: name | currentStock | dailyDemand | leadTimeDays | reorderPoint
  // supplier line:  name | qualityScore | onTimePercent
  const scan = useCallback(async () => {
    const inventory = invText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, cur, dd, lt, rop] = l.split('|').map((x) => x.trim());
      return { name, currentStock: Number(cur) || 0, dailyDemand: Number(dd) || 0, leadTimeDays: Number(lt) || 7, reorderPoint: rop ? Number(rop) : undefined };
    });
    const suppliers = supText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, q, ot] = l.split('|').map((x) => x.trim());
      return { name, qualityScore: Number(q) || 0, onTimePercent: Number(ot) || 0 };
    });
    setBusy(true);
    try {
      setResult(await run<ExceptionResult>('exceptionScan', { inventory, suppliers }));
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  }, [invText, supText, notify]);

  useEffect(() => { scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <div className={LABEL}>Inventory — <span className="text-zinc-600 normal-case">name | currentStock | dailyDemand | leadTimeDays | reorderPoint</span></div>
          <textarea className={cn(INPUT, 'font-mono')} rows={3} value={invText} onChange={(e) => setInvText(e.target.value)}
            placeholder={'Widget A | 0 | 12 | 7 | 90\nWidget B | 40 | 6 | 5 | 60'} />
        </div>
        <div>
          <div className={LABEL}>Suppliers — <span className="text-zinc-600 normal-case">name | qualityScore | onTimePercent</span></div>
          <textarea className={cn(INPUT, 'font-mono')} rows={3} value={supText} onChange={(e) => setSupText(e.target.value)}
            placeholder={'Acme Corp | 45 | 55\nGlobex | 80 | 92'} />
        </div>
        <button onClick={scan} disabled={busy} className={cn(BTN, 'bg-rose-600 text-white hover:bg-rose-500 md:col-span-2 justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Scan exceptions (incl. live shipments &amp; POs)
        </button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Critical" value={result.critical} tone="text-rose-300" />
            <Stat label="Warnings" value={result.warning} tone="text-amber-300" />
          </div>
          <div className="space-y-1.5">
            {result.alerts.map((a) => (
              <div key={a.id} className={cn('rounded-md border px-2.5 py-1.5',
                a.severity === 'critical' ? 'border-rose-700/50 bg-rose-950/20' : 'border-amber-700/50 bg-amber-950/20')}>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase',
                    a.severity === 'critical' ? 'bg-rose-500/30 text-rose-200' : 'bg-amber-500/30 text-amber-200')}>{a.severity}</span>
                  <span className="text-[9px] text-zinc-500 uppercase">{a.kind.replace(/_/g, ' ')}</span>
                  <span className="text-[11px] text-white">{a.message}</span>
                </div>
                {a.detail && <div className="text-[10px] text-zinc-500 mt-0.5">{a.detail}</div>}
              </div>
            ))}
            {result.alerts.length === 0 && (
              <p className="text-[11px] text-emerald-400 py-3 text-center flex items-center justify-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> No exceptions — all clear.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────── 7. Work-order workflow ──────────────────────── */

function WorkOrdersPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [data, setData] = useState<WorkOrderList | null>(null);
  const [busy, setBusy] = useState(false);
  const [item, setItem] = useState(''); const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState('1'); const [cost, setCost] = useState('');
  const [lead, setLead] = useState('14'); const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    try { setData(await run<WorkOrderList>('workOrderList')); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!item.trim()) { notify({ kind: 'err', text: 'Enter an item.' }); return; }
    setBusy(true);
    try {
      await run('workOrderCreate', {
        item, supplier, quantity: num(qty, 1), unitCost: num(cost), leadTimeDays: num(lead, 14), category,
      });
      setItem(''); setSupplier(''); setQty('1'); setCost(''); setCategory('');
      await load(); notify({ kind: 'ok', text: 'Requisition created.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const advance = async (id: string) => {
    try { await run('workOrderAdvance', { workOrderId: id }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  };
  const del = async (id: string) => {
    try { await run('workOrderDelete', { workOrderId: id }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 grid grid-cols-2 md:grid-cols-3 gap-2">
        <div><div className={LABEL}>Item</div><input className={INPUT} value={item} onChange={(e) => setItem(e.target.value)} /></div>
        <div><div className={LABEL}>Supplier</div><input className={INPUT} value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
        <div><div className={LABEL}>Category</div><input className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)} /></div>
        <div><div className={LABEL}>Quantity</div><input className={INPUT} type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div><div className={LABEL}>Unit cost</div><input className={INPUT} type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
        <div><div className={LABEL}>Lead time (days)</div><input className={INPUT} type="number" value={lead} onChange={(e) => setLead(e.target.value)} /></div>
        <button onClick={create} disabled={busy} className={cn(BTN, 'bg-teal-600 text-white hover:bg-teal-500 col-span-2 md:col-span-3 justify-center')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New requisition
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Open PO value" value={`$${data.openValue.toLocaleString()}`} tone="text-teal-300" />
            <Stat label="Overdue" value={data.overdueCount} tone="text-rose-300" />
            <Stat label="Ordered" value={data.byStage.ordered || 0} />
            <Stat label="Received" value={data.byStage.received || 0} tone="text-emerald-300" />
          </div>
          <div className="space-y-2">
            {data.workOrders.map((wo) => (
              <div key={wo.id} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-teal-400" />
                    <span className="text-[12px] font-semibold text-white">{wo.poNumber}</span>
                    <span className="text-[10px] text-zinc-500">{wo.item} ×{wo.quantity}</span>
                    {wo.overdue && <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-semibold">OVERDUE</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-emerald-300 font-mono">${wo.totalCost.toLocaleString()}</span>
                    <button onClick={() => del(wo.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete work order"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  {data.stages.map((st, i) => (
                    <div key={st} className="flex items-center gap-1 flex-1">
                      <div className={cn('flex-1 h-1 rounded-full', i <= data.stages.indexOf(wo.stage) ? 'bg-teal-500' : 'bg-zinc-800')} />
                      <span className={cn('text-[8px] uppercase whitespace-nowrap', st === wo.stage ? 'text-teal-300 font-semibold' : 'text-zinc-600')}>{st}</span>
                    </div>
                  ))}
                </div>
                {wo.stage !== 'closed' && (
                  <button onClick={() => advance(wo.id)} className={cn(BTN, 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 mt-1.5 text-[10px]')}>
                    <ArrowRight className="w-3 h-3" /> Advance to next stage
                  </button>
                )}
              </div>
            ))}
            {data.workOrders.length === 0 && <p className="text-[11px] text-zinc-600 py-3 text-center">No work orders yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────── 8. Spend analytics ───────────────────────── */

function SpendPanel({ notify }: { notify: (f: Feedback) => void }) {
  const [result, setResult] = useState<SpendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');

  // order line: supplier | category | quantity | unitCost
  const analyze = useCallback(async () => {
    const orders = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [supplier, category, qty, unit] = l.split('|').map((x) => x.trim());
      return { supplier, category, quantity: Number(qty) || 0, unitCost: Number(unit) || 0 };
    });
    setBusy(true);
    try {
      setResult(await run<SpendResult>('spendAnalytics', { orders }));
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  }, [text, notify]);

  useEffect(() => { analyze(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5 space-y-2">
        <div className={LABEL}>Orders — one per line: <span className="text-zinc-600 normal-case">supplier | category | quantity | unitCost</span> (work orders are auto-included)</div>
        <textarea className={cn(INPUT, 'font-mono')} rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Acme Corp | raw materials | 500 | 4.20\nGlobex | packaging | 1200 | 0.85\nAcme Corp | raw materials | 300 | 4.50'} />
        <button onClick={analyze} disabled={busy} className={cn(BTN, 'bg-amber-600 text-white hover:bg-amber-500')}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DollarSign className="w-3.5 h-3.5" />} Analyze spend
        </button>
      </div>

      {result?.message && result.totalSpend === 0 && <p className="text-[11px] text-zinc-500">{result.message}</p>}
      {result && result.totalSpend > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Total spend" value={`$${result.totalSpend.toLocaleString()}`} tone="text-amber-300" />
            <Stat label="Suppliers" value={result.supplierCount} />
            <Stat label="Avg line item" value={`$${result.avgLineItem.toLocaleString()}`} />
            <Stat label="Pareto (80%)" value={`${result.paretoSupplierCount} sup`} tone="text-rose-300" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className={cn(LABEL, 'mb-1')}>Spend by supplier</div>
              <ChartKit kind="bar" height={200} xKey="name"
                data={result.bySupplier.map((s) => ({ name: s.name, spend: s.amount }))}
                series={[{ key: 'spend', label: 'Spend', color: '#f59e0b' }]} />
            </div>
            <div>
              <div className={cn(LABEL, 'mb-1')}>Spend by category</div>
              <ChartKit kind="bar" height={200} xKey="name"
                data={result.byCategory.map((c) => ({ name: c.name, spend: c.amount }))}
                series={[{ key: 'spend', label: 'Spend', color: '#ec4899' }]} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead><tr className="text-zinc-500 uppercase tracking-wider text-left"><th className="py-1">Supplier</th><th>Spend</th><th>Share</th></tr></thead>
              <tbody>
                {result.bySupplier.map((s) => (
                  <tr key={s.name} className="border-t border-zinc-800 text-zinc-300">
                    <td className="py-1 font-semibold text-white">{s.name}</td>
                    <td>${s.amount.toLocaleString()}</td>
                    <td>{s.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-zinc-500">
            Pareto concentration: {result.paretoConcentration}% of suppliers drive 80% of spend.
            {result.topSupplier && <> Top: <span className="text-amber-300">{result.topSupplier.name}</span> (${result.topSupplier.amount.toLocaleString()}).</>}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── shell ─────────────────────────────────── */

const TABS: { id: PlannerTab; label: string; icon: typeof Ship }[] = [
  { id: 'shipments', label: 'Shipment tracking', icon: Ship },
  { id: 'network', label: 'Supply network', icon: Network },
  { id: 'echelon', label: 'Multi-echelon', icon: Layers },
  { id: 'scenario', label: 'What-if scenarios', icon: FlaskConical },
  { id: 'forecast', label: 'Seasonal forecast', icon: TrendingUp },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { id: 'workorders', label: 'PO workflow', icon: ClipboardList },
  { id: 'spend', label: 'Spend analytics', icon: DollarSign },
];

export function SupplyChainPlanner() {
  const [tab, setTab] = useState<PlannerTab>('shipments');
  const [feedback, setFeedback] = useState<Feedback>(null);

  const notify = useCallback((f: Feedback) => {
    setFeedback(f);
    if (f) window.setTimeout(() => setFeedback((cur) => (cur === f ? null : cur)), 4000);
  }, []);

  return (
    <div className="rounded-lg border border-teal-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-teal-500/10 pb-2">
        <Network className="h-4 w-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-white">Integrated Planning Workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          SAP-IBP parity
        </span>
      </header>

      <nav className="flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] transition-colors',
                tab === t.id ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      {feedback && (
        <div className={cn('px-2.5 py-1.5 rounded text-[11px] flex items-center gap-2 border',
          feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/30')}>
          {feedback.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {feedback.text}
        </div>
      )}

      {tab === 'shipments' && <ShipmentsPanel notify={notify} />}
      {tab === 'network' && <NetworkPanel notify={notify} />}
      {tab === 'echelon' && <EchelonPanel notify={notify} />}
      {tab === 'scenario' && <ScenarioPanel notify={notify} />}
      {tab === 'forecast' && <ForecastPanel notify={notify} />}
      {tab === 'exceptions' && <ExceptionsPanel notify={notify} />}
      {tab === 'workorders' && <WorkOrdersPanel notify={notify} />}
      {tab === 'spend' && <SpendPanel notify={notify} />}
    </div>
  );
}
