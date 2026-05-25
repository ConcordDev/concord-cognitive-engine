'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  AlertTriangle,
  Award,
  CircleDot,
  Crosshair,
  DollarSign,
  Gauge,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  Radar,
  Receipt,
  Route as RouteIcon,
  Satellite,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
interface GpsPing { lat: number; lng: number; at: string; speedMph: number | null; eldStatus: string | null }
interface GpsTrack {
  id: string;
  shipmentId: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  totalDistanceMi: number;
  pings: GpsPing[];
  etaIso: string | null;
  status: string;
  currentLat?: number;
  currentLng?: number;
  remainingMi?: number;
  progressPct?: number;
  lastPingAt?: string;
}
interface RiskFactor { factor: string; detail: string; points: number }
interface RiskResult {
  shipmentId: string;
  riskScore: number;
  riskTier: string;
  predictedEtaIso: string | null;
  scheduledEtaIso: string | null;
  factors: RiskFactor[];
}
interface VrpStop { sequence: number; name: string; lat: number; lng: number; demand: number; legDistanceMi: number }
interface VrpRoute {
  vehicleIndex: number;
  stopCount: number;
  load: number;
  capacity: number | null;
  utilizationPct: number | null;
  routeDistanceMi: number;
  estimatedMinutes: number;
  stops: VrpStop[];
}
interface VrpResult { vehiclesUsed: number; totalStops: number; totalDistanceMi: number; overCapacity: boolean; routes: VrpRoute[] }
interface Scorecard {
  carrierId: string;
  carrierName: string;
  carrierCode: string;
  shipmentCount: number;
  onTimePct: number | null;
  tenderAcceptancePct: number | null;
  damageRatePct: number | null;
  exceptionCount: number;
  grade: number;
  letterGrade: string;
}
interface Geofence { id: string; name: string; lat: number; lng: number; radiusMi: number; kind: string }
interface Milestone {
  id: string;
  shipmentId: string;
  geofenceName: string;
  geofenceKind: string;
  kind: string;
  at: string;
  dwellMinutes?: number;
  distanceMi: number;
}
interface FreightInvoice {
  id: string;
  invoiceNumber: string;
  carrierId: string;
  quotedAmountUsd: number;
  invoicedAmountUsd: number;
  varianceUsd: number;
  variancePct: number;
  status: string;
  disputableUsd: number;
}
interface FreightSummary {
  invoiceCount: number;
  totalQuoted: number;
  totalInvoiced: number;
  totalVarianceUsd: number;
  totalDisputableUsd: number;
  overbilledCount: number;
  disputedCount: number;
}
interface ExceptionItem {
  id: string;
  shipmentId: string;
  kind: string;
  severity: string;
  description: string;
  status: string;
  assignee: string;
  flaggedAt: string;
}
interface ExceptionDashboard {
  totalExceptions: number;
  openCount: number;
  resolvedCount: number;
  escalatedCount: number;
  criticalCount: number;
  byKind: Record<string, number>;
  bySeverity: Record<string, number>;
  triageQueue: ExceptionItem[];
}

type TowerTab = 'gps' | 'risk' | 'vrp' | 'scorecard' | 'geofence' | 'freight' | 'exceptions';

const TABS: { id: TowerTab; label: string; icon: typeof Satellite }[] = [
  { id: 'gps', label: 'GPS / ELD', icon: Satellite },
  { id: 'risk', label: 'Delay Risk', icon: TrendingUp },
  { id: 'vrp', label: 'VRP Solver', icon: RouteIcon },
  { id: 'scorecard', label: 'Scorecard', icon: Award },
  { id: 'geofence', label: 'Geofences', icon: Radar },
  { id: 'freight', label: 'Freight Audit', icon: Receipt },
  { id: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
];

// ---------------------------------------------------------------------------
// Small UI primitives
// ---------------------------------------------------------------------------
const INPUT =
  'px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white w-full';
const BTN =
  'px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';

function Empty({ icon: Icon, text }: { icon: typeof Satellite; text: string }) {
  return (
    <div className="px-3 py-10 text-center text-xs text-gray-400">
      <Icon className="w-6 h-6 mx-auto mb-2 opacity-30" />
      {text}
    </div>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return (
    <div className="px-3 py-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded flex items-center gap-2">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {msg}
    </div>
  );
}

function tierColor(tier: string) {
  return tier === 'high' ? 'text-rose-400' : tier === 'medium' ? 'text-amber-400' : 'text-green-400';
}
function gradeColor(letter: string) {
  return letter === 'A'
    ? 'text-green-400'
    : letter === 'B'
      ? 'text-cyan-300'
      : letter === 'C'
        ? 'text-amber-400'
        : 'text-rose-400';
}
function sevColor(sev: string) {
  return sev === 'critical'
    ? 'text-rose-400'
    : sev === 'high'
      ? 'text-orange-400'
      : sev === 'medium'
        ? 'text-amber-400'
        : 'text-gray-400';
}

// ===========================================================================
// GPS / ELD live tracking
// ===========================================================================
function GpsPanel() {
  const [tracks, setTracks] = useState<GpsTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [initForm, setInitForm] = useState({
    shipmentId: '',
    originLat: '',
    originLng: '',
    destLat: '',
    destLng: '',
  });
  const [pingForm, setPingForm] = useState({ shipmentId: '', lat: '', lng: '', speedMph: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('logistics', 'gps-track-get', {});
      if (r.data?.ok) setTracks((r.data.result?.tracks || []) as GpsTrack[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createTrack() {
    setErr('');
    const r = await lensRun('logistics', 'gps-track-init', {
      shipmentId: initForm.shipmentId.trim(),
      originLat: Number(initForm.originLat),
      originLng: Number(initForm.originLng),
      destLat: Number(initForm.destLat),
      destLng: Number(initForm.destLng),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'failed to create track'); return; }
    setInitForm({ shipmentId: '', originLat: '', originLng: '', destLat: '', destLng: '' });
    await refresh();
  }

  async function sendPing() {
    setErr('');
    const r = await lensRun('logistics', 'gps-ping', {
      shipmentId: pingForm.shipmentId.trim(),
      lat: Number(pingForm.lat),
      lng: Number(pingForm.lng),
      ...(pingForm.speedMph.trim() ? { speedMph: Number(pingForm.speedMph) } : {}),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'failed to record ping'); return; }
    setPingForm({ shipmentId: '', lat: '', lng: '', speedMph: '' });
    await refresh();
  }

  const markers = tracks.flatMap((t) => {
    const m: { lat: number; lng: number; label: string; popup?: string }[] = [
      { lat: t.origin.lat, lng: t.origin.lng, label: `${t.shipmentId} origin` },
      { lat: t.destination.lat, lng: t.destination.lng, label: `${t.shipmentId} dest` },
    ];
    if (t.currentLat != null && t.currentLng != null) {
      m.push({
        lat: t.currentLat,
        lng: t.currentLng,
        label: `${t.shipmentId} live`,
        popup: `${t.progressPct ?? 0}% complete${t.etaIso ? ` · ETA ${new Date(t.etaIso).toLocaleString()}` : ''}`,
      });
    }
    return m;
  });

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Start a track</p>
          <input
            value={initForm.shipmentId}
            onChange={(e) => setInitForm({ ...initForm, shipmentId: e.target.value })}
            placeholder="Shipment ID"
            className={INPUT}
          />
          <div className="grid grid-cols-2 gap-2">
            <input value={initForm.originLat} onChange={(e) => setInitForm({ ...initForm, originLat: e.target.value })} placeholder="Origin lat" className={INPUT} />
            <input value={initForm.originLng} onChange={(e) => setInitForm({ ...initForm, originLng: e.target.value })} placeholder="Origin lng" className={INPUT} />
            <input value={initForm.destLat} onChange={(e) => setInitForm({ ...initForm, destLat: e.target.value })} placeholder="Dest lat" className={INPUT} />
            <input value={initForm.destLng} onChange={(e) => setInitForm({ ...initForm, destLng: e.target.value })} placeholder="Dest lng" className={INPUT} />
          </div>
          <button onClick={createTrack} disabled={!initForm.shipmentId.trim()} className={BTN}>
            <Plus className="w-3 h-3" /> Create track
          </button>
        </div>
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Record a GPS / ELD ping</p>
          <input
            value={pingForm.shipmentId}
            onChange={(e) => setPingForm({ ...pingForm, shipmentId: e.target.value })}
            placeholder="Shipment ID"
            className={INPUT}
          />
          <div className="grid grid-cols-3 gap-2">
            <input value={pingForm.lat} onChange={(e) => setPingForm({ ...pingForm, lat: e.target.value })} placeholder="Lat" className={INPUT} />
            <input value={pingForm.lng} onChange={(e) => setPingForm({ ...pingForm, lng: e.target.value })} placeholder="Lng" className={INPUT} />
            <input value={pingForm.speedMph} onChange={(e) => setPingForm({ ...pingForm, speedMph: e.target.value })} placeholder="mph" className={INPUT} />
          </div>
          <button onClick={sendPing} disabled={!pingForm.shipmentId.trim()} className={BTN}>
            <Satellite className="w-3 h-3" /> Send ping &amp; recalc ETA
          </button>
        </div>
      </div>

      {err && <ErrLine msg={err} />}

      {markers.length > 0 && (
        <MapView markers={markers} className="h-[280px] rounded border border-white/10" />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading tracks…
        </div>
      ) : tracks.length === 0 ? (
        <Empty icon={Satellite} text="No GPS tracks yet. Start a track for a shipment above." />
      ) : (
        <ul className="space-y-2">
          {tracks.map((t) => (
            <li key={t.id} className="p-3 bg-lattice-deep/40 border border-white/10 rounded">
              <div className="flex items-center gap-2">
                <CircleDot className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-sm text-white font-mono">{t.shipmentId}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                  {t.status.replace(/_/g, ' ')}
                </span>
                <span className="ml-auto text-[10px] text-gray-400">{t.pings.length} pings</span>
              </div>
              <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: `${Math.min(100, t.progressPct ?? 0)}%` }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-gray-400">
                <span>{t.totalDistanceMi} mi total</span>
                <span>{t.remainingMi != null ? `${t.remainingMi} mi left` : '—'}</span>
                <span>
                  {t.etaIso ? `ETA ${new Date(t.etaIso).toLocaleString()}` : 'ETA pending'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// Delay-risk scoring
// ===========================================================================
function RiskPanel() {
  const [shipmentId, setShipmentId] = useState('');
  const [result, setResult] = useState<RiskResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function score() {
    setErr('');
    setBusy(true);
    try {
      const r = await lensRun('logistics', 'delay-risk-score', { shipmentId: shipmentId.trim() });
      if (!r.data?.ok) { setErr(r.data?.error || 'scoring failed'); setResult(null); return; }
      setResult(r.data.result as RiskResult);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={shipmentId}
          onChange={(e) => setShipmentId(e.target.value)}
          placeholder="Shipment ID (created in Shipments panel)"
          className={INPUT}
        />
        <button onClick={score} disabled={!shipmentId.trim() || busy} className={BTN}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
          Score
        </button>
      </div>

      {err && <ErrLine msg={err} />}

      {result && (
        <div className="p-4 bg-lattice-deep/40 border border-white/10 rounded space-y-3">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className={`text-3xl font-bold ${tierColor(result.riskTier)}`}>{result.riskScore}</p>
              <p className="text-[10px] uppercase text-gray-400">risk score</p>
            </div>
            <div>
              <p className={`text-sm font-semibold uppercase ${tierColor(result.riskTier)}`}>
                {result.riskTier} risk
              </p>
              <p className="text-[11px] text-gray-400">
                Predicted ETA:{' '}
                {result.predictedEtaIso
                  ? new Date(result.predictedEtaIso).toLocaleString()
                  : 'unknown'}
              </p>
              <p className="text-[11px] text-gray-400">
                Scheduled:{' '}
                {result.scheduledEtaIso
                  ? new Date(result.scheduledEtaIso).toLocaleString()
                  : 'unscheduled'}
              </p>
            </div>
          </div>
          {result.factors.length === 0 ? (
            <p className="text-[11px] text-green-400">No risk factors detected — on track.</p>
          ) : (
            <ul className="space-y-1">
              {result.factors.map((f) => (
                <li key={f.factor} className="flex items-center gap-2 text-[11px]">
                  <span className="w-8 text-right font-mono text-amber-400">+{f.points}</span>
                  <span className="text-gray-300">{f.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// VRP solver (capacity-constrained multi-stop)
// ===========================================================================
interface VrpStopInput { name: string; lat: string; lng: string; demand: string }

function VrpPanel() {
  const [depot, setDepot] = useState({ lat: '', lng: '' });
  const [vehicleCount, setVehicleCount] = useState('2');
  const [vehicleCapacity, setVehicleCapacity] = useState('1000');
  const [stops, setStops] = useState<VrpStopInput[]>([{ name: '', lat: '', lng: '', demand: '' }]);
  const [result, setResult] = useState<VrpResult | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function updateStop(idx: number, patch: Partial<VrpStopInput>) {
    setStops((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  async function solve() {
    setErr('');
    setBusy(true);
    try {
      const cleaned = stops
        .filter((s) => s.lat.trim() && s.lng.trim())
        .map((s, i) => ({
          stopId: `stop_${i + 1}`,
          name: s.name.trim() || `Stop ${i + 1}`,
          lat: Number(s.lat),
          lng: Number(s.lng),
          demand: Number(s.demand) || 0,
        }));
      const r = await lensRun('logistics', 'vrp-optimize', {
        depot: { lat: Number(depot.lat), lng: Number(depot.lng) },
        stops: cleaned,
        vehicleCount: Number(vehicleCount) || 1,
        vehicleCapacity: Number(vehicleCapacity) || 0,
      });
      if (!r.data?.ok) { setErr(r.data?.error || 'VRP failed'); setResult(null); return; }
      setResult(r.data.result as VrpResult);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <input value={depot.lat} onChange={(e) => setDepot({ ...depot, lat: e.target.value })} placeholder="Depot lat" className={INPUT} />
        <input value={depot.lng} onChange={(e) => setDepot({ ...depot, lng: e.target.value })} placeholder="Depot lng" className={INPUT} />
        <input value={vehicleCount} onChange={(e) => setVehicleCount(e.target.value)} placeholder="Vehicles" className={INPUT} />
        <input value={vehicleCapacity} onChange={(e) => setVehicleCapacity(e.target.value)} placeholder="Capacity/veh" className={INPUT} />
      </div>
      <div className="space-y-2">
        {stops.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
            <input value={s.name} onChange={(e) => updateStop(i, { name: e.target.value })} placeholder={`Stop ${i + 1} name`} className={INPUT} />
            <input value={s.lat} onChange={(e) => updateStop(i, { lat: e.target.value })} placeholder="lat" className={INPUT} />
            <input value={s.lng} onChange={(e) => updateStop(i, { lng: e.target.value })} placeholder="lng" className={INPUT} />
            <input value={s.demand} onChange={(e) => updateStop(i, { demand: e.target.value })} placeholder="demand" className={INPUT} />
            <button
              onClick={() => setStops((prev) => prev.filter((_, x) => x !== i))}
              disabled={stops.length === 1}
              className="p-1.5 text-gray-400 hover:text-rose-400 disabled:opacity-30"
              aria-label="Remove stop"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setStops((prev) => [...prev, { name: '', lat: '', lng: '', demand: '' }])}
            className="px-2.5 py-1 text-[11px] rounded bg-white/5 text-gray-300 hover:bg-white/10 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add stop
          </button>
          <button onClick={solve} disabled={busy || !depot.lat.trim()} className={BTN}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RouteIcon className="w-3 h-3" />}
            Solve VRP
          </button>
        </div>
      </div>

      {err && <ErrLine msg={err} />}

      {result && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Vehicles used', value: result.vehiclesUsed },
              { label: 'Total stops', value: result.totalStops },
              { label: 'Total miles', value: result.totalDistanceMi },
            ].map((k) => (
              <div key={k.label} className="p-2 bg-lattice-deep/40 border border-white/10 rounded text-center">
                <p className="text-lg font-bold text-cyan-300">{k.value}</p>
                <p className="text-[10px] uppercase text-gray-400">{k.label}</p>
              </div>
            ))}
          </div>
          {result.overCapacity && (
            <ErrLine msg="One or more routes exceed vehicle capacity — add vehicles or split demand." />
          )}
          {result.routes.map((rt) => (
            <div key={rt.vehicleIndex} className="p-3 bg-lattice-deep/40 border border-white/10 rounded">
              <div className="flex items-center gap-2 text-xs">
                <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-white font-semibold">Vehicle {rt.vehicleIndex}</span>
                <span className="text-gray-400">
                  {rt.stopCount} stops · {rt.routeDistanceMi} mi · {rt.estimatedMinutes} min
                </span>
                {rt.utilizationPct != null && (
                  <span className="ml-auto text-[10px] text-amber-300">
                    {rt.utilizationPct}% loaded ({rt.load}/{rt.capacity})
                  </span>
                )}
              </div>
              <ol className="mt-2 space-y-1">
                {rt.stops.map((st) => (
                  <li key={st.sequence} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-300 text-center leading-4">
                      {st.sequence}
                    </span>
                    <span className="text-gray-200">{st.name}</span>
                    <span className="ml-auto">{st.legDistanceMi} mi · demand {st.demand}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Carrier scorecard
// ===========================================================================
function ScorecardPanel() {
  const [cards, setCards] = useState<Scorecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tender, setTender] = useState({ carrierId: '', outcome: 'accepted' });
  const [damage, setDamage] = useState({ shipmentId: '', severity: 'minor', claimAmountUsd: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('logistics', 'carrier-scorecard', {});
      if (r.data?.ok) setCards((r.data.result?.scorecards || []) as Scorecard[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function recordTender() {
    setErr('');
    const r = await lensRun('logistics', 'tender-record', {
      carrierId: tender.carrierId.trim(),
      outcome: tender.outcome,
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'tender record failed'); return; }
    setTender({ carrierId: '', outcome: 'accepted' });
    await refresh();
  }

  async function reportDamage() {
    setErr('');
    const r = await lensRun('logistics', 'damage-report', {
      shipmentId: damage.shipmentId.trim(),
      severity: damage.severity,
      ...(damage.claimAmountUsd.trim() ? { claimAmountUsd: Number(damage.claimAmountUsd) } : {}),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'damage report failed'); return; }
    setDamage({ shipmentId: '', severity: 'minor', claimAmountUsd: '' });
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Record tender outcome</p>
          <input
            value={tender.carrierId}
            onChange={(e) => setTender({ ...tender, carrierId: e.target.value })}
            placeholder="Carrier ID"
            className={INPUT}
          />
          <select
            value={tender.outcome}
            onChange={(e) => setTender({ ...tender, outcome: e.target.value })}
            className={INPUT}
          >
            <option value="accepted">accepted</option>
            <option value="rejected">rejected</option>
          </select>
          <button onClick={recordTender} disabled={!tender.carrierId.trim()} className={BTN}>
            <Plus className="w-3 h-3" /> Record tender
          </button>
        </div>
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Report cargo damage</p>
          <input
            value={damage.shipmentId}
            onChange={(e) => setDamage({ ...damage, shipmentId: e.target.value })}
            placeholder="Shipment ID"
            className={INPUT}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={damage.severity}
              onChange={(e) => setDamage({ ...damage, severity: e.target.value })}
              className={INPUT}
            >
              <option value="minor">minor</option>
              <option value="moderate">moderate</option>
              <option value="severe">severe</option>
              <option value="total_loss">total loss</option>
            </select>
            <input
              value={damage.claimAmountUsd}
              onChange={(e) => setDamage({ ...damage, claimAmountUsd: e.target.value })}
              placeholder="Claim $"
              className={INPUT}
            />
          </div>
          <button onClick={reportDamage} disabled={!damage.shipmentId.trim()} className={BTN}>
            <Plus className="w-3 h-3" /> Report damage
          </button>
        </div>
      </div>

      {err && <ErrLine msg={err} />}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading scorecards…
        </div>
      ) : cards.length === 0 ? (
        <Empty icon={Award} text="No carrier scorecards yet. Add carriers and shipments to build analytics." />
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.carrierId} className="p-3 bg-lattice-deep/40 border border-white/10 rounded">
              <div className="flex items-center gap-3">
                <span className={`text-2xl font-bold ${gradeColor(c.letterGrade)}`}>
                  {c.letterGrade}
                </span>
                <div>
                  <p className="text-sm text-white">{c.carrierName}</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {c.carrierCode} · grade {c.grade}/100 · {c.shipmentCount} shipments
                  </p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
                <Metric label="On-time" value={c.onTimePct != null ? `${c.onTimePct}%` : '—'} />
                <Metric
                  label="Tender accept"
                  value={c.tenderAcceptancePct != null ? `${c.tenderAcceptancePct}%` : '—'}
                />
                <Metric
                  label="Damage rate"
                  value={c.damageRatePct != null ? `${c.damageRatePct}%` : '—'}
                />
                <Metric label="Exceptions" value={String(c.exceptionCount)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-white font-semibold">{value}</p>
      <p className="text-[9px] uppercase text-gray-400">{label}</p>
    </div>
  );
}

// ===========================================================================
// Geofences + milestone events
// ===========================================================================
function GeofencePanel() {
  const [fences, setFences] = useState<Geofence[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ name: '', lat: '', lng: '', radiusMi: '', kind: 'checkpoint' });
  const [evalForm, setEvalForm] = useState({ shipmentId: '', lat: '', lng: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [f, m] = await Promise.all([
        lensRun('logistics', 'geofences-list', {}),
        lensRun('logistics', 'milestones-list', {}),
      ]);
      if (f.data?.ok) setFences((f.data.result?.geofences || []) as Geofence[]);
      if (m.data?.ok) setMilestones((m.data.result?.milestones || []) as Milestone[]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createFence() {
    setErr('');
    const r = await lensRun('logistics', 'geofence-create', {
      name: form.name.trim(),
      lat: Number(form.lat),
      lng: Number(form.lng),
      radiusMi: Number(form.radiusMi),
      kind: form.kind,
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'geofence create failed'); return; }
    setForm({ name: '', lat: '', lng: '', radiusMi: '', kind: 'checkpoint' });
    await refresh();
  }

  async function removeFence(id: string) {
    await lensRun('logistics', 'geofence-delete', { id });
    await refresh();
  }

  async function evaluate() {
    setErr('');
    const r = await lensRun('logistics', 'geofence-evaluate', {
      shipmentId: evalForm.shipmentId.trim(),
      lat: Number(evalForm.lat),
      lng: Number(evalForm.lng),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'evaluation failed'); return; }
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Define geofence</p>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. Houston DC)" className={INPUT} />
          <div className="grid grid-cols-3 gap-2">
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="lat" className={INPUT} />
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} placeholder="lng" className={INPUT} />
            <input value={form.radiusMi} onChange={(e) => setForm({ ...form, radiusMi: e.target.value })} placeholder="radius mi" className={INPUT} />
          </div>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={INPUT}>
            {['origin', 'destination', 'stop', 'hub', 'checkpoint'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <button onClick={createFence} disabled={!form.name.trim()} className={BTN}>
            <Plus className="w-3 h-3" /> Create geofence
          </button>
        </div>
        <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Evaluate a GPS position</p>
          <input value={evalForm.shipmentId} onChange={(e) => setEvalForm({ ...evalForm, shipmentId: e.target.value })} placeholder="Shipment ID" className={INPUT} />
          <div className="grid grid-cols-2 gap-2">
            <input value={evalForm.lat} onChange={(e) => setEvalForm({ ...evalForm, lat: e.target.value })} placeholder="lat" className={INPUT} />
            <input value={evalForm.lng} onChange={(e) => setEvalForm({ ...evalForm, lng: e.target.value })} placeholder="lng" className={INPUT} />
          </div>
          <button onClick={evaluate} disabled={!evalForm.shipmentId.trim()} className={BTN}>
            <Crosshair className="w-3 h-3" /> Evaluate &amp; emit milestones
          </button>
        </div>
      </div>

      {err && <ErrLine msg={err} />}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">Geofences</p>
            {fences.length === 0 ? (
              <Empty icon={Radar} text="No geofences defined yet." />
            ) : (
              <ul className="space-y-1">
                {fences.map((g) => (
                  <li key={g.id} className="group flex items-center gap-2 px-2 py-1.5 bg-lattice-deep/40 border border-white/10 rounded text-[11px]">
                    <MapPin className="w-3 h-3 text-cyan-400" />
                    <span className="text-white">{g.name}</span>
                    <span className="text-gray-400">
                      {g.kind} · {g.radiusMi} mi
                    </span>
                    <button
                      onClick={() => removeFence(g.id)}
                      className="ml-auto opacity-0 group-hover:opacity-100 text-gray-400 hover:text-rose-400"
                      aria-label="Delete geofence"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">Milestone events</p>
            {milestones.length === 0 ? (
              <Empty icon={Activity} text="No milestone events yet." />
            ) : (
              <ul className="space-y-1">
                {milestones.map((m) => (
                  <li key={m.id} className="px-2 py-1.5 bg-lattice-deep/40 border border-white/10 rounded text-[11px]">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          m.kind === 'arrived'
                            ? 'bg-green-500/15 text-green-300'
                            : m.kind === 'departed'
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'bg-amber-500/15 text-amber-300'
                        }`}
                      >
                        {m.kind}
                      </span>
                      <span className="text-white">{m.geofenceName}</span>
                      <span className="ml-auto text-gray-400">
                        {new Date(m.at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-gray-400 mt-0.5">
                      {m.shipmentId}
                      {m.dwellMinutes != null ? ` · dwell ${m.dwellMinutes} min` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Freight-cost audit
// ===========================================================================
function FreightPanel() {
  const [invoices, setInvoices] = useState<FreightInvoice[]>([]);
  const [summary, setSummary] = useState<FreightSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    invoiceNumber: '',
    carrierId: '',
    quotedAmountUsd: '',
    invoicedAmountUsd: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, sum] = await Promise.all([
        lensRun('logistics', 'freight-invoices-list', {}),
        lensRun('logistics', 'freight-audit-summary', {}),
      ]);
      if (inv.data?.ok) setInvoices((inv.data.result?.invoices || []) as FreightInvoice[]);
      if (sum.data?.ok) setSummary(sum.data.result as FreightSummary);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function audit() {
    setErr('');
    const r = await lensRun('logistics', 'freight-invoice-audit', {
      invoiceNumber: form.invoiceNumber.trim(),
      carrierId: form.carrierId.trim(),
      quotedAmountUsd: Number(form.quotedAmountUsd),
      invoicedAmountUsd: Number(form.invoicedAmountUsd),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'audit failed'); return; }
    setForm({ invoiceNumber: '', carrierId: '', quotedAmountUsd: '', invoicedAmountUsd: '' });
    await refresh();
  }

  async function dispute(id: string, action: string) {
    await lensRun('logistics', 'freight-invoice-dispute', { id, action });
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
        <p className="text-[10px] uppercase font-semibold text-gray-400">
          Reconcile invoice vs quoted rate
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} placeholder="Invoice #" className={INPUT} />
          <input value={form.carrierId} onChange={(e) => setForm({ ...form, carrierId: e.target.value })} placeholder="Carrier ID" className={INPUT} />
          <input value={form.quotedAmountUsd} onChange={(e) => setForm({ ...form, quotedAmountUsd: e.target.value })} placeholder="Quoted $" className={INPUT} />
          <input value={form.invoicedAmountUsd} onChange={(e) => setForm({ ...form, invoicedAmountUsd: e.target.value })} placeholder="Invoiced $" className={INPUT} />
        </div>
        <button onClick={audit} disabled={!form.invoiceNumber.trim()} className={BTN}>
          <Receipt className="w-3 h-3" /> Audit invoice
        </button>
      </div>

      {err && <ErrLine msg={err} />}

      {summary && summary.invoiceCount > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <SumStat icon={DollarSign} label="Invoiced" value={`$${summary.totalInvoiced}`} />
          <SumStat icon={Gauge} label="Variance" value={`$${summary.totalVarianceUsd}`} />
          <SumStat icon={AlertTriangle} label="Disputable" value={`$${summary.totalDisputableUsd}`} />
          <SumStat icon={Receipt} label="Overbilled" value={String(summary.overbilledCount)} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <Empty icon={Receipt} text="No freight invoices audited yet." />
      ) : (
        <ul className="space-y-2">
          {invoices.map((inv) => (
            <li key={inv.id} className="p-3 bg-lattice-deep/40 border border-white/10 rounded">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white font-mono">{inv.invoiceNumber}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    inv.status === 'approved' || inv.status === 'resolved'
                      ? 'bg-green-500/15 text-green-300'
                      : inv.status === 'disputed'
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  {inv.status}
                </span>
                <span className="ml-auto text-gray-400">
                  quoted ${inv.quotedAmountUsd} → invoiced ${inv.invoicedAmountUsd}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px]">
                <span className={inv.varianceUsd > 0 ? 'text-rose-400' : 'text-green-400'}>
                  variance ${inv.varianceUsd} ({inv.variancePct}%)
                </span>
                {inv.disputableUsd > 0 && (
                  <span className="text-amber-400">disputable ${inv.disputableUsd}</span>
                )}
                <div className="ml-auto flex gap-1">
                  {inv.status !== 'disputed' && (
                    <button
                      onClick={() => dispute(inv.id, 'dispute')}
                      className="px-2 py-0.5 text-[10px] rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                    >
                      Dispute
                    </button>
                  )}
                  {inv.status === 'disputed' && (
                    <button
                      onClick={() => dispute(inv.id, 'resolve')}
                      className="px-2 py-0.5 text-[10px] rounded bg-green-500/15 text-green-300 hover:bg-green-500/25"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SumStat({ icon: Icon, label, value }: { icon: typeof Receipt; label: string; value: string }) {
  return (
    <div className="p-2 bg-lattice-deep/40 border border-white/10 rounded text-center">
      <Icon className="w-3.5 h-3.5 text-cyan-400 mx-auto mb-0.5" />
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[9px] uppercase text-gray-400">{label}</p>
    </div>
  );
}

// ===========================================================================
// Exception management dashboard
// ===========================================================================
function ExceptionsPanel() {
  const [dash, setDash] = useState<ExceptionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    shipmentId: '',
    kind: 'delay',
    severity: 'medium',
    description: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('logistics', 'exceptions-dashboard', {});
      if (r.data?.ok) setDash(r.data.result as ExceptionDashboard);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function flag() {
    setErr('');
    const r = await lensRun('logistics', 'exceptions-flag', {
      shipmentId: form.shipmentId.trim(),
      kind: form.kind,
      severity: form.severity,
      description: form.description.trim(),
    });
    if (!r.data?.ok) { setErr(r.data?.error || 'flag failed'); return; }
    setForm({ shipmentId: '', kind: 'delay', severity: 'medium', description: '' });
    await refresh();
  }

  async function updateException(id: string, status: string) {
    await lensRun('logistics', 'exceptions-update', { id, status });
    await refresh();
  }

  return (
    <div className="space-y-3">
      <div className="p-3 bg-lattice-deep/40 border border-white/10 rounded space-y-2">
        <p className="text-[10px] uppercase font-semibold text-gray-400">Flag an at-risk load</p>
        <input
          value={form.shipmentId}
          onChange={(e) => setForm({ ...form, shipmentId: e.target.value })}
          placeholder="Shipment ID"
          className={INPUT}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={INPUT}>
            {['delay', 'damage', 'lost', 'weather', 'customs_hold', 'documentation', 'carrier_issue', 'other'].map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className={INPUT}>
            {['low', 'medium', 'high', 'critical'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Description"
          className={INPUT}
        />
        <button onClick={flag} disabled={!form.shipmentId.trim()} className={BTN}>
          <AlertTriangle className="w-3 h-3" /> Flag exception
        </button>
      </div>

      {err && <ErrLine msg={err} />}

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading dashboard…
        </div>
      ) : !dash || dash.totalExceptions === 0 ? (
        <Empty icon={AlertTriangle} text="No exceptions flagged. At-risk loads will appear here." />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <SumStat icon={AlertTriangle} label="Open" value={String(dash.openCount)} />
            <SumStat icon={CircleDot} label="Critical" value={String(dash.criticalCount)} />
            <SumStat icon={Activity} label="Escalated" value={String(dash.escalatedCount)} />
            <SumStat icon={Award} label="Resolved" value={String(dash.resolvedCount)} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">
              Triage queue (severity-ranked)
            </p>
            <ul className="space-y-2">
              {dash.triageQueue.map((e) => (
                <li key={e.id} className="p-3 bg-lattice-deep/40 border border-white/10 rounded">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-semibold uppercase ${sevColor(e.severity)}`}>
                      {e.severity}
                    </span>
                    <span className="text-white">{e.kind.replace(/_/g, ' ')}</span>
                    <span className="text-gray-400 font-mono">{e.shipmentId}</span>
                    <span className="ml-auto text-[10px] text-gray-400">{e.status}</span>
                  </div>
                  {e.description && (
                    <p className="mt-1 text-[11px] text-gray-400">{e.description}</p>
                  )}
                  <div className="mt-2 flex gap-1">
                    {e.status === 'open' && (
                      <button
                        onClick={() => updateException(e.id, 'investigating')}
                        className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                      >
                        Investigate
                      </button>
                    )}
                    {e.status !== 'escalated' && e.status !== 'resolved' && (
                      <button
                        onClick={() => updateException(e.id, 'escalated')}
                        className="px-2 py-0.5 text-[10px] rounded bg-orange-500/15 text-orange-300 hover:bg-orange-500/25"
                      >
                        Escalate
                      </button>
                    )}
                    {e.status !== 'resolved' && (
                      <button
                        onClick={() => updateException(e.id, 'resolved')}
                        className="px-2 py-0.5 text-[10px] rounded bg-green-500/15 text-green-300 hover:bg-green-500/25"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Tower shell
// ===========================================================================
export function VisibilityTower() {
  const [tab, setTab] = useState<TowerTab>('gps');

  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
        <Satellite className="w-4 h-4" /> Real-time visibility tower
      </h2>
      <nav className="flex items-center gap-1 border-b border-cyan-900/30 pb-2 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition inline-flex items-center gap-1.5 ' +
                (tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                  : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-900/10 border border-transparent')
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>
      <div>
        {tab === 'gps' && <GpsPanel />}
        {tab === 'risk' && <RiskPanel />}
        {tab === 'vrp' && <VrpPanel />}
        {tab === 'scorecard' && <ScorecardPanel />}
        {tab === 'geofence' && <GeofencePanel />}
        {tab === 'freight' && <FreightPanel />}
        {tab === 'exceptions' && <ExceptionsPanel />}
      </div>
    </section>
  );
}

export default VisibilityTower;
