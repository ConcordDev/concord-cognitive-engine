'use client';

/**
 * Workshop — ConKay as one app. Late night in a private lab: one open
 * wireframe over a dark glass table, and Kay.
 *
 * The four old ConKay pages are views of this one workshop:
 *   table — the study (or an opened design) on the hologram table;
 *   wall  — showcase designs, your saved models, your kept DTUs;
 *   hood  — under the hood: the solver's receipt for the study, or a
 *           design's live build stream;
 *   guest — the public demo: the same workshop with nothing stored.
 * /lenses/conkay, /conkay/demo, /conkay/designs[/id[/live]] and
 * /conkay/workbench all mount this component.
 *
 * ConKay opens on Kay (owner, 2026-11-26: "Kay first"): the conversation
 * fills the screen (KayHome) and the Workshop — the object, Kay's log, the
 * rail — slides in when she builds something you asked for, or when you
 * open it. While the conversation is the whole screen no study is in view,
 * so nothing typed is read as an edit of the I-beam. Deep links into a view
 * or a design (and /conkay/designs, /conkay/workbench) open the Workshop.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowLeft, Boxes, Eye, EyeOff, Loader2, MessageSquare, PanelLeft, Save, SlidersHorizontal, LayoutGrid, Cpu, Box, ChevronUp, ChevronDown, PanelRightOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DISPLAY_LABELS, VIEW_LABELS, utilizationColor, type DisplayMode, type ViewPreset } from '@/lib/conkay/beam-view';
import { DEMO_SIGNUP_HREF } from '@/lib/conkay/demo-api';
import { DesignPane, StartScreen } from '../workspace/DesignPane';
import { WorkspaceNav, ModelsPanel, VaultPanel } from '../workspace/WorkspaceNav';
import { StudyCards } from '../workspace/StudyCards';
import { ParameterPanel } from '../workspace/ParameterPanel';
import { VoiceComposer } from '../workspace/VoiceComposer';
import { DesignsIndex } from '../designs/DesignsIndex';
import { DesignBuilder } from '../designs/DesignBuilder';
import { LiveBuild } from '../designs/LiveBuild';
import type { BeamCallouts } from '../workspace/BeamViewport';
import { KayLog, SweepTable } from './KayLog';
import { KayHome } from './KayHome';
import { useWorkshopController, type WorkshopController } from './useWorkshopController';
import { BuildReportCard } from './BuildReportCard';
import { isBuildReport } from '@/lib/conkay/build-report';
import './workshop.css';
import { workshopFontVars } from './workshopFonts';

const BeamViewport = dynamic(() => import('../workspace/BeamViewport'), {
  ssr: false,
  loading: () => <TableLoading label="Bringing up the hologram…" />,
});
const MeshArtifactView = dynamic(() => import('@/components/chat/MeshArtifactView'), {
  ssr: false,
  loading: () => <TableLoading label="Loading model…" />,
});

function TableLoading({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-[color:var(--ws-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {label}</div>;
}

export type WorkshopView = 'table' | 'wall' | 'hood';

const VIEWS: Array<{ id: WorkshopView; label: string; icon: typeof Box; key: string }> = [
  { id: 'table', label: 'Table', icon: Box, key: 'g t' },
  { id: 'wall', label: 'Wall', icon: LayoutGrid, key: 'g w' },
  { id: 'hood', label: 'Under the hood', icon: Cpu, key: 'g h' },
];

export interface WorkshopProps {
  guest?: boolean;
  initialView?: WorkshopView;
  designId?: string | null;
}

export function Workshop(props: WorkshopProps) {
  return (
    <Suspense fallback={null}>
      <WorkshopInner {...props} />
    </Suspense>
  );
}

type Stage = 'kay' | 'workshop';

function WorkshopInner({ guest = false, initialView, designId: initialDesign = null }: WorkshopProps) {
  const [view, setViewState] = useState<WorkshopView>(initialView ?? 'table');
  const [designId, setDesignId] = useState<string | null>(initialDesign);
  const [logOpen, setLogOpen] = useState(true);
  const [stage, setStage] = useState<Stage>(initialView || initialDesign ? 'workshop' : 'kay');
  const stageRef = useRef<Stage>(stage);
  stageRef.current = stage;
  const [draft, setDraft] = useState<{ id: number; text: string } | null>(null);
  // Set when the person sends something; a build that follows opens the Workshop.
  const asked = useRef(false);

  // A newly designed object comes down onto the table through go(), so
  // the URL follows (?design=<id>) and a reload lands on it.
  const goRef = useRef<(v: WorkshopView, d: string | null) => void>(() => {});
  const c = useWorkshopController({
    guest,
    onDesigned: (id) => goRef.current('table', id),
    studyActive: () => stageRef.current === 'workshop',
  });
  const { router, pathname, params } = c;

  // Views and the open design live in the URL, so a reload or a shared link
  // lands on the same place (?view=wall, ?design=<id>).
  useEffect(() => {
    const qv = params.get('view');
    const qd = params.get('design');
    if (qv === 'table' || qv === 'wall' || qv === 'hood') setViewState(qv);
    if (qd) setDesignId(qd);
    const qb = params.get('build');
    if (qb) void c.openBuild(qb);
    if (qv || qd || qb || params.get('stage') === 'workshop') setStage('workshop');
    // Read once on mount; afterwards the state drives the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const syncUrl = useCallback((v: WorkshopView, d: string | null, st: Stage = 'workshop') => {
    const q = new URLSearchParams(params.toString());
    if (v === 'table') q.delete('view'); else q.set('view', v);
    if (d) q.set('design', d); else q.delete('design');
    if (st === 'workshop' && v === 'table' && !d) q.set('stage', 'workshop'); else q.delete('stage');
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  }, [params, pathname, router]);
  const go = useCallback((v: WorkshopView, d: string | null = designId) => {
    setStage('workshop'); setViewState(v); setDesignId(d); syncUrl(v, d, 'workshop');
  }, [designId, syncUrl]);
  goRef.current = go;
  const toKay = useCallback(() => {
    asked.current = false;
    setStage('kay'); setViewState('table'); setDesignId(null); syncUrl('table', null, 'kay');
  }, [syncUrl]);
  const sendFromKay = useCallback((t: string) => { asked.current = true; setDraft(null); void c.send(t); }, [c]);

  // Kay built something you asked for (a design, a 3D model, a study solve):
  // the Workshop opens beside the conversation to show it.
  const built = Boolean(c.design || c.viewMesh || c.build || c.status === 'solving');
  useEffect(() => {
    // Once shown, the build has been seen: going back to the conversation stays there.
    if (stage === 'kay' && asked.current && built) { asked.current = false; go('table', null); }
  }, [built, stage, go]);
  const openDesign = useCallback((id: string) => go('table', id), [go]);
  const closeDesign = useCallback(() => go('wall', null), [go]);

  return (
    <div className={cn('workshop flex h-full min-h-0 flex-col', workshopFontVars)} data-lens-theme="conkay">
      {guest && (
        <div className="flex flex-wrap items-center justify-center gap-3 border-b border-[color:var(--ws-line)] px-4 py-2 text-[13px] text-[color:var(--ws-muted)]">
          <span>You&rsquo;re in the workshop as a guest — solve and sweep freely. Nothing is saved.</span>
          <Link href={DEMO_SIGNUP_HREF} className="rounded-full bg-[color:var(--ws-arc)] px-3 py-1 text-[12px] font-semibold text-[color:var(--ws-void)] shadow-[0_0_16px_rgba(89,227,255,0.35)]">Sign up free</Link>
        </div>
      )}

      {stage === 'kay' ? (
        <KayHome c={c} onSend={sendFromKay} draft={draft} onDraft={(t) => setDraft({ id: Date.now(), text: t })} onOpenWorkshop={() => go('table', null)} />
      ) : (<>
      {/* Phone / tablet: the three panes as tabs */}
      <div role="tablist" aria-label="Workspace panels" className="m-2 flex gap-1 rounded-full border border-[color:var(--ws-line)] p-1 lg:hidden">
        {([['model', 'Table', Boxes], ['chat', 'Kay', MessageSquare], ['browse', 'Browse', PanelLeft]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" type="button" aria-selected={c.mobileTab === id} onClick={() => c.setMobileTab(id)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-sm', c.mobileTab === id ? 'bg-[color:var(--ws-arc-soft)] text-[color:var(--ws-arc)]' : 'text-[color:var(--ws-muted)]')}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div className={cn('grid min-h-0 flex-1 grid-cols-1 gap-3 p-2 sm:p-3', logOpen && !(view === 'table' && designId) ? 'lg:grid-cols-[216px_minmax(0,1fr)_340px] xl:grid-cols-[228px_minmax(0,1fr)_370px]' : 'lg:grid-cols-[216px_minmax(0,1fr)] xl:grid-cols-[228px_minmax(0,1fr)]')}>
        {/* Rail */}
        <aside className={cn(c.mobileTab === 'browse' ? 'flex' : 'hidden', 'ws-glass min-h-0 flex-col gap-3 overflow-y-auto rounded-xl p-2 lg:flex')}>
          <div className="px-2 pt-1">
            <div className="ws-glow-text text-[17px] font-semibold tracking-[0.32em] text-[color:var(--ws-arc)]">CONKAY</div>
            <div className="ws-label mt-0.5">The workshop</div>
          </div>
          <button type="button" onClick={toKay} data-testid="back-to-kay"
            className="flex items-center gap-2 rounded-md border border-[color:var(--ws-line-strong)] px-2.5 py-1.5 text-[13px] text-[color:var(--ws-text)] transition-colors hover:bg-[color:var(--ws-arc-soft)]">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the conversation
          </button>
          <nav aria-label="Workshop views" className="flex flex-col gap-0.5">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => go(v.id)} aria-current={view === v.id ? 'page' : undefined}
                className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] tracking-wide transition-colors',
                  view === v.id ? 'bg-[color:var(--ws-arc-soft)] text-[color:var(--ws-arc)] shadow-[inset_2px_0_0_var(--ws-arc)]' : 'text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] hover:text-[color:var(--ws-text)]')}>
                <v.icon className="h-4 w-4" aria-hidden /> {v.label}
              </button>
            ))}
          </nav>
          <div className="border-t border-[color:var(--ws-line)] pt-2">
            {guest ? (
              <p className="px-2 text-[12px] leading-relaxed text-[color:var(--ws-muted)]">Projects, models, simulations and the data vault are kept for signed-in engineers. <Link href={DEMO_SIGNUP_HREF} className="text-[color:var(--ws-arc)] underline underline-offset-2">Sign up free</Link>.</p>
            ) : (
              <WorkspaceNav
                section={c.section}
                onSection={c.setSection}
                workspaces={c.workspaces}
                workspacesError={c.workspacesError}
                workspaceId={c.workspaceId}
                onWorkspace={c.goWorkspace}
                onCreateWorkspace={c.createWorkspace}
                materials={c.materials}
                materialId={c.inputs.materialId}
                onMaterial={(id) => { c.setInputs({ ...c.inputs, materialId: id }); c.setDesign(null); c.ws.startBeam(); c.setMobileTab('model'); go('table', null); }}
                onOpenModel={(name, dims, materialId, partId) => { c.ws.openModel(name, dims, materialId, partId); c.setDesign(null); c.setViewMesh(null); c.setMobileTab('model'); go('table', null); }}
                onNewStudy={() => { c.ws.resetStudy(); c.setDesign(null); c.setViewMesh(null); c.setMobileTab('model'); go('table', null); }}
                onOpenShowcase={(id, label) => { c.setDesign({ kind: 'showcase', id, label }); c.setMobileTab('model'); go('table', null); }}
                onAskAboutDtu={(d) => void c.openDtu(d.id, d.title)}
                refreshKey={c.refreshKey}
              />
            )}
          </div>
        </aside>

        {/* Stage */}
        <div className={cn(c.mobileTab === 'model' ? 'flex' : 'hidden', 'min-h-0 flex-col gap-2 lg:flex')}>
          {view === 'table' && (designId ? <DesignOnTable id={designId} onBack={closeDesign} /> : <StudyTable c={c} logOpen={logOpen} onOpenLog={() => setLogOpen(true)} />)}
          {view === 'wall' && <Wall c={c} onOpenDesign={openDesign} />}
          {view === 'hood' && (designId ? <HoodDesign id={designId} onBack={() => go('table', designId)} /> : <HoodStudy c={c} onTable={() => go('table', null)} />)}
          {(view !== 'table' || !designId) && (
            <VoiceComposer variant="workshop" busy={c.busy || c.status === 'solving'} placeholder={c.build ? 'Ask Kay about this build, or describe something new to build' : undefined} onSend={(t) => { if (view !== 'table' || designId) go('table', null); void c.send(t); }} speakText={c.speak} lastLine={logOpen ? null : lastKayLine(c)} />
          )}
        </div>

        {/* Kay's log — a design on the table brings its own Kay panel (that design's session). */}
        {logOpen && !(view === 'table' && designId) && (
          <div className={cn(c.mobileTab === 'chat' ? 'flex' : 'hidden', 'min-h-0 flex-col lg:flex')}>
            <KayLog c={c} onClose={() => setLogOpen(false)} />
          </div>
        )}
        {!logOpen && c.mobileTab === 'chat' && <div className="flex min-h-0 flex-col lg:hidden"><KayLog c={c} /></div>}
      </div>
      </>)}
    </div>
  );
}

function lastKayLine(c: WorkshopController): string | null {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.role === 'assistant' && m.text && !m.pending) return m.text.length > 180 ? `${m.text.slice(0, 177)}…` : m.text;
  }
  return null;
}

// ── The table: the study ─────────────────────────────────────────────────────

function StudyTable({ c, logOpen, onOpenLog }: { c: WorkshopController; logOpen: boolean; onOpenLog: () => void }) {
  const { inputs, setInputs, result, ws, status, busy, design, viewMesh, build } = c;
  const report = build?.report && isBuildReport(build.report) ? build.report : null;
  const closeBuild = () => { c.setBuild(null); c.setViewMesh(null); c.setSelectedPart(null); };
  const stepHref = build?.buildId ? `/api/conkay/build/${encodeURIComponent(build.buildId)}/step` : undefined;
  const fresh = Boolean(result) && !ws.stale;
  const callouts: BeamCallouts | null = useMemo(() => (
    result && fresh ? {
      maxStressMPa: result.maxStressMPa,
      maxDeflectionMm: result.maxDeflectionMm,
      safetyFactor: result.safetyFactor,
      // A stated required SF governs the verdict when the server computed one.
      pass: result.safetyCheck?.stated && result.safetyCheck.pass !== null ? result.safetyCheck.pass : result.pass,
      solveKey: String(result.jobId ?? result.updatedAt),
    } : null
  ), [result, fresh]);
  const meshOk = Boolean(viewMesh && ((Array.isArray(viewMesh.positions) && Array.isArray(viewMesh.indices) && viewMesh.positions.length >= 9) || (typeof viewMesh.url === 'string' && /^\/api\/media\/[^/]+\/stream$/.test(viewMesh.url))));
  const led = status === 'solving' ? 'bg-[color:var(--ws-amber)] animate-pulse' : fresh ? 'bg-[color:var(--ws-go)] shadow-[0_0_8px_var(--ws-go)]' : 'bg-[color:var(--ws-faint)]';

  return (
    <section aria-label="Study viewport" className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="ws-table ws-corners relative min-h-[360px] flex-1 overflow-hidden rounded-xl border border-[color:var(--ws-line)]">
        {/* HUD: name · units · status · tools */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', led)} aria-hidden />
            {viewMesh || report ? (
              <span className="min-w-0 max-w-[16rem] truncate text-sm font-medium capitalize text-[color:var(--ws-text)]" data-testid="viewport-model-title">{(viewMesh || build)?.title || 'ConKay model'}</span>
            ) : (
              <input value={inputs.name} onChange={(e) => setInputs({ ...inputs, name: e.target.value.slice(0, 80) })} aria-label="Study name"
                className="min-w-0 max-w-[16rem] truncate bg-transparent text-sm font-medium tracking-wide text-[color:var(--ws-text)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ws-line-strong)]" />
            )}
            <span className="ws-label hidden truncate sm:inline">· {c.workspaceName}{report ? ' · checked by ConKay’s solvers' : ' · mm / N / MPa'}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!logOpen && (
              <button type="button" onClick={onOpenLog} title="Show Kay's log" aria-label="Show Kay's log" className="rounded-md p-1.5 text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] hover:text-[color:var(--ws-arc)]">
                <PanelRightOpen className="h-4 w-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => c.setShowDims((v) => !v)} aria-pressed={c.showDims} title={c.showDims ? 'Hide dimensions' : 'Show dimensions'} aria-label={c.showDims ? 'Hide dimensions' : 'Show dimensions'} className="rounded-md p-1.5 text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] hover:text-[color:var(--ws-arc)]">
              {c.showDims ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
            </button>
            <button type="button" onClick={() => void c.openSave()} disabled={busy} title="Save model" aria-label="Save model" aria-expanded={c.saveOpen} className="rounded-md p-1.5 text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] hover:text-[color:var(--ws-arc)] disabled:opacity-50">
              <Save className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>

        {c.saveOpen && <SaveStrip c={c} />}
        {c.buildError ? <p role="alert" className="absolute inset-x-3 top-11 z-20 rounded-md border border-[color:var(--ws-line-strong)] bg-[color:var(--ws-deep)] px-3 py-2 text-[12px] text-[color:var(--ws-amber)]">{c.buildError}</p> : null}

        {design && <DesignPane design={design} onClose={() => c.setDesign(null)} />}
        {!design && !viewMesh && !report && ws.fresh && status !== 'loading' && (
          <StartScreen busy={busy} onPick={(t) => void c.send(t)} onBeam={ws.startBeam} />
        )}
        {viewMesh && meshOk ? (
          <>
            <MeshArtifactView
              positions={viewMesh.positions} indices={viewMesh.indices} url={viewMesh.url} color={viewMesh.color} title={viewMesh.title}
              units={viewMesh.units} geometryUnits={viewMesh.geometryUnits} bbox_mm={viewMesh.bbox_mm} scaleNote={viewMesh.scaleNote}
              extents_mm={viewMesh.extents_mm} partList={viewMesh.partList} partRanges={viewMesh.partRanges} engineering={viewMesh.engineering}
              partStatus={report?.partStatus} selectedPart={report ? c.selectedPart : undefined} onPickPart={report ? c.setSelectedPart : undefined}
              className="absolute inset-x-0 bottom-0 top-10" testId="viewport-model"
            />
            {report ? (
              <BuildReportCard report={report} title={build?.title} onClose={closeBuild}
                selected={c.selectedPart} onSelect={c.setSelectedPart} onEdit={c.editBuild} onSize={c.sizeBuild} lastSizing={build?.sizing ?? null} busy={c.buildBusy} stepHref={stepHref}
                className="absolute z-20 bg-[color:var(--ws-glass-strong)] max-sm:inset-x-2 max-sm:bottom-2 max-sm:max-h-[48%] sm:right-3 sm:top-[4.75rem] sm:max-h-[calc(100%-5.5rem)] sm:w-72 sm:max-w-[calc(100%-1.5rem)]" />
            ) : (
            <div className="ws-glass absolute right-3 top-[4.75rem] z-20 flex max-h-[calc(100%-5.5rem)] w-60 max-w-[calc(100%-1.5rem)] flex-col rounded-lg" data-testid="viewport-parts">
              <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ws-line)] px-3 py-2 text-xs font-medium text-[color:var(--ws-text)]">
                <span className="flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5" aria-hidden /> Parts{viewMesh.partList?.length ? ` (${viewMesh.partList.length})` : ''}</span>
                <button type="button" onClick={() => c.setViewMesh(null)} className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">Back to study</button>
              </div>
              {viewMesh.partList?.length ? (
                <ul className="min-h-0 overflow-y-auto px-3 py-2 text-[11px] text-[color:var(--ws-muted)]">
                  {viewMesh.partList.map((pt, i) => (
                    <li key={`${pt.name}-${i}`} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate capitalize">{pt.name}</span>
                      {Array.isArray(pt.size_mm) && <span className="ws-num shrink-0 text-[color:var(--ws-faint)]">{pt.size_mm.join('×')}</span>}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="border-t border-[color:var(--ws-line)] px-3 py-1.5 text-[10px] text-[color:var(--ws-faint)]">
                {viewMesh.bbox_mm ? `Overall ${viewMesh.bbox_mm.length}×${viewMesh.bbox_mm.height}×${viewMesh.bbox_mm.width} mm (L×H×W) · ` : ''}
                {typeof viewMesh.triangleCount === 'number' ? `${viewMesh.triangleCount} triangles · ` : ''}drag to orbit
              </p>
            </div>
            )}
          </>
        ) : report ? (
          <div className="absolute inset-0 flex items-start justify-center overflow-y-auto px-3 pb-3 pt-11">
            <BuildReportCard report={report} title={build?.title} onClose={closeBuild} onEdit={c.editBuild} onSize={c.sizeBuild} lastSizing={build?.sizing ?? null} busy={c.buildBusy} stepHref={stepHref} className="w-full max-w-xl" />
          </div>
        ) : (
          <BeamViewport
            dims={inputs.dims} support={inputs.support} utilization={c.utilization} view={c.view} display={c.display} showDims={c.showDims}
            leftInset={c.paramsOpen ? 0.22 : 0} solving={status === 'solving'} callouts={callouts}
            onDimFocus={(key) => { c.setParamsOpen(true); c.setMobileTab('model'); requestAnimationFrame(() => requestAnimationFrame(() => c.paramRef.current?.focus(key))); }}
          />
        )}

        {!viewMesh && !report && (
          <div className="ws-glass absolute left-3 top-11 z-10 w-52 max-w-[calc(100%-1.5rem)] rounded-lg">
            <button type="button" onClick={() => c.setParamsOpen((v) => !v)} aria-expanded={c.paramsOpen} className="flex w-full items-center justify-between px-3 py-2">
              <span className="ws-label flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Parameters</span>
              {c.paramsOpen ? <ChevronUp className="h-3.5 w-3.5 text-[color:var(--ws-muted)]" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5 text-[color:var(--ws-muted)]" aria-hidden />}
            </button>
            {c.paramsOpen && (
              <div className="border-t border-[color:var(--ws-line)] px-3 pb-3 pt-2">
                <ParameterPanel ref={c.paramRef} inputs={inputs} materials={c.materials} onChange={setInputs} />
                <button type="button" onClick={() => void c.send('run fea')} disabled={busy}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-[color:var(--ws-arc)] py-1.5 text-xs font-semibold tracking-wide text-[color:var(--ws-void)] shadow-[0_0_16px_rgba(89,227,255,0.35)] transition-[filter] hover:brightness-110 disabled:opacity-60">
                  {status === 'solving' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Run FEA
                </button>
              </div>
            )}
          </div>
        )}

        {!viewMesh && (
          <div className="absolute right-3 top-11 z-10 flex max-w-[60%] flex-wrap items-center justify-end gap-1.5">
            {c.utilization && (c.display === 'stress' || c.display === 'wire-stress') && (
              <div className="ws-glass hidden items-center gap-1.5 rounded-md px-2 py-1 sm:flex">
                <span className="ws-label">Utilization</span>
                <span className="h-1.5 w-16 rounded" style={{ background: `linear-gradient(90deg, ${utilizationColor(0)}, ${utilizationColor(0.5)}, ${utilizationColor(0.8)}, ${utilizationColor(1)})` }} aria-hidden />
                <span className="ws-num text-[10px] text-[color:var(--ws-muted)]">0–100%</span>
              </div>
            )}
            <Segmented label="View" value={c.view} options={(Object.keys(VIEW_LABELS) as ViewPreset[]).map((v) => [v, VIEW_LABELS[v]])} onChange={(v) => c.setView(v as ViewPreset)} />
            <Segmented className="hidden sm:flex" label="Display" value={c.display} options={(Object.keys(DISPLAY_LABELS) as DisplayMode[]).map((v) => [v, DISPLAY_LABELS[v]])} onChange={(v) => c.setDisplay(v as DisplayMode)} />
          </div>
        )}

        {/* Readouts float on the table's lower edge. */}
        {!viewMesh && !design && (
          <div className="absolute inset-x-3 bottom-3 z-10 space-y-1.5">
            {ws.notice && <p role="status" className="ws-glass flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[color:var(--ws-amber)]"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {ws.notice}</p>}
            {ws.error && status === 'error' && <p role="alert" className="ws-glass w-fit rounded-md px-2 py-1 text-xs text-[color:var(--ws-red)]">{ws.error}</p>}
            <StudyCards
              compact
              result={result} stale={ws.stale} status={status} onRun={() => void c.send('run fea')} keeping={c.keeping}
              onKeep={() => { if (c.guest) c.router.push(DEMO_SIGNUP_HREF); else void c.keep(); }}
              keepLabel={c.guest ? 'Create an account to keep it' : undefined}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Segmented({ label, value, options, onChange, className }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('ws-glass flex items-center rounded-md p-0.5', className)}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('rounded px-2 py-0.5 text-[11px] tracking-wide transition-colors', value === v ? 'bg-[color:var(--ws-arc-soft)] text-[color:var(--ws-arc)]' : 'text-[color:var(--ws-muted)] hover:text-[color:var(--ws-text)]')}>
          {l}
        </button>
      ))}
    </div>
  );
}

function SaveStrip({ c }: { c: WorkshopController }) {
  const { busy, saveName, setSaveName, saveTouched, ws, persistModel, setSaveOpen, setBusy } = c;
  return (
    <form
      className="ws-glass absolute inset-x-0 top-10 z-20 flex flex-wrap items-center gap-2 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !saveName.trim()) return;
        setBusy(true);
        void persistModel(saveName).then((out) => { if (!('error' in out)) setSaveOpen(false); }).finally(() => setBusy(false));
      }}
    >
      <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-[color:var(--ws-muted)]">
        Model name
        <input aria-label="Model name" value={saveName} maxLength={80}
          onChange={(e) => { saveTouched.current = true; setSaveName(e.target.value.slice(0, 80)); }}
          className="min-w-0 flex-1 rounded-md border border-[color:var(--ws-line)] bg-black/40 px-2 py-1 text-sm text-[color:var(--ws-text)] focus:border-[color:var(--ws-line-strong)] focus:outline-none" />
      </label>
      <button type="submit" disabled={busy || !saveName.trim()} className="rounded-md bg-[color:var(--ws-arc)] px-2.5 py-1 text-xs font-semibold text-[color:var(--ws-void)] disabled:opacity-50">
        {busy ? 'Saving…' : ws.partId ? 'Save (update in place)' : 'Save'}
      </button>
      {ws.partId && (
        <button type="button" disabled={busy || !saveName.trim()}
          onClick={() => { setBusy(true); void persistModel(saveName, true).then((out) => { if (!('error' in out)) setSaveOpen(false); }).finally(() => setBusy(false)); }}
          className="rounded-md border border-[color:var(--ws-line-strong)] px-2.5 py-1 text-xs text-[color:var(--ws-text)] hover:bg-[color:var(--ws-arc-soft)] disabled:opacity-50">
          Save as copy
        </button>
      )}
      <button type="button" onClick={() => setSaveOpen(false)} className="px-1 text-xs text-[color:var(--ws-muted)] hover:text-[color:var(--ws-text)]">Cancel</button>
    </form>
  );
}

// ── The table: an opened design ──────────────────────────────────────────────

function DesignOnTable({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <section aria-label="Design on the table" className="ws-table ws-corners min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--ws-line)] p-3 sm:p-4">
      <DesignBuilder id={id} embedded onBack={onBack} />
    </section>
  );
}

// ── The wall ─────────────────────────────────────────────────────────────────

function Wall({ c, onOpenDesign }: { c: WorkshopController; onOpenDesign: (id: string) => void }) {
  return (
    <section aria-label="The wall" className="ws-table ws-corners min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--ws-line)] p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="ws-glow-text text-[22px] font-semibold tracking-[0.18em] text-[color:var(--ws-text)]">THE WALL</h1>
        <p className="mt-1 text-[13px] text-[color:var(--ws-muted)]">Everything built in here. Open one and it comes down onto the table.</p>
      </header>
      <DesignsIndex embedded onOpen={onOpenDesign} />
      {c.guest ? (
        <p className="mt-8 text-[13px] text-[color:var(--ws-muted)]">Your models and kept DTUs hang here once you&rsquo;re signed in. <Link href={DEMO_SIGNUP_HREF} className="text-[color:var(--ws-arc)] underline underline-offset-2">Sign up free</Link>.</p>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="ws-label mb-2">Your models</h2>
            <div className="ws-glass rounded-lg p-2">
              <ModelsPanel refreshKey={c.refreshKey} onOpenModel={(name, dims, materialId, partId) => { c.ws.openModel(name, dims, materialId, partId); c.setDesign(null); c.setViewMesh(null); onOpenDesign(''); }} />
            </div>
          </div>
          <div>
            <h2 className="ws-label mb-2">Kept as DTUs</h2>
            <div className="ws-glass rounded-lg p-2">
              <VaultPanel refreshKey={c.refreshKey} onAsk={(d) => { onOpenDesign(''); void c.openDtu(d.id, d.title); }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Under the hood ───────────────────────────────────────────────────────────

function HoodStudy({ c, onTable }: { c: WorkshopController; onTable: () => void }) {
  const { result, ws, lastSweep } = c;
  const fresh = Boolean(result) && !ws.stale;
  const r = fresh ? result : null;
  return (
    <section aria-label="Under the hood" className="ws-table ws-corners min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--ws-line)] p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="ws-glow-text text-[22px] font-semibold tracking-[0.18em] text-[color:var(--ws-text)]">UNDER THE HOOD</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ws-muted)]">The solver&rsquo;s receipt for what&rsquo;s on the table — every number, where it came from, and what wasn&rsquo;t checked.</p>
        </div>
        <button type="button" onClick={onTable} className="rounded-md border border-[color:var(--ws-line-strong)] px-3 py-1.5 text-[12px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">Back to the table</button>
      </header>
      {!r ? (
        <p className="ws-glass rounded-lg p-4 text-[13px] text-[color:var(--ws-muted)]">
          {result ? 'The inputs changed since the last solve, so its receipt no longer describes the table. Run FEA again.' : 'Nothing solved yet. Run FEA and the solver’s receipt lands here.'}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <HoodCard title="Result">
            <Row k="Max bending stress" v={`${r.maxStressMPa.toFixed(1)} MPa`} />
            <Row k="Max deflection" v={`${r.maxDeflectionMm.toFixed(3)} mm`} />
            <Row k="Utilization" v={`${(r.utilization * 100).toFixed(1)} %`} />
            <Row k="Safety factor" v={r.safetyFactor.toFixed(2)} />
            <Row k="Verdict" v={r.pass ? 'PASS' : 'FAIL'} tone={r.pass ? 'go' : 'red'} />
            {typeof r.elapsedMs === 'number' && <Row k="Solve time" v={`${r.elapsedMs} ms`} />}
          </HoodCard>
          <HoodCard title="Hand check">
            <Row k="Agrees with FEA" v={r.handCheck.agrees ? 'yes' : 'no'} tone={r.handCheck.agrees ? 'go' : 'red'} />
            <Row k="Hand σ" v={`${r.handCheck.maxStressMPa.toFixed(1)} MPa`} />
            <Row k="Hand δ" v={`${r.handCheck.maxDeflectionMm.toFixed(3)} mm`} />
            <Row k="Stress error" v={`${(r.handCheck.stressError * 100).toFixed(2)} %`} />
            <Row k="Deflection error" v={`${(r.handCheck.deflectionError * 100).toFixed(2)} %`} />
            <Row k="Tolerance" v={`${(r.handCheck.tolerance * 100).toFixed(1)} %`} />
          </HoodCard>
          <HoodCard title="Section & material">
            <Row k="Material" v={r.material.label} />
            <Row k="E · yield" v={`${r.material.E.toLocaleString()} MPa · ${r.material.yield} MPa`} />
            <Row k="Area" v={`${r.section.areaMm2.toLocaleString()} mm²`} />
            <Row k="Ix" v={`${r.section.IxMm4.toExponential(3)} mm⁴`} />
            <Row k="Iy" v={`${r.section.IyMm4.toExponential(3)} mm⁴`} />
          </HoodCard>
          <HoodCard title="Utilization by member">
            <ul className="space-y-1">
              {r.utilizationByMember.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="ws-num w-10 text-[11px] text-[color:var(--ws-muted)]">{m.id}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-[color:var(--ws-line)]"><span className="block h-full" style={{ width: `${Math.min(100, m.utilization * 100)}%`, background: utilizationColor(m.utilization) }} /></span>
                  <span className="ws-num w-14 text-right text-[11px] text-[color:var(--ws-text)]">{(m.utilization * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </HoodCard>
          {r.analysisReceipt && (
            <HoodCard title="Receipt" wide>
              <Row k="Solver" v={r.analysisReceipt.solver} />
              <Row k="Input hash" v={r.analysisReceipt.inputHash} mono />
              <Row k="Units" v={r.analysisReceipt.units} />
              {r.analysisReceipt.assumptions.length > 0 && <List title="Assumes" items={r.analysisReceipt.assumptions} />}
              {r.analysisReceipt.outOfScope.length > 0 && <List title="Not checked" items={r.analysisReceipt.outOfScope} tone="amber" />}
            </HoodCard>
          )}
          {r.warnings.length > 0 && <HoodCard title="Warnings" wide><List items={r.warnings} tone="amber" /></HoodCard>}
          {lastSweep && <HoodCard title="Last sweep" wide><SweepTable sweep={lastSweep} /></HoodCard>}
        </div>
      )}
    </section>
  );
}

function HoodDesign({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <section aria-label="Under the hood" className="ws-table ws-corners min-h-0 flex-1 overflow-y-auto rounded-xl border border-[color:var(--ws-line)] p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="ws-glow-text text-[22px] font-semibold tracking-[0.18em] text-[color:var(--ws-text)]">UNDER THE HOOD</h1>
          <p className="mt-1 text-[13px] text-[color:var(--ws-muted)]">How this design got made — each iteration, the check that failed, the candidates and what changed.</p>
        </div>
        <button type="button" onClick={onBack} className="rounded-md border border-[color:var(--ws-line-strong)] px-3 py-1.5 text-[12px] text-[color:var(--ws-arc)] hover:bg-[color:var(--ws-arc-soft)]">Back to the table</button>
      </header>
      <LiveBuild id={id} embedded />
    </section>
  );
}

function HoodCard({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn('ws-glass ws-corners rounded-lg p-4', wide && 'lg:col-span-2')}>
      <h2 className="ws-label mb-2">{title}</h2>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function Row({ k, v, tone, mono }: { k: string; v: string; tone?: 'go' | 'red'; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className="text-[color:var(--ws-muted)]">{k}</dt>
      <dd className={cn('ws-num truncate text-right', mono && 'text-[11px]', tone === 'go' ? 'text-[color:var(--ws-go)]' : tone === 'red' ? 'text-[color:var(--ws-red)]' : 'text-[color:var(--ws-text)]')}>{v}</dd>
    </div>
  );
}

function List({ title, items, tone }: { title?: string; items: string[]; tone?: 'amber' }) {
  return (
    <div className="pt-1">
      {title && <div className="ws-label mb-1">{title}</div>}
      <ul className={cn('list-disc space-y-0.5 pl-4 text-[12px] leading-relaxed', tone === 'amber' ? 'text-[color:var(--ws-amber)]' : 'text-[color:var(--ws-muted)]')}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

export default Workshop;
