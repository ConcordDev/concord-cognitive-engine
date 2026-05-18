'use client';

import { Plus, FolderOpen, Folder, Zap } from 'lucide-react';
import type { Project, Sprint } from '@/lib/api/tasks';

interface Props {
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (p: Project) => void;
  onCreateProject: () => void;
  sprints: Sprint[];
  activeSprintId: string | null;
  onSelectSprint: (id: string | null) => void;
}

export function TaskProjectSidebar({
  projects, activeProject, onSelectProject, onCreateProject,
  sprints, activeSprintId, onSelectSprint,
}: Props) {
  return (
    <aside className="w-64 border-r border-white/10 flex flex-col bg-black/60">
      <div className="p-3 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/80">Projects</h2>
        <button
          onClick={onCreateProject}
          className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
          title="New project"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelectProject(p)}
            className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 ${
              activeProject?.id === p.id ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80 hover:bg-white/5'
            }`}
          >
            <span>{p.icon || (activeProject?.id === p.id ? <FolderOpen className="w-4 h-4" /> : <Folder className="w-4 h-4" />)}</span>
            <span className="flex-1 truncate">{p.name}</span>
            <span className="text-xs text-white/40">{p.key}</span>
          </button>
        ))}
      </div>

      {activeProject && (
        <div className="border-t border-white/10 max-h-64 overflow-y-auto">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-1">
              <Zap className="w-3 h-3" /> Sprints
            </span>
            <button
              onClick={() => onSelectSprint(null)}
              className={`text-xs ${activeSprintId === null ? 'text-cyan-300' : 'text-white/40 hover:text-white'}`}
            >
              all
            </button>
          </div>
          <div className="px-2 pb-2 space-y-0.5">
            {sprints.length === 0 ? (
              <div className="text-xs text-white/30 px-2 py-2">No sprints yet.</div>
            ) : (
              sprints.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelectSprint(s.id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs flex items-center gap-2 ${
                    activeSprintId === s.id ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    s.status === 'active' ? 'bg-green-400' :
                    s.status === 'completed' ? 'bg-zinc-500' :
                    s.status === 'archived' ? 'bg-zinc-700' :
                    'bg-blue-400'
                  }`} />
                  <span className="flex-1 truncate">{s.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
