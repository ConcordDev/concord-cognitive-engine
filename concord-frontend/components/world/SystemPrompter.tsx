'use client';

/**
 * The "[System]" contextual prompter — a small diegetic panel that tells the
 * player what they can do RIGHT NOW, ranked by relevance. Listens for
 * concordia:context-update (the world page publishes the player's current
 * context) and renders the resolved affordances. The newcomer never wonders
 * "what do I do here"; the System answers. KS via the absence of context events.
 */

import { useEffect, useState } from 'react';
import { resolveAffordances, type Affordance, type PlayerContext } from '@/lib/concordia/system-affordances';

export default function SystemPrompter() {
  const [affordances, setAffordances] = useState<Affordance[]>([]);

  useEffect(() => {
    function onContext(e: Event) {
      const ctx = (e as CustomEvent).detail as PlayerContext | undefined;
      setAffordances(resolveAffordances(ctx || {}).slice(0, 4));
    }
    window.addEventListener('concordia:context-update', onContext);
    return () => window.removeEventListener('concordia:context-update', onContext);
  }, []);

  if (affordances.length === 0) return null;

  function fire(a: Affordance) {
    window.dispatchEvent(new CustomEvent(a.verb, { detail: { source: 'system-prompter' } }));
  }

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 96, zIndex: 40, maxWidth: 280,
      background: 'rgba(12,12,20,0.82)', border: '1px solid rgba(120,160,220,0.35)',
      borderRadius: 10, padding: '10px 12px', backdropFilter: 'blur(4px)', color: '#dfe6f0',
      fontFamily: 'ui-monospace, monospace', fontSize: 13,
    }}>
      <div style={{ color: '#7fa8e0', fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>[ SYSTEM ]</div>
      {affordances.map((a) => (
        <button key={a.verb + a.label} onClick={() => fire(a)}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
            border: 'none', color: '#dfe6f0', cursor: 'pointer', padding: '4px 0' }}>
          <span style={{ color: '#9fd', fontWeight: 700, marginRight: 8 }}>[{a.key}]</span>
          <span style={{ fontWeight: 600 }}>{a.label}</span>
          <span style={{ display: 'block', opacity: 0.6, fontSize: 11, marginLeft: 28 }}>{a.why}</span>
        </button>
      ))}
    </div>
  );
}
