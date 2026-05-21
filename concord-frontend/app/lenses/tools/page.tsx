'use client';

/**
 * Tools Lens — multi-utility surface: live web research, multi-language
 * compile/transpile, and a full multi-party e-signature workflow. Every
 * tab is a real workflow over the `tools` domain macros (tools.research,
 * tools.compile, tools.esign-*) — readable result rendering, per-tool
 * history, and tamper-evident signing with an audit trail.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ToolsRepos } from '@/components/tools/ToolsRepos';
import { WebResearchTool } from '@/components/tools/WebResearchTool';
import { CompileTool } from '@/components/tools/CompileTool';
import { ESignatureTool } from '@/components/tools/ESignatureTool';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, Hammer, FileSignature, type LucideIcon } from 'lucide-react';

type TabKey = 'web' | 'compile' | 'esign';

export default function ToolsLensPage() {
  useLensNav('tools');
  const [activeTab, setActiveTab] = useState<TabKey>('web');

  // Lens-scoped keyboard commands. Single-letter aliases per tool.
  useLensCommand(
    [
      { id: 'goto-web', keys: 'w', description: 'Web research', category: 'navigation', action: () => setActiveTab('web') },
      { id: 'goto-compile', keys: 'c', description: 'Compile / transpile', category: 'navigation', action: () => setActiveTab('compile') },
      { id: 'goto-esign', keys: 's', description: 'E-signature', category: 'navigation', action: () => setActiveTab('esign') },
    ],
    { lensId: 'tools' },
  );

  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'web', label: 'Web research', icon: Globe },
    { key: 'compile', label: 'Compile', icon: Hammer },
    { key: 'esign', label: 'E-signature', icon: FileSignature },
  ];

  return (
    <LensShell lensId="tools" asMain={false}>
      <FirstRunTour lensId="tools" />
      <ManifestActionBar />
      <DepthBadge lensId="tools" size="sm" className="ml-2" />
      <div className="min-h-screen bg-black pb-12 text-yellow-50">
        <header className="sticky top-0 z-10 border-b border-yellow-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Hammer className="h-6 w-6 text-yellow-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Tools</h1>
              <p className="text-xs text-yellow-700">Web research · Compile / build · E-signature</p>
            </div>
          </div>
        </header>

        <nav className="border-b border-yellow-900/30 px-4 md:px-8" aria-label="Tools sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-400 ${
                  activeTab === key ? 'border-yellow-400 text-yellow-200' : 'border-transparent text-yellow-700 hover:text-yellow-400'
                }`}
                aria-pressed={activeTab === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            {activeTab === 'web' && (
              <motion.section key="web" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <WebResearchTool />
              </motion.section>
            )}
            {activeTab === 'compile' && (
              <motion.section key="compile" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <CompileTool />
              </motion.section>
            )}
            {activeTab === 'esign' && (
              <motion.section key="esign" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <ESignatureTool />
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        <section className="mx-auto mt-6 max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ToolsRepos />
        </section>
      </div>

      <RecentMineCard domain="tools" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="tools" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="tools" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
