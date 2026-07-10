'use client';

/**
 * SensorGroundingPanel — the embodied "reality anchoring" system.
 *
 * This is a DIFFERENT backend substrate than the fact-check workbench
 * (`FactGroundingWorkbench` / `ClaimVerificationPanel`, which call the
 * stateless + STATE-backed macros in `server/domains/grounding.js`). This
 * panel wires the OTHER `grounding`-domain system — registered inline in
 * `server/server.js` (~line 13449, `ensureGroundingEngine`) and reached via
 * the flat `/api/grounding/*` REST routes, not `/api/lens/run`:
 *
 *   register_sensor / list_sensors / record_reading / recent_readings
 *   ground_dtu / link_calendar / propose_action / pending_actions /
 *   approve_action / status / context
 *
 * It's a manual sensor journal + DTU-to-real-world anchoring log + a
 * consent-gated action-proposal workflow (GROUNDING_INVARIANTS.ACTION_CONSENT
 * — every action sits in `pending_actions` until an owner/admin/founder
 * approves it; approval is server-ACL-gated, so a non-admin caller gets a
 * real, honestly-surfaced 403 here, never a silently-faked success).
 *
 * No fabricated confidence scores or "last checked Ns ago" timestamps
 * anywhere in this panel — every number traces to a live macro response.
 */

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Antenna, Plus, Thermometer, Droplets, Globe, CalendarPlus, ShieldCheck,
  Loader2, Check, AlertTriangle, Clock, Radio,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';

interface Sensor {
  id: string; name: string; type: string; unit?: string;
  lastReading?: number; status?: string;
}
interface Reading {
  sensorId: string; sensorName?: string; sensor?: string; value: number | string;
  unit?: string; timestamp?: string;
}
interface StatusInfo {
  sensors?: number; readings?: number; groundedDtus?: number;
  pendingActions?: number; calendarEvents?: number;
  invariants?: Record<string, boolean>;
}
interface PendingAction {
  id: string; type: string; description: string; goalId?: string | null; proposedAt: string;
}

const SENSOR_TYPES = ['temperature', 'humidity', 'light', 'motion', 'location', 'time', 'calendar', 'system', 'custom'];
const ACTION_TYPES = ['notification', 'webhook', 'calendar', 'file', 'network', 'command'];

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

export function SensorGroundingPanel() {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const note = (kind: 'ok' | 'err', text: string) => setFeedback({ kind, text });

  // ---- reads --------------------------------------------------------------
  const statusQ = useQuery({ queryKey: ['grounding-status'], queryFn: () => apiHelpers.grounding.status().then((r) => r.data as StatusInfo), refetchInterval: 10000 });
  const sensorsQ = useQuery({ queryKey: ['grounding-sensors'], queryFn: () => apiHelpers.grounding.sensors().then((r) => (r.data?.sensors ?? []) as Sensor[]) });
  const readingsQ = useQuery({ queryKey: ['grounding-readings'], queryFn: () => apiHelpers.grounding.readings().then((r) => (r.data?.readings ?? []) as Reading[]), refetchInterval: 5000 });
  const contextQ = useQuery({ queryKey: ['grounding-context'], queryFn: () => apiHelpers.grounding.context().then((r) => (r.data?.context ?? {}) as Record<string, unknown>) });
  const pendingQ = useQuery({ queryKey: ['grounding-pending-actions'], queryFn: () => apiHelpers.grounding.actions.pending().then((r) => (r.data?.actions ?? []) as PendingAction[]) });

  const sensors = sensorsQ.data ?? [];
  const readings = readingsQ.data ?? [];
  const pending = pendingQ.data ?? [];
  const status = statusQ.data ?? {};

  // ---- register sensor ------------------------------------------------
  const [sName, setSName] = useState('');
  const [sType, setSType] = useState('custom');
  const [sUnit, setSUnit] = useState('');
  const registerSensor = useMutation({
    mutationFn: () => apiHelpers.grounding.registerSensor({ name: sName.trim(), type: sType, unit: sUnit.trim() }),
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'registration failed'); return; }
      note('ok', `Sensor "${sName.trim()}" registered.`);
      setSName(''); setSUnit('');
      qc.invalidateQueries({ queryKey: ['grounding-sensors'] });
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
  });

  // ---- add reading ------------------------------------------------------
  const [readingSensorId, setReadingSensorId] = useState('');
  const [readingValue, setReadingValue] = useState('');
  const [readingUnit, setReadingUnit] = useState('');
  const addReading = useMutation({
    mutationFn: () => apiHelpers.grounding.addReading({ sensorId: readingSensorId, value: parseFloat(readingValue), unit: readingUnit }),
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'reading rejected'); return; }
      note('ok', 'Reading recorded.');
      setReadingValue('');
      qc.invalidateQueries({ queryKey: ['grounding-readings'] });
      qc.invalidateQueries({ queryKey: ['grounding-sensors'] });
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
  });

  // ---- ground a DTU -------------------------------------------------------
  const [groundDtuId, setGroundDtuId] = useState('');
  const [groundContext, setGroundContext] = useState('');
  const [lastGrounding, setLastGrounding] = useState<Record<string, unknown> | null>(null);
  const groundDtu = useMutation({
    mutationFn: () => apiHelpers.grounding.ground(groundDtuId, { context: groundContext.trim() || undefined }),
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'grounding failed'); return; }
      setLastGrounding(r.data?.grounding ?? null);
      note('ok', `DTU ${groundDtuId.slice(0, 8)}… grounded.`);
      setGroundDtuId(''); setGroundContext('');
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
  });

  // ---- link calendar ------------------------------------------------------
  const [calDtuId, setCalDtuId] = useState('');
  const [calTitle, setCalTitle] = useState('');
  const [calStart, setCalStart] = useState('');
  const [lastEvent, setLastEvent] = useState<Record<string, unknown> | null>(null);
  const linkCalendar = useMutation({
    mutationFn: () => apiHelpers.grounding.linkCalendar(calDtuId, { title: calTitle.trim() || undefined, startTime: calStart || undefined }),
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'calendar link failed'); return; }
      setLastEvent(r.data?.event ?? null);
      note('ok', 'Calendar event linked.');
      setCalDtuId(''); setCalTitle(''); setCalStart('');
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
  });

  // ---- propose + approve actions (consent workflow) -----------------------
  const [actType, setActType] = useState('notification');
  const [actDesc, setActDesc] = useState('');
  const [actWebhookUrl, setActWebhookUrl] = useState('');
  const proposeAction = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      if (actType === 'webhook') payload.url = actWebhookUrl.trim();
      return apiHelpers.grounding.proposeAction({ type: actType, description: actDesc.trim(), payload });
    },
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'proposal failed'); return; }
      note('ok', r.data?.requiresConsent ? 'Action proposed — awaiting consent.' : 'Action proposed.');
      setActDesc(''); setActWebhookUrl('');
      qc.invalidateQueries({ queryKey: ['grounding-pending-actions'] });
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
  });
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const approveAction = useMutation({
    mutationFn: (actionId: string) => apiHelpers.grounding.approveAction(actionId),
    onMutate: (actionId) => setApprovingId(actionId),
    onSuccess: (r) => {
      if (r.data?.ok === false) { note('err', r.data.error || 'approval failed — owner/admin role required'); return; }
      note('ok', `Action ${r.data?.action?.status ?? 'executed'}.`);
      qc.invalidateQueries({ queryKey: ['grounding-pending-actions'] });
      qc.invalidateQueries({ queryKey: ['grounding-status'] });
    },
    onError: (e) => note('err', pickMessage(e)),
    onSettled: () => setApprovingId(null),
  });

  const refreshAll = useCallback(() => {
    statusQ.refetch(); sensorsQ.refetch(); readingsQ.refetch(); contextQ.refetch(); pendingQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = statusQ.isLoading || sensorsQ.isLoading;
  const isError = statusQ.isError || sensorsQ.isError || readingsQ.isError || contextQ.isError || pendingQ.isError;
  const errorMsg = (statusQ.error as Error)?.message || (sensorsQ.error as Error)?.message
    || (readingsQ.error as Error)?.message || (contextQ.error as Error)?.message || (pendingQ.error as Error)?.message;

  if (isLoading) {
    return (
      <div role="status" className="flex items-center gap-2 py-8 justify-center text-sm text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sensor grounding state…
      </div>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <p>{errorMsg || 'Failed to load the grounding sensor substrate.'}</p>
          <button type="button" onClick={refreshAll} className="mt-2 rounded bg-red-500/20 px-2.5 py-1 text-xs text-red-200 hover:bg-red-500/30">Retry</button>
        </div>
      </div>
    );
  }

  const invariantLabels: Record<string, string> = {
    REAL_WORLD_AWARE: 'Real-world aware', SENSOR_VALIDATED: 'Sensor validated',
    ACTION_CONSENT: 'Action consent required', TEMPORAL_ANCHORED: 'Temporal anchored',
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Antenna className="h-5 w-5 text-teal-400" />
          <h2 className="text-sm font-semibold text-white">Reality anchor — sensors &amp; consent-gated actions</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">embodied cognition</span>
        </div>
        <button type="button" onClick={refreshAll} className="text-[11px] text-teal-400 hover:underline">Refresh</button>
      </header>

      <StatTileGrid columns={5}>
        <StatTile label="Sensors" value={status.sensors ?? 0} icon={<Radio className="w-4 h-4" />} />
        <StatTile label="Readings" value={status.readings ?? 0} icon={<Droplets className="w-4 h-4" />} />
        <StatTile label="Grounded DTUs" value={status.groundedDtus ?? 0} icon={<Globe className="w-4 h-4" />} />
        <StatTile label="Pending actions" value={status.pendingActions ?? 0} icon={<ShieldCheck className="w-4 h-4" />} />
        <StatTile label="Calendar events" value={status.calendarEvents ?? 0} icon={<CalendarPlus className="w-4 h-4" />} />
      </StatTileGrid>

      {status.invariants && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(status.invariants).filter(([, v]) => v).map(([k]) => (
            <span key={k} className="rounded bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 text-[10px] text-teal-300">{invariantLabels[k] || k}</span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sensor registry + register form */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-purple-400" /> Sensors
          </h3>
          <form
            onSubmit={(e) => { e.preventDefault(); if (sName.trim() && !registerSensor.isPending) registerSensor.mutate(); }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            <label className="sr-only" htmlFor="sensor-name">Sensor name</label>
            <input id="sensor-name" value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Sensor name" className="input-lattice sm:col-span-1" />
            <label className="sr-only" htmlFor="sensor-type">Sensor type</label>
            <select id="sensor-type" value={sType} onChange={(e) => setSType(e.target.value)} className="input-lattice sm:col-span-1">
              {SENSOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="sr-only" htmlFor="sensor-unit">Unit</label>
            <input id="sensor-unit" value={sUnit} onChange={(e) => setSUnit(e.target.value)} placeholder="Unit (optional)" className="input-lattice sm:col-span-1" />
            <button type="submit" disabled={!sName.trim() || registerSensor.isPending} className="btn-neon purple sm:col-span-3 flex items-center justify-center gap-1.5">
              {registerSensor.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Register sensor
            </button>
          </form>

          {sensors.length === 0 ? (
            <EmptyState compact title="No sensors registered" description="Register a sensor above to start logging readings." />
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {sensors.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px]">
                  <span className="text-zinc-200">{s.name}</span>
                  <span className="text-zinc-400 font-mono">{s.type}{s.unit ? ` · ${s.unit}` : ''}{s.lastReading != null ? ` · ${s.lastReading}` : ''}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Add reading */}
          <form
            onSubmit={(e) => { e.preventDefault(); if (readingSensorId && readingValue && !addReading.isPending) addReading.mutate(); }}
            className="border-t border-zinc-800 pt-2 space-y-2"
          >
            <label className="sr-only" htmlFor="reading-sensor">Sensor</label>
            <select id="reading-sensor" value={readingSensorId} onChange={(e) => setReadingSensorId(e.target.value)} className="input-lattice w-full" disabled={sensors.length === 0}>
              <option value="">{sensors.length === 0 ? 'Register a sensor first…' : 'Select sensor…'}</option>
              {sensors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={readingValue} onChange={(e) => setReadingValue(e.target.value)} placeholder="Value" className="input-lattice" aria-label="Reading value" />
              <input type="text" value={readingUnit} onChange={(e) => setReadingUnit(e.target.value)} placeholder="Unit" className="input-lattice" aria-label="Reading unit" />
            </div>
            <button type="submit" disabled={!readingSensorId || !readingValue || addReading.isPending} className="btn-neon w-full flex items-center justify-center gap-1.5">
              {addReading.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add reading
            </button>
          </form>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {readings.length === 0 ? (
              <p className="text-center py-4 text-zinc-500 text-[11px]">No readings yet.</p>
            ) : readings.slice(-15).reverse().map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] rounded bg-zinc-900/40 px-2 py-1">
                <span className="font-mono text-teal-300">{r.sensorName || r.sensorId}</span>
                <span className="text-zinc-300">{String(r.value)} {r.unit}</span>
                <span className="text-zinc-500">{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ground a DTU + calendar link + context */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-cyan-400" /> Ground a DTU in real-world context
          </h3>
          <form onSubmit={(e) => { e.preventDefault(); if (groundDtuId && !groundDtu.isPending) groundDtu.mutate(); }} className="space-y-2">
            <input value={groundDtuId} onChange={(e) => setGroundDtuId(e.target.value)} placeholder="DTU ID" className="input-lattice w-full" aria-label="DTU id to ground" />
            <input value={groundContext} onChange={(e) => setGroundContext(e.target.value)} placeholder="Real-world context note (optional)" className="input-lattice w-full" aria-label="Grounding context note" />
            <button type="submit" disabled={!groundDtuId || groundDtu.isPending} className="btn-neon w-full flex items-center justify-center gap-1.5">
              {groundDtu.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />} Ground DTU
            </button>
          </form>
          {lastGrounding && (
            <p className="text-[10px] text-zinc-400">Grounded at {String(lastGrounding.groundedAt)} · confidence {String(lastGrounding.confidence)} · {Array.isArray(lastGrounding.sensorReadings) ? lastGrounding.sensorReadings.length : 0} attached readings.</p>
          )}

          <div className="border-t border-zinc-800 pt-2 space-y-2">
            <h4 className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><CalendarPlus className="w-3 h-3" /> Link to calendar</h4>
            <form onSubmit={(e) => { e.preventDefault(); if (calDtuId && !linkCalendar.isPending) linkCalendar.mutate(); }} className="space-y-2">
              <input value={calDtuId} onChange={(e) => setCalDtuId(e.target.value)} placeholder="DTU ID" className="input-lattice w-full" aria-label="DTU id to link" />
              <div className="grid grid-cols-2 gap-2">
                <input value={calTitle} onChange={(e) => setCalTitle(e.target.value)} placeholder="Event title" className="input-lattice" aria-label="Calendar event title" />
                <input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)} className="input-lattice" aria-label="Calendar event start time" />
              </div>
              <button type="submit" disabled={!calDtuId || linkCalendar.isPending} className="btn-neon w-full flex items-center justify-center gap-1.5">
                {linkCalendar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />} Link calendar event
              </button>
            </form>
            {lastEvent && <p className="text-[10px] text-zinc-400">Created &ldquo;{String(lastEvent.title)}&rdquo; at {String(lastEvent.startTime)}.</p>}
          </div>

          <div className="border-t border-zinc-800 pt-2">
            <h4 className="text-[10px] uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-1.5"><Clock className="w-3 h-3" /> Current context</h4>
            <div className="grid grid-cols-2 gap-2">
              {contextQ.data && Object.keys(contextQ.data).length > 0 ? Object.entries(contextQ.data).slice(0, 6).map(([k, v]) => (
                <div key={k} className="rounded bg-zinc-900/40 px-2 py-1">
                  <p className="text-[9px] text-zinc-500 uppercase">{k}</p>
                  <p className="text-[11px] font-mono text-zinc-200 truncate">{typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v)}</p>
                </div>
              )) : <p className="col-span-2 text-[11px] text-zinc-500">No context yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Consent-gated actions */}
      <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Propose an action (requires owner/admin consent to execute)
        </h3>
        <form
          onSubmit={(e) => { e.preventDefault(); if (actDesc.trim() && !proposeAction.isPending) proposeAction.mutate(); }}
          className="grid grid-cols-1 sm:grid-cols-4 gap-2"
        >
          <label className="sr-only" htmlFor="act-type">Action type</label>
          <select id="act-type" value={actType} onChange={(e) => setActType(e.target.value)} className="input-lattice">
            {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="sr-only" htmlFor="act-desc">Action description</label>
          <input id="act-desc" value={actDesc} onChange={(e) => setActDesc(e.target.value)} placeholder="Description" className="input-lattice sm:col-span-2" />
          {actType === 'webhook' ? (
            <input value={actWebhookUrl} onChange={(e) => setActWebhookUrl(e.target.value)} placeholder="Webhook URL" className="input-lattice" aria-label="Webhook URL" />
          ) : <div />}
          <button
            type="submit"
            disabled={!actDesc.trim() || proposeAction.isPending}
            className="sm:col-span-4 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {proposeAction.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Propose action
          </button>
        </form>

        {pending.length === 0 ? (
          <p className="text-center py-4 text-zinc-500 text-[11px]">No pending actions.</p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[11px]">
                <div>
                  <span className="rounded bg-amber-500/15 text-amber-300 px-1.5 py-0.5 text-[9px] mr-2 uppercase">{a.type}</span>
                  <span className="text-zinc-200">{a.description}</span>
                  <span className="ml-2 text-zinc-500">{new Date(a.proposedAt).toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  onClick={() => approveAction.mutate(a.id)}
                  disabled={approvingId === a.id}
                  className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  {approvingId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve &amp; execute
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-zinc-500">Approval is server-role-gated (owner/admin/founder). A non-privileged approval attempt returns a real, honestly-surfaced error — never a faked success.</p>
      </div>
    </div>
  );
}
