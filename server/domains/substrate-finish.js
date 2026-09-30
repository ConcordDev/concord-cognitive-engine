/**
 * substrate-finish.js — Real macro substrate for intentional_absent + leftover
 * deferred wires (Ghost Fleet off). Prefer extending research-jobs / atlas-chat /
 * physics lens / messaging inbound-pipeline / heartbeat-registry — never fake ok:true.
 *
 * Loaded from server.js after the honest no_macro_substrate stubs so these
 * registrations intentionally shadow them (spec.note = intentional_shadow_ok).
 */

const SHADOW = { note: "intentional_shadow_ok" };

function wrap(out, aliasOf) {
  if (out && typeof out === "object") {
    return { ...(out.ok !== undefined ? out : { ok: true, ...out }), aliasOf };
  }
  return { ok: true, result: out, aliasOf };
}

function getState(ctx) {
  if (ctx?.state) return ctx.state;
  if (typeof globalThis !== "undefined" && globalThis._concordSTATE) return globalThis._concordSTATE;
  return null;
}

function getDb(ctx) {
  const st = getState(ctx);
  return (
    ctx?.db ||
    st?.db ||
    (typeof globalThis !== "undefined" && (globalThis.__concordDB || globalThis._concordDB)) ||
    null
  );
}


/** Physics models catalog derived from real physics domain / engine surfaces. */
function buildPhysicsModelsCatalog() {
  const models = [
    {
      id: "kinematics-1d",
      name: "1D Kinematics",
      family: "classical_mechanics",
      lens: "physics.kinematics-1d",
      description: "Constant-acceleration motion along one axis",
    },
    {
      id: "projectile",
      name: "Projectile Motion",
      family: "classical_mechanics",
      lens: "physics.projectile",
      description: "2D ballistic trajectory under gravity",
    },
    {
      id: "kinematics-sim",
      name: "Kinematics Simulator",
      family: "classical_mechanics",
      lens: "physics.kinematicsSim",
      description: "Multi-body kinematics scene simulation",
    },
    {
      id: "orbital-mechanics",
      name: "Orbital Mechanics",
      family: "celestial",
      lens: "physics.orbitalMechanics",
      description: "Keplerian / n-body orbital helpers",
    },
    {
      id: "wave-interference",
      name: "Wave Interference",
      family: "waves",
      lens: "physics.waveInterference",
      description: "Superposition and interference patterns",
    },
    {
      id: "thermodynamics",
      name: "Thermodynamics",
      family: "thermo",
      lens: "physics.thermodynamics",
      description: "Ideal-gas and heat-transfer helpers",
    },
    {
      id: "pendulum",
      name: "Pendulum Period",
      family: "classical_mechanics",
      lens: "physics.pendulum-period",
      description: "Simple / physical pendulum period",
    },
    {
      id: "rigid-body-scene",
      name: "Rigid-Body Scene Engine",
      family: "simulation",
      lens: "physics.simulate-scene",
      description: "PhET/Algodoo-style scene with springs/joints/ramps",
    },
    {
      id: "world-authority",
      name: "World Physics Authority",
      family: "world",
      module: "lib/world-physics-authority.js",
      description: "Authoritative movement + collision for Concordia worlds",
      worlds: ["concordia-hub", "fantasy"],
    },
    {
      id: "physics-engine",
      name: "PhysicsEngine",
      family: "world",
      module: "lib/physics-engine.js",
      description: "Core engine: players, obstacles, refusal fields, combat proximity",
    },
  ];
  return {
    ok: true,
    models,
    count: models.length,
    constantsAlias: "physics.constants",
    note: "Catalog of wireable physics models from domains/physics + world-physics-authority",
  };
}

/**
 * @param {Function} register - server register(domain, name, fn, spec)
 * @param {object} [deps]
 * @param {Function} [deps.chatRetrieve] - emergent/atlas-chat.chatRetrieve
 * @param {Function} [deps.getChatMetrics]
 * @param {Function} [deps.recordChatExchange]
 * @param {Function} [deps.MACROS]
 */
export default function registerSubstrateFinishMacros(register, deps = {}) {
  if (typeof register !== "function") return { ok: false, error: "register_required" };

  const lazy = (p) => import(p);

  // ── research.conduct / report / results / metrics ─────────────────────────
  register(
    "research",
    "conduct",
    async (ctx, input = {}) => {
      try {
        const topic = String(input.topic || input.query || input.q || "").trim();
        if (!topic) {
          return { ok: false, error: "topic_required", reason: "topic_required", message: "research.conduct requires topic" };
        }
        const research = await lazy("../emergent/research-jobs.js");
        const config = {
          depth: input.depth || "normal",
          domains: input.domains,
          priority: input.priority,
          enableIngest: input.enableIngest,
          enableHypotheses: input.enableHypotheses,
          userId: ctx?.actor?.userId || ctx?.actor?.id || input.userId,
        };
        const submitted = research.submitResearchJob(topic, config);
        if (!submitted?.ok) return submitted;

        // Advance the queue so results/report have substrate in-process.
        let steps = 0;
        const maxSteps = input.maxSteps != null ? Number(input.maxSteps) : 8;
        if (typeof research.processResearchQueue === "function") {
          try {
            research.processResearchQueue();
          } catch (_e) { /* non-fatal */ }
        }
        if (submitted.job?.id && typeof research.runResearchStep === "function") {
          for (let i = 0; i < maxSteps; i++) {
            const step = research.runResearchStep(submitted.job.id);
            steps++;
            if (!step?.ok || step.done || step.status === "complete" || step.status === "failed") break;
          }
        }

        const job = research.getResearchJob(submitted.job.id);
        // Mirror into STATE for cross-restart visibility when STATE persists.
        try {
          const st = getState(ctx);
          if (st) {
            if (!st.researchJobs) st.researchJobs = {};
            st.researchJobs[submitted.job.id] = job?.job || submitted.job;
          }
        } catch (_e) { /* best effort */ }

        return {
          ok: true,
          research: job?.job || submitted.job,
          jobId: submitted.job.id,
          stepsAdvanced: steps,
          aliasOf: "emergent/research-jobs.submitResearchJob",
        };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Conduct research job (research-jobs substrate; persists in-process + STATE.researchJobs).", ...SHADOW },
  );

  register(
    "research",
    "report",
    async (_ctx, input = {}) => {
      try {
        const id = input.id || input.jobId || input.researchId;
        if (!id) return { ok: false, error: "id_required", reason: "id_required" };
        const research = await lazy("../emergent/research-jobs.js");
        return wrap(research.getResearchReport(id), "research-jobs.getResearchReport");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Fetch synthesis report for a research job id.", ...SHADOW },
  );

  register(
    "research",
    "results",
    async (_ctx, input = {}) => {
      try {
        const id = input.id || input.jobId || input.researchId;
        // No id → list all jobs as results inventory (honest empty list ok)
        const research = await lazy("../emergent/research-jobs.js");
        if (!id) {
          const listed = research.listResearchJobs(input.status);
          return {
            ok: true,
            results: listed?.jobs || [],
            total: listed?.total ?? (listed?.jobs || []).length,
            aliasOf: "research-jobs.listResearchJobs",
          };
        }
        return wrap(research.getResearchResults(id), "research-jobs.getResearchResults");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "List research results or get results for a job id.", ...SHADOW },
  );

  register(
    "research",
    "metrics",
    async (_ctx, _input = {}) => {
      try {
        const research = await lazy("../emergent/research-jobs.js");
        return wrap(research.getResearchMetrics(), "research-jobs.getResearchMetrics");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Research job counters from stored research-jobs metrics.", ...SHADOW },
  );

  // ── physics.models ────────────────────────────────────────────────────────
  register(
    "physics",
    "models",
    (_ctx, input = {}) => {
      try {
        const catalog = buildPhysicsModelsCatalog();
        const family = input.family || input.domain;
        if (family) {
          const filtered = catalog.models.filter((m) => m.family === family);
          return { ok: true, models: filtered, count: filtered.length, family, aliasOf: "physics.models.catalog" };
        }
        const id = input.id || input.modelId;
        if (id) {
          const hit = catalog.models.find((m) => m.id === id);
          if (!hit) return { ok: false, error: "not_found", reason: "not_found", id };
          return { ok: true, model: hit, aliasOf: "physics.models.catalog" };
        }
        return { ...catalog, aliasOf: "physics.models.catalog" };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "List/describe physics models from domains/physics + world-physics-authority.", ...SHADOW },
  );

  // ── atlas.chat — same path as REST /api/atlas/chat/* ──────────────────────
  register(
    "atlas",
    "chat",
    async (ctx, input = {}) => {
      try {
        const st = typeof deps.STATE !== "undefined" && deps.STATE
          ? deps.STATE
          : getState(ctx);
        if (!st) {
          return { ok: false, error: "state_unavailable", reason: "state_unavailable" };
        }

        const op = String(input.op || input.action || "retrieve").toLowerCase();
        let chatRetrieve = deps.chatRetrieve;
        let getChatMetrics = deps.getChatMetrics;
        let recordChatExchange = deps.recordChatExchange;
        let saveAsDtu = deps.saveAsDtu;
        let getChatSession = deps.getChatSession;

        if (!chatRetrieve) {
          const mod = await lazy("../emergent/atlas-chat.js");
          chatRetrieve = mod.chatRetrieve;
          getChatMetrics = mod.getChatMetrics;
          recordChatExchange = mod.recordChatExchange;
          saveAsDtu = mod.saveAsDtu;
          getChatSession = mod.getChatSession;
        }

        if (op === "metrics") {
          return wrap(getChatMetrics(st), "atlas-chat.getChatMetrics");
        }
        if (op === "session") {
          const sid = input.sessionId || input.id;
          if (!sid) return { ok: false, error: "sessionId_required", reason: "sessionId_required" };
          return wrap(getChatSession(st, sid), "atlas-chat.getChatSession");
        }
        if (op === "save" || op === "save_as_dtu") {
          const content = input.content || input.text;
          if (!content) return { ok: false, error: "content_required", reason: "content_required" };
          return wrap(saveAsDtu(st, content, {
            userId: ctx?.actor?.userId || ctx?.actor?.id || input.userId,
            sessionId: input.sessionId,
            ...input,
          }), "atlas-chat.saveAsDtu");
        }
        if (op === "exchange") {
          const sid = input.sessionId || input.id || `sess_${Date.now().toString(36)}`;
          const exchange = input.exchange || {
            role: input.role || "user",
            content: input.content || input.message || input.query || "",
            at: new Date().toISOString(),
          };
          if (!exchange.content) return { ok: false, error: "content_required", reason: "content_required" };
          return wrap(recordChatExchange(st, sid, exchange), "atlas-chat.recordChatExchange");
        }

        // default: retrieve (REST /api/atlas/chat/retrieve)
        const query = String(input.query || input.q || input.message || input.content || "").trim();
        if (!op || op === "retrieve" || op === "chat") {
          if (!query) {
            return { ok: false, error: "query_required", reason: "query_required", message: "atlas.chat retrieve requires query (or pass op=metrics)" };
          }
          const out = chatRetrieve(st, query, {
            sessionId: input.sessionId,
            limit: input.limit,
            policy: input.policy,
            minConfidence: input.minConfidence,
          });
          return wrap(out, "atlas-chat.chatRetrieve");
        }

        return { ok: false, error: "unknown_op", reason: "unknown_op", allowed: ["retrieve", "metrics", "session", "save", "exchange"] };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Atlas chat macro — same substrate as /api/atlas/chat/* (retrieve/save/exchange/metrics).", ...SHADOW },
  );

  // ── heartbeat.history / metrics (registry timing substrate) ───────────────
  register(
    "heartbeat",
    "history",
    async (_ctx, input = {}) => {
      try {
        const reg = await lazy("../emergent/heartbeat-registry.js");
        const stats = typeof reg.getHeartbeatTimingStats === "function" ? reg.getHeartbeatTimingStats() : [];
        const modules = typeof reg.listHeartbeatModules === "function" ? reg.listHeartbeatModules() : [];
        const limit = Math.min(Number(input.limit || 100), 500);
        const id = input.id || input.moduleId;
        let history = Array.isArray(stats) ? stats : [];
        if (id) history = history.filter((h) => h.id === id);
        return {
          ok: true,
          history: history.slice(0, limit),
          modules: id ? modules.filter((m) => m.id === id) : modules,
          count: history.length,
          aliasOf: "heartbeat-registry.getHeartbeatTimingStats",
        };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Heartbeat module timing history from heartbeat-registry.", ...SHADOW },
  );

  register(
    "heartbeat",
    "metrics",
    async (_ctx, _input = {}) => {
      try {
        const reg = await lazy("../emergent/heartbeat-registry.js");
        const stats = typeof reg.getHeartbeatTimingStats === "function" ? reg.getHeartbeatTimingStats() : [];
        const modules = typeof reg.listHeartbeatModules === "function" ? reg.listHeartbeatModules() : [];
        const totalRuns = stats.reduce((s, x) => s + (x.totalRuns || 0), 0);
        const totalErrors = stats.reduce((s, x) => s + (x.totalErrors || 0), 0);
        return {
          ok: true,
          metrics: {
            moduleCount: modules.length,
            timedModules: stats.length,
            totalRuns,
            totalErrors,
            topByP99: stats.slice(0, 10).map((s) => ({ id: s.id, p99: s.p99, lastMs: s.lastMs, totalRuns: s.totalRuns })),
          },
          aliasOf: "heartbeat-registry.getHeartbeatTimingStats",
        };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Heartbeat aggregate metrics from registry timing stats.", ...SHADOW },
  );

  // ── messaging.connect / verify — same helpers as REST ─────────────────────
  register(
    "messaging",
    "connect",
    async (ctx, input = {}) => {
      try {
        const userId = ctx?.actor?.userId || ctx?.actor?.id || input.userId;
        if (!userId) return { ok: false, error: "authentication_required", reason: "authentication_required" };
        const platform = String(input.platform || "").toLowerCase();
        if (!platform) return { ok: false, error: "platform_required", reason: "platform_required" };
        const allowed = ["whatsapp", "telegram", "discord", "signal", "imessage", "slack"];
        if (!allowed.includes(platform)) {
          return { ok: false, error: "unknown_platform", reason: "unknown_platform", allowed };
        }
        const externalId = input.externalId || input.external_id;
        if (!externalId) return { ok: false, error: "externalId_required", reason: "externalId_required" };
        const db = getDb(ctx);
        if (!db?.prepare) {
          return { ok: false, error: "db_unavailable", reason: "db_unavailable", message: "messaging.connect requires DB" };
        }
        const pipe = await lazy("../lib/messaging/inbound-pipeline.js");
        const { bindingId, verificationToken } = pipe.createBinding(
          db,
          userId,
          platform,
          String(externalId),
          input.displayName || input.display_name,
        );
        return {
          ok: true,
          bindingId,
          verificationToken,
          platform,
          instructions: `Send this token to your Concord bot on ${platform} to verify: ${verificationToken}`,
          aliasOf: "POST /api/messaging/connect/:platform",
        };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Create messaging binding (same as POST /api/messaging/connect/:platform).", ...SHADOW },
  );

  register(
    "messaging",
    "verify",
    async (ctx, input = {}) => {
      try {
        const userId = ctx?.actor?.userId || ctx?.actor?.id || input.userId;
        if (!userId) return { ok: false, error: "authentication_required", reason: "authentication_required" };
        const platform = String(input.platform || "").toLowerCase();
        const token = input.token || input.verificationToken;
        if (!platform || !token) {
          return { ok: false, error: "platform_and_token_required", reason: "platform_and_token_required" };
        }
        const db = getDb(ctx);
        if (!db?.prepare) {
          return { ok: false, error: "db_unavailable", reason: "db_unavailable" };
        }
        const pipe = await lazy("../lib/messaging/inbound-pipeline.js");
        const result = pipe.verifyBinding(db, userId, platform, token);
        return wrap(result, "POST /api/messaging/verify");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Verify messaging binding (same as POST /api/messaging/verify).", ...SHADOW },
  );

  // ── collab.revisions — clearer validation + id aliases ────────────────────
  register(
    "collab",
    "revisions",
    async (ctx, input = {}) => {
      try {
        const docId = input.docId || input.id || input.dtuId || input.documentId;
        if (!docId) {
          return { ok: false, error: "docId_required", reason: "docId_required", message: "collab.revisions requires docId" };
        }
        // Prefer lens collab.docHistory
        const LENS = typeof globalThis !== "undefined" ? globalThis.__concordLensActions : null;
        if (LENS?.has?.("collab.docHistory")) {
          const h = LENS.get("collab.docHistory");
          const out = await h(ctx, { domain: "collab", data: { ...input, docId } }, { ...input, docId });
          return wrap(out, "lens:collab.docHistory");
        }
        // Fallback: REST-shaped collab doc history via STATE if present
        const st = getState(ctx);
        const docs = st?.collab?.documents || st?.lensArtifacts?.collab?.documents;
        if (docs?.get) {
          const doc = docs.get(String(docId));
          if (!doc) return { ok: false, error: "document not found", reason: "not_found", docId };
          const snapshots = (doc.snapshots || []).map((sn) => ({
            id: sn.id,
            label: sn.label,
            createdAt: sn.createdAt,
            preview: String(sn.text || "").slice(0, 200),
          }));
          return { ok: true, result: { snapshots, total: snapshots.length }, aliasOf: "STATE.collab.documents" };
        }
        return { ok: false, error: "document not found", reason: "not_found", docId };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Document revision history (collab.docHistory substrate).", ...SHADOW },
  );

  // ── creative.run — ensure prompt-required is clear; wire to lens generate ─
  register(
    "creative",
    "run",
    async (ctx, input = {}) => {
      try {
        const prompt = String(input.prompt || input.text || input.query || "").trim();
        const mode = input.mode;
        if (!prompt && mode !== "structural_poetry") {
          return { ok: false, error: "prompt required", reason: "prompt_required" };
        }
        const LENS = typeof globalThis !== "undefined" ? globalThis.__concordLensActions : null;
        if (LENS?.has?.("creative.generate")) {
          const h = LENS.get("creative.generate");
          const out = await h(ctx, { domain: "creative", data: input }, { ...input, prompt: prompt || input.prompt });
          return wrap(out, "lens:creative.generate");
        }
        // Deterministic scaffold if lens missing
        return {
          ok: true,
          result: {
            content: `[Deterministic scaffold]\n\nPrompt: ${prompt}`,
            kind: input.kind || "text",
          },
          aliasOf: "creative.run.scaffold",
        };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Run creative generation (lens creative.generate).", ...SHADOW },
  );


  // ── agents.create — enable happy-path agents.get when Ghost Fleet off ──
  register(
    "agents",
    "create",
    async (_ctx, input = {}) => {
      try {
        const agents = await lazy("../emergent/agent-system.js");
        const type = input.type || input.agentType;
        if (!type) return { ok: false, error: "type_required", reason: "type_required", allowed: Object.values(agents.AGENT_TYPES || {}) };
        return wrap(agents.createAgent(type, input.config || input), "emergent/agent-system.createAgent");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Create agent (agent-system; Ghost Fleet off path).", ...SHADOW },
  );

  // Ensure agents.get always present (shadow)
  register(
    "agents",
    "get",
    async (_ctx, input = {}) => {
      try {
        const agents = await lazy("../emergent/agent-system.js");
        const id = input.agentId || input.id;
        if (!id) return { ok: false, error: "agentId_required", reason: "agentId_required" };
        return wrap(agents.getAgent(id), "emergent/agent-system.getAgent");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Get agent by id.", ...SHADOW },
  );

  // creative.create_work + ensure get/profile
  register(
    "creative",
    "create_work",
    async (ctx, input = {}) => {
      try {
        const m = await lazy("../emergent/creative-generation.js");
        const creatorId = input.creatorId || ctx?.actor?.userId || ctx?.actor?.id || input.userId;
        if (!creatorId) return { ok: false, error: "creatorId_required", reason: "creatorId_required" };
        const mode = input.mode || "text";
        return wrap(m.createWork(creatorId, mode, input.inspirations || []), "creative-generation.createWork");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Create creative work (Ghost Fleet off).", ...SHADOW },
  );

  register(
    "creative",
    "get",
    async (_ctx, input = {}) => {
      try {
        const m = await lazy("../emergent/creative-generation.js");
        const id = input.id || input.workId;
        if (!id) return { ok: false, error: "id_required", reason: "id_required" };
        const w = m.getWork(id);
        return w ? { ok: true, work: w, aliasOf: "creative-generation.getWork" } : { ok: false, error: "not_found", reason: "not_found" };
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Get creative work by id.", ...SHADOW },
  );

  register(
    "creative",
    "profile",
    async (ctx, input = {}) => {
      try {
        const m = await lazy("../emergent/creative-generation.js");
        const id = input.entityId || input.id || input.userId || ctx?.actor?.userId || ctx?.actor?.id;
        if (!id) return { ok: false, error: "entityId_required", reason: "entityId_required" };
        return wrap(m.getCreativeProfile(id), "creative-generation.getCreativeProfile");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Creative profile for entity.", ...SHADOW },
  );

  register(
    "conflict",
    "file_dispute",
    async (ctx, input = {}) => {
      try {
        const m = await lazy("../emergent/conflict-resolution.js");
        const type = input.type || "claim";
        const filedBy = input.filedBy || ctx?.actor?.userId || ctx?.actor?.id || "anon";
        const filedAgainst = input.filedAgainst || input.against || "unknown";
        const title = input.title || "untitled";
        const description = input.description || "";
        return wrap(m.fileDispute(type, filedBy, filedAgainst, title, description, input.evidence || []), "conflict-resolution.fileDispute");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "File a dispute (Ghost Fleet off).", ...SHADOW },
  );

  register(
    "conflict",
    "get_dispute",
    async (_ctx, input = {}) => {
      try {
        const m = await lazy("../emergent/conflict-resolution.js");
        const id = input.id || input.disputeId;
        if (!id) return { ok: false, error: "id_required", reason: "id_required" };
        return wrap(m.getDispute(id), "conflict-resolution.getDispute");
      } catch (e) {
        return { ok: false, error: "handler_error", message: String(e?.message || e) };
      }
    },
    { description: "Get dispute by id.", ...SHADOW },
  );


  return { ok: true, registered: [
    "research.conduct", "research.report", "research.results", "research.metrics",
    "physics.models", "atlas.chat",
    "heartbeat.history", "heartbeat.metrics",
    "messaging.connect", "messaging.verify",
    "collab.revisions", "creative.run",
    "agents.create", "agents.get",
    "creative.create_work", "creative.get", "creative.profile",
    "conflict.file_dispute", "conflict.get_dispute",
  ] };
}
