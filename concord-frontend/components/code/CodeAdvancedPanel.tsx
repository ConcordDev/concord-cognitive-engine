'use client';

// CodeAdvancedPanel — surfaces the seven Cursor / VS Code parity features that
// previously had backend macros but no UI:
//   1. Live language-server IntelliSense (hover types + signature help)
//   2. Remote GitHub repo push / pull
//   3. Step debugger with breakpoints + watch + call stack
//   4. Codebase-wide AI chat with @-file context
//   5. Extensions / plugin system
//   6. Split-pane multi-file editing layout
//   7. Real-time multiplayer / Live Share
//
// Every value shown here is real: project files from the virtual workspace,
// live GitHub REST data, sandbox-executed debug frames, LLM replies, and
// per-user persisted extensions / layouts / sessions. No mock data.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useYjsDoc } from '@/lib/hooks/useYjsDoc';
import * as Y from 'yjs';
import {
  Sparkles, Bug, Github, MessageSquare, Puzzle, Columns, Users,
  Loader2, Play, Plus, Trash2, RefreshCw, Send, Power, GitBranch,
  Terminal as TerminalIcon, MapPin,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ProjectSwitcher } from './ProjectSwitcher';

type AdvTab = 'intellisense' | 'debugger' | 'remote' | 'chat' | 'extensions' | 'layout' | 'liveshare';

const TABS: { id: AdvTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'intellisense', label: 'IntelliSense', icon: Sparkles },
  { id: 'debugger', label: 'Debugger', icon: Bug },
  { id: 'remote', label: 'Remote Git', icon: Github },
  { id: 'chat', label: 'Codebase Chat', icon: MessageSquare },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'layout', label: 'Split View', icon: Columns },
  { id: 'liveshare', label: 'Live Share', icon: Users },
];

interface FileRow { path: string; language: string; size: number }

export function CodeAdvancedPanel() {
  const [tab, setTab] = useState<AdvTab>('intellisense');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);

  const refreshFiles = useCallback(async () => {
    if (!projectId) { setFiles([]); return; }
    try {
      const r = await lensRun('code', 'files-tree', { projectId });
      if (r.data?.ok) setFiles((r.data.result?.tree || []) as FileRow[]);
    } catch { /* best effort */ }
  }, [projectId]);

  useEffect(() => { void refreshFiles(); }, [refreshFiles]);

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-[#0d1117] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 bg-[#161b22]">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-cyan-300">Advanced IDE</h3>
        <span className="text-[10px] text-gray-400">Cursor-parity tools</span>
      </div>

      <div className="px-3 pt-3">
        <ProjectSwitcher value={projectId} onChange={setProjectId} />
      </div>

      <div className="flex flex-wrap gap-1 px-3 pt-3 border-b border-white/10 pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {!projectId ? (
          <div className="py-10 text-center text-xs text-gray-400">
            Select or create a project above to use the advanced IDE tools.
          </div>
        ) : (
          <>
            {tab === 'intellisense' && <IntelliSenseTab projectId={projectId} files={files} />}
            {tab === 'debugger' && <DebuggerTab projectId={projectId} files={files} />}
            {tab === 'remote' && <RemoteGitTab projectId={projectId} onPulled={refreshFiles} />}
            {tab === 'chat' && <CodebaseChatTab projectId={projectId} files={files} />}
            {tab === 'extensions' && <ExtensionsTab />}
            {tab === 'layout' && <SplitLayoutTab projectId={projectId} files={files} />}
            {tab === 'liveshare' && <LiveShareTab projectId={projectId} files={files} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── 1. IntelliSense — hover types + signature help ─────────────────────────
function IntelliSenseTab({ projectId, files }: { projectId: string; files: FileRow[] }) {
  const [path, setPath] = useState('');
  const [symbol, setSymbol] = useState('');
  const [hover, setHover] = useState<Record<string, unknown> | null>(null);
  const [sig, setSig] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!path && files[0]) setPath(files[0].path); }, [files, path]);

  const lookup = useCallback(async () => {
    if (!symbol.trim() || !path) return;
    setBusy(true); setErr(null); setHover(null); setSig(null);
    try {
      const [h, s] = await Promise.all([
        lensRun('code', 'lsp-hover', { projectId, path, symbol: symbol.trim() }),
        lensRun('code', 'lsp-signature', { projectId, symbol: symbol.trim() }),
      ]);
      if (h.data?.ok) setHover(h.data.result as Record<string, unknown>);
      else setErr(h.data?.error || 'hover failed');
      if (s.data?.ok) setSig(s.data.result as Record<string, unknown>);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'lookup failed');
    } finally { setBusy(false); }
  }, [projectId, path, symbol]);

  const params = (sig?.parameters as { name: string; type: string | null; label: string }[]) || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Resolve a symbol&apos;s declared type, signature and doc-comment across every file in the project.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200"
        >
          {files.length === 0 && <option value="">no files</option>}
          {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
          placeholder="Symbol name (function / class / variable)"
          className="flex-1 min-w-[200px] bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <button
          onClick={lookup}
          disabled={busy || !symbol.trim() || !path}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Resolve
        </button>
      </div>
      {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
      {hover && (
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
          {hover.found ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">{String(hover.kind || 'symbol')}</span>
                <span className="text-[10px] text-gray-400">{String(hover.source || '')}</span>
              </div>
              <code className="block text-xs text-cyan-200 font-mono break-words">{String(hover.hover || hover.type || '')}</code>
              {hover.definedAt != null && (
                <p className="text-[10px] text-gray-400">
                  defined at {(hover.definedAt as { path: string; line: number }).path}:{(hover.definedAt as { path: string; line: number }).line}
                </p>
              )}
              {hover.doc != null && <p className="text-xs text-gray-400 italic">{String(hover.doc)}</p>}
            </>
          ) : (
            <p className="text-xs text-gray-400">{String(hover.hover || 'No declaration found.')}</p>
          )}
        </div>
      )}
      {sig?.found ? (
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
          <p className="text-[10px] uppercase text-gray-400">Signature help</p>
          <code className="block text-xs text-green-300 font-mono break-words">{String(sig.label || '')}</code>
          {params.length > 0 && (
            <ul className="space-y-1">
              {params.map((p, i) => (
                <li key={i} className="text-xs text-gray-300 flex gap-2">
                  <span className="text-cyan-400 font-mono">{p.name}</span>
                  {p.type && <span className="text-gray-400 font-mono">: {p.type}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-gray-400">returns <span className="text-yellow-400 font-mono">{String(sig.returnType || 'unknown')}</span></p>
        </div>
      ) : null}
    </div>
  );
}

// ── 2. Step debugger — breakpoints + watch + call stack ────────────────────
function DebuggerTab({ projectId, files }: { projectId: string; files: FileRow[] }) {
  const [path, setPath] = useState('');
  const [code, setCode] = useState('');
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [watch, setWatch] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!path && files[0]) setPath(files[0].path); }, [files, path]);

  const loadFile = useCallback(async (p: string) => {
    setPath(p); setBreakpoints(new Set()); setResult(null);
    try {
      const r = await lensRun('code', 'files-read', { projectId, path: p });
      if (r.data?.ok) setCode(String(r.data.result?.content || ''));
    } catch { /* best effort */ }
  }, [projectId]);

  useEffect(() => { if (path) void loadFile(path); }, [path, loadFile]);

  const toggleBp = useCallback((line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line); else next.add(line);
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (!code.trim()) return;
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await lensRun('code', 'debug-run', {
        code,
        language: path.endsWith('.ts') || path.endsWith('.tsx') ? 'typescript' : 'javascript',
        breakpoints: Array.from(breakpoints),
        watch: watch.split(',').map((w) => w.trim()).filter(Boolean),
      });
      if (r.data?.ok) setResult(r.data.result as Record<string, unknown>);
      else setErr(r.data?.error || 'debug run failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'debug failed');
    } finally { setBusy(false); }
  }, [code, path, breakpoints, watch]);

  const lines = code.split('\n');
  const frames = (result?.frames as { line: number; sourceText: string; callStack: string[]; watch: Record<string, string> }[]) || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Click a line number to set a breakpoint. Run captures a real call stack + watch values each time a breakpoint is hit.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          value={path}
          onChange={(e) => loadFile(e.target.value)}
          className="bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200"
        >
          {files.length === 0 && <option value="">no files</option>}
          {files.filter((f) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f.path)).map((f) => (
            <option key={f.path} value={f.path}>{f.path}</option>
          ))}
        </select>
        <input
          value={watch}
          onChange={(e) => setWatch(e.target.value)}
          placeholder="Watch expressions, comma-separated"
          className="flex-1 min-w-[180px] bg-[#161b22] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <button
          onClick={run}
          disabled={busy || !code.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Debug
        </button>
      </div>
      {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
      <div className="rounded-lg border border-white/10 bg-[#161b22] overflow-auto max-h-72">
        {lines.length === 1 && !lines[0] ? (
          <p className="p-3 text-xs text-gray-400">No file loaded yet.</p>
        ) : (
          <table className="w-full font-mono text-xs">
            <tbody>
              {lines.map((ln, i) => {
                const lineNo = i + 1;
                const isBp = breakpoints.has(lineNo);
                return (
                  <tr key={lineNo} className="hover:bg-white/[0.03]">
                    <td
                      onClick={() => toggleBp(lineNo)}
                      className="w-12 select-none cursor-pointer text-right pr-2 text-gray-600 align-top"
                    >
                      {isBp ? <span className="text-red-500">●</span> : lineNo}
                    </td>
                    <td className="text-gray-300 whitespace-pre pl-2 align-top">{ln || ' '}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">{frames.length} breakpoint hit{frames.length === 1 ? '' : 's'}</span>
            <span className={`${(result.exitCode as number) === 0 ? 'text-green-400' : 'text-red-400'}`}>
              exit {String(result.exitCode)}
            </span>
            <span className="text-gray-400">{String(result.durationMs || 0)}ms</span>
          </div>
          {frames.length === 0 && <p className="text-xs text-gray-400">No breakpoints were hit. Set one and run again.</p>}
          {frames.map((f, i) => (
            <div key={i} className="rounded border border-white/10 bg-[#0d1117] p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">line {f.line}</span>
                <code className="text-xs text-gray-300 font-mono truncate">{f.sourceText}</code>
              </div>
              {Object.keys(f.watch || {}).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(f.watch).map(([k, v]) => (
                    <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">
                      {k} = {v}
                    </span>
                  ))}
                </div>
              )}
              {f.callStack.length > 0 && (
                <ol className="text-[10px] text-gray-400 font-mono space-y-0.5">
                  {f.callStack.map((c, ci) => <li key={ci}>↳ {c}</li>)}
                </ol>
              )}
            </div>
          ))}
          {(result.stdout as string) ? (
            <pre className="text-[11px] text-green-400 font-mono bg-[#0d1117] rounded p-2 whitespace-pre-wrap">{String(result.stdout)}</pre>
          ) : null}
          {(result.stderr as string) ? (
            <pre className="text-[11px] text-red-400 font-mono bg-[#0d1117] rounded p-2 whitespace-pre-wrap">{String(result.stderr)}</pre>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── 3. Remote GitHub repo push / pull ──────────────────────────────────────
function RemoteGitTab({ projectId, onPulled }: { projectId: string; onPulled: () => void }) {
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('');
  const [pushMsg, setPushMsg] = useState('');
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await lensRun('code', 'github-remote-status', { projectId });
      if (r.data?.ok) setStatus(r.data.result as Record<string, unknown>);
    } catch { /* best effort */ }
  }, [projectId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const pull = useCallback(async () => {
    if (!owner.trim() || !repo.trim()) return;
    setBusy('pull'); setErr(null); setNote(null);
    try {
      const r = await lensRun('code', 'github-pull', { projectId, owner: owner.trim(), repo: repo.trim(), ref: ref.trim() });
      if (r.data?.ok) {
        setNote(`Pulled ${r.data.result?.pulledFiles} file(s) from ${owner}/${repo}.`);
        onPulled();
        await refreshStatus();
      } else setErr(r.data?.error || 'pull failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'pull failed');
    } finally { setBusy(null); }
  }, [projectId, owner, repo, ref, onPulled, refreshStatus]);

  const push = useCallback(async () => {
    if (!pushMsg.trim()) return;
    setBusy('push'); setErr(null); setNote(null);
    try {
      const r = await lensRun('code', 'github-push', { projectId, message: pushMsg.trim() });
      if (r.data?.ok) {
        setNote(String(r.data.result?.note || 'Push staged.'));
        setPushMsg('');
        await refreshStatus();
      } else setErr(r.data?.error || 'push failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'push failed');
    } finally { setBusy(null); }
  }, [projectId, pushMsg, refreshStatus]);

  const remote = status?.remote as { owner: string; repo: string; url: string; defaultBranch: string; stars: number } | null;
  const pushLog = (status?.pushLog as { id: string; message: string; fileCount: number; pushedAt: string; branch: string }[]) || [];

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Pull a public GitHub repo into this project, then stage commits to push back. GitHub write delivery requires an OAuth token in BYO keys.
      </p>
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
        <p className="text-[10px] uppercase text-gray-400">Clone a repo</p>
        <div className="flex flex-wrap gap-2">
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner"
            className="flex-1 min-w-[100px] bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo"
            className="flex-1 min-w-[100px] bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="branch (optional)"
            className="w-36 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
          <button onClick={pull} disabled={busy !== null || !owner.trim() || !repo.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40">
            {busy === 'pull' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Github className="w-3.5 h-3.5" />}
            Pull
          </button>
        </div>
      </div>
      {remote && (
        <div className="rounded-lg border border-cyan-500/30 bg-[#161b22] p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Github className="w-4 h-4 text-cyan-400" />
            <a href={remote.url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">
              {remote.owner}/{remote.repo}
            </a>
            <span className="text-[10px] text-gray-400">★ {remote.stars}</span>
            <span className="text-[10px] text-gray-400 flex items-center gap-1"><GitBranch className="w-3 h-3" />{remote.defaultBranch}</span>
          </div>
          <div className="flex gap-2">
            <input value={pushMsg} onChange={(e) => setPushMsg(e.target.value)} placeholder="Commit message for push"
              className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
            <button onClick={push} disabled={busy !== null || !pushMsg.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-40">
              {busy === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Push
            </button>
          </div>
        </div>
      )}
      {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
      {note && <div className="text-xs text-green-400 px-2 py-1.5 bg-green-500/10 rounded">{note}</div>}
      {pushLog.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-3">
          <p className="text-[10px] uppercase text-gray-400 mb-2">Push history</p>
          <ul className="space-y-1.5">
            {pushLog.map((p) => (
              <li key={p.id} className="text-xs text-gray-300 flex items-center gap-2">
                <span className="text-gray-400 font-mono">{p.branch}</span>
                <span className="flex-1 truncate">{p.message}</span>
                <span className="text-[10px] text-gray-400">{p.fileCount} files</span>
                <span className="text-[10px] text-gray-400">{new Date(p.pushedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── 4. Codebase-wide AI chat with @-file context ───────────────────────────
function CodebaseChatTab({ projectId, files }: { projectId: string; files: FileRow[] }) {
  type Msg = { role: 'user' | 'assistant'; content: string; contextFiles?: string[] };
  const [history, setHistory] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...history, { role: 'user', content: text }];
    setHistory(next);
    setDraft('');
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('code', 'codebase-chat', {
        projectId,
        message: text,
        history: history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
      });
      if (r.data?.ok) {
        setHistory([...next, {
          role: 'assistant',
          content: String(r.data.result?.reply || '(no response)'),
          contextFiles: (r.data.result?.contextFiles as string[]) || [],
        }]);
      } else {
        setErr(r.data?.error || 'chat failed');
        setHistory(history);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'chat failed');
      setHistory(history);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }, [draft, busy, history, projectId]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Ask anything about this codebase. Reference files with <code className="text-cyan-300">@path</code> to attach them; otherwise the most-recently-edited files are used.
      </p>
      <div ref={scrollRef} className="rounded-lg border border-white/10 bg-[#161b22] p-3 max-h-72 overflow-y-auto space-y-3">
        {history.length === 0 ? (
          <p className="text-xs text-gray-400 py-6 text-center">
            No messages yet. Try &quot;explain @{files[0]?.path || 'file'}&quot; or &quot;where is auth handled?&quot;
          </p>
        ) : history.map((m, i) => (
          <div key={i} className={`flex flex-col gap-1 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <span className="text-[9px] uppercase text-gray-400">{m.role === 'user' ? 'you' : 'codebase ai'}</span>
            <div className={`max-w-[90%] px-3 py-2 rounded-lg text-xs whitespace-pre-wrap break-words ${
              m.role === 'user' ? 'bg-cyan-500/10 border border-cyan-500/30 text-gray-100' : 'bg-[#0d1117] border border-white/10 text-gray-200'
            }`}>
              {m.content}
            </div>
            {m.contextFiles && m.contextFiles.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {m.contextFiles.map((f) => (
                  <span key={f} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400">@{f}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" /> indexing codebase…
          </div>
        )}
      </div>
      {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Ask about your codebase…"
          disabled={busy}
          className="flex-1 bg-[#161b22] border border-white/10 rounded px-3 py-2 text-xs text-gray-200"
        />
        <button onClick={send} disabled={busy || !draft.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40">
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </div>
    </div>
  );
}

// ── 5. Extensions / plugin system ──────────────────────────────────────────
function ExtensionsTab() {
  type Ext = { id: string; name: string; kind: string; description: string; enabled?: boolean; installedAt?: string };
  const [catalog, setCatalog] = useState<Ext[]>([]);
  const [installed, setInstalled] = useState<Ext[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([
        lensRun('code', 'extensions-catalog', {}),
        lensRun('code', 'extensions-list', {}),
      ]);
      if (c.data?.ok) setCatalog((c.data.result?.catalog || []) as Ext[]);
      if (l.data?.ok) setInstalled((l.data.result?.extensions || []) as Ext[]);
    } catch { /* best effort */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const install = useCallback(async (id: string) => {
    setBusy(id);
    try { await lensRun('code', 'extensions-install', { extensionId: id }); await refresh(); }
    finally { setBusy(null); }
  }, [refresh]);

  const uninstall = useCallback(async (id: string) => {
    setBusy(id);
    try { await lensRun('code', 'extensions-uninstall', { extensionId: id }); await refresh(); }
    finally { setBusy(null); }
  }, [refresh]);

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    setBusy(id);
    try { await lensRun('code', 'extensions-toggle', { extensionId: id, enabled }); await refresh(); }
    finally { setBusy(null); }
  }, [refresh]);

  const installedIds = new Set(installed.map((e) => e.id));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] uppercase text-gray-400 mb-2">Installed ({installed.length})</p>
        {installed.length === 0 ? (
          <p className="text-xs text-gray-400">No extensions installed yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {installed.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded border border-white/10 bg-[#161b22] p-2.5">
                <Puzzle className={`w-4 h-4 ${e.enabled ? 'text-cyan-400' : 'text-gray-600'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 truncate">{e.name}</p>
                  <p className="text-[10px] text-gray-400">{e.kind}</p>
                </div>
                <button onClick={() => toggle(e.id, !e.enabled)} disabled={busy === e.id}
                  className={`p-1.5 rounded ${e.enabled ? 'text-green-400 hover:bg-green-500/10' : 'text-gray-600 hover:bg-white/5'}`}
                  title={e.enabled ? 'Disable' : 'Enable'}>
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => uninstall(e.id)} disabled={busy === e.id}
                  className="p-1.5 rounded text-red-400 hover:bg-red-500/10" title="Uninstall">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="text-[10px] uppercase text-gray-400 mb-2">Marketplace</p>
        <ul className="space-y-1.5">
          {catalog.filter((e) => !installedIds.has(e.id)).map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded border border-white/10 bg-[#161b22] p-2.5">
              <Puzzle className="w-4 h-4 text-gray-400" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 truncate">{e.name}</p>
                <p className="text-[10px] text-gray-400 truncate">{e.description}</p>
              </div>
              <button onClick={() => install(e.id)} disabled={busy === e.id}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold disabled:opacity-40">
                {busy === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Install
              </button>
            </li>
          ))}
          {catalog.length > 0 && catalog.every((e) => installedIds.has(e.id)) && (
            <li className="text-xs text-gray-400">All catalog extensions installed.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ── 6. Split-pane multi-file editing layout ────────────────────────────────
type LayoutOrientation = 'single' | 'vertical' | 'horizontal' | 'grid';
function paneCountFor(o: LayoutOrientation): number {
  return o === 'single' ? 1 : o === 'grid' ? 4 : 2;
}

function SplitLayoutTab({ projectId, files }: { projectId: string; files: FileRow[] }) {
  type Pane = { id: string; path: string | null };
  const [orientation, setOrientation] = useState<LayoutOrientation>('single');
  const [panes, setPanes] = useState<Pane[]>([{ id: 'pane-1', path: null }]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await lensRun('code', 'layout-get', { projectId });
      if (r.data?.ok) {
        const l = r.data.result?.layout as { orientation: LayoutOrientation; panes: Pane[] };
        if (l) { setOrientation(l.orientation); setPanes(l.panes); }
      }
    } catch { /* best effort */ }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const changeOrientation = useCallback((o: LayoutOrientation) => {
    setOrientation(o);
    setSaved(false);
    const count = paneCountFor(o);
    setPanes((prev) => {
      const next: Pane[] = [];
      for (let i = 0; i < count; i++) next.push(prev[i] || { id: `pane-${i + 1}`, path: null });
      return next;
    });
  }, []);

  const setPanePath = useCallback((idx: number, path: string) => {
    setPanes((prev) => prev.map((p, i) => i === idx ? { ...p, path: path || null } : p));
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      const r = await lensRun('code', 'layout-save', { projectId, orientation, panes });
      if (r.data?.ok) setSaved(true);
    } finally { setBusy(false); }
  }, [projectId, orientation, panes]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Arrange multiple files side by side. The layout persists per project so your editor split survives reload.
      </p>
      <div className="flex gap-2">
        {(['single', 'vertical', 'horizontal', 'grid'] as const).map((o) => (
          <button key={o} onClick={() => changeOrientation(o)}
            className={`px-3 py-1.5 rounded text-xs capitalize ${
              orientation === o ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40' : 'text-gray-400 border border-white/10 hover:text-gray-200'
            }`}>
            {o}
          </button>
        ))}
      </div>
      <div className={`grid gap-2 ${
        orientation === 'single' ? 'grid-cols-1' :
        orientation === 'vertical' ? 'grid-cols-2' :
        orientation === 'horizontal' ? 'grid-rows-2 grid-cols-1' :
        'grid-cols-2 grid-rows-2'
      }`}>
        {panes.map((p, i) => (
          <div key={p.id} className="rounded-lg border border-white/10 bg-[#161b22] p-3 min-h-[80px]">
            <p className="text-[10px] uppercase text-gray-400 mb-1.5">Pane {i + 1}</p>
            <select
              value={p.path || ''}
              onChange={(e) => setPanePath(i, e.target.value)}
              className="w-full bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200"
            >
              <option value="">— empty —</option>
              {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </select>
            {p.path && (
              <p className="text-[10px] text-gray-400 mt-1.5 font-mono truncate">{p.path}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Columns className="w-3.5 h-3.5" />}
          Save layout
        </button>
        {saved && <span className="text-xs text-green-400">Layout saved.</span>}
      </div>
    </div>
  );
}

// ── 7. Real-time multiplayer / Live Share ──────────────────────────────────
function LiveShareTab({ projectId, files }: { projectId: string; files: FileRow[] }) {
  type Session = {
    code: string; name: string; hostId: string; status: string;
    participants: { userId: string; role: string }[]; participantCount: number; opCount: number;
  };
  type Op = { seq: number; kind: string; actor: string; path?: string; at: string };
  const [session, setSession] = useState<Session | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [editPath, setEditPath] = useState('');
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sinceRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Yjs CRDT: bind each file's content to a per-file Y.Text inside the
  // session's Y.Doc. Concurrent overlapping edits merge structurally
  // instead of last-write-wins. The poll path + op-log stays as a
  // backstop (session activity feed, late-rejoin recovery).
  const { doc: yDoc, synced: yDocSynced } = useYjsDoc({
    scope: 'code:liveshare',
    docId: session?.code ?? null,
    enabled: !!session,
  });
  const yTextRef = useRef<Y.Text | null>(null);
  const applyingRemoteRef = useRef(false);
  useEffect(() => {
    if (!yDoc || !editPath) { yTextRef.current = null; return; }
    const files = yDoc.getMap<Y.Text>('files');
    let text = files.get(editPath);
    if (!text) {
      // Lazy-create per-file Y.Text; initialise with current local
      // content so we don't blow away an unsaved edit on first bind.
      text = new Y.Text();
      if (editContent) text.insert(0, editContent);
      files.set(editPath, text);
    }
    yTextRef.current = text;
    // Hydrate local textarea from current CRDT state.
    applyingRemoteRef.current = true;
    setEditContent(text.toString());
    applyingRemoteRef.current = false;
    const observer = () => {
      applyingRemoteRef.current = true;
      setEditContent(text!.toString());
      applyingRemoteRef.current = false;
    };
    text.observe(observer);
    return () => { try { text!.unobserve(observer); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yDoc, editPath, yDocSynced]);
  const onEditContentChange = useCallback((next: string) => {
    setEditContent(next);
    if (applyingRemoteRef.current) return;
    const text = yTextRef.current;
    if (!text) return;
    // Diff-replace: simplest correct approach for textarea. For Monaco
    // we'd use binding utilities; here the textarea is small.
    const current = text.toString();
    if (current === next) return;
    text.doc?.transact(() => {
      text.delete(0, current.length);
      text.insert(0, next);
    });
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback(async (code: string) => {
    try {
      const r = await lensRun('code', 'liveshare-poll', { code, since: sinceRef.current });
      if (r.data?.ok) {
        setSession(r.data.result?.session as Session);
        const newOps = (r.data.result?.ops as Op[]) || [];
        if (newOps.length > 0) setOps((prev) => [...prev, ...newOps].slice(-100));
        sinceRef.current = Number(r.data.result?.nextSince || sinceRef.current);
      }
    } catch { /* best effort */ }
  }, []);

  // Phase 4 realtime push: subscribe to `liveshare:op` on the session's
  // Socket.IO room (the server emits there from `liveshare-edit`). On
  // any event, run an immediate poll so ops appear without waiting for
  // the 3s tick. The 3s poll stays as a fallback in case the socket
  // drops; with both, typical latency drops from 3s to single-digit ms.
  const socketRef = useRef<unknown>(null);
  const startSocket = useCallback(async (code: string) => {
    if (typeof window === 'undefined') return;
    try {
      const { io } = await import('socket.io-client');
      const s = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
      s.emit('room:join', { room: `code:liveshare:${code}` });
      s.on('liveshare:op', () => { void poll(code); });
      socketRef.current = s;
    } catch { /* graceful fallback to poll only */ }
  }, [poll]);
  const stopSocket = useCallback(() => {
    const s = socketRef.current as { disconnect?: () => void } | null;
    try { s?.disconnect?.(); } catch { /* ignore */ }
    socketRef.current = null;
  }, []);

  const startPoll = useCallback((code: string) => {
    stopPoll();
    pollRef.current = setInterval(() => void poll(code), 3000);
    void startSocket(code);
  }, [poll, stopPoll, startSocket]);

  useEffect(() => () => { stopPoll(); stopSocket(); }, [stopPoll, stopSocket]);

  const start = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('code', 'liveshare-start', { projectId, name: sessionName.trim() || 'Live Share session' });
      if (r.data?.ok) {
        const s = r.data.result?.session as Session;
        setSession(s); setOps([]); sinceRef.current = 0;
        startPoll(s.code);
      } else setErr(r.data?.error || 'could not start session');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'start failed');
    } finally { setBusy(false); }
  }, [projectId, sessionName, startPoll]);

  const join = useCallback(async () => {
    if (!joinCode.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('code', 'liveshare-join', { code: joinCode.trim().toUpperCase() });
      if (r.data?.ok) {
        const s = r.data.result?.session as Session;
        setSession(s); setOps([]); sinceRef.current = 0;
        startPoll(s.code);
      } else setErr(r.data?.error || 'could not join session');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'join failed');
    } finally { setBusy(false); }
  }, [joinCode, startPoll]);

  const broadcast = useCallback(async () => {
    if (!session || !editPath.trim()) return;
    setBusy(true);
    try {
      await lensRun('code', 'liveshare-edit', { code: session.code, path: editPath.trim(), content: editContent });
      await poll(session.code);
    } finally { setBusy(false); }
  }, [session, editPath, editContent, poll]);

  const end = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      await lensRun('code', 'liveshare-end', { code: session.code });
      stopPoll();
      setSession(null); setOps([]);
    } finally { setBusy(false); }
  }, [session, stopPoll]);

  if (!session) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          Start a collaborative session and share the code, or join an existing session. Edits broadcast to every participant.
        </p>
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
          <p className="text-[10px] uppercase text-gray-400">Host a session</p>
          <div className="flex gap-2">
            <input value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="Session name (optional)"
              className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200" />
            <button onClick={start} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
              Start
            </button>
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
          <p className="text-[10px] uppercase text-gray-400">Join a session</p>
          <div className="flex gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Session code"
              className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 font-mono uppercase" />
            <button onClick={join} disabled={busy || !joinCode.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Join
            </button>
          </div>
        </div>
        {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-cyan-500/30 bg-[#161b22] p-3 flex items-center gap-3">
        <Users className="w-4 h-4 text-cyan-400" />
        <div className="flex-1">
          <p className="text-xs text-gray-200">{session.name}</p>
          <p className="text-[10px] text-gray-400">
            code <span className="font-mono text-cyan-300">{session.code}</span> · {session.participantCount} participant{session.participantCount === 1 ? '' : 's'} · {session.status}
          </p>
        </div>
        <button onClick={() => void poll(session.code)} className="p-1.5 rounded text-gray-400 hover:bg-white/5" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button onClick={end} disabled={busy}
          className="px-2.5 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-bold disabled:opacity-40">
          End
        </button>
      </div>
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-2">
        <p className="text-[10px] uppercase text-gray-400">Broadcast an edit</p>
        <select value={editPath} onChange={(e) => setEditPath(e.target.value)}
          className="w-full bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200">
          <option value="">— select file —</option>
          {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
        <textarea value={editContent} onChange={(e) => onEditContentChange(e.target.value)} rows={3}
          placeholder="File content to broadcast to participants"
          className="w-full bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 font-mono resize-y" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-gray-400">
            {yDocSynced
              ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />CRDT synced — concurrent edits merge structurally</>
              : <><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1.5" />CRDT connecting…</>}
          </p>
          <button onClick={broadcast} disabled={busy || !editPath.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold disabled:opacity-40"
            title="Snapshot the current text to the session op-log (CRDT sync happens automatically as you type)">
            <Send className="w-3.5 h-3.5" /> Snapshot to op-log
          </button>
        </div>
      </div>
      {/* Shared awareness — breakpoints from peers + shared terminal. */}
      <SharedDebugTerminalTile code={session.code} />
      <div className="rounded-lg border border-white/10 bg-[#161b22] p-3">
        <p className="text-[10px] uppercase text-gray-400 mb-2">Session activity ({ops.length})</p>
        {ops.length === 0 ? (
          <p className="text-xs text-gray-400">No activity yet. Edits and joins appear here.</p>
        ) : (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {ops.map((o) => (
              <li key={o.seq} className="text-xs text-gray-300 flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${o.kind === 'edit' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-green-500/15 text-green-300'}`}>
                  {o.kind}
                </span>
                <span className="text-gray-400 font-mono">{o.actor}</span>
                {o.path && <span className="font-mono text-gray-400 truncate">{o.path}</span>}
                <span className="ml-auto text-[10px] text-gray-400">{new Date(o.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {err && <div className="text-xs text-red-400 px-2 py-1.5 bg-red-500/10 rounded">{err}</div>}
    </div>
  );
}

// Shared debugger awareness + shared terminal tile.
// Subscribes to `liveshare:debug:*` and `liveshare:terminal:*` events on
// the Live Share session's Socket.IO room (handled server-side by
// server/lib/code-liveshare-bus.js). Pure pub-sub: the server doesn't
// run debuggers or PTYs, it just relays state between participants so
// each client sees what the others have set / executed.
function SharedDebugTerminalTile({ code }: { code: string }) {
  type Bp = { path: string; line: number; fromPeerId?: string };
  type TermLine = { kind: 'in' | 'out'; data: string; from: string; at: number };
  const [breakpoints, setBreakpoints] = useState<Bp[]>([]);
  const [currentLine, setCurrentLine] = useState<{ path: string; line: number; peerId: string } | null>(null);
  const [debugState, setDebugState] = useState<'running' | 'paused' | 'stopped' | null>(null);
  const [terminalLog, setTerminalLog] = useState<TermLine[]>([]);
  const [terminalInput, setTerminalInput] = useState('');
  const socketRef = useRef<unknown>(null);
  const terminalId = 'shared-1';

  useEffect(() => {
    type Sock = { emit: (e: string, p: unknown) => void; on: (e: string, fn: (p: unknown) => void) => void; disconnect: () => void };
    let s: Sock | null = null;
    let disposed = false;
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (disposed) return;
        // socket.io-client returns a Socket whose typed signature is
        // narrower than the structural shape we use here; cast through
        // unknown so TS keeps `s` as Sock for the closures below.
        s = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true }) as unknown as Sock;
        socketRef.current = s;
        s.emit('room:join', { room: `code:liveshare:${code}` });
        s.emit('liveshare:debug:state-request', { code });
        s.on('liveshare:debug:state-snapshot', (p: unknown) => {
          const data = p as { breakpoints: Bp[]; currentLine: typeof currentLine };
          setBreakpoints(data.breakpoints || []);
          setCurrentLine(data.currentLine || null);
        });
        s.on('liveshare:debug:breakpoint-set', (p: unknown) => {
          const d = p as Bp;
          setBreakpoints(prev => prev.find(b => b.path === d.path && b.line === d.line)
            ? prev
            : [...prev, { path: d.path, line: d.line, fromPeerId: d.fromPeerId }]);
        });
        s.on('liveshare:debug:breakpoint-cleared', (p: unknown) => {
          const d = p as Bp;
          setBreakpoints(prev => prev.filter(b => !(b.path === d.path && b.line === d.line)));
        });
        s.on('liveshare:debug:current-line', (p: unknown) => {
          const d = p as { path: string; line: number; fromPeerId: string };
          setCurrentLine({ path: d.path, line: d.line, peerId: d.fromPeerId });
        });
        s.on('liveshare:debug:state', (p: unknown) => {
          const d = p as { state: typeof debugState };
          setDebugState(d.state || null);
        });
        s.on('liveshare:terminal:input', (p: unknown) => {
          const d = p as { data: string; fromPeerId: string };
          setTerminalLog(prev => [...prev, { kind: 'in' as const, data: d.data, from: d.fromPeerId.slice(0, 6), at: Date.now() }].slice(-200));
        });
        s.on('liveshare:terminal:output', (p: unknown) => {
          const d = p as { data: string; fromPeerId: string };
          setTerminalLog(prev => [...prev, { kind: 'out' as const, data: d.data, from: d.fromPeerId.slice(0, 6), at: Date.now() }].slice(-200));
        });
      } catch { /* graceful: tile shows empty state */ }
    })();
    return () => {
      disposed = true;
      try { s?.disconnect(); } catch { /* ignore */ }
      socketRef.current = null;
    };
  }, [code]);

  const sendInput = useCallback(() => {
    const s = socketRef.current as { emit: (e: string, p: unknown) => void } | null;
    if (!s || !terminalInput.trim()) return;
    s.emit('liveshare:terminal:input', { code, terminalId, data: terminalInput + '\n' });
    setTerminalInput('');
  }, [code, terminalInput]);

  return (
    <div className="rounded-lg border border-white/10 bg-[#161b22] p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Bug className="w-3.5 h-3.5 text-amber-400" />
        <p className="text-[10px] uppercase text-gray-400">Shared debug awareness</p>
        {debugState && (
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-mono ${
            debugState === 'running' ? 'bg-emerald-500/20 text-emerald-300' :
            debugState === 'paused' ? 'bg-amber-500/20 text-amber-300' :
            'bg-gray-500/20 text-gray-300'
          }`}>{debugState}</span>
        )}
      </div>
      {currentLine && (
        <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
          <MapPin className="w-3 h-3" />
          <span>peer <span className="font-mono">{currentLine.peerId.slice(0, 6)}</span> paused at</span>
          <span className="font-mono text-gray-300">{currentLine.path}:{currentLine.line}</span>
        </div>
      )}
      {breakpoints.length === 0 ? (
        <p className="text-[11px] text-gray-400">No shared breakpoints yet — setting one in your local debugger broadcasts it to the session.</p>
      ) : (
        <ul className="space-y-1 max-h-24 overflow-y-auto">
          {breakpoints.slice(0, 20).map((b, i) => (
            <li key={`${b.path}:${b.line}:${i}`} className="text-[11px] text-gray-300 flex items-center gap-2 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="truncate">{b.path}:{b.line}</span>
              {b.fromPeerId && <span className="ml-auto text-[10px] text-gray-400">{b.fromPeerId.slice(0, 6)}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <TerminalIcon className="w-3.5 h-3.5 text-green-400" />
        <p className="text-[10px] uppercase text-gray-400">Shared terminal</p>
        <span className="ml-auto text-[10px] text-gray-400">{terminalLog.length} lines</span>
      </div>
      <div className="bg-black border border-white/5 rounded p-2 max-h-32 overflow-y-auto font-mono text-[11px]">
        {terminalLog.length === 0 ? (
          <p className="text-gray-400">No terminal traffic yet. Type below to broadcast input to participants.</p>
        ) : (
          terminalLog.map((line, i) => (
            <div key={i} className={line.kind === 'in' ? 'text-cyan-300' : 'text-gray-200'}>
              <span className="text-gray-400 mr-1">{line.kind === 'in' ? '›' : '·'}</span>
              <span>{line.data.replace(/\n$/, '')}</span>
              <span className="text-gray-500 ml-2 text-[9px]">{line.from}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={terminalInput}
          onChange={(e) => setTerminalInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendInput(); }}
          placeholder="Type and Enter to broadcast to participants"
          className="flex-1 bg-[#0d1117] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-200 font-mono"
        />
        <button onClick={sendInput} disabled={!terminalInput.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-40">
          <Send className="w-3.5 h-3.5" /> Send
        </button>
      </div>
    </div>
  );
}
