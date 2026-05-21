'use client';

/**
 * ShippingProfilesPanel — configurable shipping rates, zones &
 * processing times. Each profile carries an origin country, a
 * processing-time window, and a set of zones (region + base rate +
 * additional-item rate). Persisted via the `shipping-profiles-*`
 * macros. No seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Truck, Loader2, Plus, Trash2, Save, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Zone {
  region: string;
  rateUsd: number;
  additionalItemUsd: number;
}

interface ShippingProfile {
  id: string;
  number: string;
  name: string;
  originCountry: string;
  processingDaysMin: number;
  processingDaysMax: number;
  zones: Zone[];
  createdAt: string;
}

interface ZoneDraft {
  region: string;
  rateUsd: string;
  additionalItemUsd: string;
}

interface ProfileDraft {
  id?: string;
  name: string;
  originCountry: string;
  processingDaysMin: string;
  processingDaysMax: string;
  zones: ZoneDraft[];
}

const EMPTY_DRAFT: ProfileDraft = {
  name: '',
  originCountry: '',
  processingDaysMin: '1',
  processingDaysMax: '3',
  zones: [{ region: 'Domestic', rateUsd: '', additionalItemUsd: '' }],
};

export function ShippingProfilesPanel() {
  const [profiles, setProfiles] = useState<ShippingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('marketplace', 'shipping-profiles-list', {});
      if (r.data?.ok) setProfiles((r.data.result?.profiles || []) as ShippingProfile[]);
    } catch (e) {
      console.error('[Shipping] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startNew() {
    setDraft({ ...EMPTY_DRAFT, zones: [{ region: 'Domestic', rateUsd: '', additionalItemUsd: '' }] });
    setError(null);
  }

  function startEdit(p: ShippingProfile) {
    setDraft({
      id: p.id,
      name: p.name,
      originCountry: p.originCountry,
      processingDaysMin: String(p.processingDaysMin),
      processingDaysMax: String(p.processingDaysMax),
      zones: p.zones.map((z) => ({
        region: z.region,
        rateUsd: String(z.rateUsd),
        additionalItemUsd: String(z.additionalItemUsd),
      })),
    });
    setError(null);
  }

  async function save() {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const input: Record<string, unknown> = {
        name: draft.name.trim(),
        originCountry: draft.originCountry.trim(),
        processingDaysMin: Number(draft.processingDaysMin) || 0,
        processingDaysMax: Number(draft.processingDaysMax) || 0,
        zones: draft.zones
          .filter((z) => z.region.trim())
          .map((z) => ({
            region: z.region.trim(),
            rateUsd: Number(z.rateUsd) || 0,
            additionalItemUsd: Number(z.additionalItemUsd) || 0,
          })),
      };
      if (draft.id) input.id = draft.id;
      const r = await lensRun('marketplace', 'shipping-profiles-save', input);
      if (r.data?.ok === false) {
        setError(r.data.error || 'Could not save profile');
        return;
      }
      setDraft(null);
      await refresh();
    } catch (e) {
      console.error('[Shipping] save failed', e);
      setError('Could not save profile');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this shipping profile?')) return;
    try {
      await lensRun('marketplace', 'shipping-profiles-delete', { id });
      await refresh();
    } catch (e) {
      console.error('[Shipping] delete failed', e);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Truck className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Shipping profiles</span>
          <span className="text-[10px] text-gray-500">{profiles.length}</span>
          <button
            onClick={startNew}
            className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New profile
          </button>
        </header>

        {/* Editor */}
        {draft && (
          <div className="px-4 py-3 border-b border-white/10 space-y-2">
            <div className="grid grid-cols-12 gap-2">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Profile name *"
                className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <input
                value={draft.originCountry}
                onChange={(e) => setDraft({ ...draft, originCountry: e.target.value })}
                placeholder="Origin country"
                className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <input
                type="number"
                value={draft.processingDaysMin}
                onChange={(e) => setDraft({ ...draft, processingDaysMin: e.target.value })}
                placeholder="Proc. min"
                className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
              />
              <input
                type="number"
                value={draft.processingDaysMax}
                onChange={(e) => setDraft({ ...draft, processingDaysMax: e.target.value })}
                placeholder="Proc. max"
                className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
              />
            </div>
            <div className="text-[10px] uppercase text-gray-500">Zones</div>
            {draft.zones.map((z, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input
                  value={z.region}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      zones: draft.zones.map((zz, idx) =>
                        idx === i ? { ...zz, region: e.target.value } : zz,
                      ),
                    })
                  }
                  placeholder="Region"
                  className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <input
                  type="number"
                  step="0.01"
                  value={z.rateUsd}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      zones: draft.zones.map((zz, idx) =>
                        idx === i ? { ...zz, rateUsd: e.target.value } : zz,
                      ),
                    })
                  }
                  placeholder="Base rate $"
                  className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <input
                  type="number"
                  step="0.01"
                  value={z.additionalItemUsd}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      zones: draft.zones.map((zz, idx) =>
                        idx === i ? { ...zz, additionalItemUsd: e.target.value } : zz,
                      ),
                    })
                  }
                  placeholder="+item $"
                  className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
                />
                <button
                  onClick={() =>
                    setDraft({ ...draft, zones: draft.zones.filter((_, idx) => idx !== i) })
                  }
                  className="col-span-1 p-1.5 rounded hover:bg-rose-500/20 text-rose-300 flex items-center justify-center"
                  aria-label="Remove zone"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  zones: [...draft.zones, { region: '', rateUsd: '', additionalItemUsd: '' }],
                })
              }
              className="px-2 py-1 text-[10px] rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 inline-flex items-center gap-1"
            >
              <Plus className="w-2.5 h-2.5" /> Add zone
            </button>
            {error && <div className="text-xs text-rose-300">{error}</div>}
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400 disabled:opacity-40 inline-flex items-center gap-1"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save profile
              </button>
              <button
                onClick={() => setDraft(null)}
                className="px-3 py-1.5 text-xs rounded border border-white/10 text-gray-400 hover:text-white inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="max-h-[24rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : profiles.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-500">
              <Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No shipping profiles yet.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {profiles.map((p) => (
                <li key={p.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-gray-500">{p.number}</span>
                    <span className="text-sm text-white font-medium">{p.name}</span>
                    <span className="text-[10px] text-gray-500">
                      {p.originCountry || 'no origin'} · {p.processingDaysMin}–{p.processingDaysMax}d
                      processing
                    </span>
                    <button
                      onClick={() => startEdit(p)}
                      className="ml-auto px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:text-white"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="p-1.5 rounded hover:bg-rose-500/20 text-rose-300"
                      aria-label="Delete profile"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {p.zones.length > 0 && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.zones.map((z, i) => (
                        <li
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 font-mono"
                        >
                          {z.region}: ${z.rateUsd.toFixed(2)}
                          {z.additionalItemUsd > 0 && ` +$${z.additionalItemUsd.toFixed(2)}/item`}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShippingProfilesPanel;
