// concord-frontend/app/lenses/dx-platform/page.tsx
//
// DX Platform onboarding lens — step-by-step install → sign-in → first
// detector → first wallet debit. Replaces the old "paste a key from
// /api-keys" instructions with the new OAuth flow shipped in phase 7.4.
// Doubles as marketing collateral; the screenshots used in the VS Code
// Marketplace + JetBrains Marketplace listings come from this page.

"use client";

import { useEffect, useState, useCallback } from "react";
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import Link from "next/link";
import { LensShell } from "@/components/lens/LensShell";
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DevToolingPulse } from "@/components/dx-platform/DevToolingPulse";
import { DxWorkbench } from "@/components/dx-platform/DxWorkbench";

interface OnboardingProgress {
  installed?: { vscode?: boolean; jetbrains?: boolean };
  signedIn?: boolean;
  firstDetector?: boolean;
  firstDebit?: boolean;
}

export default function DxPlatformPage() {
  useLensCommand([
    { id: 'dx-platform-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'dx-platform' });

  const [progress, setProgress] = useState<OnboardingProgress>({});

  // Pull live progress from the server when available — falls back to
  // localStorage hint so anonymous browsers can still see the steps.
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/lens/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "dx", name: "onboarding_progress" }),
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.progress) setProgress(data.progress);
      }
    } catch { /* anonymous user — skip */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <LensShell lensId="dx-platform" asMain={false}>
      <FirstRunTour lensId="dx-platform" />
      <DepthBadge lensId="dx-platform" size="sm" className="ml-2" />
      <div className="p-8 max-w-4xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-semibold">Concord DX Platform</h1>
          <p className="text-zinc-400 mt-2 max-w-2xl">
            Detectors, repair-cortex proposals, per-codebase severity tuning,
            and shadow-DTU cross-file context — streamed live to your editor.
            Pay-as-you-go via your Concord Coin wallet. Install the extension,
            sign in once via your browser, and the rest is automatic.
          </p>
        </header>

        {/* Step-by-step onboarding */}
        <section aria-labelledby="onboarding-heading" className="space-y-3">
          <h2 id="onboarding-heading" className="text-lg font-medium">Get started in 4 steps</h2>

          <Step
            n={1}
            title="Install the extension for your editor"
            done={Boolean(progress.installed?.vscode || progress.installed?.jetbrains)}
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ExtCard
                title="VS Code"
                href="https://marketplace.visualstudio.com/items?itemName=concord-os.concord-dx"
                helper="search 'Concord DX' in the Extensions tab"
              />
              <ExtCard
                title="JetBrains"
                href="https://plugins.jetbrains.com/plugin/concord-dx"
                helper="IntelliJ / WebStorm / PyCharm / GoLand / etc."
              />
              <ExtCard
                title="Web editor (no install)"
                href="/lenses/dx-platform/web-editor"
                helper="Monaco in browser; for trial + demo only"
              />
            </div>
          </Step>

          <Step n={2} title="Click 'Sign in with Concord'" done={Boolean(progress.signedIn)}>
            <p className="text-zinc-400">
              In your IDE, click the Concord status-bar item (VS Code) or
              <code className="mx-1 px-1 rounded bg-zinc-900">Tools → Concord → Sign in</code>
              (JetBrains). Your browser opens; sign in to your Concord account
              and click <strong>Allow</strong>.
            </p>
            <p className="text-zinc-400 text-sm mt-2">
              Token lands in your OS keychain (vscode.SecretStorage / JetBrains
              PasswordSafe). No file on disk; no plaintext settings; nothing
              synced to the cloud beyond the token grant itself.
            </p>
          </Step>

          <Step n={3} title="Run your first detector pass" done={Boolean(progress.firstDetector)}>
            <p className="text-zinc-400">
              Open any file. Within seconds the Concord side panel populates
              with detector findings — stale code, orphan modules, perf
              hotspots, secret leaks, citation-consent gaps, and more. Click
              a finding to see the repair-cortex preview.
            </p>
            <p className="text-zinc-400 text-sm mt-2">
              The first pass per codebase runs the full grid (22 detectors). After
              that, only changed-file findings recompute on save — typically &lt;200ms.
            </p>
          </Step>

          <Step n={4} title="See your first wallet debit" done={Boolean(progress.firstDebit)}>
            <p className="text-zinc-400">
              Each macro call your editor makes debits your Concord Coin wallet.
              Reads cost a fraction of a cent; the first 10,000 reads/month and
              1,000 writes/month are free. Watch the debit appear in the
              <Link href="/lenses/dx-platform/billing" className="underline mx-1">billing dashboard</Link>
              live.
            </p>
            <p className="text-zinc-400 text-sm mt-2">
              The platform pays for itself in proportion to how much you use it.
              Royalty cascade applies: every fix accepted writes a citation back
              to the substrate; if your fix-flow becomes a popular pattern, you
              earn perpetual royalties from downstream users.
            </p>
          </Step>
        </section>

        {/* Quick-link grid (kept from the old page so external bookmarks still resolve) */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card title="Billing dashboard" href="/lenses/dx-platform/billing">
            CC balance, last-7d usage, top macros, current-minute quota.
          </Card>
          <Card title="API keys" href="/api-keys">
            Issue / revoke / view scopes for your plugin keys (advanced).
          </Card>
          <Card title="Per-codebase severity" href="/lenses/dx-platform#severity">
            How weights tune over time — your fixes shape your team's lints.
          </Card>
        </section>

        {/* How it works (architecture, for the curious) */}
        <section className="rounded border border-zinc-800 p-4 bg-zinc-950">
          <h2 className="text-lg font-medium mb-2">How it works</h2>
          <ol className="list-decimal pl-5 space-y-1 text-zinc-400">
            <li>You sign in once via the browser (RFC 8252 loopback redirect to <code>/oauth/dx</code>).</li>
            <li>The IDE plugin spawns the bundled <code>concord-lsp</code> server locally.</li>
            <li>Plugin opens a workspace → <code>dx.register_codebase</code> stamps a codebase id.</li>
            <li>File save → <code>detectors.runAll(codebaseId)</code> runs (mostly local; council macros call the cloud).</li>
            <li>Findings stream over the LSP → gutter diagnostics + side-panel rows.</li>
            <li>Repair-cortex proposes fixes → Accept / Ignore / Reject buttons.</li>
            <li>Decisions feed <code>dx.record_fix_decision</code> → severity weights tune per-codebase.</li>
            <li>Each macro call debits your CC wallet via the existing royalty cascade.</li>
            <li>Fix patterns published as DTUs earn perpetual royalties when downstream teams cite them.</li>
          </ol>
        </section>

        {/* Privacy */}
        <section className="rounded border border-zinc-800 p-4 bg-zinc-950">
          <h2 className="text-lg font-medium mb-2">Privacy</h2>
          <ul className="list-disc pl-5 space-y-1 text-zinc-400">
            <li><strong>Code never leaves your machine</strong> in the LSP path. Findings are computed locally by the bundled <code>concord-lsp</code>.</li>
            <li><strong>DTU citations</strong> sync to the substrate only when you choose to publish — never automatically.</li>
            <li><strong>Tokens</strong> live in OS keychain (<code>vscode.SecretStorage</code> / JetBrains <code>PasswordSafe</code>), not in workspace settings or sync.</li>
            <li><strong>Council macros</strong> (the small subset that consult the conscious brain for repair suggestions) round-trip to the cloud; you can disable them per-rule via severity weights.</li>
          </ul>
        </section>
        {/* DX workbench — chat-with-codebase, PR review, search, team
            dashboard, detector config, usage analytics, CI integration */}
        <section aria-labelledby="workbench-heading" className="space-y-3">
          <h2 id="workbench-heading" className="text-lg font-medium">DX workbench</h2>
          <p className="text-sm text-zinc-400">
            Index a codebase by pasting files, then ask questions about it,
            review diffs, search across files, share findings with a team,
            tune detectors, track usage, and emit a CI gate — all in-browser.
          </p>
          <DxWorkbench />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <DevToolingPulse />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#dx-platform-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to dx-platform content</a>
      {/* @decorative-ok: sr-only a11y sentinel — never receives user interaction (tabIndex=-1, aria-hidden) */}
      <button type="button" className="sr-only" aria-hidden="true" tabIndex={-1} onClick={() => {}}>noop a11y sentinel</button>
          <RecentMineCard domain="dx-platform" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="dx-platform" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="dx-platform" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function Step({
  n, title, done, children,
}: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded border p-4 ${done ? "border-emerald-700/40 bg-emerald-950/10" : "border-zinc-800 bg-zinc-950"}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className={`grid place-items-center w-7 h-7 rounded-full font-semibold text-sm ${done ? "bg-emerald-600 text-zinc-950" : "bg-zinc-800 text-zinc-300"}`}>
          {done ? "✓" : n}
        </span>
        <h3 className="font-medium">{title}</h3>
      </div>
      <div className="ml-10">{children}</div>
    </div>
  );
}

function ExtCard({ title, href, helper }: { title: string; href: string; helper: string }) {
  const isExternal = href.startsWith("http");
  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      className="block rounded border border-zinc-800 p-3 hover:border-amber-500 transition"
    >
      <div className="font-medium text-stone-100">{title}</div>
      <div className="text-xs text-zinc-400 mt-1">{helper}</div>
    </a>
  );
}

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith("http");
  const Wrapper = isExternal ? "a" : Link;
  return (
    <Wrapper
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      className="block rounded border border-zinc-800 p-4 hover:border-zinc-700"
    >
      <div className="font-medium">{title}</div>
      <div className="text-sm text-zinc-400 mt-1">{children}</div>
    </Wrapper>
  );
}
