'use client';

/**
 * PhysicsActionPanel — physicist's reference bench.
 * kinematics-1d / projectile / convert-units / constants +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Rocket, Crosshair, Ruler, Atom, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('physics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'kin' | 'proj' | 'unit' | 'const' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface KinResult { solved: { v0?: number; v?: number; a?: number; t?: number; x?: number }; equations: string[]; units?: Record<string, string> }
interface ProjResult { timeOfFlight_s: number; range_m: number; maxHeight_m: number; timeToApex_s: number; impactSpeed_mps: number; v0x_mps: number; v0y_mps: number; inputs: Record<string, number> }
interface UnitResult { value: number; from: string; to: string; kind: string; result: number }
interface ConstantsResult { constants: Record<string, { value: number; units: string; name: string }> }

const UNIT_KINDS: Record<string, string[]> = {
  length: ['m', 'km', 'cm', 'mm', 'mi', 'yd', 'ft', 'in'],
  mass: ['kg', 'g', 'mg', 'lb', 'oz', 'ton'],
  time: ['s', 'ms', 'min', 'h', 'day'],
  velocity: ['mps', 'kmh', 'mph', 'fps', 'knot'],
  energy: ['J', 'kJ', 'cal', 'kcal', 'eV', 'kWh', 'BTU'],
  force: ['N', 'kN', 'lbf', 'dyne'],
  pressure: ['Pa', 'kPa', 'atm', 'bar', 'psi', 'mmHg'],
  temperature: ['K', 'C', 'F'],
};

export function PhysicsActionPanel() {
  const [v0, setV0] = useState('20');
  const [v, setV] = useState('');
  const [a, setA] = useState('-9.81');
  const [t, setT] = useState('2');
  const [x, setX] = useState('');
  const [projV0, setProjV0] = useState('30');
  const [projAngle, setProjAngle] = useState('45');
  const [projH0, setProjH0] = useState('0');
  const [unitKind, setUnitKind] = useState<keyof typeof UNIT_KINDS>('length');
  const [unitValue, setUnitValue] = useState('100');
  const [unitFrom, setUnitFrom] = useState('m');
  const [unitTo, setUnitTo] = useState('ft');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [kinResult, setKinResult] = useState<KinResult | null>(null);
  const [projResult, setProjResult] = useState<ProjResult | null>(null);
  const [unitResult, setUnitResult] = useState<UnitResult | null>(null);
  const [constantsResult, setConstantsResult] = useState<ConstantsResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actKin() {
    setBusy('kin'); setFeedback(null);
    const input: Record<string, number> = {};
    if (v0) input.v0 = parseFloat(v0);
    if (v) input.v = parseFloat(v);
    if (a) input.a = parseFloat(a);
    if (t) input.t = parseFloat(t);
    if (x) input.x = parseFloat(x);
    try { const r = await callMacro<KinResult>('kinematics-1d', input); if (r.ok && r.result) { setKinResult(r.result); ok(`Kinematics solved.`); } else err(r.error ?? 'kin failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProj() {
    setBusy('proj'); setFeedback(null);
    try { const r = await callMacro<ProjResult>('projectile', { v0: parseFloat(projV0), angleDeg: parseFloat(projAngle), h0: parseFloat(projH0 || '0'), g: 9.81 }); if (r.ok && r.result) { setProjResult(r.result); ok(`Range ${r.result.range_m} m.`); } else err(r.error ?? 'proj failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actUnit() {
    setBusy('unit'); setFeedback(null);
    try { const r = await callMacro<UnitResult>('convert-units', { value: parseFloat(unitValue), from: unitFrom, to: unitTo, kind: unitKind }); if (r.ok && r.result) { setUnitResult(r.result); ok(`${r.result.value} ${r.result.from} = ${r.result.result} ${r.result.to}.`); } else err(r.error ?? 'unit failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConst() {
    setBusy('const'); setFeedback(null);
    try { const r = await callMacro<ConstantsResult>('constants', {}); if (r.ok && r.result) { setConstantsResult(r.result); ok(`${Object.keys(r.result.constants).length} constants loaded.`); } else err(r.error ?? 'constants failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Physics — ${kinResult ? 'kinematics' : projResult ? 'projectile' : 'calc'}`, tags: ['physics', 'mechanics'], source: 'physics:calc:mint', meta: { visibility: 'private', consent: { allowCitations: false }, physics: { kin: kinResult, proj: projResult, unit: unitResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Calc DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⚛ Physics bench`, '', kinResult ? `Kinematics → v=${kinResult.solved.v ?? '-'} m/s, x=${kinResult.solved.x ?? '-'} m, t=${kinResult.solved.t ?? '-'} s` : '', projResult ? `Projectile → range ${projResult.range_m} m, apex ${projResult.maxHeight_m} m, ToF ${projResult.timeOfFlight_s} s` : '', unitResult ? `${unitResult.value} ${unitResult.from} = ${unitResult.result} ${unitResult.to}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!projResult && !kinResult) { err('Solve a scenario first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Mechanics problem`, tags: ['physics', 'mechanics', 'public'], source: 'physics:problem:publish', meta: { visibility: 'public', consent: { allowCitations: true }, kin: kinResult, proj: projResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Physics bench. ${kinResult ? `Kinematics: v=${kinResult.solved.v ?? '-'}, x=${kinResult.solved.x ?? '-'}, t=${kinResult.solved.t ?? '-'}, a=${kinResult.solved.a ?? '-'}.` : ''} ${projResult ? `Projectile: range ${projResult.range_m} m, apex ${projResult.maxHeight_m} m, ToF ${projResult.timeOfFlight_s} s.` : ''} Identify the real-world scenario this best matches + one extension that would make the problem more interesting. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Scenario ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'kin' as ActionId, label: 'Kinematics', desc: '1D from any 3 of 5', icon: Ruler, accent: '#3b82f6', handler: actKin },
    { id: 'proj' as ActionId, label: 'Projectile', desc: 'range/apex/ToF', icon: Crosshair, accent: '#f97316', handler: actProj },
    { id: 'unit' as ActionId, label: 'Convert', desc: `${unitKind} units`, icon: Rocket, accent: '#06b6d4', handler: actUnit },
    { id: 'const' as ActionId, label: 'Constants', desc: 'c, G, h, kB...', icon: Atom, accent: '#8b5cf6', handler: actConst },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private calc DTU', icon: Sparkles, accent: '#22c55e', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send results', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public problem', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Scenario', desc: 'Agent: real-world tie', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  function setUnitKindAndReset(k: keyof typeof UNIT_KINDS) {
    setUnitKind(k);
    const list = UNIT_KINDS[k];
    setUnitFrom(list[0]); setUnitTo(list[1] ?? list[0]);
  }

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <Atom className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Physics bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">kinematics · projectile · units · constants</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Kinematics 1D</div>
          <input type="text" value={v0} onChange={(e) => setV0(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="v₀ m/s" />
          <input type="text" value={v} onChange={(e) => setV(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="v m/s" />
          <input type="text" value={a} onChange={(e) => setA(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="a m/s²" />
          <input type="text" value={t} onChange={(e) => setT(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="t s" />
          <input type="text" value={x} onChange={(e) => setX(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="x m" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">Projectile</div>
          <input type="text" value={projV0} onChange={(e) => setProjV0(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="v₀ m/s" />
          <input type="text" value={projAngle} onChange={(e) => setProjAngle(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="angle deg (0-90)" />
          <input type="text" value={projH0} onChange={(e) => setProjH0(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="h₀ m" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Convert</div>
          <select value={unitKind} onChange={(e) => setUnitKindAndReset(e.target.value as keyof typeof UNIT_KINDS)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white">
            {Object.keys(UNIT_KINDS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input type="text" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="value" />
          <div className="grid grid-cols-2 gap-1">
            <select value={unitFrom} onChange={(e) => setUnitFrom(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
              {UNIT_KINDS[unitKind].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={unitTo} onChange={(e) => setUnitTo(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
              {UNIT_KINDS[unitKind].map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">DM</div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="recipient" />
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
        {kinResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Kinematics 1D</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1">
              {(['v0', 'v', 'a', 't', 'x'] as const).map(k => <div key={k} className="text-[11px] text-zinc-300">{k} <span className="text-blue-200 font-mono">{kinResult.solved[k] ?? '-'}</span></div>)}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 font-mono">v = v₀ + at</div>
          </div>
        )}
        {projResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Projectile</div>
            <div className="text-2xl font-bold text-orange-300">{projResult.range_m} <span className="text-xs text-zinc-400">m range</span></div>
            <div className="text-[10px] text-zinc-500">apex {projResult.maxHeight_m} m · ToF {projResult.timeOfFlight_s} s</div>
            <div className="text-[10px] text-zinc-500">impact {projResult.impactSpeed_mps} m/s</div>
          </div>
        )}
        {unitResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Convert · {unitResult.kind}</div>
            <div className="text-sm text-zinc-200 mt-1">{unitResult.value} {unitResult.from}</div>
            <div className="text-2xl font-bold text-cyan-300">{unitResult.result} <span className="text-xs text-zinc-400">{unitResult.to}</span></div>
          </div>
        )}
        {constantsResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Constants ({Object.keys(constantsResult.constants).length})</div>
            {Object.entries(constantsResult.constants).slice(0, 8).map(([k, c]) => <div key={k} className="text-[10px] text-zinc-300 mt-0.5"><span className="text-purple-200 font-mono">{k}</span> = {c.value.toExponential(3)} <span className="text-zinc-500">{c.units}</span></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Real-world scenario</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
