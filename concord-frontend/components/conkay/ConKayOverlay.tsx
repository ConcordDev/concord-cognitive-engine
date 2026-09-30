'use client';

import { getApiBase } from '@/lib/api/base';

// concord-frontend/components/conkay/ConKayOverlay.tsx
//
// ConKay, summonable on ANY lens — the cross-lens "take over and operate" surface
// (the Tony↔JARVIS interaction). This is the differentiator no other JARVIS clone
// has: it doesn't screen-scrape and it isn't limited to pre-wired per-app actions.
// It operates the host lens by calling that lens's REAL macros through Concord's
// unified action contract (`/api/lens/run` via `lensRun`), with the global ConKay
// skills available everywhere, voice, and the world-tree presence.
//
// Summon: Cmd/Ctrl+J anywhere, or dispatch `window` event 'conkay:summon'. Esc to
// dismiss. Otherwise self-contained (mounts once in the lens shell and rides
// over whatever lens you're on) — CK2's one deliberate exception is a thin
// attention-bridge (`conkayAttentionStore.ts`) that mirrors this component's
// own open/running/voice booleans out to the ambient ConKayWidget mounted
// separately in AppShell; see the "CK2 attention bridge" effects below.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { X, Send, Mic, MicOff, Sparkles, Volume2, VolumeX, Box, MapPin, Activity, Layers, Type, Package, Sword } from 'lucide-react';
import { ConKayMessage, type ConKayReplyFields } from './ConKayViz';
import { useConKayVoice } from './useConKayVoice';
import { matchConKaySkill, type ConKaySkill } from './conkay-skills';
import { ConKayWorkStatus, type WorkStep } from './ConKayWorkStatus';
import { useConkayHudStore, feaResultFromRun } from './conkayHudStore';
import { useConkayRunStore, type RawToolCall } from './conkayRunStore';
import { useConkayAttentionStore } from './conkayAttentionStore';
import { detectArtifact } from '@/lib/conkay/artifact-kinds';
import { isMutatingMacro } from '@/lib/conkay/mutating-macros';
import { onUnityEvent, postUnityCmd, spawnPrimitive, clearTempPrimitives, unityIframePresent, loadGlb } from '@/lib/conkay/unity-bridge';
import { runFeaBeamToWorld } from '@/lib/conkay/fea-beam-to-world';
import { runPartMeshToWorld } from '@/lib/conkay/part-mesh-to-world';
import { designViaApiOrClient } from '@/lib/conkay/nlp-design-to-world';
import { runEvoGlbToWorld } from '@/lib/conkay/evo-glb-to-world';
import { runAssemblyChatRevise, downloadStl, downloadAssemblyBom, downloadErpBomJson, downloadErpBomCsv, downloadStep, downloadBrepStep, occFeatureRebuild, rebuildPartSolid, occFeatureAppend, fetchOccStatus, runAssemblyUndo, runAssemblyRedo, downloadAssemblyDrawing, downloadAssemblyDrawingPdf, explodeAssemblyApi, fetchMaterials, attachPartMaterial, listParts, mateSolveDof, sketchSolve, gdtDigital, occFeatureList } from '@/lib/conkay/assembly-to-world';
import { ConKayActionConfirm } from './ConKayActionConfirm';
import { ConKayVerticalsBar } from './ConKayVerticalsBar';
import { mintConkayArtifactDtu } from '@/lib/conkay/mint-artifact-dtu';
import { ConKayCockpit } from './ConKayCockpit';
import { CONKAY_SIGNATURE_GREETING, CONKAY_PERSONA_PROMPT, type ConKayState } from './conkay-persona';
import { getLensById } from '@/lib/lens-registry';
import { lensRun } from '@/lib/api/client';
import type { CapabilityVerdict } from '@/components/common/CapabilityBadge';
import { subscribe, connectSocket, onConnectionLost, onReconnected } from '@/lib/realtime/socket';
import MessageRenderer from '@/components/chat/MessageRenderer';

// A correlation id for one macro run. Passed to lensRun → sent as
// x-conkay-run-id → echoed back on the macro:started/completed events so the
// HUD can bind a step to the REAL backend call (never a guessed spinner).
function newRunId(): string {
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Cheap client-side mirror of the backend proof-amenability anchors
// (server/lib/proof-gate.js). Math/logic claims should be sent to reason.verify
// EVEN WITHOUT citations so the Z3 proof gate can fire and earn the "Proven ✓"
// badge. This only gates whether we *ask* the backend — the backend re-decides
// authoritatively and returns "unverified" if it isn't really formalisable.
const PROVABLE_RE = /[<>]=?|≤|≥|≠|\bfor all\b|\bfor every\b|\bthere exists\b|\bdivisible\b|\bprime\b|\bif and only if\b|\bimplies\b|\b\d+\s*[+\-*/^]\s*\d+\b/i;
function looksProvable(claim: string): boolean {
  const t = String(claim || '');
  return t.length >= 3 && t.length <= 2000 && PROVABLE_RE.test(t);
}

// ── Grounded research mode (V1.1 R3) — reason.evaluate_answer adapter ──────
// The `reason.evaluate_answer` macro (server/domains/reason.js) returns the
// raw `evaluateAnswer()` shape (server/lib/research/answer-eval.js), NOT the
// CapabilityBadge-ready shape — that adapter (`toCapabilityVerdict`) lives
// server-side and itself imports `reason-verify.js`, which pulls in
// server-only modules; importing it here would drag server code into the
// frontend bundle. This is a small, deliberate client-side MIRROR of that
// exact function (same verdict vocabulary, same mapping table) so the two
// stay obviously in sync at a glance — not a re-derivation, a port. If
// answer-eval.js's `VERDICT_TO_CAPABILITY` table ever changes, update this
// one too.
interface EvalAnswerCitation {
  citationsTotal?: number;
  citationsResolved?: number;
  allResolved?: boolean;
  unresolvedIds?: string[];
  confidence?: number | null;
  supported?: boolean | null;
}
interface EvalAnswerResult {
  ok?: boolean;
  verdict?: string;
  mode?: string;
  faithfulness?: number | null;
  citation?: EvalAnswerCitation | null;
  question?: string | null;
  answer?: string | null;
}
const EVAL_VERDICT_TO_CAPABILITY: Record<string, string> = {
  grounded: 'grounded',
  fabricated_citation: 'fabricated_citation',
  contradicted: 'refuted',
  partially_grounded: 'unsupported',
  unverified: 'unverified',
};
function toCapabilityVerdictClient(evalResult: EvalAnswerResult | undefined): CapabilityVerdict {
  // Honest floor, mirroring answer-eval.js's toCapabilityVerdict exactly: a
  // failed/absent/malformed result returns `{ ok: false }` — NOT a fabricated
  // "grounded" — so CapabilityBadge's own contract (`capabilityTierFor`
  // treats any non-`ok:true` verdict as "unverified") renders the honest
  // "Unverified" tier for every attempted-but-unusable check, exactly the
  // same as a check that never ran at all.
  if (!evalResult || evalResult.ok !== true || !evalResult.verdict) return { ok: false };
  const citation = evalResult.citation || null;
  return {
    ok: true,
    verdict: EVAL_VERDICT_TO_CAPABILITY[evalResult.verdict] || 'unverified',
    mode: evalResult.mode === 'llm-enhanced' ? 'council' : 'deterministic',
    confidence: typeof evalResult.faithfulness === 'number' ? evalResult.faithfulness : (citation?.confidence ?? null),
    claim: evalResult.question || evalResult.answer || null,
    citationsTotal: citation?.citationsTotal ?? 0,
    citationsResolved: citation?.citationsResolved ?? 0,
    allResolved: citation ? citation.allResolved : undefined,
    unresolvedIds: citation?.unresolvedIds ?? [],
    supported: evalResult.verdict === 'grounded' ? true : evalResult.verdict === 'contradicted' ? false : (citation?.supported ?? null),
  };
}

// The world-tree field is WebGL — load client-only so SSR never touches it.
const ConKayBackdrop = dynamic(
  () => import('./ConKayBackdrop').then((m) => m.ConKayBackdrop),
  { ssr: false },
);

// Phase 3 — exploded view of a REAL artifact (loaded via the ar.render macro).
// Lazy + client-only: the Three.js + gsap inspector only loads when summoned.
const ConKayArtifactExploded = dynamic(
  () => import('./ConKayArtifactExploded').then((m) => m.ConKayArtifactExploded),
  { ssr: false },
);

interface OverlayMsg extends ConKayReplyFields {
  id: string;
  role: 'user' | 'assistant';
}

function stripFence(s: string): string {
  return (s || '').replace(/```conkay-viz[\s\S]*?```/gi, '').trim();
}

// Active lens id from the path. The macro DOMAIN is, by Concord convention, the
// lens id for the great majority of lenses (music→music, accounting→accounting…).
function activeLensFromPath(pathname: string | null): { id: string; name: string } | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/lenses\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  const entry = getLensById(id);
  return { id, name: entry?.name || id };
}

// A live telemetry chip — every value here is a pure function of the real
// macro:* lifecycle (via the HUD store), never a guess. While a real macro is in
// flight it reads "● live · domain.action"; on completion it shows the actual
// returned facts (ok/failed + the elapsed ms the backend reported).
function ConKayTelemetryChip() {
  const inFlight = useConkayHudStore((s) => s.inFlight);
  const activeLabel = useConkayHudStore((s) => s.activeLabel);
  const last = useConkayHudStore((s) => s.last);
  if (inFlight > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200" title="A real backend macro is in flight">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
        live · {activeLabel ?? 'backend'}
      </span>
    );
  }
  if (last) {
    return (
      <span
        className={`rounded-full border px-2 py-0.5 text-[11px] ${last.ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-400/30 bg-rose-400/10 text-rose-200'}`}
        title="Last real macro result reported by the backend"
      >
        {last.domain}.{last.action} · {last.ok ? 'ok' : 'failed'}{last.ms != null ? ` · ${last.ms} ms` : ''}
      </span>
    );
  }
  return null;
}

// Phase-2 telemetry panel — moved to `./panels/ConKayTelemetryPanel.tsx` (F1)
// so it can also be registered in `lib/panel-registry.ts` as `conkay.telemetry`
// and lazy-mounted in the cockpit's right panel lane below. It is still the
// same self-contained "recent system work" ledger, unchanged.

export function ConKayOverlay() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [messages, setMessages] = useState<OverlayMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [muted, setMuted] = useState(false);
  // Work-animation state: a live status line + a step spine that resolves as
  // ConKay works (the JARVIS "you can see it building" surface).
  const [steps, setSteps] = useState<WorkStep[]>([]);
  const [workStatus, setWorkStatus] = useState('');

  /** CAD/vertical toolbar: set status line AND mint inspectable locker DTU (same shape as chat persistArtifact). */
  const reportCadAction = useCallback((label: string, payload: Record<string, unknown> = {}) => {
    setWorkStatus(label);
    const action = typeof payload.action === 'string' ? payload.action : 'cad_toolbar';
    void mintConkayArtifactDtu({
      title: label.slice(0, 100),
      work: { channel: 'cad', action, status: label, ...payload },
      tags: ['conkay', 'cad', 'artifact', `action:${action}`],
    }).then((r) => {
      if (r.ok && r.id) {
        setWorkStatus(`${label} · dtu=${r.id.slice(0, 8)}…`);
      } else if (!r.ok) {
        setWorkStatus(`${label} · mint failed: ${r.error || 'error'}`);
      }
    });
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const spokeRef = useRef<string | null>(null);
  // The correlation id of the macro run currently in flight. The lifecycle
  // subscription below only reacts to events tagged with this id.
  const liveRunRef = useRef<string | null>(null);
  // Unit A2 — pre-execution confirmation gate for the CLIENT-INITIATED macro
  // path (executeMacro / resolveAndOperate). When `isMutatingMacro` flags the
  // proposed call as a write, this holds the REAL {domain, macro, input}
  // ConKay is about to send and blocks execution until the user explicitly
  // confirms or cancels via <ConKayActionConfirm>. `pendingConfirmResolveRef`
  // is the in-flight promise's resolver — never a fabricated auto-approve.
  const [pendingConfirm, setPendingConfirm] = useState<{ domain: string; macro: string; input: Record<string, unknown> } | null>(null);
  const pendingConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const lens = activeLensFromPath(pathname);
  // ConKay should not double up inside the chat lens (which has its own ConKay mode).
  const onChatLens = lens?.id === 'chat';

  // ── summon / dismiss ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    const onSummon = () => setOpen(true);
    const onDismiss = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    window.addEventListener('conkay:summon', onSummon);
    // Real dispatcher: ConKayWidgetLayer.tsx fires this via
    // `window.dispatchEvent(new Event(overlayOpen ? 'conkay:dismiss' : 'conkay:summon'))`
    // — a ternary argument to `new Event(...)`, invisible to the detector's literal-
    // string regexes (which also only match CustomEvent, not bare Event). Confirmed
    // live by tests/components/ConKayWidgetAttention.test.tsx (DET-C continuation, 2026-07-24).
    // @dead-event-ok
    window.addEventListener('conkay:dismiss', onDismiss);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('conkay:summon', onSummon);
      window.removeEventListener('conkay:dismiss', onDismiss);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // ── CK2 attention bridge (open + busy) ───────────────────────────────
  // Mirror this overlay's own `open`/`running` state into the attention
  // store so the ambient widget (mounted separately in AppShell — see
  // ConKayWidgetLayer.tsx) can render a REAL "thinking" state instead of
  // inventing one. `running` here is the EXACT SAME boolean that already
  // drives this component's own "working…" header label and
  // <ConKayWorkStatus active={running}> below — no second busy-detector.
  // The unmount cleanup resets to all-idle defaults: if this overlay
  // instance goes away (e.g. the user navigated off every /lenses/* route,
  // per app/lenses/layout.tsx only mounting it there) nothing should be left
  // behind claiming ConKay is still open/busy/listening/speaking.
  useEffect(() => {
    useConkayAttentionStore.getState().setOpen(open);
  }, [open]);
  useEffect(() => {
    useConkayAttentionStore.getState().setBusy(running);
  }, [running]);
  useEffect(() => () => { useConkayAttentionStore.getState().reset(); }, []);

  // ── Unity WebGL postMessage (ConKay → iframe) ────────────────────────
  // LIVE: typed `concordia:cmd` into #concordia-unity-webgl when present
  // (world lens + NEXT_PUBLIC_CONCORDIA_RENDERER=unity-webgl). Structured
  // build intents (spawn_primitive / set_color / clear_temp) are F0 markers
  // only — not free-text CAD. No-op if iframe missing.
  const [unityPresent, setUnityPresent] = useState(false);
  const [nlpDesignText, setNlpDesignText] = useState('simply supported steel I-beam 6m, 5kN midspan');
  const [nlpBuilding, setNlpBuilding] = useState(false);
  const [evoGlbBusy, setEvoGlbBusy] = useState(false);
  const [assemblyId, setAssemblyId] = useState<string | null>(null);

  // Share current assembly with cockpit CAD panels (feature-tree / ERP BOM) — minimal bridge.
  useEffect(() => {
    if (!assemblyId) return;
    try {
      sessionStorage.setItem('conkay.assemblyId', assemblyId);
      window.dispatchEvent(new CustomEvent('conkay:assembly', { detail: { assemblyId } }));
    } catch {
      /* ignore */
    }
  }, [assemblyId]);
  const [assemblyBusy, setAssemblyBusy] = useState(false);
  const [materialPicker, setMaterialPicker] = useState('steel');
  const [materialsList, setMaterialsList] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  useEffect(() => {
    if (!open) {
      setUnityPresent(false);
      return;
    }
    const refresh = () => setUnityPresent(unityIframePresent());
    refresh();
    const t = window.setInterval(refresh, 2000);
    const off = onUnityEvent((msg) => {
      // Honest telemetry only — never invent a CAD/physics result.
      if (msg.event === 'ready' || msg.event === 'pong' || msg.event === 'ack' || msg.event === 'spawned' || msg.event === 'mesh_applied' || msg.event === 'glb_loaded' || msg.event === 'transform_set') {
        const kind = msg.payload && typeof msg.payload.kind === 'string' ? ` · ${msg.payload.kind}` : '';
        setWorkStatus(`Unity bridge: ${msg.event}${kind}${msg.id ? ` · ${msg.id}` : ''}`);
      }
    });
    if (unityIframePresent()) {
      postUnityCmd('hello', { source: 'conkay-overlay', lens: lens?.id ?? null });
      postUnityCmd('ping', { source: 'conkay-overlay' });
    }
    return () => {
      window.clearInterval(t);
      off();
    };
  }, [open, lens?.id]);

  /** F0: drop a cyan cube marker in the Unity world when iframe is present. */
  const dropWorldMarker = useCallback(() => {
    if (!unityIframePresent()) {
      setWorkStatus('Unity bridge: no iframe (open world lens with unity-webgl)');
      return;
    }
    const id = `marker-${Date.now()}`;
    const ok = spawnPrimitive(
      {
        kind: 'cube',
        position: { x: (Math.random() - 0.5) * 2, y: 1.2, z: (Math.random() - 0.5) * 2 },
        scale: 0.45,
        color: '#3de0f5',
      },
      id,
    );
    if (ok) reportCadAction(`Unity bridge: spawn_primitive posted · ${id}`, { action: 'spawn_primitive', id });
    else setWorkStatus('Unity bridge: spawn post failed');
  }, []);

  /**
   * Industrial slice v1: engineering.runFEA(FEA_FRAME) → util band color →
   * Unity spawn_primitive cube (beam proxy). Not apply_mesh / full CAD.
   */
  const dropFeaBeamWorld = useCallback(async () => {
    if (!unityIframePresent()) {
      setWorkStatus('Industrial slice: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    setWorkStatus('Industrial slice: running engineering.runFEA (FEA_FRAME)…');
    const res = await runFeaBeamToWorld({ spawn: true });
    if (!res.ok) {
      setWorkStatus(`Industrial slice: FEA failed — ${res.error || 'unknown'}`);
      return;
    }
    const util = res.maxUtilization != null ? res.maxUtilization.toFixed(4) : '?';
    const band = res.band ?? '?';
    const hex = res.color?.hex ?? '?';
    if (res.spawnPosted) {
      reportCadAction(
        `Industrial slice LIVE: util=${util} band=${band} color=${hex} · spawn_primitive posted · ${res.spawnId || ''} (cube proxy — not apply_mesh)`,
        { action: 'fea_beam', util, band, hex, spawnId: res.spawnId || null },
      );
    } else {
      setWorkStatus(
        `Industrial slice: FEA util=${util} band=${band} — spawn skipped: ${res.error || 'iframe/post failed'}`,
      );
    }
  }, []);

  /**
   * Industrial mesh slice: engineering.partMesh (i-beam) → apply_mesh MeshFilter.
   * Optional FEA util tint. Not free-text CAD / GLB.
   */
  const dropPartMeshWorld = useCallback(async () => {
    if (!unityIframePresent()) {
      setWorkStatus('Mesh slice: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    setWorkStatus('Mesh slice: engineering.partMesh (i-beam) + apply_mesh…');
    const res = await runPartMeshToWorld({ kind: 'i-beam', spawn: true, colorFromFea: true });
    if (!res.ok) {
      setWorkStatus(`Mesh slice: failed — ${res.error || 'unknown'}`);
      return;
    }
    const verts = res.vertexCount ?? '?';
    const tris = res.triangleCount ?? '?';
    const hex = res.color?.hex ?? '?';
    const band = res.band ?? '?';
    if (res.applyPosted) {
      reportCadAction(
        `Mesh apply LIVE: kind=${res.kind} verts=${verts} tris=${tris} band=${band} color=${hex} · apply_mesh posted · ${res.applyId || ''}`,
        { action: 'part_mesh', kind: res.kind, verts, tris, band, hex, applyId: res.applyId || null },
      );
    } else {
      setWorkStatus(
        `Mesh slice: partMesh ok verts=${verts} — apply skipped: ${res.error || 'iframe/post failed'}`,
      );
    }
  }, []);

  /**
   * GLB URL → Unity glTFast under ConKayTemp. Same-origin public prop sample.
   * Not evo-asset.generate auto-wire — proves load_glb path only.
   */
  const loadGlbWorld = useCallback(() => {
    if (!unityIframePresent()) {
      setWorkStatus('GLB load: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    const id = `glb-${Date.now()}`;
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/models/prop/furniture_table.glb`
        : '/models/prop/furniture_table.glb';
    const ok = loadGlb(
      {
        url,
        name: 'furniture_table',
        position: { x: 0.5, y: 0, z: 0.5 },
        scale: 1,
      },
      id,
    );
    if (ok) reportCadAction(`GLB load: load_glb posted · ${id} · ${url} (wait glb_loaded)`, { action: 'load_glb', id, url });
    else setWorkStatus('GLB load: post failed');
  }, []);

  /**
   * evo-asset.generate → resolve URL → Unity load_glb.
   * Prompt must include archetype keyword (sword/spear/staff/mace/shield).
   * Honesty: archetypes only — not full free-text CAD.
   */
  const evoGlbToWorld = useCallback(async () => {
    if (!unityIframePresent()) {
      setWorkStatus('Evo GLB: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    const text = (nlpDesignText || '').trim() || 'steel sword';
    setEvoGlbBusy(true);
    setWorkStatus(`Evo GLB: generating “${text.slice(0, 48)}”…`);
    try {
      const res = await runEvoGlbToWorld({ text, waitMs: 20000 });
      if (!res.ok) {
        setWorkStatus(`Evo GLB: failed — ${res.error || 'unknown'}${res.glbUrl ? ` · ${res.glbUrl}` : ''}`);
        return;
      }
      reportCadAction(
        `Evo GLB LIVE: ${res.archetype} → ${res.glbUrl} · glb_loaded · ${res.loadId || ''} (archetypes only — not full CAD)`,
        { action: 'evo_glb', archetype: res.archetype, glbUrl: res.glbUrl, loadId: res.loadId || null },
      );
    } catch (e) {
      setWorkStatus(`Evo GLB: error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEvoGlbBusy(false);
    }
  }, [nlpDesignText]);

  /**
   * NLP CAD v1: free-text → deterministic intent → partMesh/FEA → apply_mesh.
   * Prefer POST /api/conkay/design; fall back to client parse + lensRun.
   */
  const buildNlpDesignWorld = useCallback(async (overrideText?: string) => {
    if (!unityIframePresent()) {
      setWorkStatus('NLP CAD: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    const text = (overrideText ?? nlpDesignText).trim();
    if (!text) {
      setWorkStatus('NLP CAD: enter a design prompt (e.g. steel I-beam 6m, 5kN midspan)');
      return;
    }
    setNlpBuilding(true);
    setWorkStatus(`NLP CAD: parsing “${text.slice(0, 64)}”…`);
    try {
      const res = await designViaApiOrClient({ text, spawn: true });
      if (!res.ok) {
        setWorkStatus(`NLP CAD: failed — ${res.error || 'unknown'}`);
        return;
      }
      const kind = res.intent?.meshKind ?? res.partMesh?.kind ?? '?';
      const span = res.intent?.spans?.[0];
      const util = res.fea?.maxUtilization != null ? res.fea.maxUtilization.toFixed(4) : (res.partMesh?.maxUtilization?.toFixed(4) ?? '?');
      const hex = res.fea?.color?.hex ?? res.partMesh?.color?.hex ?? res.applyPayload?.color ?? '?';
      if (res.applyPosted) {
        reportCadAction(
          `NLP CAD LIVE: “${text.slice(0, 40)}” → ${kind}${span != null ? ` ${span}m` : ''} util=${util} color=${hex} · apply_mesh · ${res.applyId || ''} (not industrial CAD suite / GLB)`,
          { action: 'nlp_design', kind, span: span ?? null, util, hex, applyId: res.applyId || null, prompt: text.slice(0, 120) },
        );
      } else {
        setWorkStatus(
          `NLP CAD: intent ok ${kind} — apply skipped: ${res.error || 'iframe/post failed'}`,
        );
      }
    } finally {
      setNlpBuilding(false);
    }
  }, [nlpDesignText]);

  /**
   * CAD Wave 1: assembly chat revise.
   * "build assembly" / "add beam …" / "move part X to x,y,z" → APIs → Unity apply_mesh/set_transform.
   * Honesty: ASSEMBLY LIVE — not full CAD suite.
   */
  const runAssemblyRevise = useCallback(async () => {
    if (!unityIframePresent()) {
      setWorkStatus('Assembly: no Unity iframe (open world lens with unity-webgl)');
      return;
    }
    const text = nlpDesignText.trim();
    if (!text) {
      setWorkStatus('Assembly: enter revise text (build assembly | add steel I-beam 6m | move part … to 2,1.2,0)');
      return;
    }
    setAssemblyBusy(true);
    setWorkStatus(`Assembly revise: “${text.slice(0, 56)}”…`);
    try {
      const res = await runAssemblyChatRevise({ text, assemblyId, syncUnity: true });
      if (!res.ok) {
        setWorkStatus(`Assembly: failed — ${res.error || 'unknown'}`);
        return;
      }
      if (res.assemblyId) setAssemblyId(res.assemblyId);
      const n = res.parts?.length ?? 0;
      reportCadAction(
        `ASSEMBLY LIVE: action=${res.action || '?'} parts=${n} id=${(res.assemblyId || '').slice(0, 8)}… · Unity synced (not full CAD suite)`,
        { action: 'assembly_revise', assemblyAction: res.action || null, parts: n, assemblyId: res.assemblyId || null },
      );
    } catch (e) {
      setWorkStatus(`Assembly: error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [nlpDesignText, assemblyId]);

  const runAssemblyUndoClick = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('Undo: no assembly yet — Asm revise first');
      return;
    }
    setAssemblyBusy(true);
    setWorkStatus('Assembly undo…');
    try {
      const res = await runAssemblyUndo({ assemblyId, syncUnity: true });
      if (!res.ok) {
        setWorkStatus(`Undo failed: ${res.error || 'error'}`);
        return;
      }
      const n = res.parts?.length ?? 0;
      reportCadAction(`UNDO LIVE: parts=${n} canRedo=${res.canRedo ? 'yes' : 'no'} · not parametric CAD history`, { action: 'assembly_undo', parts: n, canRedo: !!res.canRedo });
    } catch (e) {
      setWorkStatus(`Undo error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [assemblyId]);

  const runAssemblyRedoClick = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('Redo: no assembly yet — Asm revise first');
      return;
    }
    setAssemblyBusy(true);
    setWorkStatus('Assembly redo…');
    try {
      const res = await runAssemblyRedo({ assemblyId, syncUnity: true });
      if (!res.ok) {
        setWorkStatus(`Redo failed: ${res.error || 'error'}`);
        return;
      }
      const n = res.parts?.length ?? 0;
      reportCadAction(`REDO LIVE: parts=${n} canUndo=${res.canUndo ? 'yes' : 'no'} · not parametric CAD history`, { action: 'assembly_redo', parts: n, canUndo: !!res.canUndo });
    } catch (e) {
      setWorkStatus(`Redo error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [assemblyId]);

  const downloadAssemblyStl = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('STL: no assembly yet — Asm revise first (build assembly / add …)');
      return;
    }
    try {
      const r = await downloadStl({ assemblyId });
      reportCadAction(`STL download LIVE: ${r.filename} (${r.size} bytes) — Wave 2 export`, { action: 'export_stl', filename: r.filename, size: r.size });
    } catch (e) {
      setWorkStatus(`STL download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);


  const downloadAssemblyStep = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('STEP: no assembly yet — Asm revise first');
      return;
    }
    try {
      const r = await downloadStep({ assemblyId });
      reportCadAction(`STEP download LIVE: ${r.filename} (${r.size} bytes) — faceted AP214 (not OCC B-rep)`, { action: 'export_step', filename: r.filename, size: r.size });
    } catch (e) {
      setWorkStatus(`STEP download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);

  const downloadAssemblyBrep = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('B-rep: no assembly yet — Asm revise first');
      return;
    }
    try {
      const r = await downloadBrepStep({ assemblyId });
      reportCadAction(`OCC B-rep LIVE: ${r.filename} (${r.size} bytes) — advanced B-rep STEP (not SolidWorks)`, { action: 'export_brep', filename: r.filename, size: r.size });
    } catch (e) {
      setWorkStatus(`B-rep download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);

  const addFeatureDemo = useCallback(async () => {
    setAssemblyBusy(true);
    try {
      const partId = `ui_feat_${Date.now().toString(36)}`;
      const created = await occFeatureRebuild({
        partId,
        features: [
          { type: 'box', dx: 40, dy: 24, dz: 16 },
          { type: 'shell', thickness: 1.5 },
          { type: 'chamfer', distance: 0.4 },
          { type: 'union', tool: { type: 'cylinder', r: 4, h: 18, position: { x: 20, y: 12, z: -1 } } },
          { type: 'circular_pattern', count: 3, angle: 360, axis: 'z' },
          { type: 'revolve', angle: 360, sketch: { type: 'rect', x: 2, y: 0, w: 2, h: 4 }, position: { x: 0, y: -40, z: 0 } },
        ],
        mesh_summary_only: true,
      });
      if (!created?.ok) {
        setWorkStatus(`Add feature failed — ${created?.reason || created?.error || 'unknown'}`);
        return;
      }
      const listed = await occFeatureList(partId);
      reportCadAction(`Add feature LIVE (industrial): part=${partId} ops=${(created.notes || []).join(',')} features=${listed?.count ?? created.featureCount} advanced=${!!created.export?.advanced_brep} — not SolidWorks UI parity`, { action: 'add_feature' });
    } catch (e) {
      setWorkStatus(`Add feature failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, []);

  const industrialMateSolveDemo = useCallback(async () => {
    setAssemblyBusy(true);
    try {
      const out = await mateSolveDof({
        bodies: [
          { id: 'cylA', kind: 'cylinder', params: { r: 5, h: 30 }, position: { x: 0, y: 0, z: 0 }, fixed: true },
          { id: 'cylB', kind: 'cylinder', params: { r: 5, h: 30 }, position: { x: 12, y: 8, z: 2 }, rotation: { rz_deg: 8 }, lock: ['rx', 'ry'] },
          { id: 'plate', kind: 'plate', params: { dx: 40, dy: 40, dz: 4 }, position: { x: -10, y: -10, z: 45 }, lock: ['rx', 'ry', 'rz'] },
        ],
        mates: [
          { type: 'concentric', a: 0, b: 1 },
          { type: 'distance', a: 0, b: 2, axis: 'z', distance: 22, centered: true },
          { type: 'parallel', a: 0, b: 1, on: 'axis' },
        ],
        tol_mm: 0.001,
        tol_rad: 0.001,
        include_mesh: false,
      });
      {
        const mateLine = out?.pass
          ? `Industrial mate-solve-dof LIVE: bodies=${out.bodyCount} residual_max=${out?.remeasure_after_trsf?.max_abs ?? out?.residual?.max_abs} (gp_Trsf; not AABB snap)`
          : `Industrial mate-solve-dof FAIL — ${out?.reason || out?.error || 'residual above tol'}`;
        if (out?.pass) {
          reportCadAction(mateLine, {
            action: 'mate_solve_dof',
            bodyCount: out.bodyCount,
            residual_max: out?.remeasure_after_trsf?.max_abs ?? out?.residual?.max_abs,
          });
        } else {
          setWorkStatus(mateLine);
        }
      }
    } catch (e) {
      setWorkStatus(`Mate-solve-dof failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, []);

  const digitalGdtDemo = useCallback(async () => {
    setAssemblyBusy(true);
    try {
      const out = await gdtDigital({
        features: [
          { type: 'box', dx: 40, dy: 30, dz: 20 },
          { type: 'cut', tool: { type: 'cylinder', r: 5, h: 30, position: { x: 20, y: 15, z: -5 } } },
        ],
        checks: [
          { type: 'flatness', tol: 0.05 },
          { type: 'perpendicularity', tol: 0.5 },
          { type: 'position', tol: 0.1, mode: 'cylinder_axis', axes: 'xy', nominal: { x: 20, y: 15, z: -5 } },
          { type: 'cylindricity', tol: 0.05 },
        ],
      });
      {
        const gdtLine = out?.pass
          ? `Digital GD&T LIVE: harness=${out.harness} checks=${(out.checks || []).map((c: any) => c.type + ':' + (c.pass ? 'PASS' : 'FAIL')).join(',')} — NOT ISO CMM / ISO 17025`
          : `Digital GD&T FAIL — ${out?.reason || 'check failed'} (still not physical CMM)`;
        if (out?.pass) reportCadAction(gdtLine, { action: 'gdt_digital', harness: out.harness, checks: (out.checks || []).map((c: any) => ({ type: c.type, pass: !!c.pass })) });
        else setWorkStatus(gdtLine);
      }
    } catch (e) {
      setWorkStatus(`Digital GD&T failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, []);

  const industrialCertDemo = useCallback(async () => {
    try {
      const st = await fetchOccStatus();
      const cmds = Array.isArray(st?.commands) ? st.commands : [];
      const has = ['mate-solve-dof', 'gdt-digital', 'sketch-solve'].every((c) => cmds.includes(c) || cmds.includes(c.replace(/-/g, '_')));
      let sketchNote = '';
      try {
        const sk = await sketchSolve({
          sketch: {
            points: [
              { id: 'p0', x: 0, y: 0 },
              { id: 'p1', x: 12, y: 0.5 },
              { id: 'p2', x: 11, y: 8 },
              { id: 'p3', x: 0.2, y: 7.5 },
            ],
            locked: ['p0.x', 'p0.y'],
            segments: [
              { type: 'line', a: 'p0', b: 'p1' },
              { type: 'line', a: 'p1', b: 'p2' },
              { type: 'line', a: 'p2', b: 'p3' },
              { type: 'line', a: 'p3', b: 'p0' },
            ],
            constraints: [
              { type: 'horizontal', a: 'p0', b: 'p1' },
              { type: 'vertical', a: 'p0', b: 'p3' },
            ],
            dimensions: [{ a: 'p0', b: 'p1', value: 16, axis: 'x' }],
          },
          distance: 8,
          mesh_summary_only: true,
        });
        sketchNote = sk?.pass ? ` sketch-solve=PASS` : ` sketch-solve=FAIL`;
      } catch {
        sketchNote = ' sketch-solve=ERR';
      }
      {
        const certLine = has
          ? `INDUSTRIAL_CLASS probe LIVE: OCC ok=${!!st?.ok} cmds=mate-solve-dof|gdt-digital|sketch-solve${sketchNote} — run scripts/conkay-industrial-class-cert.mjs for CERTIFIED (NOT SolidWorks UI / NOT ISO 17025 CMM)`
          : `INDUSTRIAL_CLASS probe incomplete — OCC ok=${!!st?.ok}; missing industrial cmds${sketchNote}`;
        if (has) reportCadAction(certLine, { action: 'industrial_cert', occOk: !!st?.ok, sketchNote });
        else setWorkStatus(certLine);
      }
    } catch (e) {
      setWorkStatus(`Industrial cert probe failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const rebuildSolidDemo = useCallback(async () => {
    setAssemblyBusy(true);
    try {
      // Prefer assembly part with featureTree; else demo rebuild
      let usedAssembly = false;
      if (assemblyId) {
        const partsRes = await listParts(assemblyId);
        const parts = partsRes?.parts || partsRes || [];
        const withTree = Array.isArray(parts) ? parts.find((p: any) => p?.meta?.featureTree?.length) : null;
        if (withTree?.id) {
          const out = await rebuildPartSolid(assemblyId, withTree.id, {});
          if (out?.ok) {
            usedAssembly = true;
            reportCadAction(
              `Rebuild solid LIVE: part=${withTree.id} solids=${out.solids} tris=${out.mesh?.triangleCount ?? '?'} advanced=${!!out.export?.advanced_brep}`,
              { action: 'rebuild_solid', partId: withTree.id, solids: out.solids, tris: out.mesh?.triangleCount ?? null, advanced: !!out.export?.advanced_brep },
            );
          }
        }
      }
      if (!usedAssembly) {
        const out = await occFeatureRebuild({
          partId: 'ui_rebuild_demo',
          features: [
            { type: 'box', dx: 40, dy: 30, dz: 20 },
            { type: 'cut', tool: { type: 'cylinder', r: 5, h: 30, position: { x: 20, y: 15, z: -5 } } },
            { type: 'fillet', radius: 1 },
          ],
          mesh_summary_only: true,
        });
        if (!out?.ok) {
          setWorkStatus(`Rebuild solid failed — ${out?.reason || out?.error || 'unknown'}`);
          return;
        }
        reportCadAction(
          `Rebuild solid LIVE: demo tris=${out.mesh?.triangleCount ?? '?'} advanced=${!!out.export?.advanced_brep} — Unity apply via mesh path`,
          { action: 'rebuild_solid', mode: 'demo', tris: out.mesh?.triangleCount ?? null, advanced: !!out.export?.advanced_brep },
        );
      }
    } catch (e) {
      setWorkStatus(`Rebuild solid failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [assemblyId]);

  const showCertStatus = useCallback(async () => {
    try {
      const st = await fetchOccStatus();
      reportCadAction(
        `OCC cert probe: ok=${!!st?.ok} kernel=${st?.kernel || '?'} — SOLID WORLD + INDUSTRIAL_CLASS via scripts/conkay-industrial-class-cert.mjs (digital ASME harness; NOT ISO 17025 CMM; NOT SolidWorks UI parity)`,
        { action: 'solid_cert', occOk: !!st?.ok, kernel: st?.kernel || null },
      );
    } catch (e) {
      setWorkStatus(`OCC status failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const downloadBomJson = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('BOM: no assembly yet — Asm revise first');
      return;
    }
    try {
      const r = await downloadAssemblyBom(assemblyId);
      if (!r.ok) {
        setWorkStatus(`BOM failed — ${r.error}`);
        return;
      }
      reportCadAction(`BOM download LIVE: ${r.filename} parts=${r.bom?.totalParts ?? '?'} — Wave 2`, { action: 'export_bom', filename: r.filename, totalParts: r.bom?.totalParts ?? null });
    } catch (e) {
      setWorkStatus(`BOM download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);

  const exportErpBom = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('ERP BOM: no assembly yet — build/revise an assembly first');
      return;
    }
    try {
      const r = await downloadErpBomJson(assemblyId);
      if (!r.ok) {
        setWorkStatus(`ERP BOM failed — ${r.error || 'unknown'}`);
        return;
      }
      const csv = await downloadErpBomCsv(assemblyId);
      reportCadAction(
        `ERP BOM LIVE: ${r.filename}${csv.ok ? ` + ${csv.filename}` : ''} parts=${r.bom?.totalParts ?? '?'} rollup=$${Number(r.bom?.rollup?.rollupCostUsd ?? 0).toFixed(2)} — not SAP/Oracle`,
        {
          action: 'export_erp_bom',
          filename: r.filename,
          csv: csv.ok ? csv.filename : null,
          totalParts: r.bom?.totalParts ?? null,
          rollupCostUsd: r.bom?.rollup?.rollupCostUsd ?? null,
        },
      );
    } catch (e) {
      setWorkStatus(`ERP BOM failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);


  const downloadAssemblyDrawingSvg = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('Drawing: no assembly yet — Asm revise first');
      return;
    }
    try {
      const r = await downloadAssemblyDrawing(assemblyId);
      reportCadAction(`DRAWING LIVE: ${r.filename} (${r.size} bytes) — orthographic SVG (not drafting CAD)`, { action: 'export_drawing', filename: r.filename, size: r.size });
    } catch (e) {
      setWorkStatus(`Drawing download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);

  const downloadAssemblyDrawingPdfClick = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('PDF: no assembly yet — Asm revise first');
      return;
    }
    try {
      const r = await downloadAssemblyDrawingPdf(assemblyId);
      reportCadAction(`PDF PACK LIVE: ${r.filename} (${r.size} bytes) — 3 views + title/BOM (not CMM GD&T)`, { action: 'export_pdf', filename: r.filename, size: r.size });
    } catch (e) {
      setWorkStatus(`PDF download failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [assemblyId]);

  const explodeAssemblyClick = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('Explode: no assembly yet — Asm revise first');
      return;
    }
    setAssemblyBusy(true);
    try {
      const out = await explodeAssemblyApi(assemblyId, 1);
      if (!out?.ok) {
        setWorkStatus(`Explode failed — ${out?.error || 'unknown'}`);
        return;
      }
      const n = out.updates?.length ?? out.parts?.length ?? 0;
      reportCadAction(`EXPLODE LIVE: factor=1 parts=${n} COM-centroid deltas — undoable · Unity set_transform/redraw`, { action: 'explode', parts: n, factor: 1 });
    } catch (e) {
      setWorkStatus(`Explode error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [assemblyId]);



  useEffect(() => {
    if (!assemblyId) return;
    void (async () => {
      try {
        const m = await fetchMaterials();
        if (m?.ok && Array.isArray(m.materials)) setMaterialsList(m.materials);
      } catch {
        /* catalog optional */
      }
    })();
  }, [assemblyId]);

  const attachMaterialClick = useCallback(async () => {
    if (!assemblyId) {
      setWorkStatus('Material: no assembly yet — Asm revise first');
      return;
    }
    setAssemblyBusy(true);
    try {
      const partsRes = await listParts(assemblyId);
      const parts = partsRes?.parts || [];
      if (!parts.length) {
        setWorkStatus('Material: assembly has no parts');
        return;
      }
      const part = parts[parts.length - 1];
      const out = await attachPartMaterial(assemblyId, part.id, materialPicker);
      if (!out?.ok) {
        setWorkStatus(`Material attach failed — ${out?.error || 'unknown'}`);
        return;
      }
      reportCadAction(`MATERIAL LIVE: ${out.material?.id || materialPicker} → part ${part.name || part.id.slice(0, 8)} (library attach — not FEM model)`, { action: 'attach_material', materialId: out.material?.id || materialPicker, partId: part.id });
    } catch (e) {
      setWorkStatus(`Material error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssemblyBusy(false);
    }
  }, [assemblyId, materialPicker]);









  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, steps, workStatus]);

  // ── honest event spine ──────────────────────────────────────────────
  // The ONE rule: every animated beat is a pure function of a REAL backend
  // event. While ConKay is open we subscribe to the macro lifecycle the server
  // emits to our user:<id> room and bind a step (keyed by the run's correlation
  // id) to it: it lights when the backend reports the call *started* and
  // resolves when it reports *completed* — with the real elapsed ms. No
  // setInterval, no eased fake percentage. If the socket is offline the step
  // simply never appears; the await-bound choreography below still tells the
  // story (also real — the call literally returned).
  useEffect(() => {
    if (!open) return;
    connectSocket();
    const offStart = subscribe<{ runId?: string; domain?: string; action?: string }>(
      'macro:started',
      (d) => {
        if (!d?.runId || d.runId !== liveRunRef.current) return;
        const label = `Running ${d.domain ?? '?'}.${d.action ?? '?'} on the backend`;
        setWorkStatus(`Backend running ${d.domain ?? '?'}.${d.action ?? '?'}…`);
        setSteps((prev) =>
          prev.some((s) => s.id === d.runId)
            ? prev
            : [...prev, { id: d.runId!, label, state: 'active' as const }],
        );
        // Feed the honest HUD store (its ONLY writer) — the scene's rings spin
        // iff a real macro is in flight; this is that signal.
        useConkayHudStore.getState().macroStarted({ runId: d.runId, domain: d.domain, action: d.action });
      },
    );
    // Mid-flight beat: a real `macro:stage` the backend macro emits when it
    // reaches a genuine sub-step (e.g. reason.verify → resolving_citations →
    // judging). Honest by construction — it only fires from real handler
    // progress, never a timer; the store ignores stages with no live run.
    const offStage = subscribe<{ runId?: string; stage?: string; detail?: string }>(
      'macro:stage',
      (d) => {
        if (!d?.runId || d.runId !== liveRunRef.current || !d.stage) return;
        const pretty = String(d.stage).replace(/_/g, ' ');
        setWorkStatus(`Backend: ${pretty}${d.detail ? ` — ${d.detail}` : ''}…`);
        useConkayHudStore.getState().macroStage({ runId: d.runId, stage: d.stage, detail: d.detail });
      },
    );
    const offDone = subscribe<{ runId?: string; domain?: string; action?: string; ok?: boolean; ms?: number; error?: string }>(
      'macro:completed',
      (d) => {
        if (!d?.runId || d.runId !== liveRunRef.current) return;
        const failed = d.ok === false;
        const ms = typeof d.ms === 'number' ? ` in ${d.ms} ms` : '';
        const label = `${d.domain ?? '?'}.${d.action ?? '?'} ${failed ? 'failed' : 'completed'}${ms}`;
        setSteps((prev) =>
          prev.map((s) => (s.id === d.runId ? { ...s, state: failed ? ('error' as const) : ('done' as const), label } : s)),
        );
        setWorkStatus(failed ? 'Backend returned an error' : `Completed${ms}`);
        // Telemetry the HUD shows is the REAL returned facts (ok + elapsed ms).
        useConkayHudStore.getState().macroCompleted({ runId: d.runId, domain: d.domain, action: d.action, ok: d.ok, ms: d.ms });
      },
    );
    // Honest disconnect grace period (Unit F10): a HARD backend death drops the
    // socket without a clean `macro:completed`, which would otherwise leave
    // `inFlight` stuck non-zero and the scene's rings spinning forever. The
    // socket layer only fires this after the grace period elapses with no
    // reconnect (a transient blip cancels it), so a real "kill the server
    // mid-run" clears in-flight state and flags WHY — all motion stops, honestly.
    const offLost = onConnectionLost(() => useConkayHudStore.getState().markConnectionLost());
    // A reconnect clears the connection-lost flag; real macro:* events resume
    // driving the rings from there.
    const offReconnected = onReconnected(() => useConkayHudStore.getState().markReconnected());
    // Resetting on teardown clears any in-flight count so the rings never spin
    // after ConKay closes (no orphaned "work" with nothing running).
    return () => { offStart(); offStage(); offDone(); offLost(); offReconnected(); useConkayHudStore.getState().reset(); };
  }, [open]);

  const append = useCallback((m: OverlayMsg) => setMessages((prev) => [...prev, m]), []);

  // Work-step helpers — set the plan, then advance each step's state as ConKay
  // works. `setStep` flips one step; `beginWork`/`clearWork` bracket a task.
  const beginWork = useCallback((status: string, plan: WorkStep[]) => { setWorkStatus(status); setSteps(plan); }, []);
  const setStep = useCallback((id: string, state: WorkStep['state'], status?: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, state } : s)));
    if (status) setWorkStatus(status);
  }, []);
  const clearWork = useCallback(() => { setTimeout(() => { setSteps([]); setWorkStatus(''); }, 1400); }, []);

  // Unit A2 — the gate itself. Resolves immediately (true) for a macro
  // `isMutatingMacro` doesn't flag as a write — reads run instantly, never
  // gated. For a mutating macro it renders <ConKayActionConfirm> with the
  // REAL proposed call and suspends until the user clicks Run it (resolve
  // true) or Cancel (resolve false); only one confirm can be pending at a
  // time (the `running` gate in `submit()` already serializes macro calls).
  const confirmIfMutating = useCallback((domain: string, macro: string, inputObj: Record<string, unknown>): Promise<boolean> => {
    if (!isMutatingMacro(domain, macro)) return Promise.resolve(true);
    setWorkStatus('Waiting for your confirmation…');
    return new Promise<boolean>((resolve) => {
      pendingConfirmResolveRef.current = resolve;
      setPendingConfirm({ domain, macro, input: inputObj });
    });
  }, [setWorkStatus]);
  const resolvePendingConfirm = useCallback((confirmed: boolean) => {
    const resolve = pendingConfirmResolveRef.current;
    pendingConfirmResolveRef.current = null;
    setPendingConfirm(null);
    resolve?.(confirmed);
  }, []);

  // ── verification climax (Track B / Phase 1) ──────────────────────────
  // Run a reply's citations through the REAL reason.verify macro and stamp the
  // verdict onto the message — so the TrustBadge shows the actual verification
  // result (citations resolve / grounded / unsupported / fabricated_citation),
  // never a heuristic guess. "Verification IS the product." Rides the honest
  // event spine (a runId) like any other macro call; degrades silently to the
  // heuristic badge if the macro is unavailable.
  const verifyMessage = useCallback(async (
    msgId: string,
    claim: string,
    citationIds: string[],
    // The full DTU refs the claim was cited against, in the same shape ConKay
    // skills already attach to messages (id/title/tier/content) — passed
    // through so the HUD store's `runDtuRefs` mirrors the real refs this call
    // checks, never a re-derivation. Optional: callers that only have bare
    // ids (none currently do) still get a working verdict, just an empty
    // refs mirror. `content` (R8/CL3 gap fix) is the DTU's real body text
    // when the producing path has it — see conkay-skills.ts's
    // `ConKaySkillResult.dtuRefs` doc comment; null/absent is an honest
    // "no body text available", never fabricated.
    dtuRefs: Array<{ id: string; title: string | null; tier: string | null; content?: string | null }> = [],
    // The user's original question that prompted this reply — passed through
    // to reason.evaluate_answer's answer-relevancy axis. Optional/null: an
    // absent question still lets faithfulness/context-precision run, just
    // without a relevancy score (evaluateAnswer degrades that axis honestly).
    question: string | null = null,
  ) => {
    // Run when there are citations to check OR when the claim is proof-amenable
    // (so the Z3 gate can fire and earn "Proven ✓" even for an uncited theorem).
    if (!citationIds.length && !looksProvable(claim)) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: 'pending' } : m)));
    try {
      const rid = newRunId();
      liveRunRef.current = rid;
      const { data } = await lensRun('reason', 'verify', { claim, citations: citationIds }, rid);
      const res = data?.result as { verdict?: string; mode?: string; confidence?: number | null } | null;
      const verdict = res && typeof res === 'object' && res.verdict ? String(res.verdict) : 'unverified';
      // Phase 4 — carry the REAL multibrain signals (how the verdict was reached +
      // the council/proof confidence) so the badge can surface the judging honestly.
      const mode = res && typeof res.mode === 'string' ? res.mode : undefined;
      const confidence = res && typeof res.confidence === 'number' ? res.confidence : null;
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: verdict, verifyMode: mode, verifyConfidence: confidence } : m)));
      // Unit F2 — mirror the same real verdict + the refs it was checked against
      // into the HUD store, for the upcoming K3 cockpit panels. This is the one
      // documented exception to "socket adapter only" (see the store's header):
      // still the single legitimate producer of a verify result, not a new site.
      useConkayHudStore.getState().setLastVerify({ verdict, mode: mode ?? null, confidence });
      useConkayHudStore.getState().setRunDtuRefs(dtuRefs);

      // ── Grounded research mode (V1.1 R3) ────────────────────────────────
      // Alongside (never replacing) the citation-only check above, run the
      // reply's OWN ANSWER TEXT through the RAGAS-shaped reason.evaluate_answer
      // harness — a real, independent backend call gets its own run id so the
      // HUD's macro:started/completed telemetry tags it as its own step. Its
      // own try/catch: a failure here must never blank out the verifyVerdict
      // badge that already landed above, and must never synthesize a fake
      // verdict — on any error/timeout `capabilityVerdict` simply stays
      // unset, so CapabilityBadge renders its own honest "Unverified" tier.
      try {
        const evalRid = newRunId();
        liveRunRef.current = evalRid;
        const { data: evalData } = await lensRun('reason', 'evaluate_answer', {
          answer: claim,
          question: question || null,
          retrievedDtus: dtuRefs,
          citations: citationIds,
        }, evalRid);
        const evalResult = evalData?.result as EvalAnswerResult | undefined;
        const capabilityVerdict = toCapabilityVerdictClient(evalResult);
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, capabilityVerdict } : m)));
      } catch {
        // evaluate_answer unavailable → the verifyVerdict badge set above is
        // untouched; capabilityVerdict gets the same honest `{ ok: false }`
        // sentinel toCapabilityVerdictClient would have produced from a
        // failed result, so CapabilityBadge renders "Unverified" rather than
        // being silently skipped — a check WAS attempted, this says so.
        setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, capabilityVerdict: { ok: false } } : m)));
      }
    } catch {
      // verification unavailable → drop the pending state, fall back to the heuristic badge
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, verifyVerdict: undefined } : m)));
    }
  }, []);

  // Persist a revisitable artifact of what ConKay did — the task + its work +
  // result — as a DTU in the user's locker (fire-and-forget; never blocks the UX).
  // "show its work and the task it was provided" → a real, reopenable record.
  const persistArtifact = useCallback((title: string, work: Record<string, unknown>) => {
    // Shared mint helper (same POST /api/dtus shape); fire-and-forget — never blocks UX.
    void mintConkayArtifactDtu({
      title,
      work: { channel: 'chat', ...work },
      tags: ['conkay', 'artifact', work.lens ? `lens:${work.lens}` : ''].filter(Boolean) as string[],
    });
  }, []);

  // ── voice ───────────────────────────────────────────────────────────
  const voice = useConKayVoice({
    enabled: open,
    muted,
    onFinalTranscript: (t) => submit(t),
  });

  // ── CK2 attention bridge (voice) ──────────────────────────────────────
  // Mirror the REAL STT/TTS booleans `useConKayVoice` already tracks (see
  // that hook's own honesty note on `speaking`/`ttsAmplitudeRef`) into the
  // same attention store the open/busy mirror above writes to — never a
  // re-derivation, just the two extra real fields the widget needs.
  useEffect(() => {
    useConkayAttentionStore.getState().setVoiceListening(voice.listening);
  }, [voice.listening]);
  useEffect(() => {
    useConkayAttentionStore.getState().setVoiceSpeaking(voice.speaking);
  }, [voice.speaking]);

  // Speak each new assistant reply once (fence stripped so no JSON read aloud).
  useEffect(() => {
    if (!open) return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!last || last.id === spokeRef.current) return;
    spokeRef.current = last.id;
    if (!muted) voice.speak(stripFence(last.content));
  }, [messages, open, muted, voice]);

  // Greeting on summon.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (!open) { greetedRef.current = false; return; }
    if (greetedRef.current) return;
    greetedRef.current = true;
    const where = lens && !onChatLens ? ` I'm on the ${lens.name} lens with you — tell me what to do, or say "brief me".` : " Ask me anything, or say \"brief me\".";
    if (!muted) voice.speak(`${CONKAY_SIGNATURE_GREETING}${where}`);
  }, [open, lens, onChatLens, muted, voice]);

  const conkayState: ConKayState =
    running ? 'processing'
      : voice.speaking ? 'presenting'
        : voice.listening ? 'listening'
          : 'idle';

  // ── run a global skill ──────────────────────────────────────────────
  const runSkill = useCallback(async (text: string, match: { skill: ConKaySkill; args: Record<string, string> }) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: text });
    setInput('');
    setRunning(true);
    beginWork(`Understood — ${match.skill.label}`, [
      { id: 'parse', label: `Recognised: ${match.skill.label}`, state: 'done' },
      { id: 'gather', label: 'Gathering from your data…', state: 'active' },
      { id: 'render', label: 'Rendering the result', state: 'pending' },
    ]);
    try {
      const result = await match.skill.run(match.args, {
        apiBase: getApiBase(),
        fetchJson: async (path: string) => {
          try {
            const r = await fetch(`${getApiBase()}${path}`, { credentials: 'include' });
            return await r.json();
          } catch { return null; }
        },
        // Lets a skill delegate to a real deterministic backend engine (e.g. the
        // math CAS) via the unified macro contract instead of LLM-reasoning.
        // Each delegated call opts into the honest lifecycle so the spine binds
        // to the REAL backend macro:started/completed for that computation.
        runMacro: async (domain: string, name: string, input: Record<string, unknown>) => {
          try {
            const rid = newRunId();
            liveRunRef.current = rid;
            const { data } = await lensRun(domain, name, input, rid);
            return data;
          } catch { return null; }
        },
      });
      setStep('gather', 'done', 'Composing the answer');
      setStep('render', 'active');
      const fence = result.viz ? `\n\n\`\`\`conkay-viz\n${JSON.stringify(result.viz)}\n\`\`\`` : '';
      const aid = `a-${Date.now()}`;
      append({ id: aid, role: 'assistant', content: `${result.spoken}${fence}`, dtuRefs: result.dtuRefs, sources: result.sources, toolCalls: result.toolCalls, brain: 'kay' });
      setStep('render', 'done', 'Done');
      // Phase 1: verify the cited DTUs through the real reason.verify macro.
      const citeIds = (result.dtuRefs || []).map((d) => d.id).filter(Boolean);
      if (citeIds.length || looksProvable(result.spoken)) verifyMessage(aid, result.spoken, citeIds, result.dtuRefs || [], text);
      persistArtifact(`Skill: ${match.skill.label}`, { task: text, skill: match.skill.id, spoken: result.spoken, viz: result.viz ?? null });
      if (result.navigate) { const dest = result.navigate; setTimeout(() => { window.location.href = dest; }, 900); }
    } catch {
      setStep('render', 'error', 'Hit a snag');
      append({ id: `a-${Date.now()}`, role: 'assistant', content: 'I hit a snag running that — mind trying again?' });
    } finally {
      setRunning(false);
      clearWork();
    }
  }, [append, persistArtifact, beginWork, setStep, clearWork, verifyMessage]);

  // ── execute a lens macro (shared by explicit "run X" + the NL resolver) ──
  // Unit A2: this is the CLIENT-INITIATED path — the client itself decides
  // to call `/api/lens/run` (via `lensRun` below), so a pre-execution
  // confirm here genuinely runs BEFORE the mutation, unlike the server-side
  // agent-loop path (see the honesty note at chatWithBrain's tool_call
  // handling further down). The confirm gate runs FIRST, before the preface
  // is even appended — narrating "On it — running X" ahead of a confirm the
  // user hasn't given yet would be a small dishonesty in itself.
  const executeMacro = useCallback(async (domain: string, macro: string, inputObj: Record<string, unknown>, preface?: string) => {
    const allowed = await confirmIfMutating(domain, macro, inputObj);
    if (!allowed) {
      append({ id: `a-${Date.now()}-cancelled`, role: 'assistant', content: `Cancelled — I didn't run ${domain}.${macro}.`, brain: 'kay' });
      return false;
    }
    if (preface) append({ id: `a-${Date.now()}-p`, role: 'assistant', content: preface, brain: 'kay' });
    try {
      // Opt into the honest lifecycle: the server will emit macro:started/
      // completed tagged with this id to our room, lighting the spine step.
      const rid = newRunId();
      liveRunRef.current = rid;
      const { data } = await lensRun(domain, macro, inputObj, rid);
      const ok = !!data?.ok;
      // Forward-Sim substrate (F7): a real engineering.runFEA solve is the one
      // completed-run payload the Forward-Sim panel embeds. This is the sole
      // site where the REAL solver return AND its input model both exist, so
      // mirror the reshaped result into the HUD store here (feaResultFromRun
      // returns null unless both halves are real — no fabrication).
      if (ok && domain === 'engineering' && macro === 'runFEA') {
        const fea = feaResultFromRun(inputObj, data?.result);
        if (fea) useConkayHudStore.getState().setLastFea(fea);
      }
      // Artifact→3D substrate (F9/K5): the SAME honest capture point, generalized
      // across macro kinds. Run the real return through the pure `detectArtifact`
      // registry; if it normalizes to a real ConkayArtifact (ar.render scene /
      // runFEA solve / foundry.preview world / forge.sandbox app / a
      // building-shaped result), mirror it into the store for the cockpit's
      // Artifact Viewer panel. detectArtifact returns null unless the result
      // genuinely matches a kind's real shape — no fabrication. This is ADDITIVE
      // to the FEA block above (which stays as-is for the untouched ForwardSimPanel);
      // a runFEA run populates BOTH from the same pure feaResultFromRun.
      if (ok) {
        const artifact = detectArtifact(domain, macro, inputObj, data?.result);
        if (artifact) useConkayHudStore.getState().setLastArtifact(artifact);
      }
      if (ok) {
        // LIVE stub: tell Unity iframe something happened (no-op if iframe absent).
        // No automatic spawn_primitive — mesh happy-paths use apply_mesh/load_glb/set_transform.
        // F0 cube markers only via explicit Drop-marker / FEA-proxy buttons.
        postUnityCmd('notify', {
          source: 'conkay',
          domain,
          macro,
          ok: true,
        });
      }
      const resultStr = data?.result != null ? JSON.stringify(data.result, null, 2) : (ok ? '(done)' : (data?.error || 'no result'));
      const spoken = ok ? `Done — ran ${macro} on the ${domain} lens.` : `${macro} on ${domain} returned: ${data?.error || 'an error'}.`;
      const body = resultStr.length > 1200 ? resultStr.slice(0, 1200) + '\n…' : resultStr;
      append({
        id: `a-${Date.now()}`, role: 'assistant',
        content: `${spoken}\n\n\`\`\`json\n${body}\n\`\`\``,
        toolCalls: [{ tool: `${domain}.${macro}`, params: inputObj, result: data?.result ?? null, ok }],
        brain: 'kay',
      });
      // Persist a revisitable artifact of the task + its work to the DTU locker.
      persistArtifact(`Operated ${domain}.${macro}`, {
        task: preface || `run ${domain}.${macro}`,
        lens: domain, macro, input: inputObj, ok, result: data?.result ?? null,
      });
      return ok;
    } catch {
      append({ id: `a-${Date.now()}`, role: 'assistant', content: `I couldn't run ${domain}.${macro} just now.` });
      return false;
    }
  }, [append, persistArtifact, confirmIfMutating]);

  const runLensMacro = useCallback(async (domain: string, macro: string, inputObj: Record<string, unknown>) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: `run ${domain}.${macro}` });
    setInput('');
    setRunning(true);
    try { await executeMacro(domain, macro, inputObj); } finally { setRunning(false); }
  }, [append, executeMacro]);

  // ── NL → lens macro: the "operate by speaking" path (needs the brains) ──
  // Conscious brain maps the request onto ONE of the lens' REAL macros (from
  // /api/lens-actions/:domain) and emits {macro,input}; ConKay executes it via
  // the real macro contract, narrates while it works, and files an artifact.
  const resolveAndOperate = useCallback(async (text: string, domain: string, lensName: string) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: text });
    setInput('');
    setRunning(true);
    beginWork(`Working on the ${lensName} lens…`, [
      { id: 'read', label: `Reading ${lensName} actions`, state: 'active' },
      { id: 'choose', label: 'Choosing the right action', state: 'pending' },
      { id: 'run', label: 'Running it', state: 'pending' },
      { id: 'render', label: 'Rendering the result', state: 'pending' },
    ]);
    try {
      const base = getApiBase();
      let actions: string[] = [];
      try {
        const r = await fetch(`${base}/api/lens-actions/${encodeURIComponent(domain)}`, { credentials: 'include' });
        const j = await r.json();
        actions = Array.isArray(j?.actions) ? j.actions.map((a: { name?: string } | string) => (typeof a === 'string' ? a : a?.name)).filter(Boolean) : [];
      } catch { /* no actions surface */ }
      setStep('read', 'done'); setStep('choose', 'active', 'Asking the conscious brain to choose…');
      const prompt = [
        `You are ConKay operating the "${lensName}" lens inside Concord.`,
        `Available macros for this lens (domain "${domain}"): ${actions.length ? actions.join(', ') : '(unknown — infer a reasonable one)'}.`,
        `The user said: "${text}".`,
        `Choose the single best macro and the JSON input it needs.`,
        `Respond with ONLY a JSON object: {"macro":"<name>","input":{...}} — or {"macro":null} if none fits.`,
      ].join('\n');
      let macro: string | null = null;
      let inputObj: Record<string, unknown> = {};
      try {
        const r = await fetch(`${base}/api/brain/conscious`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: prompt }),
        });
        const j = await r.json();
        const m = String(j?.reply || '').match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (parsed && typeof parsed.macro === 'string') { macro = parsed.macro; inputObj = (parsed.input && typeof parsed.input === 'object') ? parsed.input : {}; }
        }
      } catch { /* brains offline */ }
      if (macro) {
        setStep('choose', 'done', `Running ${macro}`); setStep('run', 'active');
        await executeMacro(domain, macro, inputObj, `On it — running ${macro} on the ${lensName} lens.`);
        setStep('run', 'done'); setStep('render', 'done', 'Done');
      } else {
        setStep('choose', 'error', 'Could not map that to an action');
        append({
          id: `a-${Date.now()}`, role: 'assistant',
          content: actions.length
            ? `I couldn't map that to a ${lensName} action right now (the brains may be offline). This lens exposes: ${actions.slice(0, 12).join(', ')}${actions.length > 12 ? '…' : ''}. You can also say "run <action>".`
            : `I need the brains online to operate the ${lensName} lens by voice. For now, say "run <action>", or ask me to "brief me" / "search my archive for …".`,
          brain: 'kay',
        });
      }
    } finally {
      setRunning(false);
      clearWork();
    }
  }, [append, executeMacro, beginWork, setStep, clearWork]);

  // ── free-form conversation → the real agent-loop pipeline ────────────────
  // The actual "falls through to the normal chat pipeline" behavior the
  // skills doc promises (see conkay-skills.ts header comment) — previously
  // this path didn't exist at all; any message that wasn't a skill phrase or
  // an operable-lens command silently dead-ended into a canned "try brief me…"
  // reply, EVEN when the brains were fully online.
  //
  // Routes through /api/chat-agent/stream — the SAME runAgentLoop tool-use
  // pipeline agent-marathon sessions use (web_search, run_compute, browse_url,
  // run_lens_action, create_dtu, expert_mode, generate_image, mcp_call,
  // mcp_list) — not a plain single-turn LLM call. SSE-parsing mirrors the
  // proven pattern in LensAgentPanel.tsx. Each `tool_call` event is a REAL
  // completed step from the agent's own trace (not a guess), so it earns its
  // own WorkStep line — an honest stage-beat, not decorative pacing.
  const chatWithBrain = useCallback(async (text: string) => {
    append({ id: `u-${Date.now()}`, role: 'user', content: text });
    setInput('');
    setRunning(true);
    beginWork('Thinking…', [{ id: 'agent', label: 'Reasoning', state: 'active' }]);
    // A4 — promote this free-form run into the mission-control plan store. Its
    // ONLY writes are runStarted (here), toolCallReceived (per real tool_call SSE
    // event, below), and runFinished (finally) — every step is a real event.
    useConkayRunStore.getState().runStarted();
    const aid = `a-${Date.now()}`;
    let placed = false;
    let liveText = '';
    const liveToolCalls: unknown[] = [];
    const liveDtuRefs: Array<{ id: string; title: string | null; tier: string | null; content?: string | null }> = [];
    let toolCount = 0;
    // A4 — run outcome, hoisted so the `finally` can report it to the run store.
    let finalOk = true;
    let finalErr = '';
    // Push the live-updating assistant message (content/toolCalls/dtuRefs) —
    // called from every branch below so text, tool chips, and artifacts all
    // land on screen as they actually happen, not just at the end.
    const syncMessage = () => {
      if (!placed) {
        placed = true;
        append({ id: aid, role: 'assistant', content: liveText, brain: 'kay', toolCalls: liveToolCalls.slice(), dtuRefs: liveDtuRefs.slice() });
      } else {
        setMessages((prev) => prev.map((m) => (m.id === aid ? { ...m, content: liveText, toolCalls: liveToolCalls.slice(), dtuRefs: liveDtuRefs.slice() } : m)));
      }
    };
    try {
      const base = getApiBase();
      const history = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${base}/api/chat-agent/stream`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // `persona` — server threads this into runAgentLoop's
        // opts.extraSystemBlock (see routes/chat-agent-stream.js). Without
        // it this call ran as the generic, personality-less "Agent Mode"
        // identity shared with LensAgentPanel.tsx's per-lens agent — not Kay.
        body: JSON.stringify({ message: text, history, persona: CONKAY_PERSONA_PROMPT }),
      });
      const reader = res.body?.getReader();
      if (!res.ok || !reader) {
        let err = '';
        try { err = String((await res.json())?.error || ''); } catch { /* non-JSON error body */ }
        throw new Error(err || `status_${res.status}`);
      }
      const decoder = new TextDecoder();
      let buf = '';
      let done_ = false;
      while (!done_) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        let event = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
          if (!line.startsWith('data: ')) continue;
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(line.slice(6)); } catch { continue; }
          if (event === 'tool_call') {
            // Unit A2 — deliberately NO pre-execution confirm on this path.
            // `tool_call` is a RECEIPT: the server's runAgentLoop
            // (server/lib/chat-agent.js) already invoked this tool —
            // including any run_lens_action mutation — server-side, before
            // this SSE event was even emitted. A "confirm before running"
            // rendered here would fire AFTER the mutation already happened:
            // a fabricated safety gate, which is exactly what this unit's
            // honesty constraint forbids building. The real fix is a
            // server-side pause/resume protocol (the agent loop halting
            // before a mutating tool call and waiting for a client ack) —
            // that's a separate, future unit; A2 intentionally does not
            // fake it here. What this branch CAN honestly do — and does —
            // is render the tool call as a truthful after-the-fact receipt
            // (the step line below + the artifact/DTU rendering further
            // down), never implying the user was asked first.
            liveToolCalls.push(data);
            // A4 — mirror this REAL tool_call receipt into the mission-control
            // run store (the panel's sole data source). The store re-validates
            // every field with typeof guards, so the cast only narrows the view.
            useConkayRunStore.getState().toolCallReceived(data as RawToolCall);
            toolCount += 1;
            const tc = data as {
              tool?: string; ok?: boolean; key?: string; domain?: string; action?: string;
              input?: Record<string, unknown>; result?: unknown;
              dtuId?: string; title?: string;
              // `content` (R8/CL3 gap fix): server/lib/chat-agent.js's
              // create_dtu tool now echoes the summary it just minted the DTU
              // with, so a freshly agent-created DTU carries real grounding
              // text into liveDtuRefs, not just id/title.
              artifact?: { kind?: string; id?: string; title?: string; content?: string; image_b64?: string; prompt?: string };
            };
            const toolName = String(tc.tool || 'tool');
            setSteps((prev) => [...prev, { id: `tool-${toolCount}`, label: `Called ${toolName}`, state: tc.ok === false ? 'error' : 'done' }]);
            // Render, don't just narrate: an agent-created DTU becomes a real
            // citable reference; a generated image renders inline; a
            // run_lens_action result runs through the SAME detectArtifact
            // registry executeMacro already uses, so ar.render / runFEA /
            // foundry.preview / forge.sandbox results reached via the agent
            // populate the Cockpit's Artifact Viewer exactly like a directly-run
            // macro does — no separate, lesser code path for agent-driven work.
            if (tc.artifact?.kind === 'dtu' && tc.artifact.id) {
              liveDtuRefs.push({
                id: tc.artifact.id,
                title: tc.artifact.title ?? tc.title ?? null,
                tier: null,
                content: tc.artifact.content ?? null,
              });
            } else if (tc.artifact?.kind === 'image' && tc.artifact.image_b64) {
              liveText += `\n\n![${tc.artifact.prompt || 'generated image'}](data:image/png;base64,${tc.artifact.image_b64})`;
            } else if (toolName === 'run_lens_action' && tc.ok !== false && tc.domain && tc.action) {
              const artifact = detectArtifact(tc.domain, tc.action, tc.input ?? {}, tc.result);
              if (artifact) useConkayHudStore.getState().setLastArtifact(artifact);
              if (tc.domain === 'engineering' && tc.action === 'runFEA') {
                const fea = feaResultFromRun(tc.input ?? {}, tc.result);
                if (fea) useConkayHudStore.getState().setLastFea(fea);
              }
            }
            syncMessage();
          } else if (event === 'token') {
            liveText += String((data as { chunk?: string }).chunk || '');
            syncMessage();
          } else if (event === 'done') {
            finalOk = data.ok !== false;
            finalErr = String(data.error || '');
            done_ = true;
          }
        }
      }
      setStep('agent', finalOk ? 'done' : 'error', finalOk ? 'Done' : 'Hit a snag');
      if (!liveText.trim()) {
        // A tool call may have already placed an (empty-text) message shell —
        // finalize its content either way instead of leaving it blank or
        // silently duplicating a message.
        liveText = finalOk
          ? (liveToolCalls.length ? 'Done.' : "I didn't have anything to add.")
          : `I hit a snag reasoning through that${finalErr ? ` (${finalErr})` : ''}.`;
        syncMessage();
      } else if (looksProvable(liveText)) {
        // liveDtuRefs is whatever real DTU context this reply actually
        // gathered via tool calls (create_dtu / run_lens_action results) —
        // pass it through as-is so reason.evaluate_answer's retrievedDtus
        // reflects genuine context, never a re-derivation or a guess.
        verifyMessage(aid, liveText, [], liveDtuRefs, text);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      finalOk = false;
      finalErr = msg;
      setStep('agent', 'error', 'Hit a snag');
      // A tool call may already have placed a message shell (real tool chips
      // on screen) even though the stream then failed before any answer text
      // arrived — finalize that same message rather than leaving it blank or
      // appending a confusing second bubble.
      if (!liveText.trim()) {
        liveText = `The brains aren't reachable right now (${msg}). Try "brief me", "search my archive for …", "show my activity", "open <lens>", or "what can you do" — those work without them.`;
        syncMessage();
      }
    } finally {
      // A4 — real run outcome to the mission-control store (stops the header's
      // "running" pulse; flags an error only if the run genuinely failed).
      useConkayRunStore.getState().runFinished({ ok: finalOk, error: finalErr });
      setRunning(false);
      clearWork();
    }
  }, [append, beginWork, setStep, setSteps, setMessages, clearWork, verifyMessage, messages]);

  // ── command routing ─────────────────────────────────────────────────
  function submit(raw: string) {
    const t = (raw || '').trim();
    if (!t || running) return;
    // 1) a global ConKay skill (brief / search / activity / world / open / help)
    const m = matchConKaySkill(t);
    if (m) { runSkill(t, m); return; }
    // 2) operate THIS lens: "run <macro> [jsonInput]" → its real macro
    const rm = t.match(/^run\s+(?:([a-zA-Z0-9_-]+)\.)?([a-zA-Z0-9_-]+)\s*(\{[\s\S]*\})?$/i);
    if (rm && lens) {
      const domain = rm[1] || lens.id;
      const macro = rm[2];
      let inp: Record<string, unknown> = {};
      if (rm[3]) { try { inp = JSON.parse(rm[3]); } catch { /* leave empty */ } }
      runLensMacro(domain, macro, inp);
      return;
    }
    // 3) free-text on a lens → the conscious brain maps it onto a real macro and
    //    ConKay operates the lens (graceful fallback inside resolveAndOperate).
    if (lens && !onChatLens) { resolveAndOperate(t, lens.id, lens.name); return; }
    // 4) not on an operable lens (or on the chat lens itself) → real conversation.
    chatWithBrain(t);
  }

  const onSubmitForm = (e: React.FormEvent) => { e.preventDefault(); submit(input); };

  // Closed: a persistent, discoverable summon button (the hotkey ⌘/Ctrl+J still
  // works, and the command palette still has "Summon Kay" — this just makes the
  // front door visible for people who don't know the shortcut). Suppressed on
  // the chat lens, which hosts its own ConKay mode.
  if (!open) {
    if (onChatLens) return null;
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Summon ConKay (⌘/Ctrl+J)"
        title="Summon Kay — ask in one sentence (⌘/Ctrl+J)"
        className="group fixed bottom-6 right-6 z-[55] flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/40 bg-black/70 text-cyan-200 shadow-lg shadow-cyan-500/20 backdrop-blur transition hover:scale-105 hover:bg-cyan-500/20 hover:text-cyan-100"
      >
        <Sparkles className="h-5 w-5" />
        <span className="pointer-events-none absolute right-14 whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-xs text-cyan-100 opacity-0 transition group-hover:opacity-100">
          Ask Kay
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" role="dialog" aria-modal="true" aria-label="ConKay">
      {/* world-tree presence */}
      <ConKayBackdrop state={conkayState} listening={voice.listening} muted={muted} ttsAmplitudeRef={voice.ttsAmplitudeRef} className="pointer-events-none absolute inset-0 -z-10" />
      <div className="absolute inset-0 -z-10 bg-black/55 backdrop-blur-sm" aria-hidden onClick={() => setOpen(false)} />

      {/* Phase 3 — exploded view of a real artifact (over the backdrop, interactive) */}
      {inspecting && (
        <ConKayArtifactExploded className="absolute inset-0 z-0" />
      )}

      {/* header */}
      <div className="flex items-center gap-3 px-5 py-3 text-cyan-100">
        <Sparkles className="h-5 w-5 text-cyan-300" />
        <span className="text-sm font-semibold tracking-wide">ConKay</span>
        {lens && !onChatLens && (
          <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] text-cyan-200">
            Operating: {lens.name}
          </span>
        )}
        <span className="ml-2 truncate text-[11px] text-cyan-300/60">
          {voice.interim ? <span className="text-cyan-200/80">“{voice.interim}”</span>
            : conkayState === 'listening' ? 'listening…'
              : conkayState === 'processing' ? 'working…'
                : conkayState === 'presenting' ? 'speaking…' : 'ready'}
        </span>
        <ConKayTelemetryChip />
        <div className="ml-auto flex items-center gap-1.5">
          {unityPresent && (
            <>
              <div className="flex items-center gap-1 mr-1">
                <input
                  type="text"
                  value={nlpDesignText}
                  onChange={(e) => setNlpDesignText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void buildNlpDesignWorld();
                    }
                  }}
                  placeholder="steel I-beam 6m, 5kN midspan"
                  aria-label="NLP design prompt"
                  data-testid="ck-nlp-design-text"
                  className="w-40 lg:w-56 rounded-md border border-cyan-400/25 bg-black/40 px-2 py-1 text-[10px] text-cyan-100 placeholder:text-cyan-300/40"
                />
                <button type="button" onClick={() => { void buildNlpDesignWorld(); }}
                  disabled={nlpBuilding}
                  title="Build in world: free-text NLP → partMesh/FEA → apply_mesh (not industrial CAD suite)"
                  aria-label="Build NLP design in world"
                  data-testid="ck-nlp-build-world"
                  className="rounded-lg px-2 py-1 text-[10px] text-violet-100 hover:bg-violet-400/15 border border-violet-400/30 disabled:opacity-50 flex items-center gap-1">
                  <Type className="h-3 w-3" />
                  {nlpBuilding ? '…' : 'Build'}
                </button>
                <button type="button" onClick={() => { void runAssemblyRevise(); }}
                  disabled={assemblyBusy}
                  title="Assembly revise: build assembly | add beam… | move part X to x,y,z | undo | redo → APIs + Unity (ASSEMBLY LIVE — not full suite)"
                  aria-label="Assembly chat revise"
                  data-testid="ck-assembly-revise"
                  className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-400/15 border border-fuchsia-400/30 disabled:opacity-50 flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {assemblyBusy ? '…' : 'Asm'}
                </button>
                <button type="button" onClick={() => { void runAssemblyUndoClick(); }}
                  disabled={!assemblyId || assemblyBusy}
                  title="Assembly undo — restore prior parts+transforms snapshot (not parametric CAD history)"
                  aria-label="Assembly undo"
                  data-testid="ck-assembly-undo"
                  className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100/90 hover:bg-fuchsia-400/15 border border-fuchsia-400/20 disabled:opacity-40">
                  Undo
                </button>
                <button type="button" onClick={() => { void runAssemblyRedoClick(); }}
                  disabled={!assemblyId || assemblyBusy}
                  title="Assembly redo — restore forward parts+transforms snapshot"
                  aria-label="Assembly redo"
                  data-testid="ck-assembly-redo"
                  className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100/90 hover:bg-fuchsia-400/15 border border-fuchsia-400/20 disabled:opacity-40">
                  Redo
                </button>
                <button type="button" onClick={() => { void downloadAssemblyStl(); }}
                  disabled={!assemblyId}
                  title="Download assembly STL (Wave 2 — binary STL from part meshes)"
                  aria-label="Download assembly STL"
                  data-testid="ck-assembly-stl"
                  className="rounded-lg px-2 py-1 text-[10px] text-teal-100 hover:bg-teal-400/15 border border-teal-400/30 disabled:opacity-40">
                  STL
                </button>
                <button type="button" onClick={() => { void downloadBomJson(); }}
                  disabled={!assemblyId}
                  title="Download BOM JSON (Wave 2 — part id/kind/material/qty)"
                  aria-label="Download assembly BOM"
                  data-testid="ck-assembly-bom"
                  className="rounded-lg px-2 py-1 text-[10px] text-lime-100 hover:bg-lime-400/15 border border-lime-400/30 disabled:opacity-40">
                  BOM
                </button>
                <button
                  type="button"
                  onClick={() => { void exportErpBom(); }}
                  className="rounded border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-100/90 hover:bg-emerald-400/20"
                  title="ERP-shaped BOM JSON+CSV — part numbers, mass/volume, vendor stubs, rollup (not SAP/Oracle)"
                  aria-label="Export ERP BOM"
                  data-testid="ck-assembly-erp-bom"
                >
                  ERP BOM
                </button>
                <button type="button" onClick={() => { void downloadAssemblyStep(); }}
                  disabled={!assemblyId}
                  title="Download assembly faceted STEP (AP214-style MANIFOLD_SOLID_BREP from triangles — not SolidWorks B-rep)"
                  aria-label="Download assembly STEP"
                  data-testid="ck-export-step"
                  className="rounded-lg px-2 py-1 text-[10px] text-orange-100 hover:bg-orange-400/15 border border-orange-400/30 disabled:opacity-40">
                  STEP
                </button>
                <button type="button" onClick={() => { void downloadAssemblyBrep(); }}
                  disabled={!assemblyId}
                  title="Download OCC advanced B-rep STEP (cadquery-ocp) — not SolidWorks"
                  aria-label="Download OCC B-rep STEP"
                  data-testid="ck-export-brep"
                  className="rounded-lg px-2 py-1 text-[10px] text-violet-100 hover:bg-violet-400/15 border border-violet-400/30 disabled:opacity-40">
                  B-rep
                </button>
                <button type="button" onClick={() => { void addFeatureDemo(); }}
                  disabled={assemblyBusy}
                  title="Add industrial OCC features (shell/chamfer/union/pattern/revolve) — not SolidWorks UI parity"
                  aria-label="Add solid feature"
                  data-testid="ck-add-feature"
                  className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-400/15 border border-fuchsia-400/30 disabled:opacity-40">
                  Feat
                </button>
                <button type="button" onClick={() => { void rebuildSolidDemo(); }}
                  disabled={assemblyBusy}
                  title="Rebuild OCC solid from feature tree + tessellate for Unity"
                  aria-label="Rebuild solid"
                  data-testid="ck-rebuild-solid"
                  className="rounded-lg px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-400/15 border border-fuchsia-400/30 disabled:opacity-40">
                  Rebuild
                </button>
                <button type="button" onClick={() => { void showCertStatus(); }}
                  title="OCC / solid-world cert probe (geometry verification harness — not ISO CMM)"
                  aria-label="Solid world cert status"
                  data-testid="ck-solid-cert"
                  className="rounded-lg px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-400/15 border border-emerald-400/30">
                  Cert
                </button>
                <button type="button" onClick={() => { void industrialMateSolveDemo(); }}
                  disabled={assemblyBusy}
                  title="Industrial multi-DOF mate solve (concentric+distance on OCC gp_Trsf — not AABB snap)"
                  aria-label="Industrial mate solve"
                  data-testid="ck-mate-solve-dof"
                  className="rounded-lg px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-400/15 border border-amber-400/30 disabled:opacity-40">
                  DOF
                </button>
                <button type="button" onClick={() => { void digitalGdtDemo(); }}
                  disabled={assemblyBusy}
                  title="Digital ASME Y14.5-style GD&T from B-rep/tessellation — NOT physical ISO 17025 CMM"
                  aria-label="Digital GD&T"
                  data-testid="ck-gdt-digital"
                  className="rounded-lg px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-400/15 border border-amber-400/30 disabled:opacity-40">
                  GD&T
                </button>
                <button type="button" onClick={() => { void industrialCertDemo(); }}
                  title="INDUSTRIAL_CLASS cert probe (kernel capabilities — not SolidWorks UI parity / not ISO CMM lab)"
                  aria-label="Industrial class cert"
                  data-testid="ck-industrial-cert"
                  className="rounded-lg px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-400/15 border border-amber-400/30">
                  IND
                </button>
                <button type="button" onClick={() => { void downloadAssemblyDrawingSvg(); }}
                  disabled={!assemblyId}
                  title="Download orthographic drawing SVG (front/top/side projected mesh lines — not drafting CAD)"
                  aria-label="Download assembly drawing SVG"
                  data-testid="ck-export-drawing"
                  className="rounded-lg px-2 py-1 text-[10px] text-sky-100 hover:bg-sky-400/15 border border-sky-400/30 disabled:opacity-40">
                  DWG
                </button>

                <button type="button" onClick={() => { void downloadAssemblyDrawingPdfClick(); }}
                  disabled={!assemblyId}
                  title="Download multi-page drawing PDF (3 orthographic views + title block + BOM — drafting pack, not CMM GD&T)"
                  aria-label="Download assembly drawing PDF"
                  data-testid="ck-export-drawing-pdf"
                  className="rounded-lg px-2 py-1 text-[10px] text-sky-100 hover:bg-sky-400/15 border border-sky-400/30 disabled:opacity-40">
                  PDF
                </button>
                <button type="button" onClick={() => { void explodeAssemblyClick(); }}
                  disabled={!assemblyId || assemblyBusy}
                  title="Explode assembly along part centroids from COM (factor=1) — undoable; Unity set_transform/redraw"
                  aria-label="Explode assembly"
                  data-testid="ck-assembly-explode"
                  className="rounded-lg px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-400/15 border border-amber-400/30 disabled:opacity-40">
                  Explode
                </button>

                <select
                  value={materialPicker}
                  onChange={(e) => setMaterialPicker(e.target.value)}
                  disabled={!assemblyId}
                  title="Material library picker"
                  aria-label="Material picker"
                  data-testid="ck-material-picker"
                  className="rounded-lg px-1 py-1 text-[10px] text-slate-100 bg-black/40 border border-slate-400/30 disabled:opacity-40 max-w-[5.5rem]"
                >
                  {(materialsList.length ? materialsList : [
                    { id: 'steel', name: 'steel' },
                    { id: 'aluminum', name: 'aluminum' },
                    { id: 'concrete', name: 'concrete' },
                    { id: 'timber', name: 'timber' },
                    { id: 'plastic', name: 'plastic' },
                  ]).map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </select>
                <button type="button" onClick={() => { void attachMaterialClick(); }}
                  disabled={!assemblyId || assemblyBusy}
                  title="Attach selected material to latest assembly part (GET /api/conkay/materials + POST …/material)"
                  aria-label="Attach material to part"
                  data-testid="ck-material-attach"
                  className="rounded-lg px-2 py-1 text-[10px] text-slate-100 hover:bg-slate-400/15 border border-slate-400/30 disabled:opacity-40">
                  Mat
                </button>

              </div>
              <button type="button" onClick={dropWorldMarker}
                title="Drop marker in world (F0 cube via spawn_primitive — not CAD)"
                aria-label="Drop marker in world"
                className="rounded-lg p-2 text-cyan-200 hover:bg-cyan-400/10">
                <MapPin className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => { void dropFeaBeamWorld(); }}
                title="FEA beam → world: runFEA(FEA_FRAME) → util band color → spawn_primitive cube proxy (not full CAD)"
                aria-label="FEA beam to world"
                data-testid="ck-fea-beam-world"
                className="rounded-lg p-2 text-emerald-200 hover:bg-emerald-400/10">
                <Activity className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => { void dropPartMeshWorld(); }}
                title="partMesh i-beam → apply_mesh MeshFilter (real triangle mesh — not full CAD)"
                aria-label="Apply part mesh to world"
                data-testid="ck-part-mesh-world"
                className="rounded-lg p-2 text-amber-200 hover:bg-amber-400/10">
                <Layers className="h-4 w-4" />
              </button>
              <button type="button" onClick={loadGlbWorld}
                title="Load public GLB via load_glb → Unity glTFast (furniture_table) — not evo-asset auto-wire"
                aria-label="Load GLB into world"
                data-testid="ck-load-glb"
                className="rounded-lg p-2 text-sky-200 hover:bg-sky-400/10">
                <Package className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => { void evoGlbToWorld(); }}
                disabled={evoGlbBusy}
                title="Evo-asset generate → resolve → load_glb (archetype keyword in prompt: sword/spear/staff/mace/shield)"
                aria-label="Evo asset GLB to world"
                data-testid="ck-evo-glb-world"
                className="rounded-lg p-2 text-orange-200 hover:bg-orange-400/10 disabled:opacity-50">
                <Sword className="h-4 w-4" />
              </button>
              <ConKayVerticalsBar setWorkStatus={setWorkStatus} />
              <button type="button" onClick={() => {
                const ok = clearTempPrimitives(`clear-${Date.now()}`);
                setWorkStatus(ok ? 'Unity bridge: clear_temp posted' : 'Unity bridge: clear post failed');
              }}
                title="Clear ConKayTemp markers in Unity"
                aria-label="Clear world markers"
                className="rounded-lg px-2 py-1 text-[10px] text-cyan-300/80 hover:bg-cyan-400/10 border border-cyan-400/20">
                clear
              </button>
            </>
          )}
          <button onClick={() => setInspecting((x) => !x)} title={inspecting ? 'Close inspector' : 'Inspect an AR artifact (exploded view)'} aria-label="Inspect artifact"
            className={`rounded-lg p-2 hover:bg-cyan-400/10 ${inspecting ? 'text-cyan-100 bg-cyan-400/15' : 'text-cyan-200'}`}>
            <Box className="h-4 w-4" />
          </button>
          <button onClick={() => setMuted((x) => !x)} title={muted ? 'Unmute' : 'Mute'} aria-label={muted ? 'Unmute' : 'Mute'}
            className="rounded-lg p-2 text-cyan-200 hover:bg-cyan-400/10">
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button onClick={() => setOpen(false)} title="Dismiss (Esc)" aria-label="Dismiss"
            className="rounded-lg p-2 text-cyan-200 hover:bg-cyan-400/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Scaffolding library — worked examples for the "Build in world" field.
          The physics parser needs real structural params ("make a house" fails);
          these show the shape of a prompt it can actually run. Click = populate
          the field + fire the NLP→partMesh/FEA→apply_mesh path. */}
      {unityPresent && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-2 text-[10px] text-cyan-300/50">
          <span className="text-cyan-300/40">Try:</span>
          {[
            'simply supported steel I-beam 6m, 5kN midspan',
            'cantilevered timber joist 3m, 2kN tip load',
            'steel I-beam 4m, 8kN at 1m from left support',
          ].map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={nlpBuilding}
              onClick={() => { setNlpDesignText(ex); void buildNlpDesignWorld(ex); }}
              className="rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2 py-0.5 text-cyan-200/70 hover:border-cyan-400/50 hover:text-cyan-100 disabled:opacity-40 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* transcript, now hosted inside the F1 cockpit grid — left/right panel
          lanes (e.g. conkay.telemetry) flank the SAME transcript content,
          unchanged. The lanes hide below `lg` so mobile keeps full width. */}
      <ConKayCockpit>
        <div className="mx-auto max-w-2xl space-y-3 py-2">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-cyan-100/70">
              {lens && !onChatLens
                ? <>I'm on the <span className="text-cyan-200">{lens.name}</span> lens with you. Tell me what to do — or “brief me”.</>
                : <>Ask me anything — “brief me”, “search my archive for …”, “open music”.</>}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`ck-reveal ${m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}>
              <div className={m.role === 'user'
                ? 'max-w-[80%] rounded-2xl rounded-br-md bg-cyan-500/15 border border-cyan-400/25 px-3.5 py-2 text-sm text-cyan-50'
                : 'max-w-[85%] rounded-2xl rounded-bl-md bg-black/40 border border-cyan-400/15 px-3.5 py-2 text-sm text-cyan-50'}>
                {m.role === 'assistant'
                  ? <ConKayMessage fields={m} renderProse={(t) => <MessageRenderer content={t} />} />
                  : m.content}
              </div>
            </div>
          ))}
          {/* Unit A2 — pre-execution confirm for a mutating client-initiated
              macro call. Only ever set by confirmIfMutating with the REAL
              proposed {domain, macro, input}; resolvePendingConfirm(true|false)
              is the ONLY way execution proceeds or is skipped. */}
          {pendingConfirm && (
            <ConKayActionConfirm
              domain={pendingConfirm.domain}
              macro={pendingConfirm.macro}
              input={pendingConfirm.input}
              onConfirm={() => resolvePendingConfirm(true)}
              onCancel={() => resolvePendingConfirm(false)}
            />
          )}
          {/* JARVIS "you can see it building" — live arc-reactor + step spine */}
          <ConKayWorkStatus phase={conkayState} status={workStatus} steps={steps} active={running} />
          <div ref={bottomRef} aria-hidden />
        </div>
      </ConKayCockpit>

      {/* command bar */}
      <form onSubmit={onSubmitForm} className="px-5 pb-5 pt-2">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-cyan-400/25 bg-black/50 px-3 py-2 backdrop-blur">
          {voice.supported && (
            <button type="button" onClick={() => setMuted((x) => !x)}
              title={muted ? 'Voice off — click to enable' : voice.listening ? 'Listening…' : 'Voice on'} aria-label="Toggle voice"
              className={`rounded-lg p-2 ${voice.listening ? 'bg-cyan-400/20 text-cyan-200' : muted ? 'text-cyan-300/40' : 'text-cyan-300 hover:bg-cyan-400/10'}`}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={lens && !onChatLens ? `Ask Kay to operate the ${lens.name} lens…` : 'Ask Kay…'}
            className="flex-1 bg-transparent text-sm text-cyan-50 placeholder:text-cyan-200/40 outline-none"
            aria-label="Message ConKay"
          />
          <button type="submit" disabled={!input.trim() || running}
            className="rounded-lg bg-cyan-500 p-2 text-black disabled:opacity-40" aria-label="Send">
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-2xl text-center text-[10px] text-cyan-200/40">
          {voice.usingServerStt && voice.voiceUnavailable
            ? 'Voice transcription isn’t available in this browser — type to Kay instead.'
            : '⌘/Ctrl+J to summon Kay on any lens · Esc to dismiss'}
        </p>
      </form>
    </div>
  );
}

export default ConKayOverlay;
