'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * RmsCadConsole — production RMS/CAD console for the law-enforcement lens.
 *
 * Wires the full server/domains/lawenforcement.js macro surface into a
 * purpose-built police operations UI:
 *   - CAD: live call queue, unit status board, dispatch routing
 *   - Evidence chain-of-custody intake / transfer / chain audit
 *   - Officer roster + shift scheduling with overtime detection
 *   - Crime mapping with geospatial hotspot detection
 *   - Warrant lifecycle: issue / service attempt / return / list
 *   - Report writing with statute auto-population + supervisor approval
 *   - Field interview / arrest booking forms with print/mugshot capture
 *
 * Every value rendered comes from a real macro round-trip. No seed data.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { MapView, TimelineView, ChartKit } from '@/components/viz';
import type { MapMarker, TimelineEvent } from '@/components/viz';
import {
  Siren, Car, Radio, Boxes, CalendarClock, MapPin, Scale, FileText,
  Fingerprint, Loader2, AlertTriangle, Check, ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DOMAIN = 'law-enforcement';

async function run<T = any>(action: string, input: Record<string, unknown> = {}): Promise<{ ok: boolean; result: T | null; error: string | null }> {
  const r = await lensRun<T>(DOMAIN, action, input);
  return r.data;
}

type ConsoleTab = 'CAD' | 'Evidence' | 'Roster' | 'Crime Map' | 'Warrants' | 'Reports' | 'Booking';

const TABS: { key: ConsoleTab; label: string; icon: typeof Siren }[] = [
  { key: 'CAD', label: 'Dispatch (CAD)', icon: Radio },
  { key: 'Evidence', label: 'Evidence', icon: Boxes },
  { key: 'Roster', label: 'Roster', icon: CalendarClock },
  { key: 'Crime Map', label: 'Crime Map', icon: MapPin },
  { key: 'Warrants', label: 'Warrants', icon: Scale },
  { key: 'Reports', label: 'Reports', icon: FileText },
  { key: 'Booking', label: 'Booking', icon: Fingerprint },
];

// ---- shared primitives ----------------------------------------------------

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</span>
      <input
        {...rest}
        className="w-full mt-0.5 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

function Select({ label, options, ...rest }: { label: string; options: string[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">{label}</span>
      <select
        {...rest}
        className="w-full mt-0.5 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Btn({ children, busy, ...rest }: { children: React.ReactNode; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition-colors"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  );
}

function Banner({ feedback }: { feedback: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!feedback) return null;
  return (
    <div className={cn(
      'flex items-start gap-2 px-3 py-1.5 rounded text-[11px] border',
      feedback.kind === 'ok'
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
        : 'bg-red-500/10 text-red-300 border-red-500/30',
    )}>
      {feedback.kind === 'ok' ? <Check className="w-3 h-3 mt-0.5" /> : <AlertTriangle className="w-3 h-3 mt-0.5" />}
      <span>{feedback.text}</span>
    </div>
  );
}

const PRIORITY_TONE: Record<string, string> = {
  P1: 'text-red-400 bg-red-500/15', P2: 'text-orange-400 bg-orange-500/15',
  P3: 'text-yellow-400 bg-yellow-500/15', P4: 'text-blue-400 bg-blue-500/15',
};
const UNIT_TONE: Record<string, string> = {
  available: 'text-emerald-400 bg-emerald-500/15', dispatched: 'text-blue-400 bg-blue-500/15',
  enroute: 'text-yellow-400 bg-yellow-500/15', onscene: 'text-purple-400 bg-purple-500/15',
  unavailable: 'text-zinc-400 bg-zinc-500/15',
};

// ===========================================================================
// CAD — call queue + unit board + dispatch
// ===========================================================================

interface CadCall {
  id: string; callType: string; location: string; lat: number | null; lon: number | null;
  priority: string; callerName: string; status: string; assignedUnit: string | null; createdAt: string;
}
interface CadUnit {
  id: string; callSign: string; officerName: string; beat: string; unitType: string;
  status: string; lat: number | null; lon: number | null; currentCallId: string | null;
}

function CadTab() {
  const [queue, setQueue] = useState<CadCall[]>([]);
  const [units, setUnits] = useState<CadUnit[]>([]);
  const [byPriority, setByPriority] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [callType, setCallType] = useState('');
  const [callLoc, setCallLoc] = useState('');
  const [callLat, setCallLat] = useState('');
  const [callLon, setCallLon] = useState('');
  const [callPriority, setCallPriority] = useState('P3');
  const [callerName, setCallerName] = useState('');

  const [callSign, setCallSign] = useState('');
  const [officerName, setOfficerName] = useState('');
  const [unitBeat, setUnitBeat] = useState('');
  const [unitLat, setUnitLat] = useState('');
  const [unitLon, setUnitLon] = useState('');

  const refresh = useCallback(async () => {
    const [q, b] = await Promise.all([
      run<{ queue: CadCall[]; byPriority: Record<string, number> }>('cadCallQueue'),
      run<{ units: CadUnit[] }>('cadUnitBoard'),
    ]);
    if (q.ok && q.result) { setQueue(q.result.queue); setByPriority(q.result.byPriority); }
    if (b.ok && b.result) setUnits(b.result.units);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function createCall() {
    if (!callType.trim() || !callLoc.trim()) { setFeedback({ kind: 'err', text: 'Call type and location required.' }); return; }
    setBusy('call'); setFeedback(null);
    const r = await run('cadCreateCall', {
      callType, location: callLoc, priority: callPriority, callerName,
      ...(callLat && callLon ? { lat: Number(callLat), lon: Number(callLon) } : {}),
    });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Call logged at ${callPriority}.` }); setCallType(''); setCallLoc(''); setCallerName(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Create call failed.' });
    setBusy(null);
  }

  async function registerUnit() {
    if (!callSign.trim()) { setFeedback({ kind: 'err', text: 'Call sign required.' }); return; }
    setBusy('unit'); setFeedback(null);
    const r = await run('cadRegisterUnit', {
      callSign, officerName, beat: unitBeat,
      ...(unitLat && unitLon ? { lat: Number(unitLat), lon: Number(unitLon) } : {}),
    });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Unit ${callSign} on board.` }); setCallSign(''); setOfficerName(''); setUnitBeat(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Register unit failed.' });
    setBusy(null);
  }

  async function dispatch(callId: string) {
    setBusy(callId);
    const r = await run<{ etaMinutes: number | null; unit: CadUnit }>('cadDispatchUnit', { callId });
    if (r.ok && r.result) {
      setFeedback({ kind: 'ok', text: `Routed ${r.result.unit.callSign}${r.result.etaMinutes != null ? ` · ETA ${r.result.etaMinutes}m` : ''}.` });
      await refresh();
    } else setFeedback({ kind: 'err', text: r.error || 'Dispatch failed.' });
    setBusy(null);
  }

  async function updateUnit(unitId: string, status: string) {
    setBusy(unitId);
    const r = await run('cadUpdateStatus', { unitId, status });
    if (r.ok) await refresh();
    else setFeedback({ kind: 'err', text: r.error || 'Status update failed.' });
    setBusy(null);
  }

  const markers: MapMarker[] = [
    ...queue.filter((c) => c.lat != null && c.lon != null).map((c) => ({
      id: c.id, lat: c.lat as number, lon: c.lon as number, label: c.callType,
      tone: (c.priority === 'P1' ? 'bad' : c.priority === 'P2' ? 'warn' : 'info') as MapMarker['tone'],
    })),
    ...units.filter((u) => u.lat != null && u.lon != null).map((u) => ({
      id: u.id, lat: u.lat as number, lon: u.lon as number, label: u.callSign,
      tone: 'good' as MapMarker['tone'],
    })),
  ];

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => (
          <div key={p} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
            <p className={cn('text-xl font-bold', PRIORITY_TONE[p].split(' ')[0])}>{byPriority[p] || 0}</p>
            <p className="text-[10px] text-zinc-400">{p} active calls</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Siren className="w-3.5 h-3.5 text-red-400" /> New 911 Call</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Call type" value={callType} onChange={(e) => setCallType(e.target.value)} placeholder="Burglary in progress" />
            <Select label="Priority" options={['P1', 'P2', 'P3', 'P4']} value={callPriority} onChange={(e) => setCallPriority(e.target.value)} />
            <Field label="Location" value={callLoc} onChange={(e) => setCallLoc(e.target.value)} placeholder="1200 Market St" />
            <Field label="Caller name" value={callerName} onChange={(e) => setCallerName(e.target.value)} placeholder="optional" />
            <Field label="Latitude" value={callLat} onChange={(e) => setCallLat(e.target.value)} placeholder="37.77" type="number" />
            <Field label="Longitude" value={callLon} onChange={(e) => setCallLon(e.target.value)} placeholder="-122.41" type="number" />
          </div>
          <Btn busy={busy === 'call'} onClick={createCall}><Siren className="w-3.5 h-3.5" /> Log Call</Btn>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Car className="w-3.5 h-3.5 text-emerald-400" /> Register Unit</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Call sign" value={callSign} onChange={(e) => setCallSign(e.target.value)} placeholder="Adam-12" />
            <Field label="Officer" value={officerName} onChange={(e) => setOfficerName(e.target.value)} placeholder="Officer name" />
            <Field label="Beat" value={unitBeat} onChange={(e) => setUnitBeat(e.target.value)} placeholder="Beat 4" />
            <div />
            <Field label="Latitude" value={unitLat} onChange={(e) => setUnitLat(e.target.value)} placeholder="37.78" type="number" />
            <Field label="Longitude" value={unitLon} onChange={(e) => setUnitLon(e.target.value)} placeholder="-122.42" type="number" />
          </div>
          <Btn busy={busy === 'unit'} onClick={registerUnit}><Car className="w-3.5 h-3.5" /> Add Unit</Btn>
        </div>
      </div>

      {markers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white mb-1">Live CAD Map</h4>
          <MapView markers={markers} height={240} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-white mb-1.5">Call Queue ({queue.length})</h4>
          <div className="space-y-1.5">
            {queue.map((c) => (
              <div key={c.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold', PRIORITY_TONE[c.priority])}>{c.priority}</span>
                    <span className="text-xs font-semibold text-white truncate">{c.callType}</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 truncate">{c.location} · {c.status}{c.assignedUnit ? ' · assigned' : ''}</p>
                </div>
                {c.status === 'pending' && (
                  <Btn busy={busy === c.id} onClick={() => dispatch(c.id)}><Radio className="w-3 h-3" /> Dispatch</Btn>
                )}
              </div>
            ))}
            {queue.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No active calls.</p>}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-white mb-1.5">Unit Status Board ({units.length})</h4>
          <div className="space-y-1.5">
            {units.map((u) => (
              <div key={u.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-white">{u.callSign}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', UNIT_TONE[u.status])}>{u.status}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400">{u.officerName || u.beat || u.unitType}</span>
                </div>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {(['enroute', 'onscene', 'cleared', 'available', 'unavailable'] as const).map((s) => (
                    <button key={s} disabled={busy === u.id || u.status === s}
                      onClick={() => updateUnit(u.id, s)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {units.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No units registered.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Evidence chain-of-custody
// ===========================================================================

interface CustodyEntry { event: string; from: string; to: string; locker: string; signature: string; at: string; note: string; }
interface EvidenceRec {
  id: string; barcode: string; caseNumber: string; description: string; category: string;
  locker: string; status: string; currentHolder: string; intakeAt: string; custody: CustodyEntry[];
}

function EvidenceTab() {
  const [items, setItems] = useState<EvidenceRec[]>([]);
  const [byLocker, setByLocker] = useState<{ locker: string; count: number }[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; chain: CustodyEntry[]; chainIntact: boolean; barcode: string } | null>(null);

  const [desc, setDesc] = useState('');
  const [caseNo, setCaseNo] = useState('');
  const [category, setCategory] = useState('physical');
  const [locker, setLocker] = useState('');

  const [xferId, setXferId] = useState('');
  const [xferTo, setXferTo] = useState('');
  const [xferSig, setXferSig] = useState('');
  const [xferEvent, setXferEvent] = useState('transfer');
  const [xferLocker, setXferLocker] = useState('');

  const refresh = useCallback(async () => {
    const r = await run<{ evidence: EvidenceRec[]; byLocker: { locker: string; count: number }[] }>('evidenceList');
    if (r.ok && r.result) { setItems(r.result.evidence); setByLocker(r.result.byLocker); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function intake() {
    if (!desc.trim()) { setFeedback({ kind: 'err', text: 'Description required.' }); return; }
    setBusy('intake'); setFeedback(null);
    const r = await run<{ evidence: EvidenceRec }>('evidenceIntake', { description: desc, caseNumber: caseNo, category, locker });
    if (r.ok && r.result) { setFeedback({ kind: 'ok', text: `Booked ${r.result.evidence.barcode}.` }); setDesc(''); setCaseNo(''); setLocker(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Intake failed.' });
    setBusy(null);
  }

  async function transfer() {
    if (!xferId.trim() || !xferTo.trim() || !xferSig.trim()) { setFeedback({ kind: 'err', text: 'Evidence ID, recipient and signature required.' }); return; }
    setBusy('xfer'); setFeedback(null);
    const r = await run('evidenceTransfer', { evidenceId: xferId, to: xferTo, signature: xferSig, event: xferEvent, locker: xferLocker });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Custody transferred to ${xferTo}.` }); setXferTo(''); setXferSig(''); setXferLocker(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Transfer failed.' });
    setBusy(null);
  }

  async function viewChain(id: string) {
    setBusy(id);
    const r = await run<{ chain: CustodyEntry[]; chainIntact: boolean; barcode: string }>('evidenceChain', { evidenceId: id });
    if (r.ok && r.result) setSelected({ id, ...r.result });
    setBusy(null);
  }

  const chainEvents: TimelineEvent[] = (selected?.chain || []).map((c, i) => ({
    id: `${selected!.id}-${i}`, label: `${c.event}: ${c.from} → ${c.to}`, time: c.at,
    tone: c.event === 'destroyed' ? 'bad' : c.event === 'intake' ? 'info' : 'good',
    detail: `Locker ${c.locker} · signed ${c.signature}`,
  }));

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5 text-amber-400" /> Evidence Intake</h4>
          <Field label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="9mm shell casing" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Case number" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="24-00123" />
            <Select label="Category" options={['physical', 'digital', 'biological', 'documentary', 'firearm', 'narcotic']} value={category} onChange={(e) => setCategory(e.target.value)} />
            <Field label="Locker" value={locker} onChange={(e) => setLocker(e.target.value)} placeholder="Locker A-12" />
          </div>
          <Btn busy={busy === 'intake'} onClick={intake}><Boxes className="w-3.5 h-3.5" /> Book Evidence</Btn>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-blue-400" /> Custody Transfer</h4>
          <Field label="Evidence ID" value={xferId} onChange={(e) => setXferId(e.target.value)} placeholder="ev_..." />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Recipient" value={xferTo} onChange={(e) => setXferTo(e.target.value)} placeholder="Forensics Lab" />
            <Field label="Signature" value={xferSig} onChange={(e) => setXferSig(e.target.value)} placeholder="Det. Wells" />
            <Select label="Event" options={['transfer', 'release', 'destroyed']} value={xferEvent} onChange={(e) => setXferEvent(e.target.value)} />
            <Field label="New locker" value={xferLocker} onChange={(e) => setXferLocker(e.target.value)} placeholder="optional" />
          </div>
          <Btn busy={busy === 'xfer'} onClick={transfer}><Radio className="w-3.5 h-3.5" /> Record Transfer</Btn>
        </div>
      </div>

      {byLocker.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {byLocker.map((l) => (
            <span key={l.locker} className="text-[10px] px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
              {l.locker}: <span className="text-white font-semibold">{l.count}</span>
            </span>
          ))}
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-white mb-1.5">Evidence Inventory ({items.length})</h4>
        <div className="space-y-1.5">
          {items.map((e) => (
            <div key={e.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{e.barcode}</span>
                  <span className="text-xs font-semibold text-white truncate">{e.description}</span>
                </div>
                <p className="text-[10px] text-zinc-400 truncate">{e.caseNumber || 'no case'} · {e.locker} · holder {e.currentHolder} · {e.status}</p>
                <p className="text-[9px] text-zinc-400 font-mono">{e.id}</p>
              </div>
              <Btn busy={busy === e.id} onClick={() => viewChain(e.id)}><Scale className="w-3 h-3" /> Chain</Btn>
            </div>
          ))}
          {items.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No evidence booked.</p>}
        </div>
      </div>

      {selected && (
        <div className={cn('rounded-lg border p-3', selected.chainIntact ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-white">Chain of Custody · {selected.barcode}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', selected.chainIntact ? 'text-emerald-300 bg-emerald-500/20' : 'text-red-300 bg-red-500/20')}>
              {selected.chainIntact ? 'INTACT' : 'BROKEN'}
            </span>
          </div>
          <TimelineView events={chainEvents} height={110} />
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Officer roster + scheduling
// ===========================================================================

interface ShiftRec { id: string; date: string; shift: string; beat: string; hours: number; }
interface RosterRow {
  officerId: string; name: string; badgeNumber: string; rank: string; beat: string;
  shifts: ShiftRec[]; shiftCount: number; totalHours: number; weeklyHours: number; overtimeHours: number;
}

function RosterTab() {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [summary, setSummary] = useState<{ officersOnOvertime: number; totalOvertimeHours: number }>({ officersOnOvertime: 0, totalOvertimeHours: 0 });
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [rank, setRank] = useState('Officer');
  const [beat, setBeat] = useState('');
  const [defaultShift, setDefaultShift] = useState('day');

  const [shiftOfficer, setShiftOfficer] = useState('');
  const [shiftDate, setShiftDate] = useState('');
  const [shiftHours, setShiftHours] = useState('8');
  const [shiftType, setShiftType] = useState('day');
  const [shiftBeat, setShiftBeat] = useState('');

  const refresh = useCallback(async () => {
    const r = await run<{ roster: RosterRow[]; officersOnOvertime: number; totalOvertimeHours: number }>('rosterBoard');
    if (r.ok && r.result) {
      setRoster(r.result.roster);
      setSummary({ officersOnOvertime: r.result.officersOnOvertime, totalOvertimeHours: r.result.totalOvertimeHours });
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function addOfficer() {
    if (!name.trim()) { setFeedback({ kind: 'err', text: 'Officer name required.' }); return; }
    setBusy('add'); setFeedback(null);
    const r = await run('rosterAddOfficer', { name, badgeNumber: badge, rank, beat, defaultShift });
    if (r.ok) { setFeedback({ kind: 'ok', text: `${name} added to roster.` }); setName(''); setBadge(''); setBeat(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Add officer failed.' });
    setBusy(null);
  }

  async function scheduleShift() {
    if (!shiftOfficer.trim() || !shiftDate.trim()) { setFeedback({ kind: 'err', text: 'Officer ID and date required.' }); return; }
    setBusy('sched'); setFeedback(null);
    const r = await run<{ dayOvertime: number }>('scheduleShift', {
      officerId: shiftOfficer, date: shiftDate, hours: Number(shiftHours), shift: shiftType, beat: shiftBeat,
    });
    if (r.ok && r.result) {
      setFeedback({ kind: 'ok', text: `Shift scheduled.${r.result.dayOvertime > 0 ? ` ⚠ ${r.result.dayOvertime}h daily overtime.` : ''}` });
      await refresh();
    } else setFeedback({ kind: 'err', text: r.error || 'Schedule failed.' });
    setBusy(null);
  }

  const chartData = roster.map((r) => ({ name: r.name, weekly: r.weeklyHours, overtime: r.overtimeHours }));

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-amber-400">{summary.officersOnOvertime}</p>
          <p className="text-[10px] text-zinc-400">officers on overtime</p>
        </div>
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-red-400">{summary.totalOvertimeHours}h</p>
          <p className="text-[10px] text-zinc-400">total overtime hours</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-blue-400" /> Add Officer</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="J. Reyes" />
            <Field label="Badge" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="optional" />
            <Field label="Rank" value={rank} onChange={(e) => setRank(e.target.value)} placeholder="Officer" />
            <Field label="Beat" value={beat} onChange={(e) => setBeat(e.target.value)} placeholder="Beat 4" />
            <Select label="Default shift" options={['day', 'swing', 'night']} value={defaultShift} onChange={(e) => setDefaultShift(e.target.value)} />
          </div>
          <Btn busy={busy === 'add'} onClick={addOfficer}><CalendarClock className="w-3.5 h-3.5" /> Add Officer</Btn>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5 text-emerald-400" /> Schedule Shift</h4>
          <Field label="Officer ID" value={shiftOfficer} onChange={(e) => setShiftOfficer(e.target.value)} placeholder="ofc_..." />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} type="date" />
            <Field label="Hours" value={shiftHours} onChange={(e) => setShiftHours(e.target.value)} type="number" />
            <Select label="Shift" options={['day', 'swing', 'night']} value={shiftType} onChange={(e) => setShiftType(e.target.value)} />
            <Field label="Beat" value={shiftBeat} onChange={(e) => setShiftBeat(e.target.value)} placeholder="optional" />
          </div>
          <Btn busy={busy === 'sched'} onClick={scheduleShift}><CalendarClock className="w-3.5 h-3.5" /> Schedule</Btn>
        </div>
      </div>

      {chartData.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white mb-1">Weekly Hours vs Overtime</h4>
          <ChartKit kind="bar" data={chartData} xKey="name" series={[
            { key: 'weekly', label: 'Weekly hrs', color: '#3b82f6' },
            { key: 'overtime', label: 'Overtime hrs', color: '#ef4444' },
          ]} height={220} />
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-white mb-1.5">Roster ({roster.length})</h4>
        <div className="space-y-1.5">
          {roster.map((r) => (
            <div key={r.officerId} className={cn('p-2.5 rounded-lg border', r.overtimeHours > 0 ? 'bg-red-500/5 border-red-500/30' : 'bg-zinc-900 border-zinc-800')}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-white">{r.name}</span>
                  <span className="text-[10px] text-zinc-400 ml-2">{r.rank} · {r.badgeNumber} · {r.beat || 'no beat'}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-white">{r.weeklyHours}h / wk</span>
                  {r.overtimeHours > 0 && <span className="text-[10px] text-red-400 ml-2">+{r.overtimeHours}h OT</span>}
                </div>
              </div>
              <p className="text-[9px] text-zinc-400 font-mono">{r.officerId} · {r.shiftCount} shift(s)</p>
            </div>
          ))}
          {roster.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No officers on roster.</p>}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Crime mapping + hotspots
// ===========================================================================

interface MapIncident { id: string; type: string; lat: number; lon: number; address: string; severity: string; occurredAt: string; }
interface Hotspot { centerLat: number; centerLon: number; incidentCount: number; incidentIds: string[]; }

function CrimeMapTab() {
  const [incidents, setIncidents] = useState<MapIncident[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [byType, setByType] = useState<{ type: string; count: number }[]>([]);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [type, setType] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [address, setAddress] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [radius, setRadius] = useState('0.5');
  const [threshold, setThreshold] = useState('3');

  const refresh = useCallback(async (r = radius, t = threshold) => {
    const res = await run<{ incidents: MapIncident[]; hotspots: Hotspot[]; byType: { type: string; count: number }[] }>('crimeMap', { radiusKm: Number(r), threshold: Number(t) });
    if (res.ok && res.result) { setIncidents(res.result.incidents); setHotspots(res.result.hotspots); setByType(res.result.byType); }
  }, [radius, threshold]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function addIncident() {
    if (!type.trim() || !lat || !lon) { setFeedback({ kind: 'err', text: 'Type, lat and lon required.' }); return; }
    setBusy('add'); setFeedback(null);
    const r = await run('mapAddIncident', { type, lat: Number(lat), lon: Number(lon), address, severity });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Incident plotted.` }); setType(''); setLat(''); setLon(''); setAddress(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Add incident failed.' });
    setBusy(null);
  }

  const sevTone: Record<string, MapMarker['tone']> = { low: 'info', medium: 'warn', high: 'bad' };
  const markers: MapMarker[] = [
    ...incidents.map((i) => ({ id: i.id, lat: i.lat, lon: i.lon, label: i.type, tone: sevTone[i.severity] || 'default' })),
    ...hotspots.map((h, idx) => ({
      id: `hs-${idx}`, lat: h.centerLat, lon: h.centerLon, label: `Hotspot ×${h.incidentCount}`,
      value: Math.min(1, h.incidentCount / 10),
    })),
  ];

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-red-400" /> Plot Incident</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type" value={type} onChange={(e) => setType(e.target.value)} placeholder="auto theft" />
            <Select label="Severity" options={['low', 'medium', 'high']} value={severity} onChange={(e) => setSeverity(e.target.value)} />
            <Field label="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} type="number" placeholder="37.77" />
            <Field label="Longitude" value={lon} onChange={(e) => setLon(e.target.value)} type="number" placeholder="-122.41" />
            <Field label="Address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optional" />
          </div>
          <Btn busy={busy === 'add'} onClick={addIncident}><MapPin className="w-3.5 h-3.5" /> Plot Incident</Btn>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
          <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Hotspot Detection</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cell radius (km)" value={radius} onChange={(e) => setRadius(e.target.value)} type="number" step="0.1" />
            <Field label="Threshold (count)" value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" />
          </div>
          <Btn busy={busy === 'scan'} onClick={async () => { setBusy('scan'); try { await refresh(radius, threshold); } finally { setBusy(null); } }}>
            <ShieldAlert className="w-3.5 h-3.5" /> Re-scan
          </Btn>
          <div className="text-[11px] text-zinc-400">
            <span className="text-white font-semibold">{hotspots.length}</span> hotspot(s) detected across <span className="text-white font-semibold">{incidents.length}</span> incident(s).
          </div>
        </div>
      </div>

      {markers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-white mb-1">Crime Heatmap</h4>
          <MapView markers={markers} height={280} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {byType.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-white mb-1">Incidents by Type</h4>
            <ChartKit kind="bar" data={byType} xKey="type" series={[{ key: 'count', label: 'Count', color: '#ef4444' }]} height={200} />
          </div>
        )}
        <div>
          <h4 className="text-xs font-semibold text-white mb-1.5">Detected Hotspots</h4>
          <div className="space-y-1.5">
            {hotspots.map((h, i) => (
              <div key={i} className="p-2.5 bg-red-500/5 rounded-lg border border-red-500/30">
                <span className="text-xs font-semibold text-red-300">×{h.incidentCount} incidents</span>
                <span className="text-[10px] text-zinc-400 ml-2 font-mono">{h.centerLat}, {h.centerLon}</span>
              </div>
            ))}
            {hotspots.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No hotspots above threshold.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Warrant lifecycle
// ===========================================================================

interface WarrantAttempt { id: string; at: string; officer: string; location: string; outcome: string; note: string; }
interface WarrantRec {
  id: string; warrantNumber: string; subject: string; warrantType: string; caseNumber: string;
  charges: string; status: string; issuedAt: string; expiresAt: string; attempts: WarrantAttempt[]; returnedAt: string | null;
}

function WarrantsTab() {
  const [warrants, setWarrants] = useState<WarrantRec[]>([]);
  const [summary, setSummary] = useState<{ active: number; expiringSoon: number }>({ active: 0, expiringSoon: 0 });
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [warrantType, setWarrantType] = useState('arrest');
  const [caseNo, setCaseNo] = useState('');
  const [charges, setCharges] = useState('');
  const [judge, setJudge] = useState('');
  const [validDays, setValidDays] = useState('90');

  const refresh = useCallback(async () => {
    const r = await run<{ warrants: WarrantRec[]; active: number; expiringSoon: number }>('warrantList');
    if (r.ok && r.result) { setWarrants(r.result.warrants); setSummary({ active: r.result.active, expiringSoon: r.result.expiringSoon }); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function issue() {
    if (!subject.trim()) { setFeedback({ kind: 'err', text: 'Subject required.' }); return; }
    setBusy('issue'); setFeedback(null);
    const r = await run<{ warrant: WarrantRec }>('warrantIssue', { subject, warrantType, caseNumber: caseNo, charges, issuingJudge: judge, validDays: Number(validDays) });
    if (r.ok && r.result) { setFeedback({ kind: 'ok', text: `Issued ${r.result.warrant.warrantNumber}.` }); setSubject(''); setCharges(''); setJudge(''); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Issue failed.' });
    setBusy(null);
  }

  async function attempt(warrantId: string, outcome: string) {
    setBusy(warrantId);
    const r = await run('warrantServiceAttempt', { warrantId, outcome });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Service attempt: ${outcome}.` }); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Attempt failed.' });
    setBusy(null);
  }

  async function returnWarrant(warrantId: string, disposition: string) {
    setBusy(warrantId);
    const r = await run('warrantReturn', { warrantId, disposition });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Warrant returned: ${disposition}.` }); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Return failed.' });
    setBusy(null);
  }

  const statusTone: Record<string, string> = {
    active: 'text-blue-400 bg-blue-500/15', served: 'text-emerald-400 bg-emerald-500/15',
    expired: 'text-zinc-400 bg-zinc-500/15', recalled: 'text-orange-400 bg-orange-500/15',
    quashed: 'text-purple-400 bg-purple-500/15',
  };

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-blue-400">{summary.active}</p>
          <p className="text-[10px] text-zinc-400">active warrants</p>
        </div>
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-amber-400">{summary.expiringSoon}</p>
          <p className="text-[10px] text-zinc-400">expiring within 7 days</p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Scale className="w-3.5 h-3.5 text-purple-400" /> Issue Warrant</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Field label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="John Doe" />
          <Select label="Type" options={['arrest', 'search', 'bench']} value={warrantType} onChange={(e) => setWarrantType(e.target.value)} />
          <Field label="Case number" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="24-00123" />
          <Field label="Charges" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="robbery, assault" />
          <Field label="Issuing judge" value={judge} onChange={(e) => setJudge(e.target.value)} placeholder="Hon. Patel" />
          <Field label="Valid (days)" value={validDays} onChange={(e) => setValidDays(e.target.value)} type="number" />
        </div>
        <Btn busy={busy === 'issue'} onClick={issue}><Scale className="w-3.5 h-3.5" /> Issue Warrant</Btn>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white mb-1.5">Warrant Register ({warrants.length})</h4>
        <div className="space-y-1.5">
          {warrants.map((w) => (
            <div key={w.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">{w.warrantNumber}</span>
                    <span className="text-xs font-semibold text-white truncate">{w.subject}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', statusTone[w.status] || 'text-zinc-400 bg-zinc-500/15')}>{w.status}</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 truncate">{w.warrantType} · {w.charges || 'no charges'} · {w.attempts.length} attempt(s) · expires {new Date(w.expiresAt).toLocaleDateString()}</p>
                  <p className="text-[9px] text-zinc-400 font-mono">{w.id}</p>
                </div>
              </div>
              {w.status === 'active' && (
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {(['served', 'not_home', 'refused', 'failed'] as const).map((o) => (
                    <button key={o} disabled={busy === w.id} onClick={() => attempt(w.id, o)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-300 transition-colors">
                      attempt: {o}
                    </button>
                  ))}
                  {(['recalled', 'quashed'] as const).map((d) => (
                    <button key={d} disabled={busy === w.id} onClick={() => returnWarrant(w.id, d)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-orange-900/40 hover:bg-orange-900/60 disabled:opacity-30 text-orange-300 transition-colors">
                      return: {d}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {warrants.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No warrants on file.</p>}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Report writing + supervisor approval
// ===========================================================================

interface StatuteRef { code: string; title: string; class: string; }
interface ReportRec {
  id: string; reportNumber: string; caseNumber: string; offense: string; narrative: string;
  location: string; officer: string; statute: StatuteRef | null; status: string;
  approvedBy: string | null; supervisorNote: string | null; createdAt: string;
}

function ReportsTab() {
  const [reports, setReports] = useState<ReportRec[]>([]);
  const [pending, setPending] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [offense, setOffense] = useState('');
  const [narrative, setNarrative] = useState('');
  const [location, setLocation] = useState('');
  const [caseNo, setCaseNo] = useState('');
  const [supervisor, setSupervisor] = useState('');

  const refresh = useCallback(async () => {
    const r = await run<{ reports: ReportRec[]; pendingApproval: number }>('reportList');
    if (r.ok && r.result) { setReports(r.result.reports); setPending(r.result.pendingApproval); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function draft() {
    if (!offense.trim() || !narrative.trim()) { setFeedback({ kind: 'err', text: 'Offense and narrative required.' }); return; }
    setBusy('draft'); setFeedback(null);
    const r = await run<{ statuteFound: boolean }>('reportDraft', { offense, narrative, location, caseNumber: caseNo });
    if (r.ok && r.result) {
      setFeedback({ kind: 'ok', text: `Report drafted.${r.result.statuteFound ? ' Statute auto-populated.' : ' No statute matched.'}` });
      setOffense(''); setNarrative(''); setLocation(''); setCaseNo(''); await refresh();
    } else setFeedback({ kind: 'err', text: r.error || 'Draft failed.' });
    setBusy(null);
  }

  async function submit(reportId: string) {
    setBusy(reportId);
    const r = await run('reportSubmit', { reportId });
    if (r.ok) { setFeedback({ kind: 'ok', text: 'Report submitted for review.' }); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Submit failed.' });
    setBusy(null);
  }

  async function review(reportId: string, decision: string) {
    setBusy(reportId);
    const r = await run('reportApprove', { reportId, decision, supervisor });
    if (r.ok) { setFeedback({ kind: 'ok', text: `Report ${decision === 'reject' ? 'rejected' : 'approved'}.` }); await refresh(); }
    else setFeedback({ kind: 'err', text: r.error || 'Review failed.' });
    setBusy(null);
  }

  const statusTone: Record<string, string> = {
    draft: 'text-zinc-400 bg-zinc-500/15', submitted: 'text-yellow-400 bg-yellow-500/15',
    approved: 'text-emerald-400 bg-emerald-500/15', rejected: 'text-red-400 bg-red-500/15',
  };

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800 inline-block">
        <p className="text-xl font-bold text-yellow-400">{pending}</p>
        <p className="text-[10px] text-zinc-400">reports awaiting supervisor approval</p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-amber-400" /> Write Report</h4>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Offense" value={offense} onChange={(e) => setOffense(e.target.value)} placeholder="grand theft auto" />
          <Field label="Case number" value={caseNo} onChange={(e) => setCaseNo(e.target.value)} placeholder="24-00123" />
          <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="3rd & Main" />
          <Field label="Supervisor (for review)" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} placeholder="Sgt. Cole" />
        </div>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Narrative</span>
          <textarea value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={4}
            className="w-full mt-0.5 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
            placeholder="On the above date and time, officer responded to..." />
        </label>
        <Btn busy={busy === 'draft'} onClick={draft}><FileText className="w-3.5 h-3.5" /> Draft Report</Btn>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white mb-1.5">Reports ({reports.length})</h4>
        <div className="space-y-1.5">
          {reports.map((r) => (
            <div key={r.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{r.reportNumber}</span>
                <span className="text-xs font-semibold text-white">{r.offense}</span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', statusTone[r.status])}>{r.status}</span>
                {r.statute && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                    {r.statute.code} · {r.statute.title} ({r.statute.class})
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{r.narrative}</p>
              <p className="text-[9px] text-zinc-400 font-mono">{r.id}{r.approvedBy ? ` · reviewed by ${r.approvedBy}` : ''}{r.supervisorNote ? ` · ${r.supervisorNote}` : ''}</p>
              <div className="flex gap-1 mt-1.5">
                {(r.status === 'draft' || r.status === 'rejected') && (
                  <button disabled={busy === r.id} onClick={() => submit(r.id)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/50 hover:bg-blue-900/70 disabled:opacity-30 text-blue-300 transition-colors">
                    submit for review
                  </button>
                )}
                {r.status === 'submitted' && (
                  <>
                    <button disabled={busy === r.id} onClick={() => review(r.id, 'approve')}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/50 hover:bg-emerald-900/70 disabled:opacity-30 text-emerald-300 transition-colors">
                      approve
                    </button>
                    <button disabled={busy === r.id} onClick={() => review(r.id, 'reject')}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/50 hover:bg-red-900/70 disabled:opacity-30 text-red-300 transition-colors">
                      reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {reports.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No reports written.</p>}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Field interview / arrest booking
// ===========================================================================

interface BookingRec {
  id: string; kind: string; bookingNumber: string; subjectName: string; dob: string; sex: string;
  charges: string[]; statutes: StatuteRef[]; mugshotCaptured: boolean; printsCaptured: boolean;
  officer: string; status: string; createdAt: string; location: string;
}

function BookingTab() {
  const [bookings, setBookings] = useState<BookingRec[]>([]);
  const [summary, setSummary] = useState<{ arrests: number; fieldInterviews: number }>({ arrests: 0, fieldInterviews: 0 });
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [kind, setKind] = useState('arrest');
  const [subjectName, setSubjectName] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState('');
  const [charges, setCharges] = useState('');
  const [mugshot, setMugshot] = useState(false);
  const [prints, setPrints] = useState(false);

  const refresh = useCallback(async () => {
    const r = await run<{ bookings: BookingRec[]; arrests: number; fieldInterviews: number }>('bookingList');
    if (r.ok && r.result) { setBookings(r.result.bookings); setSummary({ arrests: r.result.arrests, fieldInterviews: r.result.fieldInterviews }); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function createBooking() {
    if (!subjectName.trim()) { setFeedback({ kind: 'err', text: 'Subject name required.' }); return; }
    setBusy('create'); setFeedback(null);
    const r = await run<{ complete: boolean; missingFields: string[] }>('bookingCreate', {
      kind, subjectName, dob, sex, address, location,
      charges: charges.split(',').map((c) => c.trim()).filter(Boolean),
      mugshotCaptured: mugshot, printsCaptured: prints,
    });
    if (r.ok && r.result) {
      setFeedback({
        kind: r.result.complete ? 'ok' : 'err',
        text: r.result.complete ? 'Booking complete.' : `Booking logged — missing: ${r.result.missingFields.join(', ')}.`,
      });
      setSubjectName(''); setDob(''); setSex(''); setAddress(''); setLocation(''); setCharges(''); setMugshot(false); setPrints(false);
      await refresh();
    } else setFeedback({ kind: 'err', text: r.error || 'Booking failed.' });
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <Banner feedback={feedback} />
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-red-400">{summary.arrests}</p>
          <p className="text-[10px] text-zinc-400">arrest bookings</p>
        </div>
        <div className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
          <p className="text-xl font-bold text-blue-400">{summary.fieldInterviews}</p>
          <p className="text-[10px] text-zinc-400">field interviews</p>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <h4 className="text-xs font-semibold text-white flex items-center gap-1.5"><Fingerprint className="w-3.5 h-3.5 text-emerald-400" /> New Booking / Field Interview</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Select label="Kind" options={['arrest', 'field_interview']} value={kind} onChange={(e) => setKind(e.target.value)} />
          <Field label="Subject name" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="Jane Doe" />
          <Field label="DOB" value={dob} onChange={(e) => setDob(e.target.value)} type="date" />
          <Field label="Sex" value={sex} onChange={(e) => setSex(e.target.value)} placeholder="F / M / X" />
          <Field label="Address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="optional" />
          <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="scene location" />
        </div>
        <Field label="Charges (comma-separated)" value={charges} onChange={(e) => setCharges(e.target.value)} placeholder="burglary, vandalism" />
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={mugshot} onChange={(e) => setMugshot(e.target.checked)} className="accent-blue-500" />
            Mugshot captured
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={prints} onChange={(e) => setPrints(e.target.checked)} className="accent-blue-500" />
            Prints captured
          </label>
        </div>
        <Btn busy={busy === 'create'} onClick={createBooking}><Fingerprint className="w-3.5 h-3.5" /> Create Booking</Btn>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-white mb-1.5">Booking Log ({bookings.length})</h4>
        <div className="space-y-1.5">
          {bookings.map((b) => (
            <div key={b.id} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{b.bookingNumber}</span>
                <span className="text-xs font-semibold text-white">{b.subjectName}</span>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', b.kind === 'arrest' ? 'text-red-400 bg-red-500/15' : 'text-blue-400 bg-blue-500/15')}>
                  {b.kind.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-zinc-400">{b.mugshotCaptured ? '📷' : '○'} mugshot · {b.printsCaptured ? '☑' : '○'} prints</span>
              </div>
              {b.charges.length > 0 && (
                <p className="text-[10px] text-zinc-400 mt-1">Charges: {b.charges.join(', ')}</p>
              )}
              {b.statutes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {b.statutes.map((s, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">{s.code} {s.title}</span>
                  ))}
                </div>
              )}
              <p className="text-[9px] text-zinc-400 font-mono mt-0.5">{b.id} · {b.status}</p>
            </div>
          ))}
          {bookings.length === 0 && <p className="text-[11px] text-zinc-400 py-4 text-center">No bookings logged.</p>}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Console shell
// ===========================================================================

export function RmsCadConsole() {
  const [tab, setTab] = useState<ConsoleTab>('CAD');

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <ShieldAlert className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">RMS / CAD Console</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          dispatch · evidence · roster · mapping · warrants · reports · booking
        </span>
      </header>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
              tab === key ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
            )}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'CAD' && <CadTab />}
      {tab === 'Evidence' && <EvidenceTab />}
      {tab === 'Roster' && <RosterTab />}
      {tab === 'Crime Map' && <CrimeMapTab />}
      {tab === 'Warrants' && <WarrantsTab />}
      {tab === 'Reports' && <ReportsTab />}
      {tab === 'Booking' && <BookingTab />}
    </div>
  );
}
