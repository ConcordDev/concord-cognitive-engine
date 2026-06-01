// server/lib/client-error-intake.js
//
// E4 — client-error intake (the client-side half of the Track-E observability
// loop: detect → count → triage → page).
//
// The frontend POSTs uncaught throws / unhandled rejections / resource-load
// failures / hydration breaks / explicit feedback bug-reports to
// `POST /api/client-error` (public-write, rate-limited, kill-switched). This
// pure-ish function is the single intake: it sanitises the envelope, runs it
// through the E3 severity classifier (bug-triage), increments the
// `concord_client_error_total{kind,severity}` Prometheus counter, mints a
// `machine.kind='client_error'` DTU for queryability (kept OUT of consolidation
// /economy/marketplace via the EXCLUDED_KINDS sets in server.js), and pages
// Critical findings via error-alerting.
//
// All I/O is injectable so it's unit-testable without the monolith (mirrors the
// E2 economy-anomaly-cycle pattern). Never throws — telemetry must not break the
// app, and the client clock / payload is untrusted (see the 2026 client-error
// best-practice: can't trust the client clock, scrub before persisting).
//
// Kill-switch: CONCORD_CLIENT_ERROR_INTAKE=0  (off == the route 204s, no DTU).

import { classify as defaultClassify, ROUTE } from "./bug-triage.js";

const KIND_MAX = 64;
const MSG_MAX = 1000;
const STACK_MAX = 4000;
const COMPONENT_STACK_MAX = 2000;
const SHORT_MAX = 200;
const ID_MAX = 80;
const BREADCRUMB_MAX = 20;
const BREADCRUMB_LEN = 160;

const clampStr = (v, n) => String(v ?? "").slice(0, n);

/**
 * Ingest one client-error envelope.
 *
 * @param {object} opts
 * @param {object} opts.body                 the (untrusted) request body
 * @param {(input:object)=>{severity:string,route:string,reasons:string[]}} [opts.classifyFn]
 * @param {(kind:string,severity:string)=>void} [opts.incCounter]   prom counter bump
 * @param {(record:object)=>Promise<any>} [opts.mintDtu]            DTU writer (runMacro dtu.create)
 * @param {(payload:object)=>Promise<any>} [opts.alert]             pager (error-alerting.sendAlert)
 * @param {()=>number} [opts.now]
 * @returns {Promise<{ok:boolean, disabled?:boolean, severity?:string, route?:string, paged?:boolean, dtuId?:string|null, kind?:string}>}
 */
export async function ingestClientError({
  body = {},
  classifyFn = defaultClassify,
  incCounter = () => {},
  mintDtu = async () => ({ ok: true }),
  alert = async () => {},
  now = Date.now,
} = {}) {
  if (process.env.CONCORD_CLIENT_ERROR_INTAKE === "0") return { ok: true, disabled: true };

  const b = body && typeof body === "object" ? body : {};
  const ctx = b.context && typeof b.context === "object" ? b.context : {};

  const kind = (clampStr(b.kind || "uncaught_throw", KIND_MAX) || "uncaught_throw").toLowerCase();
  const message = clampStr(b.message, MSG_MAX);
  const stack = clampStr(b.stack, STACK_MAX);
  const componentStack = clampStr(b.componentStack, COMPONENT_STACK_MAX);
  const lensId = clampStr(b.lensId ?? ctx.lensId ?? "unknown", ID_MAX);
  const worldId = clampStr(b.worldId ?? ctx.worldId ?? "", ID_MAX);
  const route = clampStr(b.route ?? ctx.route ?? "", SHORT_MAX);
  const buildId = clampStr(b.buildId ?? ctx.buildId ?? "", 64);
  const ua = clampStr(b.ua ?? ctx.ua ?? "", SHORT_MAX);
  const viewport = clampStr(b.viewport ?? ctx.viewport ?? "", 32);
  const breadcrumbs = Array.isArray(b.breadcrumbs)
    ? b.breadcrumbs.slice(-BREADCRUMB_MAX).map((x) => clampStr(typeof x === "string" ? x : safeJson(x), BREADCRUMB_LEN))
    : [];

  const sIn = b.signals && typeof b.signals === "object" ? b.signals : {};
  const signals = {
    dataLoss: !!sIn.dataLoss,
    security: !!sIn.security,
    moneyMoved: !!sIn.moneyMoved,
    affectedUsers: Number.isFinite(Number(sIn.affectedUsers)) ? Number(sIn.affectedUsers) : 0,
  };
  // userId is attached server-side from req.user — never trusted from the body.
  const userId = b.userId || null;

  const verdict = classifyFn({ source: "client_error", kind, signals }) || { severity: "minor", route: ROUTE.BOARD, reasons: [] };

  try { incCounter(kind, verdict.severity); } catch { /* telemetry best-effort */ }

  let dtuId = null;
  try {
    const r = await mintDtu({
      title: `client_error: ${kind} @ ${lensId || route || "unknown"}`.slice(0, 120),
      tags: ["client_error", kind, verdict.severity],
      human: { summary: message || "(no message)" },
      machine: {
        kind: "client_error",
        severity: verdict.severity,
        clientKind: kind,
        lensId, worldId, route, buildId, ua, viewport,
        breadcrumbs, stack, componentStack, userId,
        reasons: verdict.reasons,
        // server stamp — the client clock is untrusted (best-practice).
        reportedAt: now(),
      },
      meta: { source: "client_error", severity: verdict.severity, lensId, route },
      creatorType: "system",
    });
    dtuId = r?.dtu?.id || r?.id || null;
  } catch { /* persistence best-effort — never fail the intake */ }

  let paged = false;
  if (verdict.route === ROUTE.PAGE) {
    paged = true;
    try {
      await alert({
        title: `Client error (${verdict.severity}): ${kind}`,
        message: `${message || "(no message)"} — lens=${lensId || "?"} route=${route || "?"}`,
        severity: "error",
        fields: { kind, severity: verdict.severity, lensId, worldId, route, buildId, dtuId, reasons: verdict.reasons },
      });
    } catch { /* alerting optional */ }
  }

  return { ok: true, severity: verdict.severity, route: verdict.route, paged, dtuId, kind };
}

function safeJson(x) {
  try { return JSON.stringify(x); } catch { return String(x); }
}

export default ingestClientError;
