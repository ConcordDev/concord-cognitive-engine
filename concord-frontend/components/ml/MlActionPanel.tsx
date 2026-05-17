'use client';

/**
 * MlActionPanel — ML practitioner's bench.
 * modelEvaluate / featureImportance / datasetProfile / hyperparameterSuggest +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Brain, Target, BarChart3, Sliders, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('ml', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'eval' | 'feat' | 'profile' | 'hyper' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface PerClass { class: string | number; precision: number; recall: number; f1: number; support: number }
interface EvalResult { type?: string; samples?: number; accuracy?: number; avgF1?: number; perClass?: PerClass[]; mse?: number; rmse?: number; mae?: number; r2?: number }
interface Ranking { feature: string; variance: number; stdDev: number; correlation: number; importance: number }
interface FeatResult { totalFeatures?: number; numericFeatures?: number; targetField?: string; rankings?: Ranking[]; topFeatures?: string[] }
interface ProfileStat { min: number; max: number; mean: number; median: number; q1: number; q3: number; outliers: number }
interface ProfileEntry { field: string; type: string; nullCount: number; nullRate: number; cardinality: number; stats?: ProfileStat }
interface ProfileResult { rows?: number; columns?: number; profile?: ProfileEntry[]; qualityScore?: number }
interface HyperResult { modelType?: string; taskType?: string; datasetSize?: number; featureCount?: number; suggestions?: Record<string, unknown>; notes?: string[] }

// No seeded predictions/dataset — every input starts empty.
export function MlActionPanel() {
  const [predsRaw, setPredsRaw] = useState('');
  const [actsRaw, setActsRaw] = useState('');
  const [datasetText, setDatasetText] = useState('');
  const [modelType, setModelType] = useState<'neural-network' | 'random-forest' | 'xgboost' | 'linear'>('neural-network');
  const [taskType, setTaskType] = useState<'classification' | 'regression'>('classification');
  const [datasetSize, setDatasetSize] = useState('');
  const [featureCount, setFeatureCount] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [featResult, setFeatResult] = useState<FeatResult | null>(null);
  const [profileResult, setProfileResult] = useState<ProfileResult | null>(null);
  const [hyperResult, setHyperResult] = useState<HyperResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseDataset(): { dataset?: unknown[]; features?: unknown[]; target?: string } | null {
    try { return JSON.parse(datasetText); } catch { return null; }
  }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actEval() {
    if (!predsRaw.trim() || !actsRaw.trim()) { err('Predictions + actuals csv required.'); return; }
    const preds = predsRaw.split(',').map(s => s.trim()).filter(Boolean).map(s => /^[0-9.+-]+$/.test(s) ? Number(s) : s);
    const acts = actsRaw.split(',').map(s => s.trim()).filter(Boolean).map(s => /^[0-9.+-]+$/.test(s) ? Number(s) : s);
    if (preds.length === 0 || acts.length === 0) { err('Predictions + actuals required.'); return; }
    setBusy('eval'); setFeedback(null);
    try {
      const r = await callMacro<EvalResult>('modelEvaluate', { artifact: { data: { predictions: preds, actuals: acts } } });
      if (r.ok && r.result) { setEvalResult(r.result); pipe.publish('ml.eval', r.result, { label: r.result.type === 'classification' ? `Acc ${r.result.accuracy}%` : `R² ${r.result.r2}` }); ok(r.result.type === 'classification' ? `Acc ${r.result.accuracy}%.` : `R² ${r.result.r2}.`); } else err(r.error ?? 'eval failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFeat() {
    if (!datasetText.trim()) { err('Paste dataset JSON first.'); return; }
    const parsed = parseDataset(); if (!parsed) { err('Invalid dataset JSON.'); return; }
    setBusy('feat'); setFeedback(null);
    try {
      const r = await callMacro<FeatResult>('featureImportance', { artifact: { data: { features: parsed.dataset, target: parsed.target } } });
      if (r.ok && r.result) { setFeatResult(r.result); pipe.publish('ml.feat', r.result, { label: `Features: ${r.result.topFeatures?.[0]}` }); ok(`Top: ${r.result.topFeatures?.join(', ')}.`); } else err(r.error ?? 'feat failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProfile() {
    if (!datasetText.trim()) { err('Paste dataset JSON first.'); return; }
    const parsed = parseDataset(); if (!parsed) { err('Invalid dataset JSON.'); return; }
    setBusy('profile'); setFeedback(null);
    try {
      const r = await callMacro<ProfileResult>('datasetProfile', { artifact: { data: { dataset: parsed.dataset } } });
      if (r.ok && r.result) { setProfileResult(r.result); pipe.publish('ml.profile', r.result, { label: `EDA ${r.result.qualityScore}%` }); ok(`${r.result.rows} rows × ${r.result.columns} cols · quality ${r.result.qualityScore}%.`); } else err(r.error ?? 'profile failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actHyper() {
    const N = parseInt(datasetSize, 10), F = parseInt(featureCount, 10);
    if (!Number.isFinite(N) || !Number.isFinite(F)) { err('Dataset size + feature count required.'); return; }
    setBusy('hyper'); setFeedback(null);
    try {
      const r = await callMacro<HyperResult>('hyperparameterSuggest', { artifact: { data: { model: modelType, task: taskType, datasetSize: N, features: F } } });
      if (r.ok && r.result) { setHyperResult(r.result); pipe.publish('ml.hyper', r.result, { label: `Hyper: ${r.result.modelType}` }); ok(`Suggested for ${modelType}.`); } else err(r.error ?? 'hyper failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `ML — ${modelType} ${taskType}`, tags: ['ml', modelType, taskType], source: 'ml:bench:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ml: { eval: evalResult, feat: featResult, profile: profileResult, hyper: hyperResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('ml.mintedDtuId', id, { label: `ML DTU ${id.slice(0, 8)}…` }); ok(`ML DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🤖 ML bench`, '',
      evalResult ? (evalResult.type === 'classification' ? `Acc ${evalResult.accuracy}% · F1 ${evalResult.avgF1} · ${evalResult.samples}n` : `R² ${evalResult.r2} · RMSE ${evalResult.rmse} · ${evalResult.samples}n`) : '',
      featResult ? `Top features: ${featResult.topFeatures?.join(', ')}` : '',
      profileResult ? `Dataset quality: ${profileResult.qualityScore}% (${profileResult.rows}×${profileResult.columns})` : '',
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
    if (!evalResult && !profileResult) { err('Run eval/profile first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Model card — ${modelType} ${taskType}`, tags: ['ml', 'modelcard', 'public'], source: 'ml:modelcard:publish', meta: { visibility: 'public', consent: { allowCitations: true }, modelType, taskType, eval: evalResult, profile: profileResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('ml.publishedDtuId', id, { label: `Public model card ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `ML bench review. ${evalResult ? (evalResult.type === 'classification' ? `Classifier accuracy ${evalResult.accuracy}%, F1 ${evalResult.avgF1}.` : `Regressor R² ${evalResult.r2}, RMSE ${evalResult.rmse}.`) : ''} ${featResult ? `Top features: ${featResult.topFeatures?.join(', ')}.` : ''} ${profileResult ? `Data quality ${profileResult.qualityScore}%.` : ''} ${hyperResult ? `Model: ${hyperResult.modelType}.` : ''} Identify the single biggest leverage for performance improvement. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Leverage ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'eval' as ActionId, label: 'Evaluate', desc: 'modelEvaluate', icon: Target, accent: '#22c55e', handler: actEval },
    { id: 'feat' as ActionId, label: 'Features', desc: 'featureImportance', icon: BarChart3, accent: '#06b6d4', handler: actFeat },
    { id: 'profile' as ActionId, label: 'Profile', desc: 'datasetProfile EDA', icon: Brain, accent: '#a855f7', handler: actProfile },
    { id: 'hyper' as ActionId, label: 'Hyper', desc: 'hyperparameterSuggest', icon: Sliders, accent: '#f59e0b', handler: actHyper },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private ML run DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send model brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public model card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Lever', desc: 'Agent: top leverage', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-fuchsia-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-fuchsia-500/10 pb-2">
        <Brain className="h-4 w-4 text-fuchsia-400" />
        <h3 className="text-sm font-semibold text-white">ML bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">evaluate · features · profile · tune</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Predictions (csv)</label>
          <textarea value={predsRaw} onChange={(e) => setPredsRaw(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
          <label className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Actuals (csv)</label>
          <textarea value={actsRaw} onChange={(e) => setActsRaw(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
        </div>
        <div className="space-y-2 md:col-span-1">
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Dataset JSON ({'{ dataset, target }'})</label>
          <textarea value={datasetText} onChange={(e) => setDatasetText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Hyperparameter context</label>
          <select value={modelType} onChange={(e) => setModelType(e.target.value as typeof modelType)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
            <option value="neural-network">Neural network</option>
            <option value="random-forest">Random forest</option>
            <option value="xgboost">XGBoost</option>
            <option value="linear">Linear / logistic</option>
          </select>
          <select value={taskType} onChange={(e) => setTaskType(e.target.value as typeof taskType)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white">
            <option value="classification">Classification</option>
            <option value="regression">Regression</option>
          </select>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={datasetSize} onChange={(e) => setDatasetSize(e.target.value.replace(/\D/g, '') || '0')} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="rows" />
            <input type="text" value={featureCount} onChange={(e) => setFeatureCount(e.target.value.replace(/\D/g, '') || '0')} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="features" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {evalResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">{evalResult.type ?? '-'} · n={evalResult.samples}</div>
            {evalResult.type === 'classification' ? (
              <>
                <div className="text-2xl font-bold text-emerald-300">{evalResult.accuracy}%</div>
                <div className="text-[10px] text-zinc-500">avg F1 {evalResult.avgF1}</div>
                {(evalResult.perClass ?? []).slice(0, 3).map((p, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">{String(p.class)}: P {p.precision} R {p.recall} F1 {p.f1} (n={p.support})</div>)}
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-emerald-300">R² {evalResult.r2}</div>
                <div className="text-[10px] text-zinc-500">MSE {evalResult.mse} · RMSE {evalResult.rmse} · MAE {evalResult.mae}</div>
              </>
            )}
          </div>
        )}
        {featResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Feature importance</div>
            {(featResult.rankings ?? []).slice(0, 6).map((r, i) => <div key={i} className="text-[11px] text-zinc-300 flex items-center gap-2 mt-0.5"><span className="font-mono w-16 truncate">{r.feature}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-cyan-400" style={{ width: `${r.importance}%` }} /></div><span className="font-mono text-cyan-200 text-[10px]">{r.importance}</span></div>)}
          </div>
        )}
        {profileResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">EDA · quality {profileResult.qualityScore}%</div>
            <div className="text-[10px] text-zinc-500">{profileResult.rows} × {profileResult.columns}</div>
            {(profileResult.profile ?? []).slice(0, 6).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><span className="font-mono text-purple-200">{p.field}</span> <span className="text-zinc-500">[{p.type}]</span> null {p.nullRate}% · k={p.cardinality}{p.stats && <span className="text-zinc-500"> · μ={p.stats.mean}</span>}</div>)}
          </div>
        )}
        {hyperResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Hyperparams · {hyperResult.modelType}</div>
            {Object.entries(hyperResult.suggestions ?? {}).slice(0, 6).map(([k, v]) => <div key={k} className="text-[10px] text-zinc-300 mt-0.5"><span className="font-mono text-amber-200">{k}</span> = <span className="font-mono text-zinc-100">{typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v)}</span></div>)}
            {(hyperResult.notes ?? []).map((n, i) => <div key={i} className="text-[10px] text-amber-300/70 italic mt-0.5">{n}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Top leverage</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
