'use client';

/**
 * Plugin Gallery lens: REST-backed surface for `/api/plugins/gallery/*`
 * (`server/lib/plugin-gallery.js`): signed, install-counted, rated plugin
 * packages with a real capability-disclosure consent step before install.
 *
 * Not the same subsystem as `components/world-lens/LensPluginSystem.tsx`
 * (mounted in `app/lenses/system/page.tsx`), which is fed by the older
 * `/api/plugins` developer-sdk loader. Do not merge them.
 */

import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { PluginGalleryList } from '@/components/plugins/PluginGalleryList';
import { Search } from 'lucide-react';

function focusGallerySearch() {
  const el = document.querySelector<HTMLInputElement>('[aria-label="Plugin Gallery"] input[type="search"], [aria-label="Plugin Gallery"] input[type="text"]');
  el?.focus();
}

export default function PluginsPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  useLensCommand(
    [{ id: 'plugins-search', keys: '/', description: 'Search the gallery', category: 'navigation' as const, action: focusGallerySearch }],
    { lensId: 'plugins' },
  );

  return (
    <LensShell lensId="plugins" asMain={false}>
      <FirstRunTour lensId="plugins" />
      <DepthBadge lensId="plugins" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="plugins"
        crumb="Plugins"
        title={who ? `Extend Concord, ${who}` : 'Extend Concord'}
        subtitle="Signed, browsable plugin packages with real capability disclosure before every install."
        cta={{ label: 'Search plugins', icon: Search, onClick: focusGallerySearch, title: 'Focus the gallery search' }}
      >
        <section aria-label="Plugin Gallery">
          <PluginGalleryList />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
