// Concord Mobile — Macro Client
//
// Phase 6d: thin wrapper around POST /api/lens/run for invoking server
// macros from mobile. Adds: bearer-auth header injection, retry on
// transient network errors, and predictable error shape for callers.

export interface MacroResult<T = unknown> {
  ok: boolean;
  data?: T;
  reason?: string;
  error?: string;
  status?: number;
}

export interface MacroClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | undefined;
  fetchImpl?: typeof fetch;
  retries?: number;
}

const DEFAULT_RETRIES = 2;
const TRANSIENT_STATUSES = new Set([0, 502, 503, 504]);

export class MacroClient {
  constructor(private cfg: MacroClientConfig) {}

  async runMacro<T = unknown>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<MacroResult<T>> {
    const fetchFn = this.cfg.fetchImpl || globalThis.fetch;
    if (!fetchFn) return { ok: false, reason: "no_fetch" };
    const retries = Number.isFinite(this.cfg.retries) ? Number(this.cfg.retries) : DEFAULT_RETRIES;

    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = this.cfg.getAuthToken?.();
    if (token) headers["authorization"] = `Bearer ${token}`;

    const body = JSON.stringify({ domain, name, input });

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchFn(`${this.cfg.baseUrl}/api/lens/run`, {
          method: "POST",
          headers,
          body,
        });
        if (TRANSIENT_STATUSES.has(res.status) && attempt < retries) {
          await sleep(Math.min(2000, 200 * Math.pow(2, attempt)));
          continue;
        }
        if (!res.ok) {
          return { ok: false, reason: "http_error", status: res.status };
        }
        const json = (await res.json()) as MacroResult<T> | T;
        if (typeof json === "object" && json !== null && "ok" in (json as MacroResult<T>)) {
          return json as MacroResult<T>;
        }
        return { ok: true, data: json as T };
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          await sleep(Math.min(2000, 200 * Math.pow(2, attempt)));
          continue;
        }
        return { ok: false, reason: "fetch_failed", error: String(err) };
      }
    }
    return { ok: false, reason: "exhausted_retries", error: String(lastErr) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

let _singleton: MacroClient | null = null;

export function configureMacroClient(cfg: MacroClientConfig): MacroClient {
  _singleton = new MacroClient(cfg);
  return _singleton;
}

export function getMacroClient(): MacroClient {
  if (!_singleton) {
    throw new Error("MacroClient not configured. Call configureMacroClient(...) first.");
  }
  return _singleton;
}

// ── Domain-specific convenience wrappers ────────────────────────────────────

export interface BeatPayload {
  id: string;
  user_id: string;
  world_id: string;
  prediction_id: string;
  prose: string;
  surfaced_at: number;
  completed_at: number | null;
  outcome: string | null;
}

export const Beats = {
  list: (limit = 20) => getMacroClient().runMacro<{ ok: boolean; beats?: BeatPayload[] }>("beats", "list", { limit }),
  realise: (beatId: string, outcome: "realised" | "rejected" | "ignored" = "realised") =>
    getMacroClient().runMacro("beats", "realise", { beatId, outcome }),
};

export const LandClaims = {
  claim: (worldId: string, x: number, z: number, radiusM: number) =>
    getMacroClient().runMacro("land_claims", "claim", { worldId, x, z, radiusM }),
  invite: (claimId: string, userId: string, role: string) =>
    getMacroClient().runMacro("land_claims", "invite", { claimId, userId, role }),
  topup: (claimId: string, amount: number) =>
    getMacroClient().runMacro("land_claims", "topup", { claimId, amount }),
  claimAt: (worldId: string, x: number, z: number) =>
    getMacroClient().runMacro("land_claims", "claim_at", { worldId, x, z }),
  listForUser: () => getMacroClient().runMacro("land_claims", "list_for_user", {}),
};

export const GlyphSpells = {
  listComponents: () => getMacroClient().runMacro("glyph_spells", "list_components", {}),
  preview: (componentIds: string[]) => getMacroClient().runMacro("glyph_spells", "preview", { componentIds }),
  mint: (worldId: string, componentIds: string[], name?: string) =>
    getMacroClient().runMacro("glyph_spells", "mint", { worldId, componentIds, name }),
  listForUser: () => getMacroClient().runMacro("glyph_spells", "list_for_user", {}),
};

export const Discovery = {
  search: (query: string, opts: { kind?: string; creatorId?: string; limit?: number } = {}) =>
    getMacroClient().runMacro("discovery", "search", { query, ...opts }),
  facets: () => getMacroClient().runMacro("discovery", "facets", {}),
  trending: (lookbackS?: number, limit?: number) =>
    getMacroClient().runMacro("discovery", "trending", { lookbackS, limit }),
};

export const KnowledgeTrade = {
  requestMentorship: (mentorNpcId: string, recipeDtuId: string) =>
    getMacroClient().runMacro("knowledge_trade", "mentorship_request", { mentorNpcId, recipeDtuId }),
  completeSession: (mentorshipId: string, studentRecipeId?: string) =>
    getMacroClient().runMacro("knowledge_trade", "mentorship_complete_session", { mentorshipId, studentRecipeId }),
  listForStudent: () => getMacroClient().runMacro("knowledge_trade", "mentorship_list_for_student", {}),
};

export const DtuPortability = {
  exportCorpus: (opts: { includeEconomy?: boolean; limit?: number } = {}) =>
    getMacroClient().runMacro("dtu_portability", "export", opts),
  validate: (envelope: unknown) => getMacroClient().runMacro("dtu_portability", "validate", { envelope }),
  importEnvelope: (envelope: unknown) => getMacroClient().runMacro("dtu_portability", "import", { envelope }),
};

// ── Phase Y: parity for the 6 web-only domains ─────────────────────────────

export const Racing = {
  startRace:    (worldId: string, courtX = 0, courtZ = 0, durationS = 180) =>
    getMacroClient().runMacro("racing", "start_race", { worldId, courtX, courtZ, durationS }),
  submitLap:    (raceId: string, lapMs: number) =>
    getMacroClient().runMacro("racing", "submit_lap", { raceId, lapMs }),
  leaderboard:  (raceId: string) =>
    getMacroClient().runMacro("racing", "leaderboard", { raceId }),
};

export const Basketball = {
  startMatch:   (worldId: string, courtX = 0, courtZ = 0, durationS = 180) =>
    getMacroClient().runMacro("basketball", "start_match", { worldId, courtX, courtZ, durationS }),
  score:        (courtId: string, points = 2) =>
    getMacroClient().runMacro("basketball", "score", { courtId, points }),
  leaderboard:  (courtId: string) =>
    getMacroClient().runMacro("basketball", "leaderboard", { courtId }),
};

export const VoiceChatSignalling = {
  roomState:    (roomId: string) => getMacroClient().runMacro("voice_chat", "room_state", { roomId }),
  join:         (roomId: string) => getMacroClient().runMacro("voice_chat", "join", { roomId }),
  leaveRoom:    (roomId: string) => getMacroClient().runMacro("voice_chat", "leave_room", { roomId }),
  offer:        (targetUserId: string, sdp: unknown) =>
    getMacroClient().runMacro("voice_chat", "offer", { targetUserId, sdp }),
  answer:       (targetUserId: string, sdp: unknown) =>
    getMacroClient().runMacro("voice_chat", "answer", { targetUserId, sdp }),
  ice:          (targetUserId: string, candidate: unknown) =>
    getMacroClient().runMacro("voice_chat", "ice", { targetUserId, candidate }),
  leave:        (targetUserId: string) =>
    getMacroClient().runMacro("voice_chat", "leave", { targetUserId }),
};

export const Markers = {
  list:    (worldId: string) => getMacroClient().runMacro("markers", "list", { worldId }),
  place:   (worldId: string, kind: 'poi'|'quest'|'caution'|'celebration'|'system', x: number, z: number, label?: string, expiresAt?: number) =>
    getMacroClient().runMacro("markers", "place", { worldId, kind, x, z, label, expiresAt }),
  remove:  (markerId: string) => getMacroClient().runMacro("markers", "remove", { markerId }),
};

export const Messaging = {
  listBindings:   () => getMacroClient().runMacro("messaging", "list_bindings", {}),
  addBinding:     (platform: string, handle: string) =>
    getMacroClient().runMacro("messaging", "add_binding", { platform, handle }),
  removeBinding:  (bindingId: string) =>
    getMacroClient().runMacro("messaging", "remove_binding", { bindingId }),
  setDefault:     (bindingId: string) =>
    getMacroClient().runMacro("messaging", "set_default", { bindingId }),
};

export const Patterns = {
  discover: (query?: string, limit?: number) =>
    getMacroClient().runMacro("patterns", "discover", { query, limit }),
};
