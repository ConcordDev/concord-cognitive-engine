'use client';

/**
 * RoboticsActionPanel — manipulator + autonomy workbench.
 * kinematicsCalc / pathPlan / sensorFusion / batteryLife +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Bot, GitBranch, Cpu, BatteryFull, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('robotics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'kin' | 'path' | 'fuse' | 'bat' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface KinJoint { joint: number; type: string; angle: number; length: number; range: [number, number] }
interface KinResult { degreesOfFreedom: number; joints: KinJoint[]; maxReach: string; workspace: string; type: string }
interface PathSegment { from: number; to: number; distance: number }
interface PathResult { waypoints: number; segments: PathSegment[]; totalDistance: number; estimatedTime: string; collisionCheck?: string }
interface FuseReading { sensor: string; value: number; confidence: number; weight: number }
interface FuseResult { sensorCount: number; fusedValue: number; fusedConfidence: number; method: string; sensors: FuseReading[] }
interface BatResult { batteryCapacity: string; totalPowerDraw: string; breakdown: Record<string, string>; estimatedRuntime: string; safeRuntime: string; recommendation: string }

// No seeded data — every input starts empty.
export function RoboticsActionPanel() {
  const [jointsText, setJointsText] = useState('');
  const [waypointsText, setWaypointsText] = useState('');
  const [sensorsText, setSensorsText] = useState('');
  const [batteryWh, setBatteryWh] = useState('');
  const [motorW, setMotorW] = useState('');
  const [sensorW, setSensorW] = useState('');
  const [computeW, setComputeW] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [kinResult, setKinResult] = useState<KinResult | null>(null);
  const [pathResult, setPathResult] = useState<PathResult | null>(null);
  const [fuseResult, setFuseResult] = useState<FuseResult | null>(null);
  const [batResult, setBatResult] = useState<BatResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actKin() {
    if (!jointsText.trim()) { err('Paste joints JSON first.'); return; }
    const joints = parseJSON<unknown[]>(jointsText); if (!joints) { err('Invalid joints JSON.'); return; }
    setBusy('kin'); setFeedback(null);
    try {
      const r = await callMacro<KinResult>('kinematicsCalc', { artifact: { data: { joints } } });
      if (r.ok && r.result) { setKinResult(r.result); pipe.publish('robotics.kin', r.result, { label: `${r.result.degreesOfFreedom}-DOF` }); ok(`${r.result.degreesOfFreedom}-DOF · ${r.result.maxReach}.`); } else err(r.error ?? 'kin failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPath() {
    if (!waypointsText.trim()) { err('Paste waypoints JSON first.'); return; }
    const waypoints = parseJSON<unknown[]>(waypointsText); if (!waypoints) { err('Invalid waypoints JSON.'); return; }
    setBusy('path'); setFeedback(null);
    try {
      const r = await callMacro<PathResult>('pathPlan', { artifact: { data: { waypoints } } });
      if (r.ok && r.result) { setPathResult(r.result); pipe.publish('robotics.path', r.result, { label: `Path ${r.result.totalDistance}mm` }); ok(`${r.result.totalDistance} mm path.`); } else err(r.error ?? 'path failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFuse() {
    if (!sensorsText.trim()) { err('Paste sensors JSON first.'); return; }
    const sensors = parseJSON<unknown[]>(sensorsText); if (!sensors) { err('Invalid sensors JSON.'); return; }
    setBusy('fuse'); setFeedback(null);
    try {
      const r = await callMacro<FuseResult>('sensorFusion', { artifact: { data: { sensors } } });
      if (r.ok && r.result) { setFuseResult(r.result); pipe.publish('robotics.fuse', r.result, { label: `Fused ${r.result.fusedValue}` }); ok(`Fused: ${r.result.fusedValue} · ${r.result.fusedConfidence}%.`); } else err(r.error ?? 'fuse failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBat() {
    const b = parseFloat(batteryWh), m = parseFloat(motorW), s = parseFloat(sensorW), c = parseFloat(computeW);
    if (![b, m, s, c].every(Number.isFinite)) { err('Battery + motor + sensor + compute Wh all required.'); return; }
    setBusy('bat'); setFeedback(null);
    try {
      const r = await callMacro<BatResult>('batteryLife', { artifact: { data: { batteryCapacityWh: b, motorDrawW: m, sensorDrawW: s, computeDrawW: c } } });
      if (r.ok && r.result) { setBatResult(r.result); pipe.publish('robotics.bat', r.result, { label: `Bat ${r.result.estimatedRuntime}` }); ok(r.result.estimatedRuntime); } else err(r.error ?? 'bat failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Robot — ${kinResult?.workspace ?? 'spec'}`, tags: ['robotics', 'spec', kinResult?.type].filter((t): t is string => !!t), source: 'robotics:spec:mint', meta: { visibility: 'private', consent: { allowCitations: false }, robotics: { kin: kinResult, path: pathResult, fuse: fuseResult, bat: batResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('robotics.mintedDtuId', id, { label: `Robot DTU ${id.slice(0, 8)}…` }); ok(`Robot DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🤖 Robotics bench`, '',
      kinResult ? `${kinResult.degreesOfFreedom}-DOF ${kinResult.type} · reach ${kinResult.maxReach}` : '',
      pathResult ? `Path: ${pathResult.totalDistance} mm over ${pathResult.waypoints} waypoints · ${pathResult.estimatedTime}` : '',
      fuseResult ? `Sensor fusion: ${fuseResult.fusedValue} (${fuseResult.fusedConfidence}% conf, ${fuseResult.sensorCount} sensors)` : '',
      batResult ? `Battery: ${batResult.estimatedRuntime} (safe ${batResult.safeRuntime})` : '',
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
    if (!kinResult) { err('Run kinematics first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Robot spec — ${kinResult.degreesOfFreedom}-DOF`, tags: ['robotics', 'spec', 'public'], source: 'robotics:spec:publish', meta: { visibility: 'public', consent: { allowCitations: true }, kin: kinResult, bat: batResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('robotics.publishedDtuId', id, { label: `Public robot spec ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Robot spec review. ${kinResult ? `${kinResult.degreesOfFreedom}-DOF ${kinResult.type}, reach ${kinResult.maxReach}.` : ''} ${pathResult ? `Planned path: ${pathResult.totalDistance} mm over ${pathResult.waypoints} waypoints, est ${pathResult.estimatedTime}.` : ''} ${fuseResult ? `Sensor fusion across ${fuseResult.sensorCount} sources at ${fuseResult.fusedConfidence}% confidence.` : ''} ${batResult ? `Power: ${batResult.totalPowerDraw} → ${batResult.estimatedRuntime}. ${batResult.recommendation}.` : ''} Identify the most likely deployment context + one structural risk. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'kin' as ActionId, label: 'Kinematics', desc: 'DOF + workspace', icon: Bot, accent: '#3b82f6', handler: actKin },
    { id: 'path' as ActionId, label: 'Path plan', desc: 'multi-waypoint length', icon: GitBranch, accent: '#a855f7', handler: actPath },
    { id: 'fuse' as ActionId, label: 'Sensor fusion', desc: 'weighted-avg estimator', icon: Cpu, accent: '#06b6d4', handler: actFuse },
    { id: 'bat' as ActionId, label: 'Battery', desc: 'runtime + safe budget', icon: BatteryFull, accent: '#22c55e', handler: actBat },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private robot DTU', icon: Sparkles, accent: '#f97316', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send spec brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public robot spec', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Review', desc: 'Agent: deployment + risk', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <Bot className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Robotics bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">kinematics · path · fusion · battery</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Joints (JSON)</label>
          <textarea value={jointsText} onChange={(e) => setJointsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Waypoints (JSON)</label>
          <textarea value={waypointsText} onChange={(e) => setWaypointsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Sensors (JSON)</label>
          <textarea value={sensorsText} onChange={(e) => setSensorsText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-5 gap-1.5">
          <input type="text" value={batteryWh} onChange={(e) => setBatteryWh(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Battery Wh" />
          <input type="text" value={motorW} onChange={(e) => setMotorW(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Motor W" />
          <input type="text" value={sensorW} onChange={(e) => setSensorW(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Sensor W" />
          <input type="text" value={computeW} onChange={(e) => setComputeW(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Compute W" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="DM recipient" />
        </div>
        <div className="md:col-span-3 flex items-center gap-2 flex-wrap">
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
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
        {kinResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{kinResult.type}</div>
            <div className="text-2xl font-bold text-blue-300">{kinResult.degreesOfFreedom}-DOF</div>
            <div className="text-[10px] text-zinc-400">reach {kinResult.maxReach} · {kinResult.workspace}</div>
            {kinResult.joints.slice(0, 3).map(j => <div key={j.joint} className="text-[10px] text-blue-200 mt-0.5">J{j.joint} {j.type} {j.angle}° / {j.length}mm</div>)}
          </div>
        )}
        {pathResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Path · {pathResult.waypoints} wp</div>
            <div className="text-2xl font-bold text-purple-300">{pathResult.totalDistance} <span className="text-xs text-zinc-400">mm</span></div>
            <div className="text-[10px] text-zinc-400">{pathResult.estimatedTime}</div>
            <div className="text-[10px] text-purple-200 italic mt-0.5">{pathResult.collisionCheck}</div>
          </div>
        )}
        {fuseResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Fusion · {fuseResult.sensorCount} sensors</div>
            <div className="text-2xl font-bold text-cyan-300">{fuseResult.fusedValue}</div>
            <div className="text-[10px] text-zinc-400">{fuseResult.fusedConfidence}% confidence · {fuseResult.method}</div>
            {fuseResult.sensors.slice(0, 3).map(s => <div key={s.sensor} className="text-[10px] text-cyan-200 mt-0.5">{s.sensor}: {s.value} (c={s.confidence})</div>)}
          </div>
        )}
        {batResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Battery · {batResult.batteryCapacity}</div>
            <div className="text-2xl font-bold text-green-300">{batResult.estimatedRuntime}</div>
            <div className="text-[10px] text-zinc-400">safe {batResult.safeRuntime}</div>
            <div className="text-[10px] text-zinc-400">draw {batResult.totalPowerDraw}</div>
            <div className="text-[10px] text-green-200 italic mt-0.5">{batResult.recommendation}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Deployment review</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
