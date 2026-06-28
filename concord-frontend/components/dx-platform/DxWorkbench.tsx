'use client';

// DxWorkbench — feature-parity backlog surface for the dx-platform lens.
// Tabs: Codebases & Chat · PR Review · Codebase Search · Team Dashboard ·
// Detector Config · Usage Analytics · CI Integration. Every value is real
// user input or computed server-side from it — no seed data.

import { useCallback, useEffect, useState } from 'react';
import {
  MessageSquare, GitPullRequest, Search, Users, SlidersHorizontal,
  BarChart3, Workflow, FolderGit2, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface CodebaseRow {
  id: string; name: string; fileCount: number; totalLines: number;
  teamId: string | null; indexedAt: string;
}
interface Citation { path: string; line: number; text: string; score?: number }
interface Finding {
  id: string; detectorId: string; detectorLabel: string; severity: number;
  path: string; line: number; snippet: string;
}
interface SearchHit { path: string; line: number; text: string }
interface DetectorCfg {
  id: string; label: string; severity: number; enabled: boolean; defaultOn: boolean;
}

type Tab = 'codebases' | 'review' | 'search' | 'team' | 'detectors' | 'analytics' | 'ci';

const TABS: { id: Tab; label: string; icon: typeof MessageSquare }[] = [
  { id: 'codebases', label: 'Codebases & Chat', icon: MessageSquare },
  { id: 'review', label: 'PR Review', icon: GitPullRequest },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'detectors', label: 'Detectors', icon: SlidersHorizontal },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'ci', label: 'CI', icon: Workflow },
];

const SEV_COLOR: Record<number, string> = {
  5: 'text-red-300 bg-red-500/15 border-red-500/30',
  4: 'text-orange-300 bg-orange-500/15 border-orange-500/30',
  3: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  2: 'text-sky-300 bg-sky-500/15 border-sky-500/30',
  1: 'text-zinc-300 bg-zinc-500/15 border-zinc-500/30',
};

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-zinc-400" aria-hidden />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
      {children}
    </div>
  );
}

export function DxWorkbench() {
  const [tab, setTab] = useState<Tab>('codebases');
  const [codebases, setCodebases] = useState<CodebaseRow[]>([]);
  const [activeCb, setActiveCb] = useState<string>('');
  const [loadingCb, setLoadingCb] = useState(true);
  const [cbError, setCbError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refreshCodebases = useCallback(async () => {
    setLoadingCb(true);
    setCbError(null);
    try {
      const r = await lensRun('dx-platform', 'listCodebases', {});
      if (r.data?.ok && r.data.result) {
        const list = (r.data.result as { codebases: CodebaseRow[] }).codebases || [];
        setCodebases(list);
        setActiveCb((prev) => prev || list[0]?.id || '');
      } else {
        setCbError(r.data?.error || 'Could not load your codebases.');
      }
    } catch {
      setCbError('Network error loading codebases.');
    } finally {
      setLoadingCb(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => { void refreshCodebases(); }, [refreshCodebases]);

  // Four-UX-state surface for the codebase substrate the whole workbench
  // hangs off — loading / error (+ retry) / empty / populated. The per-tab
  // panels below each carry their own inline empty/loading affordances.
  if (loadingCb && !loadedOnce) {
    return (
      <div
        data-testid="dx-workbench-loading"
        role="status"
        aria-busy="true"
        className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 p-6 text-xs text-zinc-400"
      >
        <Spinner /> Loading your codebases…
      </div>
    );
  }
  if (cbError) {
    return (
      <div
        data-testid="dx-workbench-error"
        role="alert"
        className="space-y-3 rounded border border-red-500/30 bg-red-500/10 p-6 text-xs text-red-300"
      >
        <p className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" aria-hidden /> {cbError}
        </p>
        <button
          type="button"
          onClick={() => { void refreshCodebases(); }}
          className="rounded border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-200 hover:border-red-400"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="DX workbench">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-amber-500 text-zinc-950'
                  : 'border border-zinc-800 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'codebases' && (
        <CodebasesTab
          codebases={codebases}
          loading={loadingCb}
          activeCb={activeCb}
          setActiveCb={setActiveCb}
          onIndexed={refreshCodebases}
        />
      )}
      {tab === 'review' && <ReviewTab codebases={codebases} />}
      {tab === 'search' && <SearchTab codebases={codebases} activeCb={activeCb} setActiveCb={setActiveCb} />}
      {tab === 'team' && <TeamTab codebases={codebases} onChanged={refreshCodebases} />}
      {tab === 'detectors' && <DetectorsTab codebases={codebases} activeCb={activeCb} setActiveCb={setActiveCb} />}
      {tab === 'analytics' && <AnalyticsTab />}
      {tab === 'ci' && <CiTab codebases={codebases} activeCb={activeCb} setActiveCb={setActiveCb} />}
    </div>
  );
}

// ── Shared: codebase picker ─────────────────────────────────────────────
function CodebasePicker({
  codebases, value, onChange,
}: { codebases: CodebaseRow[]; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
      aria-label="Select codebase"
    >
      <option value="">Select a codebase…</option>
      {codebases.map((c) => (
        <option key={c.id} value={c.id}>{c.name} ({c.fileCount} files)</option>
      ))}
    </select>
  );
}

// ── Tab 1: Codebases & Chat ─────────────────────────────────────────────
function CodebasesTab({
  codebases, loading, activeCb, setActiveCb, onIndexed,
}: {
  codebases: CodebaseRow[]; loading: boolean; activeCb: string;
  setActiveCb: (v: string) => void; onIndexed: () => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [indexErr, setIndexErr] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; grounded: boolean; citations: Citation[]; totalMatches: number } | null>(null);

  const addFile = () => {
    if (!path.trim() || !content.trim()) return;
    setFiles((f) => [...f, { path: path.trim(), content }]);
    setPath(''); setContent('');
  };

  const submitIndex = async () => {
    if (files.length === 0) { setIndexErr('Add at least one file first.'); return; }
    setIndexing(true); setIndexErr(null);
    try {
      const r = await lensRun('dx-platform', 'indexCodebase', { name: name.trim() || 'codebase', files });
      if (r.data?.ok) {
        setFiles([]); setName('');
        onIndexed();
      } else {
        setIndexErr(r.data?.error || 'Index failed.');
      }
    } finally {
      setIndexing(false);
    }
  };

  const ask = async () => {
    if (!activeCb || !question.trim()) return;
    setChatLoading(true); setAnswer(null);
    try {
      const r = await lensRun('dx-platform', 'chatWithCodebase', { codebaseId: activeCb, question: question.trim() });
      if (r.data?.ok && r.data.result) {
        setAnswer(r.data.result as { answer: string; grounded: boolean; citations: Citation[]; totalMatches: number });
      }
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div
      className="grid gap-4 md:grid-cols-2"
      data-testid={codebases.length === 0 ? 'dx-workbench-empty' : 'dx-workbench-codebases'}
    >
      {/* Index a codebase */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white">
          <FolderGit2 className="h-4 w-4 text-amber-400" aria-hidden /> Index a codebase
        </h3>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Codebase name"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
        />
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="File path e.g. src/index.js"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-mono text-white"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste file contents…"
          rows={5}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs font-mono text-white"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addFile}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-600"
          >
            Add file
          </button>
          <button
            type="button"
            onClick={submitIndex}
            disabled={indexing || files.length === 0}
            className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
          >
            {indexing ? 'Indexing…' : `Index ${files.length || ''} file(s)`}
          </button>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1 text-[11px] text-zinc-400">
            {files.map((f, i) => (
              <li key={`${f.path}-${i}`} className="font-mono">• {f.path}</li>
            ))}
          </ul>
        )}
        {indexErr && <p className="text-xs text-red-300">{indexErr}</p>}
      </section>

      {/* Chat with codebase */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white">
          <MessageSquare className="h-4 w-4 text-amber-400" aria-hidden /> Chat with codebase
        </h3>
        {loading ? <Spinner /> : codebases.length === 0 ? (
          <Empty>No codebases indexed yet. Index one to ask questions about it.</Empty>
        ) : (
          <>
            <CodebasePicker codebases={codebases} value={activeCb} onChange={setActiveCb} />
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
                placeholder="Ask about this repo…"
                className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
              />
              <button
                type="button"
                onClick={ask}
                disabled={chatLoading || !activeCb || !question.trim()}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
              >
                Ask
              </button>
            </div>
            {chatLoading && <Spinner />}
            {answer && (
              <div className="space-y-2">
                <p className="text-xs text-zinc-300">{answer.answer}</p>
                {answer.citations.length > 0 ? (
                  <ul className="space-y-1">
                    {answer.citations.map((c, i) => (
                      <li key={`${c.path}-${c.line}-${i}`} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                        <div className="font-mono text-[10px] text-amber-300">{c.path}:{c.line}</div>
                        <code className="text-[11px] text-zinc-300">{c.text}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No matching lines in the indexed codebase.</Empty>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── Tab 2: PR Review ────────────────────────────────────────────────────
interface ReviewResult {
  filesChanged: number; linesAdded: number; linesRemoved: number;
  findings: Finding[]; findingCount: number; blockingCount: number; verdict: string;
}

function ReviewTab({ codebases }: { codebases: CodebaseRow[] }) {
  const [diff, setDiff] = useState('');
  const [codebaseId, setCodebaseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);

  const run = async () => {
    if (!diff.trim()) return;
    setLoading(true); setResult(null);
    try {
      const r = await lensRun('dx-platform', 'reviewDiff', { diff, codebaseId: codebaseId || undefined });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result as ReviewResult);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-white">
        <GitPullRequest className="h-4 w-4 text-amber-400" aria-hidden /> Run detectors against a diff
      </h3>
      <p className="text-xs text-zinc-400">Paste a unified diff (git diff / PR patch). Detectors run over the added lines.</p>
      <div className="flex flex-wrap items-center gap-2">
        <CodebasePicker codebases={codebases} value={codebaseId} onChange={setCodebaseId} />
        <span className="text-[11px] text-zinc-400">Optional — uses the codebase&apos;s detector config if selected.</span>
      </div>
      <textarea
        value={diff}
        onChange={(e) => setDiff(e.target.value)}
        placeholder="--- a/file.js&#10;+++ b/file.js&#10;@@ -1 +1,2 @@&#10;+new line"
        rows={8}
        className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-white"
      />
      <button
        type="button"
        onClick={run}
        disabled={loading || !diff.trim()}
        className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
      >
        {loading ? 'Reviewing…' : 'Review diff'}
      </button>
      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`flex items-center gap-1 rounded border px-2 py-0.5 ${
              result.verdict === 'clean' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : result.verdict === 'advisory' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
              {result.verdict === 'clean' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
              {result.verdict.replace('_', ' ')}
            </span>
            <span className="text-zinc-400">{result.filesChanged} files</span>
            <span className="text-emerald-400">+{result.linesAdded}</span>
            <span className="text-red-400">-{result.linesRemoved}</span>
            <span className="text-zinc-400">{result.findingCount} findings</span>
            <span className="text-orange-300">{result.blockingCount} blocking</span>
          </div>
          {result.findings.length > 0 ? (
            <ul className="space-y-1.5">
              {result.findings.map((f) => (
                <li key={f.id} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SEV_COLOR[f.severity]}`}>S{f.severity}</span>
                    <span className="text-xs text-zinc-200">{f.detectorLabel}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">{f.path}:{f.line}</span>
                  </div>
                  <code className="mt-1 block text-[11px] text-zinc-400">{f.snippet}</code>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No detector findings in the added lines.</Empty>
          )}
        </div>
      )}
    </section>
  );
}

// ── Tab 3: Codebase Search ──────────────────────────────────────────────
function SearchTab({
  codebases, activeCb, setActiveCb,
}: { codebases: CodebaseRow[]; activeCb: string; setActiveCb: (v: string) => void }) {
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ results: SearchHit[]; matchCount: number; fileCount: number; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!activeCb || !query.trim()) return;
    setLoading(true); setResult(null); setErr(null);
    try {
      const r = await lensRun('dx-platform', 'searchCodebase', { codebaseId: activeCb, query, regex, caseSensitive });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result as { results: SearchHit[]; matchCount: number; fileCount: number; truncated: boolean });
      } else {
        setErr(r.data?.error || 'Search failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-white">
        <Search className="h-4 w-4 text-amber-400" aria-hidden /> Codebase-wide search
      </h3>
      {codebases.length === 0 ? (
        <Empty>Index a codebase first to search it.</Empty>
      ) : (
        <>
          <CodebasePicker codebases={codebases} value={activeCb} onChange={setActiveCb} />
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
              placeholder="Search term or pattern…"
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-white"
            />
            <button
              type="button"
              onClick={run}
              disabled={loading || !activeCb || !query.trim()}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
            >
              Search
            </button>
          </div>
          <div className="flex gap-4 text-[11px] text-zinc-400">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Case sensitive
            </label>
          </div>
          {err && <p className="text-xs text-red-300">{err}</p>}
          {loading && <Spinner />}
          {result && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-400">
                {result.matchCount} match(es) across {result.fileCount} file(s){result.truncated ? ' — truncated at 200' : ''}
              </p>
              {result.results.length > 0 ? (
                <ul className="max-h-[420px] space-y-1 overflow-y-auto">
                  {result.results.map((h, i) => (
                    <li key={`${h.path}-${h.line}-${i}`} className="rounded border border-zinc-800 bg-zinc-900 p-1.5">
                      <span className="font-mono text-[10px] text-amber-300">{h.path}:{h.line}</span>
                      <code className="ml-2 text-[11px] text-zinc-300">{h.text}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No matches.</Empty>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Tab 4: Team Dashboard ───────────────────────────────────────────────
interface TeamDash {
  teamId: string; teamName: string; memberCount: number; codebaseCount: number;
  totalFiles: number; totalFindings: number;
  severityTotals: Record<string, number>;
  topDetectors: { detectorId: string; label: string; count: number }[];
  perCodebase: { codebaseId: string; name: string; fileCount: number; findingCount: number; riskScore: number; bySeverity: Record<string, number> }[];
}

function TeamTab({ codebases, onChanged }: { codebases: CodebaseRow[]; onChanged: () => void }) {
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinCb, setJoinCb] = useState('');
  const [dash, setDash] = useState<TeamDash | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    if (!teamName.trim()) return;
    const r = await lensRun('dx-platform', 'createTeam', { name: teamName.trim() });
    if (r.data?.ok && r.data.result) {
      const id = (r.data.result as { teamId: string }).teamId;
      setTeamId(id); setJoinId(id); setMsg(`Team created — share ID ${id}`);
    }
  };

  const join = async () => {
    if (!joinId.trim()) return;
    const r = await lensRun('dx-platform', 'joinTeam', { teamId: joinId.trim(), codebaseId: joinCb || undefined });
    if (r.data?.ok) {
      setTeamId(joinId.trim()); setMsg('Joined team / attached codebase.'); onChanged();
    } else {
      setMsg(r.data?.error || 'Join failed.');
    }
  };

  const loadDash = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setDash(null);
    try {
      const r = await lensRun('dx-platform', 'teamDashboard', { teamId: id });
      if (r.data?.ok && r.data.result) setDash(r.data.result as TeamDash);
      else setMsg(r.data?.error || 'Dashboard unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (teamId) void loadDash(teamId); }, [teamId, loadDash]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-2">
          <h3 className="text-sm font-medium text-white">Create a team</h3>
          <div className="flex gap-2">
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
            />
            <button type="button" onClick={create} disabled={!teamName.trim()}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40">
              Create
            </button>
          </div>
        </section>
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-2">
          <h3 className="text-sm font-medium text-white">Join / attach codebase</h3>
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="Team ID"
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-white"
          />
          <div className="flex gap-2">
            <CodebasePicker codebases={codebases} value={joinCb} onChange={setJoinCb} />
            <button type="button" onClick={join} disabled={!joinId.trim()}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40">
              Join
            </button>
          </div>
        </section>
      </div>
      {msg && <p className="text-xs text-amber-300">{msg}</p>}

      {loading && <Spinner />}
      {dash && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">{dash.teamName} — aggregate</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Members', dash.memberCount],
              ['Codebases', dash.codebaseCount],
              ['Files', dash.totalFiles],
              ['Findings', dash.totalFindings],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</div>
                <div className="font-mono text-lg text-amber-300">{v}</div>
              </div>
            ))}
          </div>
          {dash.codebaseCount === 0 ? (
            <Empty>No codebases attached to this team yet. Use Join to attach one.</Empty>
          ) : (
            <>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Severity trend</div>
                <ChartKit
                  kind="bar"
                  height={180}
                  xKey="severity"
                  series={[{ key: 'count', label: 'Findings', color: '#f59e0b' }]}
                  data={[5, 4, 3, 2, 1].map((s) => ({ severity: `S${s}`, count: dash.severityTotals[String(s)] || 0 }))}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Per-codebase risk</div>
                <ul className="space-y-1">
                  {dash.perCodebase.map((c) => (
                    <li key={c.codebaseId} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs">
                      <span className="text-zinc-200">{c.name}</span>
                      <span className="flex gap-3 text-[11px] text-zinc-400">
                        <span>{c.fileCount} files</span>
                        <span>{c.findingCount} findings</span>
                        <span className="text-orange-300">risk {c.riskScore}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {dash.topDetectors.length > 0 && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Top detectors</div>
                  <ul className="space-y-1">
                    {dash.topDetectors.map((d) => (
                      <li key={d.detectorId} className="flex justify-between rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px]">
                        <span className="text-zinc-300">{d.label}</span>
                        <span className="font-mono text-amber-300">{d.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ── Tab 5: Detector Config ──────────────────────────────────────────────
function DetectorsTab({
  codebases, activeCb, setActiveCb,
}: { codebases: CodebaseRow[]; activeCb: string; setActiveCb: (v: string) => void }) {
  const [detectors, setDetectors] = useState<DetectorCfg[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (cb: string) => {
    if (!cb) { setDetectors([]); return; }
    setLoading(true); setMsg(null);
    try {
      const r = await lensRun('dx-platform', 'getDetectorConfig', { codebaseId: cb });
      if (r.data?.ok && r.data.result) {
        setDetectors((r.data.result as { detectors: DetectorCfg[] }).detectors);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(activeCb); }, [activeCb, load]);

  const toggle = (id: string) => {
    setDetectors((d) => d.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
  };

  const save = async () => {
    if (!activeCb) return;
    setSaving(true); setMsg(null);
    try {
      const enabledIds = detectors.filter((d) => d.enabled).map((d) => d.id);
      const r = await lensRun('dx-platform', 'setDetectorConfig', { codebaseId: activeCb, enabledIds });
      setMsg(r.data?.ok ? 'Detector config saved.' : (r.data?.error || 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-white">
        <SlidersHorizontal className="h-4 w-4 text-amber-400" aria-hidden /> Detector configuration
      </h3>
      {codebases.length === 0 ? (
        <Empty>Index a codebase to configure its detector grid.</Empty>
      ) : (
        <>
          <CodebasePicker codebases={codebases} value={activeCb} onChange={setActiveCb} />
          {loading && <Spinner />}
          {!loading && activeCb && (
            <>
              <ul className="space-y-1">
                {detectors.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={() => toggle(d.id)}
                      aria-label={`Enable ${d.label}`}
                    />
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SEV_COLOR[d.severity]}`}>S{d.severity}</span>
                    <span className="text-xs text-zinc-200">{d.label}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">{d.id}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save config'}
              </button>
              {msg && <p className="text-xs text-amber-300">{msg}</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}

// ── Tab 6: Usage Analytics ──────────────────────────────────────────────
interface Analytics {
  windowDays: number; totalFires: number; totalDecisions: number;
  accepted: number; rejected: number; ignored: number; acceptanceRate: number;
  topFiring: { detectorId: string; label: string; count: number }[];
  acceptanceTrend: { day: string; accepted: number; total: number; rate: number }[];
}

function AnalyticsTab() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [windowDays, setWindowDays] = useState(30);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    try {
      const r = await lensRun('dx-platform', 'usageAnalytics', { windowDays: days });
      if (r.data?.ok && r.data.result) setData(r.data.result as Analytics);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(windowDays); }, [windowDays, load]);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-white">
          <BarChart3 className="h-4 w-4 text-amber-400" aria-hidden /> Usage analytics
        </h3>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          aria-label="Analytics window"
        >
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>last {d}d</option>)}
        </select>
      </div>
      {loading && <Spinner />}
      {data && data.totalFires === 0 && data.totalDecisions === 0 && (
        <Empty>No detector activity recorded yet. Fix decisions and detector fires populate this view.</Empty>
      )}
      {data && (data.totalFires > 0 || data.totalDecisions > 0) && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Detector fires', data.totalFires],
              ['Fix decisions', data.totalDecisions],
              ['Accepted', data.accepted],
              ['Acceptance rate', `${Math.round(data.acceptanceRate * 100)}%`],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{k}</div>
                <div className="font-mono text-lg text-amber-300">{v}</div>
              </div>
            ))}
          </div>
          {data.topFiring.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Most-firing detectors</div>
              <ChartKit
                kind="bar"
                height={180}
                xKey="label"
                series={[{ key: 'count', label: 'Fires', color: '#6366f1' }]}
                data={data.topFiring.map((d) => ({ label: d.label, count: d.count }))}
              />
            </div>
          )}
          {data.acceptanceTrend.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Fix-acceptance rate over time</div>
              <ChartKit
                kind="line"
                height={180}
                xKey="day"
                series={[{ key: 'rate', label: 'Acceptance rate', color: '#22c55e' }]}
                data={data.acceptanceTrend.map((d) => ({ day: d.day, rate: d.rate }))}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── Tab 7: CI Integration ───────────────────────────────────────────────
function CiTab({
  codebases, activeCb, setActiveCb,
}: { codebases: CodebaseRow[]; activeCb: string; setActiveCb: (v: string) => void }) {
  const [failOn, setFailOn] = useState<'error' | 'warning' | 'any'>('error');
  const [yaml, setYaml] = useState<string | null>(null);
  const [path, setPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!activeCb) return;
    setLoading(true); setYaml(null); setCopied(false);
    try {
      const r = await lensRun('dx-platform', 'generateCiConfig', { codebaseId: activeCb, failOn });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { workflowYaml: string; path: string };
        setYaml(res.workflowYaml); setPath(res.path);
      }
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-white">
        <Workflow className="h-4 w-4 text-amber-400" aria-hidden /> CI integration
      </h3>
      <p className="text-xs text-zinc-400">Generate a GitHub Action that runs the detector pass as a pre-merge gate.</p>
      {codebases.length === 0 ? (
        <Empty>Index a codebase first to generate its CI workflow.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <CodebasePicker codebases={codebases} value={activeCb} onChange={setActiveCb} />
            <select
              value={failOn}
              onChange={(e) => setFailOn(e.target.value as 'error' | 'warning' | 'any')}
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
              aria-label="Fail-on threshold"
            >
              <option value="error">Fail on errors (S4+)</option>
              <option value="warning">Fail on warnings (S3+)</option>
              <option value="any">Fail on any finding</option>
            </select>
            <button
              type="button"
              onClick={generate}
              disabled={loading || !activeCb}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-40"
            >
              {loading ? 'Generating…' : 'Generate workflow'}
            </button>
          </div>
          {yaml && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-amber-300">{path}</span>
                <button
                  type="button"
                  onClick={copy}
                  className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:border-zinc-600"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-200">
                {yaml}
              </pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
