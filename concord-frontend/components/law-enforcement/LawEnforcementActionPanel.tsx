'use client';

/**
 * LawEnforcementActionPanel — investigator + commander quick-analysis bench.
 * caseAnalysis / patrolOptimize / incidentReport / crimeStats +
 * mint/DM/publish/agent.
 *
 * Each analysis tool is a real, structured form (repeatable-row builders for
 * evidence/witnesses/suspects, patrol zones, and incident log entries) — not
 * a raw JSON-paste textarea. The prior JSON-paste shape was flagged as a
 * "structured form" invariant violation (docs/lens-specs/
 * law-enforcement-capability-map.md) and the incident-report call used to
 * send a hardcoded `officer: 'badge-1138'` value as if it were real data;
 * that field is now a genuine (optional) operator input that falls back to
 * the authenticated caller's id server-side when left blank.
 */

import { useState } from 'react';
import { Shield, MapPin, FileText, BarChart3, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle, Plus, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('law-enforcement', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'case' | 'patrol' | 'report' | 'stats' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CaseResult { caseId?: string; evidenceCount: number; witnessCount: number; suspectCount: number; caseStrength: number; prosecutable: boolean; status: string; nextSteps: string[] }
interface ZoneRec { zone: string; crimeRate: number; population: number; currentPatrols: number; recommended: number }
interface PatrolResult { zones: ZoneRec[]; totalUnitsNeeded: number; totalCurrentUnits: number; hotspots: string[] }
interface ReportResult { reportId: string; complete: boolean; missingFields: string[]; type: string; date: string; location: string; severity: string; status: string }
interface CrimeStatsResult { totalIncidents: number; byType: { type: string; count: number }[]; clearanceRate: number; mostCommon: string; trend: string }

// ---- small repeatable-row form primitives ---------------------------------

function RowInput({ value, onChange, placeholder, type = 'text', className }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn('bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none', className)}
    />
  );
}

function AddRowBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1 text-[10px] text-blue-300 hover:text-blue-200 mt-1">
      <Plus className="w-3 h-3" /> {label}
    </button>
  );
}

function RemoveRowBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Remove row" className="text-zinc-500 hover:text-red-400 shrink-0">
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

// No seeded case/zones/log — build real rows.
export function LawEnforcementActionPanel() {
  // Case analysis — structured evidence / witness / suspect rows.
  const [caseId, setCaseId] = useState('');
  const [evidenceRows, setEvidenceRows] = useState<string[]>(['']);
  const [witnessRows, setWitnessRows] = useState<string[]>(['']);
  const [suspectRows, setSuspectRows] = useState<{ name: string; evidenceLinks: string }[]>([{ name: '', evidenceLinks: '0' }]);

  // Patrol zones.
  const [zoneRows, setZoneRows] = useState<{ name: string; crimeRate: string; population: string; currentPatrols: string }[]>([
    { name: '', crimeRate: '', population: '', currentPatrols: '' },
  ]);

  // Crime stats — incident log rows.
  const [incidentRows, setIncidentRows] = useState<{ type: string; resolved: boolean }[]>([{ type: '', resolved: false }]);

  // Incident report.
  const [incidentType, setIncidentType] = useState('');
  const [incidentLoc, setIncidentLoc] = useState('');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [incidentOfficer, setIncidentOfficer] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [caseResult, setCaseResult] = useState<CaseResult | null>(null);
  const [patrolResult, setPatrolResult] = useState<PatrolResult | null>(null);
  const [reportResult, setReportResult] = useState<ReportResult | null>(null);
  const [statsResult, setStatsResult] = useState<CrimeStatsResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actCase() {
    const evidence = evidenceRows.map((v) => v.trim()).filter(Boolean).map((description) => ({ description }));
    const witnesses = witnessRows.map((v) => v.trim()).filter(Boolean).map((name) => ({ name }));
    const suspects = suspectRows
      .filter((s) => s.name.trim())
      .map((s) => ({ name: s.name.trim(), evidenceLinks: Array(Math.max(0, parseInt(s.evidenceLinks, 10) || 0)).fill(true) }));
    if (evidence.length === 0 && witnesses.length === 0 && suspects.length === 0) { err('Add at least one evidence item, witness, or suspect.'); return; }
    setBusy('case'); setFeedback(null);
    try {
      const r = await callMacro<CaseResult>('caseAnalysis', { artifact: { data: { caseId: caseId.trim() || undefined, evidence, witnesses, suspects } } });
      if (r.ok && r.result) { setCaseResult(r.result); pipe.publish('le.case', r.result, { label: `Case ${r.result.caseStrength}/100` }); ok(`Strength ${r.result.caseStrength} · ${r.result.status}.`); } else err(r.error ?? 'case failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actPatrol() {
    const zones = zoneRows
      .filter((z) => z.name.trim())
      .map((z) => ({ name: z.name.trim(), crimeRate: z.crimeRate, population: z.population, currentPatrols: z.currentPatrols }));
    if (zones.length === 0) { err('Add at least one patrol zone.'); return; }
    setBusy('patrol'); setFeedback(null);
    try {
      const r = await callMacro<PatrolResult>('patrolOptimize', { artifact: { data: { zones } } });
      if (r.ok && r.result) { setPatrolResult(r.result); pipe.publish('le.patrol', r.result, { label: `Patrol ${r.result.hotspots.length} hotspots` }); ok(`${r.result.hotspots.length} hotspots · need ${r.result.totalUnitsNeeded} units.`); } else err(r.error ?? 'patrol failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actReport() {
    if (!incidentType.trim() || !incidentLoc.trim()) { err('Incident type + location required.'); return; }
    setBusy('report'); setFeedback(null);
    try {
      const r = await callMacro<ReportResult>('incidentReport', {
        artifact: {
          data: {
            type: incidentType,
            date: new Date().toISOString(),
            location: incidentLoc,
            description: incidentDesc,
            ...(incidentOfficer.trim() ? { officer: incidentOfficer.trim() } : {}),
          },
        },
      });
      if (r.ok && r.result) { setReportResult(r.result); pipe.publish('le.report', r.result, { label: `IR ${r.result.reportId}` }); ok(`Filed ${r.result.reportId}.`); } else err(r.error ?? 'report failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actStats() {
    const incidents = incidentRows
      .filter((i) => i.type.trim())
      .map((i) => ({ type: i.type.trim(), resolved: i.resolved }));
    if (incidents.length === 0) { err('Add at least one incident log entry.'); return; }
    setBusy('stats'); setFeedback(null);
    try {
      const r = await callMacro<CrimeStatsResult>('crimeStats', { artifact: { data: { incidents } } });
      if (r.ok && r.result) { setStatsResult(r.result); pipe.publish('le.stats', r.result, { label: `Stats ${r.result.totalIncidents}, ${r.result.clearanceRate}% cleared` }); ok(`${r.result.totalIncidents} incidents · ${r.result.clearanceRate}% cleared.`); } else err(r.error ?? 'stats failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Beat report`, tags: ['law-enforcement', 'beat'], source: 'le:beat:mint', meta: { visibility: 'private', consent: { allowCitations: false }, le: { case: caseResult, patrol: patrolResult, report: reportResult, stats: statsResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('le.mintedDtuId', id, { label: `Beat DTU ${id.slice(0, 8)}…` }); ok(`Beat DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🚓 Beat report`, '',
      caseResult ? `Case: strength ${caseResult.caseStrength}/100 · ${caseResult.status} · ${caseResult.prosecutable ? '✓ prosecutable' : '✗ insufficient'}` : '',
      patrolResult ? `Patrol: ${patrolResult.totalCurrentUnits}/${patrolResult.totalUnitsNeeded} units · hotspots: ${patrolResult.hotspots.join(', ')}` : '',
      reportResult ? `IR ${reportResult.reportId}: ${reportResult.type} @ ${reportResult.location}${reportResult.complete ? '' : ` (missing: ${reportResult.missingFields.join(', ')})`}` : '',
      statsResult ? `Stats: ${statsResult.totalIncidents} incidents · ${statsResult.clearanceRate}% cleared · top: ${statsResult.mostCommon}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actPublish() {
    if (!statsResult) { err('Run crime stats first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Crime stats (anon)`, tags: ['law-enforcement', 'stats', 'public'], source: 'le:stats:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, stats: statsResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('le.publishedDtuId', id, { label: `Public stats ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Watch commander brief. ${caseResult ? `Open case: strength ${caseResult.caseStrength}/100 (${caseResult.status}).` : ''} ${patrolResult ? `Patrol: ${patrolResult.totalCurrentUnits}/${patrolResult.totalUnitsNeeded} units, hotspots: ${patrolResult.hotspots.join(', ')}.` : ''} ${statsResult ? `${statsResult.totalIncidents} incidents this period, ${statsResult.clearanceRate}% clearance.` : ''} Identify single highest-leverage allocation change for next shift + one community-engagement opportunity. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'case' as ActionId, label: 'Case', desc: 'caseAnalysis', icon: Shield, accent: '#a855f7', handler: actCase },
    { id: 'patrol' as ActionId, label: 'Patrol', desc: 'patrolOptimize', icon: MapPin, accent: '#3b82f6', handler: actPatrol },
    { id: 'report' as ActionId, label: 'Report', desc: 'incidentReport', icon: FileText, accent: '#f59e0b', handler: actReport },
    { id: 'stats' as ActionId, label: 'Stats', desc: 'crimeStats', icon: BarChart3, accent: '#22c55e', handler: actStats },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private beat DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send beat report', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon stats', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: shift brief', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { 'strong-case': 'text-emerald-300', developing: 'text-amber-300', 'insufficient-evidence': 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Shield className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Quick Analysis</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">case · patrol · report · stats</span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* ---- Case analysis ---- */}
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Case strength</div>
          <RowInput value={caseId} onChange={setCaseId} placeholder="Case ID (optional)" className="w-full" />

          <div>
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Evidence</span>
            {evidenceRows.map((v, i) => (
              <div key={i} className="flex items-center gap-1 mt-1">
                <RowInput value={v} onChange={(nv) => setEvidenceRows((r) => r.map((x, j) => (j === i ? nv : x)))} placeholder="9mm shell casing" className="flex-1" />
                {evidenceRows.length > 1 && <RemoveRowBtn onClick={() => setEvidenceRows((r) => r.filter((_, j) => j !== i))} />}
              </div>
            ))}
            <AddRowBtn label="Add evidence" onClick={() => setEvidenceRows((r) => [...r, ''])} />
          </div>

          <div>
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Witnesses</span>
            {witnessRows.map((v, i) => (
              <div key={i} className="flex items-center gap-1 mt-1">
                <RowInput value={v} onChange={(nv) => setWitnessRows((r) => r.map((x, j) => (j === i ? nv : x)))} placeholder="Witness name" className="flex-1" />
                {witnessRows.length > 1 && <RemoveRowBtn onClick={() => setWitnessRows((r) => r.filter((_, j) => j !== i))} />}
              </div>
            ))}
            <AddRowBtn label="Add witness" onClick={() => setWitnessRows((r) => [...r, ''])} />
          </div>

          <div>
            <span className="text-[9px] uppercase tracking-wider text-zinc-500">Suspects</span>
            {suspectRows.map((s, i) => (
              <div key={i} className="flex items-center gap-1 mt-1">
                <RowInput value={s.name} onChange={(nv) => setSuspectRows((r) => r.map((x, j) => (j === i ? { ...x, name: nv } : x)))} placeholder="Suspect name" className="flex-1" />
                <RowInput value={s.evidenceLinks} onChange={(nv) => setSuspectRows((r) => r.map((x, j) => (j === i ? { ...x, evidenceLinks: nv } : x)))} placeholder="# links" type="number" className="w-16" />
                {suspectRows.length > 1 && <RemoveRowBtn onClick={() => setSuspectRows((r) => r.filter((_, j) => j !== i))} />}
              </div>
            ))}
            <AddRowBtn label="Add suspect" onClick={() => setSuspectRows((r) => [...r, { name: '', evidenceLinks: '0' }])} />
          </div>
        </div>

        {/* ---- Patrol zones + crime log ---- */}
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Patrol zones</div>
            {zoneRows.map((z, i) => (
              <div key={i} className="flex items-center gap-1 flex-wrap">
                <RowInput value={z.name} onChange={(nv) => setZoneRows((r) => r.map((x, j) => (j === i ? { ...x, name: nv } : x)))} placeholder="Zone name" className="flex-1 min-w-[90px]" />
                <RowInput value={z.crimeRate} onChange={(nv) => setZoneRows((r) => r.map((x, j) => (j === i ? { ...x, crimeRate: nv } : x)))} placeholder="Crime rate" type="number" className="w-20" />
                <RowInput value={z.population} onChange={(nv) => setZoneRows((r) => r.map((x, j) => (j === i ? { ...x, population: nv } : x)))} placeholder="Population" type="number" className="w-20" />
                <RowInput value={z.currentPatrols} onChange={(nv) => setZoneRows((r) => r.map((x, j) => (j === i ? { ...x, currentPatrols: nv } : x)))} placeholder="Patrols" type="number" className="w-16" />
                {zoneRows.length > 1 && <RemoveRowBtn onClick={() => setZoneRows((r) => r.filter((_, j) => j !== i))} />}
              </div>
            ))}
            <AddRowBtn label="Add zone" onClick={() => setZoneRows((r) => [...r, { name: '', crimeRate: '', population: '', currentPatrols: '' }])} />
          </div>

          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2.5 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Crime log</div>
            {incidentRows.map((inc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <RowInput value={inc.type} onChange={(nv) => setIncidentRows((r) => r.map((x, j) => (j === i ? { ...x, type: nv } : x)))} placeholder="Incident type" className="flex-1" />
                <label className="flex items-center gap-1 text-[10px] text-zinc-300 shrink-0">
                  <input type="checkbox" checked={inc.resolved} onChange={(e) => setIncidentRows((r) => r.map((x, j) => (j === i ? { ...x, resolved: e.target.checked } : x)))} className="accent-green-500" />
                  resolved
                </label>
                {incidentRows.length > 1 && <RemoveRowBtn onClick={() => setIncidentRows((r) => r.filter((_, j) => j !== i))} />}
              </div>
            ))}
            <AddRowBtn label="Add incident" onClick={() => setIncidentRows((r) => [...r, { type: '', resolved: false }])} />
          </div>
        </div>

        {/* ---- Incident report + DM/publish recipient ---- */}
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Incident report</div>
          <RowInput value={incidentType} onChange={setIncidentType} placeholder="Type" className="w-full" />
          <RowInput value={incidentLoc} onChange={setIncidentLoc} placeholder="Location" className="w-full" />
          <RowInput value={incidentOfficer} onChange={setIncidentOfficer} placeholder="Filing officer (optional)" className="w-full" />
          <textarea value={incidentDesc} onChange={(e) => setIncidentDesc(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Narrative" />
          <RowInput value={recipient} onChange={setRecipient} placeholder="DM recipient" className="w-full" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {caseResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{caseResult.caseId || 'Untitled case'}</div>
            <div className={cn('text-2xl font-bold', STATUS_COLOR[caseResult.status])}>{caseResult.caseStrength}<span className="text-xs text-zinc-400">/100</span></div>
            <div className={cn('text-[11px] font-semibold capitalize', STATUS_COLOR[caseResult.status])}>{caseResult.status.replace(/-/g, ' ')}</div>
            <div className="text-[10px] text-zinc-400">E {caseResult.evidenceCount} · W {caseResult.witnessCount} · S {caseResult.suspectCount}</div>
            {caseResult.nextSteps.map((s, i) => <div key={i} className="text-[10px] text-purple-200 mt-0.5">→ {s}</div>)}
          </div>
        )}
        {patrolResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Patrol · {patrolResult.totalCurrentUnits}/{patrolResult.totalUnitsNeeded}</div>
            {patrolResult.hotspots.length > 0 && <div className="text-[11px] text-red-300 font-semibold">⚠ hotspots: {patrolResult.hotspots.join(', ')}</div>}
            {patrolResult.zones.map((z, i) => <div key={i} className={cn('text-[10px] mt-0.5', z.recommended > z.currentPatrols ? 'text-amber-300' : 'text-zinc-300')}><span className="font-mono">{z.zone}</span> · CR {z.crimeRate} · {z.currentPatrols}/{z.recommended} units</div>)}
          </div>
        )}
        {reportResult && (
          <div className={cn('rounded-md border p-2.5', reportResult.complete ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Report · {reportResult.reportId}</div>
            <div className="text-[11px] text-zinc-200">{reportResult.type}</div>
            <div className="text-[10px] text-zinc-400">@ {reportResult.location} · {reportResult.severity}</div>
            <div className={cn('text-[10px] font-semibold', reportResult.complete ? 'text-emerald-300' : 'text-amber-300')}>{reportResult.complete ? '✓ complete' : `⚠ missing: ${reportResult.missingFields.join(', ')}`}</div>
          </div>
        )}
        {statsResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Stats · {statsResult.trend}</div>
            <div className="text-2xl font-bold text-green-300">{statsResult.clearanceRate}%<span className="text-xs text-zinc-400"> cleared</span></div>
            <div className="text-[10px] text-zinc-400">{statsResult.totalIncidents} total · top: {statsResult.mostCommon}</div>
            {statsResult.byType.slice(0, 4).map((t, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">{t.type}: {t.count}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Watch commander brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
