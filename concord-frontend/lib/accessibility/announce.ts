// concord-frontend/lib/accessibility/announce.ts
//
// F3 — screen-reader announcement formatting (pure, testable). The
// ScreenReaderAnnouncer component reads these into an aria-live region. We
// keep formatting here so phrasing is unit-pinned and consistent.

export type AnnouncePriority = 'polite' | 'assertive';

export interface Announcement {
  text: string;
  priority: AnnouncePriority;
}

/** A world-event socket payload → a concise spoken line (polite). */
export function formatWorldEventAnnouncement(eventKind: string, payload: Record<string, unknown> = {}): Announcement | null {
  const name = (payload.name || payload.title || payload.eventName) as string | undefined;
  switch (eventKind) {
    case 'world:event:scheduled':
      return { text: name ? `Event starting: ${name}` : 'A world event is starting.', priority: 'polite' };
    case 'world:plague-declared':
      return { text: 'A plague has been declared in this world.', priority: 'assertive' };
    case 'world:crisis':
      return { text: name ? `Crisis: ${name}` : 'A crisis is unfolding.', priority: 'assertive' };
    case 'world:crisis-resolved':
      return { text: 'The crisis has been resolved.', priority: 'polite' };
    case 'weather:update': {
      const w = payload.weather as string | undefined;
      return w ? { text: `Weather changing to ${w}.`, priority: 'polite' } : null;
    }
    case 'faction-war:declared':
      return { text: 'War has been declared between factions.', priority: 'assertive' };
    case 'horror:tension': {
      const band = payload.band as string | undefined;
      if (band === 'terror') return { text: 'The presence is right next to you.', priority: 'assertive' };
      if (band === 'tension') return { text: 'Something is close.', priority: 'polite' };
      return null; // calm — nothing to announce
    }
    default:
      return null;
  }
}

/** A combat cue → a spoken line. Defensive cues are assertive (time-critical). */
export function formatCombatCue(cueKind: string, payload: Record<string, unknown> = {}): Announcement | null {
  switch (cueKind) {
    case 'combat:telegraph': {
      const peril = (payload.perilKind as string | undefined) || 'attack';
      const counter = payload.counter as string | undefined;
      const tail = counter ? ` — ${counter} to counter` : '';
      return { text: `Incoming ${peril}${tail}.`, priority: 'assertive' };
    }
    case 'combat:impact': {
      const sev = payload.severity as string | undefined;
      if (sev === 'knockdown') return { text: 'You are knocked down.', priority: 'assertive' };
      if (sev === 'rocked') return { text: 'You are staggered.', priority: 'assertive' };
      return null;
    }
    case 'combat:kill':
      return { text: 'Enemy defeated.', priority: 'polite' };
    case 'combat:parry-success':
      return { text: 'Parry.', priority: 'polite' };
    case 'player:low-health':
      return { text: 'Health critical.', priority: 'assertive' };
    default:
      return null;
  }
}
