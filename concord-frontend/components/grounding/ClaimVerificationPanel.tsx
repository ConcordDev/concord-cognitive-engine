'use client';

/**
 * ClaimVerificationPanel — quick-check epistemic workbench for the grounding
 * lens (Insight Timer was a rubric miscategorization; the Concord
 * "grounding" lens is fact-checking, not meditation).
 *
 *   1. Fact check        → grounding.factCheck (verdict + confidence, stance-scored vs. evidence)
 *   2. Source credibility → grounding.sourceCredibility (authority/recency/bias/consistency/transparency composite)
 *   3. Claim decomposition → grounding.claimDecomposition (atomic claims + logical structure)
 *   4. Mint verification → private DTU with all 3 results
 *   5. DM source         → /api/social/dm with claim + verdict + sources
 *   6. Publish reviewed claim → public DTU + flag published
 *   7. Counter-evidence (agent) → chat_agent.do strongest counter
 *
 * WIRING NOTE (fixed 2026-07-09, grounding-lens rebuild): the previous
 * version of this panel called `factCheck`/`sourceCredibility`/
 * `claimDecomposition` with the WRONG input shapes — a plain string for
 * `claim` instead of `{ text }`, a single `source` URL instead of a
 * `sources[]` array, and no `evidence[]` at all. The real handlers
 * (server/domains/grounding.js) always hit their trivial "no claim/evidence
 * provided" branch as a result, while the UI still rendered a confident-
 * looking "Verdict: undefined." success toast — a wiring bug that produced a
 * fabricated-looking result from a check that never actually ran. Fixed by
 * (a) adding a real evidence-entry list + a real structured source-detail
 * form matching the macros' actual parameter shapes, and (b) correcting
 * every TypeScript result interface to the macros' real output shape.
 */

import { useState } from 'react';
import {
  ShieldCheck, CheckCircle, FileBadge, ListTree,
  Sparkles, Send, Globe, Wand2, Plus, Trash2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'factcheck' | 'credibility' | 'decompose' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

type EvidenceRow = { text: string; source: string };

// ---- real macro result shapes (server/domains/grounding.js) ---------------
interface FactCheckResult {
  message?: string;
  claim?: string; verdict?: string; confidence?: number; direction?: string;
  evidenceCount?: number;
  breakdown?: { supporting: { count: number }; contradicting: { count: number }; neutral: { count: number } };
  evaluations?: Array<{ source: string; stance: string; relevance: number; reliability: number }>;
}
interface CredibilityResult {
  message?: string;
  sourceCount?: number; averageCredibility?: number; overallAssessment?: string;
  sources?: Array<{ name: string; credibilityScore: number; credibilityLabel: string; type: string }>;
  recommendations?: string[];
}
interface DecomposeResult {
  message?: string;
  atomicClaimCount?: number; logicalStructure?: string; claimComplexity?: string; overallAssessment?: string;
  components?: Array<{ index: number; text: string; claimType: string; evaluation?: { verdict: string; score: number } | null }>;
}

export function ClaimVerificationPanel() {
  const [claim, setClaim] = useState('');
  const [evidence, setEvidence] = useState<EvidenceRow[]>([{ text: '', source: '' }]);
  const [srcName, setSrcName] = useState('');
  const [srcUrl, setSrcUrl] = useState('');
  const [srcType, setSrcType] = useState('unknown');
  const [srcClaims, setSrcClaims] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [factResult, setFactResult] = useState<FactCheckResult | null>(null);
  const [credibilityResult, setCredibilityResult] = useState<CredibilityResult | null>(null);
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (text: string) => setFeedback({ kind: 'ok', text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const ready = claim.trim().length > 0;
  const evidenceRows = evidence.filter((e) => e.text.trim());

  async function actFact() {
    if (!ready) { err('Enter a claim.'); return; }
    setBusy('factcheck'); setFeedback(null);
    try {
      const r = await lensRun<FactCheckResult>('grounding', 'factCheck', {
        claim: { text: claim.trim() },
        evidence: evidenceRows.map((e) => ({ text: e.text.trim(), source: e.source.trim() || undefined })),
      });
      if (!r.data.ok) { err(r.data.error ?? 'fact check failed'); return; }
      const res = r.data.result;
      setFactResult(res);
      if (res?.verdict) ok(`Verdict: ${res.verdict}${res.confidence != null ? ` (${Math.round(res.confidence * 100)}%)` : ''}.`);
      else ok(res?.message || 'No verdict — add evidence to score this claim.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actCredibility() {
    if (!srcUrl.trim() && !srcName.trim()) { err('Enter a source name or URL.'); return; }
    setBusy('credibility'); setFeedback(null);
    try {
      const claims = srcClaims.split('\n').map((s) => s.trim()).filter(Boolean);
      const r = await lensRun<CredibilityResult>('grounding', 'sourceCredibility', {
        sources: [{ name: srcName.trim() || undefined, url: srcUrl.trim() || undefined, type: srcType, claims }],
      });
      if (!r.data.ok) { err(r.data.error ?? 'credibility check failed'); return; }
      const res = r.data.result;
      setCredibilityResult(res);
      const top = res?.sources?.[0];
      if (top) ok(`${top.credibilityLabel} (${top.credibilityScore}/100).`);
      else ok(res?.message || 'No sources scored.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDecompose() {
    if (!ready) { err('Enter a claim.'); return; }
    setBusy('decompose'); setFeedback(null);
    try {
      const r = await lensRun<DecomposeResult>('grounding', 'claimDecomposition', {
        claim: { text: claim.trim() },
        evidence: evidenceRows.map((e) => ({ text: e.text.trim(), source: e.source.trim() || undefined })),
      });
      if (!r.data.ok) { err(r.data.error ?? 'decompose failed'); return; }
      const res = r.data.result;
      setDecomposeResult(res);
      ok(res?.atomicClaimCount ? `${res.atomicClaimCount} atomic claims (${res.logicalStructure}).` : (res?.message || 'No claims decomposed.'));
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!ready) { err('Enter a claim.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Verification — ${claim.trim().slice(0, 60)}${claim.length > 60 ? '…' : ''}`,
          tags: ['grounding', 'verification', factResult?.verdict ?? 'unchecked'],
          source: 'grounding:verification:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            verification: {
              claim: claim.trim(),
              evidence: evidenceRows,
              factCheck: factResult,
              credibility: credibilityResult,
              decomposition: decomposeResult,
              checkedAt: new Date().toISOString(),
            },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); ok(`Verification DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!ready) { err('Enter a claim.'); return; }
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `🔍 Claim verification`,
      ``,
      `Claim: ${claim.trim()}`,
      factResult?.verdict ? `Verdict: ${factResult.verdict} (${factResult.confidence != null ? Math.round(factResult.confidence * 100) + '%' : '—'})` : '',
      credibilityResult?.sources?.[0] ? `Source: ${credibilityResult.sources[0].credibilityLabel} (${credibilityResult.sources[0].credibilityScore}/100)` : '',
      decomposeResult?.atomicClaimCount ? `Atomic claims: ${decomposeResult.atomicClaimCount}` : '',
      mintedDtuId ? `\n[Verification DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
      if (r.data?.ok !== false) { ok(`Sent to ${recipient.trim()}.`); setRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    if (!ready) { err('Enter a claim.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Reviewed claim — ${claim.trim().slice(0, 60)}…`,
          tags: ['grounding', 'reviewed-claim', 'public', factResult?.verdict ?? 'unverified'],
          source: 'grounding:reviewed:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            claim: claim.trim(),
            verdict: factResult?.verdict,
            confidence: factResult?.confidence,
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Reviewed claim published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!ready) { err('Enter a claim.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Provide the strongest counter-evidence to this claim. Be specific.`,
        ``,
        `Claim: "${claim.trim()}"`,
        factResult?.verdict ? `Initial verdict: ${factResult.verdict}.` : '',
        ``,
        `Return: 1) the 2-3 strongest pieces of counter-evidence (with source type if known);`,
        `2) what data would resolve the disagreement;`,
        `3) one likely cognitive bias that supports the original claim.`,
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 5 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Counter-evidence ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'factcheck',   label: 'Fact check',     desc: 'Verdict + confidence vs. evidence',        icon: CheckCircle, accent: '#22c55e', handler: actFact,        disabled: !ready },
    { id: 'credibility', label: 'Source tier',    desc: 'Score the source below',                   icon: FileBadge,   accent: '#06b6d4', handler: actCredibility, disabled: !srcUrl.trim() && !srcName.trim() },
    { id: 'decompose',   label: 'Decompose',      desc: 'Break claim into atomic, verifiable parts', icon: ListTree,   accent: '#8b5cf6', handler: actDecompose,   disabled: !ready },
    { id: 'mint',        label: mintedDtuId      ? 'Saved'     : 'Mint',         desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private verification DTU',                  icon: Sparkles,    accent: '#3b82f6', handler: actMint,        disabled: !ready || !!mintedDtuId },
    { id: 'dm',          label: 'DM',             desc: 'Send verdict + sources to another user',   icon: Send,        accent: '#ec4899', handler: actDm,          disabled: !ready },
    { id: 'publish',     label: publishedDtuId ? 'Published' : 'Publish',        desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public reviewed-claim DTU + federation',    icon: Globe,       accent: '#15803d', handler: actPublish,     disabled: !ready || !!publishedDtuId },
    { id: 'agent',       label: 'Counter (agent)', desc: 'Strongest counter-evidence + biases',     icon: Wand2,       accent: '#eab308', handler: actAgent,       disabled: !ready },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <ShieldCheck className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Quick claim verification</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          grounding · fact-check
        </span>
      </header>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block" htmlFor="cvp-claim">Claim</label>
        <textarea id="cvp-claim" value={claim} onChange={(e) => setClaim(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 resize-none" placeholder="e.g. The fastest land animal is the cheetah." />
      </div>

      {/* Evidence list — feeds factCheck + claimDecomposition */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Evidence (optional, sharpens the check)</span>
          <button type="button" onClick={() => setEvidence((e) => [...e, { text: '', source: '' }])} className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700">
            <Plus className="h-3 w-3" /> Add evidence
          </button>
        </div>
        {evidence.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            <input value={row.text} onChange={(e) => setEvidence((arr) => arr.map((r, j) => j === i ? { ...r, text: e.target.value } : r))} placeholder="Evidence text…" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-blue-400/40" />
            <input value={row.source} onChange={(e) => setEvidence((arr) => arr.map((r, j) => j === i ? { ...r, source: e.target.value } : r))} placeholder="Source (optional)" className="w-32 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-blue-400/40" />
            {evidence.length > 1 && (
              <button aria-label="Remove evidence" type="button" onClick={() => setEvidence((arr) => arr.filter((_, j) => j !== i))} className="rounded bg-zinc-800 px-1.5 text-zinc-400 hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Source-under-evaluation — feeds sourceCredibility */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 border-t border-zinc-900 pt-2">
        <input value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Source name" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40" />
        <input value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="Source URL" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40" />
        <select value={srcType} onChange={(e) => setSrcType(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40">
          {['peer-reviewed', 'academic', 'government', 'institutional', 'news-major', 'news', 'encyclopedia', 'book', 'report', 'blog', 'social-media', 'forum', 'unknown'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="DM recipient (user id)" className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-pink-400/40" />
        <textarea value={srcClaims} onChange={(e) => setSrcClaims(e.target.value)} rows={2} placeholder="Source's claims, one per line (optional — improves bias/consistency scoring)" className="md:col-span-4 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40 resize-none" />
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
                'focus:outline-none focus:ring-2 focus:ring-blue-400/40',
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {factResult && (
          <div className={cn('rounded-md border p-2.5 space-y-0.5', factResult.verdict === 'likely true' ? 'border-emerald-500/40 bg-emerald-500/5' : factResult.verdict === 'likely false' ? 'border-rose-500/40 bg-rose-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 capitalize">
              <CheckCircle className="w-3 h-3" /> {factResult.verdict ?? factResult.message ?? '—'}{factResult.confidence != null && ` · ${Math.round(factResult.confidence * 100)}%`}
            </div>
            {factResult.breakdown && (
              <div className="text-[10px] text-zinc-300">
                <span className="text-emerald-300">{factResult.breakdown.supporting.count} supporting</span>
                {' · '}<span className="text-rose-300">{factResult.breakdown.contradicting.count} contradicting</span>
                {' · '}<span className="text-zinc-400">{factResult.breakdown.neutral.count} neutral</span>
              </div>
            )}
          </div>
        )}
        {credibilityResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-0.5">
            {credibilityResult.sources?.[0] ? (
              <>
                <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
                  <FileBadge className="w-3 h-3" /> {credibilityResult.sources[0].credibilityLabel} ({credibilityResult.sources[0].credibilityScore})
                </div>
                {credibilityResult.recommendations?.length ? <ul className="text-[11px] text-amber-300 list-disc list-inside">{credibilityResult.recommendations.map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
              </>
            ) : <p className="text-[11px] text-zinc-400">{credibilityResult.message}</p>}
          </div>
        )}
        {decomposeResult?.components?.length ? (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5">
              <ListTree className="w-3 h-3" /> {decomposeResult.atomicClaimCount} atomic claims &middot; {decomposeResult.logicalStructure}
            </div>
            {decomposeResult.components.slice(0, 5).map((c) => (
              <div key={c.index} className="text-[11px] text-zinc-300"><span className="text-purple-300 font-mono">{c.index}.</span> {c.text}{c.evaluation?.verdict === 'challenged' && <span className="text-amber-300 ml-1">⚠</span>}</div>
            ))}
          </div>
        ) : decomposeResult?.message ? (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <p className="text-[11px] text-zinc-400">{decomposeResult.message}</p>
          </div>
        ) : null}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Counter-evidence
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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
    </div>
  );
}
