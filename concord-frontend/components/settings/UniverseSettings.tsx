'use client';

/**
 * UniverseSettings — edit your region / country / primary lens.
 *
 * Lives in the profile page's Settings tab. Reads the current values
 * from /api/auth/me and writes back via POST /api/auth/choose-universe
 * (which is idempotent and safe to call at any time post-signup).
 *
 * Changing your region/country after the fact is a real-world thing
 * people need — you move, you travel, you want to adjust what feed
 * you see. The backend already supports it; this gives the UI.
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { MapPin, Flag, Compass, Save, Check } from 'lucide-react';

const PRIMARY_LENSES = [
  { id: 'chat',    label: 'Chat' },
  { id: 'studio',  label: 'Studio' },
  { id: 'code',    label: 'Code' },
  { id: 'graph',   label: 'Graph' },
  { id: 'board',   label: 'Board' },
  { id: 'social',  label: 'Social' },
];

interface MeResponse {
  ok: boolean;
  user: {
    id: string;
    username: string;
    declaredRegional: string | null;
    declaredNational: string | null;
    primaryLens: string | null;
    needsOnboarding: boolean;
  };
}

export function UniverseSettings() {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const { data: me } = useQuery<MeResponse>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await api.get('/api/auth/me');
      return res.data;
    },
    staleTime: 60_000,
  });

  const [regional, setRegional] = useState('');
  const [national, setNational] = useState('');
  const [primaryLens, setPrimaryLens] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Hydrate from /me once it loads
  useEffect(() => {
    if (!me?.user) return;
    setRegional(me.user.declaredRegional || '');
    setNational(me.user.declaredNational || '');
    setPrimaryLens(me.user.primaryLens || null);
  }, [me?.user]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/auth/choose-universe', {
        regional: regional.trim() || null,
        national: national.trim() || null,
        primaryLens: primaryLens || null,
      });
      return res.data;
    },
    onSuccess: () => {
      addToast({ type: 'success', message: 'Universe updated.' });
      setSavedAt(Date.now());
      queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (err: unknown) => {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save settings',
      });
    },
  });

  const hasChanges =
    (regional.trim() || null) !== (me?.user.declaredRegional || null) ||
    (national.trim() || null) !== (me?.user.declaredNational || null) ||
    (primaryLens || null) !== (me?.user.primaryLens || null);

  return (
    <div className="space-y-6">
      <div className={cn(ds.panel, 'space-y-5')}>
        <div>
          <h2 className="text-lg font-semibold text-white">Your Universe</h2>
          <p className="text-sm text-gray-400 mt-1">
            Set where you are in the world and which lens you live in.
            Regional and national DTUs are scoped to match your declared
            location — if you move, update these so your feed follows you.
          </p>
        </div>

        {/* Primary lens */}
        <div>
          <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 mb-2">
            <Compass className="w-3.5 h-3.5" />
            Primary lens
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {PRIMARY_LENSES.map((lens) => {
              const isActive = primaryLens === lens.id;
              return (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setPrimaryLens(lens.id)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm transition-all text-left',
                    isActive
                      ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan ring-2 ring-neon-cyan/40'
                      : 'border-lattice-border bg-lattice-deep text-gray-300 hover:border-neon-cyan/30',
                  )}
                  aria-pressed={isActive}
                >
                  {lens.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Region / Nation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 mb-2">
              <MapPin className="w-3.5 h-3.5" />
              Region
            </label>
            <input
              type="text"
              value={regional}
              onChange={(e) => setRegional(e.target.value)}
              placeholder="e.g. Bay Area, London, Tokyo"
              className="w-full rounded-lg bg-lattice-deep border border-lattice-border px-3 py-2 text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-cyan"
              autoComplete="address-level2"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Regional posts you make are visible to others in this region.
              Clear it to drop out of regional feeds entirely.
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 mb-2">
              <Flag className="w-3.5 h-3.5" />
              Country
            </label>
            <input
              type="text"
              value={national}
              onChange={(e) => setNational(e.target.value)}
              placeholder="e.g. United States, Japan, Brazil"
              className="w-full rounded-lg bg-lattice-deep border border-lattice-border px-3 py-2 text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-cyan"
              autoComplete="country-name"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              National posts you make are visible country-wide.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-lattice-border">
          <div className="text-xs text-gray-400">
            {savedAt ? (
              <span className="inline-flex items-center gap-1 text-neon-green">
                <Check className="w-3.5 h-3.5" />
                Saved
              </span>
            ) : hasChanges ? (
              <span className="text-neon-yellow">Unsaved changes</span>
            ) : (
              'Up to date'
            )}
          </div>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!hasChanges || mutation.isPending}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              hasChanges && !mutation.isPending
                ? 'bg-neon-cyan text-black hover:bg-neon-cyan/90'
                : 'bg-lattice-border text-gray-400 cursor-not-allowed',
            )}
          >
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UniverseSettings;
