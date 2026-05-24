'use client';

/**
 * ModelPickerModal — picks a model for a brain slot from a provider's
 * live model list (OpenRouter catalog, keyless). Writes the choice
 * via byo_keys.set_model without re-pasting the key.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

interface LiveModel {
  id: string;
  fullId: string;
  name: string;
  contextLength: number | null;
  promptUsdPerM: number | null;
  completionUsdPerM: number | null;
  modality: string | null;
}

export function ModelPickerModal({
  slot,
  provider,
  currentModel,
  onClose,
  onSaved,
}: {
  slot: string;
  provider: string;
  currentModel: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [models, setModels] = useState<LiveModel[]>([]);
  const [source, setSource] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ source: string; models: LiveModel[] }>(
      'byo_keys', 'provider_models', { provider },
    );
    if (r.data?.ok && r.data.result) {
      setModels(r.data.result.models);
      setSource(r.data.result.source);
    }
    setLoading(false);
  }, [provider]);

  useEffect(() => { load(); }, [load]);

  const filtered = models.filter(
    (m) => !query.trim() || m.id.toLowerCase().includes(query.toLowerCase())
      || m.name.toLowerCase().includes(query.toLowerCase()),
  );

  const pick = async (modelId: string) => {
    setBusy(true);
    const r = await lensRun('byo_keys', 'set_model', { slot, modelId });
    setBusy(false);
    if (r.data?.ok) { onSaved(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="w-full max-w-lg rounded-xl bg-zinc-900 ring-1 ring-zinc-700 p-5 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Pick a model — {slot} slot
            </h3>
            <p className="text-[11px] text-zinc-400">
              {provider} · {source === 'openrouter' ? 'live catalog' : 'bundled defaults'}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter models…"
          className="w-full px-3 py-1.5 mb-3 rounded-md bg-zinc-950 text-zinc-100 text-sm ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
        />

        {loading && <div className="text-xs text-zinc-400">Loading model catalog…</div>}

        {!loading && filtered.length === 0 && (
          <div className="text-xs text-zinc-400 text-center py-6">No matching models.</div>
        )}

        <div className="overflow-y-auto space-y-1.5">
          {filtered.map((m) => (
            <button
              key={m.fullId}
              onClick={() => pick(m.id)}
              disabled={busy}
              className={`w-full text-left rounded-lg p-2.5 ring-1 transition disabled:opacity-50 ${
                m.id === currentModel
                  ? 'bg-amber-600/15 ring-amber-600/40'
                  : 'bg-zinc-950 ring-zinc-800 hover:ring-zinc-600'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-cyan-300">{m.id}</span>
                {m.id === currentModel && (
                  <span className="text-[9px] text-amber-300 font-mono">current</span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-zinc-400 font-mono">
                {m.contextLength != null && <span>ctx {m.contextLength.toLocaleString()}</span>}
                {m.promptUsdPerM != null && (
                  <span className="text-emerald-400">in ${m.promptUsdPerM.toFixed(2)}/M</span>
                )}
                {m.completionUsdPerM != null && (
                  <span className="text-amber-400">out ${m.completionUsdPerM.toFixed(2)}/M</span>
                )}
                {m.modality && <span>{m.modality}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
