// server/domains/lattice-seed.js
//
// Lens actions for the recovered Auto-DTU + ingest-scheduler loop
// (server/lib/lattice-seed.js, migration 416). Designed surface lives on
// the ingest lens as LatticeSeedPanel — these macros are the substrate,
// not a generic action wall.
//
// Quota / trust / fetch never read a caller-supplied privilege field.
// Role comes from ctx.actor.role. Fetch goes through fetchPublicUrl.

import * as seed from "../lib/lattice-seed.js";

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || "anon";
}

function actorRole(ctx) {
  return ctx?.actor?.role || "guest";
}

function dbOf(ctx) {
  return ctx?.db || null;
}

function inputOf(artifact, params) {
  return { ...(artifact?.data || {}), ...(params || {}) };
}

function fail(reason, extra = {}) {
  return { ok: false, reason, error: reason, ...extra };
}

function wrap(r) {
  if (!r || r.ok === false) {
    const reason = r?.reason || r?.error || "failed";
    const extra = r && typeof r === "object" ? { ...r } : {};
    delete extra.ok;
    return fail(reason, extra);
  }
  const rest = { ...r };
  delete rest.ok;
  return { ok: true, result: rest };
}

function mintDtuFromCtx(ctx) {
  const run = ctx?.macro?.run || ctx?.runMacro;
  if (typeof run !== "function") return null;
  return async (input) => run("dtu", "create", input);
}

export default function registerLatticeSeedActions(registerLensAction) {
  // input: {}
  registerLensAction("lattice-seed", "status", (ctx) => {
    try {
      return wrap(seed.status(dbOf(ctx), actorId(ctx), { role: actorRole(ctx) }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { rootUrl?: string, label: string, notes?: string }
  registerLensAction("lattice-seed", "createSource", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.createSource(dbOf(ctx), actorId(ctx), {
        rootUrl: input.rootUrl ?? input.root_url ?? null,
        label: input.label,
        notes: input.notes ?? null,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: {}
  registerLensAction("lattice-seed", "listSources", (ctx) => {
    try {
      return wrap(seed.listSources(dbOf(ctx), actorId(ctx)));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { sourceId: number, url: string }
  registerLensAction("lattice-seed", "queuePage", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.queuePage(dbOf(ctx), actorId(ctx), {
        sourceId: input.sourceId ?? input.source_id,
        url: input.url,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { sourceId?: number, status?: string }
  registerLensAction("lattice-seed", "listPages", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.listPages(dbOf(ctx), actorId(ctx), {
        sourceId: input.sourceId ?? input.source_id,
        status: input.status,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: {}  — quota from actor role, never from body.mode
  registerLensAction("lattice-seed", "executeNext", async (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(await seed.executeNext(dbOf(ctx), actorId(ctx), {
        role: actorRole(ctx),
        llm: ctx?.llm || null,
        fetchImpl: typeof input.fetchImpl === "function" ? input.fetchImpl : null,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { text: string, sourceLabel?: string }
  registerLensAction("lattice-seed", "proposeHypotheses", async (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(await seed.proposeHypotheses(dbOf(ctx), actorId(ctx), {
        text: input.text,
        sourceLabel: input.sourceLabel ?? input.source_label ?? null,
        llm: ctx?.llm || null,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { sourceLabel?: string }
  registerLensAction("lattice-seed", "listHypotheses", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.listHypotheses(dbOf(ctx), actorId(ctx), {
        sourceLabel: input.sourceLabel ?? input.source_label,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { topic: string, dtuKeys?: string[], layer?: string }
  registerLensAction("lattice-seed", "createResearchJob", async (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      const created = seed.createResearchJob(dbOf(ctx), actorId(ctx), {
        topic: input.topic,
        dtuKeys: input.dtuKeys ?? input.dtu_keys ?? [],
        layer: input.layer ?? null,
      });
      if (!created.ok) return wrap(created);
      const processed = await seed.processResearchJob(dbOf(ctx), actorId(ctx), created.id, {
        llm: ctx?.llm || null,
      });
      return wrap(processed.ok ? processed : { ...processed, id: created.id, status: "error" });
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { status?: string }
  registerLensAction("lattice-seed", "listResearchJobs", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.listResearchJobs(dbOf(ctx), actorId(ctx), { status: input.status }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { hypothesisId: number, layerHint?: string, kind?: string }
  registerLensAction("lattice-seed", "mintFromHypothesis", async (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(await seed.mintFromHypothesis(dbOf(ctx), actorId(ctx), {
        hypothesisId: input.hypothesisId ?? input.hypothesis_id,
        layerHint: input.layerHint ?? input.layer_hint ?? "HLM",
        kind: input.kind || "auto-hypothesis",
        llm: ctx?.llm || null,
        mintDtu: mintDtuFromCtx(ctx),
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { jobId: number, layerHint?: string, kind?: string }
  registerLensAction("lattice-seed", "mintFromResearchJob", async (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(await seed.mintFromResearchJob(dbOf(ctx), actorId(ctx), {
        jobId: input.jobId ?? input.job_id,
        layerHint: input.layerHint ?? input.layer_hint ?? "HLR",
        kind: input.kind || "auto-research",
        llm: ctx?.llm || null,
        mintDtu: mintDtuFromCtx(ctx),
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { key: string, trustLevel: "experimental" | "trusted" }
  registerLensAction("lattice-seed", "setTrust", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.setTrust(dbOf(ctx), actorId(ctx), {
        key: input.key,
        trustLevel: input.trustLevel ?? input.trust_level,
      }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { includeExperimental?: boolean }
  registerLensAction("lattice-seed", "listAutoDtus", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      const includeExperimental = input.includeExperimental !== false
        && input.includeExperimental !== "false"
        && input.includeExperimental !== "0";
      return wrap(seed.listAutoDtus(dbOf(ctx), actorId(ctx), { includeExperimental }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });

  // input: { scope?: string }
  registerLensAction("lattice-seed", "listMemory", (ctx, artifact, params) => {
    try {
      const input = inputOf(artifact, params);
      return wrap(seed.listMemory(dbOf(ctx), actorId(ctx), { scope: input.scope }));
    } catch (e) {
      return fail("handler_error", { message: String(e?.message || e) });
    }
  });
}
