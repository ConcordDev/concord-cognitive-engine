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
  wired?: boolean;
}

interface AutomlRunReceipt {
  templateId: string; datasetName: string; experimentId: string;
  profile: { samples: number; features: number };
  steps: Array<{ step: string; detail: string; done: boolean }>;
  note: string;
}

const TASKS = ['', 'classification', 'regression', 'clustering'];

export function AutoMLPanel({ onUseModel }: { onUseModel?: (modelId: string) => void }) {
  const [task, setTask] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // S-ML-9: the wired template runs over one of the caller's
  // registered datasets (ml.automl-run).
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string }>>([]);
  const [runDatasetId, setRunDatasetId] = useState('');
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<AutomlRunReceipt | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await lensRun('ml', 'dataset-list', {});
      if (r.data?.ok && r.data.result) {
        const list = (r.data.result as { datasets: Array<{ id: string; name: string }> }).datasets || [];
        setDatasets(list);
      }
    })();
  }, []);
  const runTemplate = async () => {
    if (!selected || !runDatasetId) return;
    setRunning(true); setRunError(null); setReceipt(null);
    const r = await lensRun('ml', 'automl-run', { templateId: selected.id, datasetId: runDatasetId });
    if (r.data?.ok && r.data.result) setReceipt((r.data.result as { run: AutomlRunReceipt }).run);
    else setRunError(r.data?.error || 'Run failed');
    setRunning(false);
  };

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
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </div>
            <p className="text-xs text-gray-400 line-clamp-2">{t.description}</p>
            <div className="flex items-center gap-1 text-xs text-neon-cyan mt-1.5">
              <Clock className="w-3 h-3" />{t.estimatedTime}
              {t.wired
                ? <span className="ml-2 text-emerald-400">Runnable</span>
                : <span className="ml-2 text-zinc-500">Guidance only — not yet wired</span>}
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
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Pipeline Steps</p>
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
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Recommended Models</p>
              <div className="flex flex-wrap gap-2">
                {selected.recommendedModels.map((m) => (
                  <button key={m} onClick={() => onUseModel?.(m)}
                    className="text-xs bg-lattice-surface hover:bg-neon-purple/20 hover:text-neon-purple px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />{m}
                  </button>
                ))}
              </div>
            </div>
            {selected.wired ? (
              <div className="border-t border-lattice-border pt-4 space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider">Run this template</p>
                <div className="flex flex-wrap gap-2">
                  <select value={runDatasetId} onChange={(e) => setRunDatasetId(e.target.value)}
                    className="flex-1 min-w-[200px] px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-purple outline-none">
                    <option value="">Choose one of your registered datasets…</option>
                    {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button onClick={runTemplate} disabled={!runDatasetId || running} className="btn-neon purple small disabled:opacity-50">
                    {running ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Run configuration'}
                  </button>
                </div>
                {datasets.length === 0 && (
                  <p className="text-xs text-zinc-500">No registered datasets yet — register one in the Datasets tab first.</p>
                )}
                {runError && <p role="alert" className="text-sm text-red-400">{runError}</p>}
                {receipt && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                    <p className="text-sm font-medium text-emerald-300">Run complete — {receipt.datasetName}</p>
                    <ol className="space-y-1">
                      {receipt.steps.map((s, i) => (
                        <li key={i} className="text-xs text-zinc-300"><span className="text-emerald-400">✓</span> <span className="font-medium">{s.step}:</span> {s.detail}</li>
                      ))}
                    </ol>
                    <p className="text-xs text-zinc-400">{receipt.note}</p>
                    <p className="text-xs text-zinc-500">Tracked experiment: <span className="font-mono">{receipt.experimentId}</span> (Experiments tab)</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="border-t border-lattice-border pt-4 text-xs text-zinc-500">
                Guidance only for now — this template describes the pipeline but is not yet wired to a run. Tabular Classification is the wired template.
              </p>
            )}
          </div>
        ) : (
          <div className="panel p-12 text-center text-gray-400">
            <Wand2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>Select a template to view the guided pipeline</p>
          </div>
        )}
      </div>
    </div>
  );
}
