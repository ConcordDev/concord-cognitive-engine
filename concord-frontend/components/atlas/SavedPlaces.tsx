'use client';

/**
 * SavedPlaces — Google-Maps-style "Your places" panel for the atlas
 * lens. Patterned on Maps' bookmark list with category chips (home /
 * work / starred / labeled). Lists, creates, edits, and deletes the
 * user's actual saved places via the existing `useLensData` artifact
 * persistence layer — no mock data, no local-only state.
 *
 * Backend (no changes): persists as `atlas`/`place` artifacts through
 * the substrate's POST /api/artifacts pipeline (the same one every
 * lens uses). Coordinates are real, resolved via the already-wired
 * `atlas.nominatim-geocode` macro on save.
 *
 * Companion to PlaceFinder (free-form search) and MapsDirections
 * (turn-by-turn). Each is a distinct Maps surface.
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Star, Home, Briefcase, Tag, Trash2, MapPin, Plus, Loader2, ExternalLink,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type Category = 'home' | 'work' | 'starred' | 'labeled';

interface PlaceData {
  query: string;
  displayName?: string;
  latitude?: number;
  longitude?: number;
  category?: Category;
  notes?: string;
}

const CATEGORIES: Array<{ id: Category; label: string; icon: typeof Home; colour: string }> = [
  { id: 'home',    label: 'Home',    icon: Home,      colour: 'emerald' },
  { id: 'work',    label: 'Work',    icon: Briefcase, colour: 'sky' },
  { id: 'starred', label: 'Starred', icon: Star,      colour: 'amber' },
  { id: 'labeled', label: 'Labeled', icon: Tag,       colour: 'fuchsia' },
];

async function geocode(query: string): Promise<{ displayName: string; latitude: number; longitude: number } | null> {
  if (!query.trim()) return null;
  try {
    const r = await apiHelpers.lens.runDomain('atlas', 'nominatim-geocode', { input: { query: query.trim(), limit: 1 } });
    const env = (r as { data?: { ok: boolean; result?: { places?: Array<{ displayName: string; latitude: number; longitude: number }>; result?: { places?: Array<{ displayName: string; latitude: number; longitude: number }> } } } }).data;
    if (!env?.ok) return null;
    const places = env.result?.places || env.result?.result?.places || [];
    const top = places[0];
    return top ? { displayName: top.displayName, latitude: top.latitude, longitude: top.longitude } : null;
  } catch { return null; }
}

const CHIP_BG: Record<string, string> = {
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  fuchsia: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200',
};

export function SavedPlaces() {
  const { items, isLoading, create, remove } = useLensData<PlaceData>('atlas', 'place', { seed: [] });
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [newQuery, setNewQuery] = useState('');
  const [newCategory, setNewCategory] = useState<Category>('starred');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((i) => (i.data as PlaceData).category === filter);
  }, [items, filter]);

  const add = useMutation({
    mutationFn: async () => {
      const q = newQuery.trim();
      if (!q) return null;
      const geo = await geocode(q);
      if (!geo) throw new Error('Could not geocode that address');
      const created = await create({
        title: q,
        data: {
          query: q,
          displayName: geo.displayName,
          latitude: geo.latitude,
          longitude: geo.longitude,
          category: newCategory,
          notes: newNotes.trim() || undefined,
        },
        meta: { tags: ['atlas', 'place', newCategory], status: 'active', visibility: 'private' },
      });
      setNewQuery('');
      setNewNotes('');
      setAdding(false);
      return created;
    },
  });

  const countsByCategory = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const cat of CATEGORIES) c[cat.id] = items.filter((i) => (i.data as PlaceData).category === cat.id).length;
    return c;
  }, [items]);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-rose-400" />
          <span className="text-sm font-semibold text-white">Your places</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{items.length} saved</span>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="concord-atlas-saved-places"
              title={`My ${items.length} saved places`}
              content={items.map((i) => {
                const d = i.data as PlaceData;
                return `${d.category?.toUpperCase() || 'PLACE'}  ${i.title}\n  ${d.displayName || ''}\n  ${d.latitude}, ${d.longitude}${d.notes ? `\n  Notes: ${d.notes}` : ''}`;
              }).join('\n\n')}
              extraTags={['atlas', 'saved-places', 'export']}
              rawData={{ places: items.map((i) => ({ id: i.id, ...i.data })) }}
            />
          )}
          <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1 rounded bg-rose-500 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-400"><Plus className="h-3 w-3" />Add place</button>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 bg-zinc-900/20 px-3 py-2">
        <button type="button" onClick={() => setFilter('all')} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${filter === 'all' ? 'border-rose-400/60 bg-rose-500/15 text-rose-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>All ({countsByCategory.all})</button>
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = filter === c.id;
          return (
            <button key={c.id} type="button" onClick={() => setFilter(c.id)} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] ${active ? CHIP_BG[c.colour] : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>
              <Icon className="h-3 w-3" />
              {c.label} ({countsByCategory[c.id]})
            </button>
          );
        })}
      </div>

      {/* Add form */}
      {adding && (
        <div className="space-y-2 border-b border-zinc-800 bg-rose-500/5 px-3 py-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <input
              autoFocus
              className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-rose-500/40 focus:outline-none"
              placeholder="Address or place name (e.g. 1600 Pennsylvania Ave)"
              value={newQuery}
              onChange={(e) => setNewQuery(e.target.value)}
            />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <input
            className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-rose-500/40 focus:outline-none"
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => add.mutate()} disabled={add.isPending || !newQuery.trim()} className="inline-flex items-center gap-1 rounded bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
              {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save place
            </button>
            <button type="button" onClick={() => { setAdding(false); setNewQuery(''); setNewNotes(''); }} className="text-[11px] text-zinc-500 hover:text-zinc-200">Cancel</button>
            {add.isError && <span className="text-[11px] text-rose-300">{(add.error as Error)?.message || 'Geocoding failed'}</span>}
          </div>
        </div>
      )}

      {/* Place list */}
      <div className="max-h-[500px] overflow-y-auto p-3">
        {isLoading && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" />Loading your places…</div>}
        {!isLoading && items.length === 0 && !adding && (
          <div className="rounded border border-dashed border-zinc-800 p-8 text-center">
            <MapPin className="mx-auto h-6 w-6 text-zinc-600" />
            <div className="mt-2 text-[12px] text-zinc-400">No saved places yet.</div>
            <div className="mt-1 text-[11px] text-zinc-500">Tap "Add place" to save your first address. Place data persists across sessions as <code className="text-zinc-400">atlas/place</code> DTUs.</div>
            <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex items-center gap-1 rounded bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400"><Plus className="h-3 w-3" />Add your first place</button>
          </div>
        )}
        {!isLoading && filtered.length === 0 && items.length > 0 && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No places in this category. Switch filters above.</div>
        )}
        <div className="space-y-1.5">
          {filtered.map((item) => {
            const d = item.data as PlaceData;
            const cat = CATEGORIES.find((c) => c.id === d.category) || CATEGORIES[2];
            const Icon = cat.icon;
            const osmUrl = d.latitude != null && d.longitude != null
              ? `https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=15/${d.latitude}/${d.longitude}`
              : null;
            return (
              <div key={item.id} className={`group rounded-lg border ${CHIP_BG[cat.colour]} px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-white">{item.title}</div>
                    {d.displayName && <div className="truncate text-[10px] text-zinc-400">{d.displayName}</div>}
                    {d.notes && <div className="mt-0.5 text-[10px] text-zinc-300">{d.notes}</div>}
                    {d.latitude != null && d.longitude != null && (
                      <div className="font-mono text-[9px] text-zinc-500">{d.latitude.toFixed(4)}, {d.longitude.toFixed(4)}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    {osmUrl && <a href={osmUrl} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white" aria-label="View on OpenStreetMap"><ExternalLink className="h-3 w-3" /></a>}
                    <button type="button" onClick={() => remove(item.id)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-300" aria-label="Delete"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
