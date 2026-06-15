'use client';

/**
 * ArgumentWorkbench — a step-by-step argument-analysis surface
 * for the reasoning lens. Takes a free-text argument or statement,
 * runs the 4 reasoning macros that previously had no UI, and exposes
 * the standard mint/DM/publish/agent quartet on top.
 *
 *   1. Logic validate   → reasoning.logicValidate
 *   2. Argument map     → reasoning.argumentMap (structured tree)
 *   3. Fallacy detect   → reasoning.fallacyDetect
 *   4. Premise extract  → reasoning.premiseExtract
 *   5. Mint reasoning   → dtu.create with the argument + all macro
 *                          outputs (private; tags=[reasoning,validated])
 *   6. DM derivation    → /api/social/dm with the structured premises
 *                          + validation verdict
 *   7. Publish proof    → dtu.create public + cite + flag published
 *                          (federation pickup for verifiable arguments)
 *   8. Cross-check (agent) → chat_agent.do "challenge this argument
 *                          with the strongest counter-derivation"
 */

import { useState } from 'react';
import {
  Brain, CheckCircle2, GitFork, AlertTriangle, ListChecks,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('reasoning', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'validate' | 'map' | 'fallacy' | 'premise' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ValidateResult { valid?: boolean; soundness?: number; issues?: string[]; verdict?: string }
interface MapResult { nodes?: Array<{ id: string; text: string; role?: string }>; edges?: Array<{ from: string; to: string; kind?: string }> }
interface FallacyResult { fallacies?: Array<{ name: string; explanation?: string }>; clean?: boolean }
interface PremiseResult { premises?: string[]; conclusion?: string; hidden?: string[] }

export function ArgumentWorkbench() {
  const [argument, setArgument] = useState('');
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [mapResult, setMapResult] = useState<MapResult | null>(null);
  const [fallacyResult, setFallacyResult] = useState<FallacyResult | null>(null);
  const [premiseResult, setPremiseResult] = useState<PremiseResult | null>(null);
  const [mintDtuId, setMintDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = argument.trim().length > 0;

  async function actValidate() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('validate'); setFeedback(null);
    try {
      const r = await callMacro<ValidateResult>('logicValidate', { argument: argument.trim() });
      if (r.ok && r.result) { setValidateResult(r.result); ok(r.result.valid ? 'Valid.' : 'Issues flagged.'); }
      else err(r.error ?? 'validate failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMap() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('map'); setFeedback(null);
    try {
      const r = await callMacro<MapResult>('argumentMap', { argument: argument.trim() });
      if (r.ok && r.result) { setMapResult(r.result); ok(`Mapped ${r.result.nodes?.length ?? 0} nodes.`); }
      else err(r.error ?? 'map failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actFallacy() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('fallacy'); setFeedback(null);
    try {
      const r = await callMacro<FallacyResult>('fallacyDetect', { argument: argument.trim() });
      if (r.ok && r.result) {
        setFallacyResult(r.result);
        const cnt = r.result.fallacies?.length ?? 0;
        ok(cnt === 0 ? 'No fallacies.' : `${cnt} flagged.`);
      } else err(r.error ?? 'fallacy detect failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPremise() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('premise'); setFeedback(null);
    try {
      const r = await callMacro<PremiseResult>('premiseExtract', { argument: argument.trim() });
      if (r.ok && r.result) { setPremiseResult(r.result); ok(`${r.result.premises?.length ?? 0} premises extracted.`); }
      else err(r.error ?? 'premise extract failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Reasoning — ${argument.trim().slice(0, 60)}${argument.length > 60 ? '…' : ''}`,
          tags: ['reasoning', 'derivation', validateResult?.valid ? 'validated' : 'unvalidated'].filter(Boolean) as string[],
          source: 'reasoning:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            argument: argument.trim(),
            validate: validateResult,
            argumentMap: mapResult,
            fallacies: fallacyResult,
            premises: premiseResult,
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintDtuId(id); ok(`Derivation DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!ready) { err('Enter an argument.'); return; }
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const parts: string[] = [
      `🧠 Argument for review`,
      ``,
      argument.trim(),
      ``,
    ];
    if (premiseResult?.premises?.length) {
      parts.push(`Premises:`);
      premiseResult.premises.forEach((p, i) => parts.push(`  P${i + 1}. ${p}`));
      if (premiseResult.conclusion) parts.push(`  C.  ${premiseResult.conclusion}`);
      parts.push('');
    }
    if (validateResult?.verdict) {
      parts.push(`Validity verdict: ${validateResult.verdict}`);
    }
    if (fallacyResult?.fallacies?.length) {
      parts.push(`Flagged fallacies: ${fallacyResult.fallacies.map(f => f.name).join(', ')}`);
    }
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: parts.join('\n') });
      if (r.data?.ok !== false) { ok(`Sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Public proof — ${argument.trim().slice(0, 60)}${argument.length > 60 ? '…' : ''}`,
          tags: ['reasoning', 'proof', 'public', validateResult?.valid ? 'validated' : 'unvalidated'].filter(Boolean) as string[],
          source: 'reasoning:proof:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            argument: argument.trim(),
            premises: premiseResult?.premises ?? null,
            conclusion: premiseResult?.conclusion ?? null,
            verdict: validateResult?.verdict ?? null,
            fallacies: fallacyResult?.fallacies?.map(f => f.name) ?? [],
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Proof published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!ready) { err('Enter an argument.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Challenge this argument with the strongest possible counter-derivation. Be rigorous.`,
        ``,
        `Argument: "${argument.trim()}"`,
        premiseResult?.premises?.length ? `Stated premises: ${premiseResult.premises.join('; ')}` : '',
        premiseResult?.conclusion ? `Conclusion: ${premiseResult.conclusion}` : '',
        ``,
        `Return a plaintext counter-derivation: 1) the strongest objection to the conclusion;`,
        `2) any hidden premises this argument relies on; 3) what evidence would resolve the disagreement.`,
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Counter-derivation ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'validate', label: 'Validate',    desc: 'Soundness check + verdict',                       icon: CheckCircle2, accent: '#22c55e', handler: actValidate, disabled: !ready },
    { id: 'map',      label: 'Map',         desc: 'Structured argument tree',                        icon: GitFork,      accent: '#06b6d4', handler: actMap,      disabled: !ready },
    { id: 'fallacy',  label: 'Fallacies',   desc: 'Scan for logical fallacies',                      icon: AlertTriangle, accent: '#ef4444', handler: actFallacy,  disabled: !ready },
    { id: 'premise',  label: 'Premises',    desc: 'Extract premises + conclusion + hidden ones',     icon: ListChecks,   accent: '#8b5cf6', handler: actPremise,  disabled: !ready },
    { id: 'mint',     label: mintDtuId      ? 'Saved' : 'Mint derivation',  desc: mintDtuId      ? `DTU ${mintDtuId.slice(0, 8)}…`      : 'Private DTU with full analysis',         icon: Sparkles,     accent: '#3b82f6', handler: actMint,     disabled: !ready || !!mintDtuId },
    { id: 'dm',       label: 'DM for review', desc: 'DM premises + verdict to another user',         icon: Send,         accent: '#ec4899', handler: actDm,       disabled: !ready },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish proof', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public DTU + federation flag',         icon: Globe,        accent: '#15803d', handler: actPublish,  disabled: !ready || !!publishedDtuId },
    { id: 'agent',    label: 'Cross-check',  desc: 'Agent returns strongest counter-derivation',     icon: Wand2,        accent: '#eab308', handler: actAgent,    disabled: !ready },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Brain className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Argument workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          step-by-step
        </span>
      </header>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Argument or statement</label>
        <textarea
          value={argument}
          onChange={(e) => setArgument(e.target.value)}
          rows={4}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none font-mono"
          placeholder='If all swans I have seen are white, then all swans are white. Therefore the swan in the next pond will be white…'
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for review)</label>
          <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="reviewer user id" />
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
                'bg-zinc-900/40 border-zinc-800',
                'hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-900/40 disabled:hover:border-zinc-800',
                'focus:outline-none focus:ring-2 focus:ring-purple-400/40',
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {validateResult && (
          <div className={cn('rounded-md border p-2.5 space-y-1', validateResult.valid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5', validateResult.valid ? 'text-emerald-300' : 'text-amber-300')}>
              {validateResult.valid ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              Validity: {validateResult.verdict ?? (validateResult.valid ? 'valid' : 'invalid')}
            </div>
            {validateResult.soundness != null && <div className="text-[11px] text-zinc-300">Soundness: {(validateResult.soundness * 100).toFixed(0)}%</div>}
            {validateResult.issues?.length ? (
              <ul className="text-[11px] text-zinc-300 list-disc list-inside">
                {validateResult.issues.map((i, idx) => <li key={idx}>{i}</li>)}
              </ul>
            ) : null}
          </div>
        )}

        {premiseResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
              <ListChecks className="w-3 h-3" /> Premises
            </div>
            {premiseResult.premises?.map((p, i) => (
              <div key={i} className="text-[11px] text-zinc-300"><span className="text-purple-300 font-mono">P{i + 1}.</span> {p}</div>
            ))}
            {premiseResult.conclusion && (
              <div className="text-[11px] text-emerald-300 mt-1"><span className="font-mono">∴ C.</span> {premiseResult.conclusion}</div>
            )}
            {premiseResult.hidden?.length ? (
              <div className="text-[11px] text-amber-300 italic">Hidden assumptions: {premiseResult.hidden.join(' · ')}</div>
            ) : null}
          </div>
        )}

        {fallacyResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Fallacy scan
            </div>
            {fallacyResult.clean || (fallacyResult.fallacies?.length ?? 0) === 0 ? (
              <p className="text-[11px] text-emerald-300">No fallacies flagged.</p>
            ) : (
              <ul className="text-[11px] text-zinc-200 space-y-0.5">
                {fallacyResult.fallacies?.map((f, i) => (
                  <li key={i}>
                    <span className="font-semibold text-red-300">{f.name}</span>
                    {f.explanation && <span className="text-zinc-400"> — {f.explanation}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mapResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-1 overflow-x-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
              <GitFork className="w-3 h-3" /> Argument map ({mapResult.nodes?.length ?? 0} nodes, {mapResult.edges?.length ?? 0} edges)
            </div>
            {mapResult.nodes?.slice(0, 8).map(n => (
              <div key={n.id} className="text-[11px] text-zinc-300 font-mono">
                <span className="text-cyan-300">{n.id}</span>{n.role ? <span className="text-zinc-400"> [{n.role}]</span> : null}: {n.text.slice(0, 100)}
              </div>
            ))}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" />
            Counter-derivation
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
