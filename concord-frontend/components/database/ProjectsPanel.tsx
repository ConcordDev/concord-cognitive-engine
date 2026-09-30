'use client';

import { DbProjectExplorer } from '@/components/database/DbProjectExplorer';

export function ProjectsPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <DbProjectExplorer />
    </section>
  );
}
