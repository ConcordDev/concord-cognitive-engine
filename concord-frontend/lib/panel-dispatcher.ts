// concord-frontend/lib/panel-dispatcher.ts
//
// One-liner to summon any registered panel as a modal over the current lens.
// Mirrors the proven event-dispatch pattern used by the world HUD's PanelHost
// (`concordia:panel-open`) and ConKay (`conkay:summon`) — a CustomEvent the
// globally-mounted GlobalPanelHost listens for. Kept dependency-free so any
// component (command palette, a panel, a hotkey) can call it.

/** Event name GlobalPanelHost listens on. Distinct from the world HUD's
 *  `concordia:panel-open` so the two hosts never fight over the same id space. */
export const PANEL_OPEN_EVENT = 'concord:panel-open';
export const PANEL_CLOSE_EVENT = 'concord:panel-close';

export function openPanel(panelId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PANEL_OPEN_EVENT, { detail: { panelId } }));
}

export function closePanel(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PANEL_CLOSE_EVENT));
}
