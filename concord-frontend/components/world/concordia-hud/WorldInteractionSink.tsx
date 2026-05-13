'use client';

/**
 * WorldInteractionSink — every click registers.
 *
 * Fallout-style immersion principle: if a player can see and reach
 * something, clicking it must produce a real response. No silent
 * dead pixels. If we don't have a specific handler for the thing the
 * player clicked, we still emit an "ambient touch" feedback (toast +
 * sparkle hint via concordia:ambient-touch CustomEvent) so the player
 * always knows the click was registered.
 *
 * Architecture:
 *   - Listens for `concordia:world-click` CustomEvent (dispatched by
 *     ConcordiaScene raycaster on every pointerdown that hits world
 *     geometry — including walls, floors, props that have no
 *     specific handler).
 *   - Routes by detail.kind: npc → dialogue, vehicle → mount, hook →
 *     pickup, building → enter, loot_container → loot, generic →
 *     ambient touch.
 *   - Every click also fires `concordia:interaction-recorded` for
 *     audit + AdaptiveComplexity signal recording.
 *
 * The sink intentionally double-covers: even if a downstream handler
 * already exists, this layer guarantees that NO click goes silent.
 * Existing handlers can mark their CustomEvent detail with
 * `handled: true` to skip the ambient-touch fallback.
 */

import { useEffect } from 'react';

type ClickKind =
  | 'npc' | 'vehicle' | 'hook' | 'building' | 'loot_container'
  | 'door' | 'workbench' | 'sign' | 'item_ground' | 'terrain' | 'wall' | 'water'
  | 'unknown';

interface WorldClickDetail {
  kind: ClickKind;
  id?: string;
  label?: string;
  position?: { x: number; y: number; z: number };
  worldPos?: { x: number; y: number; z: number };
  screenPos?: { x: number; y: number };
  handled?: boolean;
}

async function macroCall(domain: string, name: string, input: Record<string, unknown> = {}) {
  try {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name, input }),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const AMBIENT_TOUCH_LABELS: Record<ClickKind, string> = {
  terrain:        'You brush the ground.',
  wall:           'You touch the wall — solid stone.',
  water:          'Ripples spread from your fingertips.',
  sign:           'A weathered sign — letters too faded to read.',
  door:           'The door is locked.',
  workbench:      'Tools laid out neatly. Not yours.',
  item_ground:    'Just dirt and leaves.',
  building:       'You knock — no answer.',
  loot_container: 'Empty.',
  hook:           'A small folded paper. Could be evidence.',
  vehicle:        'Idle, no driver.',
  npc:            'They glance at you.',
  unknown:        'Nothing happens.',
};

function ambientToast(label: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('concordia:toast', { detail: { message: label, kind: 'ambient', ttl_ms: 2000 } }));
}

function ambientSparkle(screenPos?: { x: number; y: number }) {
  if (typeof window === 'undefined' || !screenPos) return;
  window.dispatchEvent(new CustomEvent('concordia:ambient-sparkle', { detail: { x: screenPos.x, y: screenPos.y } }));
}

export function WorldInteractionSink() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function onWorldClick(e: Event) {
      const detail = (e as CustomEvent<WorldClickDetail>).detail;
      if (!detail) return;

      // Record the interaction (audit + AdaptiveComplexity signal).
      window.dispatchEvent(new CustomEvent('concordia:interaction-recorded', {
        detail: { kind: detail.kind, id: detail.id, at: Date.now() },
      }));

      // Try a specific handler first.
      let handled = !!detail.handled;
      if (!handled) {
        try {
          handled = routeSpecificHandler(detail);
        } catch { handled = false; }
      }

      // If nothing specific fired, give ambient feedback so the player
      // never feels like the click went nowhere.
      if (!handled) {
        const label = detail.label || AMBIENT_TOUCH_LABELS[detail.kind] || AMBIENT_TOUCH_LABELS.unknown;
        ambientToast(label);
        ambientSparkle(detail.screenPos);
      }
    }

    window.addEventListener('concordia:world-click', onWorldClick);
    return () => window.removeEventListener('concordia:world-click', onWorldClick);
  }, []);

  return null;
}

function routeSpecificHandler(detail: WorldClickDetail): boolean {
  switch (detail.kind) {
    case 'npc':
      if (detail.id) {
        // Dispatch a standard event the dialogue path already listens for.
        window.dispatchEvent(new CustomEvent('concordia:open-dialogue', { detail: { npcId: detail.id } }));
        return true;
      }
      return false;
    case 'vehicle':
      if (detail.id) {
        void macroCall('vehicles', 'mount', { vehicleId: detail.id });
        return true;
      }
      return false;
    case 'hook':
      if (detail.id) {
        void macroCall('hooks', 'pickup', { hookId: detail.id });
        ambientToast('Picked up.');
        return true;
      }
      return false;
    case 'building':
      if (detail.id) {
        window.dispatchEvent(new CustomEvent('concordia:enter-building', { detail: { buildingId: detail.id } }));
        return true;
      }
      return false;
    case 'door':
      if (detail.id) {
        // Doors with handlers get fired here; doors without remain locked
        // → falls through to ambient "locked" feedback.
        window.dispatchEvent(new CustomEvent('concordia:open-door', { detail: { doorId: detail.id } }));
        return true;
      }
      return false;
    case 'loot_container':
      if (detail.id) {
        window.dispatchEvent(new CustomEvent('concordia:open-loot', { detail: { containerId: detail.id } }));
        return true;
      }
      return false;
    case 'sign':
      if (detail.id) {
        window.dispatchEvent(new CustomEvent('concordia:read-sign', { detail: { signId: detail.id } }));
        return true;
      }
      return false;
    case 'workbench':
      if (detail.id) {
        window.dispatchEvent(new CustomEvent('concordia:open-workbench', { detail: { workbenchId: detail.id } }));
        return true;
      }
      return false;
    case 'item_ground':
      if (detail.id) {
        window.dispatchEvent(new CustomEvent('concordia:pickup-item', { detail: { itemId: detail.id } }));
        return true;
      }
      return false;
    case 'terrain':
    case 'wall':
    case 'water':
    case 'unknown':
    default:
      return false;
  }
}

/**
 * Helper for ConcordiaScene + 3D click handlers — call this to emit a
 * world click. Marks unhandled clicks so they ALWAYS get ambient feedback.
 *
 * Use from raycast hit handlers:
 *   dispatchWorldClick({ kind: 'wall', screenPos: { x: ev.clientX, y: ev.clientY } });
 */
export function dispatchWorldClick(detail: WorldClickDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('concordia:world-click', { detail }));
}
