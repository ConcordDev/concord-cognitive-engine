'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import {
  Brain, Globe, Compass, Sparkles,
  Rocket, ChevronRight, Check,
} from 'lucide-react';

type UniverseMode = 'empty' | 'starter' | 'domain-specific' | 'full';

const MODES: {
  id: UniverseMode;
  title: string;
  description: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  bgColor: string;
}[] = [
  {
    id: 'empty',
    title: 'Empty Universe',
    description: 'Start from nothing. Build your knowledge from scratch.',
    detail: 'Perfect for those who want a clean slate. Your universe will grow organically as you create and explore.',
    icon: <Sparkles className="w-8 h-8" />,
    color: 'text-neon-cyan',
    borderColor: 'border-neon-cyan/30 hover:border-neon-cyan/60',
    bgColor: 'bg-neon-cyan/5',
  },
  {
    id: 'starter',
    title: 'Starter Pack',
    description: 'Begin with curated world knowledge seeds.',
    detail: 'Includes foundational DTUs across key domains — science, philosophy, mathematics, and more. A great starting point.',
    icon: <Rocket className="w-8 h-8" />,
    color: 'text-neon-blue',
    borderColor: 'border-neon-blue/30 hover:border-neon-blue/60',
    bgColor: 'bg-neon-blue/5',
  },
  {
    id: 'domain-specific',
    title: 'Domain Focus',
    description: 'Choose specific domains to pre-populate.',
    detail: 'Select the knowledge domains most relevant to you. Your universe will be seeded with DTUs from those areas.',
    icon: <Compass className="w-8 h-8" />,
    color: 'text-neon-purple',
    borderColor: 'border-neon-purple/30 hover:border-neon-purple/60',
    bgColor: 'bg-neon-purple/5',
  },
  {
    id: 'full',
    title: 'Full Sync',
    description: 'Mirror the entire global Sacred Timeline.',
    detail: 'Get a complete copy of all canonical DTUs. Best for power users who want immediate access to everything.',
    icon: <Globe className="w-8 h-8" />,
    color: 'text-neon-green',
    borderColor: 'border-neon-green/30 hover:border-neon-green/60',
    bgColor: 'bg-neon-green/5',
  },
];

const DOMAINS = [
  'ai', 'math', 'physics', 'code', 'research', 'healthcare', 'finance',
  'legal', 'education', 'creative', 'music', 'art', 'engineering',
  'philosophy', 'science', 'ethics', 'game', 'board', 'graph',
  'meta', 'eco', 'logistics', 'security', 'quantum',
];

export default function OnboardingPage() {
  const router = useRouter();
  const [selectedMode, setSelectedMode] = useState<UniverseMode | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [step, setStep] = useState<'mode' | 'domains' | 'initializing'>('mode');
  const addToast = useUIStore((s) => s.addToast);

  const initMutation = useMutation({
    mutationFn: async (data: { mode: UniverseMode; domains?: string[] }) => {
      await api.get('/api/auth/csrf-token').catch(() => {});
      const res = await api.post('/api/universe/initialize', data);
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.ok) {
        addToast({ type: 'success', message: 'Your universe has been created!' });
        // Chain to step 2: region / country / primary lens. New users
        // who haven't declared their location get nudged into the
        // federation scope picker so regional/national posts work.
        router.push('/onboarding/location');
      } else {
        addToast({ type: 'error', message: data?.error || 'Failed to initialize universe' });
        setStep('mode');
      }
    },
    onError: (err) => {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Initialization failed' });
      setStep('mode');
    },
  });

  function handleModeSelect(mode: UniverseMode) {
    setSelectedMode(mode);
    if (mode === 'domain-specific') {
      setStep('domains');
    } else {
      setStep('initializing');
      initMutation.mutate({ mode });
    }
  }

  function handleDomainSubmit() {
    if (selectedDomains.length === 0) return;
    setStep('initializing');
    initMutation.mutate({ mode: 'domain-specific', domains: selectedDomains });
  }

  function toggleDomain(domain: string) {
    setSelectedDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  }

  // Initializing state
  if (step === 'initializing') {
    return (
      <div className="min-h-screen bg-lattice-void flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <h2 className="text-2xl font-bold text-white">Creating Your Universe</h2>
          <p className="text-gray-400">
            {selectedMode === 'full'
              ? 'Syncing the entire Sacred Timeline...'
              : selectedMode === 'starter'
              ? 'Seeding world knowledge...'
              : selectedMode === 'domain-specific'
              ? `Populating ${selectedDomains.length} domains...`
              : 'Initializing empty lattice...'}
          </p>
        </div>
      </div>
    );
  }

  // Domain selection step
  if (step === 'domains') {
    return (
      <div className="min-h-screen bg-lattice-void text-white">
        {/* Background glow */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-neon-purple/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-neon-blue/5 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-4 py-12">
          <button
            onClick={() => setStep('mode')}
            className="text-gray-400 hover:text-white mb-8 text-sm flex items-center gap-1 transition-colors"
          >
            &larr; Back to mode selection
          </button>

          <h1 className="text-3xl font-bold mb-2">Choose Your Domains</h1>
          <p className="text-gray-400 mb-8">
            Select the knowledge areas that interest you most. Your universe will be seeded with DTUs from these domains.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
            {DOMAINS.map((domain) => {
              const isSelected = selectedDomains.includes(domain);
              return (
                <button
                  key={domain}
                  onClick={() => toggleDomain(domain)}
                  className={cn(
                    'px-4 py-3 rounded-xl border text-sm font-medium transition-all',
                    isSelected
                      ? 'border-neon-purple bg-neon-purple/20 text-neon-purple'
                      : 'border-lattice-border bg-lattice-surface text-gray-300 hover:border-gray-500'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isSelected && <Check className="w-4 h-4" />}
                    {domain}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {selectedDomains.length} domain{selectedDomains.length !== 1 ? 's' : ''} selected
            </p>
            <button
              onClick={handleDomainSubmit}
              disabled={selectedDomains.length === 0}
              className={cn(
                'px-6 py-3 rounded-lg font-semibold text-white transition-all flex items-center gap-2',
                selectedDomains.length > 0
                  ? 'bg-gradient-to-r from-neon-purple to-neon-blue hover:shadow-lg hover:shadow-neon-purple/25'
                  : 'bg-gray-700 opacity-50 cursor-not-allowed'
              )}
            >
              Initialize Universe
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Mode selection step
  return (
    <div className="min-h-screen bg-lattice-void text-white">
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-neon-cyan/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-neon-purple/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center mx-auto mb-6">
            <Brain className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-4xl font-bold mb-3">
            Welcome to <span className="bg-gradient-to-r from-neon-cyan to-neon-blue bg-clip-text text-transparent">Concordos</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Your sovereign cognitive engine awaits. Choose how to initialize your personal universe.
          </p>
        </div>

        {/* Mode Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeSelect(mode.id)}
              className={cn(
                'text-left p-6 rounded-2xl border-2 transition-all group',
                mode.borderColor,
                mode.bgColor,
                'hover:scale-[1.02]'
              )}
            >
              <div className={cn('mb-4', mode.color)}>
                {mode.icon}
              </div>
              <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                {mode.title}
                <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </h3>
              <p className="text-gray-300 mb-2">{mode.description}</p>
              <p className="text-sm text-gray-400">{mode.detail}</p>
            </button>
          ))}
        </div>

        {/* Info footer */}
        <div className="text-center">
          <p className="text-sm text-gray-400">
            You can always change your universe later by syncing from the global library.
          </p>
        </div>
      </div>
    </div>
  );
}
