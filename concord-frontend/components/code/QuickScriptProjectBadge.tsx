'use client';

/**
 * QuickScriptProjectBadge — the quick-script tab area's window onto the
 * shared `CodeProjectContext`. The quick-script tabs never had a project
 * concept of their own (they run on an ephemeral per-session scratch
 * buffer, `code-lens-live`, used only to mirror the active buffer into the
 * backend LanguageService for hover/completions/diagnostics) — "no
 * project" is a fully valid, unaffected state here, and picking one below
 * does NOT redirect that scratch buffer at a real project (see
 * `CodeProjectContext`'s header comment for why that would be risky).
 *
 * What picking a project here DOES do: sets the same `projectId` the
 * virtual-git workspace (`CodeWorkbenchSection`) and the Advanced IDE
 * panel (`CodeAdvancedPanel`) read below on this page, so a user can set
 * their working project once, from wherever they happen to be, and have
 * it hold across all three surfaces.
 */

import { useEffect, useState } from 'react';
import { FolderGit2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useCodeProject } from './CodeProjectContext';

interface Project { id: string; name: string }

export function QuickScriptProjectBadge() {
  const { projectId, setProjectId } = useCodeProject();
  const [list, setList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await lensRun({ domain: 'code', action: 'projects-list', input: {} });
        if (!cancelled) setList((r.data?.result?.projects || []) as Project[]);
      } catch (e) { console.error('[QuickScriptProjectBadge] list', e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#0d1117] border border-green-900/30"
      title="Shared with the virtual-git workspace and Advanced IDE panel below — pick a project once, it holds everywhere on this page."
    >
      <FolderGit2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
      {loading ? (
        <Loader2 className="w-3 h-3 animate-spin text-green-600" />
      ) : (
        <select
          aria-label="Shared project"
          value={projectId || ''}
          onChange={(e) => setProjectId(e.target.value || null)}
          className="bg-transparent text-xs text-green-300 max-w-[10rem] focus:outline-none"
        >
          <option value="" className="bg-[#0d1117] text-gray-400">No project (scratch)</option>
          {list.map((p) => (
            <option key={p.id} value={p.id} className="bg-[#0d1117] text-green-300">{p.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export default QuickScriptProjectBadge;
