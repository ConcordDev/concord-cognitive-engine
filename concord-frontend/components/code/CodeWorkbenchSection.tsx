'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Folder, FileCode2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { CodeWorkbenchShell, CodeNav } from './CodeWorkbenchShell';
import { ProjectSwitcher } from './ProjectSwitcher';
import { useCodeProject } from './CodeProjectContext';
import { FileExplorer } from './FileExplorer';
import { OutlinePanel } from './OutlinePanel';
import { SearchPanel } from './SearchPanel';
import { GitPanel } from './GitPanel';
import { AgentComposerPanel } from './AgentComposerPanel';
import { RunPanel } from './RunPanel';
import { ProblemsPanel } from './ProblemsPanel';
import { EditorPane } from './EditorPane';

export function CodeWorkbenchSection() {
  const [nav, setNav] = useState<CodeNav>('files');
  // Shared across the quick-script tabs + CodeAdvancedPanel via
  // CodeProjectContext — see that file's header comment.
  const { projectId, setProjectId } = useCodeProject();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [branch, setBranch] = useState<string>('main');
  const [modifiedCount, setModifiedCount] = useState(0);
  const [problems, setProblems] = useState({ error: 0, warning: 0 });
  const [showBottom, setShowBottom] = useState(false);
  const [statusNonce, setStatusNonce] = useState(0);
  // Dashboard-summary stat strip (code.workspace-summary) — a real
  // cross-project glance (project/file counts, running agent tasks, dirty
  // projects) rendered in the status bar so it's always visible, not
  // buried behind a tab. Refreshed alongside git/diagnostics status.
  const [summary, setSummary] = useState<{ projectCount: number; fileCount: number; runningTasks: number; dirtyProjects: number } | null>(null);
  // Rename bridge: FileExplorer performs the files-rename call, then reports
  // (from, to) here so an open editor tab is relabeled in place — see EditorPane's
  // renameSignal handling.
  const [renameSignal, setRenameSignal] = useState<{ from: string; to: string; nonce: number } | null>(null);
  // Replace bridge (S6): SearchPanel's project replace writes to the
  // server store; EditorPane reconciles open tabs from that store so
  // the change is visible and a stale buffer can't overwrite it.
  const [replaceSignal, setReplaceSignal] = useState<{ paths: string[]; nonce: number } | null>(null);
  // Split layout (S13, F12): the Split View tab has always SAVED a
  // per-project layout (layout-save/layout-get) — nothing ever
  // rendered it. The section now reads the saved layout and renders
  // it as real editor panes.
  const [splitLayout, setSplitLayout] = useState<{ orientation: string; panes: Array<{ id: string; path: string | null }> } | null>(null);
  const [panePaths, setPanePaths] = useState<(string | null)[]>([]);

  useEffect(() => {
    if (!projectId) { setSplitLayout(null); setPanePaths([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const r = await lensRun({ domain: 'code', action: 'layout-get', input: { projectId } });
        if (cancelled || r.data?.ok === false) return;
        const l = r.data?.result?.layout;
        if (l && Array.isArray(l.panes)) {
          setSplitLayout(l);
          setPanePaths(l.panes.map((p: { path: string | null }) => p.path));
        }
      } catch { /* no saved layout — single pane */ }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const splitActive = !!splitLayout && splitLayout.orientation !== 'single'
    && panePaths.filter(Boolean).length >= 2;

  // openFile carries an optional line so Problems / Outline / Search rows
  // jump straight to the offending position. In a split, explorer and
  // panel clicks target the first pane.
  const openFile = useCallback((path: string, line?: number) => {
    setOpenPath(path);
    setOpenLine(line ?? null);
    setPanePaths(prev => (prev.length > 0 ? [path, ...prev.slice(1)] : prev));
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusNonce(n => n + 1);
    if (!projectId) { setBranch('main'); setModifiedCount(0); setProblems({ error: 0, warning: 0 }); return; }
    try {
      const [s, d] = await Promise.all([
        lensRun({ domain: 'code', action: 'git-status', input: { projectId } }),
        lensRun({ domain: 'code', action: 'diagnostics', input: { projectId } }),
      ]);
      const st = s.data?.result;
      if (st) {
        setBranch(st.branch || 'main');
        setModifiedCount((st.modified?.length || 0) + (st.staged?.length || 0));
      }
      const bs = d.data?.result?.bySeverity;
      if (bs) setProblems({ error: bs.error || 0, warning: bs.warning || 0 });
    } catch { /* best effort */ }
  }, [projectId]);

  const refreshSummary = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'code', action: 'workspace-summary', input: {} });
      const res = r.data?.result;
      if (res) setSummary({
        projectCount: res.projectCount || 0,
        fileCount: res.fileCount || 0,
        runningTasks: res.runningTasks || 0,
        dirtyProjects: res.dirtyProjects || 0,
      });
    } catch { /* best effort */ }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => { void refreshSummary(); }, [refreshSummary, projectId, modifiedCount]);

  return (
    <CodeWorkbenchShell
      activeNav={nav}
      onNavChange={setNav}
      badges={{ git: modifiedCount, debug: problems.error || undefined }}
      branch={branch}
      showBottom={showBottom}
      onToggleBottom={() => setShowBottom((v) => !v)}
      bottomPanel={<ProblemsPanel projectId={projectId} onOpen={openFile} refreshNonce={statusNonce} />}
      sidePanel={
        <>
          <ProjectSwitcher value={projectId} onChange={setProjectId} onDeleted={() => { setProjectId(null); setOpenPath(null); setOpenLine(null); }} />
          {nav === 'files' && (
            <>
              <FileExplorer projectId={projectId} activePath={openPath}
                onOpen={(p) => openFile(p)} onChanged={refreshStatus}
                onRenamed={(from, to) => {
                  setRenameSignal({ from, to, nonce: Date.now() });
                  if (openPath === from) setOpenPath(to);
                }} />
              <OutlinePanel projectId={projectId} path={openPath} onOpen={openFile} />
            </>
          )}
          {nav === 'search'   && <SearchPanel projectId={projectId} onOpen={openFile} onReplaced={(paths) => { setReplaceSignal({ paths, nonce: Date.now() }); void refreshStatus(); }} />}
          {nav === 'git'      && <GitPanel projectId={projectId} onChanged={refreshStatus} onDiscarded={(path) => setReplaceSignal({ paths: [path], nonce: Date.now() })} />}
          {nav === 'agent'    && <AgentComposerPanel projectId={projectId} />}
          {nav === 'debug'    && <RunPanel projectId={projectId} onOpen={openFile} />}
          {nav === 'settings' && <div className="p-3 text-xs text-gray-400 italic">BYOK model selector lives in /settings — Cmd-, opens it.</div>}
        </>
      }
      editor={splitActive ? (
        <div className={cn('grid h-full',
          splitLayout!.orientation === 'vertical' ? 'grid-cols-2' :
          splitLayout!.orientation === 'horizontal' ? 'grid-rows-2' :
          'grid-cols-2 grid-rows-2')}>
          {panePaths.map((path, i) => (
            <div key={i} className="min-w-0 min-h-0 border-white/10 odd:border-r [&:nth-child(3)]:border-t [&:nth-child(4)]:border-t overflow-hidden">
              <EditorPane
                projectId={projectId}
                openPath={path}
                openLine={i === 0 ? openLine : null}
                onOpenChange={(p) => {
                  setPanePaths(prev => prev.map((x, j) => (j === i ? p : x)));
                  if (i === 0) { setOpenPath(p); setOpenLine(null); }
                }}
                onContentSaved={refreshStatus}
                renameSignal={renameSignal}
                replaceSignal={replaceSignal}
              />
            </div>
          ))}
        </div>
      ) : (
        <EditorPane
          projectId={projectId}
          openPath={openPath}
          openLine={openLine}
          onOpenChange={(p) => { setOpenPath(p); setOpenLine(null); }}
          onContentSaved={refreshStatus}
          renameSignal={renameSignal}
          replaceSignal={replaceSignal}
        />
      )}
      statusRight={
        <>
          <button type="button" onClick={() => setShowBottom((v) => !v)}
            className="inline-flex items-center gap-2 hover:opacity-80" title="Toggle Problems panel">
            <span className="inline-flex items-center gap-0.5"><AlertCircle className="w-3 h-3" />{problems.error}</span>
            <span className="inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{problems.warning}</span>
          </button>
          {modifiedCount > 0 && <span>{modifiedCount} change{modifiedCount === 1 ? '' : 's'}</span>}
          {summary && (
            <span
              className="inline-flex items-center gap-2"
              title={`${summary.projectCount} project(s) · ${summary.fileCount} file(s) across your workspace${summary.runningTasks ? ` · ${summary.runningTasks} agent task(s) running` : ''}${summary.dirtyProjects ? ` · ${summary.dirtyProjects} project(s) with uncommitted changes` : ''}`}
            >
              <span className="inline-flex items-center gap-0.5"><Folder className="w-3 h-3" />{summary.projectCount}</span>
              <span className="inline-flex items-center gap-0.5"><FileCode2 className="w-3 h-3" />{summary.fileCount}</span>
              {summary.runningTasks > 0 && <span className="text-amber-200">{summary.runningTasks} running</span>}
              {summary.dirtyProjects > 0 && <span className="text-amber-200">{summary.dirtyProjects} dirty</span>}
            </span>
          )}
        </>
      }
    />
  );
}

export default CodeWorkbenchSection;
