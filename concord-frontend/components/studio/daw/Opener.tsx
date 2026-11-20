'use client';

import { useEffect, useState } from 'react';
import { Music, Mic2, Plus, Loader2, Clock, Play } from 'lucide-react';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { useAuth } from '@/hooks/useAuth';
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
  const { user } = useAuth();
  const [recent, setRecent] = useState<ProjectRecord[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    studioTransport.list()
      .then((l) => { if (alive) setRecent([...l].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))); })
      .catch(() => { if (alive) { setRecent([]); setError(true); } });
    return () => { alive = false; };
  }, []);
  const remove = async (id: string) => {
    try {
      await studioTransport.delete(id);
      setRecent((rows) => (rows || []).filter((r) => r.id !== id));
      setError(false);
    } catch {
      setError(true);
    }
  };
  return (
    <div className="h-full overflow-y-auto" data-testid="studio-opener">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="bo-metal mb-7 flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4">
          <div className="bo-well flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full"><Mic2 className="h-5 w-5 text-[var(--bo-amber)]" aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <p className="bo-engrave text-sm">The Booth</p>
            <h1 className="font-vault text-2xl leading-tight text-zinc-100 sm:text-3xl" data-testid="studio-greeting">
              What are we making{user?.username ? `, ${user.username}` : ''}
            </h1>
            <p className="text-xs text-zinc-500">Write and record in the booth, build it in Produce, finish it in Mix. Everything saves as you go.</p>
          </div>
        </header>

        <h2 className="bo-engrave mb-2 text-base">Start a session</h2>
        <div className="mb-9 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
          {STUDIO_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onNew(buildTemplate(t.id))}
              className="bo-metal group rounded-lg border p-3 text-left transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--bo-amber)]"
              data-testid={`studio-template-${t.id}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="bo-scribble truncate px-2 text-base leading-6">{t.name}</span>
                {t.id === 'empty' ? <Plus className="h-4 w-4 text-zinc-400" aria-hidden /> : t.id === 'demo' ? <Play className="h-4 w-4 text-emerald-300" aria-hidden /> : <Music className="h-4 w-4 text-violet-300" aria-hidden />}
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">{t.description}</p>
              <p className="bo-led mt-2 text-[11px]">{t.bpm} BPM</p>
            </button>
          ))}
        </div>

        <h2 className="bo-engrave mb-2 text-base">Your sessions</h2>
        {recent === null ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500" role="status"><Loader2 className="h-3 w-3 animate-spin" /> Loading your sessions…</div>
        ) : recent.length === 0 ? (
          <p className="text-xs text-zinc-500">{error ? 'Could not reach your projects right now. New work is still kept on this device and saved when you are back online.' : 'No sessions yet. Start one above.'}</p>
        ) : (
          <ul className="bo-well grid gap-1.5 rounded-lg p-2 sm:grid-cols-2">
            {recent.slice(0, 30).map((r) => (
              <li key={r.id} className="bo-metal flex items-center rounded-md border">
                <button onClick={() => onOpenProject(r.id)} disabled={!!opening} className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left disabled:opacity-60" data-testid="studio-recent">
                  <span className="bo-scribble truncate px-1.5 text-sm leading-5">{r.name}</span>
                  <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-zinc-500">
                    {opening === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />}
                    {new Date(r.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </button>
                <StickyDeleteConfirm onConfirm={() => void remove(r.id)} armAriaLabel={`Delete ${r.name}`} confirmAriaLabel={`Confirm delete ${r.name}`} className="mr-2 shrink-0 text-rose-300" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
