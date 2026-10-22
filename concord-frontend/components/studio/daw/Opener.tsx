'use client';

import { useEffect, useState } from 'react';
import { Music, Plus, Loader2, Clock, Play } from 'lucide-react';
import type { DAWProject } from '@/lib/daw/types';
import { STUDIO_TEMPLATES, buildTemplate } from '@/lib/daw/templates';
import { studioTransport } from '@/lib/daw/studio-api';
import type { ProjectRecord } from '@/lib/daw/persistence';

export interface OpenerProps {
  onOpenProject: (id: string) => void;
  onNew: (p: DAWProject) => void;
  opening: string | null;
}

export function Opener({ onOpenProject, onNew, opening }: OpenerProps) {
  const [recent, setRecent] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    studioTransport.list()
      .then((l) => { if (alive) setRecent([...l].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))); })
      .catch(() => { if (alive) { setRecent([]); setError(true); } });
    return () => { alive = false; };
  }, []);
  return (
    <div className="h-full overflow-y-auto bg-[#0c0c11] text-zinc-200" data-testid="studio-opener">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/30"><Music className="h-5 w-5 text-violet-200" /></div>
          <div>
            <h1 className="text-lg font-semibold">Studio</h1>
            <p className="text-xs text-zinc-500">Record, produce, mix and master. Everything saves automatically.</p>
          </div>
        </div>

        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Start something</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3">
          {STUDIO_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onNew(buildTemplate(t.id))}
              className="group rounded-xl border border-white/5 bg-[#14141b] p-4 text-left transition-colors hover:border-violet-400/40 hover:bg-[#191922]"
              data-testid={`studio-template-${t.id}`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                {t.id === 'empty' ? <Plus className="h-4 w-4 text-zinc-400" /> : t.id === 'demo' ? <Play className="h-4 w-4 text-emerald-300" /> : <Music className="h-4 w-4 text-violet-300" />}
                {t.name}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">{t.description}</p>
              <p className="mt-2 text-[10px] text-zinc-600">{t.bpm} BPM</p>
            </button>
          ))}
        </div>

        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Recent projects</h2>
        {recent === null ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</div>
        ) : recent.length === 0 ? (
          <p className="text-xs text-zinc-600">{error ? 'Could not reach your projects right now. New work is still kept on this device and saved when you are back online.' : 'No projects yet. Pick a template above.'}</p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5">
            {recent.slice(0, 30).map((r) => (
              <li key={r.id}>
                <button onClick={() => onOpenProject(r.id)} disabled={!!opening} className="flex w-full items-center justify-between bg-[#121219] px-4 py-2.5 text-left text-sm hover:bg-[#191922] disabled:opacity-60" data-testid="studio-recent">
                  <span className="truncate">{r.name}</span>
                  <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                    {opening === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                    {new Date(r.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
