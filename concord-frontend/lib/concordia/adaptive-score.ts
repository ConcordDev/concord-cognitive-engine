// lib/concordia/adaptive-score.ts
//
// Generative-adaptive scoring: the world's emergent socket events recolor the
// music in real time — the war that ERUPTS, the crisis that RESOLVES, the scheme
// that lands. A fixed score can't anticipate emergent beats; a generative one
// keyed to live signals can. This is the PURE mapping (event → soundscape
// directive); the React `AdaptiveScoreBridge` subscribes to the sockets and
// dispatches each directive as a `concordia:soundscape-command` window event,
// which SoundscapeEngine already routes to setMusicCombatIntensity / setMusicMode.
// Behind CONCORD_ADAPTIVE_SCORE at the bridge. Pure + headless-testable.

export type MusicMode = "minor" | "major" | "neutral";

export interface SoundscapeDirective {
  action: "setMusicCombatIntensity" | "setMusicMode";
  intensity?: number;     // for setMusicCombatIntensity (0..1)
  mode?: MusicMode;       // for setMusicMode
  holdMs?: number;        // for setMusicMode
}

/**
 * Map an emergent event to zero or more soundscape directives.
 * Tension events raise combat intensity + shift minor; resolutions return major;
 * a landed scheme stings briefly minor. Unknown events → no directive.
 */
export function scoreDirectivesFor(eventName: string, payload: Record<string, unknown> = {}): SoundscapeDirective[] {
  switch (eventName) {
    case "faction:war-declared":
      return [{ action: "setMusicCombatIntensity", intensity: 0.85 }, { action: "setMusicMode", mode: "minor", holdMs: 12000 }];
    case "world:crisis":
      return [{ action: "setMusicCombatIntensity", intensity: 0.7 }, { action: "setMusicMode", mode: "minor", holdMs: 15000 }];
    case "refusal:compound-threshold":
      // reality bends — deep, sustained minor
      return [{ action: "setMusicMode", mode: "minor", holdMs: 20000 }];
    case "world:crisis-resolved":
    case "faction:alliance-formed":
      return [{ action: "setMusicCombatIntensity", intensity: 0 }, { action: "setMusicMode", mode: "major", holdMs: 8000 }];
    case "kingdom:founded":
      return [{ action: "setMusicMode", mode: "major", holdMs: 6000 }];
    case "kingdom:fallen":
      return [{ action: "setMusicMode", mode: "minor", holdMs: 10000 }];
    case "npc:scheme-resolved": {
      // a scheme that LANDS (outcome) stings minor; a foiled one resolves major
      const outcome = String(payload.outcome || "");
      const foiled = outcome === "exposed" || outcome === "abandoned" || outcome === "failed";
      return [{ action: "setMusicMode", mode: foiled ? "major" : "minor", holdMs: 3500 }];
    }
    default:
      return [];
  }
}

/** Convenience: the window-event detail objects a bridge would dispatch. */
export function soundscapeCommandsFor(eventName: string, payload: Record<string, unknown> = {}): SoundscapeDirective[] {
  return scoreDirectivesFor(eventName, payload);
}
