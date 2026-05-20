'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { CodeWorkbenchShell, CodeNav } from './CodeWorkbenchShell';
import { ProjectSwitcher } from './ProjectSwitcher';
import { FileExplorer } from './FileExplorer';
import { SearchPanel } from './SearchPanel';
import { GitPanel } from './GitPanel';
import { AgentComposerPanel } from './AgentComposerPanel';
import { EditorPane } from './EditorPane';

export function CodeWorkbenchSection() {
  const [nav, setNav] = useState<CodeNav>('files');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [branch, setBranch] = useState<string>('main');
  const [modifiedCount, setModifiedCount] = useState(0);

  useEffect(() => { refreshStatus(); }, [projectId]);

  async function refreshStatus() {
    if (!projectId) { setBranch('main'); setModifiedCount(0); return; }
    try {
      const r = await lensRun({ domain: 'code', action: 'git-status', input: { projectId } });
      const s = r.data?.result;
      if (s) {
        setBranch(s.branch || 'main');
        setModifiedCount((s.modified?.length || 0) + (s.staged?.length || 0));
      }
    } catch {}
  }

  return (
    <CodeWorkbenchShell
      activeNav={nav}
      onNavChange={setNav}
      badges={{ git: modifiedCount }}
      branch={branch}
      sidePanel={
        <>
          <ProjectSwitcher value={projectId} onChange={setProjectId} />
          {nav === 'files'    && <FileExplorer projectId={projectId} activePath={openPath} onOpen={(p) => setOpenPath(p)} onChanged={refreshStatus} />}
          {nav === 'search'   && <SearchPanel projectId={projectId} onOpen={(p) => setOpenPath(p)} />}
          {nav === 'git'      && <GitPanel projectId={projectId} onChanged={refreshStatus} />}
          {nav === 'agent'    && <AgentComposerPanel projectId={projectId} />}
          {nav === 'debug'    && <div className="p-3 text-xs text-gray-500 italic">Debugger UI is part of the existing Monaco shell — coming forthcoming.</div>}
          {nav === 'settings' && <div className="p-3 text-xs text-gray-500 italic">BYOK model selector lives in /settings — Cmd-, opens it.</div>}
        </>
      }
      editor={
        <EditorPane
          projectId={projectId}
          openPath={openPath}
          onOpenChange={setOpenPath}
          onContentSaved={refreshStatus}
        />
      }
      statusRight={
        <>
          {modifiedCount > 0 && <span>{modifiedCount} change{modifiedCount === 1 ? '' : 's'}</span>}
        </>
      }
    />
  );
}

export default CodeWorkbenchSection;
