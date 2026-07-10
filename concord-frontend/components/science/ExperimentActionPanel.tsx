'use client';

/**
 * ExperimentActionPanel — Quartzy / Benchling-shape action surface for
 * the science lens. Self-contained: takes an experiment name + brief
 * protocol + sample list, then runs the most load-bearing science macros
 * plus mint/DM/publish/agent.
 *
 *   1. Calibration check     → science.calibrationCheck (once per instrument row)
 *   2. Validate protocol     → science.validateProtocol
 *   3. Sample audit          → science.sampleAudit
 *   4. Chain of custody      → science.chainOfCustody
 *   5. Vision (lab image)    → science.vision
 *   6. Mint experiment       → dtu.create with protocol + samples
 *   7. DM collaborator       → /api/social/dm with protocol + samples
 *   8. Publish protocol      → dtu.create public + cite + flag published
 *   9. Replication agent     → chat_agent.do "design a replication plan
 *                              using minimum equipment and budget"
 *
 * Field-shape note (2026-07, Wave 3 rebuild): the four macro-backed actions
 * were previously wired with payloads that didn't match what the backend
 * handlers read (a list of instrument *names* instead of one equipment's
 * calibration dates; a raw protocol string instead of a `{steps, safetyChecks,
 * equipment}` object; a list of sample *IDs* instead of storage/handling
 * fields; no chain-of-custody transfer records at all) — every one of those
 * calls silently returned a constant, near-useless result (calibration
 * always "unknown", protocol always "4 steps missing" regardless of the
 * real steps, custody always "0 transfers, intact"). This rewrite gives each
 * macro the shape it actually reads, verified against `server/domains/science.js`.
 */

import { useState } from 'react';
import {
  FlaskConical, ShieldCheck, CheckCircle2, ListChecks, GitMerge, Eye,
  Sparkles, Send, Globe, Wand2, Plus, Trash2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

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
type ActionId = 'calibration' | 'protocol' | 'audit' | 'custody' | 'vision' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface MacroResult { ok?: boolean; status?: string; issues?: string[]; message?: string; notes?: string; report?: unknown }

interface CalibRow { name: string; serial: string; calibrationDate: string; nextCalibration: string }
interface SafetyRow { desc: string; verified: boolean }
interface SampleRow {
  id: string; name: string; reqTemp: string; actualTemp: string; expiryDate: string;
  requiresGloves: boolean; glovesUsed: boolean; requiresSterile: boolean; sterileConfirmed: boolean;
}
interface CustodyRow { transferredTo: string; receivedBy: string; date: string }

export function ExperimentActionPanel() {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState('');
  const [samples, setSamples] = useState('');
  const [instruments, setInstruments] = useState('');
  const [dmRecipient, setDmRecipient] = useState('');

  const [calibRows, setCalibRows] = useState<CalibRow[]>([{ name: '', serial: '', calibrationDate: '', nextCalibration: '' }]);
  const [safetyRows, setSafetyRows] = useState<SafetyRow[]>([{ desc: '', verified: false }]);
  const [sampleRows, setSampleRows] = useState<SampleRow[]>([{ id: '', name: '', reqTemp: '', actualTemp: '', expiryDate: '', requiresGloves: false, glovesUsed: false, requiresSterile: false, sterileConfirmed: false }]);
  const [custodySampleName, setCustodySampleName] = useState('');
  const [custodyRows, setCustodyRows] = useState<CustodyRow[]>([{ transferredTo: '', receivedBy: '', date: '' }]);

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [calibrationResult, setCalibrationResult] = useState<MacroResult | null>(null);
  const [protocolResult, setProtocolResult] = useState<MacroResult | null>(null);
  const [auditResult, setAuditResult] = useState<MacroResult | null>(null);
  const [custodyResult, setCustodyResult] = useState<MacroResult | null>(null);
  const [visionResult, setVisionResult] = useState<string | null>(null);
  const [mintDtuId, setMintDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  const sampleList = samples.split('\n').map(s => s.trim()).filter(Boolean);
  const instrumentList = instruments.split('\n').map(s => s.trim()).filter(Boolean);
  const ready = name.trim().length > 0;

  const namedCalibRows = () => calibRows.filter(r => r.name.trim());
  const namedSampleRows = () => sampleRows.filter(r => r.id.trim() || r.name.trim());
  const namedCustodyRows = () => custodyRows.filter(r => r.transferredTo.trim() && r.receivedBy.trim());

  /* ---- calibration: the macro checks ONE piece of equipment at a time, so
     a multi-instrument check is N real calls, aggregated client-side. ---- */
  async function actCalibration() {
    const rows = namedCalibRows();
    if (!rows.length) { err('Add at least one instrument with a name.'); return; }
    setBusy('calibration'); setFeedback(null);
    try {
      const rowResults: { name: string; status: string; daysUntilDue: number | null }[] = [];
      for (const row of rows) {
        const r = await callMacro<{ status: string; daysUntilDue: number | null }>('calibrationCheck', {
          serial: row.serial.trim() || undefined,
          calibrationDate: row.calibrationDate || undefined,
          nextCalibration: row.nextCalibration || undefined,
        });
        rowResults.push({
          name: row.name.trim(),
          status: r.ok && r.result ? r.result.status : 'error',
          daysUntilDue: r.ok && r.result ? r.result.daysUntilDue : null,
        });
      }
      const overdue = rowResults.filter(x => x.status === 'overdue').length;
      const dueSoon = rowResults.filter(x => x.status === 'due_soon').length;
      const summary: MacroResult = {
        status: overdue > 0 ? 'overdue' : dueSoon > 0 ? 'due_soon' : 'current',
        issues: rowResults.map(x => `${x.name}: ${x.status.replace(/_/g, ' ')}${x.daysUntilDue != null ? ` (${x.daysUntilDue}d)` : ''}`),
      };
      setCalibrationResult(summary);
      pipe.publish('science.calibration', summary, { label: summary.status ?? 'calibration' });
      ok(`Checked ${rowResults.length} instrument(s).`);
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actProtocol() {
    const steps = protocol.split('\n').map(s => s.trim()).filter(Boolean);
    if (!steps.length) { err('Enter protocol steps (one per line).'); return; }
    setBusy('protocol'); setFeedback(null);
    try {
      const r = await callMacro<{
        status: string; totalSteps: number; safetyChecksTotal: number; safetyChecksVerified: number;
        equipmentCount: number; calibrationIssues: unknown[];
        issues: Array<{ type: string; step?: string; detail?: string; severity?: string }>;
      }>('validateProtocol', {
        protocol: {
          name: name.trim() || 'Untitled protocol',
          steps: steps.map(s => ({ name: s })),
          safetyChecks: safetyRows.filter(s => s.desc.trim()).map(s => ({ description: s.desc.trim(), verified: s.verified })),
          equipment: namedCalibRows().map(eq => ({ name: eq.name.trim(), nextCalibration: eq.nextCalibration || undefined })),
        },
      });
      if (r.ok && r.result) {
        const rr = r.result;
        const summary: MacroResult = {
          status: rr.status,
          message: `${rr.totalSteps} step(s) · ${rr.safetyChecksVerified}/${rr.safetyChecksTotal} safety check(s) verified · ${rr.equipmentCount} equipment item(s)`,
          issues: (rr.issues || []).map(i => i.detail || (i.step ? `missing step: ${i.step}` : i.type)),
        };
        setProtocolResult(summary);
        pipe.publish('science.protocol', summary, { label: summary.status ?? 'protocol' });
        ok('Protocol validated.');
      } else err(r.error ?? 'protocol validate failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAudit() {
    const rows = namedSampleRows();
    if (!rows.length) { err('Add at least one sample.'); return; }
    setBusy('audit'); setFeedback(null);
    try {
      const r = await callMacro<{
        totalSamples: number; compliant: number; nonCompliant: number;
        samples: Array<{ sampleId?: string; name?: string; status: string; issueCount: number; issues: Array<{ type: string; detail?: string }> }>;
      }>('sampleAudit', {
        samples: rows.map(row => ({
          sampleId: row.id.trim() || undefined,
          name: row.name.trim() || undefined,
          storage: (row.reqTemp.trim() || row.actualTemp.trim()) ? {
            requiredTemp: row.reqTemp.trim() ? Number(row.reqTemp) : undefined,
            actualTemp: row.actualTemp.trim() ? Number(row.actualTemp) : undefined,
          } : undefined,
          expiryDate: row.expiryDate || undefined,
          handling: {
            requiresGloves: row.requiresGloves, glovesUsed: row.glovesUsed,
            requiresSterile: row.requiresSterile, sterileConfirmed: row.sterileConfirmed,
          },
        })),
      });
      if (r.ok && r.result) {
        const summary: MacroResult = {
          status: r.result.nonCompliant > 0 ? 'non-compliant' : 'compliant',
          message: `${r.result.compliant}/${r.result.totalSamples} compliant`,
          issues: r.result.samples.filter(s => s.issueCount > 0)
            .map(s => `${s.name || s.sampleId || 'sample'}: ${s.issues.map(i => i.detail || i.type).join(', ')}`),
        };
        setAuditResult(summary);
        pipe.publish('science.audit', summary, { label: summary.status ?? 'audit' });
        ok('Sample audit complete.');
      } else err(r.error ?? 'sample audit failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCustody() {
    const rows = namedCustodyRows();
    if (!rows.length) { err('Add at least one transfer (transferred to + received by).'); return; }
    setBusy('custody'); setFeedback(null);
    try {
      const r = await callMacro<{ intact: boolean; transfers: number; gaps: Array<{ position: number; expected: string; actual: string }> }>('chainOfCustody', {
        chainOfCustody: rows.map(row => ({ transferredTo: row.transferredTo.trim(), receivedBy: row.receivedBy.trim(), date: row.date || undefined })),
      });
      if (r.ok && r.result) {
        const summary: MacroResult = {
          status: r.result.intact ? 'intact' : 'broken',
          message: `${custodySampleName.trim() || 'Sample'} — ${r.result.transfers} transfer(s)`,
          issues: r.result.gaps.map(g => `Position ${g.position}: expected "${g.expected}", got "${g.actual}"`),
        };
        setCustodyResult(summary);
        pipe.publish('science.custody', summary, { label: summary.status ?? 'custody' });
        ok('Chain of custody verified.');
      } else err(r.error ?? 'chain of custody failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actVision(file: File) {
    setBusy('vision'); setFeedback(null); setVisionResult(null);
    try {
      const imageB64 = await fileToBase64(file);
      const r = await lensRun<{ ok: boolean; content?: string; error?: string }>('science', 'vision', { imageB64 });
      const inner = r.data?.result;
      if (inner?.ok && inner.content) {
        setVisionResult(inner.content);
        pipe.publish('science.vision', inner.content, { label: 'vision analysis' });
        ok('Image analyzed.');
      } else {
        err(inner?.error || r.data?.error || 'vision analysis failed');
      }
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
              results: { calibration: calibrationResult, protocolValid: protocolResult, sampleAudit: auditResult, custody: custodyResult },
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintDtuId(id); pipe.publish('science.mintedDtuId', id, { label: `experiment ${id.slice(0, 8)}` }); ok(`Experiment DTU ${id.slice(0, 8)}…`); }
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
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: parts });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setDmRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Enter an experiment name.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
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
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('science.publishedDtuId', id, { label: `protocol ${id.slice(0, 8)}` }); ok(`Protocol published ${id.slice(0, 8)}… · 30s to recall.`); }
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
    { id: 'calibration', label: 'Calibration',  desc: 'Check instrument calibration status',           icon: ShieldCheck,   accent: '#06b6d4', handler: actCalibration, disabled: namedCalibRows().length === 0 },
    { id: 'protocol',    label: 'Validate',      desc: 'Protocol structure + step validation',         icon: CheckCircle2,  accent: '#22c55e', handler: actProtocol,    disabled: !protocol.trim() },
    { id: 'audit',       label: 'Sample audit',  desc: 'Storage / expiry / handling compliance',       icon: ListChecks,    accent: '#eab308', handler: actAudit,       disabled: namedSampleRows().length === 0 },
    { id: 'custody',     label: 'Chain custody', desc: 'Sample provenance transfer chain',             icon: GitMerge,      accent: '#8b5cf6', handler: actCustody,     disabled: namedCustodyRows().length === 0 },
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
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Protocol steps (one per line — include preparation / execution / data collection / cleanup phases to pass validation)</label>
            <textarea value={protocol} onChange={(e) => setProtocol(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/40 resize-none font-mono" placeholder="1. Preparation: inoculate 5 mL LB+amp&#10;2. Execution: grow to OD600 = 0.6, induce with IPTG&#10;3. Data collection: read plate at 590nm&#10;4. Cleanup: autoclave waste" />
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Sample IDs (one per line, for mint/DM context)</label>
            <textarea value={samples} onChange={(e) => setSamples(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/40 resize-none font-mono" placeholder="S-001&#10;S-002" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Instruments (one per line, for mint/DM context)</label>
            <textarea value={instruments} onChange={(e) => setInstruments(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-none font-mono" placeholder="NanoDrop spectrophotometer" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM collaborator</label>
            <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="lab partner user id" />
          </div>
        </div>
      </div>

      {/* Equipment calibration rows — feeds Calibration check + Protocol's equipment list */}
      <div className="space-y-1.5 border-t border-white/5 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> Equipment calibration
        </p>
        {calibRows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1">
            <input value={r.name} onChange={(e) => setCalibRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Instrument name" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <input value={r.serial} onChange={(e) => setCalibRows(rs => rs.map((x, j) => j === i ? { ...x, serial: e.target.value } : x))} placeholder="Serial #" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <input type="date" value={r.calibrationDate} onChange={(e) => setCalibRows(rs => rs.map((x, j) => j === i ? { ...x, calibrationDate: e.target.value } : x))} className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" title="Last calibration" />
            <input type="date" value={r.nextCalibration} onChange={(e) => setCalibRows(rs => rs.map((x, j) => j === i ? { ...x, nextCalibration: e.target.value } : x))} className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" title="Next calibration due" />
            <button type="button" onClick={() => setCalibRows(rs => rs.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400" aria-label="Remove instrument"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setCalibRows(rs => [...rs, { name: '', serial: '', calibrationDate: '', nextCalibration: '' }])} className="text-[11px] text-teal-400 hover:text-teal-200"><Plus className="w-3 h-3 inline" /> Add instrument</button>
      </div>

      {/* Safety checks — feeds Protocol's safetyChecks list */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Safety checks
        </p>
        {safetyRows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={r.desc} onChange={(e) => setSafetyRows(rs => rs.map((x, j) => j === i ? { ...x, desc: e.target.value } : x))} placeholder="e.g. Fume hood inspected" className="flex-1 px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">
              <input type="checkbox" checked={r.verified} onChange={(e) => setSafetyRows(rs => rs.map((x, j) => j === i ? { ...x, verified: e.target.checked } : x))} /> verified
            </label>
            <button type="button" onClick={() => setSafetyRows(rs => rs.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400" aria-label="Remove safety check"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setSafetyRows(rs => [...rs, { desc: '', verified: false }])} className="text-[11px] text-teal-400 hover:text-teal-200"><Plus className="w-3 h-3 inline" /> Add safety check</button>
      </div>

      {/* Sample compliance — feeds Sample audit */}
      <div className="space-y-1.5 border-t border-white/5 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-yellow-400 font-semibold flex items-center gap-1">
          <ListChecks className="w-3 h-3" /> Sample compliance
        </p>
        {sampleRows.map((r, i) => (
          <div key={i} className="rounded border border-zinc-800 p-1.5 space-y-1">
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-1">
              <input value={r.id} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} placeholder="Sample ID" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
              <input value={r.name} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Name" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
              <input type="date" value={r.expiryDate} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, expiryDate: e.target.value } : x))} className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" title="Expiry date" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              <input type="number" value={r.reqTemp} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, reqTemp: e.target.value } : x))} placeholder="Required temp (°C)" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
              <input type="number" value={r.actualTemp} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, actualTemp: e.target.value } : x))} placeholder="Actual temp (°C)" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.requiresGloves} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, requiresGloves: e.target.checked } : x))} /> gloves required</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.glovesUsed} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, glovesUsed: e.target.checked } : x))} /> gloves used</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.requiresSterile} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, requiresSterile: e.target.checked } : x))} /> sterile required</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={r.sterileConfirmed} onChange={(e) => setSampleRows(rs => rs.map((x, j) => j === i ? { ...x, sterileConfirmed: e.target.checked } : x))} /> sterile confirmed</label>
              <button type="button" onClick={() => setSampleRows(rs => rs.filter((_, j) => j !== i))} className="ml-auto text-zinc-600 hover:text-red-400" aria-label="Remove sample"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setSampleRows(rs => [...rs, { id: '', name: '', reqTemp: '', actualTemp: '', expiryDate: '', requiresGloves: false, glovesUsed: false, requiresSterile: false, sterileConfirmed: false }])} className="text-[11px] text-teal-400 hover:text-teal-200"><Plus className="w-3 h-3 inline" /> Add sample</button>
      </div>

      {/* Chain of custody — a single sample's transfer log */}
      <div className="space-y-1.5 border-t border-white/5 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold flex items-center gap-1">
          <GitMerge className="w-3 h-3" /> Chain of custody
        </p>
        <input value={custodySampleName} onChange={(e) => setCustodySampleName(e.target.value)} placeholder="Sample name (for display)" className="w-full px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
        {custodyRows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
            <input value={r.transferredTo} onChange={(e) => setCustodyRows(rs => rs.map((x, j) => j === i ? { ...x, transferredTo: e.target.value } : x))} placeholder="Transferred to" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <input value={r.receivedBy} onChange={(e) => setCustodyRows(rs => rs.map((x, j) => j === i ? { ...x, receivedBy: e.target.value } : x))} placeholder="Received by (next row)" className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <input type="date" value={r.date} onChange={(e) => setCustodyRows(rs => rs.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-800 rounded text-white" />
            <button type="button" onClick={() => setCustodyRows(rs => rs.filter((_, j) => j !== i))} className="text-zinc-600 hover:text-red-400" aria-label="Remove transfer"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setCustodyRows(rs => [...rs, { transferredTo: '', receivedBy: '', date: '' }])} className="text-[11px] text-teal-400 hover:text-teal-200"><Plus className="w-3 h-3 inline" /> Add transfer</button>
        <p className="text-[10px] text-zinc-500">Chain is intact when each transfer&apos;s recipient matches the next transfer&apos;s sender — e.g. row 1 &quot;Transferred to: Priya&quot; then row 2 &quot;Received by: Priya&quot;.</p>
      </div>

      {/* Vision — lab image analysis */}
      <div className="space-y-1.5 border-t border-white/5 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-fuchsia-400 font-semibold flex items-center gap-1">
          <Eye className="w-3 h-3" /> Vision — analyze a gel, microscopy image, or label
        </p>
        <input
          type="file" accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) actVision(f); }}
          disabled={busy === 'vision'}
          className="text-[11px] text-zinc-400 file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-zinc-800 file:bg-zinc-900 file:text-fuchsia-300 file:text-[11px]"
        />
        {visionResult && (
          <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 text-[11px] text-zinc-200 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {visionResult}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
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
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Result panes */}
      {(calibrationResult || protocolResult || auditResult || custodyResult) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {calibrationResult && <ResultPane label="Calibration" accent="#06b6d4" icon={ShieldCheck} result={calibrationResult} />}
          {protocolResult    && <ResultPane label="Protocol"    accent="#22c55e" icon={CheckCircle2} result={protocolResult} />}
          {auditResult        && <ResultPane label="Sample audit" accent="#eab308" icon={ListChecks}   result={auditResult} />}
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
      ) : (
        <p className="text-[11px] text-emerald-300">No issues found.</p>
      )}
    </div>
  );
}
