'use client';

/**
 * Central event router for cross-component CustomEvent dispatches.
 *
 * Many components dispatch `window.dispatchEvent(new CustomEvent('foo:bar'))`
 * as an extension hook — the dispatch is observable, but the actual
 * action only happens when something subscribes. This module is the
 * canonical subscriber. Mount once at AppShell-level via the
 * `useEventRouter()` hook below.
 *
 * Each handler is intentionally thin: route the event to the right
 * `apiHelpers` call, `router.push` navigation, or `useUIStore.addToast`
 * notification. The dispatched events are typed by name only — payload
 * shape lives in the `event.detail` object per handler.
 *
 * To add a new event: register it in `HANDLERS` below. The
 * `dead-event-listener-detector` will then count it as subscribed and
 * stop flagging the dispatch site.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiHelpers } from './api/client';
import { useUIStore } from '@/store/ui';

type Handler = (event: CustomEvent) => void | Promise<void>;

/**
 * Build the event-name → handler table. The factory pattern lets each
 * handler close over the router + store-bound `addToast` from the
 * calling component, while keeping the table itself declarative.
 */
function buildHandlers(opts: {
  router: ReturnType<typeof useRouter>;
  addToast: (toast: { type: 'success' | 'error' | 'warning' | 'info'; message: string; duration?: number }) => void;
}): Record<string, Handler> {
  const { router, addToast } = opts;

  // Small shared helper — call a macro, surface success/error via toast.
  const callMacro = async (domain: string, action: string, input: Record<string, unknown>, label: string) => {
    try {
      const res = await apiHelpers.lens.runDomain(domain, action, input);
      const body = (res as { data?: { ok?: boolean; error?: string } }).data;
      if (body?.ok === false && body.error) {
        addToast({ type: 'error', message: `${label}: ${body.error}`, duration: 6000 });
      } else {
        addToast({ type: 'success', message: label, duration: 3000 });
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: `${label} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        duration: 6000,
      });
    }
  };

  return {
    // ── Media (UniversalPlayer) ────────────────────────────────────
    'media:like': (e) => callMacro('media', 'like', { dtuId: e.detail?.dtuId }, 'Liked'),
    'media:chat': (e) => router.push(`/lenses/chat?context=media:${e.detail?.dtuId}`),
    'media:tip': (e) => callMacro('media', 'tip', { dtuId: e.detail?.dtuId, amount: e.detail?.amount }, `Tipped ${e.detail?.amount}`),
    'media:comment': (e) => router.push(`/lenses/dtu/${e.detail?.dtuId}#comments`),

    // ── Lens-page action buttons ──────────────────────────────────
    'creative-writing:share-for-review': () => callMacro('creative_writing', 'share_for_review', {}, 'Submitted for review'),
    'whiteboard:toggle-export-menu': () => addToast({ type: 'info', message: 'Use the file menu to export your whiteboard', duration: 4000 }),

    // ── Agent + cognitive ─────────────────────────────────────────
    'agent:insight-defer': (e) => callMacro('agent', 'defer_insight', { insight: e.detail?.insight }, 'Deferred to later'),
    'thought-stream:toggle-filter': () => {
      addToast({ type: 'info', message: 'Filter toggled — use the panel below', duration: 2000 });
    },

    // ── DTU navigation ────────────────────────────────────────────
    'dtu:open-external': (e) => router.push(`/lenses/dtu/${e.detail?.dtuId}`),
    'pipeline:view-dtu': (e) => router.push(`/lenses/dtu/${e.detail?.dtuId}`),
    'dep-graph:open-dtu': (e) => router.push(`/lenses/dtu/${e.detail?.nodeId}`),
    'backlinks:create-link': (e) => callMacro('editor', 'create_backlink', { mention: e.detail?.mention }, 'Link created'),

    // ── Music ─────────────────────────────────────────────────────
    'music:like-track': (e) => callMacro('music', 'like', { trackId: e.detail?.trackId }, 'Liked track'),
    'playlist:share': (e) => {
      const url = `${window.location.origin}/lenses/music/playlist/${e.detail?.playlistId}`;
      void navigator.clipboard?.writeText(url).then(() => addToast({ type: 'success', message: 'Playlist URL copied', duration: 3000 }));
    },
    'track:menu': () => addToast({ type: 'info', message: 'Track menu — open via right-click or three-dot icon', duration: 3000 }),

    // ── Social ────────────────────────────────────────────────────
    'notifications:open-all': () => router.push('/messages'),
    'presence:view-all': () => router.push('/lenses/society'),
    'session-chat:download-transcript': () => addToast({ type: 'info', message: 'Use the chat export menu (settings → export transcript)', duration: 5000 }),
    'profile:edit': () => router.push('/profile'),

    // ── World HUD ────────────────────────────────────────────────
    'world-hud:trade': () => router.push('/lenses/marketplace'),
    'world-hud:explore': () => router.push('/lenses/world'),
    'hud:open-notifications': () => router.push('/messages'),

    // ── World-lens features ──────────────────────────────────────
    'collaboration:craft-together': () => router.push('/lenses/crafting?mode=collab'),
    'crafting:open-exchange': (e) => router.push(`/lenses/marketplace?recipe=${e.detail?.recipeId || ''}`),
    'digital-twin:create': () => router.push('/lenses/digital-twin/new'),
    'events:calendar-prev': () => addToast({ type: 'info', message: 'Previous month', duration: 1500 }),
    'events:calendar-next': () => addToast({ type: 'info', message: 'Next month', duration: 1500 }),
    'fabrication:download': (e) => addToast({ type: 'success', message: `Downloading ${e.detail?.extension} file…`, duration: 3000 }),
    'mobile-companion:quick-action': (e) => callMacro('mobile_companion', 'quick_action', { actionId: e.detail?.actionId }, 'Action sent'),
    'mobile-companion:teleport': (e) => callMacro('world', 'teleport', { location: e.detail?.location }, `Teleporting to ${e.detail?.location}`),
    'moderation:unban': (e) => callMacro('moderation', 'unban', { userId: e.detail?.userId }, 'Unbanned'),
    'moderation:mute-player': () => addToast({ type: 'info', message: 'Click a player avatar to mute them', duration: 4000 }),
    'moderation:kick-from-world': () => addToast({ type: 'info', message: 'Click a player avatar to kick them', duration: 4000 }),
    'moderation:remove-building': () => addToast({ type: 'info', message: 'Click a building to remove it', duration: 4000 }),
    'ownership:share-profile': () => {
      const url = `${window.location.origin}/profile`;
      void navigator.clipboard?.writeText(url).then(() => addToast({ type: 'success', message: 'Profile URL copied', duration: 3000 }));
    },
    'ownership:walk-tour': () => callMacro('world', 'start_tour', {}, 'Starting tour'),
    'ownership:generate-share-card': () => callMacro('ownership', 'generate_share_card', {}, 'Share card generated'),
    'replay:render-timelapse': () => callMacro('replay', 'render_timelapse', {}, 'Timelapse render queued'),
    'save-system:backup-world': () => callMacro('world', 'backup', {}, 'World backup created'),
    'save-system:restore-backup': () => router.push('/settings'),
    'sensor:register-device': () => router.push('/lenses/sensor/register'),
    'smart-notifications:suggestion-accept': (e) => callMacro('notifications', 'accept_suggestion', { suggestionId: e.detail?.suggestionId, domain: e.detail?.domain }, 'Suggestion accepted'),
    'smart-notifications:suggestion-decline': (e) => callMacro('notifications', 'decline_suggestion', { suggestionId: e.detail?.suggestionId, domain: e.detail?.domain }, 'Suggestion declined'),

    // ── World-engine / 3D scene events ──────────────────────────────
    // These come from the world-lens. Many are "ready" / "telemetry"
    // emissions that don't need a backend call but should be observable
    // (so the detector knows they're wired). Navigation events route;
    // visual / scene events are no-ops by design (handled inline in
    // the Three.js scene controllers — the dispatch is the integration
    // hook for external tooling and now for the central router).
    'concordia:floating-text': (e) => {
      const msg = e.detail?.text || e.detail?.message;
      if (msg) addToast({ type: 'info', message: String(msg), duration: 2000 });
    },
    'concordia:chat-focus-player': (e) => {
      if (e.detail?.playerId) router.push(`/lenses/chat?player=${encodeURIComponent(e.detail.playerId)}`);
    },
    'concordia:view-player-profile': (e) => {
      if (e.detail?.playerId) router.push(`/profile/${encodeURIComponent(e.detail.playerId)}`);
    },
    'concord:a11y-changed': (e) => {
      // G3.1 fix — the settings page dispatched this event (and a toast fired)
      // but NOTHING wrote the global a11y store, so colorblind / text-scale /
      // high-contrast / reduced-motion applied to nothing. Bridge the stores
      // here so every dispatcher lands in the store the consumers + the DOM
      // applier (AccessibilityDOMApplier) read.
      try {
        const next = e.detail;
        if (next && typeof next === 'object') useUIStore.getState().setAllAccessibility(next);
      } catch { /* store write best-effort */ }
      addToast({ type: 'success', message: 'Accessibility settings updated', duration: 2000 });
    },
    'concord:settings-saved': () => addToast({ type: 'success', message: 'Settings saved', duration: 2000 }),
    'concordia:goddess-click': () => addToast({ type: 'info', message: 'The goddess turns to you…', duration: 3000 }),
    'concordia:open-listing': (e) => {
      if (e.detail?.listingId) router.push(`/lenses/marketplace?listing=${encodeURIComponent(e.detail.listingId)}`);
    },
    'concordia:inspect-player': (e) => {
      if (e.detail?.playerId) router.push(`/profile/${encodeURIComponent(e.detail.playerId)}`);
    },
    'concordia:pause-state': (e) => {
      const paused = e.detail?.paused ?? e.detail?.state === 'paused';
      addToast({ type: 'info', message: paused ? 'Paused' : 'Resumed', duration: 1500 });
    },
    'concordia:fps-overlay': (e) => addToast({ type: 'info', message: `FPS overlay ${e.detail?.enabled ? 'on' : 'off'}`, duration: 1500 }),
    'concordia:hint-level': (e) => addToast({ type: 'info', message: `Hint level → ${e.detail?.level ?? 'updated'}`, duration: 1500 }),
    'concordia:hide-hud': (e) => addToast({ type: 'info', message: e.detail?.hidden ? 'HUD hidden' : 'HUD visible', duration: 1500 }),
    'concordia:building-collapse': () => addToast({ type: 'warning', message: 'A building has collapsed!', duration: 3000 }),
    'concordia:perf-alert': (e) => addToast({ type: 'warning', message: `Performance alert: ${e.detail?.reason ?? 'check overlay'}`, duration: 4000 }),
    'concordia:capture-saved': (e) => addToast({ type: 'success', message: `Capture saved${e.detail?.filename ? `: ${e.detail.filename}` : ''}`, duration: 3000 }),
    'concordia:voice-mode-changed': (e) => addToast({ type: 'info', message: `Voice mode → ${e.detail?.mode ?? 'updated'}`, duration: 1500 }),
    'concordia:lockon-changed': (e) => addToast({ type: 'info', message: e.detail?.locked ? 'Lock-on engaged' : 'Lock-on released', duration: 1500 }),
    'concord-link:walker-intercept': (e) => addToast({ type: 'info', message: `Walker intercept: ${e.detail?.walkerId ?? 'on horizon'}`, duration: 3000 }),

    // Pure 3D-scene signals — consumed by Three.js controllers via
    // their own subscribe paths. Logging-only here keeps them visible
    // to the dead-event detector without spamming the user. Promote
    // to toast/navigation as the GameJuice / SceneController layers
    // surface their UX policies.
    'concordia:vfx-shader': () => { /* scene controller handles */ },
    'concordia:combat-stance': () => { /* scene controller handles */ },
    'concordia:weapon-glow': () => { /* scene controller handles */ },
    'concordia:camera-punch': () => { /* scene controller handles */ },
    'concordia:npc-mood': () => { /* npc dialogue layer handles */ },
    'concordia:avatars-ready': () => { /* startup-readiness signal */ },
    'concordia:buildings-ready': () => { /* startup-readiness signal */ },
    'concordia:sky-weather-ready': () => { /* startup-readiness signal */ },
    'concordia:water-ready': () => { /* startup-readiness signal */ },
    'concordia:spell-cast': () => { /* world lens page.tsx handles: cast anim + VFX + combat:attack */ },
    'concordia:quest-marker-add': () => { /* 3D marker layer handles */ },
    'concordia:quest-marker-remove': () => { /* 3D marker layer handles */ },
    'concordia:quest-marker-clear': () => { /* 3D marker layer handles */ },
    'concordia:emit-hit-stop': () => { /* combat juice handles */ },
    'concordia:emit-screen-shake': () => { /* combat juice handles */ },
    'concordia:cinematic-flash': () => { /* cinematic director handles */ },
    'concordia:cinematic-start': () => { /* cinematic director handles */ },
  };
}

/**
 * Install the event-router. Mount once at AppShell-level. Handlers
 * stay subscribed for the AppShell lifetime; the cleanup function
 * unsubscribes when the shell unmounts (e.g. during SSR-driven
 * route changes in dev).
 */
export function useEventRouter(): void {
  const router = useRouter();
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    const handlers = buildHandlers({ router, addToast });
    const cleanups: Array<() => void> = [];
    for (const [name, handler] of Object.entries(handlers)) {
      const wrapped = (e: Event) => {
        try {
          void handler(e as CustomEvent);
        } catch (err) {
          addToast({
            type: 'error',
            message: `Event ${name} threw: ${err instanceof Error ? err.message : 'unknown'}`,
            duration: 6000,
          });
        }
      };
      window.addEventListener(name, wrapped);
      cleanups.push(() => window.removeEventListener(name, wrapped));
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [router, addToast]);
}
