// server/lib/inference/otel-exporter.js
// OpenTelemetry exporter for Concord inference traces.
// Hooks into the existing tracer via addListener — zero overhead when disabled.
// Uses GenAI semantic conventions (gen_ai.*) with concord.* extensions.
//
// Enable via env:
//   CONCORD_OTEL_ENABLED=true
//   CONCORD_OTEL_ENDPOINT=http://otel-collector:4318/v1/traces
//   CONCORD_OTEL_HEADERS={"Authorization":"Bearer token"}

import { addListener } from "./tracer.js";

const ENABLED = process.env.CONCORD_OTEL_ENABLED === "true";
const ENDPOINT = process.env.CONCORD_OTEL_ENDPOINT || "";
const HEADERS_RAW = process.env.CONCORD_OTEL_HEADERS || "{}";

let _headers = {};
try { _headers = JSON.parse(HEADERS_RAW); } catch { /* use empty headers */ }

// In-flight trace accumulator: inferenceId → {spans[], startTime}
const _inflight = new Map();

function nowNs() {
  const [sec, ns] = process.hrtime();
  return (sec * 1_000_000_000n + BigInt(ns)).toString();
}

function msToNs(ms) {
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function buildResourceSpan(trace) {
  const rootSpan = trace.spans.find(s => s.type === "start");
  const finishSpan = trace.spans.find(s => s.type === "finish" || s.type === "failure");
  const startMs = rootSpan?.timestamp || Date.now();
  const endMs = finishSpan?.timestamp || Date.now();

  const attributes = [
    { key: "gen_ai.system", value: { stringValue: "concord" } },
    { key: "gen_ai.request.model", value: { stringValue: finishSpan?.data?.brainUsed || rootSpan?.data?.role || "unknown" } },
    { key: "gen_ai.operation.name", value: { stringValue: "infer" } },
    { key: "gen_ai.usage.input_tokens", value: { intValue: finishSpan?.data?.tokensIn || 0 } },
    { key: "gen_ai.usage.output_tokens", value: { intValue: finishSpan?.data?.tokensOut || 0 } },
    { key: "concord.inference_id", value: { stringValue: trace.inferenceId } },
    { key: "concord.lens", value: { stringValue: rootSpan?.data?.lensId || "" } },
    { key: "concord.caller_id", value: { stringValue: rootSpan?.data?.callerId || "" } },
    { key: "concord.role", value: { stringValue: rootSpan?.data?.role || "" } },
    { key: "concord.step_count", value: { intValue: finishSpan?.data?.stepCount || 0 } },
    { key: "concord.latency_ms", value: { intValue: finishSpan?.data?.latencyMs || (endMs - startMs) } },
  ];

  if (finishSpan?.data?.fallbacksUsed?.length) {
    attributes.push({ key: "concord.fallbacks_used", value: { stringValue: JSON.stringify(finishSpan.data.fallbacksUsed) } });
  }

  const status = trace.spans.some(s => s.type === "failure")
    ? { code: 2, message: trace.spans.find(s => s.type === "failure")?.data?.error || "unknown" }
    : { code: 1 };

  // Child spans for each step
  const childSpans = trace.spans
    .filter(s => s.type === "step")
    .map((s, i) => ({
      traceId: trace.traceId,
      spanId: generateSpanId(),
      parentSpanId: trace.rootSpanId,
      name: `concord.step.${s.data?.stepType || "inference"}`,
      kind: s.data?.stepType === "tool_call" ? 3 : 1, // CLIENT=3, INTERNAL=1
      startTimeUnixNano: msToNs(s.timestamp),
      endTimeUnixNano: msToNs(s.timestamp + (s.data?.latencyMs || 0)),
      attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: s.data?.stepType || "inference" } },
        { key: "concord.tool_name", value: { stringValue: s.data?.toolName || "" } },
        { key: "gen_ai.usage.input_tokens", value: { intValue: s.data?.tokensIn || 0 } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: s.data?.tokensOut || 0 } },
      ],
      status: s.data?.error ? { code: 2, message: s.data.error } : { code: 1 },
    }));

  return {
    resource: {
      attributes: [
        { key: "service.name", value: { stringValue: "concord" } },
        { key: "service.version", value: { stringValue: "5.0.0" } },
      ],
    },
    scopeSpans: [{
      scope: { name: "concord.inference", version: "1.0.0" },
      spans: [
        {
          traceId: trace.traceId,
          spanId: trace.rootSpanId,
          name: "concord.inference",
          kind: 1, // INTERNAL
          startTimeUnixNano: msToNs(startMs),
          endTimeUnixNano: msToNs(endMs),
          attributes,
          status,
        },
        ...childSpans,
      ],
    }],
  };
}

function generateTraceId() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function generateSpanId() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function exportTrace(trace) {
  if (!ENDPOINT) return;

  const body = JSON.stringify({
    resourceSpans: [buildResourceSpan(trace)],
  });

  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ..._headers,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // intentional: telemetry export failure should not surface to user
  }
}

// Wire into tracer if enabled
if (ENABLED) {
  addListener((span) => {
    const { inferenceId, type, timestamp, data } = span;

    if (type === "start") {
      _inflight.set(inferenceId, {
        inferenceId,
        traceId: generateTraceId(),
        rootSpanId: generateSpanId(),
        spans: [span],
      });
      return;
    }

    const trace = _inflight.get(inferenceId);
    if (!trace) return;

    trace.spans.push(span);

    if (type === "finish" || type === "failure") {
      _inflight.delete(inferenceId);
      exportTrace(trace).catch(() => {}); // intentional: telemetry export failure should not surface to user
    }
  });
}

export const otelExporter = {
  enabled: ENABLED,
  endpoint: ENDPOINT,
};
