'use client';

/**
 * ExperimentActionPanel — Quartzy / Benchling-shape action surface for
 * the science lens. Self-contained: takes an experiment name + brief
 * protocol + sample list, then runs the 4 most-load-bearing science
 * macros plus mint/DM/publish/agent.
 *
 *   1. Calibration check  → science.calibrationCheck
 *   2. Validate protocol  → science.validateProtocol
 *   3. Data quality report → science.dataQualityReport
 *   4. Chain of custody   → science.chainOfCustody
 *   5. Mint experiment    → dtu.create with protocol + samples
 *   6. DM collaborator    → /api/social/dm with protocol + samples
 *   7. Publish protocol   → dtu.create public + cite + flag published
 *   8. Replication agent  → chat_agent.do "design a replication plan
 *                            using minimum equipment and budget"
 */

import { useState } from 'react';
import {
  FlaskConical, ShieldCheck, CheckCircle2, ListChecks, GitMerge,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('science', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'calibration' | 'protocol' | 'quality' | 'custody' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface MacroResult { ok?: boolean; status?: string; issues?: string[]; notes?: string; report?: unknown; message?: string }

export function ExperimentActionPanel() {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState('');
  const [samples, setSamples] = useState('');
  const [instruments, setInstruments] = useState('');
  const [dmRecipient, setDmRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [calibrationResult, setCalibrationResult] = useState<MacroResult | null>(null);
  const [protocolResult, setProtocolResult] = useState<MacroResult | null>(null);
  const [qualityResult, setQualityResult] = useState<MacroResult | null>(null);
  const [custodyResult, setCustodyResult] = useState<MacroResult | null>(null);
  const [mintDtuId, setMintDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const sampleList = samples.split('\n').map(s => s.trim()).filter(Boolean);
  const instrumentList = instruments.split('\n').map(s => s.trim()).filter(Boolean);
  const ready = name.trim().length > 0;

  async function actCalibration() {
    if (!instrumentList.length) { err('Add at least one instrument.'); return; }
    setBusy('calibration'); setFeedback(null);
    try {
      const r = await callMacro<MacroResult>('calibrationCheck', { instruments: instrumentList.map(name => ({ name })) });
      if (r.ok && r.result) { setCalibrationResult(r.result); ok('Calibration checked.'); }
      else err(r.error ?? 'calibration check failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actProtocol() {
    if (!protocol.trim()) { err('Enter a protocol.'); return; }
    setBusy('protocol'); setFeedback(null);
    try {
      const r = await callMacro<MacroResult>('validateProtocol', { protocol: protocol.trim(), steps: protocol.split('\n').filter(s => s.trim()) });
      if (r.ok && r.result) { setProtocolResult(r.result); ok('Protocol validated.'); }
      else err(r.error ?? 'protocol validate failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actQuality() {
    if (!sampleList.length) { err('Add at least one sample.'); return; }
    setBusy('quality'); setFeedback(null);
    try {
      const r = await callMacro<MacroResult>('dataQualityReport', { samples: sampleList.map(id => ({ id })) });
      if (r.ok && r.result) { setQualityResult(r.result); ok('Quality report ready.'); }
      else err(r.error ?? 'quality report failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCustody() {
    if (!sampleList.length) { err('Add at least one sample.'); return; }
    setBusy('custody'); setFeedback(null);
    try {
      const r = await callMacro<MacroResult>('chainOfCustody', { samples: sampleList.map(id => ({ id })) });
      if (r.ok && r.result) { setCustodyResult(r.result); ok('Chain of custody ready.'); }
      else err(r.error ?? 'chain of custody failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Enter at least an experiment name.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Experiment — ${name.trim()}`,
          tags: ['science', 'experiment', `samples:${sampleList.length}`],
          source: 'science:experiment:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            experiment: {
              name: name.trim(),
              protocol: protocol.trim(),
              samples: sampleList,
              instruments: instrumentList,
              startedAt: new Date().toISOString(),
              results: { calibration: calibrationResult, protocolValid: protocolResult, dataQuality: qualityResult, custody: custodyResult },
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintDtuId(id); ok(`Experiment DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!ready) { err('Enter an experiment name.'); return; }
    if (!dmRecipient.trim()) { err('Enter a collaborator user id.'); return; }
    setBusy('dm'); setFeedback(null);
    const parts = [
      `🧪 Experiment: ${name.trim()}`,
      ``,
      protocol.trim() ? `Protocol:\n${protocol.trim()}\n` : '',
      sampleList.length ? `Samples (${sampleList.length}): ${sampleList.join(', ')}` : '',
      instrumentList.length ? `Instruments: ${instrumentList.join(', ')}` : '',
      mintDtuId ? `\n[Experiment DTU ${mintDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: parts });
      if (r.data?.ok !== false) { ok(`Sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Enter an experiment name.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Open protocol — ${name.trim()}`,
          tags: ['science', 'protocol', 'public', 'open-science'],
          source: 'science:protocol:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            protocol: {
              name: name.trim(),
              steps: protocol.split('\n').filter(s => s.trim()),
              sampleTypes: sampleList,
              instruments: instrumentList,
              validation: protocolResult,
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Protocol published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!ready) { err('Enter an experiment name.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Experiment: "${name.trim()}".`,
        protocol.trim() ? `Protocol: ${protocol.trim().slice(0, 500)}.` : '',
        instrumentList.length ? `Instruments needed: ${instrumentList.join(', ')}.` : '',
        sampleList.length ? `Sample count: ${sampleList.length}.` : '',
        ``,
        `Design a replication plan that uses the minimum viable equipment and budget.`,
        `Return: 1) equipment substitutions (cheaper/more-available alternatives);`,
        `2) the 2-3 controls that absolutely must be preserved;`,
        `3) approximate cost in USD for the minimum-viable replication.`,
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Replication plan ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'calibration', label: 'Calibration',  desc: 'Check instrument calibration status',           icon: ShieldCheck,   accent: '#06b6d4', handler: actCalibration, disabled: instrumentList.length === 0 },
    { id: 'protocol',    label: 'Validate',      desc: 'Protocol structure + step validation',         icon: CheckCircle2,  accent: '#22c55e', handler: actProtocol,    disabled: !protocol.trim() },
    { id: 'quality',     label: 'Data quality',  desc: 'Sample data quality report',                   icon: ListChecks,    accent: '#eab308', handler: actQuality,     disabled: sampleList.length === 0 },
    { id: 'custody',     label: 'Chain custody', desc: 'Sample provenance chain',                      icon: GitMerge,      accent: '#8b5cf6', handler: actCustody,     disabled: sampleList.length === 0 },
    { id: 'mint',        label: mintDtuId      ? 'Saved'     : 'Mint experiment',  desc: mintDtuId      ? `DTU ${mintDtuId.slice(0, 8)}…`      : 'Private DTU with full experiment state',                icon: Sparkles, accent: '#3b82f6', handler: actMint,        disabled: !ready || !!mintDtuId },
    { id: 'dm',          label: 'DM collaborator', desc: 'Send protocol + samples + DTU embed',         icon: Send,          accent: '#ec4899', handler: actDm,          disabled: !ready },
    { id: 'publish',     label: publishedDtuId ? 'Published' : 'Publish protocol', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public protocol DTU + federation',                       icon: Globe,    accent: '#15803d', handler: actPublish,     disabled: !ready || !!publishedDtuId },
    { id: 'agent',       label: 'Replication',   desc: 'Agent: minimum-viable replication plan',       icon: Wand2,         accent: '#f97316', handler: actAgent,       disabled: !ready },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <FlaskConical className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Experiment workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          quartzy · benchling
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Experiment name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40" placeholder="e.g. BL21 expression of mScarlet" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Protocol (one step per line)</label>
            <textarea value={protocol} onChange={(e) => setProtocol(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none font-mono" placeholder="1. Inoculate 5 mL LB+amp&#10;2. Grow to OD600 = 0.6&#10;3. Induce with 0.5 mM IPTG&#10;4. ..." />
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Sample IDs (one per line)</label>
            <textarea value={samples} onChange={(e) => setSamples(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-none font-mono" placeholder="S-001&#10;S-002&#10;S-003" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Instruments (one per line)</label>
            <textarea value={instruments} onChange={(e) => setInstruments(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-none font-mono" placeholder="NanoDrop spectrophotometer&#10;BioTek plate reader" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM collaborator</label>
            <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="lab partner user id" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={a.disabled || !!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-emerald-400/40',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Result panes */}
      {(calibrationResult || protocolResult || qualityResult || custodyResult) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {calibrationResult && <ResultPane label="Calibration" accent="#06b6d4" icon={ShieldCheck} result={calibrationResult} />}
          {protocolResult    && <ResultPane label="Protocol"    accent="#22c55e" icon={CheckCircle2} result={protocolResult} />}
          {qualityResult     && <ResultPane label="Data quality" accent="#eab308" icon={ListChecks}   result={qualityResult} />}
          {custodyResult     && <ResultPane label="Chain of custody" accent="#8b5cf6" icon={GitMerge}  result={custodyResult} />}
        </div>
      )}

      {agentReply && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-orange-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Replication plan
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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

function ResultPane({ label, accent, icon: Icon, result }: { label: string; accent: string; icon: React.ComponentType<{ className?: string }>; result: MacroResult }) {
  return (
    <div className="rounded-md border p-2.5 space-y-1" style={{ borderColor: accent + '60', backgroundColor: accent + '10' }}>
      <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5" style={{ color: accent }}>
        <Icon className="w-3 h-3" /> {label}{result.status ? ` — ${result.status}` : ''}
      </div>
      {result.message && <p className="text-[11px] text-zinc-300">{result.message}</p>}
      {result.notes && <p className="text-[11px] text-zinc-300">{result.notes}</p>}
      {result.issues?.length ? (
        <ul className="text-[11px] text-amber-300 list-disc list-inside">
          {result.issues.map((i, idx) => <li key={idx}>{i}</li>)}
        </ul>
      ) : null}
      {!result.message && !result.notes && !result.issues?.length && (
        <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}
