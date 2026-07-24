// server/lib/marathon-digest.js
//
// Deterministic, non-LLM progress digest for a marathon session
// (Sprint 12/13 companion — same honesty precedent as agent-marathon.js's
// own compressMarathonHistory: a PURE condensation of real fields, never
// a fabricated summary).
//
// Gap this closes: MarathonPanel.tsx renders raw turn content (truncated
// to 1500 chars per turn) with no human-legible "here's where things
// stand" summary — a user has to read every turn to know what happened.
//
// This module is built ONLY from real `agent_marathon_sessions` +
// `agent_marathon_turns` columns (status/total_turns/max_turns/created_at
// and each turn's role/content/tool_calls_json/artifacts_json). It makes
// NO brain/LLM call of any kind — that's a mechanically-checkable
// invariant, not just a stated intent: this file's source contains no
// reference to any brain/chat client (no import of chat-agent.js,
// brain-config.js, brain-router.js, no `ctx.llm`, no `brainChat`, no
// "ollama"). tests/marathon-digest.test.js greps this file's own source
// to prove it.

function safeParseJSON(s, fallback) {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && mins) parts.push(`${mins}m`);
  if (!days && !hours && !mins) parts.push("<1m");
  return parts.join(" ");
}

/**
 * Build a deterministic progress digest for a marathon session, from real
 * `agent_marathon_turns` rows only (turns / tool_calls_json / artifacts_json)
 * plus the session row's own status/turn-count/timestamps.
 *
 * @param {object} db
 * @param {string} sessionId
 * @returns {{ ok: boolean, reason?: string, text?: string, digest?: object }}
 */
export function buildMarathonDigest(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };

  let session;
  try {
    session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  } catch {
    return { ok: false, reason: "table_missing" };
  }
  if (!session) return { ok: false, reason: "not_found" };

  let turns = [];
  try {
    turns = db.prepare(`
      SELECT turn_index, role, content, tool_calls_json, artifacts_json
      FROM agent_marathon_turns
      WHERE session_id = ?
      ORDER BY turn_index ASC
    `).all(sessionId);
  } catch {
    return { ok: false, reason: "turns_table_missing" };
  }

  const toolTally = new Map();
  let totalToolCalls = 0;
  let artifactCount = 0;
  const artifactKinds = new Map();
  let assistantTurns = 0;
  let checkpointTurns = 0;
  let lastAssistantContent = "";
  let lastAssistantTurnIndex = -1;

  for (const t of turns) {
    if (t.role === "system") {
      // A rolling checkpoint turn (migration 387) is real prior-turn content
      // that's been folded/condensed — count it, but it's not a fresh
      // assistant reply for "most recent update" purposes.
      checkpointTurns++;
    }
    if (t.role === "assistant") {
      assistantTurns++;
      if (t.turn_index >= lastAssistantTurnIndex) {
        lastAssistantTurnIndex = t.turn_index;
        lastAssistantContent = String(t.content || "");
      }
    }

    const calls = safeParseJSON(t.tool_calls_json, null);
    if (Array.isArray(calls)) {
      for (const c of calls) {
        const name = (c && typeof c.tool === "string" && c.tool.trim()) || "unknown_tool";
        toolTally.set(name, (toolTally.get(name) || 0) + 1);
        totalToolCalls++;
      }
    }

    const artifacts = safeParseJSON(t.artifacts_json, null);
    if (Array.isArray(artifacts)) {
      for (const a of artifacts) {
        artifactCount++;
        const kind = (a && typeof a.kind === "string" && a.kind.trim()) || "unknown";
        artifactKinds.set(kind, (artifactKinds.get(kind) || 0) + 1);
      }
    }
  }

  const nowS = Math.floor(Date.now() / 1000);
  const ageS = Number.isFinite(session.created_at) ? nowS - session.created_at : null;

  const toolBreakdown = Array.from(toolTally.entries()).sort((a, b) => b[1] - a[1]);
  const artifactBreakdown = Array.from(artifactKinds.entries()).sort((a, b) => b[1] - a[1]);

  const lines = [];
  lines.push(`Marathon "${session.title || (session.goal || "").slice(0, 60)}" — status: ${session.status}`);
  lines.push(`Turns: ${session.total_turns}/${session.max_turns} (${assistantTurns} assistant reply/replies, ${checkpointTurns} checkpoint(s) folded)`);
  if (ageS != null) lines.push(`Been running for: ${formatDuration(ageS)}`);
  lines.push(totalToolCalls > 0
    ? `Tool calls so far (${totalToolCalls} total): ${toolBreakdown.map(([n, c]) => `${n}×${c}`).join(", ")}`
    : "Tool calls so far: none recorded yet");
  if (artifactCount > 0) {
    lines.push(`Artifacts produced (${artifactCount} total): ${artifactBreakdown.map(([n, c]) => `${n}×${c}`).join(", ")}`);
  }
  lines.push(lastAssistantContent
    ? `Most recent update (turn ${lastAssistantTurnIndex}): ${lastAssistantContent.replace(/\s+/g, " ").trim().slice(0, 400)}`
    : "No assistant turns recorded yet.");

  return {
    ok: true,
    text: lines.join("\n"),
    digest: {
      sessionId,
      status: session.status,
      title: session.title,
      goal: session.goal,
      totalTurns: session.total_turns,
      maxTurns: session.max_turns,
      assistantTurns,
      checkpointTurns,
      ageSeconds: ageS,
      toolCallTotal: totalToolCalls,
      toolCallBreakdown: toolBreakdown.map(([tool, count]) => ({ tool, count })),
      artifactTotal: artifactCount,
      artifactBreakdown: artifactBreakdown.map(([kind, count]) => ({ kind, count })),
      lastAssistantTurnIndex: lastAssistantTurnIndex >= 0 ? lastAssistantTurnIndex : null,
      lastAssistantExcerpt: lastAssistantContent.slice(0, 1000),
    },
  };
}
