'use client';

/**
 * AirQualityActionStack — AirNow / EJScreen-shape action surface for
 * the environment lens. Pulls a fresh AirNow reading by ZIP, then
 * exposes 5 real-backend actions on top of it.
 *
 *   1. Mint snapshot     → dtu.create with the live AQI obs + ZIP
 *                          (private; tags=[environment,aqi,zip:NNNNN])
 *   2. DM neighbor alert → /api/social/dm with AQI summary + health
 *                          guidance text
 *   3. Publish community report → dtu.create public + flag published
 *                          (federation pickup; one shot)
 *   4. Agent risk brief  → chat_agent.do "given AQI={n} for {param}
 *                          in ZIP={zip}, who in this household should
 *                          adjust today's plans?"
 *   5. Copy CSV          → clipboard write of observation rows
 *
 * No seed data. Every action runs against the actual AirNow observation
 * returned this session — if no fetch has happened yet, actions stay
 * disabled with a "load AQI first" hint.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Wind, Send, Globe, Sparkles, FileDown, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AqiObservation {
  dateObserved: string; hourObserved: number;
  reportingArea: string; stateCode: string;
  parameterName: string; aqi: number;
  category?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('environment', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mint' | 'dm' | 'publish' | 'agent' | 'csv';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

function aqiAccent(aqi: number) {
  if (aqi <= 50)  return { ring: 'ring-emerald-400/40', text: 'text-emerald-300', label: 'Good',                   accent: '#22c55e' };
  if (aqi <= 100) return { ring: 'ring-yellow-400/40',  text: 'text-yellow-300',  label: 'Moderate',               accent: '#eab308' };
  if (aqi <= 150) return { ring: 'ring-orange-400/40',  text: 'text-orange-300',  label: 'Unhealthy (sensitive)',  accent: '#f97316' };
  if (aqi <= 200) return { ring: 'ring-red-400/40',     text: 'text-red-300',     label: 'Unhealthy',              accent: '#ef4444' };
  if (aqi <= 300) return { ring: 'ring-violet-400/40',  text: 'text-violet-300',  label: 'Very unhealthy',         accent: '#8b5cf6' };
  return                  { ring: 'ring-rose-500/40',   text: 'text-rose-300',    label: 'Hazardous',              accent: '#e11d48' };
}

export function AirQualityActionStack() {
  const [zip, setZip] = useState('94110');
  const [observations, setObservations] = useState<AqiObservation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [snapshotDtuId, setSnapshotDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);
  const [householdContext, setHouseholdContext] = useState('');

  const aqiMutation = useMutation({
    mutationFn: async () => callMacro<{ observations: AqiObservation[] }>('airnow-current', { zipCode: zip }),
    onSuccess: (env) => {
      if (env.ok && env.result) {
        setObservations(env.result.observations);
        setLoadError(null);
        setSnapshotDtuId(null);
        setPublishedDtuId(null);
        setAgentReply(null);
      } else {
        setObservations([]);
        setLoadError(env.error || 'no AQI data returned');
      }
    },
    onError: (e) => { setObservations([]); setLoadError(pickMessage(e)); },
  });

  const dominant = observations.length > 0
    ? observations.reduce((max, o) => (o.aqi > max.aqi ? o : max), observations[0])
    : null;
  const accent = dominant ? aqiAccent(dominant.aqi) : null;

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  function buildSummary(): string {
    if (!observations.length) return '';
    const rows = observations.map(o => `${o.parameterName} ${o.aqi} (${o.category ?? '—'})`).join(', ');
    const where = `${observations[0].reportingArea}, ${observations[0].stateCode}`;
    const when = `${observations[0].dateObserved} ${observations[0].hourObserved}:00`;
    return `Air quality for ZIP ${zip} (${where}) at ${when}: ${rows}.`;
  }

  function buildGuidance(): string {
    if (!dominant) return '';
    const a = dominant.aqi;
    if (a <= 50)  return 'Air quality is good — no precautions needed.';
    if (a <= 100) return 'Air quality is moderate. Unusually sensitive people may consider reducing prolonged outdoor exertion.';
    if (a <= 150) return 'Sensitive groups (children, elderly, asthma) should reduce prolonged outdoor exertion. General public is likely fine.';
    if (a <= 200) return 'Everyone may begin to experience health effects. Sensitive groups should limit prolonged outdoor exertion.';
    if (a <= 300) return 'Health alert — everyone may experience serious effects. Avoid prolonged outdoor activity.';
    return 'Hazardous — health warnings of emergency conditions. Remain indoors with filtered air if possible.';
  }

  async function actMint() {
    if (!dominant) { err('Load an AQI reading first.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: `AQI snapshot — ZIP ${zip} — ${dominant.parameterName} ${dominant.aqi}`,
          tags: ['environment', 'aqi', 'epa-airnow', `zip:${zip}`, `param:${dominant.parameterName.toLowerCase()}`],
          source: 'environment:aqi:snapshot',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            aqi: {
              zip,
              dominantAqi: dominant.aqi,
              dominantParam: dominant.parameterName,
              category: dominant.category,
              dateObserved: dominant.dateObserved,
              hourObserved: dominant.hourObserved,
              reportingArea: dominant.reportingArea,
              stateCode: dominant.stateCode,
              observations,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setSnapshotDtuId(id); ok(`Snapshot minted ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!dominant) { err('Load an AQI reading first.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    try {
      const body = `🌬️ Air-quality alert\n\n${buildSummary()}\n\n${buildGuidance()}`;
      const r = await api.post('/api/social/dm', {
        toUserId: dmRecipient.trim(),
        content: body,
      });
      if (r.data?.ok !== false) { ok(`Alert sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!dominant) { err('Load an AQI reading first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await lensRun({
        domain: 'dtu',
        name: 'create',
        input: {
          title: `Community air report — ZIP ${zip} — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['environment', 'aqi', 'community-report', 'public', `zip:${zip}`],
          source: 'environment:aqi:report:public',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            aqi: {
              zip,
              dominantAqi: dominant.aqi,
              dominantParam: dominant.parameterName,
              category: dominant.category,
              reportingArea: dominant.reportingArea,
              stateCode: dominant.stateCode,
              observedAt: `${dominant.dateObserved} ${dominant.hourObserved}:00`,
              observations,
              guidance: buildGuidance(),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) {
        setPublishedDtuId(id);
        ok(`Community report published ${id.slice(0, 8)}…`);
      } else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!dominant) { err('Load an AQI reading first.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Air quality reading: ${dominant.parameterName} AQI ${dominant.aqi} (${dominant.category ?? 'unknown category'})`,
        `for ZIP ${zip} (${dominant.reportingArea}, ${dominant.stateCode}).`,
        householdContext.trim()
          ? `Household context: ${householdContext.trim()}.`
          : 'No specific household context given — assume a general adult household.',
        'Return a short plaintext brief: who should adjust today\'s plans, what activities are still fine,',
        'and what indoor/mask/ventilation steps make sense.',
      ].join(' ');
      const r = await lensRun({
        domain: 'chat_agent',
        name: 'do',
        input: { task, maxTurns: 4 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Agent finished risk brief.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCsv() {
    if (!observations.length) { err('Load an AQI reading first.'); return; }
    setBusy('csv'); setFeedback(null);
    try {
      const header = 'date,hour,reportingArea,state,parameter,aqi,category';
      const rows = observations.map(o =>
        [o.dateObserved, o.hourObserved, `"${o.reportingArea.replace(/"/g, '""')}"`, o.stateCode, o.parameterName, o.aqi, o.category ?? ''].join(','),
      );
      await navigator.clipboard.writeText([header, ...rows].join('\n'));
      ok(`${observations.length} row${observations.length === 1 ? '' : 's'} copied as CSV.`);
    } catch { err('Clipboard write blocked.'); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'mint',    label: snapshotDtuId  ? 'Snapshot saved' : 'Mint snapshot',    desc: snapshotDtuId  ? `DTU ${snapshotDtuId.slice(0, 8)}…` : 'Private DTU + obs + tags',                       icon: Sparkles, accent: '#06b6d4', handler: actMint,    disabled: !dominant || !!snapshotDtuId },
    { id: 'dm',      label: 'DM alert',                                              desc: dominant ? `DM the AirNow brief + guidance` : 'Load AQI first',                                          icon: Send,     accent: '#ec4899', handler: actDm,      disabled: !dominant },
    { id: 'publish', label: publishedDtuId ? 'Report published' : 'Publish report', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public community DTU + federation flag',         icon: Globe,    accent: '#22c55e', handler: actPublish, disabled: !dominant || !!publishedDtuId },
    { id: 'agent',   label: 'Risk brief (agent)',                                    desc: 'Agent assesses today\'s plans against the reading',                                                     icon: Wand2,    accent: '#eab308', handler: actAgent,   disabled: !dominant },
    { id: 'csv',     label: 'Copy CSV',                                              desc: dominant ? `${observations.length} row${observations.length === 1 ? '' : 's'} → clipboard` : '—',         icon: FileDown, accent: '#3b82f6', handler: actCsv,     disabled: !dominant },
  ];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Wind className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">AirNow actions</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          airnow · live
        </span>
      </header>

      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">ZIP</label>
        <input
          type="text" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
          className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
        />
        <button
          type="button" onClick={() => aqiMutation.mutate()}
          disabled={zip.length !== 5 || aqiMutation.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {aqiMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load AQI'}
        </button>
      </div>

      {loadError && (
        <div className="px-2 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
          {loadError}
        </div>
      )}

      {dominant && accent && (
        <div className={cn('rounded-lg border-2 bg-zinc-900/60 p-3 ring-1', accent.ring)} style={{ borderColor: accent.accent + '60' }}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold" style={{ color: accent.accent }}>{dominant.aqi}</span>
              <span className={cn('text-xs font-semibold uppercase tracking-wider', accent.text)}>{accent.label}</span>
            </div>
            <span className="text-[10px] text-zinc-400 font-mono">
              {dominant.reportingArea}, {dominant.stateCode}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">
            {dominant.parameterName} · {dominant.category ?? 'category n/a'} · observed {dominant.dateObserved} {dominant.hourObserved}:00
          </div>
          {observations.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {observations.filter(o => o !== dominant).map(o => (
                <span key={o.parameterName} className="rounded bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-300 font-mono">
                  {o.parameterName} {o.aqi}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Optional inputs for DM + agent */}
      {dominant && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for alert)</label>
            <input
              type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40"
              placeholder="username or user id"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Household context (for agent)</label>
            <input
              type="text" value={householdContext} onChange={(e) => setHouseholdContext(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40"
              placeholder="kids, elderly parent, asthma, marathon training…"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800',
                'hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-cyan-400/40',
              )}
            >
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center"
                style={{ backgroundColor: a.accent + '20', color: a.accent }}
              >
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {agentReply && (
        <div className="px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/30 text-[11px] text-zinc-200 max-h-56 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="h-3 w-3" />
            Risk brief
          </div>
          <pre className="whitespace-pre-wrap font-sans leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn(
              'px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
              feedback.kind === 'ok'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30',
            )}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
