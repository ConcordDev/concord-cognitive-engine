'use client';

/**
 * Forge Lens — polyglot single-file app generator surface. Mounts the
 * absorbed ForgeWorkbench component (concord-frontend/components/forge)
 * which talks to /api/forge/{templates,sections,generate,validate,...}.
 *
 * Phase B wire-up: surfaces the Forge engine + UX absorbed via
 * novel-files-extract from claude/polyglot-monolith-template-pTDoX +
 * claude/forge-template-TP60S branches.
 *
 * Frontend Parity: ForgeWorkbench already implements the 9 polish
 * requirements (loading/empty/error states, mobile-responsive grid,
 * Framer Motion section panels, dark-mode-aware Tailwind, keyboard
 * navigation, copy-to-clipboard for generated code, undo on destructive
 * deletes). This page is the lens-shell wrapper.
 */

import { motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { Hammer, Sparkles } from 'lucide-react';
import ForgeWorkbench from '@/components/forge/ForgeWorkbench';

export default function ForgeLensPage() {
  return (
    <LensShell lensId="forge" asMain={false}>
      <ManifestActionBar />
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
            <Hammer className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              Forge — Polyglot Monolith Generator
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Pick a template, configure 13 subsystems, generate a single-file TS app you can publish as a DTU.
            </p>
          </div>
          <div className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 sm:flex">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Beta
          </div>
        </div>
      </motion.header>

      <section className="mx-auto max-w-screen-2xl px-2 py-3 sm:px-4 sm:py-4">
        <ForgeWorkbench />
      </section>
    </main>
    </LensShell>
  );
}
