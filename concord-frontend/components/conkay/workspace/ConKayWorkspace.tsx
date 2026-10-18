'use client';

/**
 * ConKayWorkspace — /lenses/conkay. ConKay's full engineering workspace:
 * left, the workspace rail (projects, models, simulations, data vault,
 * library, workspaces); centre, the 3-D study viewport with its parameters
 * and result cards; right, the ConKay conversation; bottom, voice + text.
 *
 * Two paths answer a message. A study edit or action ("t_w = 8 mm and re-run",
 * "cantilever, 50 kN", "keep as DTU") is parsed deterministically and run
 * against engineering.beamStudy — the reply is composed from the solver's
 * numbers. Anything else goes to the ConKay agent (/api/chat-agent/stream)
 * with the study as context; if the agent re-solves the study through its
 * tools, the workspace reloads the stored result.
 */

import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes, ChevronDown, ChevronUp, Eye, EyeOff, Loader2, MessageSquare, PanelLeft, Save, SlidersHorizontal,
} from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { detectNewDesign, type NewDesignIntent } from '@/lib/conkay/new-design-intent';
import { DesignPane, StartScreen, type BriefClaim, type TrussAnswer, type WorkspaceDesign } from './DesignPane';
import { CONKAY_PERSONA_PROMPT } from '@/components/conkay/conkay-persona';
import { agentFailure, artifactKey, streamConKayAgent, stripToolCallLeak } from '@/lib/conkay/agent-stream';
import { ChatArtifacts, type ChatArtifact } from '@/components/chat/ChatArtifacts';
import MessageRenderer from '@/components/chat/MessageRenderer';
import { ConKayMessage } from '@/components/conkay/ConKayViz';
import {
  DIM_LABELS,
  applyWorkspaceCommand,
  describeStudy,
  formatWorkspaceLead,
  parseWorkspaceCommand,
  studyContext,
  type BeamDims,
  type BeamStudyResult,
} from '@/lib/conkay/workspace-commands';
import { useConKayWorkspace, type StudyInputs, type SweepResult } from './useConKayWorkspace';
import { WorkspaceNav, type NavSection, type WorkspaceSummary } from './WorkspaceNav';
import { StudyCards } from './StudyCards';
import { ParameterPanel, type ParameterPanelHandle } from './ParameterPanel';
import { VoiceComposer } from './VoiceComposer';
import { DISPLAY_LABELS, VIEW_LABELS, utilizationColor, type DisplayMode, type ViewPreset } from '@/lib/conkay/beam-view';

const BeamViewport = dynamic(() => import('./BeamViewport'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-400">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading viewport…
    </div>
  ),
});

type ChipKind = 'review' | 'sweep' | 'edit-tw' | 'apply' | 'defaults';
interface Chip { kind: ChipKind; label: string; dims?: Partial<BeamDims>; brief?: string }
interface WsMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  pending?: boolean;
  error?: boolean;
  chips?: Chip[];
  tools?: Array<{ name: string; ok: boolean }>;
  sweep?: SweepResult;
  /** Songs, images, audio previews and 3D models the agent's tools returned. */
  artifacts?: ChatArtifact[];
}

const STUDY_CHIPS: Chip[] = [
  { kind: 'review', label: 'Review stress' },
  { kind: 'sweep', label: 'Parameter sweep' },
  { kind: 'edit-tw', label: 'Edit t_w' },
];

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function SweepTable({ sweep }: { sweep: SweepResult }) {
  const label = sweep.param === 'loadN' ? 'P (kN)' : `${DIM_LABELS[sweep.param as keyof BeamDims]?.symbol ?? sweep.param} (mm)`;
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left font-mono text-[11px]">
        <thead className="bg-white/5 text-slate-400">
          <tr><th className="px-2 py-1">{label}</th><th className="px-2 py-1">σ MPa</th><th className="px-2 py-1">δ mm</th><th className="px-2 py-1">util.</th><th className="px-2 py-1" /></tr>
        </thead>
        <tbody>
          {sweep.rows.map((r) => (
            <tr key={r.value} className={r.value === sweep.lightestPassing ? 'bg-emerald-400/10' : ''}>
              <td className="px-2 py-1 text-slate-200">{sweep.param === 'loadN' ? r.value / 1000 : r.value}</td>
              {r.ok ? (
                <>
                  <td className="px-2 py-1 text-slate-200">{r.maxStressMPa!.toFixed(1)}</td>
                  <td className="px-2 py-1 text-slate-200">{r.maxDeflectionMm!.toFixed(3)}</td>
                  <td className="px-2 py-1" style={{ color: utilizationColor(r.utilization!) }}>{(r.utilization! * 100).toFixed(1)}%</td>
                  <td className={`px-2 py-1 ${r.pass ? 'text-emerald-300' : 'text-rose-300'}`}>{r.pass ? 'pass' : 'fail'}</td>
                </>
              ) : (
                <td colSpan={4} className="px-2 py-1 text-rose-300">{r.error}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConKayWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspaceId = params.get('ws');
  const ws = useConKayWorkspace(workspaceId);
  const { inputs, setInputs, result, materials, status } = ws;

  const [section, setSection] = useState<NavSection | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesError, setWorkspacesError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [busy, setBusy] = useState(false);
  /** A new design opened from the box (showcase or solved brief); null = the I-beam study. */
  const [design, setDesign] = useState<WorkspaceDesign | null>(null);
  /** A brief the workbench answered with questions: the next message adds to it. */
  const pendingBrief = useRef<string | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [view, setView] = useState<ViewPreset>('isometric');
  const [display, setDisplay] = useState<DisplayMode>('wire-stress');
  const [showDims, setShowDims] = useState(true);
  // Open on wide screens; on a phone the card would cover the viewport.
  const [paramsOpen, setParamsOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches);
  const [mobileTab, setMobileTab] = useState<'model' | 'chat' | 'browse'>('model');
  const [speak, setSpeak] = useState<{ id: string; text: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const saveTouched = useRef(false);
  const paramRef = useRef<ParameterPanelHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<WsMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Conversation per workspace, kept server-side (engineering.workspaceLog-*)
  // so it follows the user to any device. Append-only: a message is sent
  // once, after it is final; nothing here can overwrite the stored log.
  const persisted = useRef<Set<string>>(new Set());
  const [logLoaded, setLogLoaded] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void lensRun<{ messages: WsMessage[] }>('engineering', 'workspaceLog-get', workspaceId ? { workspaceId } : {}).then((r) => {
      if (!live) return;
      const log = Array.isArray(r.data?.result?.messages) ? r.data.result.messages : [];
      persisted.current = new Set(log.map((m) => m.id));
      setMessages(log);
      setLogLoaded(workspaceId);
    });
    return () => { live = false; };
  }, [workspaceId]);
  useEffect(() => {
    if (logLoaded !== workspaceId) return;
    const fresh = messages.filter((m) => !m.pending && !persisted.current.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) persisted.current.add(m.id);
    void lensRun('engineering', 'workspaceLog-append', {
      messages: fresh.map(({ pending: _p, artifacts, ...m }) => {
        const light = (artifacts ?? []).filter((a) => typeof a.url === 'string' && a.url && !a.song && !a.positions);
        return light.length ? { ...m, artifacts: light } : m;
      }),
      ...(workspaceId ? { workspaceId } : {}),
    }).then((r) => {
      // Not stored: let the next change retry these.
      if (r.data?.ok === false) for (const m of fresh) persisted.current.delete(m.id);
    });
  }, [logLoaded, messages, workspaceId]);

  const clearConversation = useCallback(async () => {
    const r = await lensRun('engineering', 'workspaceLog-clear', workspaceId ? { workspaceId } : {});
    if (r.data?.ok === false) return;
    persisted.current = new Set();
    setMessages([]);
  }, [workspaceId]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const loadWorkspaces = useCallback(async () => {
    const r = await lensRun<{ projects: Array<{ id: string; name: string }> }>('agent_projects', 'list', {});
    if (r.data?.ok === false) { setWorkspacesError(r.data.error || 'Could not load workspaces.'); return; }
    setWorkspacesError('');
    setWorkspaces((r.data?.result?.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
  }, []);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);

  const goWorkspace = useCallback((id: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (id) q.set('ws', id); else q.delete('ws');
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
    setMobileTab('model');
  }, [params, pathname, router]);

  const createWorkspace = useCallback(async (name: string) => {
    const r = await lensRun<{ project: { id: string; name: string } }>('agent_projects', 'create', { name });
    const p = r.data?.result?.project;
    if (r.data?.ok === false || !p?.id) return null;
    await loadWorkspaces();
    goWorkspace(p.id);
    return p.id;
  }, [goWorkspace, loadWorkspaces]);

  const push = useCallback((m: Omit<WsMessage, 'id' | 'at'> & { id?: string }) => {
    const msg: WsMessage = { id: m.id || uid(), at: new Date().toISOString(), ...m };
    setMessages((prev) => [...prev, msg]);
    return msg.id;
  }, []);
  const patch = useCallback((id: string, p: Partial<WsMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...p } : m)));
  }, []);
  const reply = useCallback((id: string, text: string, extra: Partial<WsMessage> = {}) => {
    patch(id, { text, pending: false, ...extra });
    setSpeak({ id, text });
  }, [patch]);

  const runStudy = useCallback(async (next: StudyInputs, lead: string) => {
    const before = result;
    const id = push({ role: 'assistant', text: `${lead}Running FEA…`, pending: true });
    const out = await ws.solve(next);
    if ('error' in out) { reply(id, `${lead}The solve did not run: ${out.error}`, { error: true }); return null; }
    reply(id, `${lead}${describeStudy(out.result, before)}`, { chips: STUDY_CHIPS });
    setRefreshKey((k) => k + 1);
    return out.result;
  }, [push, reply, result, ws]);

  const persistModel = useCallback(async (name?: string) => {
    const id = push({ role: 'assistant', text: 'Saving model…', pending: true });
    const out = await ws.saveModel(name);
    if ('error' in out) reply(id, `Not saved. ${out.error}`, { error: true });
    else {
      reply(id, `Saved “${out.name}” to Models (${out.id}).`);
      setInputs((s) => (s.name === out.name ? s : { ...s, name: out.name }));
      setRefreshKey((k) => k + 1);
    }
    return out;
  }, [push, reply, setInputs, ws]);

  const openSave = useCallback(async () => {
    saveTouched.current = false;
    setSaveOpen(true);
    setSaveName(inputs.name);
    const suggestion = await ws.suggestName();
    if (!saveTouched.current) setSaveName(suggestion);
  }, [inputs.name, ws]);

  const keep = useCallback(async (msgId?: string) => {
    setKeeping(true);
    const id = msgId ?? push({ role: 'assistant', text: 'Keeping this study as a private DTU…', pending: true });
    const out = await ws.keepAsDtu();
    setKeeping(false);
    if ('error' in out) reply(id, `Not kept. ${out.error}`, { error: true });
    else { reply(id, `Kept as private DTU ${out.dtuId} and read back. It records this solve's inputs, results and hand check. Nothing was published.`); setRefreshKey((k) => k + 1); }
  }, [push, reply, ws]);

  const askAgent = useCallback(async (text: string) => {
    const id = push({ role: 'assistant', text: '', pending: true, tools: [] });
    const mat = materials.find((m) => m.id === inputs.materialId);
    const context = studyContext(
      { dims: inputs.dims, loadN: inputs.loadN, support: inputs.support, materialLabel: mat?.label || inputs.materialId },
      ws.stale ? null : result,
    );
    const wsLine = workspaceId ? `\nWhen calling engineering.beamStudy, include "workspaceId": "${workspaceId}".` : '';
    const persona = `${CONKAY_PERSONA_PROMPT}\n\n${context}${wsLine}`.slice(0, 4000);
    const history = messagesRef.current.filter((m) => !m.pending && m.text).slice(-12).map((m) => ({ role: m.role, content: m.text }));
    let live = '';
    const tools: Array<{ name: string; ok: boolean }> = [];
    const artifacts: ChatArtifact[] = [];
    const seenArtifacts = new Set<string>();
    const addArtifact = (a: unknown) => {
      if (!a || typeof a !== 'object') return;
      const rec = a as Record<string, unknown>;
      const k = artifactKey(rec);
      if (seenArtifacts.has(k)) return;
      seenArtifacts.add(k);
      artifacts.push(rec as ChatArtifact);
      patch(id, { artifacts: artifacts.slice() });
    };
    let resolved = false;
    try {
      const done = await streamConKayAgent({
        message: text,
        history,
        persona,
        onToken: (chunk) => { live += chunk; patch(id, { text: live }); },
        onToolCall: (c) => {
          const name = c.tool === 'run_lens_action' && c.domain ? `${c.domain}.${c.action}` : String(c.tool || 'tool');
          tools.push({ name, ok: c.ok !== false });
          if (c.domain === 'engineering' && c.action === 'beamStudy' && c.ok !== false) resolved = true;
          patch(id, { tools: tools.slice() });
          if (c.ok !== false) {
            addArtifact(c.artifact);
            for (const a of c.artifacts ?? []) addArtifact(a);
          }
        },
        onArtifact: addArtifact,
      });
      const clean = stripToolCallLeak(live);
      if (!done.ok && !clean.text) reply(id, agentFailure(done.error), { error: true, tools, artifacts });
      else if (clean.leaked && !clean.text) reply(id, 'ConKay tried to call a tool but the call didn’t run. Please ask again.', { error: true, tools, artifacts });
      else reply(id, clean.text || (artifacts.length ? 'Here it is below.' : 'Done.'), { tools, artifacts });
    } catch (e) {
      reply(id, agentFailure(e instanceof Error ? e.message : 'network error'), { error: true, tools });
    }
    if (resolved) { await ws.reload(); setRefreshKey((k) => k + 1); }
  }, [inputs, materials, patch, push, reply, result, workspaceId, ws]);

  // A new design from the box: a showcase result, or a brief for the workbench
  // (car -> the car pipeline and its workbench page; truss / bracket / part ->
  // the class-problem solvers, drawn here).
  const startDesign = useCallback(async (intent: NewDesignIntent, text: string) => {
    if (intent.kind === 'showcase') {
      setDesign({ kind: 'showcase', id: intent.id, label: intent.label });
      setMobileTab('model');
      reply(push({ role: 'assistant', text: '', pending: true }), `Opened the ${intent.label} showcase design. It is a precomputed result with its checks, values and sources; the full page is /conkay/designs/${intent.id}.`);
      return;
    }
    const id = push({ role: 'assistant', text: intent.domain === 'car' ? 'Designing the car (this runs the full car pipeline and can take a minute)…' : `Designing the ${intent.label}…`, pending: true });
    let data: Record<string, unknown> | null = null;
    try {
      data = (await api.post('/api/conkay/workbench', { prompt: text.slice(0, 4000) })).data as Record<string, unknown>;
    } catch (e) {
      const res = (e as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
      if (res?.status === 401) { reply(id, 'Sign in to design here. The showcase designs open without an account: say "show me the car".', { error: true }); return; }
      data = res?.data ?? null;
      if (!data) { reply(id, `The design did not run: ${e instanceof Error ? e.message : 'network error'}.`, { error: true }); return; }
    }
    const errs = Array.isArray(data?.errors) ? (data.errors as Array<{ error?: string }>).map((x) => x.error).filter(Boolean) : [];
    if (data?.ok === false) { reply(id, `The design did not run: ${errs.join('; ') || String(data?.error || 'no reason given')}.`, { error: true }); return; }
    if (data?.stage === 'questions') {
      pendingBrief.current = text;
      const qs = (data.questions as Array<{ question: string }> | undefined) ?? [];
      reply(id, `To design this ${String(data.domain || intent.label)} I need:\n${qs.map((q) => `• ${q.question}`).join('\n')}\nAnswer here and I will add it to the brief, or solve it now with stated defaults.`, {
        chips: [{ kind: 'defaults', label: 'Solve now with defaults', brief: text }],
      });
      return;
    }
    if (data?.stage === 'designed' && typeof data.id === 'string') {
      reply(id, 'Designed. Opening it in the workbench, where you can move its knobs, lock variables and ask follow-ups.');
      router.push(`/conkay/workbench/${data.id}`);
      return;
    }
    if (data?.stage === 'solved' && data.answer && typeof data.answer === 'object') {
      const claims = (Array.isArray(data.claims) ? data.claims : []) as BriefClaim[];
      setDesign({ kind: 'solved', domain: String(data.domain || intent.domain), prompt: text, answer: data.answer as Record<string, unknown>, claims });
      setMobileTab('model');
      const defaults = claims.filter((c) => c.status === 'default').map((c) => `${c.label} = ${c.display ?? c.value} (default: ${c.note || c.source})`);
      let summary = `Solved the ${String(data.domain)}.`;
      if (data.domain === 'truss') {
        const a = data.answer as unknown as TrussAnswer;
        const t = Math.max(0, ...a.forces.map((f) => f.N));
        const c = Math.min(0, ...a.forces.map((f) => f.N));
        summary = `Solved the truss: ${a.geometry.joints.length} joints, ${a.forces.length} bars. Max tension ${(t / 1000).toFixed(2)} kN, max compression ${(-c / 1000).toFixed(2)} kN${a.maxDisplacementM != null ? `, max displacement ${(a.maxDisplacementM * 1000).toFixed(2)} mm` : ''}. Member buckling and connections are not checked.`;
      }
      reply(id, defaults.length ? `${summary}\nAssumed: ${defaults.join('; ')}.` : summary);
      return;
    }
    reply(id, data?.stage === 'infeasible' ? 'No design met the brief within the search budget; see the workbench for what bound it.' : 'The design returned nothing to show.', { error: data?.stage !== 'infeasible' });
  }, [push, reply, router]);

  const send = useCallback(async (text: string) => {
    if (busy) return;
    setBusy(true);
    setMobileTab((t) => (t === 'browse' ? 'chat' : t));
    push({ role: 'user', text });
    try {
      const intent = detectNewDesign(text);
      if (intent) { pendingBrief.current = null; await startDesign(intent, text); return; }
      if ((design || pendingBrief.current) && /\b(?:fea|finite[- ]element|stress analysis)\b/i.test(text) && !/\b(?:i-?beam|t_w|t_f|flange|web)\b/i.test(text)) {
        // "run FEA on it" means the bracket/part just designed, not the I-beam study.
        pendingBrief.current = null;
        await askAgent(text);
        return;
      }
      if (pendingBrief.current && /^\s*(?:cancel|never ?mind|stop)\b/i.test(text)) {
        pendingBrief.current = null;
        reply(push({ role: 'assistant', text: '', pending: true }), 'Dropped that brief.');
        return;
      }
      if (pendingBrief.current && !/\b(?:run fea|save|keep|i-?beam|beam|t_w|t_f|flange|web)\b/i.test(text)) {
        // Answering the questions a brief came back with ("3 m tall, 6 panels").
        const brief = `${pendingBrief.current}. ${text}`;
        pendingBrief.current = null;
        await startDesign({ kind: 'workbench', domain: 'truss', label: 'design' }, brief);
        return;
      }
      const cmd = parseWorkspaceCommand(text, inputs.dims, materials, inputs.materialId);
      if (!cmd) { await askAgent(text); return; }
      setDesign(null);
      if (cmd.changes.length === 0 && !cmd.run && !cmd.save && !cmd.keep) {
        reply(push({ role: 'assistant', text: '', pending: true }), 'No change — the study already has those values. Say “run FEA” to solve it again.');
        return;
      }
      let solved: BeamStudyResult | null = null;
      if (cmd.changes.length > 0 || cmd.run) {
        const next = { ...inputs, ...applyWorkspaceCommand(cmd, inputs) };
        solved = await runStudy(next, formatWorkspaceLead(cmd));
        if (!solved && (cmd.save || cmd.keep)) return;
      }
      if (cmd.save) {
        const out = await persistModel();
        if (!('error' in out)) setSaveOpen(false);
      }
      if (cmd.keep) await keep();
    } finally {
      setBusy(false);
    }
  }, [askAgent, busy, design, inputs, keep, materials, persistModel, push, reply, runStudy, startDesign]);

  // Open a DTU in the workspace: read it, and when it is a kept beam study,
  // load the exact inputs it recorded (results stay hidden until re-solved).
  // Any other DTU is summarised from its stored text and handed to ConKay.
  const openDtu = useCallback(async (dtuId: string, title?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      push({ role: 'user', text: `Open DTU ${title ? `“${title}”` : dtuId}` });
      const id = push({ role: 'assistant', text: `Opening ${dtuId}…`, pending: true });
      const r = await lensRun('dtu', 'get', { id: dtuId });
      const payload = r.data?.result as Record<string, unknown> | null;
      const dtu = (payload && typeof payload.dtu === 'object' ? payload.dtu : payload) as Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (r.data?.ok === false || !dtu || (dtu.id && dtu.id !== dtuId)) {
        reply(id, `Could not open ${dtuId}. ${r.data?.error || 'The DTU store did not return it.'}`, { error: true });
        return;
      }
      const name = String(dtu.title || title || dtuId);
      const m = dtu.machine;
      if (m?.kind === 'conkay_beam_study' && m.dims && Number.isFinite(m.loadN)) {
        setInputs({ name: name.split(':')[0].slice(0, 80) || inputs.name, dims: m.dims, loadN: m.loadN, support: m.support, materialId: m.material });
        setDesign(null);
        ws.startBeam();
        setMobileTab('model');
        reply(id, `Opened “${name}”. Its inputs are loaded. When it was kept (sim job ${m.jobId}), the solver gave ${Number(m.maxStressMPa).toFixed(1)} MPa at ${(Number(m.utilization) * 100).toFixed(1)}% utilization. Say “run FEA” to solve it again here.`);
        return;
      }
      const summary = String(dtu.human?.summary || dtu.summary || dtu.core?.definitions?.[0] || '').trim();
      reply(id, summary ? `Opened “${name}”:\n\n${summary.slice(0, 1200)}` : `Opened “${name}”. It has no summary text.`);
    } finally {
      setBusy(false);
    }
    await askAgent(`I opened DTU ${dtuId}${title ? ` (“${title}”)` : ''} in the ConKay workspace. What does it mean for the current study?`);
  }, [askAgent, busy, inputs.name, push, reply, setInputs, ws]);

  const onChip = useCallback(async (chip: Chip) => {
    if (chip.kind === 'edit-tw') {
      setParamsOpen(true);
      setMobileTab('model');
      setTimeout(() => paramRef.current?.focus('webThickness'), 50);
      return;
    }
    if (chip.kind === 'defaults' && chip.brief) {
      if (busy) return;
      setBusy(true);
      pendingBrief.current = null;
      try {
        push({ role: 'user', text: 'Solve it now with defaults' });
        await askAgent(chip.brief);
      } finally { setBusy(false); }
      return;
    }
    if (chip.kind === 'review') { void send('Review the stress results of this study: where is the peak, what governs it, and what would you change?'); return; }
    if (chip.kind === 'apply' && chip.dims) {
      if (busy) return;
      setBusy(true);
      try {
        const changes = Object.entries(chip.dims).map(([k, v]) => `${DIM_LABELS[k as keyof BeamDims].symbol} = ${v} mm`);
        push({ role: 'user', text: changes.join(', ') });
        await runStudy({ ...inputs, dims: { ...inputs.dims, ...chip.dims } }, `Update applied: ${changes.join(', ')}. `);
      } finally { setBusy(false); }
      return;
    }
    if (chip.kind === 'sweep') {
      if (busy) return;
      setBusy(true);
      try {
        const tw = inputs.dims.webThickness;
        const values = [-3, -2, -1, 0, 1, 2, 3]
          .map((d) => Math.round((tw + d) * 100) / 100)
          .filter((v) => v > 0 && v < inputs.dims.flangeWidth);
        const id = push({ role: 'assistant', text: `Sweeping t_w over ${values.join(', ')} mm…`, pending: true });
        const out = await ws.sweep('webThickness', values);
        if ('error' in out) { reply(id, `The sweep did not run: ${out.error}`, { error: true }); return; }
        const pass = out.rows.filter((r) => r.ok && r.pass).length;
        const text = out.lightestPassing !== null
          ? `Solved ${out.rows.length} web thicknesses in ${out.elapsedMs} ms; ${pass} pass. The lightest passing section is t_w = ${out.lightestPassing} mm.`
          : `Solved ${out.rows.length} web thicknesses in ${out.elapsedMs} ms; none pass at this load.`;
        const caveat = ' Pass here means bending stress within yield; web shear, local and lateral-torsional buckling are not checked.';
        const chips: Chip[] = out.lightestPassing !== null && out.lightestPassing !== tw
          ? [{ kind: 'apply', label: `Use t_w = ${out.lightestPassing} mm`, dims: { webThickness: out.lightestPassing } }]
          : [];
        reply(id, text + caveat, { sweep: out, chips });
        setRefreshKey((k) => k + 1);
      } finally { setBusy(false); }
    }
  }, [askAgent, busy, inputs, push, reply, runStudy, send, ws]);

  // Cross-lens handoff: /lenses/conkay?ask=… or ?dtu=<id>&title=… opens the
  // workspace and sends that request once.
  const handedOff = useRef(false);
  useEffect(() => {
    // Wait for the study and the stored conversation, so the handed-off
    // request lands after the log instead of being replaced by it.
    if (handedOff.current || status === 'loading' || logLoaded !== workspaceId) return;
    const ask = params.get('ask');
    const dtu = params.get('dtu');
    if (!ask && !dtu) return;
    handedOff.current = true;
    const q = new URLSearchParams(params.toString());
    q.delete('ask'); q.delete('dtu'); q.delete('title');
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
    setMobileTab('chat');
    if (dtu) void openDtu(dtu, params.get('title') || undefined);
    else if (ask) void send(ask.slice(0, 2000));
  }, [logLoaded, openDtu, params, pathname, router, send, status, workspaceId]);

  const utilization = useMemo(() => (
    result && !ws.stale ? result.utilizationByMember.map((m) => m.utilization) : null
  ), [result, ws.stale]);

  const workspaceName = workspaceId ? (workspaces.find((w) => w.id === workspaceId)?.name ?? 'Workspace') : 'My workspace';

  const nav = (
    <WorkspaceNav
      section={section}
      onSection={setSection}
      workspaces={workspaces}
      workspacesError={workspacesError}
      workspaceId={workspaceId}
      onWorkspace={goWorkspace}
      onCreateWorkspace={createWorkspace}
      materials={materials}
      materialId={inputs.materialId}
      onMaterial={(id) => { setInputs({ ...inputs, materialId: id }); setDesign(null); ws.startBeam(); setMobileTab('model'); }}
      onOpenModel={(name, dims, materialId) => { setInputs({ ...inputs, name, dims, materialId: materialId || inputs.materialId }); setDesign(null); ws.startBeam(); setMobileTab('model'); }}
      onOpenShowcase={(id, label) => { setDesign({ kind: 'showcase', id, label }); setMobileTab('model'); }}
      onAskAboutDtu={(d) => void openDtu(d.id, d.title)}
      refreshKey={refreshKey}
    />
  );

  const conversation = (
    <section aria-label="ConKay conversation" className="flex h-full min-h-0 flex-col rounded-2xl border border-sky-400/15 bg-[#060f1c]/90">
      <header className="flex items-start justify-between gap-2 border-b border-white/5 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">ConKay</h2>
          <p className="text-[11px] text-slate-400">Structural · FEA · Materials · DTU</p>
        </div>
        {messages.length > 0 && (
          <button type="button" onClick={() => void clearConversation()} disabled={busy} className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50">
            Clear
          </button>
        )}
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed text-slate-400">
            <p className="mb-2 text-slate-300">Talk to the study. Edits re-run the solver; questions go to ConKay.</p>
            <ul className="space-y-1 font-mono text-[11px] text-sky-200/80">
              <li>t_w = 8 mm and re-run</li>
              <li>cantilever, 50 kN, A36</li>
              <li>length 2.4 m</li>
              <li>save model · keep as DTU</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`rounded-xl border px-3 py-2.5 text-sm ${m.role === 'user' ? 'ml-6 border-sky-400/20 bg-sky-400/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-200">{m.role === 'user' ? 'You' : 'ConKay'}</span>
              <span className="text-slate-500">{clock(m.at)}</span>
            </div>
            {m.tools && m.tools.length > 0 && (
              <ul className="mb-1.5 flex flex-wrap gap-1">
                {m.tools.map((t, i) => (
                  <li key={`${t.name}-${i}`} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${t.ok ? 'bg-sky-400/10 text-sky-200' : 'bg-rose-400/10 text-rose-200'}`}>
                    ran {t.name}{t.ok ? '' : ' (failed)'}
                  </li>
                ))}
              </ul>
            )}
            {m.role === 'assistant' && !m.error && m.text ? (
              <div className="leading-relaxed text-slate-200"><ConKayMessage fields={{ content: m.text }} renderProse={(t) => <MessageRenderer content={t} streaming={m.pending} />} /></div>
            ) : (
              <p className={`whitespace-pre-wrap leading-relaxed ${m.error ? 'text-rose-200' : 'text-slate-200'}`}>
                {m.text || (m.pending ? 'Thinking…' : '')}
              </p>
            )}
            {m.role === 'assistant' && <ChatArtifacts artifacts={m.artifacts} />}
            {m.pending && (
              <div className="mt-2 h-1 overflow-hidden rounded bg-white/5" role="progressbar" aria-label="Working">
                <div className="h-full w-1/3 animate-conkay-indeterminate motion-reduce:animate-none rounded bg-sky-400/70" />
              </div>
            )}
            {m.sweep && <SweepTable sweep={m.sweep} />}
            {m.chips && m.chips.length > 0 && !m.pending && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.chips.map((c) => (
                  <button key={c.label} type="button" onClick={() => void onChip(c)} disabled={busy} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-400/40 hover:bg-sky-400/10 disabled:opacity-50">
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  const viewport = (
    <section aria-label="Study viewport" className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-sky-400/15 bg-[radial-gradient(ellipse_at_center,#0b2340_0%,#050b14_70%)]">
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'solving' ? 'animate-pulse bg-amber-300' : result && !ws.stale ? 'bg-emerald-400' : 'bg-slate-500'}`} aria-hidden />
            <input
              value={inputs.name}
              onChange={(e) => setInputs({ ...inputs, name: e.target.value.slice(0, 80) })}
              aria-label="Study name"
              className="min-w-0 max-w-[16rem] truncate bg-transparent text-sm font-medium text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-400/40"
            />
            <span className="hidden truncate text-[11px] text-slate-500 sm:inline">· {workspaceName} · mm / N / MPa</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setShowDims((v) => !v)} aria-pressed={showDims} title={showDims ? 'Hide dimensions' : 'Show dimensions'} aria-label={showDims ? 'Hide dimensions' : 'Show dimensions'} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10">
              {showDims ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => void openSave()}
              disabled={busy}
              title="Save model"
              aria-label="Save model"
              aria-expanded={saveOpen}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-50"
            >
              <Save className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {saveOpen && (
          <form
            className="absolute inset-x-0 top-10 z-20 flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#06101c]/95 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !saveName.trim()) return;
              setBusy(true);
              void persistModel(saveName).then((out) => {
                if (!('error' in out)) setSaveOpen(false);
              }).finally(() => setBusy(false));
            }}
          >
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-300">
              Model name
              <input
                aria-label="Model name"
                value={saveName}
                maxLength={80}
                onChange={(e) => { saveTouched.current = true; setSaveName(e.target.value.slice(0, 80)); }}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-slate-100 focus:border-sky-400/50 focus:outline-none"
              />
            </label>
            <button type="submit" disabled={busy || !saveName.trim()} className="rounded-md bg-sky-500/90 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setSaveOpen(false)} className="px-1 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </form>
        )}

        {design && <DesignPane design={design} onClose={() => setDesign(null)} />}
        {!design && ws.fresh && status !== 'loading' && (
          <StartScreen busy={busy} onPick={(t) => void send(t)} onBeam={ws.startBeam} />
        )}
        <BeamViewport dims={inputs.dims} support={inputs.support} utilization={utilization} view={view} display={display} showDims={showDims} leftInset={paramsOpen ? 0.22 : 0} />

        <div className="absolute left-3 top-11 z-10 w-48 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/10 bg-[#06101c]/85 backdrop-blur">
          <button type="button" onClick={() => setParamsOpen((v) => !v)} aria-expanded={paramsOpen} className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-slate-200">
            <span className="flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Parameters</span>
            {paramsOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          </button>
          {paramsOpen && (
            <div className="border-t border-white/5 px-3 pb-3 pt-2">
              <ParameterPanel ref={paramRef} inputs={inputs} materials={materials} onChange={setInputs} />
              <button
                type="button"
                onClick={() => void send('run fea')}
                disabled={busy}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500/90 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-60"
              >
                {status === 'solving' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Run FEA
              </button>
            </div>
          )}
        </div>

        <div className="absolute bottom-2 right-2 z-10 flex flex-wrap items-center justify-end gap-1.5">
          {utilization && (display === 'stress' || display === 'wire-stress') && (
            <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-[#06101c]/85 px-2 py-1 text-[10px] text-slate-300">
              Utilization
              <span className="h-2 w-16 rounded" style={{ background: `linear-gradient(90deg, ${utilizationColor(0)}, ${utilizationColor(0.5)}, ${utilizationColor(0.8)}, ${utilizationColor(1)})` }} aria-hidden />
              0–100%
            </div>
          )}
          <label className="flex items-center gap-1 rounded-md border border-white/10 bg-[#06101c]/85 px-2 py-1 text-[11px] text-slate-300">
            View:
            <select value={view} onChange={(e) => setView(e.target.value as ViewPreset)} aria-label="View" className="bg-transparent text-slate-100 focus:outline-none">
              {(Object.keys(VIEW_LABELS) as ViewPreset[]).map((v) => <option key={v} value={v} className="bg-[#06101c]">{VIEW_LABELS[v]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 rounded-md border border-white/10 bg-[#06101c]/85 px-2 py-1 text-[11px] text-slate-300">
            Display:
            <select value={display} onChange={(e) => setDisplay(e.target.value as DisplayMode)} aria-label="Display" className="bg-transparent text-slate-100 focus:outline-none">
              {(Object.keys(DISPLAY_LABELS) as DisplayMode[]).map((v) => <option key={v} value={v} className="bg-[#06101c]">{DISPLAY_LABELS[v]}</option>)}
            </select>
          </label>
        </div>
      </div>
      {ws.error && status === 'error' && <p className="px-1 text-xs text-rose-300">{ws.error}</p>}
      <StudyCards result={result} stale={ws.stale} status={status} onRun={() => void send('run fea')} onKeep={() => void keep()} keeping={keeping} />
    </section>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-[#040a13] p-2 sm:p-3">
      {/* Phone / tablet tabs */}
      <div role="tablist" aria-label="Workspace panels" className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1 lg:hidden">
        {([['model', 'Model', Boxes], ['chat', 'ConKay', MessageSquare], ['browse', 'Browse', PanelLeft]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={mobileTab === id}
            onClick={() => setMobileTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm ${mobileTab === id ? 'bg-sky-400/15 text-sky-100' : 'text-slate-400'}`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_340px] xl:grid-cols-[240px_minmax(0,1fr)_380px]">
        <aside className={`${mobileTab === 'browse' ? 'flex' : 'hidden'} min-h-0 flex-col rounded-2xl border border-sky-400/15 bg-[#060f1c]/90 p-2 lg:flex`}>{nav}</aside>
        <div className={`${mobileTab === 'model' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>{viewport}</div>
        <div className={`${mobileTab === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col lg:flex`}>{conversation}</div>
      </div>

      <VoiceComposer busy={busy} onSend={(t) => void send(t)} speakText={speak} />
    </div>
  );
}
