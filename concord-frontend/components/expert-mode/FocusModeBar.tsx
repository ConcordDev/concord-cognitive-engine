'use client';

/**
 * FocusModeBar — Perplexity-style focus selector for expert mode.
 * Each mode is a real backend behaviour switch (web on/off, query
 * augmentation, synthesis directive) loaded from expert_mode.focus_modes.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { GraduationCap, PenLine, Sigma, Video, Globe2 } from 'lucide-react';

export interface FocusMode {
  id: string;
  label: string;
  web: boolean;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  all: Globe2,
  academic: GraduationCap,
  writing: PenLine,
  math: Sigma,
  video: Video,
};

export function FocusModeBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [modes, setModes] = useState<FocusMode[]>([]);

  useEffect(() => {
    (async () => {
      const r = await lensRun<{ modes: FocusMode[] }>('expert_mode', 'focus_modes', {});
      if (r.data.ok && r.data.result?.modes) setModes(r.data.result.modes);
    })();
     
  }, []);

  if (modes.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">Focus</span>
      {modes.map((m) => {
        const Icon = ICONS[m.id] || Globe2;
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ' +
              (active
                ? 'bg-amber-500 text-amber-50 border-amber-400'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200')
            }
            title={m.web ? 'Includes live web search' : 'Corpus-only'}
          >
            <Icon className="w-3.5 h-3.5" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
