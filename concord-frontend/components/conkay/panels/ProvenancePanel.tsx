'use client';

// concord-frontend/components/conkay/panels/ProvenancePanel.tsx
//
// K3 — DTU Provenance panel. Surfaces the REAL `reason.verify` verdict (Track
// B's "verification IS the product" thesis) as the panel's headline, then the
// DTU refs the verify call actually checked the claim against, laid out as a
// graph via the shared `GraphView` (Obsidian-shape) component.
//
// Honesty notes:
//   - Reads `lastVerify` + `runDtuRefs` from the real `conkayHudStore` (F2)
//     via the zustand hook (not `getState()`) so the panel re-renders live as
//     new verify calls land — a React-rendered panel should track state
//     changes, unlike the per-frame 3D scene code which deliberately reads
//     `getState()` to avoid a store-driven re-render loop.
//   - The graph is an honest hub-and-spoke: one "Claim" hub node fanning out
//     to each cited DTU ref. That's the only relationship the store actually
//     carries — `ConKayOverlay#verifyMessage` mirrors the flat `dtuRefs` array
//     a message already attached (see `conkay-skills.ts#ConKaySkillResult`),
//     not a citation DAG — so we don't invent parent/child or cross-ref edges
//     that aren't real.
//   - `reason.verify`'s deterministic floor (`server/lib/reason-verify.js`)
//     reports only the AGGREGATE verdict to the frontend (`resolved`/
//     `unresolved` citation ids never leave the server) — so when the verdict
//     is `fabricated_citation` we cannot honestly point at a single bad ref.
//     We flag the WHOLE cited set instead (hub + every edge + every ref row),
//     which is the accurate reading of the data actually available. Flagged
//     elements render red and prominent — never hidden or softened.
//   - No live run yet (`lastVerify` is null AND `runDtuRefs` is empty) → an
//     explicit empty state, never a placeholder/fabricated graph.
//
// Unit LC2 — persistent DTU "Trust" alongside the per-run "Verify" verdict.
//   - `lastVerify.confidence` (above) is a ONE-TIME, per-verification-run
//     score from the LLM-as-judge `reason.verify` macro. It says nothing
//     about the DTU's lasting trust level — it's scoped to the single claim
//     that was just checked.
//   - The persistent, revisable per-DTU score lives in a SEPARATE substrate
//     (`server/lib/dtu-confidence.js`, migration 354 `dtu_confidence`),
//     reachable via the `dtu.confidence` macro. It moves over time from real
//     citation/drift evidence, independent of any single verify call. This
//     panel fetches it for every DTU in `runDtuRefs` and renders it as a
//     visually distinct "Trust: NN% (M citations)" badge on each ref row —
//     never folded into or labelled the same as the "Verify:" headline, so a
//     user can't mistake a one-off judge score for a DTU's lasting standing.
//   - Deliberately NOT stored in `conkayHudStore`: the store's header
//     reserves write access to the socket adapter (+ the narrow F2/F7/F9
//     exceptions, each tied to one real event producer). Persistent DTU
//     confidence isn't a ConKay run event at all — it's a read the panel
//     performs on its own, so it stays as local component state instead of
//     growing the store's single-writer surface for no reason.
//   - Read-only by construction: this panel only ever calls `dtu.confidence`
//     (a pure read). Nothing here writes confidence back from a verify
//     verdict — that would double-count against the existing citation-based
//     nudge path (`dtu.create`'s citation-lineage block / the drift-monitor
//     nudge), which is an explicit v1 scope decision, not an oversight.
//   - Honest-unknown: `getConfidence` returns `known:false` (with a
//     placeholder `score:0.5`, `evidenceCount:0`) for a DTU nobody has ever
//     scored. Per that module's own doc, callers must branch on `known`, not
//     infer confidence from `score` alone — so an unscored DTU renders
//     "Trust: not yet evaluated", NEVER a bare "50%" that would look like a
//     real measurement.

import { useEffect, useState } from 'react';
import { useConkayHudStore } from '../conkayHudStore';
import { GraphView, type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';
import { lensRun } from '@/lib/api/client';

const HUB_ID = '__claim__';

const VERDICT_META: Record<string, { label: string; className: string }> = {
  proven: { label: 'Proven ✓', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  grounded: { label: 'Grounded', className: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  citations_resolve: {
    label: 'Citations resolve',
    className: 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/5',
  },
  unsupported: { label: 'Unsupported', className: 'text-amber-300 border-amber-400/30 bg-amber-400/10' },
  refuted: { label: 'Refuted', className: 'text-rose-300 border-rose-400/30 bg-rose-400/10' },
  fabricated_citation: {
    label: 'Fabricated citation',
    className: 'text-rose-300 border-rose-500/50 bg-rose-500/15',
  },
  unverified: {
    label: 'Unverified — nothing cited',
    className: 'text-cyan-300/70 border-cyan-400/20 bg-cyan-400/5',
  },
};

function verdictMeta(verdict: string) {
  return VERDICT_META[verdict] ?? { label: verdict, className: 'text-white/70 border-white/20 bg-white/5' };
}

// ── persistent DTU "Trust" (distinct from the per-run "Verify" verdict) ────

type TrustState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; known: boolean; score: number; evidenceCount: number };

/** Pure reshape of a `dtu.confidence` macro return into local trust state.
 *  Exported for pinning — never fabricates a score: `null` in ⟹ `null` out. */
export function trustStateFromConfidenceResult(result: unknown): TrustState | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { known?: unknown; score?: unknown; evidenceCount?: unknown };
  return {
    status: 'ready',
    known: r.known === true,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0.5,
    evidenceCount: typeof r.evidenceCount === 'number' && Number.isFinite(r.evidenceCount) ? r.evidenceCount : 0,
  };
}

async function fetchDtuTrust(dtuId: string): Promise<TrustState> {
  try {
    const { data } = await lensRun('dtu', 'confidence', { dtuId });
    if (!data?.ok) return { status: 'error' };
    const parsed = trustStateFromConfidenceResult(data.result);
    return parsed ?? { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** Renders the honest label + tone for a ref row's Trust badge. Never shows a
 *  bare score for a DTU that hasn't genuinely been evaluated. */
function trustMeta(t: TrustState | undefined): { label: string; className: string } {
  if (!t || t.status === 'loading') {
    return { label: 'Trust: …', className: 'text-white/30 border-white/10 bg-white/5' };
  }
  if (t.status === 'error') {
    return { label: 'Trust: unavailable', className: 'text-white/30 border-white/10 bg-white/5' };
  }
  if (!t.known) {
    return { label: 'Trust: not yet evaluated', className: 'text-white/40 border-white/10 bg-white/5' };
  }
  const pct = Math.round(t.score * 100);
  return {
    label: `Trust: ${pct}% (${t.evidenceCount} citation${t.evidenceCount === 1 ? '' : 's'})`,
    className: 'text-sky-300 border-sky-400/30 bg-sky-400/10',
  };
}

export function ProvenancePanel() {
  const lastVerify = useConkayHudStore((s) => s.lastVerify);
  const runDtuRefs = useConkayHudStore((s) => s.runDtuRefs);

  // Local, panel-only state (see the LC2 header note on why this is NOT in
  // conkayHudStore): the real, persistent per-DTU confidence for each ref in
  // the current run, keyed by dtu id. Read-only — nothing here ever writes
  // confidence back.
  const [trust, setTrust] = useState<Record<string, TrustState>>({});

  useEffect(() => {
    if (runDtuRefs.length === 0) return;
    let cancelled = false;
    const ids = runDtuRefs.map((r) => r.id);
    setTrust((prev) => {
      const next = { ...prev };
      for (const id of ids) if (!next[id]) next[id] = { status: 'loading' };
      return next;
    });
    (async () => {
      const results = await Promise.all(ids.map(async (id) => [id, await fetchDtuTrust(id)] as const));
      if (cancelled) return;
      setTrust((prev) => {
        const next = { ...prev };
        for (const [id, t] of results) next[id] = t;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [runDtuRefs]);

  if (!lastVerify && runDtuRefs.length === 0) {
    return (
      <div
        data-testid="ck-provenance-panel"
        className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
      >
        <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">dtu provenance</div>
        <div data-testid="ck-provenance-empty" className="px-1 py-2 text-[11px] text-white/40">
          No verification run yet.
        </div>
      </div>
    );
  }

  const verdict = lastVerify?.verdict ?? 'unverified';
  const flagged = verdict === 'fabricated_citation';
  const meta = verdictMeta(verdict);

  const nodes: GraphNode[] = [
    { id: HUB_ID, label: 'Claim', weight: 1, flagged },
    ...runDtuRefs.map((r) => ({
      id: r.id,
      label: r.title || r.id,
      group: r.tier ?? undefined,
      weight: 0.6,
      flagged,
    })),
  ];
  const edges: GraphEdge[] = runDtuRefs.map((r) => ({
    source: HUB_ID,
    target: r.id,
    kind: 'citation',
    flagged,
  }));

  return (
    <div
      data-testid="ck-provenance-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">dtu provenance</div>

      {/* The verdict IS the headline this panel exists to prove — never an
          afterthought below the fold. */}
      <div
        data-testid="ck-provenance-verdict"
        data-verdict={verdict}
        data-flagged={flagged ? 'true' : 'false'}
        className={`mb-2 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-[11px] font-medium ${meta.className}`}
      >
        {/* "Verify:" prefix is deliberate — this is the per-run judge
            verdict, never to be confused with the persistent per-DTU
            "Trust:" badges below (see the LC2 header note). */}
        <span className="text-[10px] opacity-60">Verify:</span>
        <span>{meta.label}</span>
        {lastVerify?.mode && <span className="text-[10px] opacity-60">via {lastVerify.mode}</span>}
        {typeof lastVerify?.confidence === 'number' && (
          <span className="text-[10px] opacity-60">{Math.round(lastVerify.confidence * 100)}%</span>
        )}
      </div>

      {runDtuRefs.length > 0 && (
        <>
          <GraphView nodes={nodes} edges={edges} />
          <ul className="mt-2 space-y-1">
            {runDtuRefs.map((r) => {
              const tMeta = trustMeta(trust[r.id]);
              return (
                <li
                  key={r.id}
                  data-testid={`ck-provenance-ref-${r.id}`}
                  data-flagged={flagged ? 'true' : 'false'}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-[11px] ${
                    flagged
                      ? 'border border-rose-500/40 bg-rose-500/10 text-rose-300'
                      : 'text-cyan-100/80'
                  }`}
                >
                  <span className="truncate">{r.title || r.id}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.tier && <span className="text-[10px] opacity-60">{r.tier}</span>}
                    {/* Persistent per-DTU confidence — a SEPARATE signal from
                        the "Verify:" headline above. See the LC2 header note:
                        never merge these two into one badge or one label. */}
                    <span
                      data-testid={`ck-provenance-trust-${r.id}`}
                      data-trust-status={trust[r.id]?.status ?? 'loading'}
                      data-trust-known={
                        trust[r.id]?.status === 'ready' ? String((trust[r.id] as { known: boolean }).known) : 'pending'
                      }
                      className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${tMeta.className}`}
                    >
                      {tMeta.label}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default ProvenancePanel;
