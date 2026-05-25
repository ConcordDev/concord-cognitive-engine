'use client';

/**
 * DilemmaPanel — Are.na / IEP-shape action surface for the philosophy
 * lens. Self-contained input form runs the 4 philosophy macros that
 * previously had no UI, plus mint/DM/publish/agent on top.
 *
 *   1. Argument map      → philosophy.argumentMap (validity + soundness)
 *   2. Thought experiment → philosophy.thoughtExperiment (permutations
 *                          + 3 ethics frameworks)
 *   3. Dialectic         → philosophy.dialecticSynthesis (Hegelian)
 *   4. Ethical frameworks → philosophy.ethicalFramework (6 schools)
 *   5. Mint              → dtu.create with the dilemma + outputs
 *   6. DM for debate     → /api/social/dm with structured argument
 *   7. Publish for review → dtu.create public + flag published
 *   8. Synthesis (agent) → chat_agent.do "synthesize the strongest
 *                          position across the 6 ethical frameworks"
 */

import { useState } from 'react';
import {
  GitFork, Brain, Scale, Lightbulb,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, ScrollText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('philosophy', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'argument' | 'experiment' | 'dialectic' | 'ethics' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ArgMapResult { validity?: string; soundness?: string; form?: string; premises?: Array<{ number: number; text: string; supported: boolean }>; conclusion?: string }
interface DialecticResult { thesis?: string; antithesis?: string; steps?: string[] }
interface EthicsResult { frameworks?: Array<{ framework: string; principle: string }>; note?: string }

export function DilemmaPanel() {
  const [dilemma, setDilemma] = useState('');
  const [premisesText, setPremisesText] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [thesis, setThesis] = useState('');
  const [antithesis, setAntithesis] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [argResult, setArgResult] = useState<ArgMapResult | null>(null);
  const [dialecticResult, setDialecticResult] = useState<DialecticResult | null>(null);
  const [ethicsResult, setEthicsResult] = useState<EthicsResult | null>(null);
  const [mintDtuId, setMintDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [dmRecipient, setDmRecipient] = useState('');
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });
  const premisesList = premisesText.split('\n').map(s => s.trim()).filter(Boolean);

  async function actArg() {
    if (!premisesList.length || !conclusion.trim()) { err('Add premises (one per line) + conclusion.'); return; }
    setBusy('argument'); setFeedback(null);
    try {
      const r = await callMacro<ArgMapResult>('argumentMap', { premises: premisesList.map(text => ({ text, supported: true })), conclusion: conclusion.trim() });
      if (r.ok && r.result) { setArgResult(r.result); ok(`${r.result.validity ?? '—'} / ${r.result.soundness ?? '—'}.`); }
      else err(r.error ?? 'argument map failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actExperiment() {
    if (!dilemma.trim()) { err('Enter a dilemma.'); return; }
    setBusy('experiment'); setFeedback(null);
    try {
      const r = await callMacro<EthicsResult>('thoughtExperiment', { scenario: dilemma.trim(), variables: [] });
      if (r.ok && r.result) { setEthicsResult(r.result); ok('Frameworks loaded.'); }
      else err(r.error ?? 'thought experiment failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDialectic() {
    if (!thesis.trim() || !antithesis.trim()) { err('Add thesis + antithesis.'); return; }
    setBusy('dialectic'); setFeedback(null);
    try {
      const r = await callMacro<DialecticResult>('dialecticSynthesis', { thesis: thesis.trim(), antithesis: antithesis.trim() });
      if (r.ok && r.result) { setDialecticResult(r.result); ok('Dialectic steps ready.'); }
      else err(r.error ?? 'dialectic failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actEthics() {
    if (!dilemma.trim()) { err('Enter a dilemma.'); return; }
    setBusy('ethics'); setFeedback(null);
    try {
      const r = await callMacro<EthicsResult>('ethicalFramework', { dilemma: dilemma.trim() });
      if (r.ok && r.result) { setEthicsResult(r.result); ok('Ethics frameworks ready.'); }
      else err(r.error ?? 'ethics framework failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    if (!dilemma.trim() && !premisesList.length && !thesis.trim()) { err('Enter at least one of: dilemma, premises, thesis.'); return; }
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Philosophy work — ${(dilemma || thesis || conclusion).slice(0, 60)}…`,
          tags: ['philosophy', 'dilemma', 'work-in-progress'],
          source: 'philosophy:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            dilemma: dilemma.trim(),
            argument: { premises: premisesList, conclusion: conclusion.trim() },
            dialectic: { thesis: thesis.trim(), antithesis: antithesis.trim() },
            results: { argumentMap: argResult, ethics: ethicsResult, dialectic: dialecticResult },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintDtuId(id); ok(`DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!dmRecipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const parts: string[] = [`📜 Dilemma for debate`, ``];
    if (dilemma.trim()) parts.push(dilemma.trim(), '');
    if (premisesList.length) {
      parts.push(`Premises:`, ...premisesList.map((p, i) => `  P${i + 1}. ${p}`));
      if (conclusion.trim()) parts.push(`  ∴ C.  ${conclusion.trim()}`);
      parts.push('');
    }
    if (thesis.trim() && antithesis.trim()) {
      parts.push(`Thesis:     ${thesis.trim()}`);
      parts.push(`Antithesis: ${antithesis.trim()}`);
    }
    try {
      const r = await api.post('/api/social/dm', { toUserId: dmRecipient.trim(), content: parts.join('\n') });
      if (r.data?.ok !== false) { ok(`Sent to ${dmRecipient.trim()}.`); setDmRecipient(''); }
      else err(r.data?.error ?? 'send failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Public dilemma — ${(dilemma || thesis || conclusion).slice(0, 60)}…`,
          tags: ['philosophy', 'public', 'community-review'],
          source: 'philosophy:publish',
          meta: {
            visibility: 'public',
            consent: { allowCitations: true },
            dilemma: dilemma.trim(),
            argument: { premises: premisesList, conclusion: conclusion.trim() },
            dialectic: { thesis: thesis.trim(), antithesis: antithesis.trim() },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (!id) { err('No DTU id returned.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); }
      else err(pub.data?.error ?? 'publish flag failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    if (!dilemma.trim()) { err('Enter a dilemma.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Dilemma: "${dilemma.trim()}".`,
        thesis.trim() && antithesis.trim() ? `Thesis vs Antithesis: "${thesis.trim()}" vs "${antithesis.trim()}".` : '',
        premisesList.length ? `Premises: ${premisesList.join('; ')}. Conclusion: ${conclusion.trim()}.` : '',
        ``,
        `Synthesize the strongest position across utilitarian, deontological, virtue, care, rights, and justice frameworks.`,
        `Return: 1) the framework that best fits this dilemma and why; 2) the genuine tension across frameworks;`,
        `3) a proposed synthesis that preserves the moral force of each.`,
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', {
        domain: 'chat_agent', name: 'do',
        input: { task, maxTurns: 5 },
      });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) {
        setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2));
        ok('Synthesis ready.');
      } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'argument',   label: 'Argument map',     desc: 'Premises → conclusion (validity + soundness)', icon: GitFork,    accent: '#06b6d4', handler: actArg },
    { id: 'experiment', label: 'Thought exp.',     desc: 'Variables + permutations + framework hints',   icon: Brain,      accent: '#8b5cf6', handler: actExperiment },
    { id: 'dialectic',  label: 'Dialectic',        desc: 'Hegelian thesis/antithesis/synthesis steps',   icon: GitFork,    accent: '#ec4899', handler: actDialectic },
    { id: 'ethics',     label: 'Ethics 6-pack',    desc: '6 schools applied to your dilemma',            icon: Scale,      accent: '#f97316', handler: actEthics },
    { id: 'mint',       label: mintDtuId      ? 'Saved'     : 'Mint',      desc: mintDtuId      ? `DTU ${mintDtuId.slice(0, 8)}…`      : 'Private DTU of dilemma + analysis',            icon: Sparkles,   accent: '#3b82f6', handler: actMint },
    { id: 'dm',         label: 'DM for debate',    desc: 'Structured dilemma to another user',           icon: Send,       accent: '#22c55e', handler: actDm },
    { id: 'publish',    label: publishedDtuId ? 'Published' : 'Publish',   desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public DTU + federation flag',                 icon: Globe,      accent: '#15803d', handler: actPublish },
    { id: 'agent',      label: 'Synthesize',       desc: 'Agent: strongest cross-framework position',    icon: Wand2,      accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <ScrollText className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Dilemma workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          are.na · IEP
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Dilemma / scenario</label>
            <textarea value={dilemma} onChange={(e) => setDilemma(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none" placeholder="The trolley diverts onto five people you don't know vs. one you love..." />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Premises (one per line)</label>
            <textarea value={premisesText} onChange={(e) => setPremisesText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-purple-400/40 resize-none font-mono" placeholder="All humans are mortal.&#10;Socrates is a human." />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Conclusion</label>
            <input type="text" value={conclusion} onChange={(e) => setConclusion(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-purple-400/40" placeholder="Socrates is mortal." />
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Thesis</label>
            <input type="text" value={thesis} onChange={(e) => setThesis(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="Freedom is the highest value." />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Antithesis</label>
            <input type="text" value={antithesis} onChange={(e) => setAntithesis(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-pink-400/40" placeholder="Equality is the highest value." />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM recipient (for debate)</label>
            <input type="text" value={dmRecipient} onChange={(e) => setDmRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:ring-2 focus:ring-green-400/40" placeholder="interlocutor user id" />
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
              disabled={!!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed',
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
        {argResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
              <GitFork className="w-3 h-3" /> Argument map — {argResult.validity ?? '—'} / {argResult.soundness ?? '—'} ({argResult.form})
            </div>
            {argResult.premises?.map(p => (
              <div key={p.number} className="text-[11px] text-zinc-300"><span className="text-cyan-300 font-mono">P{p.number}.</span> {p.text}{p.supported === false && <span className="text-amber-300 ml-1">⚠</span>}</div>
            ))}
            {argResult.conclusion && <div className="text-[11px] text-emerald-300"><span className="font-mono">∴ C.</span> {argResult.conclusion}</div>}
          </div>
        )}

        {dialecticResult && (
          <div className="rounded-md border border-pink-500/30 bg-pink-500/5 p-2.5 space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold flex items-center gap-1.5">
              <Lightbulb className="w-3 h-3" /> Dialectic steps
            </div>
            <ol className="text-[11px] text-zinc-300 list-decimal list-inside space-y-0.5">
              {dialecticResult.steps?.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
        )}

        {ethicsResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 space-y-1 md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5">
              <Scale className="w-3 h-3" /> Ethics frameworks
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {ethicsResult.frameworks?.map((f, i) => (
                <div key={i} className="text-[11px] text-zinc-300"><span className="text-orange-300 font-semibold capitalize">{f.framework}:</span> {f.principle}</div>
              ))}
            </div>
            {ethicsResult.note && <p className="text-[10px] text-zinc-400 italic">{ethicsResult.note}</p>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Synthesis
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
