'use client';

/**
 * CharacterCustomizerPanel — PanelHost wrapper for the existing
 * CharacterCustomizer. Loads the player's persisted slot map via
 * `appearance.load_for_user`, lets them edit, persists via
 * `appearance.save`, and notifies the renderer to rebuild the
 * avatar mesh with the new appearance.
 *
 * Phase E4.
 */

import { useEffect, useState } from 'react';
import { CharacterCustomizer } from '@/components/world/CharacterCustomizer';

export function CharacterCustomizerPanel() {
  const [profile, setProfile] = useState<Record<string, string> | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'appearance', name: 'load_for_user', input: {} }),
    }).then((r) => r.json()).then((j) => {
      const a = j?.result?.appearance;
      if (a?.__slots) setProfile(a.__slots);
      else setProfile({});
    }).catch(() => setProfile({}));
  }, []);

  async function handleSave(slots: Record<string, string>) {
    setStatus('Saving…');
    const appearance = {
      __slots: slots,
      bodyArchetype: slots.body || 'average',
      hairStyle: slots.hair || 'short',
      clothing: {
        top:    { kind: slots.top    || 'shirt', color: '#888' },
        bottom: { kind: slots.bottom || 'pants', color: '#444' },
        boots:  { kind: slots.shoes  || 'boot',  color: '#222' },
      },
      facial: { jawShape: slots.face || 'soft' },
    };
    const r = await fetch('/api/lens/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'appearance', name: 'save', input: { appearance } }),
    });
    const j = await r.json();
    if (j?.result?.ok) {
      setStatus('✓ Saved. Avatar rebuild requested.');
      // Tell the renderer to rebuild the local avatar.
      window.dispatchEvent(new CustomEvent('concordia:appearance-changed', { detail: { scope: 'user' } }));
    } else {
      setStatus(`Failed: ${j?.result?.reason || 'unknown'}`);
    }
    setTimeout(() => setStatus(null), 4000);
  }

  if (!profile) {
    return <p className="text-xs text-zinc-400 italic">Loading current appearance…</p>;
  }

  return (
    <div className="text-sm" data-testid="character-customizer-panel">
      {status && (
        <div role="status" aria-live="polite" className="mb-2 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-1.5 rounded text-xs">
          {status}
        </div>
      )}
      <CharacterCustomizer currentProfile={profile} onSave={handleSave} />
    </div>
  );
}
