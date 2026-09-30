'use client';

/**
 * Plugin Gallery Lens
 *
 * The real, first-ever frontend surface for `/api/plugins/gallery/*`
 * (`server/lib/plugin-gallery.js`, hardened this session — commits
 * `fcc57f96` / `f6a0f25b`): browse signed, install-counted, rated plugin
 * packages; a real per-plugin capability-disclosure consent step BEFORE
 * install (`PluginInstallConsent`); honest trust language (self-attested,
 * not independently reviewed).
 *
 * NOT the same subsystem as `components/world-lens/LensPluginSystem.tsx`
 * (mounted in `app/lenses/system/page.tsx`), which is fed by the older,
 * unrelated `/api/plugins` emergent/developer-sdk loader. Do not merge them.
 *
 * REST-backed by design (same posture as `/lenses/ops-telemetry`,
 * `/lenses/world-observatory`, `/lenses/concord-link-frontier`) — there is
 * no `plugins` macro domain backing this route family, so the components
 * below call the real HTTP routes directly with `credentials: 'include'`.
 */

import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Package } from 'lucide-react';
import { PluginGalleryList } from '@/components/plugins/PluginGalleryList';

export default function PluginsPage() {
  useLensCommand([], { lensId: 'plugins' });

  return (
    <LensShell lensId="plugins" asMain={false}>      <DepthBadge lensId="plugins" size="sm" className="ml-2" />
      <main
        aria-label="Plugin Gallery"
        className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100"
      >
        <header className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
              <Package className="h-5 w-5 text-cyan-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Plugin Gallery</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Signed, browsable plugin packages — real capability disclosure before every install.
              </p>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          <PluginGalleryList />
        </section>
      </main>
    </LensShell>
  );
}
