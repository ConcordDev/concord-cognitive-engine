'use client';

/**
 * ProblemsPanel — VS Code-style bottom panel surfacing heuristic
 * diagnostics and the project TODO/FIXME tracker. Rows jump to the
 * offending line in the editor.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, ListTodo, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Problem { path: string; line: number; severity: 'error' | 'warning' | 'info'; message: string; rule: string }
interface Todo { path: string; line: number; tag: string; text: string }

const SEV_ICON = { error: AlertCircle, warning: AlertTriangle, info: Info };
const SEV_COLOR = { error: 'text-rose-400', warning: 'text-amber-400', info: 'text-sky-400' };

export function ProblemsPanel({
  projectId, onOpen, refreshNonce,
}: {
  projectId: string | null;
  onOpen: (path: string, line: number) => void;
  /** S7 (F6): bumped by the parent whenever project content is saved,
   *  so the panel re-reads diagnostics instead of showing the scan
   *  from when it first mounted. */
  refreshNonce?: number;
}) {
  const [tab, setTab] = useState<'problems' | 'todos'>('problems');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  // S7: the panel must never convert a failure or a partial engine
  // into a plausible "No problems" — those states render as themselves.
  const [engine, setEngine] = useState<string | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setProblems([]); setTodos([]); setEngine(null); setDiagError(null); return; }
    setLoading(true);
    try {
      const [d, t] = await Promise.all([
        lensRun({ domain: 'code', action: 'diagnostics', input: { projectId } }),
        lensRun({ domain: 'code', action: 'todo-scan', input: { projectId } }),
      ]);
      if (d.data?.ok === false) {
        setDiagError(d.data?.error || 'Diagnostics unavailable.');
        setProblems([]);
      } else {
        setDiagError(null);
        setProblems((d.data?.result?.problems || []) as Problem[]);
        setEngine(typeof d.data?.result?.engine === 'string' ? d.data.result.engine : null);
      }
      setTodos((t.data?.result?.todos || []) as Todo[]);
    } catch (e) {
      console.error('[Problems] failed', e);
      setDiagError('Diagnostics could not be read.');
    }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (refreshNonce) void refresh(); }, [refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-white/10 bg-[#0a0c10]">
        <button type="button" onClick={() => setTab('problems')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2',
            tab === 'problems' ? 'text-white border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-300')}>
          Problems {problems.length > 0 && <span className="ml-1 px-1 rounded bg-white/10">{problems.length}</span>}
        </button>
        <button type="button" onClick={() => setTab('todos')}
          className={cn('px-3 py-1.5 text-[11px] font-semibold border-b-2 inline-flex items-center gap-1',
            tab === 'todos' ? 'text-white border-blue-400' : 'text-gray-400 border-transparent hover:text-gray-300')}>
          <ListTodo className="w-3 h-3" /> TODOs {todos.length > 0 && <span className="ml-0.5 px-1 rounded bg-white/10">{todos.length}</span>}
        </button>
        <button type="button" onClick={refresh} title="Rescan" className="ml-auto px-2 text-gray-400 hover:text-white">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Scanning…</div>
        ) : tab === 'problems' ? (
          !projectId ? (
            <div className="p-3 text-xs text-gray-400 italic">Select a project to see its problems.</div>
          ) : diagError ? (
            <div className="p-3 text-xs text-rose-300">{diagError}</div>
          ) : (
            <>
              {engine === 'heuristics-only' && (
                <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-white/5">
                  Server syntax/type checking is unavailable — showing style checks only. The editor's own markers may show more.
                </div>
              )}
              {problems.length === 0 ? (
                <div className="p-3 text-xs text-emerald-300">No problems detected in the workspace.</div>
              ) : (
            <ul className="divide-y divide-white/5">
              {problems.map((p, i) => {
                const Icon = SEV_ICON[p.severity];
                return (
                  <li key={i} onClick={() => onOpen(p.path, p.line)}
                    className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/[0.04]">
                    <Icon className={cn('w-3.5 h-3.5 shrink-0', SEV_COLOR[p.severity])} />
                    <span className="text-[11px] text-white flex-1 truncate">{p.message}</span>
                    <span className="text-[10px] text-gray-400 font-mono">{p.rule}</span>
                    <span className="text-[10px] text-blue-300 font-mono shrink-0">{p.path}:{p.line}</span>
                  </li>
                );
              })}
            </ul>
              )}
            </>
          )
        ) : (
          todos.length === 0 ? (
            <div className="p-3 text-xs text-gray-400 italic">No TODO / FIXME comments found.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {todos.map((t, i) => (
                <li key={i} onClick={() => onOpen(t.path, t.line)}
                  className="px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-white/[0.04]">
                  <span className="text-[9px] font-bold px-1 rounded bg-amber-500/20 text-amber-300 shrink-0">{t.tag}</span>
                  <span className="text-[11px] text-white flex-1 truncate">{t.text || '(no description)'}</span>
                  <span className="text-[10px] text-blue-300 font-mono shrink-0">{t.path}:{t.line}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}

export default ProblemsPanel;
