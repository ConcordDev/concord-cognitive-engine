'use client';

/**
 * SovereigntySetup — Onboarding sovereignty mode picker.
 * Three paths: Empty, Domain-Focused, Full Sync.
 * Integrates with POST /api/sovereignty/setup.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Shield,
  Lock,
  Layers,
  Globe,
  ChefHat,
  Dumbbell,
  Heart,
  DollarSign,
  Calculator,
  Scale,
  GraduationCap,
  Home,
  Music,
  Pen,
  Code,
  TrendingUp,
} from 'lucide-react';

interface SovereigntySetupProps {
  onComplete: () => void;
}

const POPULAR_DOMAINS = [
  { id: 'food', label: 'Food & Nutrition', icon: ChefHat },
  { id: 'fitness', label: 'Fitness & Training', icon: Dumbbell },
  { id: 'healthcare', label: 'Healthcare', icon: Heart },
  { id: 'finance', label: 'Finance', icon: DollarSign },
  { id: 'accounting', label: 'Accounting', icon: Calculator },
  { id: 'law', label: 'Legal', icon: Scale },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'realestate', label: 'Real Estate', icon: Home },
  { id: 'music', label: 'Music Production', icon: Music },
  { id: 'creative', label: 'Creative Writing', icon: Pen },
  { id: 'code', label: 'Software Dev', icon: Code },
  { id: 'trades', label: 'Trading', icon: TrendingUp },
];

type SovereigntyMode = 'empty' | 'domain_focused' | 'full_sync';

function SovereigntySetup({ onComplete }: SovereigntySetupProps) {
  const [mode, setMode] = useState<SovereigntyMode | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);

  const setup = useMutation({
    mutationFn: () => api.post('/api/sovereignty/setup', { mode, selectedDomains }),
    onSuccess: () => onComplete(),
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8 p-8">
      <div className="text-center">
        <Shield className="w-12 h-12 text-neon-cyan mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white">Your Concord, Your Rules</h1>
        <p className="text-zinc-400 mt-2">
          Choose how much shared knowledge to start with. You can always change this later.
        </p>
      </div>

      <div className="space-y-4">
        {/* Empty */}
        <button
          onClick={() => setMode('empty')}
          className={cn(
            'w-full text-left p-4 rounded-lg border transition-all',
            mode === 'empty'
              ? 'border-neon-cyan bg-neon-cyan/5'
              : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
          )}
        >
          <div className="flex items-center gap-3">
            <Lock className="w-5 h-5 text-neon-cyan" />
            <div>
              <p className="font-medium text-white">Start Empty</p>
              <p className="text-sm text-zinc-400">
                Maximum sovereignty. Your substrate grows only from your interactions. Global
                knowledge available on request.
              </p>
            </div>
          </div>
        </button>

        {/* Domain Focused */}
        <button
          onClick={() => setMode('domain_focused')}
          className={cn(
            'w-full text-left p-4 rounded-lg border transition-all',
            mode === 'domain_focused'
              ? 'border-neon-cyan bg-neon-cyan/5'
              : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
          )}
        >
          <div className="flex items-center gap-3">
            <Layers className="w-5 h-5 text-blue-400" />
            <div>
              <p className="font-medium text-white">Pick Your Domains</p>
              <p className="text-sm text-zinc-400">
                Selective sovereignty. Choose which domains to seed from global. Everything else
                starts empty.
              </p>
            </div>
          </div>
        </button>

        {/* Domain picker */}
        {mode === 'domain_focused' && (
          <div className="grid grid-cols-2 gap-2 pl-8">
            {POPULAR_DOMAINS.map((d) => (
              <button
                key={d.id}
                onClick={() =>
                  setSelectedDomains((prev) =>
                    prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                  )
                }
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all',
                  selectedDomains.includes(d.id)
                    ? 'border-neon-cyan/50 bg-neon-cyan/10 text-white'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                )}
              >
                <d.icon className="w-4 h-4" />
                {d.label}
              </button>
            ))}
          </div>
        )}

        {/* Full Sync */}
        <button
          onClick={() => setMode('full_sync')}
          className={cn(
            'w-full text-left p-4 rounded-lg border transition-all',
            mode === 'full_sync'
              ? 'border-neon-cyan bg-neon-cyan/5'
              : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
          )}
        >
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-purple-400" />
            <div>
              <p className="font-medium text-white">Full Sync</p>
              <p className="text-sm text-zinc-400">
                Start with everything. All public knowledge synced to your substrate. Fastest start,
                most context.
              </p>
            </div>
          </div>
        </button>
      </div>

      <button
        onClick={() => setup.mutate()}
        disabled={
          !mode || setup.isPending || (mode === 'domain_focused' && selectedDomains.length === 0)
        }
        className="w-full py-3 rounded-lg bg-neon-cyan/20 border border-neon-cyan/50
          text-neon-cyan font-medium hover:bg-neon-cyan/30 transition-all
          disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {setup.isPending ? 'Setting up your Concord...' : 'Continue'}
      </button>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSovereigntySetup = withErrorBoundary(SovereigntySetup);
export { _WrappedSovereigntySetup as SovereigntySetup };
