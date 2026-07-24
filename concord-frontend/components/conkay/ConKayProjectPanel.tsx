'use client';

// concord-frontend/components/conkay/ConKayProjectPanel.tsx
//
// V1.2 Wave B (Deep ConKay Agency) — ConKay's cross-session "project" panel.
//
// A grounding audit found three real, tested, but disconnected subsystems:
// the durable goal tree (server/lib/goal-decomposition.js), persistent
// marathon sessions (server/lib/agent-marathon.js — see ./MarathonPanel.tsx),
// and cross-session conversation memory (server/lib/conversation-memory.js —
// see ./ConKayMemoryPanel.tsx, this panel's direct sibling). Nothing tied
// them into ONE addressable, named thing a user could reopen across separate
// logins. `server/lib/project-thread.js` (mig 378) is that thin linking
// layer; this panel is its one UI surface, via five `agent_projects.*`
// macros (server/domains/agent-projects.js).
//
// Registered as the `conkay.projects` panel (lib/panel-registry.ts) — the
// SAME self-healing cockpit-lane convention `conkay.memory` already uses
// (see ConKayCockpit.tsx's header comment): any registered `conkay.*` panel
// id is picked up automatically by ConKayOverlay's cockpit grid with no
// second mount site to remember, so this needs no changes to
// ConKayOverlay.tsx itself. Self-contained per the registry's eligibility
// rule — no required props, fetches its own data via `lensRun`.
//
// Honesty notes:
//   - "Resume" is a real backend call (`agent_projects.touch_opened`), not a
//     client-side timestamp fake. It's optimistic (the row's "opened" time
//     and its position both update immediately), reconciled with the real
//     server timestamp on success, and ROLLED BACK to the exact prior
//     snapshot on failure — the same optimistic-then-honest-reconcile shape
//     already used elsewhere in ConKay's UI (see ConKayOverlay.tsx's message
//     list). A failed resume never leaves a fabricated "resumed" state
//     standing.
//   - A linked goal tree that's been deleted, or a marathon session that's
//     vanished, is surfaced PLAINLY (`goalTree.ok === false` /
//     `marathon.status === 'missing'`) — never silently dropped or invented
//     as if the state still existed. See lib/project-thread.js#getProject.
//   - The "relevant memory" section only appears once `memory.available` is
//     true (a live DTU store was actually reachable server-side); otherwise
//     it says so rather than rendering a suspicious empty list.
//   - No memories/goal/marathon in a project is an honest, expected state
//     for a fresh project — never backfilled with sample content.

import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, Loader2, ChevronDown, ChevronUp, Plus, RotateCcw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/EmptyState';

export interface ConKayProjectSummary {
  id: string;
  name: string;
  goalTreeId: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  marathonCount: number;
}

interface GoalTreeNode {
  id: string;
  title: string;
  status: string;
  children: GoalTreeNode[];
}

interface GoalTreeResult {
  ok: boolean;
  reason?: string;
  treeId?: string;
  tree?: { id: string; title: string; description: string; status: string; root: GoalTreeNode | null };
  progress?: number;
  total?: number;
  done?: number;
}

interface MarathonSummary {
  sessionId: string;
  linkedAt: number;
  status: string;
  reason?: string;
  title?: string | null;
  goal?: string | null;
  totalTurns?: number;
  maxTurns?: number;
}

interface MemoryItem {
  id: string;
  kind: string;
  title: string | null;
  topics: string[];
  insights: string[];
  relevance: number;
  updatedAt: string | null;
}

interface ProjectDetail {
  ok: boolean;
  project: ConKayProjectSummary;
  goalTree: GoalTreeResult | null;
  marathons: MarathonSummary[];
  memory: { available: boolean; reason?: string; items: MemoryItem[] };
}

type PanelStatus = 'loading' | 'ok' | 'error';

function formatWhen(unixSeconds: number | null | undefined): string | null {
  if (!unixSeconds) return null;
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const MARATHON_BADGE_CLASS: Record<string, string> = {
  pending: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-200',
  running: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  paused: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  completed: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  failed: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  abandoned: 'border-zinc-400/20 bg-zinc-400/5 text-zinc-400',
  missing: 'border-rose-400/20 bg-rose-400/5 text-rose-300/70',
};

function marathonBadgeClass(status: string): string {
  return MARATHON_BADGE_CLASS[status] || MARATHON_BADGE_CLASS.pending;
}

export function ConKayProjectPanel() {
  const [status, setStatus] = useState<PanelStatus>('loading');
  const [projects, setProjects] = useState<ConKayProjectSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [pendingResumeId, setPendingResumeId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await lensRun<{ projects: ConKayProjectSummary[] }>('agent_projects', 'list', {});
      if (!res.data.ok || !res.data.result) {
        throw new Error(res.data.error || 'list_failed');
      }
      setProjects(res.data.result.projects || []);
      setStatus('ok');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fetchDetail = useCallback(async (projectId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await lensRun<ProjectDetail>('agent_projects', 'get', { projectId });
      if (res.data.ok && res.data.result) setDetail(res.data.result);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const createProject = useCallback(async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setErrorMessage(null);
    try {
      const res = await lensRun<{ project: ConKayProjectSummary }>('agent_projects', 'create', { name });
      if (!res.data.ok || !res.data.result) {
        throw new Error(res.data.error || 'create_failed');
      }
      setNewName('');
      setProjects((prev) => [res.data.result!.project, ...prev]);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [newName, creating]);

  const toggleExpand = useCallback((project: ConKayProjectSummary) => {
    if (expandedId === project.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(project.id);
    fetchDetail(project.id);
  }, [expandedId, fetchDetail]);

  // Resume — a real backend call, optimistic on the row's own honest fields
  // (lastOpenedAt / ordering), reconciled with the server's real values on
  // success and rolled back to the exact prior list on failure. Also expands
  // the row so "resume" genuinely surfaces the linked goal/marathon/memory
  // state, not just a timestamp bump.
  const resume = useCallback(async (project: ConKayProjectSummary) => {
    setPendingResumeId(project.id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[project.id];
      return next;
    });
    const prevSnapshot = projects;
    const optimisticAt = Math.floor(Date.now() / 1000);
    setProjects((prev) => {
      const bumped = prev.map((p) => (p.id === project.id ? { ...p, lastOpenedAt: optimisticAt, updatedAt: optimisticAt } : p));
      return [...bumped].sort((a, b) => b.updatedAt - a.updatedAt);
    });
    try {
      const res = await lensRun<{ project: ConKayProjectSummary }>('agent_projects', 'touch_opened', { projectId: project.id });
      if (!res.data.ok || !res.data.result) {
        throw new Error(res.data.error || 'resume_failed');
      }
      const real = res.data.result.project;
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, lastOpenedAt: real.lastOpenedAt, updatedAt: real.updatedAt } : p)));
      setExpandedId(project.id);
      await fetchDetail(project.id);
    } catch (e) {
      // Honest rollback — never leave a fabricated "resumed" row standing.
      setProjects(prevSnapshot);
      setRowErrors((prev) => ({ ...prev, [project.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setPendingResumeId(null);
    }
  }, [projects, fetchDetail]);

  return (
    <div
      data-testid="ck-project-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">
        <FolderKanban className="h-3 w-3" aria-hidden />
        projects
      </div>

      <div className="flex items-center gap-1.5 px-1 pb-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createProject(); }}
          placeholder="Name a new project…"
          aria-label="New project name"
          className="flex-1 rounded-md border border-cyan-400/15 bg-black/30 px-2 py-1 text-[11px] text-cyan-50 placeholder:text-cyan-300/30 outline-none focus:border-cyan-400/40"
        />
        <button
          type="button"
          onClick={createProject}
          disabled={creating || !newName.trim()}
          aria-label="Create project"
          title="Create project"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-cyan-200/70 hover:bg-white/10 disabled:opacity-40"
        >
          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {status === 'loading' && (
        <div data-testid="ck-project-loading" className="px-1 py-2 text-[11px] text-cyan-300/60">
          Loading your projects…
        </div>
      )}

      {status === 'error' && (
        <div data-testid="ck-project-error" className="px-1 py-2 text-[11px] text-rose-300/80">
          Couldn&apos;t load your projects{errorMessage ? ` (${errorMessage})` : ''}.
        </div>
      )}

      {status === 'ok' && projects.length === 0 && (
        <EmptyState
          compact
          icon={<FolderKanban className="h-5 w-5" aria-hidden="true" />}
          title="No projects yet"
          description="Name one above to tie a goal, a marathon run, and your relevant memory into one place you can pick back up later."
          className="border-none bg-transparent py-4"
        />
      )}

      {status === 'ok' && projects.length > 0 && (
        <ul className="space-y-1.5" data-testid="ck-project-list">
          {projects.map((p) => {
            const pending = pendingResumeId === p.id;
            const rowError = rowErrors[p.id];
            const expanded = expandedId === p.id;
            const when = formatWhen(p.lastOpenedAt);
            return (
              <li
                key={p.id}
                data-testid={`ck-project-row-${p.id}`}
                className="rounded-lg border border-cyan-400/10 bg-black/20 px-2 py-1.5 text-[12px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => toggleExpand(p)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-cyan-100/90">{p.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-cyan-300/40">
                      {p.goalTreeId && (
                        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5">goal</span>
                      )}
                      {p.marathonCount > 0 && (
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-amber-200/80">
                          {p.marathonCount} marathon{p.marathonCount === 1 ? '' : 's'}
                        </span>
                      )}
                      <span>{when ? `opened ${when}` : 'never opened'}</span>
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => resume(p)}
                      disabled={pending}
                      aria-label={`Resume ${p.name}`}
                      title="Resume"
                      className="grid h-6 w-6 place-items-center rounded-md text-cyan-200/70 hover:bg-white/10 disabled:opacity-40"
                    >
                      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpand(p)}
                      aria-label={expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
                      className="grid h-6 w-6 place-items-center rounded-md text-cyan-200/50 hover:bg-white/10"
                    >
                      {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {rowError && (
                  <div data-testid={`ck-project-row-error-${p.id}`} className="mt-1 text-[10px] text-rose-300/80">
                    {rowError}
                  </div>
                )}

                {expanded && (
                  <div data-testid={`ck-project-detail-${p.id}`} className="mt-2 space-y-2 border-t border-cyan-400/10 pt-2">
                    {detailLoading && (
                      <div className="text-[11px] text-cyan-300/50">Loading linked state…</div>
                    )}
                    {!detailLoading && detail && detail.project.id === p.id && (
                      <>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-cyan-300/40">Goal</div>
                          {!detail.goalTree && <div className="text-[11px] text-white/40">No goal tree linked.</div>}
                          {detail.goalTree && !detail.goalTree.ok && (
                            <div className="text-[11px] text-rose-300/70">
                              Linked goal tree is gone ({detail.goalTree.reason}).
                            </div>
                          )}
                          {detail.goalTree?.ok && (
                            <div className="text-[11px] text-cyan-100/80">
                              {detail.goalTree.tree?.title} — {detail.goalTree.done}/{detail.goalTree.total} done
                              {' '}({Math.round((detail.goalTree.progress || 0) * 100)}%)
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-cyan-300/40">Marathon sessions</div>
                          {detail.marathons.length === 0 && (
                            <div className="text-[11px] text-white/40">None linked yet.</div>
                          )}
                          {detail.marathons.map((m) => (
                            <div key={m.sessionId} data-testid={`ck-project-marathon-${m.sessionId}`} className="mt-0.5 flex items-center gap-1.5">
                              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${marathonBadgeClass(m.status)}`}>
                                {m.status}
                              </span>
                              <span className="truncate text-[11px] text-cyan-100/70">{m.title || m.goal || m.sessionId}</span>
                              {typeof m.totalTurns === 'number' && (
                                <span className="text-[10px] text-cyan-300/30">{m.totalTurns}/{m.maxTurns} turns</span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-cyan-300/40">Relevant memory</div>
                          {!detail.memory.available && (
                            <div className="text-[11px] text-white/40">Not available in this session.</div>
                          )}
                          {detail.memory.available && detail.memory.items.length === 0 && (
                            <div className="text-[11px] text-white/40">Nothing relevant yet.</div>
                          )}
                          {detail.memory.items.map((mem) => (
                            <div key={mem.id} className="mt-0.5 truncate text-[11px] text-cyan-100/70">
                              {mem.title || mem.insights[0] || mem.id}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ConKayProjectPanel;
