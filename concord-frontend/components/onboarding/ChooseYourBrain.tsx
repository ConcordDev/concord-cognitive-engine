'use client';

/**
 * ChooseYourBrain — Private Mode / High Power Mode onboarding screen.
 *
 * Runs BEFORE the universe-seeding step (ChooseYourUniverse /
 * /onboarding) since this choice governs whether anything after it can
 * ever touch a cloud LLM provider. Private is pre-selected and is the
 * durable default for every account, new or existing — a user must
 * actively pick High Power to leave it.
 *
 * The copy here is deliberately plain and specific (not euphemistic):
 * it names the actual third-party providers and states outright that
 * some of them train on submitted messages. This is the one place a
 * user is asked to trade privacy for capability, so the tradeoff has to
 * be legible at the moment they choose it, not buried in a settings
 * page they'll never read.
 *
 * On submit, posts to POST /api/auth/choose-brain-mode, which writes
 * users.brain_mode (read by every LLM dispatch chokepoint via
 * server/lib/byo-router.js#getBrainMode — see that file's header for
 * the full precedence contract). The backend's /api/auth/me then
 * returns needsBrainModeChoice: false so this screen stops re-appearing.
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ShieldCheck, Zap, ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type BrainMode = 'private' | 'high_power';

interface Props {
  /** Called after a successful choice. Default: router.push('/onboarding'). */
  onComplete?: () => void;
}

export function ChooseYourBrain({ onComplete }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<BrainMode>('private');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (brainMode: BrainMode) => {
      const { data } = await api.post('/api/auth/choose-brain-mode', { brainMode });
      return data;
    },
    onSuccess: () => {
      if (onComplete) onComplete();
      else router.push('/onboarding');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
    },
  });

  const handleContinue = () => mutation.mutate(selected);

  return (
    <div className="min-h-screen bg-lattice-void flex items-center justify-center p-6">
      <div className="w-full max-w-3xl bg-lattice-surface border border-lattice-border rounded-2xl p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <ShieldCheck className="w-5 h-5 text-neon-cyan" />
            <span className="text-xs uppercase tracking-widest text-neon-cyan">Before anything else</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">How should Concord think for you?</h1>
          <p className="text-gray-400 max-w-xl mx-auto">
            This decides whether anything you do here ever leaves our own hardware. You can change it later in Settings.
          </p>
        </div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Private */}
          <button
            type="button"
            onClick={() => setSelected('private')}
            aria-pressed={selected === 'private'}
            className={cn(
              'text-left rounded-2xl border-2 p-6 transition-all',
              selected === 'private'
                ? 'border-neon-cyan bg-neon-cyan/10 ring-2 ring-neon-cyan/40'
                : 'border-lattice-border bg-lattice-deep hover:border-neon-cyan/30',
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <ShieldCheck className="w-7 h-7 text-neon-cyan" />
              {selected === 'private' && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-neon-cyan">
                  <Check className="w-3 h-3" /> Selected
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Private — local only</h3>
            <p className="text-sm text-gray-300 leading-snug">
              Every response comes from Concord&rsquo;s own brains running on our hardware. Nothing you do here ever reaches an outside AI provider. No exceptions.
            </p>
            <p className="text-[11px] text-neon-cyan/80 mt-3 font-medium">Default. Recommended.</p>
          </button>

          {/* High Power */}
          <button
            type="button"
            onClick={() => setSelected('high_power')}
            aria-pressed={selected === 'high_power'}
            className={cn(
              'text-left rounded-2xl border-2 p-6 transition-all',
              selected === 'high_power'
                ? 'border-amber-400 bg-amber-400/10 ring-2 ring-amber-400/40'
                : 'border-lattice-border bg-lattice-deep hover:border-amber-400/30',
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <Zap className="w-7 h-7 text-amber-400" />
              {selected === 'high_power' && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-amber-400">
                  <Check className="w-3 h-3" /> Selected
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold text-white mb-1">High Power — faster, more capable, not private</h3>
            <p className="text-sm text-gray-300 leading-snug">
              Your messages are sent to third-party AI providers (<strong className="text-white">Google Gemini, Mistral, and Groq</strong>) to give you stronger responses.{' '}
              <strong className="text-amber-300">Some of these providers may use your messages to improve their own AI models</strong> — Groq does not, Gemini and Mistral&rsquo;s free tiers do. Private Mode never shares your data with anyone.
            </p>
            <p className="text-[11px] text-amber-400/80 mt-3 font-medium">You can switch back at any time in Settings.</p>
          </button>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end pt-4 border-t border-lattice-border">
          <button
            type="button"
            onClick={handleContinue}
            disabled={mutation.isPending}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all',
              !mutation.isPending
                ? 'bg-neon-cyan text-black hover:bg-neon-cyan/90'
                : 'bg-lattice-border text-gray-400 cursor-not-allowed',
            )}
          >
            {mutation.isPending ? 'Saving…' : selected === 'private' ? 'Stay Private' : 'Continue with High Power'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-4">
          You can change this at any time in Settings.
        </p>
      </div>
    </div>
  );
}

export default ChooseYourBrain;
