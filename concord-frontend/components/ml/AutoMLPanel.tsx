'use client';

/**
 * AutoMLPanel — guided model-building flows / pipeline templates.
 * Wires ml.automl-templates.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Wand2, Loader2, Clock, CheckCircle2, ChevronRight } from 'lucide-react';

interface Template {
  id: string; task: string; title: string; description: string;
  steps: string[]; recommendedModels: string[]; estimatedTime: string;
}

const TASKS = ['', 'classification', 'regression', 'clustering'];

export function AutoMLPanel({ onUseModel }: { onUseModel?: (modelId: string) => void }) {
  const [task, setTask] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const r = await lensRun('ml', 'automl-templates', { task });
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as { templates: Template[] }).templates || [];
      setTemplates(list);
      setSelected((cur) => list.find((t) => t.id === cur?.id) || null);
    } else { setError(r.data?.error || 'Failed to load templates'); setTemplates([]); }
    setLoading(false);
  }, [task]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-neon-purple" /> Pipeline Templates
          </h3>
        </div>
        <select value={task} onChange={(e) => setTask(e.target.value)}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none">
          {TASKS.map((t) => <option key={t} value={t}>{t || 'All tasks'}</option>)}
        </select>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading ? (
          <div className="py-8 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : templates.map((t) => (
          <button key={t.id} onClick={() => setSelected(t)}
            className={`w-full text-left panel p-3 transition-colors ${selected?.id === t.id ? 'border-neon-purple' : ''}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm">{t.title}</span>
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </div>
            <p className="text-xs text-gray-500 line-clamp-2">{t.description}</p>
            <div className="flex items-center gap-1 text-xs text-neon-cyan mt-1.5">
              <Clock className="w-3 h-3" />{t.estimatedTime}
            </div>
          </button>
        ))}
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <div className="panel p-5 space-y-5">
            <div>
              <h3 className="text-lg font-bold">{selected.title}</h3>
              <p className="text-sm text-gray-400 mt-1">{selected.description}</p>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className="bg-lattice-surface px-2 py-0.5 rounded capitalize">{selected.task}</span>
                <span className="flex items-center gap-1 text-neon-cyan">
                  <Clock className="w-3 h-3" />{selected.estimatedTime}
                </span>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pipeline Steps</p>
              <ol className="space-y-2">
                {selected.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-neon-purple/20 text-neon-purple flex items-center justify-center text-xs font-mono">
                      {i + 1}
                    </span>
                    <span className="text-gray-300 pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recommended Models</p>
              <div className="flex flex-wrap gap-2">
                {selected.recommendedModels.map((m) => (
                  <button key={m} onClick={() => onUseModel?.(m)}
                    className="text-xs bg-lattice-surface hover:bg-neon-purple/20 hover:text-neon-purple px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />{m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel p-12 text-center text-gray-500">
            <Wand2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Select a template to view the guided pipeline</p>
          </div>
        )}
      </div>
    </div>
  );
}
