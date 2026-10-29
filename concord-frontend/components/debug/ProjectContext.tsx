'use client';

/**
 * ProjectContext — the Debug lens's project selection (S10).
 *
 * Projects are real server-side entities (project-create / project-list /
 * project-update / project-delete in server/domains/debug.js). This
 * context owns the one project-list call site, holds the selected
 * project, and persists the selection per device. The observability
 * surfaces read `projectId` from here and pass it to their macros; the
 * server scopes every list/record call to it. Until the list resolves,
 * `projectId` is undefined and the server answers for the account's
 * default project — the same project pre-S10 data belongs to.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { lensRun } from '@/lib/api/client';

export interface DebugProjectCounts {
  issues: number;
  traces: number;
  metrics: number;
  alerts: number;
  releases: number;
}

export interface DebugProject {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  counts?: DebugProjectCounts;
}

interface DebugProjectContextValue {
  projects: DebugProject[];
  project: DebugProject | null;
  projectId: string | undefined;
  loading: boolean;
  error: string | null;
  selectProject: (id: string) => void;
  reloadProjects: () => Promise<void>;
}

const DebugProjectContext = createContext<DebugProjectContextValue | null>(null);

const STORAGE_KEY = 'concord.debug.projectId';

function readStoredProjectId(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function DebugProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<DebugProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    typeof window === 'undefined' ? undefined : readStoredProjectId()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadProjects = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('debug', 'project-list', {});
    if (r.data?.ok && r.data.result) {
      setProjects(r.data.result.projects || []);
      setError(null);
    } else {
      setError(r.data?.error || 'Failed to load projects');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reloadProjects();
  }, [reloadProjects]);

  const selectProject = useCallback((id: string) => {
    setSelectedId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Persistence is a convenience; selection still holds in state.
    }
  }, []);

  // The selection is derived, never trusted blindly: a stored id whose
  // project was deleted (or belongs to another account) falls back to
  // the default project, then to the first project in the list.
  const project = useMemo<DebugProject | null>(() => {
    if (projects.length === 0) return null;
    return (
      projects.find((p) => p.id === selectedId) ??
      projects.find((p) => p.isDefault) ??
      projects[0]
    );
  }, [projects, selectedId]);

  const value = useMemo<DebugProjectContextValue>(
    () => ({
      projects,
      project,
      projectId: project?.id,
      loading,
      error,
      selectProject,
      reloadProjects,
    }),
    [projects, project, loading, error, selectProject, reloadProjects]
  );

  return <DebugProjectContext.Provider value={value}>{children}</DebugProjectContext.Provider>;
}

export function useDebugProject(): DebugProjectContextValue {
  const ctx = useContext(DebugProjectContext);
  if (!ctx) throw new Error('useDebugProject must be used inside DebugProjectProvider');
  return ctx;
}
