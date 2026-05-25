'use client';

/**
 * RfPromptsPanel — the prompt of the day, the full prompt library by
 * category, and structured entry templates.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lightbulb, Shuffle, FileText, PenLine } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Prompt { category: string; text: string }
interface Template { id: string; name: string; category: string; body: string }

export function RfPromptsPanel({ onChange }: { onChange: () => void }) {
  const [today, setToday] = useState<Prompt | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [pt, lib, tpl] = await Promise.all([
      lensRun('reflection', 'prompt-today', {}),
      lensRun('reflection', 'prompt-library', {}),
      lensRun('reflection', 'templates-list', {}),
    ]);
    setToday((pt.data?.result?.prompt as Prompt) || null);
    setPrompts(lib.data?.result?.prompts || []);
    setCategories(lib.data?.result?.categories || []);
    setTemplates(tpl.data?.result?.templates || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const shuffle = async () => {
    const r = await lensRun('reflection', 'prompt-random', activeCat ? { category: activeCat } : {});
    if (r.data?.result?.prompt) setToday(r.data.result.prompt as Prompt);
  };

  const applyTemplate = async (id: string) => {
    const r = await lensRun('reflection', 'entry-from-template', { templateId: id });
    if (r.data?.ok === false) { setNote(r.data?.error || 'Failed'); return; }
    setNote('Draft entry created from template — find it in Entries.');
    onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const shown = activeCat ? prompts.filter((p) => p.category === activeCat) : prompts;

  return (
    <div className="space-y-4">
      {note && <div className="text-xs text-indigo-300 bg-indigo-950/40 border border-indigo-900/50 rounded-lg px-3 py-2">{note}</div>}

      {/* Prompt of the day */}
      {today && (
        <div className="bg-gradient-to-br from-indigo-900/50 to-zinc-900/70 border border-indigo-900/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-indigo-300 uppercase tracking-wide">
              <Lightbulb className="w-3.5 h-3.5" /> Prompt of the day
            </span>
            <button type="button" onClick={shuffle}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-indigo-300">
              <Shuffle className="w-3 h-3" /> Shuffle
            </button>
          </div>
          <p className="text-sm text-zinc-100">{today.text}</p>
          <p className="text-[10px] text-zinc-400 mt-1 capitalize">{today.category}</p>
        </div>
      )}

      {/* Prompt library */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Prompt library</h3>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button type="button" onClick={() => setActiveCat('')}
            className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize',
              activeCat === '' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setActiveCat(c)}
              className={cn('text-[11px] px-2.5 py-1 rounded-lg capitalize',
                activeCat === c ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
              {c}
            </button>
          ))}
        </div>
        <ul className="space-y-1.5">
          {shown.map((p, i) => (
            <li key={i} className="flex items-start gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <PenLine className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
              <span className="text-xs text-zinc-300">{p.text}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Templates */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <FileText className="w-3.5 h-3.5 text-indigo-400" /> Templates
        </h3>
        <ul className="space-y-1.5">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-zinc-200">{t.name}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{t.category}</p>
              </div>
              <button type="button" onClick={() => applyTemplate(t.id)}
                className="text-[11px] px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
                Use
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
