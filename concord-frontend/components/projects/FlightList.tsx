'use client';

/** Projects north star — a short list of what is actually in flight. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, NorthNote, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Project = { id: string; name?: string; status?: string; progressPct?: number };

const PILL = [
  { id: 'projects', label: 'Projects', href: '/lenses/projects' },
  { id: 'timeline', label: 'Timeline', href: '/lenses/timeline' },
];

export function FlightList({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('projects');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const projectsQ = useMacro<{ projects?: Project[] }>(
    ['projects-northstar', 'list'],
    'projects',
    'project-list',
    {},
    (result) => {
      if (!Array.isArray(result.projects)) throw new Error('Projects did not answer.');
      return result;
    },
  );
  const projects = projectsQ.data?.projects ?? null;
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) {
      setError('A project needs a name.');
      return;
    }
    setError('');
    const res = await lensRun('projects', 'project-create', { name: name.trim() });
    if (!res.data.ok) {
      setError(res.data.error || 'The project was not created.');
      return;
    }
    setName('');
    setComposing(false);
    await client.invalidateQueries({ queryKey: ['projects-northstar', 'list'] });
  };

  return (
    <LensShell lensId="projects" asMain={false} disableAgentFab>
      <div data-lens-theme="projects" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Projects" title={who ? `What's in flight, ${who}` : "What's in flight"} />
            <FamilyPill label="Projects" active="projects" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Project desk' }]} onPick={onOpenDesk} />
        </div>

        {projects && projects.length === 0 && <NorthNote>Nothing in the substrate</NorthNote>}
        {(error || projectsQ.error) && (
          <NorthError message={error || (projectsQ.error instanceof Error ? projectsQ.error.message : 'Projects did not answer.')} />
        )}

        {projects && projects.length > 0 && (
          <ul className="mt-8 max-w-xl divide-y divide-white/5">
            {projects.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-[16px] text-zinc-100">{p.name}</span>
                <span className="text-[13px] text-zinc-500">
                  {[p.status, Number.isFinite(Number(p.progressPct)) ? `${p.progressPct}%` : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}

        {composing && (
          <form className="mt-6 max-w-xl" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" className="mt-3 rounded-full bg-white/10 px-4 py-2 text-[14px]">Create project</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New project</button>
      </div>
    </LensShell>
  );
}
