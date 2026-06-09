'use client';

/**
 * TemplatePicker — modal gallery of built-in page templates. Lists
 * docs.template-list and applies a chosen one via docs.template-apply,
 * creating a new page pre-scaffolded with the template's block layout.
 */

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  blockCount: number;
}

export function TemplatePicker({ onClose, onApplied }: {
  onClose: () => void;
  onApplied: (pageId: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void lensRun('docs', 'template-list', {}).then((r) => {
      if (alive) {
        setTemplates((r.data?.result?.templates as Template[]) || []);
        setLoading(false);
      }
    });
    return () => { alive = false; };
  }, []);

  async function apply(id: string) {
    setApplying(id);
    const r = await lensRun('docs', 'template-apply', { templateId: id });
    setApplying(null);
    const pageId = r.data?.result?.page?.id as string | undefined;
    if (pageId) onApplied(pageId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-4"
        onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-zinc-100">New page from template</h3>
          <button aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X className="w-4 h-4" /></button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6 text-zinc-400">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {templates.map(t => (
              <button key={t.id} onClick={() => apply(t.id)} disabled={applying !== null}
                className="text-left rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 hover:border-indigo-600 disabled:opacity-50">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{t.icon}</span>
                  <span className="text-sm font-semibold text-zinc-100">{t.name}</span>
                  {applying === t.id && <Loader2 className="w-3 h-3 animate-spin text-indigo-300 ml-auto" />}
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">{t.description}</p>
                <p className="mt-1 text-[10px] text-zinc-400">{t.blockCount} blocks</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
