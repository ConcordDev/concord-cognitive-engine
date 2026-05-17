'use client';

/**
 * PrivacyActionPanel — DPO / GDPR bench.
 * dataInventory / consentAudit / impactAssessment / breachResponse +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Database, ShieldCheck, FileWarning, AlertOctagon, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('privacy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'inventory' | 'consent' | 'dpia' | 'breach' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface InventoryResult { totalItems: number; sensitiveItems: number; categories: Record<string, number>; riskLevel: string; gdprRelevant: boolean; recommendations: string[] }
interface ConsentResult { totalConsents: number; active: number; expired: number; withdrawn: number; complianceRate: number; issues: { user: string; expiredOn: string }[]; action: string }
interface DpiaResult { dataTypesCount: number; purposes: number; riskFactors: string[]; riskLevel: string; dpiaRequired: boolean; mitigations: { risk: string; mitigation: string }[] }
interface BreachResult { severity: string; affectedUsers: number; compromisedDataTypes: string[]; notificationRequired: boolean; regulatoryDeadline: string; timeline: { immediate: string[]; within24h: string[]; within72h: string[]; within30d: string[] }; priorityActions: string[] }

const DEFAULT_INV = JSON.stringify({ dataItems: [{ name: 'email', category: 'identity', sensitive: true, pii: true }, { name: 'phone', category: 'identity', sensitive: true, pii: true }, { name: 'order_history', category: 'commerce' }, { name: 'browse_history', category: 'analytics', sensitive: true }, { name: 'payment_token', category: 'finance', sensitive: true, pii: true }, { name: 'health_records', category: 'health', sensitive: true, pii: true }, { name: 'preferred_lang', category: 'preferences' }] }, null, 2);
const DEFAULT_CONSENT = JSON.stringify({ consents: [{ user: 'u1', granted: true, status: 'active', expiry: '2027-01-15' }, { user: 'u2', granted: true, status: 'active', expiry: '2024-08-30' }, { user: 'u3', status: 'withdrawn' }, { user: 'u4', granted: true, status: 'active', expiry: '2027-06-12' }, { user: 'u5', granted: true, status: 'active', expiry: '2024-02-01' }] }, null, 2);
const DEFAULT_DPIA = JSON.stringify({ dataTypes: ['email', 'phone', 'address', 'health-records', 'biometric', 'browse'], purposes: ['marketing', 'analytics', 'fraud-prevention'], involvesMinors: false, crossBorderTransfer: true }, null, 2);
const DEFAULT_BREACH = JSON.stringify({ severity: 'high', affectedUsers: 8400, compromisedData: ['email', 'hashed-password', 'phone'] }, null, 2);

export function PrivacyActionPanel() {
  const [invText, setInvText] = useState(DEFAULT_INV);
  const [consentText, setConsentText] = useState(DEFAULT_CONSENT);
  const [dpiaText, setDpiaText] = useState(DEFAULT_DPIA);
  const [breachText, setBreachText] = useState(DEFAULT_BREACH);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [invResult, setInvResult] = useState<InventoryResult | null>(null);
  const [consentResult, setConsentResult] = useState<ConsentResult | null>(null);
  const [dpiaResult, setDpiaResult] = useState<DpiaResult | null>(null);
  const [breachResult, setBreachResult] = useState<BreachResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actInv() {
    try { const parsed = JSON.parse(invText); setBusy('inventory'); setFeedback(null);
      const r = await callMacro<InventoryResult>('dataInventory', { artifact: { data: parsed } });
      if (r.ok && r.result) { setInvResult(r.result); ok(`${r.result.sensitiveItems}/${r.result.totalItems} sensitive · ${r.result.riskLevel}`); } else err(r.error ?? 'inv failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid inv JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConsent() {
    try { const parsed = JSON.parse(consentText); setBusy('consent'); setFeedback(null);
      const r = await callMacro<ConsentResult>('consentAudit', { artifact: { data: parsed } });
      if (r.ok && r.result) { setConsentResult(r.result); ok(`${r.result.complianceRate}% · ${r.result.expired} expired`); } else err(r.error ?? 'consent failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid consent JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDpia() {
    try { const parsed = JSON.parse(dpiaText); setBusy('dpia'); setFeedback(null);
      const r = await callMacro<DpiaResult>('impactAssessment', { artifact: { data: parsed } });
      if (r.ok && r.result) { setDpiaResult(r.result); ok(`${r.result.riskLevel} · DPIA ${r.result.dpiaRequired ? 'required' : 'optional'}`); } else err(r.error ?? 'dpia failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid dpia JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBreach() {
    try { const parsed = JSON.parse(breachText); setBusy('breach'); setFeedback(null);
      const r = await callMacro<BreachResult>('breachResponse', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBreachResult(r.result); ok(`${r.result.severity} · notif ${r.result.notificationRequired ? 'YES' : 'no'}`); } else err(r.error ?? 'breach failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid breach JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Privacy audit`, tags: ['privacy', invResult?.riskLevel, dpiaResult?.riskLevel].filter((t): t is string => !!t), source: 'privacy:audit:mint', meta: { visibility: 'private', consent: { allowCitations: false }, privacy: { inv: invResult, consent: consentResult, dpia: dpiaResult, breach: breachResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Audit DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🔐 Privacy audit`, '', invResult ? `Inventory: ${invResult.sensitiveItems}/${invResult.totalItems} sensitive · risk ${invResult.riskLevel} · GDPR-relevant: ${invResult.gdprRelevant}` : '', consentResult ? `Consent: ${consentResult.complianceRate}% compliant · ${consentResult.expired} expired · ${consentResult.action}` : '', dpiaResult ? `DPIA: ${dpiaResult.riskLevel} · required: ${dpiaResult.dpiaRequired} · ${dpiaResult.riskFactors.length} risk factors` : '', breachResult ? `Breach: ${breachResult.severity} · ${breachResult.affectedUsers.toLocaleString()} users · notif req: ${breachResult.notificationRequired} (${breachResult.regulatoryDeadline})` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!invResult && !consentResult) { err('Run inventory or consent first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Privacy posture`, tags: ['privacy', 'posture', 'public'], source: 'privacy:posture:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, privacy: { inv: invResult, consent: consentResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Data Protection Officer brief. ${invResult ? `Inventory: ${invResult.sensitiveItems}/${invResult.totalItems} sensitive (risk ${invResult.riskLevel}).` : ''} ${consentResult ? `Consent ${consentResult.complianceRate}% compliant, ${consentResult.expired} expired.` : ''} ${dpiaResult ? `DPIA: ${dpiaResult.riskLevel}, ${dpiaResult.riskFactors.length} risk factors.` : ''} ${breachResult ? `Breach severity ${breachResult.severity}, ${breachResult.affectedUsers.toLocaleString()} affected.` : ''} Recommend the most-urgent compliance fix + one process improvement. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('DPO brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'inventory' as ActionId, label: 'Inventory', desc: 'dataInventory', icon: Database, accent: '#3b82f6', handler: actInv },
    { id: 'consent' as ActionId, label: 'Consent', desc: 'consentAudit', icon: ShieldCheck, accent: '#22c55e', handler: actConsent },
    { id: 'dpia' as ActionId, label: 'DPIA', desc: 'impactAssessment', icon: FileWarning, accent: '#f59e0b', handler: actDpia },
    { id: 'breach' as ActionId, label: 'Breach', desc: 'breachResponse (72h)', icon: AlertOctagon, accent: '#ef4444', handler: actBreach },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private audit', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send audit', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon posture', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'DPO', desc: 'Agent: top fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const RISK_COLOR: Record<string, string> = { high: 'text-red-300', moderate: 'text-amber-300', low: 'text-emerald-300' };
  const SEV_COLOR: Record<string, string> = { critical: 'text-red-500', high: 'text-red-300', medium: 'text-amber-300', low: 'text-emerald-300' };

  return (
    <div className="rounded-lg border border-blue-700/30 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-700/20 pb-2">
        <ShieldCheck className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Privacy / DPO bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">inventory · consent · DPIA · breach</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Data items JSON</label>
          <textarea value={invText} onChange={(e) => setInvText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Consents JSON</label>
          <textarea value={consentText} onChange={(e) => setConsentText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">DPIA JSON</label>
          <textarea value={dpiaText} onChange={(e) => setDpiaText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Breach JSON</label>
          <textarea value={breachText} onChange={(e) => setBreachText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {invResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Inventory</div>
            <div className={cn('text-2xl font-bold', RISK_COLOR[invResult.riskLevel])}>{invResult.sensitiveItems}<span className="text-xs text-zinc-400">/{invResult.totalItems}</span></div>
            <div className="text-[10px] text-zinc-300">sensitive · {invResult.riskLevel} risk{invResult.gdprRelevant ? ' · GDPR' : ''}</div>
            {Object.entries(invResult.categories).map(([k, v], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{k}</span><span className="font-mono text-blue-200">{v}</span></div>)}
            {invResult.recommendations.slice(0, 2).map((r, i) => <div key={i} className="text-[10px] text-blue-200 mt-0.5">→ {r}</div>)}
          </div>
        )}
        {consentResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Consent</div>
            <div className={cn('text-3xl font-bold', consentResult.complianceRate >= 80 ? 'text-emerald-300' : consentResult.complianceRate >= 50 ? 'text-amber-300' : 'text-red-300')}>{consentResult.complianceRate}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">{consentResult.active} active · {consentResult.expired} expired · {consentResult.withdrawn} withdrawn</div>
            {consentResult.issues.slice(0, 4).map((i, n) => <div key={n} className="text-[10px] text-red-300 mt-0.5">⚠ {i.user}: expired {i.expiredOn}</div>)}
            <div className="text-[10px] text-green-200 mt-1 italic">{consentResult.action}</div>
          </div>
        )}
        {dpiaResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', dpiaResult.riskLevel === 'high' ? 'border-red-500/40 bg-red-500/10' : dpiaResult.riskLevel === 'moderate' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">DPIA · {dpiaResult.riskLevel}</div>
            <div className={cn('text-xl font-bold', RISK_COLOR[dpiaResult.riskLevel])}>{dpiaResult.dpiaRequired ? 'Required' : 'Optional'}</div>
            <div className="text-[10px] text-zinc-300">{dpiaResult.dataTypesCount} data types · {dpiaResult.purposes} purposes</div>
            {dpiaResult.riskFactors.map((r, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {r}</div>)}
            {dpiaResult.mitigations.slice(0, 2).map((m, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">→ {m.mitigation}</div>)}
          </div>
        )}
        {breachResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', breachResult.severity === 'critical' ? 'border-red-500/50 bg-red-500/15' : breachResult.severity === 'high' ? 'border-red-500/40 bg-red-500/10' : breachResult.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Breach · {breachResult.severity}</div>
            <div className={cn('text-2xl font-bold', SEV_COLOR[breachResult.severity])}>{breachResult.affectedUsers.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-300">users · notif: {breachResult.notificationRequired ? 'YES' : 'no'}</div>
            <div className="text-[10px] text-zinc-500">{breachResult.regulatoryDeadline}</div>
            {breachResult.priorityActions.slice(0, 3).map((a, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5">→ {a}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> DPO brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
