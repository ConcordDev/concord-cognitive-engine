'use client';

/**
 * ScreenReaderAnnouncer — F3.
 *
 * Two aria-live regions (polite + assertive) that voice world-event and
 * combat cues for screen-reader users. Gated on the a11y `screenReader`
 * setting. Listens to the world socket events bridged to window events plus
 * a generic `concordia:announce` escape hatch.
 *
 * Mount once in the world lens. The 11 existing HUD aria-live regions stay;
 * this adds the world-event + combat coverage the audit found missing.
 */

import { useEffect, useRef, useState } from 'react';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import { formatWorldEventAnnouncement, formatCombatCue, type Announcement } from '@/lib/accessibility/announce';

const WORLD_EVENTS = [
  'world:event:scheduled', 'world:plague-declared', 'world:crisis', 'world:crisis-resolved',
  'weather:update', 'faction-war:declared', 'horror:tension',
];
const COMBAT_CUES = [
  'combat:telegraph', 'combat:impact', 'combat:kill', 'combat:parry-success', 'player:low-health',
];

export default function ScreenReaderAnnouncer() {
  const a11y = useAccessibilitySettings();
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const enabledRef = useRef(false);
  enabledRef.current = !!a11y.screenReader;

  useEffect(() => {
    function speak(ann: Announcement | null) {
      if (!ann || !enabledRef.current) return;
      // Toggle a trailing space vs the PREVIOUS value so identical consecutive
      // messages still change the text node, forcing a re-announce (screen
      // readers ignore unchanged live-region text).
      const setter = ann.priority === 'assertive' ? setAssertive : setPolite;
      setter((prev) => (prev.endsWith(' ') ? ann.text : ann.text + ' '));
    }

    const handlers: Array<[string, (e: Event) => void]> = [];
    for (const kind of WORLD_EVENTS) {
      const h = (e: Event) => speak(formatWorldEventAnnouncement(kind, ((e as CustomEvent).detail as Record<string, unknown>) || {}));
      const name = `concordia:${kind.replace(/:/g, '-')}`;
      window.addEventListener(name, h);
      handlers.push([name, h]);
    }
    for (const kind of COMBAT_CUES) {
      const h = (e: Event) => speak(formatCombatCue(kind, ((e as CustomEvent).detail as Record<string, unknown>) || {}));
      const name = `concordia:${kind.replace(/:/g, '-')}`;
      window.addEventListener(name, h);
      handlers.push([name, h]);
    }
    // Generic escape hatch: { text, priority }.
    const generic = (e: Event) => {
      const d = (e as CustomEvent).detail as Announcement | undefined;
      if (d?.text) speak({ text: d.text, priority: d.priority || 'polite' });
    };
    window.addEventListener('concordia:announce', generic);
    handlers.push(['concordia:announce', generic]);

    return () => { for (const [name, h] of handlers) window.removeEventListener(name, h); };
  }, []);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="sr-polite">{polite}</div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="sr-assertive">{assertive}</div>
    </>
  );
}
