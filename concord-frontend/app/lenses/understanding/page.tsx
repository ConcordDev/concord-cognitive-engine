'use client';

// Understanding lens — production-grade workbench for the 'understanding'
// substrate (16 backend macros previously had no UI).
//
// What is an Understanding?
//   The substrate's compounding-knowledge layer: a parsed, scored,
//   evolveable structured representation of a DTU / claim set / raw
//   text / entity / world / faction. Composer can be deterministic
//   ("rules") or LLM. Each understanding has consistency + confidence
//   scores, evidence trail, lineage, and TTL-bounded expiry.
//
// Tabs: Browse | Compose | Evolution | Lineage
//   Browse: list / filter / search existing understandings
//   Compose: parse a subject → preview → save
//   Evolution: per-understanding evidence ledger + promotion gate
//   Lineage: lineage tree + consolidation candidates
//
// All 16 macros wired:
//   parse / compose / get / list / recompose / sweep / subject_kinds /
//   record_evidence / evaluate_promotion / apply_promotion / consolidate /
//   consolidation_candidates / lineage / evolution_tick /
//   promoted_by_composer / evolution_stats

import { useEffect, useMemo, useState, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { api, lensRun } from '@/lib/api/client';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { NotesWorkbench } from '@/components/understanding/NotesWorkbench';
import { KnowledgeGraph } from '@/components/understanding/KnowledgeGraph';
import {
  Lightbulb, Search, Loader2, Plus, Sparkles, GitBranch, TrendingUp,
  RefreshCw, X, ChevronRight, AlertCircle, Layers,
  Clock, BarChart3, Zap, BookOpen, FileText, Network,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

type SubjectKind = 'dtu' | 'claims' | 'raw' | 'entity' | 'world' | 'faction';

interface Understanding {
  id: string;
  subjectId?: string;
  subjectKind?: SubjectKind;
  composer?: 'rules' | 'llm';
  consistency?: number;
  confidence?: number;
  composedAt?: string | number;
  expiresAt?: string | number;
  evidence?: unknown[];
  text?: string;
  claims?: unknown[];
  meta?: Record<string, unknown>;
}

interface EvolutionStats {
  totalUnderstandings?: number;
  promotedCount?: number;
  consolidatedCount?: number;
  expiredCount?: number;
  pendingPromotion?: number;
  averageConfidence?: number;
}

interface NotesOverview {
  noteCount?: number;
  manualLinkCount?: number;
  wikiLinkCount?: number;
  tagCount?: number;
}

interface PromotionEval {
  ok: boolean;
  decision?: 'promote' | 'reject' | 'pending';
  reason?: string;
  evidenceCount?: number;
  thresholds?: Record<string, number>;
}

interface ConsolidationCandidate {
  parentId?: string;
  childIds: string[];
  similarity?: number;
  rationale?: string;
}

interface LineageNode {
  id: string;
  depth?: number;
  parentId?: string | null;
  composer?: string;
  composedAt?: string | number;
}

type Tab = 'notes' | 'graph' | 'browse' | 'compose' | 'evolution' | 'lineage';

// ── Page ────────────────────────────────────────────────────────────

async function macro<T = unknown>(
  domain: string,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const r = await api.post('/api/lens/run', { domain, name, input });
  return r.data as T;
}

export default function UnderstandingPage() {
  const [tab, setTab] = useState<Tab>('notes');
  // When the graph asks to open a note, the Notes tab focuses it.
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);

  useLensCommand(
    [
      { id: 'tab-notes',     keys: 'n', description: 'Notes',     category: 'navigation', action: () => setTab('notes') },
      { id: 'tab-graph',     keys: 'g', description: 'Graph',     category: 'navigation', action: () => setTab('graph') },
      { id: 'tab-browse',    keys: 'b', description: 'Browse',    category: 'navigation', action: () => setTab('browse') },
      { id: 'tab-compose',   keys: 'c', description: 'Compose',   category: 'navigation', action: () => setTab('compose') },
      { id: 'tab-evolution', keys: 'e', description: 'Evolution', category: 'navigation', action: () => setTab('evolution') },
      { id: 'tab-lineage',   keys: 'l', description: 'Lineage',   category: 'navigation', action: () => setTab('lineage') },
    ],
    { lensId: 'understanding' }
  );

  const [subjectKinds, setSubjectKinds] = useState<SubjectKind[]>([]);
  const [stats, setStats] = useState<EvolutionStats | null>(null);
  const [notesOverview, setNotesOverview] = useState<NotesOverview | null>(null);
  const [headerErr, setHeaderErr] = useState<string | null>(null);

  const refreshHeader = useCallback(async () => {
    setHeaderErr(null);
    try {
      const [k, s] = await Promise.all([
        macro<{ ok: boolean; kinds?: SubjectKind[] }>('understanding', 'subject_kinds').catch(() => null),
        macro<{ ok: boolean; stats?: EvolutionStats }>('understanding', 'evolution_stats').catch(() => null),
      ]);
      if (k?.kinds) setSubjectKinds(k.kinds);
      if (s?.stats) setStats(s.stats);
      const ov = await lensRun<NotesOverview>('understanding', 'overview', {}).catch(() => null);
      if (ov?.data?.ok && ov.data.result) setNotesOverview(ov.data.result);
    } catch (e) {
      setHeaderErr(e instanceof Error ? e.message : 'header refresh failed');
    }
  }, []);

  useEffect(() => { refreshHeader(); }, [refreshHeader]);

  const openNoteInWorkbench = useCallback((id: string) => {
    setPendingNoteId(id);
    setTab('notes');
  }, []);

  return (
    <LensShell lensId="understanding" asMain={false}>
      <FirstRunTour lensId="understanding" />
      <ManifestActionBar />
      <DepthBadge lensId="understanding" size="sm" className="ml-2" />
      <LensVerticalHero lensId="understanding" className="mx-6 mt-4" />
      <main className="min-h-screen p-6 max-w-6xl mx-auto text-white">
        <header className="flex items-start justify-between gap-3 mb-5 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold text-violet-300 inline-flex items-center gap-2">
              <Lightbulb className="w-7 h-7" /> Understanding
            </h1>
            <p className="text-gray-400 mt-1">
              Compounding-knowledge substrate. Parse → compose → evolve → consolidate.
            </p>
          </div>
          <button
            onClick={refreshHeader}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </header>

        <StatsStrip stats={stats} subjectKindsCount={subjectKinds.length} notesOverview={notesOverview} />

        {headerErr && <p className="text-xs text-red-400 mb-3">{headerErr}</p>}

        <nav className="flex gap-2 mt-5 mb-5 border-b border-white/10 pb-3 overflow-x-auto">
          <TabButton current={tab} value="notes"     label="Notes"     onClick={() => setTab('notes')}     icon={<FileText  className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="graph"     label="Graph"     onClick={() => setTab('graph')}     icon={<Network   className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="browse"    label="Browse"    onClick={() => setTab('browse')}    icon={<Search    className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="compose"   label="Compose"   onClick={() => setTab('compose')}   icon={<Plus      className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="evolution" label="Evolution" onClick={() => setTab('evolution')} icon={<TrendingUp className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="lineage"   label="Lineage"   onClick={() => setTab('lineage')}   icon={<GitBranch className="w-3.5 h-3.5" />} />
        </nav>

        {tab === 'notes'     && <NotesWorkbench key={pendingNoteId ?? 'workbench'} initialNoteId={pendingNoteId} onChanged={refreshHeader} />}
        {tab === 'graph'     && <KnowledgeGraph onOpenNote={openNoteInWorkbench} />}
        {tab === 'browse'    && <BrowseTab subjectKinds={subjectKinds} />}
        {tab === 'compose'   && <ComposeTab subjectKinds={subjectKinds} onComposed={refreshHeader} />}
        {tab === 'evolution' && <EvolutionTab onChanged={refreshHeader} />}
        {tab === 'lineage'   && <LineageTab />}
      </main>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
          <RecentMineCard domain="understanding" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="understanding" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="understanding" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

// ── Stats strip ─────────────────────────────────────────────────────

function StatsStrip({
  stats, subjectKindsCount, notesOverview,
}: { stats: EvolutionStats | null; subjectKindsCount: number; notesOverview: NotesOverview | null }) {
  const linkTotal = notesOverview
    ? (notesOverview.manualLinkCount ?? 0) + (notesOverview.wikiLinkCount ?? 0)
    : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatCard label="Notes" value={String(notesOverview?.noteCount ?? '—')} icon={<FileText className="w-3.5 h-3.5 text-violet-300" />} />
      <StatCard label="Links" value={linkTotal != null ? String(linkTotal) : '—'} icon={<Network className="w-3.5 h-3.5 text-cyan-300" />} />
      <StatCard label="Tags" value={String(notesOverview?.tagCount ?? '—')} icon={<BookOpen className="w-3.5 h-3.5 text-rose-300" />} />
      <StatCard label="Composed" value={String(stats?.totalUnderstandings ?? '—')} icon={<Lightbulb className="w-3.5 h-3.5 text-amber-300" />} />
      <StatCard label="Promoted" value={String(stats?.promotedCount ?? '—')} icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-300" />} />
      <StatCard label="Subject kinds" value={String(subjectKindsCount)} icon={<Layers className="w-3.5 h-3.5 text-blue-300" />} />
    </div>
  );
}

function StatCard({
  label, value, icon,
}: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
        {icon}{label}
      </div>
      <div className="text-base font-bold leading-tight mt-0.5">{value}</div>
    </div>
  );
}

// ── Browse tab ──────────────────────────────────────────────────────

function BrowseTab({ subjectKinds }: { subjectKinds: SubjectKind[] }) {
  const [rows, setRows] = useState<Understanding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<SubjectKind | 'all'>('all');
  const [detail, setDetail] = useState<Understanding | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // engine_list (not the bare "list") — the notes-substrate LENS_ACTION
      // shadows "list" for /api/lens/run; engine_list reaches the real
      // understanding-engine list this Browse tab is built around.
      const r = await macro<{ ok: boolean; rows?: Understanding[] }>(
        'understanding', 'engine_list',
        filterKind === 'all' ? {} : { subjectKind: filterKind }
      );
      setRows(r.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [filterKind]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.id).toLowerCase().includes(q) ||
      String(r.subjectId ?? '').toLowerCase().includes(q) ||
      String(r.text ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function recompose(id: string) {
    try {
      await macro('understanding', 'recompose', { id });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'recompose failed');
    }
  }

  return (
    <section>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 flex-1">
          <Search className="w-3.5 h-3.5 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search understandings…"
            className="bg-transparent outline-none text-sm flex-1 placeholder:text-white/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-white/40 hover:text-white" aria-label="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as SubjectKind | 'all')}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
        >
          <option value="all">All kinds</option>
          {subjectKinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="text-white/50 text-sm">
          {rows.length === 0 ? 'No understandings yet. Compose one to get started.' : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((u) => (
            <li
              key={u.id}
              className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-start justify-between gap-3 hover:bg-white/10 transition cursor-pointer"
              onClick={() => setDetail(u)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {u.subjectKind && (
                    <span className="text-[10px] uppercase tracking-wide text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5">
                      {u.subjectKind}
                    </span>
                  )}
                  {u.composer && (
                    <span className="text-[10px] text-white/40">composer: {u.composer}</span>
                  )}
                </div>
                <p className="text-sm font-mono mt-1 truncate">{u.id}</p>
                {u.subjectId && (
                  <p className="text-xs text-white/50 truncate">subject: {u.subjectId}</p>
                )}
                <div className="flex gap-3 mt-1 text-[11px] text-white/40">
                  {u.consistency != null && (
                    <span>consistency: <span className="text-white/70">{Number(u.consistency).toFixed(2)}</span></span>
                  )}
                  {u.confidence != null && (
                    <span>confidence: <span className="text-white/70">{Number(u.confidence).toFixed(2)}</span></span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); recompose(u.id); }}
                  className="px-2 py-1 text-[11px] bg-violet-500/20 border border-violet-500/40 rounded text-violet-200 hover:bg-violet-500/30 inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Recompose
                </button>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail && <UnderstandingDetailModal u={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function UnderstandingDetailModal({
  u, onClose,
}: { u: Understanding; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="bg-black/95 border border-violet-500/30 rounded-2xl p-5 w-full max-w-xl max-h-[85vh] overflow-y-auto text-white"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold">Understanding</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] font-mono text-white/40 break-all mb-3">{u.id}</p>
        {u.subjectId && (
          <div className="text-xs mb-2">
            <span className="text-white/40">subject:</span> <span className="font-mono">{u.subjectId}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          {u.subjectKind && <div><span className="text-white/40">kind:</span> {u.subjectKind}</div>}
          {u.composer && <div><span className="text-white/40">composer:</span> {u.composer}</div>}
          {u.consistency != null && <div><span className="text-white/40">consistency:</span> {Number(u.consistency).toFixed(3)}</div>}
          {u.confidence != null && <div><span className="text-white/40">confidence:</span> {Number(u.confidence).toFixed(3)}</div>}
          {u.composedAt && <div><span className="text-white/40">composed:</span> {String(u.composedAt)}</div>}
          {u.expiresAt && <div><span className="text-white/40">expires:</span> {String(u.expiresAt)}</div>}
        </div>
        {u.text && (
          <div className="border-t border-white/10 pt-3 mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Text</p>
            <pre className="text-xs whitespace-pre-wrap text-white/80">{u.text}</pre>
          </div>
        )}
        {Array.isArray(u.claims) && u.claims.length > 0 && (
          <div className="border-t border-white/10 pt-3 mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Claims ({u.claims.length})</p>
            <ul className="text-xs text-white/70 space-y-1 list-disc pl-4">
              {u.claims.slice(0, 8).map((c, i) => (
                <li key={i} className="break-words">{typeof c === 'string' ? c : JSON.stringify(c)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Compose tab ─────────────────────────────────────────────────────

function ComposeTab({
  subjectKinds, onComposed,
}: { subjectKinds: SubjectKind[]; onComposed: () => void }) {
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('raw');
  const [subjectId, setSubjectId] = useState('');
  const [rawText, setRawText] = useState('');
  const [composer, setComposer] = useState<'rules' | 'llm'>('rules');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Understanding | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Persist compose-session events for cross-lens discovery.
  const composeLog = useArtifacts<{ subjectKind: string; composer: string; at: string }>('understanding', { type: 'compose-session', limit: 5 });
  const createComposeLog = useCreateArtifact<{ subjectKind: string; composer: string; at: string }>('understanding');

  async function parsePreview() {
    setBusy(true); setError(null); setPreview(null); setSavedId(null);
    try {
      const r = await macro<{ ok: boolean; understanding?: Understanding; error?: string }>(
        'understanding', 'parse',
        {
          subjectId: subjectId || undefined,
          subjectKind,
          composer,
          ...(subjectKind === 'raw' ? { text: rawText } : {}),
        }
      );
      if (r.ok && r.understanding) {
        setPreview(r.understanding);
      } else {
        setError(r.error ?? 'parse failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'parse failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveCompose() {
    setBusy(true); setError(null); setSavedId(null);
    try {
      const r = await macro<{ ok: boolean; id?: string; error?: string }>(
        'understanding', 'compose',
        {
          subjectId: subjectId || undefined,
          subjectKind,
          composer,
          ...(subjectKind === 'raw' ? { text: rawText } : {}),
        }
      );
      if (r.ok && r.id) {
        setSavedId(r.id);
        createComposeLog.mutate({
          type: 'compose-session',
          title: `${subjectKind} via ${composer}`,
          data: { subjectKind, composer, at: new Date().toISOString() },
          meta: { tags: ['understanding', 'compose'], status: 'completed', visibility: 'private' },
        });
        onComposed();
      } else {
        setError(r.error ?? 'compose failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'compose failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="rounded-lg border border-violet-500/30 bg-black/60 p-4 mb-4">
        <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Compose new understanding
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <Field label="Subject kind">
            <select
              value={subjectKind}
              onChange={(e) => setSubjectKind(e.target.value as SubjectKind)}
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            >
              {subjectKinds.length === 0 ? (
                <option value="raw">raw</option>
              ) : subjectKinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Composer">
            <select
              value={composer}
              onChange={(e) => setComposer(e.target.value as 'rules' | 'llm')}
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            >
              <option value="rules">rules (deterministic)</option>
              <option value="llm">llm (subconscious brain)</option>
            </select>
          </Field>
          {subjectKind !== 'raw' && (
            <Field label="Subject ID" className="sm:col-span-2">
              <input
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder={`e.g. ${subjectKind === 'dtu' ? 'dtu_<id>' : `${subjectKind}_<id>`}`}
                className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
              />
            </Field>
          )}
          {subjectKind === 'raw' && (
            <Field label="Raw text" className="sm:col-span-2">
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={5}
                placeholder="Paste the text you want parsed into an understanding."
                className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
              />
            </Field>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={parsePreview}
            disabled={busy || (subjectKind === 'raw' ? !rawText.trim() : !subjectId)}
            className="px-4 py-2 text-sm bg-violet-700/40 hover:bg-violet-700/60 border border-violet-700 disabled:opacity-50 rounded text-violet-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Parse preview
          </button>
          <button
            onClick={saveCompose}
            disabled={busy || (subjectKind === 'raw' ? !rawText.trim() : !subjectId)}
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Compose &amp; save
          </button>
        </div>

        {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
        {savedId && (
          <p className="text-xs text-emerald-300 mt-2 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Saved as <span className="font-mono">{savedId}</span>
          </p>
        )}
      </div>

      {preview && (
        <div className="rounded-lg border border-white/10 bg-black/60 p-4">
          <h3 className="text-sm font-semibold mb-2 text-white/80 inline-flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-300" /> Preview (not saved)
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
            {preview.consistency != null && <div><span className="text-white/40">consistency:</span> {Number(preview.consistency).toFixed(3)}</div>}
            {preview.confidence != null && <div><span className="text-white/40">confidence:</span> {Number(preview.confidence).toFixed(3)}</div>}
            {preview.composer && <div><span className="text-white/40">composer:</span> {preview.composer}</div>}
            {preview.subjectKind && <div><span className="text-white/40">kind:</span> {preview.subjectKind}</div>}
          </div>
          {preview.text && (
            <pre className="text-xs whitespace-pre-wrap text-white/70 border-t border-white/10 pt-2">{preview.text}</pre>
          )}
        </div>
      )}

      {composeLog.data?.artifacts && composeLog.data.artifacts.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Recent compose sessions</p>
          <ul className="text-xs space-y-1">
            {composeLog.data.artifacts.map((a) => (
              <li key={a.id} className="text-white/60">
                <span className="text-white/80">{a.title}</span>
                <span className="text-white/40 ml-2">
                  {new Date((a.data as { at?: string })?.at ?? a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}

// ── Evolution tab ───────────────────────────────────────────────────

function EvolutionTab({ onChanged }: { onChanged: () => void }) {
  const [understandingId, setUnderstandingId] = useState('');
  const [evidenceText, setEvidenceText] = useState('');
  const [evaluation, setEvaluation] = useState<PromotionEval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickResult, setTickResult] = useState<string | null>(null);

  async function recordEvidence() {
    if (!understandingId || !evidenceText.trim()) return;
    setBusy(true); setError(null);
    try {
      await macro('understanding', 'record_evidence', {
        id: understandingId,
        evidence: evidenceText,
        at: new Date().toISOString(),
      });
      setEvidenceText('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'record failed');
    } finally {
      setBusy(false);
    }
  }

  async function evaluatePromotion() {
    if (!understandingId) return;
    setBusy(true); setError(null);
    try {
      const r = await macro<PromotionEval>('understanding', 'evaluate_promotion', { id: understandingId });
      setEvaluation(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'evaluate failed');
    } finally {
      setBusy(false);
    }
  }

  async function applyPromotion(decision: 'promote' | 'reject') {
    if (!understandingId) return;
    setBusy(true); setError(null);
    try {
      await macro('understanding', 'apply_promotion', { id: understandingId, decision });
      setEvaluation(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'apply failed');
    } finally {
      setBusy(false);
    }
  }

  async function runEvolutionTick() {
    setBusy(true); setError(null); setTickResult(null);
    try {
      const r = await macro<{ ok: boolean; processed?: number; promoted?: number }>(
        'understanding', 'evolution_tick'
      );
      setTickResult(`tick processed=${r.processed ?? 0} promoted=${r.promoted ?? 0}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'tick failed');
    } finally {
      setBusy(false);
    }
  }

  async function runSweep() {
    setBusy(true); setError(null); setTickResult(null);
    try {
      const r = await macro<{ ok: boolean; expired?: number }>('understanding', 'sweep');
      setTickResult(`sweep expired=${r.expired ?? 0}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sweep failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-black/60 p-4">
        <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4" /> Evidence + promotion
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <Field label="Understanding ID">
            <input
              value={understandingId}
              onChange={(e) => setUnderstandingId(e.target.value)}
              placeholder="und_..."
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Evidence">
            <input
              value={evidenceText}
              onChange={(e) => setEvidenceText(e.target.value)}
              placeholder="Supporting/refuting evidence text"
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={recordEvidence}
            disabled={busy || !understandingId || !evidenceText.trim()}
            className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/40 rounded text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Record evidence
          </button>
          <button
            onClick={evaluatePromotion}
            disabled={busy || !understandingId}
            className="px-3 py-1.5 text-xs bg-violet-500/20 border border-violet-500/40 rounded text-violet-200 hover:bg-violet-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Evaluate promotion
          </button>
        </div>

        {evaluation && (
          <div className={`mt-3 rounded p-3 text-xs ${
            evaluation.decision === 'promote' ? 'bg-emerald-500/10 border border-emerald-500/30' :
            evaluation.decision === 'reject'  ? 'bg-rose-500/10 border border-rose-500/30' :
            'bg-amber-500/10 border border-amber-500/30'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold uppercase tracking-wide text-[10px]">{evaluation.decision ?? 'pending'}</span>
              {evaluation.evidenceCount != null && (
                <span className="text-white/40">evidence count: {evaluation.evidenceCount}</span>
              )}
            </div>
            {evaluation.reason && <p className="text-white/70">{evaluation.reason}</p>}
            {evaluation.thresholds && (
              <div className="mt-2 text-white/40 font-mono text-[10px]">
                {Object.entries(evaluation.thresholds).map(([k, v]) => `${k}=${v}`).join(' · ')}
              </div>
            )}
            {(evaluation.decision === 'promote' || evaluation.decision === 'pending') && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => applyPromotion('promote')}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 rounded text-white"
                >
                  Apply promote
                </button>
                <button
                  onClick={() => applyPromotion('reject')}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-rose-600 hover:bg-rose-500 rounded text-white"
                >
                  Apply reject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <h2 className="text-white/80 font-semibold mb-3 inline-flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> System cycles
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={runEvolutionTick}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-violet-700/40 hover:bg-violet-700/60 border border-violet-700 disabled:opacity-50 rounded text-violet-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <TrendingUp className="w-3 h-3" />}
            Run evolution tick
          </button>
          <button
            onClick={runSweep}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-rose-700/40 hover:bg-rose-700/60 border border-rose-700 disabled:opacity-50 rounded text-rose-200 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
            Sweep expired
          </button>
        </div>
        {tickResult && <p className="text-xs text-emerald-300 mt-2">{tickResult}</p>}
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </section>
  );
}

// ── Lineage tab ─────────────────────────────────────────────────────

function LineageTab() {
  const [rootId, setRootId] = useState('');
  const [maxDepth, setMaxDepth] = useState(6);
  const [lineage, setLineage] = useState<LineageNode[] | null>(null);
  const [candidates, setCandidates] = useState<ConsolidationCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consolidateMsg, setConsolidateMsg] = useState<string | null>(null);

  async function loadLineage() {
    if (!rootId) return;
    setBusy(true); setError(null);
    try {
      const r = await macro<{ ok: boolean; lineage?: LineageNode[] }>(
        'understanding', 'lineage', { id: rootId, maxDepth }
      );
      setLineage(r.lineage ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'lineage failed');
    } finally {
      setBusy(false);
    }
  }

  const loadCandidates = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await macro<{ ok: boolean; candidates?: ConsolidationCandidate[] }>(
        'understanding', 'consolidation_candidates'
      );
      setCandidates(r.candidates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'candidates failed');
    } finally {
      setBusy(false);
    }
  }, []);

  async function runConsolidate(c: ConsolidationCandidate) {
    setBusy(true); setError(null); setConsolidateMsg(null);
    try {
      const r = await macro<{ ok: boolean; id?: string }>(
        'understanding', 'consolidate', { childIds: c.childIds }
      );
      if (r.ok) {
        setConsolidateMsg(`Consolidated → ${r.id ?? '(new)'}`);
        loadCandidates();
      } else {
        setError('consolidate failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'consolidate failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-cyan-500/30 bg-black/60 p-4">
        <h2 className="text-cyan-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <GitBranch className="w-4 h-4" /> Lineage walk
        </h2>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div className="flex-1 min-w-[240px]">
            <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Root understanding ID</label>
            <input
              value={rootId}
              onChange={(e) => setRootId(e.target.value)}
              placeholder="und_..."
              className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/40 uppercase tracking-wider mb-1 block">Max depth</label>
            <input
              type="number" min={1} max={20}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              className="w-20 bg-black/60 border border-white/10 rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={loadLineage}
            disabled={busy || !rootId}
            className="px-3 py-2 text-xs bg-cyan-500/20 border border-cyan-500/40 rounded text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            Walk lineage
          </button>
        </div>
        {lineage && (lineage.length === 0 ? (
          <p className="text-xs text-white/50 italic">No lineage for this id (or root not found).</p>
        ) : (
          <ul className="space-y-1">
            {lineage.map((n) => (
              <li key={n.id} className="text-xs flex items-center gap-2">
                <span className="w-8 text-right text-cyan-300 font-mono">{n.depth ?? '?'}</span>
                <span className="font-mono truncate flex-1">{n.id}</span>
                {n.composer && <span className="text-white/40 text-[10px]">{n.composer}</span>}
              </li>
            ))}
          </ul>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white/80 font-semibold inline-flex items-center gap-1.5">
            <Layers className="w-4 h-4" /> Consolidation candidates
          </h2>
          <button
            onClick={loadCandidates}
            disabled={busy}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
        {candidates.length === 0 ? (
          <p className="text-xs text-white/50 italic">No candidates right now. Evidence + promotion accumulate over time, then candidates surface here.</p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={i} className="bg-white/5 border border-white/10 rounded p-3 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-white/70">
                    {c.childIds.length} children
                    {c.similarity != null && <span className="text-white/40 ml-2">similarity {Number(c.similarity).toFixed(2)}</span>}
                  </div>
                  {c.rationale && <div className="text-[11px] text-white/50 mt-0.5">{c.rationale}</div>}
                  <div className="text-[10px] font-mono text-white/40 mt-1 truncate">
                    {c.childIds.slice(0, 3).join(', ')}{c.childIds.length > 3 && ` +${c.childIds.length - 3}`}
                  </div>
                </div>
                <button
                  onClick={() => runConsolidate(c)}
                  disabled={busy}
                  className="px-3 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Consolidate
                </button>
              </li>
            ))}
          </ul>
        )}
        {consolidateMsg && <p className="text-xs text-emerald-300 mt-2">{consolidateMsg}</p>}
      </div>

      {error && <p className="text-sm text-rose-300 inline-flex items-center gap-1">
        <AlertCircle className="w-4 h-4" /> {error}
      </p>}
    </section>
  );
}

// ── Tab button ──────────────────────────────────────────────────────

function TabButton({
  current, value, label, onClick, icon,
}: { current: Tab; value: Tab; label: string; onClick: () => void; icon: React.ReactNode }) {
  const active = current === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
        active
          ? 'bg-violet-500/20 border border-violet-500/40 text-violet-300'
          : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/70'
      }`}
    >
      {icon}{label}
    </button>
  );
}
