'use client';

/**
 * /onboarding/character — Phase E3
 *
 * After the universe step, new players land here to create their
 * character. Mounts the orphaned CharacterCustomizer.tsx + persists
 * via appearance.save macro. After save, navigates to /lenses/world.
 *
 * Players can re-edit later via PanelHost panel 'character-customizer'
 * (registered in Phase G).
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CharacterCustomizer } from '@/components/world/CharacterCustomizer';

export default function CharacterOnboardingPage() {
  const router = useRouter();
  const [initialProfile, setInitialProfile] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load any existing appearance so returning users don't reset.
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'appearance', name: 'load_for_user', input: {} }),
    }).then((r) => r.json()).then((j) => {
      const a = j?.result?.appearance;
      if (a && typeof a === 'object') {
        // Project from RichAppearanceConfig back to the customiser's
        // slot/assetId map (lossy but workable).
        setInitialProfile({
          body: a.bodyArchetype || 'average',
          hair: a.hairStyle || 'short',
          face: a.facial?.jawShape || 'soft',
          top: a.clothing?.top?.kind || 'shirt',
          bottom: a.clothing?.bottom?.kind || 'pants',
          shoes: a.clothing?.boots?.kind || 'boot',
        });
      } else {
        setInitialProfile({});
      }
    }).catch(() => setInitialProfile({}));
  }, []);

  async function handleSave(profile: Record<string, string>) {
    setSaving(true);
    setError(null);
    // Wrap the slot profile in a RichAppearance-like envelope for
    // persistence. The renderer reads either the slot map (legacy)
    // or the rich config; this preserves backward compat.
    const appearance = {
      __slots: profile,
      bodyArchetype: profile.body || 'average',
      hairStyle: profile.hair || 'short',
      clothing: {
        top:    { kind: profile.top    || 'shirt', color: '#888' },
        bottom: { kind: profile.bottom || 'pants', color: '#444' },
        boots:  { kind: profile.shoes  || 'boot',  color: '#222' },
      },
      facial: { jawShape: profile.face || 'soft' },
    };
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'appearance', name: 'save', input: { appearance } }),
      });
      const j = await r.json();
      if (j?.result?.ok) {
        router.push('/lenses/world');
      } else {
        setError(j?.result?.reason || 'save_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setSaving(false);
    }
  }

  if (!initialProfile) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <p className="text-sm text-zinc-400">Loading character creator…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-amber-200 mb-1">Forge your character</h1>
          <p className="text-sm text-zinc-400">
            Pick how you appear in-world. Re-editable later from the World HUD.
          </p>
        </header>
        {error && (
          <div className="mb-4 rounded border border-red-700/60 bg-red-950/50 text-red-200 px-3 py-2 text-xs">
            Save failed: {error}
          </div>
        )}
        <CharacterCustomizer
          currentProfile={initialProfile}
          onSave={handleSave}
        />
        {saving && (
          <div className="mt-4 text-xs text-amber-300">Saving + entering world…</div>
        )}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => router.push('/lenses/world')}
            className="text-xs text-zinc-400 hover:text-zinc-200 underline"
          >
            Skip — enter world with default appearance
          </button>
        </div>
      </div>
    </main>
  );
}
