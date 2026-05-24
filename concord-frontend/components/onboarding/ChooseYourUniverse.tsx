'use client';

/**
 * ChooseYourUniverse — post-signup onboarding screen.
 *
 * New users land here immediately after signup or on first login if
 * they haven't set their region/nation/primary lens yet. The screen
 * asks three things:
 *
 *   1. What's your primary lens? (which universe do you live in?)
 *   2. What region are you in? (for regional-scoped content)
 *   3. What country are you in? (for national-scoped content)
 *
 * All three are optional individually but the user must pick at least
 * one to continue. Skipping just drops them on the dashboard with
 * local scope only — they can set region/nation later in Settings.
 *
 * On submit, posts to POST /api/auth/choose-universe which writes
 * users.declared_regional / declared_national / primary_lens. The
 * backend's /api/auth/me then returns `needsOnboarding: false` so
 * this screen stops re-appearing.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Globe, MapPin, Flag, Sparkles, ArrowRight, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

// The six core lenses that dominate the onboarding choice. Users can
// explore all 177 lenses later — this picker is intentionally narrow
// so new users aren't overwhelmed.
const PRIMARY_LENSES = [
  { id: 'chat',    label: 'Chat',    description: 'Talk to AI, get answers, think out loud' },
  { id: 'studio',  label: 'Studio',  description: 'Make music, art, video, anything creative' },
  { id: 'code',    label: 'Code',    description: 'Write, debug, run software' },
  { id: 'graph',   label: 'Graph',   description: 'Map ideas, systems, relationships' },
  { id: 'board',   label: 'Board',   description: 'Plan projects, track goals, collaborate' },
  { id: 'social',  label: 'Social',  description: 'Share, post, interact with community' },
];

interface Props {
  /** Called after successful universe selection. Default: router.push('/hub'). */
  onComplete?: () => void;
  /** Called if the user skips. Default: same as onComplete. */
  onSkip?: () => void;
}

export function ChooseYourUniverse({ onComplete, onSkip }: Props) {
  const router = useRouter();
  const [primaryLens, setPrimaryLens] = useState<string | null>(null);
  const [regional, setRegional] = useState('');
  const [national, setNational] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (primaryLens) body.primaryLens = primaryLens;
      if (regional.trim()) body.regional = regional.trim();
      if (national.trim()) body.national = national.trim();
      const { data } = await api.post('/api/auth/choose-universe', body);
      return data;
    },
    onSuccess: () => {
      if (onComplete) onComplete();
      else router.push('/hub');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
    },
  });

  const canContinue = !!primaryLens || regional.trim().length > 0 || national.trim().length > 0;

  const handleSkip = () => {
    if (onSkip) onSkip();
    else if (onComplete) onComplete();
    else router.push('/hub');
  };

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-lattice-surface border border-lattice-border rounded-2xl p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-neon-cyan" />
            <span className="text-xs uppercase tracking-widest text-neon-cyan">First things first</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Choose your universe</h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            Concord has 177 lenses. Pick where you want to start — you can explore all of them later.
            Your region and country scope what other people see and how they find you.
          </p>
        </div>

        {/* Primary Lens */}
        <section className="mb-8">
          <label className="flex items-center gap-2 text-sm uppercase tracking-wide text-gray-400 mb-3">
            <Globe className="w-4 h-4" />
            Primary lens
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {PRIMARY_LENSES.map((lens) => {
              const isActive = primaryLens === lens.id;
              return (
                <button
                  key={lens.id}
                  type="button"
                  onClick={() => setPrimaryLens(lens.id)}
                  className={cn(
                    'text-left rounded-xl border p-4 transition-all',
                    isActive
                      ? 'border-neon-cyan bg-neon-cyan/10 ring-2 ring-neon-cyan/40'
                      : 'border-lattice-border bg-lattice-deep hover:border-neon-cyan/30',
                  )}
                  aria-pressed={isActive}
                >
                  <div className="text-white font-medium">{lens.label}</div>
                  <div className="text-xs text-gray-400 mt-1 leading-snug">{lens.description}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Location */}
        <section className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-sm uppercase tracking-wide text-gray-400 mb-2">
              <MapPin className="w-4 h-4" />
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
              Posts you scope as &ldquo;regional&rdquo; are visible only to others in this region.
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm uppercase tracking-wide text-gray-400 mb-2">
              <Flag className="w-4 h-4" />
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
              Posts scoped &ldquo;national&rdquo; are visible only in this country.
            </p>
          </div>
        </section>

        {error && (
          <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-lattice-border">
          <button
            type="button"
            onClick={handleSkip}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <SkipForward className="w-4 h-4" />
            Skip for now
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canContinue || mutation.isPending}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all',
              canContinue && !mutation.isPending
                ? 'bg-neon-cyan text-black hover:bg-neon-cyan/90'
                : 'bg-lattice-border text-gray-400 cursor-not-allowed',
            )}
          >
            {mutation.isPending ? 'Saving…' : 'Enter Concord'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          You can change any of this later in Settings.
        </p>
      </div>
    </div>
  );
}

export default ChooseYourUniverse;
