/**
 * Concord SDK — TypeScript Client
 *
 * Lightweight client for the Concord Cognitive Engine API.
 * Supports API key (csk_...) and JWT authentication.
 *
 * @example
 * ```ts
 * import { ConcordClient } from "@concord/sdk";
 *
 * const client = new ConcordClient("csk_your_key_here");
 *
 * // Run a lens action
 * const result = await client.lens.run("healthcare", "analyze", { patientId: "123" });
 *
 * // List DTUs
 * const dtus = await client.dtus.list({ limit: 10 });
 *
 * // Chat
 * const reply = await client.chat.send("Explain quantum entanglement");
 *
 * // Stream chat
 * for await (const chunk of client.chat.stream("Tell me about DTUs")) {
 *   process.stdout.write(chunk.content);
 * }
 * ```
 *
 * @packageDocumentation
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Configuration options for the Concord client. */
export interface ConcordClientOptions {
  /** Base URL of the Concord server (default: "http://localhost:5050") */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom headers to include with every request */
  headers?: Record<string, string>;
}

/** Standard API response envelope. */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  detail?: string;
  data?: T;
  [key: string]: unknown;
}

/** A Discrete Thought Unit. */
export interface DTU {
  id: string;
  title: string;
  body: string;
  domain: string;
  tags: string[];
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** DTU creation input. */
export interface DTUCreateInput {
  title: string;
  body: string;
  domain: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

/** Pagination / filter parameters for DTU listing. */
export interface DTUListParams {
  limit?: number;
  offset?: number;
  domain?: string;
}

/** Lens action result. */
export interface LensActionResult {
  ok: boolean;
  output?: string;
  source?: string;
  model?: string;
  action: string;
  domain: string;
  [key: string]: unknown;
}

/** Chat response. */
export interface ChatResponse {
  ok: boolean;
  reply: string;
  sessionId?: string;
  dtusForged?: DTU[];
  [key: string]: unknown;
}

/** A single chunk from a streaming chat response. */
export interface ChatStreamChunk {
  content: string;
  done: boolean;
  sessionId?: string;
}

/** API key metadata. */
export interface ApiKey {
  id: string;
  prefix: string;
  scopes: string[];
  rateLimit: { requestsPerMinute: number; requestsPerDay: number };
  createdAt: string;
  lastUsed: string | null;
  usageCount: number;
  revoked: boolean;
}

/** API key creation input. */
export interface ApiKeyCreateInput {
  name?: string;
  scopes?: string[];
  rateLimit?: { requestsPerMinute?: number; requestsPerDay?: number };
}

/** API key creation result (raw key returned only once). */
export interface ApiKeyCreateResult extends ApiResponse {
  key: ApiKey;
  rawKey: string;
}

// ── Error ──────────────────────────────────────────────────────────────────

/** Typed error for API failures. */
export class ConcordApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: unknown;

  constructor(message: string, status: number, code: string, body?: unknown) {
    super(message);
    this.name = "ConcordApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

// ── Client ─────────────────────────────────────────────────────────────────

export class ConcordClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly customHeaders: Record<string, string>;

  /** Lens action sub-client. */
  public readonly lens: LensClient;
  /** DTU sub-client. */
  public readonly dtus: DTUClient;
  /** Chat sub-client. */
  public readonly chat: ChatClient;
  /** API key management sub-client. */
  public readonly keys: KeysClient;
  /** Concord Link courier sub-client. */
  public readonly link: LinkClient;
  /** Marketplace + bazaar sub-client. */
  public readonly marketplace: MarketplaceClient;
  /** Mesh peering + transport sub-client. */
  public readonly mesh: MeshClient;
  /** World presence stream sub-client. */
  public readonly presence: PresenceClient;
  /** Combat netcode sub-client. */
  public readonly combat: CombatClient;
  /** Federation peering + cross-instance search sub-client. */
  public readonly federation: FederationClient;
  /** Intelligence views (knowledge weather / drift / diary) sub-client. */
  public readonly intelligence: IntelligenceClient;
  /** Instinct-NPC spawn / inspect / drive sub-client (Wave 7 affect substrate). */
  public readonly npc: NpcClient;
  /** Affect read sub-client — {umwelt, v, a, drives} for a creature/NPC/agent. */
  public readonly affect: AffectClient;
  /** Autonomous-agent deploy / inspect / awareness sub-client. */
  public readonly agent: AgentClient;

  /**
   * Create a new Concord client.
   *
   * @param apiKey - A Concord Secret Key ("csk_...") or JWT token.
   * @param options - Optional configuration.
   */
  constructor(apiKey: string, options: ConcordClientOptions = {}) {
    if (!apiKey) throw new Error("apiKey is required");
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || "http://localhost:5050").replace(/\/+$/, "");
    this.timeout = options.timeout ?? 30_000;
    this.customHeaders = options.headers || {};

    this.lens = new LensClient(this);
    this.dtus = new DTUClient(this);
    this.chat = new ChatClient(this);
    this.keys = new KeysClient(this);
    this.link = new LinkClient(this);
    this.marketplace = new MarketplaceClient(this);
    this.mesh = new MeshClient(this);
    this.presence = new PresenceClient(this);
    this.combat = new CombatClient(this);
    this.federation = new FederationClient(this);
    this.intelligence = new IntelligenceClient(this);
    this.npc = new NpcClient(this);
    this.affect = new AffectClient(this);
    this.agent = new AgentClient(this);
  }

  // ── Internal HTTP helpers ──────────────────────────────────────────────

  /** Build standard request headers. */
  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...this.customHeaders,
      ...extra,
    };
  }

  /** Core request method. */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extra?: { headers?: Record<string, string> },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const opts: RequestInit = {
        method,
        headers: this.buildHeaders(extra?.headers),
        signal: controller.signal,
      };

      if (body !== undefined && method !== "GET") {
        opts.body = JSON.stringify(body);
      }

      const res = await fetch(url, opts);

      if (!res.ok) {
        let errorBody: unknown;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text();
        }
        const msg =
          typeof errorBody === "object" && errorBody !== null && "error" in errorBody
            ? (errorBody as Record<string, string>).error
            : `HTTP ${res.status}`;
        throw new ConcordApiError(msg, res.status, String(res.status), errorBody);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET shorthand. */
  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /** POST shorthand. */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /**
   * Generic domain accessor — reach ANY of the ~495 registered macro domains, not just
   * the hand-written sub-clients. `client.domain("music").run("ai-playlist", {...})` maps
   * to `POST /api/lens/music/ai-playlist`. This is the "every domain is reachable"
   * guarantee (the auto-generated-wrapper equivalent) without shipping 495 stub classes.
   */
  domain(name: string) {
    return {
      run: <T = LensActionResult>(action: string, input: Record<string, unknown> = {}): Promise<T> =>
        this.lens.run(name, action, input) as unknown as Promise<T>,
    };
  }

  /** PUT shorthand. */
  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  /** DELETE shorthand. */
  async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", path, body);
  }

  /**
   * Streaming fetch — returns an async iterator of lines from an SSE stream.
   */
  async *stream(path: string, body?: unknown): AsyncGenerator<ChatStreamChunk> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    // Longer timeout for streaming
    const timer = setTimeout(() => controller.abort(), this.timeout * 4);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders({ Accept: "text/event-stream" }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new ConcordApiError(`Stream failed: ${res.status}`, res.status, "STREAM_ERROR", errText);
      }

      if (!res.body) {
        throw new ConcordApiError("No response body for stream", 500, "NO_BODY");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            yield {
              content: parsed.content || parsed.text || "",
              done: !!parsed.done,
              sessionId: parsed.sessionId,
            };
            if (parsed.done) return;
          } catch {
            // Non-JSON SSE data — yield as raw content
            yield { content: data, done: false };
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Sub-clients ────────────────────────────────────────────────────────────

class LensClient {
  constructor(private client: ConcordClient) {}

  /**
   * Run a lens action on a domain.
   *
   * @param domain - Lens domain (e.g., "healthcare", "code", "math")
   * @param action - Action name (e.g., "analyze", "generate", "suggest")
   * @param input  - Action parameters / artifact data
   */
  async run(
    domain: string,
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<LensActionResult> {
    return this.client.post<LensActionResult>(`/api/lens/${domain}/${action}`, {
      artifact: input.artifact || { domain },
      params: input.params || input,
    });
  }

  /** List all available lens actions. */
  async actions(): Promise<{ domain: string; action: string }[]> {
    const res = await this.client.get<{
      ok: boolean;
      lensActions: { domain: string; action: string }[];
    }>("/api/lens/pipelines");
    return res.lensActions || [];
  }
}

class DTUClient {
  constructor(private client: ConcordClient) {}

  /** List DTUs with optional filtering. */
  async list(params: DTUListParams = {}): Promise<ApiResponse<DTU[]>> {
    const query = new URLSearchParams();
    if (params.limit != null) query.set("limit", String(params.limit));
    if (params.offset != null) query.set("offset", String(params.offset));
    if (params.domain) query.set("domain", params.domain);
    const qs = query.toString();
    return this.client.get<ApiResponse<DTU[]>>(`/api/dtus${qs ? `?${qs}` : ""}`);
  }

  /** Get a single DTU by ID. */
  async get(id: string): Promise<ApiResponse<DTU>> {
    return this.client.get<ApiResponse<DTU>>(`/api/dtus/${encodeURIComponent(id)}`);
  }

  /** Create a new DTU. */
  async create(data: DTUCreateInput): Promise<ApiResponse<DTU>> {
    return this.client.post<ApiResponse<DTU>>("/api/dtus", data);
  }

  /** Search DTUs by query text. */
  async search(query: string, options?: { limit?: number; domain?: string }): Promise<ApiResponse<DTU[]>> {
    return this.client.post<ApiResponse<DTU[]>>("/api/search", { query, ...options });
  }
}

class ChatClient {
  constructor(private client: ConcordClient) {}

  /**
   * Send a chat message and receive a complete response.
   *
   * @param message  - The message text
   * @param options  - Optional session ID and parameters
   */
  async send(
    message: string,
    options?: { sessionId?: string; [key: string]: unknown },
  ): Promise<ChatResponse> {
    return this.client.post<ChatResponse>("/api/chat", {
      message,
      ...options,
    });
  }

  /**
   * Stream a chat response via Server-Sent Events.
   *
   * @param message  - The message text
   * @param options  - Optional session ID and parameters
   * @returns Async iterator of stream chunks
   */
  async *stream(
    message: string,
    options?: { sessionId?: string; [key: string]: unknown },
  ): AsyncGenerator<ChatStreamChunk> {
    yield* this.client.stream("/api/chat/stream", {
      message,
      ...options,
    });
  }
}

class KeysClient {
  constructor(private client: ConcordClient) {}

  /** Generate a new API key. */
  async create(input: ApiKeyCreateInput = {}): Promise<ApiKeyCreateResult> {
    return this.client.post<ApiKeyCreateResult>("/api/keys", input);
  }

  /** List all API keys for the authenticated user. */
  async list(): Promise<ApiResponse<ApiKey[]>> {
    return this.client.get<ApiResponse<ApiKey[]>>("/api/keys");
  }

  /** Revoke an API key. */
  async revoke(keyId: string): Promise<ApiResponse> {
    return this.client.delete<ApiResponse>(`/api/keys/${encodeURIComponent(keyId)}`);
  }

  /** Update scopes or rate limits on a key. */
  async update(
    keyId: string,
    updates: { scopes?: string[]; rateLimit?: { requestsPerMinute?: number; requestsPerDay?: number } },
  ): Promise<ApiResponse<ApiKey>> {
    return this.client.put<ApiResponse<ApiKey>>(`/api/keys/${encodeURIComponent(keyId)}`, updates);
  }

  /** Get usage statistics for a key. */
  async usage(keyId: string): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/keys/${encodeURIComponent(keyId)}/usage`);
  }
}

// ── Concord Link courier sub-client ──────────────────────────────────────

export interface LinkSendInput {
  receiverId: string;
  message: string;
  worldId?: string;
  payload?: Record<string, unknown>;
}

class LinkClient {
  constructor(private client: ConcordClient) {}

  /** Send a Concord Link message via a walker courier. */
  async send(input: LinkSendInput): Promise<ApiResponse> {
    return this.client.post<ApiResponse>("/api/concord-link/send", input);
  }

  /** List inbox messages for the authenticated user. */
  async inbox(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/concord-link/inbox");
  }

  /** Subscribe to Link delivery + intercept events via socket.io. */
  subscribe(handler: (event: string, payload: unknown) => void): () => void {
    return subscribeViaSocket(this.client, [
      "concord-link:delivered",
      "concord-link:intercepted",
    ], handler);
  }
}

// ── Marketplace + bazaar sub-client ──────────────────────────────────────

class MarketplaceClient {
  constructor(private client: ConcordClient) {}

  /** Browse active marketplace listings. */
  async listings(params: { category?: string; search?: string; sort?: string; page?: number; pageSize?: number } = {}): Promise<ApiResponse> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return this.client.get<ApiResponse>(`/api/marketplace/listings?${q}`);
  }

  /** Submit a personal DTU as a marketplace listing (runs repair-brain pre-flight). */
  async submit(dtuId: string, price: number): Promise<ApiResponse> {
    return this.client.post<ApiResponse>("/api/marketplace/submit", { dtuId, price });
  }

  /** Get the latest dream-cycle promoted listings (free, score-ranked). */
  async dreamPromoted(limit = 20): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/marketplace/dream-promoted?limit=${limit}`);
  }

  /** Get the in-world bazaar — top listings as 3D-positioned vendor stalls. */
  async bazaar(worldId = "concordia", limit = 24): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(
      `/api/world/bazaar?worldId=${encodeURIComponent(worldId)}&limit=${limit}`,
    );
  }

  /** Cite a DTU when forking — caller automatically receives 95% royalty share. */
  async cite(dtuId: string, citedDtuId: string, reason?: string): Promise<ApiResponse> {
    return this.client.post<ApiResponse>(`/api/dtus/${encodeURIComponent(dtuId)}/cite`, {
      citedDtuId,
      reason,
    });
  }
}

// ── Mesh peering + transport sub-client ──────────────────────────────────

class MeshClient {
  constructor(private client: ConcordClient) {}

  /** List currently visible mesh peers (BLE / WiFi / LoRa). */
  async peers(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/mesh/peers");
  }

  /** Pair with a discovered peer over a specific transport. */
  async pair(peerId: string, transport: "ble" | "wifi" | "lora" | "rf" | "nfc"): Promise<ApiResponse> {
    return this.client.post<ApiResponse>("/api/mesh/pair", { peerId, transport });
  }

  /** Sync DTUs with a paired peer (one-tap UX). */
  async sync(peerId: string, dtuIds: string[]): Promise<ApiResponse> {
    return this.client.post<ApiResponse>("/api/mesh/sync", { peerId, dtuIds });
  }
}

// ── World presence stream sub-client ─────────────────────────────────────

class PresenceClient {
  constructor(private client: ConcordClient) {}

  /** Get the current city presence snapshot. */
  async snapshot(worldId = "concordia"): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/world/presence?worldId=${encodeURIComponent(worldId)}`);
  }

  /** Subscribe to presence updates over the world socket. */
  subscribe(worldId: string, handler: (event: string, payload: unknown) => void): () => void {
    return subscribeViaSocket(this.client, [
      "city:positions",
      "player:move:ack",
      "player:respawn:ack",
    ], handler, { worldId });
  }
}

// ── Combat netcode sub-client ────────────────────────────────────────────

class CombatClient {
  constructor(private client: ConcordClient) {}

  /** Subscribe to combat events: attacks, hits, dodges, blocks, kills. */
  subscribe(handler: (event: string, payload: unknown) => void): () => void {
    return subscribeViaSocket(this.client, [
      "combat:attack:ack",
      "combat:hit",
      "combat:dodge:ack",
      "combat:block:ack",
      "combat:kill",
    ], handler);
  }
}

// ── Federation sub-client ────────────────────────────────────────────────

class FederationClient {
  constructor(private client: ConcordClient) {}

  /** List known peer instances. */
  async instances(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/federation/instances");
  }

  /** Cross-instance semantic search. */
  async search(q: string, limit = 20): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(
      `/api/federation/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    );
  }

  /** Get the trust graph between known instances. */
  async trustGraph(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/federation/trust-graph");
  }
}

// ── Intelligence views sub-client ────────────────────────────────────────

class IntelligenceClient {
  constructor(private client: ConcordClient) {}

  /** 24h knowledge weather (warm/cold fronts by domain). */
  async knowledgeWeather(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/intelligence/knowledge-weather");
  }

  /** Domain pairs whose vocabularies are drifting apart. */
  async driftRadar(): Promise<ApiResponse> {
    return this.client.get<ApiResponse>("/api/intelligence/drift-radar");
  }

  /** Rolling diary of major system events. */
  async continuityDiary(opts: { kind?: string; limit?: number } = {}): Promise<ApiResponse> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(opts)) if (v !== undefined) q.set(k, String(v));
    return this.client.get<ApiResponse>(`/api/intelligence/continuity-diary?${q}`);
  }
}

// ── Wave 7 — the affect/agent substrate sub-clients (the licensable middleware) ──

/**
 * Instinct-NPC sub-client. Spawn a living NPC, inspect it, or nudge its drives —
 * all through the macro surface. The NPC then runs on the 4-tier instinct loop for
 * ~zero idle cost; the LLM wakes only on salience (B4). "Drop a thousand for the
 * cost of ten."
 */
class NpcClient {
  constructor(private client: ConcordClient) {}
  /** Spawn an instinct NPC in a world (routes through the world lens macro). */
  async spawn(worldId: string, input: Record<string, unknown> = {}): Promise<LensActionResult> {
    return this.client.lens.run("world", "spawn-npc", { worldId, ...input });
  }
  /** Inspect an NPC's live state. */
  async inspect(worldId: string, npcId: string): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/worlds/${worldId}/npcs/${npcId}`);
  }
  /** Generic macro passthrough so EVERY world/creature macro is reachable, not just these. */
  async run(domain: string, action: string, input: Record<string, unknown> = {}): Promise<LensActionResult> {
    return this.client.lens.run(domain, action, input);
  }
}

/** Affect read sub-client — the felt state {umwelt, v, a, drives} of an entity. */
class AffectClient {
  constructor(private client: ConcordClient) {}
  /** An agent's persisted motivation profile (its 7-drive Panksepp seed + values). */
  async ofAgent(agentId: string): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/agent/${agentId}`);
  }
}

/**
 * Autonomous-agent sub-client. Deploy a persistent, player-tier being (Sparks-only,
 * fenced by the three guardrails), inspect its self-model + autobiography, and read
 * its awareness index — a measured ACCESS correlate (PCI-proxy), never a phenomenal-
 * consciousness claim.
 */
class AgentClient {
  constructor(private client: ConcordClient) {}
  /** Deploy an agent (privileged; respects CONCORD_AGENT_ENABLED). */
  async deploy(input: Record<string, unknown> = {}): Promise<ApiResponse> {
    return this.client.post<ApiResponse>(`/api/agent/deploy`, input);
  }
  /** Inspect the agent's self-model, values anchor, drives, and autobiography. */
  async inspect(agentId: string): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/agent/${agentId}`);
  }
  /** The agent's awareness index — watch it rise as it wakes, dip as it sleeps. */
  async awarenessIndex(agentId: string): Promise<ApiResponse> {
    return this.client.get<ApiResponse>(`/api/agent/${agentId}/awareness`);
  }
}

// ── Internal: socket.io subscribe helper ─────────────────────────────────

function subscribeViaSocket(
  client: ConcordClient,
  events: string[],
  handler: (event: string, payload: unknown) => void,
  _opts: { worldId?: string } = {},
): () => void {
  let sock: { on: (e: string, h: (p: unknown) => void) => void; off: (e: string, h: (p: unknown) => void) => void; disconnect: () => void } | null = null;
  let cancelled = false;
  (async () => {
    try {
      // Lazy-load socket.io-client so consumers without realtime needs don't
      // pull the dependency. Optional peer dep — suppress the missing-module type
      // error; the surrounding try/catch handles the not-installed case at runtime.
      // @ts-ignore - optional peer dependency, resolved at runtime if present
      const mod: { io: (url: string, opts: Record<string, unknown>) => typeof sock } = await import("socket.io-client");
      if (cancelled) return;
      sock = mod.io((client as unknown as { baseUrl: string }).baseUrl, {
        transports: ["websocket", "polling"],
        auth: { token: (client as unknown as { apiKey: string }).apiKey },
      });
      for (const e of events) sock?.on(e, (payload: unknown) => handler(e, payload));
    } catch {
      // socket.io-client not installed — caller must add it as a peer dep.
    }
  })();
  return () => {
    cancelled = true;
    try {
      for (const e of events) sock?.off(e, () => {});
      sock?.disconnect();
    } catch { /* socket cleanup silent */ }
  };
}

// ── Default export ─────────────────────────────────────────────────────────

export default ConcordClient;
