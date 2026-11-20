'use client';

/**
 * Saved chains: keep a track's whole insert chain (Pitch Correct, de-esser,
 * EQ, compressor…) under a name and drop it on any track later. Stored per
 * user by studio.fx-rack-*, so your vocal chain follows you to every song.
 */

import { useCallback, useEffect, useState } from 'react';
import { Archive, Download, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import type { DAWTrack, EffectInstance } from '@/lib/daw/types';
import { studio, type Rack } from './boothApi';
import { chainToUnits, unitsToChain } from './chains';

export function ChainShelf({ track, onEffects }: { track: DAWTrack | null; onEffects: (fx: EffectInstance[], key?: string) => void }) {
  const [racks, setRacks] = useState<Rack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [landed, setLanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await studio<{ racks: Rack[] }>('fx-rack-list');
    if (!r.ok) { setError(r.error || 'Could not load your saved chains.'); setRacks([]); return; }
    setError(null);
    setRacks(r.result?.racks || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const chain = track?.effectChain || [];
  const save = async () => {
    if (!track || !chain.length) return;
    const label = name.trim() || `${track.name} chain`;
    setSaving(true);
    const r = await studio<{ rack: Rack }>('fx-rack-save', { name: label, units: chainToUnits(chain) });
    setSaving(false);
    if (!r.ok || !r.result?.rack) { showToast('error', r.error || 'The chain was not saved.'); return; }
    setRacks((prev) => [r.result!.rack, ...(prev || [])]);
    setName('');
    setLanded(r.result.rack.id);
    showToast('success', `Saved “${r.result.rack.name}” (${r.result.rack.units.length} devices).`);
  };

  const loadRack = (rack: Rack) => {
    if (!track) return;
    const { chain: added, skipped } = unitsToChain(rack.units);
    if (!added.length) { showToast('warning', 'None of the devices in that chain exist in Studio.'); return; }
    onEffects([...chain, ...added]);
    showToast('success', `Added ${added.length} device${added.length > 1 ? 's' : ''} from “${rack.name}” to ${track.name}${skipped ? ` (${skipped} skipped: not a Studio device)` : ''}.`);
  };

  const remove = async (rack: Rack) => {
    const before = racks || [];
    setRacks(before.filter((r) => r.id !== rack.id));
    const r = await studio('fx-rack-delete', { id: rack.id });
    if (!r.ok) { setRacks(before); showToast('error', r.error || 'That chain was not removed.'); }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 bg-[var(--bo-console)] px-2 py-1" data-testid="booth-chain-shelf">
      <span className="bo-engrave flex items-center gap-1 text-xs"><Archive className="h-3 w-3" aria-hidden /> Chains</span>
      {track && chain.length > 0 && (
        <span className="flex items-center gap-1">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={`${track.name} chain`} aria-label="Name for the saved chain" className="h-6 w-32 rounded bg-black/40 px-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600" />
          <button type="button" onClick={() => void save()} disabled={saving} className="bo-key flex h-6 items-center gap-1 rounded px-2 text-[11px] disabled:opacity-50" data-testid="booth-chain-save">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />} Save {chain.length} device{chain.length > 1 ? 's' : ''}
          </button>
        </span>
      )}
      {track && chain.length === 0 && <span className="text-[11px] text-zinc-500">Add devices to save this track&apos;s chain.</span>}
      {!track && <span className="text-[11px] text-zinc-500">Pick a track to save or load a chain.</span>}
      {racks === null && <span className="text-[11px] text-zinc-500">Loading saved chains…</span>}
      {error && <span className="text-[11px] text-red-300">{error}</span>}
      {(racks || []).map((r) => (
        <span key={r.id} className={cn('flex items-center overflow-hidden rounded border border-white/10 bg-[var(--bo-panel)]', landed === r.id && 'bo-land')} data-testid="booth-chain">
          <button type="button" onClick={() => loadRack(r)} disabled={!track} className="flex h-6 items-center gap-1 px-1.5 text-[11px] text-zinc-200 hover:bg-white/5 disabled:opacity-40" title={`Add ${r.units.map((u) => u.name || u.type).join(' → ')} to the selected track`} aria-label={`Load chain ${r.name}`}>
            <Download className="h-3 w-3" aria-hidden /> {r.name} <span className="text-zinc-500">{r.units.length}</span>
          </button>
          <button type="button" onClick={() => void remove(r)} className="h-6 px-1 text-zinc-600 hover:text-red-400" aria-label={`Delete chain ${r.name}`}><X className="h-3 w-3" /></button>
        </span>
      ))}
    </div>
  );
}
