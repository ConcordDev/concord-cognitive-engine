'use client';

/**
 * KialoArgumentMap — full Kialo-shape structured-debate workbench.
 *
 * Surfaces the complete debate-domain backlog: a recursive impact-weighted
 * claim tree with collapse/expand, per-claim impact rating that propagates
 * up the tree, multi-thesis positions, claim sourcing (evidence/citations),
 * a perspective filter that views the tree from one side's lens, and
 * public read-only share links.
 *
 * Every claim, source and position here is real user input — nothing is
 * seeded. Empty states say so explicitly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scale, Plus, Trash2, ThumbsUp, ThumbsDown, Loader2, Link2, BookOpen,
  ChevronRight, ChevronDown, Gauge, Layers, Eye, Share2, X, ExternalLink,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/* ── shapes ─────────────────────────────────────────────────────── */

interface Source {
  id: string;
  title: string;
  url: string;
  kind: string;
  note: string;
  addedAt: string;
}
interface Claim {
  id: string;
  parentId: string | null;
  positionId: string | null;
  stance: string;
  text: string;
  weight: number;
  effective: number;
  voteCount: number;
  impact: number | null;
  sources: Source[];
}
interface Position {
  id: string;
  label: string;
  summary: string;
}
interface Score {
  proTotal: number;
  conTotal: number;
  net: number;
  supportPct: number;
  verdict: string;
}
interface Debate {
  id: string;
  thesis: string;
  positions: Position[];
  claims: Claim[];
  shareToken?: string | null;
}
interface DebateMeta {
  id: string;
  thesis: string;
  claimCount: number;
  positionCount: number;
  shared: boolean;
  shareToken: string | null;
  score: Score;
  updatedAt: string;
}
interface PositionScore {
  id: string;
  label: string;
  summary: string;
  claimCount: number;
  support: number;
  sharePct: number;
}

type Perspective = 'all' | 'pro' | 'con';

const SOURCE_KINDS = ['study', 'article', 'data', 'book', 'primary', 'other'] as const;

const VERDICT_COLOR: Record<string, string> = {
  'well-supported': 'text-emerald-400',
  'leaning-for': 'text-cyan-400',
  'leaning-against': 'text-amber-400',
  'poorly-supported': 'text-rose-400',
};

/* ── component ──────────────────────────────────────────────────── */

export function KialoArgumentMap() {
  const [debates, setDebates] = useState<DebateMeta[]>([]);
  const [active, setActive] = useState<Debate | null>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [positionScores, setPositionScores] = useState<PositionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newThesis, setNewThesis] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [perspective, setPerspective] = useState<Perspective>('all');
  const [sourcingClaim, setSourcingClaim] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [newPosition, setNewPosition] = useState({ label: '', summary: '' });
  const [showPositions, setShowPositions] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  /* ── data loads ───────────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    const r = await lensRun('debate', 'debate-list', {});
    if (r.data?.ok) setDebates((r.data.result?.debates as DebateMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const loadPositionScores = useCallback(async (debateId: string) => {
    const r = await lensRun('debate', 'position-scores', { debateId });
    if (r.data?.ok) setPositionScores((r.data.result?.positions as PositionScore[]) || []);
    else setPositionScores([]);
  }, []);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('debate', 'debate-detail', { id });
    if (r.data?.ok) {
      const d = r.data.result?.debate as Debate;
      setActive(d);
      setScore(r.data.result?.score as Score);
      setShareUrl(d.shareToken ? `/lenses/debate?share=${d.shareToken}` : null);
      void loadPositionScores(id);
    }
  }, [loadPositionScores]);

  const reload = useCallback(async () => {
    if (active) { await open(active.id); }
    await refresh();
  }, [active, open, refresh]);

  /* ── debate CRUD ──────────────────────────────────────────────── */

  async function createDebate() {
    if (newThesis.trim().length < 8) return;
    setBusy(true);
    const r = await lensRun('debate', 'debate-create', { thesis: newThesis.trim() });
    setNewThesis('');
    await refresh();
    if (r.data?.ok) await open((r.data.result as { debate: Debate }).debate.id);
    setBusy(false);
  }
  async function deleteDebate(id: string) {
    setBusy(true);
    await lensRun('debate', 'debate-delete', { id });
    if (active?.id === id) { setActive(null); setScore(null); setPositionScores([]); }
    await refresh();
    setBusy(false);
  }

  /* ── claims ───────────────────────────────────────────────────── */

  async function addClaim(parentId: string | null, stance: 'pro' | 'con', text: string, positionId: string | null) {
    if (!active || text.trim().length < 4) return;
    setBusy(true);
    await lensRun('debate', 'claim-add', {
      debateId: active.id, parentId, stance, text: text.trim(),
      positionId: parentId ? null : positionId,
    });
    await reload();
    setBusy(false);
  }
  async function voteClaim(claimId: string, weight: number) {
    if (!active) return;
    await lensRun('debate', 'claim-vote', { debateId: active.id, claimId, weight });
    await reload();
  }
  async function rateImpact(claimId: string, impact: number) {
    if (!active) return;
    await lensRun('debate', 'claim-impact', { debateId: active.id, claimId, impact });
    await reload();
  }
  async function removeClaim(claimId: string) {
    if (!active) return;
    setBusy(true);
    await lensRun('debate', 'claim-delete', { debateId: active.id, claimId });
    await reload();
    setBusy(false);
  }

  /* ── sources ──────────────────────────────────────────────────── */

  async function addSource(claimId: string, src: { title: string; url: string; kind: string; note: string }) {
    if (!active || src.title.trim().length < 3) return;
    setBusy(true);
    const r = await lensRun('debate', 'source-add', {
      debateId: active.id, claimId,
      title: src.title.trim(), url: src.url.trim(), kind: src.kind, note: src.note.trim(),
    });
    if (r.data?.ok) await reload();
    setBusy(false);
    return r.data?.ok;
  }
  async function removeSource(claimId: string, sourceId: string) {
    if (!active) return;
    await lensRun('debate', 'source-delete', { debateId: active.id, claimId, sourceId });
    await reload();
  }

  /* ── positions ────────────────────────────────────────────────── */

  async function addPosition() {
    if (!active || newPosition.label.trim().length < 3) return;
    setBusy(true);
    await lensRun('debate', 'position-add', {
      debateId: active.id, label: newPosition.label.trim(), summary: newPosition.summary.trim(),
    });
    setNewPosition({ label: '', summary: '' });
    await reload();
    setBusy(false);
  }
  async function removePosition(positionId: string) {
    if (!active) return;
    setBusy(true);
    await lensRun('debate', 'position-delete', { debateId: active.id, positionId });
    if (positionFilter === positionId) setPositionFilter(null);
    await reload();
    setBusy(false);
  }

  /* ── sharing ──────────────────────────────────────────────────── */

  async function toggleShare() {
    if (!active) return;
    setBusy(true);
    const revoke = !!active.shareToken;
    const r = await lensRun('debate', 'debate-share', { debateId: active.id, revoke });
    if (r.data?.ok) {
      const res = r.data.result as { shared: boolean; url?: string };
      setShareUrl(res.shared ? (res.url || null) : null);
    }
    await reload();
    setBusy(false);
  }

  /* ── tree helpers ─────────────────────────────────────────────── */

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const visibleRoots = useMemo<Claim[]>(() => {
    if (!active) return [];
    return active.claims.filter((c) => {
      if (c.parentId !== null) return false;
      if (positionFilter && c.positionId !== positionFilter) return false;
      return true;
    });
  }, [active, positionFilter]);

  /** A claim survives the perspective filter if it (or any descendant) matches. */
  const claimMatchesPerspective = useCallback((claim: Claim): boolean => {
    if (perspective === 'all') return true;
    if (claim.stance === perspective) return true;
    if (!active) return false;
    return active.claims
      .filter((c) => c.parentId === claim.id)
      .some((child) => claimMatchesPerspective(child));
  }, [perspective, active]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div data-testid="kialo-argument-map">
      <div className="flex items-center gap-2 mb-3">
        <Scale className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-white">Argument Map</h3>
        <span className="text-[11px] text-gray-400">Kialo-shape · impact-weighted</span>
        {busy && <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />}
      </div>

      {/* New thesis */}
      <div className="flex gap-1.5 mb-3">
        <input
          value={newThesis}
          onChange={(e) => setNewThesis(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createDebate(); }}
          placeholder="State a thesis to debate…"
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
        />
        <button
          onClick={createDebate}
          disabled={newThesis.trim().length < 8 || busy}
          className="px-3 py-1.5 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40"
        >
          New debate
        </button>
      </div>

      <div className="grid lg:grid-cols-[230px_1fr] gap-3">
        {/* ── debate list ─────────────────────────────────────────── */}
        <ul className="space-y-1">
          {debates.length === 0 && (
            <li className="text-[11px] text-gray-400 italic">No debates yet. Create one above.</li>
          )}
          {debates.map((d) => (
            <li key={d.id} className="group flex items-center gap-1">
              <button
                onClick={() => open(d.id)}
                className={cn(
                  'flex-1 text-left rounded-lg px-2.5 py-2 border',
                  active?.id === d.id
                    ? 'bg-cyan-600/15 border-cyan-700/50'
                    : 'bg-black/30 border-white/10 hover:border-white/20',
                )}
              >
                <p className="text-xs font-semibold text-white line-clamp-2">{d.thesis}</p>
                <p className="text-[10px] text-gray-400 flex items-center gap-1.5 mt-0.5">
                  <span>{d.claimCount} claims</span>
                  {d.positionCount > 0 && <span>· {d.positionCount} positions</span>}
                  <span className={cn('font-semibold', VERDICT_COLOR[d.score.verdict] || 'text-gray-400')}>
                    · {d.score.supportPct}%
                  </span>
                  {d.shared && <Link2 className="w-2.5 h-2.5 text-cyan-400" />}
                </p>
              </button>
              <button
                onClick={() => deleteDebate(d.id)}
                disabled={busy}
                aria-label="Delete debate"
                className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>

        {/* ── active debate ───────────────────────────────────────── */}
        {active ? (
          <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
            {/* header + score */}
            <div className="flex items-start gap-2">
              <p className="text-sm font-bold text-white flex-1">{active.thesis}</p>
              {score && (
                <div className="text-right shrink-0">
                  <p className={cn('text-lg font-bold leading-none', VERDICT_COLOR[score.verdict] || 'text-gray-400')}>
                    {score.supportPct}%
                  </p>
                  <p className="text-[9px] text-gray-400 capitalize">{score.verdict.replace(/-/g, ' ')}</p>
                </div>
              )}
            </div>
            {score && (
              <div className="flex h-1.5 rounded overflow-hidden" title={`Pro ${score.proTotal} · Con ${score.conTotal}`}>
                <div className="bg-emerald-500" style={{ width: `${score.supportPct}%` }} />
                <div className="bg-rose-500" style={{ width: `${100 - score.supportPct}%` }} />
              </div>
            )}

            {/* toolbar: perspective filter · positions · share */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded p-0.5">
                <Eye className="w-3 h-3 text-gray-400 ml-1" />
                {(['all', 'pro', 'con'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPerspective(p)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] rounded capitalize font-semibold',
                      perspective === p
                        ? p === 'pro'
                          ? 'bg-emerald-600/30 text-emerald-300'
                          : p === 'con'
                            ? 'bg-rose-600/30 text-rose-300'
                            : 'bg-cyan-600/30 text-cyan-300'
                        : 'text-gray-400 hover:text-gray-300',
                    )}
                  >
                    {p === 'all' ? 'All sides' : p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowPositions((s) => !s)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[10px] rounded border',
                  showPositions || active.positions.length > 0
                    ? 'border-violet-700/50 bg-violet-600/15 text-violet-300'
                    : 'border-white/10 bg-black/40 text-gray-400 hover:text-gray-200',
                )}
              >
                <Layers className="w-3 h-3" /> Positions ({active.positions.length})
              </button>
              <button
                onClick={toggleShare}
                disabled={busy}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-[10px] rounded border',
                  active.shareToken
                    ? 'border-cyan-700/50 bg-cyan-600/15 text-cyan-300'
                    : 'border-white/10 bg-black/40 text-gray-400 hover:text-gray-200',
                )}
              >
                <Share2 className="w-3 h-3" /> {active.shareToken ? 'Shared' : 'Share'}
              </button>
              {visibleRoots.length > 0 && (
                <button
                  onClick={() =>
                    setCollapsed((prev) =>
                      prev.size > 0 ? new Set() : new Set(active.claims.map((c) => c.id)))
                  }
                  className="px-2 py-1 text-[10px] rounded border border-white/10 bg-black/40 text-gray-400 hover:text-gray-200"
                >
                  {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>

            {/* share link readout */}
            {shareUrl && (
              <div className="flex items-center gap-2 bg-cyan-950/30 border border-cyan-800/40 rounded px-2 py-1.5">
                <Link2 className="w-3 h-3 text-cyan-400 shrink-0" />
                <code className="text-[10px] text-cyan-300 flex-1 truncate">{shareUrl}</code>
                <button
                  onClick={() => { void navigator.clipboard?.writeText(shareUrl); }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-700/40 text-cyan-200 hover:bg-cyan-600/50"
                >
                  Copy
                </button>
              </div>
            )}

            {/* positions panel */}
            {showPositions && (
              <PositionsPanel
                positions={active.positions}
                scores={positionScores}
                positionFilter={positionFilter}
                newPosition={newPosition}
                busy={busy}
                onFilter={setPositionFilter}
                onChangeNew={setNewPosition}
                onAdd={addPosition}
                onRemove={removePosition}
              />
            )}

            {/* claim tree */}
            {visibleRoots.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic py-2">
                {positionFilter
                  ? 'No claims attached to this position yet.'
                  : 'No claims yet. Add the first pro or con claim below.'}
              </p>
            ) : null}
            <ClaimBranch
              claims={active.claims}
              parentId={null}
              depth={0}
              positionFilter={positionFilter}
              perspective={perspective}
              collapsed={collapsed}
              sourcingClaim={sourcingClaim}
              busy={busy}
              claimMatchesPerspective={claimMatchesPerspective}
              onToggleCollapse={toggleCollapse}
              onAdd={addClaim}
              onVote={voteClaim}
              onImpact={rateImpact}
              onDelete={removeClaim}
              onAddSource={addSource}
              onRemoveSource={removeSource}
              onOpenSourcing={setSourcingClaim}
            />
            {/* root composer */}
            <RootComposer
              positions={active.positions}
              busy={busy}
              onAdd={(stance, text, positionId) => addClaim(null, stance, text, positionId)}
            />
          </div>
        ) : (
          <div className="bg-black/20 border border-dashed border-white/10 rounded-lg flex items-center justify-center text-xs text-gray-400 min-h-[180px]">
            Select or create a debate to map its arguments.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── positions panel ────────────────────────────────────────────── */

function PositionsPanel({
  positions, scores, positionFilter, newPosition, busy,
  onFilter, onChangeNew, onAdd, onRemove,
}: {
  positions: Position[];
  scores: PositionScore[];
  positionFilter: string | null;
  newPosition: { label: string; summary: string };
  busy: boolean;
  onFilter: (id: string | null) => void;
  onChangeNew: (v: { label: string; summary: string }) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const maxAbs = Math.max(1, ...scores.map((s) => Math.abs(s.support)));
  return (
    <div className="bg-violet-950/20 border border-violet-800/30 rounded-lg p-2.5 space-y-2">
      <p className="text-[10px] uppercase tracking-wide text-violet-300 font-semibold">
        Multi-thesis positions
      </p>
      {positions.length === 0 ? (
        <p className="text-[10px] text-gray-400 italic">
          No positions yet. Add competing positions for a non-binary debate.
        </p>
      ) : (
        <ul className="space-y-1">
          {positions.map((p) => {
            const sc = scores.find((s) => s.id === p.id);
            const support = sc?.support ?? 0;
            return (
              <li
                key={p.id}
                className={cn(
                  'group rounded border px-2 py-1.5',
                  positionFilter === p.id
                    ? 'border-violet-600/60 bg-violet-600/15'
                    : 'border-white/10 bg-black/30',
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onFilter(positionFilter === p.id ? null : p.id)}
                    className="flex-1 text-left"
                  >
                    <p className="text-xs font-semibold text-white">{p.label}</p>
                    {p.summary && <p className="text-[10px] text-gray-400">{p.summary}</p>}
                  </button>
                  <span
                    className={cn(
                      'text-[10px] font-mono',
                      support > 0 ? 'text-emerald-400' : support < 0 ? 'text-rose-400' : 'text-gray-400',
                    )}
                  >
                    {support > 0 ? '+' : ''}{support.toFixed(1)}
                  </span>
                  <button
                    onClick={() => onRemove(p.id)}
                    disabled={busy}
                    aria-label="Remove position"
                    className="opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {sc && (
                  <div className="mt-1 h-1 bg-black/50 rounded overflow-hidden">
                    <div
                      className={cn('h-full', support >= 0 ? 'bg-emerald-500' : 'bg-rose-500')}
                      style={{ width: `${Math.round((Math.abs(support) / maxAbs) * 100)}%` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <input
          value={newPosition.label}
          onChange={(e) => onChangeNew({ ...newPosition, label: e.target.value })}
          placeholder="Position label…"
          className="flex-1 min-w-[100px] bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
        />
        <input
          value={newPosition.summary}
          onChange={(e) => onChangeNew({ ...newPosition, summary: e.target.value })}
          placeholder="Summary (optional)"
          className="flex-1 min-w-[120px] bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
        />
        <button
          onClick={onAdd}
          disabled={newPosition.label.trim().length < 3 || busy}
          className="px-2 py-1 text-[10px] rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40"
        >
          <Plus className="w-3 h-3 inline" /> Add
        </button>
      </div>
    </div>
  );
}

/* ── recursive claim branch ─────────────────────────────────────── */

interface BranchProps {
  claims: Claim[];
  parentId: string | null;
  depth: number;
  positionFilter: string | null;
  perspective: Perspective;
  collapsed: Set<string>;
  sourcingClaim: string | null;
  busy: boolean;
  claimMatchesPerspective: (c: Claim) => boolean;
  onToggleCollapse: (id: string) => void;
  onAdd: (parentId: string | null, stance: 'pro' | 'con', text: string, positionId: string | null) => void;
  onVote: (claimId: string, weight: number) => void;
  onImpact: (claimId: string, impact: number) => void;
  onDelete: (claimId: string) => void;
  onAddSource: (claimId: string, src: { title: string; url: string; kind: string; note: string }) => Promise<boolean | undefined>;
  onRemoveSource: (claimId: string, sourceId: string) => void;
  onOpenSourcing: (id: string | null) => void;
}

function ClaimBranch(props: BranchProps) {
  const {
    claims, parentId, depth, positionFilter, collapsed,
    claimMatchesPerspective, onToggleCollapse,
  } = props;

  const kids = claims.filter((c) => {
    if (c.parentId !== parentId) return false;
    if (depth === 0 && positionFilter && c.positionId !== positionFilter) return false;
    return claimMatchesPerspective(c);
  });

  if (kids.length === 0 && depth > 0) return null;

  return (
    <div className={cn(depth > 0 && 'pl-3 border-l border-white/10 ml-1')}>
      {kids.map((c) => {
        const childCount = claims.filter((x) => x.parentId === c.id).length;
        const isCollapsed = collapsed.has(c.id);
        return (
          <div key={c.id} className="mb-1.5">
            <ClaimCard
              claim={c}
              childCount={childCount}
              isCollapsed={isCollapsed}
              busy={props.busy}
              sourcingOpen={props.sourcingClaim === c.id}
              onToggleCollapse={() => onToggleCollapse(c.id)}
              onVote={props.onVote}
              onImpact={props.onImpact}
              onDelete={props.onDelete}
              onAddSource={props.onAddSource}
              onRemoveSource={props.onRemoveSource}
              onOpenSourcing={props.onOpenSourcing}
            />
            {!isCollapsed && (
              <>
                <ClaimBranch {...props} parentId={c.id} depth={depth + 1} />
                <InlineComposer
                  depth={depth + 1}
                  busy={props.busy}
                  onAdd={(stance, text) => props.onAdd(c.id, stance, text, null)}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── single claim card ──────────────────────────────────────────── */

function ClaimCard({
  claim, childCount, isCollapsed, busy, sourcingOpen,
  onToggleCollapse, onVote, onImpact, onDelete, onAddSource, onRemoveSource, onOpenSourcing,
}: {
  claim: Claim;
  childCount: number;
  isCollapsed: boolean;
  busy: boolean;
  sourcingOpen: boolean;
  onToggleCollapse: () => void;
  onVote: (claimId: string, weight: number) => void;
  onImpact: (claimId: string, impact: number) => void;
  onDelete: (claimId: string) => void;
  onAddSource: (claimId: string, src: { title: string; url: string; kind: string; note: string }) => Promise<boolean | undefined>;
  onRemoveSource: (claimId: string, sourceId: string) => void;
  onOpenSourcing: (id: string | null) => void;
}) {
  const isPro = claim.stance === 'pro';
  const sources = claim.sources || [];
  return (
    <div
      className={cn(
        'group rounded px-2 py-1.5 border-l-2',
        isPro ? 'bg-emerald-950/20 border-emerald-600' : 'bg-rose-950/20 border-rose-600',
      )}
    >
      <div className="flex items-start gap-1.5">
        {childCount > 0 ? (
          <button
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? 'Expand sub-claims' : 'Collapse sub-claims'}
            className="text-gray-400 hover:text-gray-200 mt-0.5"
          >
            {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className={cn('text-[9px] font-bold uppercase mt-0.5', isPro ? 'text-emerald-400' : 'text-rose-400')}>
          {claim.stance}
        </span>
        <p className="text-xs text-gray-200 flex-1">{claim.text}</p>
        {childCount > 0 && isCollapsed && (
          <span className="text-[9px] text-gray-400 shrink-0 mt-0.5">{childCount} sub</span>
        )}
        <span
          className="text-[10px] text-gray-400 shrink-0 mt-0.5 font-mono"
          title={`Vote weight ${claim.weight} · effective strength ${claim.effective}`}
        >
          {claim.effective.toFixed(1)}
        </span>
        <button onClick={() => onVote(claim.id, 5)} aria-label="Vote up" className="text-gray-600 hover:text-emerald-400">
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button onClick={() => onVote(claim.id, 1)} aria-label="Vote down" className="text-gray-600 hover:text-rose-400">
          <ThumbsDown className="w-3 h-3" />
        </button>
        <button
          onClick={() => onOpenSourcing(sourcingOpen ? null : claim.id)}
          aria-label="Sources"
          className={cn(
            'relative',
            sources.length > 0 ? 'text-cyan-400' : 'text-gray-600 hover:text-cyan-400',
          )}
        >
          <BookOpen className="w-3 h-3" />
          {sources.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 text-[8px] bg-cyan-600 rounded-full px-1 text-white">
              {sources.length}
            </span>
          )}
        </button>
        <button
          onClick={() => onDelete(claim.id)}
          disabled={busy}
          aria-label="Delete claim"
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-rose-400"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* impact rating row */}
      <div className="flex items-center gap-1.5 mt-1 pl-[18px]">
        <Gauge className="w-2.5 h-2.5 text-gray-600" />
        <span className="text-[9px] text-gray-400">Impact</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onImpact(claim.id, n)}
            aria-label={`Set impact ${n}`}
            className={cn(
              'w-2.5 h-2.5 rounded-sm',
              (claim.impact || 3) >= n
                ? isPro ? 'bg-emerald-500' : 'bg-rose-500'
                : 'bg-white/10 hover:bg-white/25',
            )}
          />
        ))}
        <span className="text-[9px] text-gray-400">{claim.impact ? `${claim.impact}/5` : 'default 3'}</span>
        {claim.voteCount > 0 && (
          <span className="text-[9px] text-gray-400 ml-auto">{claim.voteCount} votes</span>
        )}
      </div>

      {/* source list */}
      {sources.length > 0 && (
        <ul className="mt-1 pl-[18px] space-y-0.5">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="px-1 rounded bg-cyan-900/40 text-cyan-300 uppercase text-[8px]">{s.kind}</span>
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-300 hover:underline truncate flex items-center gap-0.5"
                >
                  {s.title} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              ) : (
                <span className="text-gray-300 truncate">{s.title}</span>
              )}
              {s.note && <span className="text-gray-600 truncate">— {s.note}</span>}
              <button
                onClick={() => onRemoveSource(claim.id, s.id)}
                aria-label="Remove source"
                className="ml-auto text-gray-600 hover:text-rose-400 shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* sourcing form */}
      {sourcingOpen && (
        <SourceForm
          claimId={claim.id}
          busy={busy}
          onAdd={onAddSource}
          onClose={() => onOpenSourcing(null)}
        />
      )}
    </div>
  );
}

/* ── source form ────────────────────────────────────────────────── */

function SourceForm({
  claimId, busy, onAdd, onClose,
}: {
  claimId: string;
  busy: boolean;
  onAdd: (claimId: string, src: { title: string; url: string; kind: string; note: string }) => Promise<boolean | undefined>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<string>('study');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (url && !/^https?:\/\//i.test(url)) {
      setErr('URL must start with http(s)://');
      return;
    }
    const ok = await onAdd(claimId, { title, url, kind, note });
    if (ok) { setTitle(''); setUrl(''); setNote(''); onClose(); }
    else setErr('Could not add source — check the title and URL.');
  }

  return (
    <div className="mt-1.5 pl-[18px] space-y-1.5 bg-black/30 rounded p-1.5">
      <div className="flex gap-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Source title…"
          className="flex-1 bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="bg-black/40 border border-white/15 rounded px-1 py-1 text-[10px] text-white"
        >
          {SOURCE_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://… (optional)"
        className="w-full bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="w-full bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
      />
      {err && <p className="text-[10px] text-rose-400">{err}</p>}
      <div className="flex gap-1.5">
        <button
          onClick={submit}
          disabled={title.trim().length < 3 || busy}
          className="px-2 py-1 text-[10px] rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40"
        >
          Add source
        </button>
        <button
          onClick={onClose}
          className="px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── inline sub-claim composer ──────────────────────────────────── */

function InlineComposer({
  depth, busy, onAdd,
}: {
  depth: number;
  busy: boolean;
  onAdd: (stance: 'pro' | 'con', text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [stance, setStance] = useState<'pro' | 'con'>('pro');
  function submit() {
    if (draft.trim().length >= 4) { onAdd(stance, draft); setDraft(''); }
  }
  return (
    <div className={cn('flex gap-1 mt-1', depth > 0 && 'pl-3 ml-1')}>
      <select
        value={stance}
        onChange={(e) => setStance(e.target.value as 'pro' | 'con')}
        aria-label="Sub-claim stance"
        className="bg-black/40 border border-white/15 rounded px-1 py-0.5 text-[10px] text-white"
      >
        <option value="pro">Pro</option>
        <option value="con">Con</option>
      </select>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Add a counter-claim…"
        className="flex-1 bg-black/40 border border-white/15 rounded px-1.5 py-0.5 text-[11px] text-white"
      />
      <button
        onClick={submit}
        disabled={draft.trim().length < 4 || busy}
        aria-label="Add sub-claim"
        className="px-1.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

/* ── root claim composer (with position attach) ─────────────────── */

function RootComposer({
  positions, busy, onAdd,
}: {
  positions: Position[];
  busy: boolean;
  onAdd: (stance: 'pro' | 'con', text: string, positionId: string | null) => void;
}) {
  const [draft, setDraft] = useState('');
  const [stance, setStance] = useState<'pro' | 'con'>('pro');
  const [positionId, setPositionId] = useState<string>('');
  function submit() {
    if (draft.trim().length >= 4) {
      onAdd(stance, draft, positionId || null);
      setDraft('');
    }
  }
  return (
    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/10">
      <select
        value={stance}
        onChange={(e) => setStance(e.target.value as 'pro' | 'con')}
        aria-label="Claim stance"
        className="bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
      >
        <option value="pro">Pro</option>
        <option value="con">Con</option>
      </select>
      {positions.length > 0 && (
        <select
          value={positionId}
          onChange={(e) => setPositionId(e.target.value)}
          aria-label="Attach to position"
          className="bg-black/40 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white"
        >
          <option value="">No position</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Add a root claim…"
        className="flex-1 min-w-[140px] bg-black/40 border border-white/15 rounded px-2 py-1 text-[11px] text-white"
      />
      <button
        onClick={submit}
        disabled={draft.trim().length < 4 || busy}
        className="px-2.5 py-1 text-[11px] rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40"
      >
        <Plus className="w-3 h-3 inline" /> Add claim
      </button>
    </div>
  );
}
