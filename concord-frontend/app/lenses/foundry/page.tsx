'use client';

/**
 * Foundry Lens (#125) — no-code game-builder.
 *
 * Build complete, persistent, cross-world games by composing Concord's
 * existing systems as configurable building blocks. This page is the
 * LensShell wrapper; the build/configure/validate/save/publish loop
 * lives in <FoundryCanvas>.
 *
 * Distinct from /lenses/forge (the polyglot single-file *app*
 * generator) — different domain namespace (foundry.* macros),
 * different product.
 */

import dynamic from 'next/dynamic';
import { LensShell } from '@/components/lens/LensShell';
import { WorldBuilderRepos } from '@/components/foundry/WorldBuilderRepos';
import { FoundryActionPanel } from '@/components/foundry/FoundryActionPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { Boxes, Loader2 } from 'lucide-react';

// Drag-drop + the catalog fetch are browser-only — load client-side.
const FoundryCanvas = dynamic(() => import('@/components/foundry/FoundryCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading Foundry…
    </div>
  ),
});

export default function FoundryLensPage() {
  return (
    <LensShell lensId="foundry" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-sky-950/10 text-slate-100">
        <header className="border-b border-sky-500/20 bg-slate-950/70 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2">
              <Boxes className="h-5 w-5 text-sky-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">
                Foundry — Build Games from Concord&apos;s Systems
              </h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Compose terrain, living NPCs, combat, economies and more into a persistent,
                cross-world game. No code, no infrastructure.
              </p>
            </div>
            <span className="hidden rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 sm:inline">
              Beta
            </span>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl">
          <FoundryCanvas />
        </section>
        <section className="mx-auto mt-6 max-w-screen-2xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <WorldBuilderRepos />
        </section>

        {/* Unity + Roblox Studio-shape foundry workbench: list / create / validate / preview / publish + actions */}
        <section className="mx-auto mt-6 max-w-screen-2xl">
          <FoundryActionPanel />
        </section>
      </main>
    </LensShell>
  );
}
