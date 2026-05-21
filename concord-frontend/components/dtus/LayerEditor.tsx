'use client';

/**
 * LayerEditor — inline editor for the four DTU layers (human / core /
 * machine / artifact). Wired to `dtus.getLayers` (seed or overlay) and
 * `dtus.updateLayers` (persist a per-user overlay). The machine layer
 * is JSON-validated server-side and surfaces warnings here.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { FileText, Loader2, Save, Check } from 'lucide-react';

interface DtuLayers {
  human: string;
  core: string;
  machine: string;
  artifact: string;
  updatedAt: string | null;
}

type LayerKey = 'human' | 'core' | 'machine' | 'artifact';

const LAYER_META: { key: LayerKey; label: string; hint: string; mono: boolean }[] = [
  { key: 'human', label: 'Human', hint: 'Readable summary', mono: false },
  { key: 'core', label: 'Core', hint: 'Structured claims / definitions', mono: true },
  { key: 'machine', label: 'Machine', hint: 'Tags, embeddings, verifier (JSON)', mono: true },
  { key: 'artifact', label: 'Artifact', hint: 'Optional binary reference', mono: false },
];

export function LayerEditor({
  dtuId,
  seed,
}: {
  dtuId: string | null;
  seed?: Record<string, unknown>;
}) {
  const [layers, setLayers] = useState<DtuLayers | null>(null);
  const [source, setSource] = useState<'seed' | 'overlay' | null>(null);
  const [active, setActive] = useState<LayerKey>('human');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!dtuId) { setLayers(null); return; }
    setLoading(true);
    setDirty(false);
    setSavedAt(null);
    const res = await lensRun<{ layers: DtuLayers; source: 'seed' | 'overlay' }>(
      'dtus',
      'getLayers',
      { dtuId, dtu: seed || {} },
    );
    setLoading(false);
    if (res.data.ok && res.data.result) {
      setLayers(res.data.result.layers);
      setSource(res.data.result.source);
    }
  }, [dtuId, seed]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!dtuId || !layers) return;
    setSaving(true);
    const res = await lensRun<{ layers: DtuLayers; warnings: string[] }>(
      'dtus',
      'updateLayers',
      { dtuId, layers },
    );
    setSaving(false);
    if (res.data.ok && res.data.result) {
      setLayers(res.data.result.layers);
      setWarnings(res.data.result.warnings);
      setSource('overlay');
      setDirty(false);
      setSavedAt(res.data.result.layers.updatedAt);
    }
  }, [dtuId, layers]);

  if (!dtuId) {
    return (
      <div className="flex h-44 flex-col items-center justify-center rounded-xl border border-lattice-border bg-lattice-deep text-gray-500">
        <FileText className="mb-2 h-7 w-7" />
        <p className="text-sm">Select a DTU to edit its four layers.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-neon-blue" /> 4-Layer Editor
          {source && (
            <span className="rounded bg-lattice-surface px-1.5 py-0.5 text-[10px] text-gray-500">
              {source}
            </span>
          )}
        </h3>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-neon-cyan" />}
      </div>

      <div className="flex gap-1.5">
        {LAYER_META.map((m) => (
          <button
            key={m.key}
            onClick={() => setActive(m.key)}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              active === m.key
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'bg-lattice-surface text-gray-400 hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {layers &&
        LAYER_META.filter((m) => m.key === active).map((m) => (
          <div key={m.key} className="space-y-1.5">
            <p className="text-[11px] text-gray-500">{m.hint}</p>
            <textarea
              value={layers[m.key]}
              onChange={(e) => {
                setLayers({ ...layers, [m.key]: e.target.value });
                setDirty(true);
              }}
              rows={m.mono ? 10 : 6}
              className={`w-full rounded-lg border border-lattice-border bg-lattice-surface px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none ${
                m.mono ? 'font-mono text-xs' : ''
              }`}
            />
          </div>
        ))}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-yellow-400">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        {savedAt && !dirty ? (
          <span className="flex items-center gap-1 text-[11px] text-green-400">
            <Check className="h-3 w-3" /> Saved {new Date(savedAt).toLocaleTimeString()}
          </span>
        ) : (
          <span className="text-[11px] text-gray-600">
            {dirty ? 'Unsaved changes' : ' '}
          </span>
        )}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 rounded-lg border border-neon-blue/30 bg-neon-blue/10 px-3 py-1.5 text-xs text-neon-blue hover:bg-neon-blue/20 disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save overlay
        </button>
      </div>
    </div>
  );
}
