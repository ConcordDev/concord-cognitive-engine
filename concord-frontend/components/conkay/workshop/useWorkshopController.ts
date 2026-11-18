'use client';

/**
 * useWorkshopController — the ConKay Workshop's brain: the study, the
 * conversation, the agent stream, new designs from the box, chips, saves,
 * keeps and cross-lens handoffs. Moved verbatim out of the old
 * ConKayWorkspace render so the Workshop UI (table / wall / under the hood)
 * and guest mode share one controller. Every behaviour here is pinned by
 * tests/conkay-workspace.test.tsx.
 *
 * Guest mode (the public demo): the study solves and sweeps through the
 * public demo endpoints; anything that stores (save, keep, the agent, the
 * workspace log, workspaces) is refused with a sign-up line, never faked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, lensRun } from '@/lib/api/client';
import { detectNewDesign, type NewDesignIntent } from '@/lib/conkay/new-design-intent';
import type { BriefClaim, TrussAnswer, WorkspaceDesign } from '../workspace/DesignPane';
import { CONKAY_PERSONA_PROMPT } from '@/components/conkay/conkay-persona';
import { agentFailure, artifactKey, streamConKayAgent, stripToolCallLeak } from '@/lib/conkay/agent-stream';
import type { ChatArtifact } from '@/components/chat/ChatArtifacts';
import {
  DIM_LABELS,
  applyWorkspaceCommand,
  describeStudy,
  detectOutOfScopeRequest,
  formatWorkspaceLead,
  outOfScopeDecline,
  parseWorkspaceCommand,
  studyContext,
  type BeamDims,
  type BeamStudyResult,
} from '@/lib/conkay/workspace-commands';
import { useConKayWorkspace, type StudyInputs, type SweepResult } from '../workspace/useConKayWorkspace';
import type { NavSection, WorkspaceSummary } from '../workspace/WorkspaceNav';
import type { ParameterPanelHandle } from '../workspace/ParameterPanel';
import type { DisplayMode, ViewPreset } from '@/lib/conkay/beam-view';

export type { BeamStudyResult, SweepResult };

export type ChipKind = 'review' | 'sweep' | 'edit-tw' | 'apply' | 'defaults';
export interface Chip { kind: ChipKind; label: string; dims?: Partial<BeamDims>; brief?: string }
export interface WsMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
  pending?: boolean;
  error?: boolean;
  chips?: Chip[];
  tools?: Array<{ name: string; ok: boolean }>;
  cockpitRunId?: string;
  sweep?: SweepResult;
  /** Songs, images, audio previews and 3D models the agent's tools returned. */
  artifacts?: ChatArtifact[];
  /** Set by the server only when the small local backup model answered (GPU brain offline). */
  confidence?: 'low';
  confidenceReason?: string;
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

export function useWorkshopController({ guest = false, onDesigned }: { guest?: boolean; onDesigned?: (id: string) => void } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspaceId = params.get('ws');
  const ws = useConKayWorkspace(guest ? null : workspaceId, { guest });
  const { inputs, setInputs, result, materials, status } = ws;

  const [section, setSection] = useState<NavSection | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [workspacesError, setWorkspacesError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [busy, setBusy] = useState(false);
  /** A new design opened from the box (showcase or solved brief); null = the I-beam study. */
  const [design, setDesign] = useState<WorkspaceDesign | null>(null);
  /** The latest ConKay-designed 3D model (conkay_design mesh): shown in the main viewport in place of the I-beam study. */
  const [viewMesh, setViewMesh] = useState<ChatArtifact | null>(null);
  /** A brief the workbench answered with questions: the next message adds to it. */
  const pendingBrief = useRef<string | null>(null);
  /** The "what the design solver builds" note is shown once, on the first brief handed to the agent. */
  const fallbackNoted = useRef(false);
  const [keeping, setKeeping] = useState(false);
  /** The last real sweep, for the table's morph-through-results scrub. */
  const [lastSweep, setLastSweep] = useState<SweepResult | null>(null);
  const [view, setView] = useState<ViewPreset>('isometric');
  const [display, setDisplay] = useState<DisplayMode>('wire-stress');
  // Dimension tags start on where there's room; on a phone they'd bury the readouts (the eye toggle shows them).
  const [showDims, setShowDims] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches);
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
    // A guest has no stored conversation: start empty, store nothing.
    if (guest) { setLogLoaded(workspaceId); return; }
    let live = true;
    void lensRun<{ messages: WsMessage[] }>('engineering', 'workspaceLog-get', workspaceId ? { workspaceId } : {}).then((r) => {
      if (!live) return;
      const log = Array.isArray(r.data?.result?.messages) ? r.data.result.messages : [];
      persisted.current = new Set(log.map((m) => m.id));
      setMessages(log);
      setLogLoaded(workspaceId);
    });
    return () => { live = false; };
  }, [guest, workspaceId]);
  useEffect(() => {
    if (guest || logLoaded !== workspaceId) return;
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
  }, [guest, logLoaded, messages, workspaceId]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

  const loadWorkspaces = useCallback(async () => {
    if (guest) { setWorkspaces([]); return; }
    const r = await lensRun<{ projects: Array<{ id: string; name: string }> }>('agent_projects', 'list', {});
    if (r.data?.ok === false) { setWorkspacesError(r.data.error || 'Could not load workspaces.'); return; }
    setWorkspacesError('');
    setWorkspaces((r.data?.result?.projects ?? []).map((p) => ({ id: p.id, name: p.name })));
  }, [guest]);
  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);

  const goWorkspace = useCallback((id: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (id) q.set('ws', id); else q.delete('ws');
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
    setMobileTab('model');
  }, [params, pathname, router]);

  const createWorkspace = useCallback(async (name: string) => {
    if (guest) return null;
    const r = await lensRun<{ project: { id: string; name: string } }>('agent_projects', 'create', { name });
    const p = r.data?.result?.project;
    if (r.data?.ok === false || !p?.id) return null;
    await loadWorkspaces();
    goWorkspace(p.id);
    return p.id;
  }, [goWorkspace, guest, loadWorkspaces]);

  const push = useCallback((m: Omit<WsMessage, 'id' | 'at'> & { id?: string }) => {
    const msg: WsMessage = { id: m.id || uid(), at: new Date().toISOString(), ...m };
    setMessages((prev) => [...prev, msg]);
    return msg.id;
  }, []);
  const [clearArmed, setClearArmed] = useState(false);
  const clearConversation = useCallback(async () => {
    const had = messagesRef.current.length;
    const r = await lensRun('engineering', 'workspaceLog-clear', workspaceId ? { workspaceId } : {});
    if (r.data?.ok === false) return;
    persisted.current = new Set();
    setMessages([]);
    setClearArmed(false);
    // The receipt (F9): what was cleared, and what was NOT touched.
    push({ role: 'assistant', text: `Conversation cleared — ${had} message${had === 1 ? '' : 's'} removed. The study, its results and your saved models were not touched.` });
  }, [push, workspaceId]);
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
    // A completed-action report carries its action (F11): the reply badge
    // grounds on it instead of the blanket "Reasoned — verify".
    reply(id, `${lead}${describeStudy(out.result, before)}`, { chips: STUDY_CHIPS, tools: [{ name: 'engineering.beamStudy', ok: true }] });
    setRefreshKey((k) => k + 1);
    return out.result;
  }, [push, reply, result, ws]);

  const persistModel = useCallback(async (name?: string, asCopy = false) => {
    const wasLinked = Boolean(ws.partId) && !asCopy;
    const id = push({ role: 'assistant', text: 'Saving model…', pending: true });
    const out = await ws.saveModel(name, { asCopy });
    if ('error' in out) reply(id, `Not saved. ${out.error}`, { error: true });
    else {
      reply(id, wasLinked ? `Saved “${out.name}” to Models (${out.id}) — updated in place.` : `Saved “${out.name}” to Models (${out.id}).`, { tools: [{ name: 'engineering.savePart', ok: true }] });
      setInputs((s) => (s.name === out.name ? s : { ...s, name: out.name }));
      setRefreshKey((k) => k + 1);
    }
    return out;
  }, [push, reply, setInputs, ws]);

  const openSave = useCallback(async () => {
    saveTouched.current = false;
    setSaveOpen(true);
    setSaveName(inputs.name);
    // The incrementing suggestion is an offer for an UNSAVED study only; a
    // linked study's save strip opens on its own name (F3).
    if (!ws.partId) {
      const suggestion = await ws.suggestName();
      if (!saveTouched.current) setSaveName(suggestion);
    }
  }, [inputs.name, ws]);

  const keep = useCallback(async (msgId?: string) => {
    setKeeping(true);
    const id = msgId ?? push({ role: 'assistant', text: 'Keeping this study as a private DTU…', pending: true });
    const out = await ws.keepAsDtu();
    setKeeping(false);
    if ('error' in out) reply(id, `Not kept. ${out.error}`, { error: true });
    else { reply(id, `Kept as private DTU ${out.dtuId} and read back. It records this solve's inputs, results and hand check. Nothing was published.`, { tools: [{ name: 'engineering.beamStudy-keep', ok: true }] }); setRefreshKey((k) => k + 1); }
  }, [push, reply, ws]);

  const askAgent = useCallback(async (text: string) => {
    if (guest) {
      reply(push({ role: 'assistant', text: '', pending: true }), 'Talking it through with ConKay needs an account — sign up free and I\u2019ll pick this up with you. In the demo I can solve the beam: try “t_w = 8 mm and re-run” or “make it lighter”.');
      return;
    }
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
      const meshUrl = typeof rec.url === 'string' && /^\/api\/media\/[^/]+\/stream$/.test(rec.url);
      const meshPos = Array.isArray(rec.positions) && Array.isArray(rec.indices) && rec.positions.length >= 9;
      if (rec.kind === 'mesh' && (meshPos || meshUrl)) {
        setDesign(null);
        setViewMesh(rec as ChatArtifact);
      }
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
          if (c.domain === 'engineering' && c.action === 'beamStudy' && c.ok !== false) { resolved = true; setViewMesh(null); }
          patch(id, { tools: tools.slice() });
          if (c.ok !== false) {
            addArtifact(c.artifact);
            for (const a of c.artifacts ?? []) addArtifact(a);
          }
        },
        onArtifact: addArtifact,
        onCockpit: (e) => { if (e.runId) patch(id, { cockpitRunId: e.runId }); },
      });
      const clean = stripToolCallLeak(live);
      if (!done.ok && !clean.text) reply(id, agentFailure(done.error), { error: true, tools, artifacts });
      else if (clean.leaked && !clean.text) reply(id, 'ConKay tried to call a tool but the call didn’t run. Please ask again.', { error: true, tools, artifacts });
      else reply(id, clean.text || (artifacts.length ? 'Here it is below.' : 'Done.'), { tools, artifacts, confidence: done.confidence, confidenceReason: done.confidenceReason });
    } catch (e) {
      reply(id, agentFailure(e instanceof Error ? e.message : 'network error'), { error: true, tools });
    }
    if (resolved) { await ws.reload(); setRefreshKey((k) => k + 1); }
  }, [guest, inputs, materials, patch, push, reply, result, workspaceId, ws]);

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
      // A 400 carries the refusal (stage, errors): resolve it so the body is read. The api client turns a
      // rejected response into a ConcordError without `response`, which used to hide it behind "status code 400".
      data = (await api.post('/api/conkay/workbench', { prompt: text.slice(0, 4000) }, { validateStatus: (s) => (s >= 200 && s < 300) || s === 400 })).data as Record<string, unknown>;
    } catch (e) {
      const res = (e as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
      if (res?.status === 401 || (e as { statusCode?: number })?.statusCode === 401) { reply(id, 'Sign in to design here. The showcase designs open without an account: say "show me the car".', { error: true }); return; }
      data = res?.data ?? null;
      if (!data) { reply(id, `The design did not run: ${e instanceof Error ? e.message : 'network error'}.`, { error: true }); return; }
    }
    const errs = Array.isArray(data?.errors) ? (data.errors as Array<{ error?: string }>).map((x) => x.error).filter(Boolean) : [];
    // Not a design type the workbench reads (a parse refusal, or an error with no recognized domain):
    // hand the brief to the ConKay agent instead of a dead-end error. Solver failures on a known type keep the error.
    if (data?.ok === false && (data.stage === 'parse' || (data.stage === 'error' && !data.domain))) {
      if (!fallbackNoted.current) {
        fallbackNoted.current = true;
        reply(id, 'ConKay\u2019s design solver builds cars, brackets, beams, trusses and Sentinel parts so far. This one is outside that list, so I\u2019ll work through it with you in conversation.');
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }
      await askAgent(text);
      return;
    }
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
      // In the Workshop the new design comes down onto the table in place.
      if (onDesigned) onDesigned(data.id); else router.push(`/conkay/workbench/${data.id}`);
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
  }, [askAgent, onDesigned, push, reply, router]);

  // Sweep the web thickness ±3 mm through the real solver (engineering.beamSweep)
  // and offer the lightest passing section. Shared by the "Parameter sweep"
  // chip and the spoken "make it lighter".
  const sweepWeb = useCallback(async () => {
    const tw = inputs.dims.webThickness;
    const values = [-3, -2, -1, 0, 1, 2, 3]
      .map((d) => Math.round((tw + d) * 100) / 100)
      .filter((v) => v > 0 && v < inputs.dims.flangeWidth);
    const id = push({ role: 'assistant', text: `Sweeping t_w over ${values.join(', ')} mm…`, pending: true });
    const out = await ws.sweep('webThickness', values);
    if ('error' in out) { reply(id, `The sweep did not run: ${out.error}`, { error: true }); return; }
    setLastSweep(out);
    const pass = out.rows.filter((r) => r.ok && r.pass).length;
    const text = out.lightestPassing !== null
      ? `Solved ${out.rows.length} web thicknesses in ${out.elapsedMs} ms; ${pass} pass. The lightest passing section is t_w = ${out.lightestPassing} mm.`
      : `Solved ${out.rows.length} web thicknesses in ${out.elapsedMs} ms; none pass at this load.`;
    const caveat = ' Pass here means bending stress within yield; web shear, local and lateral-torsional buckling are not checked.';
    const chips: Chip[] = out.lightestPassing !== null && out.lightestPassing !== tw
      ? [{ kind: 'apply', label: `Use t_w = ${out.lightestPassing} mm`, dims: { webThickness: out.lightestPassing } }]
      : [];
    reply(id, text + caveat, { sweep: out, chips, tools: [{ name: 'engineering.beamSweep', ok: true }] });
    setRefreshKey((k) => k + 1);
  }, [inputs.dims, push, reply, ws]);

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
      // "Make it lighter": sweep the web through the solver and offer the
      // lightest section that still passes — never a guessed number.
      if (!design && !viewMesh && /\b(?:make (?:it|this) lighter|lighten (?:it|this)|lightest (?:section|beam))\b/i.test(text)) {
        await sweepWeb();
        return;
      }
      const cmd = parseWorkspaceCommand(text, inputs.dims, materials, inputs.materialId);
      // Out-of-scope analyses decline BY NAME (F6): the solver's stated
      // scope is the refusal — never a substituted bending solve. Study
      // edits in the same message still run below.
      const oos = detectOutOfScopeRequest(text);
      if (oos) {
        reply(push({ role: 'assistant', text: '', pending: true }), outOfScopeDecline(oos, result?.analysisReceipt?.outOfScope));
        // The "run" in "run a buckling check" is the ask being declined, not a request to
        // re-solve the bending study: only real edits (or save/keep) continue below.
        if (!cmd || (cmd.changes.length === 0 && !cmd.save && !cmd.keep)) return;
      }
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
  }, [askAgent, busy, design, inputs, keep, materials, persistModel, push, reply, runStudy, startDesign, sweepWeb, viewMesh]);

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
      setViewMesh(null);
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
      try { await sweepWeb(); } finally { setBusy(false); }
    }
  }, [askAgent, busy, inputs, push, reply, runStudy, send, sweepWeb]);

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

  return {
    guest, router, pathname, params, workspaceId, workspaceName,
    ws, inputs, setInputs, result, materials, status,
    section, setSection, workspaces, workspacesError, goWorkspace, createWorkspace,
    refreshKey, messages, busy, design, setDesign, viewMesh, setViewMesh,
    keeping, view, setView, display, setDisplay, showDims, setShowDims,
    paramsOpen, setParamsOpen, mobileTab, setMobileTab, speak,
    saveOpen, setSaveOpen, saveName, setSaveName, saveTouched, setBusy,
    paramRef, listRef, clearArmed, setClearArmed, clearConversation,
    persistModel, openSave, keep, send, onChip, openDtu, utilization, lastSweep,
  };
}

export type WorkshopController = ReturnType<typeof useWorkshopController>;
