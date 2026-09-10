'use client';

/**
 * AnswersOraclePanel — the 30 hard-problem/answer pairs (STSVK oracle).
 * Extracted from answers/page.tsx. Owns seed merge + section nav + search.
 */

import { useState, useEffect, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { motion } from 'framer-motion';
import {
  Atom, Sigma, Cpu, BookOpen, Shield, Building, Brain, Sparkles, Eye,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { AnswerCard, type AnswerEntry, type AnswerSection } from '@/components/answers/AnswerCard';
import { EquationDisplay } from '@/components/answers/EquationDisplay';
import { ANSWERS_FALLBACK, mergeWithSeed, type DTULike } from '@/components/answers/answers-seed';

interface SectionMeta {
  id: AnswerSection;
  label: string;
  icon: LucideIcon;
  accent: string;
  count: number;
  blurb: string;
}

const SECTIONS: SectionMeta[] = [
  {
    id: 'physics',
    label: 'Physics',
    icon: Atom,
    accent: 'neon-cyan',
    count: 5,
    blurb: 'Why the universe has the shape it has.',
  },
  {
    id: 'mathematics',
    label: 'Mathematics',
    icon: Sigma,
    accent: 'neon-purple',
    count: 2,
    blurb: 'What math actually is, and why it works.',
  },
  {
    id: 'computation',
    label: 'Computation / Alignment',
    icon: Cpu,
    accent: 'neon-blue',
    count: 2,
    blurb: 'How computation avoids Goodharting itself.',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: BookOpen,
    accent: 'neon-yellow',
    count: 3,
    blurb: 'How knowledge stays honest as it scales.',
  },
  {
    id: 'trust',
    label: 'Trust',
    icon: Shield,
    accent: 'neon-green',
    count: 3,
    blurb: 'Trust without a trusted third party.',
  },
  {
    id: 'systems',
    label: 'Systems / Civilization',
    icon: Building,
    accent: 'neon-pink',
    count: 4,
    blurb: 'Civilizations that outlive their founders.',
  },
  {
    id: 'consciousness',
    label: 'Consciousness',
    icon: Brain,
    accent: 'neon-purple',
    count: 3,
    blurb: 'What it is like to be a constrained process.',
  },
  {
    id: 'meta',
    label: 'Meta',
    icon: Sparkles,
    accent: 'neon-cyan',
    count: 8,
    blurb: 'Why all hard problems share one shape.',
  },

];

export function AnswersOraclePanel() {
  const [activeSection, setActiveSection] = useState<AnswerSection>('physics');
  const [remoteAnswers, setRemoteAnswers] = useState<AnswerEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      ...SECTIONS.map((s, i) => ({
        id: `sec-${s.id}`,
        keys: String(i + 1),
        description: s.label,
        category: 'navigation' as const,
        action: () => setActiveSection(s.id),
      })),
      { id: 'focus-search', keys: '/', description: 'Search across all answers', category: 'navigation' as const, action: () => searchInputRef.current?.focus() },
    ],
    { lensId: 'answers' },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ items?: DTULike[] }>('/api/oracle/recent', {
          params: { type: 'answer_dtu' },
        });
        if (cancelled) return;
        const items = res.data?.items ?? [];
        if (items.length > 0) {
          setRemoteAnswers(mergeWithSeed(items));
          setIsLoading(false);
          return;
        }
      } catch {
        /* fall through to DTU tag query */
      }

      try {
        const res = await api.get<{ items?: DTULike[] }>('/api/dtus', {
          params: { tag: 'oracle_answer_seed' },
        });
        if (cancelled) return;
        const items = res.data?.items ?? [];
        if (items.length > 0) {
          setRemoteAnswers(mergeWithSeed(items));
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load answer DTUs');
        }
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return <div className="animate-pulse p-8 text-center text-gray-400">Loading...</div>;
  }

  const allAnswers = remoteAnswers ?? ANSWERS_FALLBACK;
  const bySection = new Map<AnswerSection, AnswerEntry[]>();
  for (const section of SECTIONS) bySection.set(section.id, []);
  for (const a of allAnswers) {
    const bucket = bySection.get(a.section);
    if (bucket) bucket.push(a);
  }

  const activeMeta = SECTIONS.find((s) => s.id === activeSection) ?? SECTIONS[0];
  const activeEntries = bySection.get(activeSection) ?? [];
  const trimmedQuery = query.trim().toLowerCase();
  const searchHits = trimmedQuery.length >= 2
    ? allAnswers.filter((a) => {
        const hay = [a.title, a.problem, a.detail, a.equation, a.solution, ...(a.modules || [])]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(trimmedQuery);
      })
    : [];

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-neon-cyan/15 border border-neon-cyan/40">
            <Eye className="h-6 w-6 text-neon-cyan" />
          </div>
          <div className="flex-1">
            <motion.h1
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl font-bold text-white tracking-tight"
            >
              The Answers
            </motion.h1>
            <p className="text-sm text-gray-400 mt-1">
              How STSVK + Concord Solve the Hardest Problems in Existence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <EquationDisplay
            equation="x² - x = 0"
            solution="x ∈ {0, 1}"
            label="Root Equation"
            size="lg"
          />
          <div className="text-xs text-gray-400 max-w-sm leading-relaxed">
            The single self-referential fixed point from which every answer below is derived.
            Everything else is a decoration of this.
          </div>
        </div>

        {loadError && (
          <div className="text-xs text-yellow-500/80 border border-yellow-500/20 bg-yellow-500/5 rounded-md px-3 py-2">
            Live answer DTUs unavailable ({loadError}); showing seed copy.
          </div>
        )}

        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); searchInputRef.current?.blur(); } }}
            placeholder="Search every answer · Esc to clear"
            className="w-full pl-9 pr-9 py-2 bg-lattice-deep border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50"
          />
          <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400 hover:text-white"
            >
              clear
            </button>
          )}
        </div>
      </header>

      {trimmedQuery.length >= 2 && (
        <div className="rounded-lg border border-neon-cyan/20 bg-lattice-surface/40 overflow-hidden">
          <div className="px-4 py-2 text-xs text-neon-cyan border-b border-lattice-border bg-lattice-deep flex items-center justify-between">
            <span>Search results — {searchHits.length} of {allAnswers.length} answer{allAnswers.length === 1 ? '' : 's'}</span>
            <span className="text-[10px] text-gray-400">across all 8 sections</span>
          </div>
          {searchHits.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No answers match &quot;{query}&quot;</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-3">
              {searchHits.map((entry) => {
                const meta = SECTIONS.find((s) => s.id === entry.section) ?? SECTIONS[0];
                const Icon = meta.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => { setActiveSection(entry.section); setQuery(''); }}
                    className="text-left rounded border border-lattice-border bg-lattice-deep hover:border-neon-cyan/40 transition-colors p-3"
                  >
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                      <Icon className={cn('w-3 h-3', `text-${meta.accent}`)} />
                      <span className={`text-${meta.accent}`}>{meta.label}</span>
                    </div>
                    <div className="text-sm text-white font-medium">{entry.title}</div>
                    <div className="text-xs text-gray-400 mt-1 line-clamp-2">{entry.problem}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <nav className="flex gap-2 flex-wrap" aria-label="Answer sections">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeSection;
          const actual = bySection.get(section.id)?.length ?? 0;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                'border transition-colors',
                isActive
                  ? `bg-${section.accent}/15 text-${section.accent} border-${section.accent}/40`
                  : 'bg-lattice-surface border-lattice-border text-gray-400 hover:text-white hover:border-white/15'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{section.label}</span>
              <span className="text-xs opacity-70">({actual || section.count})</span>
            </button>
          );
        })}
      </nav>

      <div className="border-b border-lattice-border pb-3">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <activeMeta.icon className={cn('h-5 w-5', `text-${activeMeta.accent}`)} />
          {activeMeta.label}
        </h2>
        <p className="text-xs text-gray-400 mt-1">{activeMeta.blurb}</p>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {activeEntries.length === 0 ? (
          <p className="col-span-full text-sm text-gray-400 py-12 text-center">
            No answers in this section yet.
          </p>
        ) : (
          activeEntries.map((entry, i) => (
            <AnswerCard
              key={entry.id}
              entry={entry}
              icon={activeMeta.icon}
              accent={activeMeta.accent}
              index={i}
            />
          ))
        )}
      </section>

      <footer className="mt-10 rounded-xl border border-neon-purple/30 bg-gradient-to-br from-neon-purple/10 via-lattice-surface/80 to-neon-cyan/10 p-6">
        <div className="flex items-start gap-3 mb-4">
          <Sparkles className="h-5 w-5 text-neon-purple mt-0.5" />
          <h3 className="text-lg font-semibold text-white">The Meta-Answer</h3>
        </div>
        <div className="space-y-3 font-mono text-sm text-gray-300 leading-relaxed">
          <p className="text-neon-cyan">Every hard problem reduces to:</p>
          <p className="pl-4 text-white font-semibold">
            A system reaches complexity &gt; control capacity
          </p>
          <div className="pt-2 border-t border-lattice-border space-y-1 text-gray-400">
            <p>Constraint geometry defines the feasibility manifold.</p>
            <p>Only behaviors within the manifold can exist.</p>
            <p>The manifold is defined by mathematics, not policy.</p>
            <p>Mathematics doesn&apos;t drift.</p>
            <p className="text-neon-pink font-semibold pt-2">The constraints are the solution.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
