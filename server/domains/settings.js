// server/domains/settings.js
// Settings lens domain. The page (concord-frontend/app/lenses/settings)
// renders client-side preferences (quality preset, mouse sensitivity)
// stored locally — but the universal lens pipeline still wants a macro
// to discover the lens and surface it in cross-domain search.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerSettingsActions(registerLensAction) {
  /**
   * list — return the available client preferences and their current
   * server-known defaults. Frontend reads localStorage for the actual
   * stored values; this exists so the macro pipeline returns something.
   */
  registerLensAction("settings", "list", () => {
    return {
      ok: true,
      result: {
        items: [
          { key: "quality_preset", default: "balanced", options: ["potato", "balanced", "high", "ultra"] },
          { key: "mouse_sensitivity", default: 1.0, range: [0.1, 4.0] },
          { key: "audio_volume", default: 0.7, range: [0, 1] },
          { key: "subtitles_enabled", default: false },
          { key: "reduced_motion", default: false },
        ],
      },
    };
  });

  /**
   * applied — surface what the active session has applied (for analytics
   * + admin debug). Pulled from STATE.userPrefs[userId] when available.
   */
  registerLensAction("settings", "applied", (ctx) => {
    const STATE = globalThis._concordSTATE;
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    const prefs = (STATE?.userPrefs ?? {})[userId] ?? {};
    return { ok: true, result: { prefs } };
  });

  // Persistent saved-preference-profile substrate.
  registerLensSubstrate(registerLensAction, "settings", {
    noun: "profile", idPrefix: "prof",
    kinds: ["graphics", "audio", "controls", "accessibility", "general"],
    statuses: ["active", "saved", "archived"],
  });
}
