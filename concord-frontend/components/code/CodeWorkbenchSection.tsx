'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { CodeWorkbenchShell, CodeNav } from './CodeWorkbenchShell';
import { ProjectSwitcher } from './ProjectSwitcher';
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [branch, setBranch] = useState<string>('main');
  const [modifiedCount, setModifiedCount] = useState(0);
  const [problems, setProblems] = useState({ error: 0, warning: 0 });
  const [showBottom, setShowBottom] = useState(false);

  // openFile carries an optional line so Problems / Outline / Search rows
  // jump straight to the offending position.
  const openFile = useCallback((path: string, line?: number) => {
    setOpenPath(path);
    setOpenLine(line ?? null);
  }, []);

  const refreshStatus = useCallback(async () => {
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

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  return (
    <CodeWorkbenchShell
      activeNav={nav}
      onNavChange={setNav}
      badges={{ git: modifiedCount, debug: problems.error || undefined }}
      branch={branch}
      showBottom={showBottom}
      onToggleBottom={() => setShowBottom((v) => !v)}
      bottomPanel={<ProblemsPanel projectId={projectId} onOpen={openFile} />}
      sidePanel={
        <>
          <ProjectSwitcher value={projectId} onChange={setProjectId} />
          {nav === 'files' && (
            <>
              <FileExplorer projectId={projectId} activePath={openPath}
                onOpen={(p) => openFile(p)} onChanged={refreshStatus} />
              <OutlinePanel projectId={projectId} path={openPath} onOpen={openFile} />
            </>
          )}
          {nav === 'search'   && <SearchPanel projectId={projectId} onOpen={openFile} />}
          {nav === 'git'      && <GitPanel projectId={projectId} onChanged={refreshStatus} />}
          {nav === 'agent'    && <AgentComposerPanel projectId={projectId} />}
          {nav === 'debug'    && <RunPanel projectId={projectId} onOpen={openFile} />}
          {nav === 'settings' && <div className="p-3 text-xs text-gray-500 italic">BYOK model selector lives in /settings — Cmd-, opens it.</div>}
        </>
      }
      editor={
        <EditorPane
          projectId={projectId}
          openPath={openPath}
          openLine={openLine}
          onOpenChange={(p) => { setOpenPath(p); setOpenLine(null); }}
          onContentSaved={refreshStatus}
        />
      }
      statusRight={
        <>
          <button type="button" onClick={() => setShowBottom((v) => !v)}
            className="inline-flex items-center gap-2 hover:opacity-80" title="Toggle Problems panel">
            <span className="inline-flex items-center gap-0.5"><AlertCircle className="w-3 h-3" />{problems.error}</span>
            <span className="inline-flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{problems.warning}</span>
          </button>
          {modifiedCount > 0 && <span>{modifiedCount} change{modifiedCount === 1 ? '' : 's'}</span>}
        </>
      }
    />
  );
}

export default CodeWorkbenchSection;
