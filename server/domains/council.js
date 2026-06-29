// server/domains/council.js
//
// Deterministic per-voice scoring heuristic: counts how many of the voice's
// "lens" keywords (split on whitespace, lowered, len ≥ 4) appear as
// case-insensitive substrings in the proposal text. The keyword-hit ratio
// maps to a delta of ±20 around a neutral 50 anchor. Same proposal +
// same voices → same score (no flakiness). Real LLM-scored deliberation
// is the council brain's job (see lib/council-world-bridge.js); this
// macro is the lightweight analytical lens that doesn't pay LLM cost.
function _voiceScoreFromLens(proposalText, lens) {
  const text = String(proposalText || "").toLowerCase();
  const tokens = String(lens || "general governance").toLowerCase().split(/\s+/).filter(t => t.length >= 4);
  if (tokens.length === 0 || text.length === 0) return 50;
  const hits = tokens.filter(t => text.includes(t)).length;
  const ratio = hits / tokens.length; // 0..1
  return Math.round(50 + (ratio * 40 - 20)); // 30..70 range
}

export default function registerCouncilActions(registerLensAction) {
  registerLensAction("council", "deliberate", (ctx, artifact, _params) => {
    // String()-coerce at the read site: a poisoned non-string proposal (number,
    // Infinity-ish) must not reach proposal.slice(...) and throw uncaught.
    const proposal = String(artifact.data?.proposal ?? artifact.data?.description ?? "");
    const voices = Array.isArray(artifact.data?.voices) ? artifact.data.voices : [];
    if (!proposal) return { ok: true, result: { message: "Submit a proposal for council deliberation." } };
    const perspectives = [
      { voice: "Pragmatist", weight: 0.3, lens: "feasibility and resource cost" },
      { voice: "Ethicist", weight: 0.25, lens: "moral implications and fairness" },
      { voice: "Innovator", weight: 0.2, lens: "novelty and growth potential" },
      { voice: "Guardian", weight: 0.25, lens: "risk and stability" },
    ];
    const evaluations = (voices.length > 0 ? voices : perspectives).map(v => {
      const lens = v.lens || "general governance";
      const score = _voiceScoreFromLens(proposal, lens);
      return { voice: v.voice || v.name, weight: v.weight || 0.25, score, position: score >= 60 ? "support" : score >= 40 ? "neutral" : "oppose", reasoning: `Evaluated through the lens of ${lens}` };
    });
    const weightedScore = Math.round(evaluations.reduce((s, e) => s + e.score * (e.weight || 0.25), 0));
    return { ok: true, result: { proposal: proposal.slice(0, 200), evaluations, weightedScore, recommendation: weightedScore >= 60 ? "Proceed" : weightedScore >= 40 ? "Revise and resubmit" : "Reject", consensus: evaluations.every(e => e.position === "support") ? "unanimous" : evaluations.filter(e => e.position === "support").length > evaluations.length / 2 ? "majority" : "no-consensus" } };
  });
  registerLensAction("council", "voteCount", (ctx, artifact, _params) => {
    const votes = Array.isArray(artifact.data?.votes) ? artifact.data.votes : [];
    const tally = { for: 0, against: 0, abstain: 0 };
    // String()-coerce the vote value: a poisoned non-string vote (number) must
    // not reach .toLowerCase() and throw uncaught.
    for (const v of votes) { const pos = String((v && (v.vote ?? v.position)) ?? "abstain").toLowerCase(); if (pos === "for" || pos === "yes" || pos === "support") tally.for++; else if (pos === "against" || pos === "no" || pos === "oppose") tally.against++; else tally.abstain++; }
    const total = votes.length;
    const forPercent = total > 0 ? Math.round((tally.for / total) * 100) : 0;
    // Fail-CLOSED: a poisoned quorum (NaN/±Infinity/1e308/-1) must not flip the
    // quorumMet verdict (e.g. -1 would make every count "quorate"). Default when
    // absent; reject when present-but-not-a-finite-non-negative number.
    const qRaw = artifact.data?.quorum;
    let quorum = 3;
    if (qRaw !== undefined && qRaw !== null && qRaw !== "") {
      quorum = Number(qRaw);
      if (!Number.isFinite(quorum) || quorum < 0) return { ok: false, error: "invalid_quorum" };
      quorum = Math.floor(quorum);
    }
    return { ok: true, result: { tally, total, forPercent, passed: forPercent >= 67, passThreshold: "67% supermajority", quorumMet: total >= quorum } };
  });
  registerLensAction("council", "generateMinutes", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Array-guard list inputs (a poisoned non-array string must not reach .map()
    // and throw uncaught) and String()-coerce title/date so the RETURN shape is
    // stable regardless of input poisoning.
    const agenda = Array.isArray(data.agenda) ? data.agenda : [];
    const attendees = Array.isArray(data.attendees) ? data.attendees : [];
    const decisions = Array.isArray(data.decisions) ? data.decisions : [];
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];
    return { ok: true, result: { title: String(data.title || "Council Meeting Minutes"), date: String(data.date || new Date().toISOString().split("T")[0]), attendees: attendees.length, agendaItems: agenda.map((a, i) => ({ item: i + 1, topic: (a && a.topic) || a, status: (a && a.status) || "discussed" })), decisions: decisions.map(d => ({ decision: (d && d.text) || d, votedBy: (d && d.votedBy) || "council", passed: !d || d.passed !== false })), actionItems: actionItems.map(a => ({ task: (a && a.task) || a, assignee: (a && a.assignee) || "unassigned", dueDate: (a && a.dueDate) || "TBD" })) } };
  });
  registerLensAction("council", "conflictResolution", (ctx, artifact, _params) => {
    // Array-guard parties + String()-coerce issue so poisoned input degrades
    // instead of throwing on parties.map() / issue.slice().
    const parties = Array.isArray(artifact.data?.parties) ? artifact.data.parties : [];
    const issue = String(artifact.data?.issue ?? artifact.data?.description ?? "");
    const positions = parties.map(p => ({ party: (p && p.name) || p, position: (p && p.position) || "unstated", priority: (p && p.priority) || "medium" }));
    const commonGround = positions.filter(p => p.priority === "high").length > positions.length / 2 ? "shared-urgency" : "divergent-priorities";
    return { ok: true, result: { issue: issue.slice(0, 200), parties: positions, commonGround, suggestedApproach: commonGround === "shared-urgency" ? "Mediated negotiation — both sides want resolution" : "Structured dialogue — find common interests first", steps: ["Identify shared interests", "Map each party's needs vs wants", "Generate options that satisfy core needs", "Evaluate options against criteria", "Build agreement incrementally"] } };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2026 feature-parity backlog — meeting scheduling, agenda builder,
  // action-item tracking, quorum enforcement, document packet, ranked-choice
  // tabulation, decision archive. Parity targets: Loomio + Convene.
  //
  // All state lives in globalThis._concordSTATE.councilLens, per-user scoped.
  // ─────────────────────────────────────────────────────────────────────────

  function getCouncilState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.councilLens) {
      STATE.councilLens = {
        meetings: new Map(),   // userId -> Array<meeting>
        actions: new Map(),    // userId -> Array<actionItem>
        decisions: new Map(),  // userId -> Array<decisionRecord>
      };
    }
    const s = STATE.councilLens;
    if (!s.meetings) s.meetings = new Map();
    if (!s.actions) s.actions = new Map();
    if (!s.decisions) s.decisions = new Map();
    return s;
  }
  function cUid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function cList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }
  function cNextId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function cNow() { return new Date().toISOString(); }
  function cSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  // ── Meetings: agenda builder + scheduling + attendance/RSVP ──

  registerLensAction("council", "meeting-list", (ctx, _a, _p = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = cList(s.meetings, cUid(ctx)).slice()
      .sort((a, b) => String(b.scheduledAt || "").localeCompare(String(a.scheduledAt || "")));
    return { ok: true, result: { meetings: list, total: list.length } };
  });

  registerLensAction("council", "meeting-create", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const scheduledAt = String(params.scheduledAt || "").trim();
    if (!scheduledAt) return { ok: false, error: "scheduledAt required" };
    const quorumThreshold = Math.max(0, parseInt(params.quorumThreshold) || 0);
    const meeting = {
      id: cNextId("mtg"),
      title,
      scheduledAt,
      location: String(params.location || "").trim(),
      description: String(params.description || "").trim(),
      status: "scheduled", // scheduled | in_progress | concluded | cancelled
      quorumThreshold,
      agenda: [],     // [{ id, topic, presenter, durationMin, order, status }]
      attendees: [],  // [{ id, name, role, rsvp, present }]
      packet: [],     // [{ id, name, url, kind, addedAt }]
      createdAt: cNow(),
      updatedAt: cNow(),
    };
    cList(s.meetings, cUid(ctx)).push(meeting);
    cSave();
    return { ok: true, result: { meeting } };
  });

  function findMeeting(s, userId, meetingId) {
    return cList(s.meetings, userId).find(m => m.id === meetingId) || null;
  }

  registerLensAction("council", "meeting-update", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.id);
    if (!m) return { ok: false, error: "meeting not found" };
    for (const k of ["title", "scheduledAt", "location", "description", "status"]) {
      if (params[k] !== undefined) m[k] = typeof params[k] === "string" ? params[k] : m[k];
    }
    if (params.quorumThreshold !== undefined) {
      m.quorumThreshold = Math.max(0, parseInt(params.quorumThreshold) || 0);
    }
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m } };
  });

  registerLensAction("council", "meeting-delete", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cUid(ctx);
    const list = cList(s.meetings, userId);
    const idx = list.findIndex(m => m.id === params.id);
    if (idx < 0) return { ok: false, error: "meeting not found" };
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Agenda items (timed) ──

  registerLensAction("council", "agenda-add", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const topic = String(params.topic || "").trim();
    if (!topic) return { ok: false, error: "topic required" };
    const item = {
      id: cNextId("agi"),
      topic,
      presenter: String(params.presenter || "").trim(),
      durationMin: Math.max(1, parseInt(params.durationMin) || 10),
      order: m.agenda.length,
      status: "pending", // pending | discussed | deferred
      notes: "",
    };
    m.agenda.push(item);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, item } };
  });

  registerLensAction("council", "agenda-update", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const item = m.agenda.find(a => a.id === params.itemId);
    if (!item) return { ok: false, error: "agenda item not found" };
    if (params.topic !== undefined) item.topic = String(params.topic);
    if (params.presenter !== undefined) item.presenter = String(params.presenter);
    if (params.durationMin !== undefined) item.durationMin = Math.max(1, parseInt(params.durationMin) || item.durationMin);
    if (params.status !== undefined && ["pending", "discussed", "deferred"].includes(params.status)) item.status = params.status;
    if (params.notes !== undefined) item.notes = String(params.notes);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, item } };
  });

  registerLensAction("council", "agenda-remove", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const idx = m.agenda.findIndex(a => a.id === params.itemId);
    if (idx < 0) return { ok: false, error: "agenda item not found" };
    m.agenda.splice(idx, 1);
    m.agenda.forEach((a, i) => { a.order = i; });
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m } };
  });

  registerLensAction("council", "agenda-reorder", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const order = Array.isArray(params.order) ? params.order : [];
    if (order.length !== m.agenda.length) return { ok: false, error: "order length mismatch" };
    const byId = new Map(m.agenda.map(a => [a.id, a]));
    const reordered = [];
    for (const id of order) {
      const a = byId.get(id);
      if (!a) return { ok: false, error: `unknown agenda item ${id}` };
      reordered.push(a);
    }
    reordered.forEach((a, i) => { a.order = i; });
    m.agenda = reordered;
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m } };
  });

  // ── Attendance + RSVP ──

  registerLensAction("council", "attendee-add", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (m.attendees.some(at => at.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "attendee already added" };
    }
    const attendee = {
      id: cNextId("att"),
      name,
      role: String(params.role || "member").trim(),
      rsvp: "no_response", // yes | no | maybe | no_response
      present: false,
    };
    m.attendees.push(attendee);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, attendee } };
  });

  registerLensAction("council", "attendee-rsvp", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const at = m.attendees.find(a => a.id === params.attendeeId);
    if (!at) return { ok: false, error: "attendee not found" };
    const rsvp = String(params.rsvp || "");
    if (!["yes", "no", "maybe", "no_response"].includes(rsvp)) {
      return { ok: false, error: "rsvp invalid" };
    }
    at.rsvp = rsvp;
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, attendee: at } };
  });

  registerLensAction("council", "attendee-check-in", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const at = m.attendees.find(a => a.id === params.attendeeId);
    if (!at) return { ok: false, error: "attendee not found" };
    at.present = params.present === undefined ? !at.present : !!params.present;
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, attendee: at } };
  });

  registerLensAction("council", "attendee-remove", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const idx = m.attendees.findIndex(a => a.id === params.attendeeId);
    if (idx < 0) return { ok: false, error: "attendee not found" };
    m.attendees.splice(idx, 1);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m } };
  });

  // ── Quorum enforcement ──

  registerLensAction("council", "quorum-check", (ctx, _a, params = {}) => {
  try {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const present = m.attendees.filter(a => a.present).length;
    const required = m.quorumThreshold;
    const met = required <= 0 ? m.attendees.length > 0 : present >= required;
    return {
      ok: true,
      result: {
        meetingId: m.id,
        present,
        invited: m.attendees.length,
        required,
        quorumMet: met,
        canTally: met,
        message: met
          ? "Quorum met — voting and tally permitted."
          : `Quorum not met — ${present}/${required} present. Tally blocked.`,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Document packet / board book ──

  registerLensAction("council", "packet-add", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const url = String(params.url || "").trim();
    const doc = {
      id: cNextId("doc"),
      name,
      url,
      kind: String(params.kind || "document").trim(), // document | link | proposal | report
      addedAt: cNow(),
    };
    m.packet.push(doc);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m, document: doc } };
  });

  registerLensAction("council", "packet-remove", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = findMeeting(s, cUid(ctx), params.meetingId);
    if (!m) return { ok: false, error: "meeting not found" };
    const idx = m.packet.findIndex(d => d.id === params.documentId);
    if (idx < 0) return { ok: false, error: "document not found" };
    m.packet.splice(idx, 1);
    m.updatedAt = cNow();
    cSave();
    return { ok: true, result: { meeting: m } };
  });

  // ── Action-item tracking (from minutes) ──

  registerLensAction("council", "action-list", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    let list = cList(s.actions, cUid(ctx)).slice();
    if (params.meetingId) list = list.filter(a => a.meetingId === params.meetingId);
    if (params.status && params.status !== "all") list = list.filter(a => a.status === params.status);
    list.sort((a, b) => String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    const open = list.filter(a => a.status === "open").length;
    const overdue = list.filter(a => a.status === "open" && a.dueDate && a.dueDate < cNow().slice(0, 10)).length;
    return { ok: true, result: { actions: list, total: list.length, open, overdue } };
  });

  registerLensAction("council", "action-create", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const description = String(params.description || "").trim();
    if (!description) return { ok: false, error: "description required" };
    const action = {
      id: cNextId("act"),
      description,
      owner: String(params.owner || "").trim(),
      dueDate: String(params.dueDate || "").trim(),
      meetingId: params.meetingId ? String(params.meetingId) : null,
      status: "open", // open | done | carried_forward
      carriedFromMeetingId: null,
      createdAt: cNow(),
      updatedAt: cNow(),
    };
    cList(s.actions, cUid(ctx)).push(action);
    cSave();
    return { ok: true, result: { action } };
  });

  registerLensAction("council", "action-update", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const a = cList(s.actions, cUid(ctx)).find(x => x.id === params.id);
    if (!a) return { ok: false, error: "action not found" };
    if (params.description !== undefined) a.description = String(params.description);
    if (params.owner !== undefined) a.owner = String(params.owner);
    if (params.dueDate !== undefined) a.dueDate = String(params.dueDate);
    if (params.status !== undefined && ["open", "done", "carried_forward"].includes(params.status)) {
      a.status = params.status;
    }
    a.updatedAt = cNow();
    cSave();
    return { ok: true, result: { action: a } };
  });

  registerLensAction("council", "action-delete", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = cList(s.actions, cUid(ctx));
    const idx = list.findIndex(x => x.id === params.id);
    if (idx < 0) return { ok: false, error: "action not found" };
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });

  // Carry an open action into a new meeting — marks the source carried_forward
  // and creates a fresh open action linked to the target meeting.
  registerLensAction("council", "action-carry-forward", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = cUid(ctx);
    const a = cList(s.actions, userId).find(x => x.id === params.id);
    if (!a) return { ok: false, error: "action not found" };
    if (a.status !== "open") return { ok: false, error: "only open actions can be carried forward" };
    const targetMeetingId = params.targetMeetingId ? String(params.targetMeetingId) : null;
    if (targetMeetingId && !findMeeting(s, userId, targetMeetingId)) {
      return { ok: false, error: "target meeting not found" };
    }
    a.status = "carried_forward";
    a.updatedAt = cNow();
    const carried = {
      id: cNextId("act"),
      description: a.description,
      owner: String(params.owner ?? a.owner),
      dueDate: String(params.dueDate ?? a.dueDate),
      meetingId: targetMeetingId,
      status: "open",
      carriedFromMeetingId: a.meetingId,
      createdAt: cNow(),
      updatedAt: cNow(),
    };
    cList(s.actions, userId).push(carried);
    cSave();
    return { ok: true, result: { source: a, carried } };
  });

  // ── Ranked-choice tabulation (instant-runoff voting) ──
  //
  // params.ballots: [{ voter, ranking: [candidateId, ...] }]
  // params.candidates: [{ id, label }]  (optional — derived from ballots if absent)
  // Runs IRV rounds: eliminate lowest each round, redistribute, until majority.

  registerLensAction("council", "ranked-choice-tabulate", (_ctx, artifact, params = {}) => {
  try {
    const ballots = Array.isArray(params.ballots) ? params.ballots
      : Array.isArray(artifact?.data?.ballots) ? artifact.data.ballots : [];
    if (ballots.length === 0) return { ok: false, error: "no ballots provided" };
    const candidateSet = new Set();
    for (const b of ballots) {
      for (const c of (b.ranking || [])) candidateSet.add(String(c));
    }
    const declared = Array.isArray(params.candidates) ? params.candidates : [];
    for (const c of declared) candidateSet.add(String(c.id ?? c));
    const labels = {};
    for (const c of declared) labels[String(c.id ?? c)] = String(c.label ?? c.id ?? c);
    let active = Array.from(candidateSet);
    if (active.length === 0) return { ok: false, error: "no candidates found in ballots" };
    const totalBallots = ballots.length;
    const majority = Math.floor(totalBallots / 2) + 1;
    const rounds = [];
    const eliminated = [];
    let winner = null;
    let guard = 0;
    while (active.length > 0 && guard < 100) {
      guard++;
      const counts = {};
      for (const c of active) counts[c] = 0;
      let exhausted = 0;
      for (const b of ballots) {
        const top = (b.ranking || []).map(String).find(c => active.includes(c));
        if (top) counts[top]++;
        else exhausted++;
      }
      const tallies = active
        .map(c => ({ candidate: c, label: labels[c] || c, votes: counts[c] }))
        .sort((a, b) => b.votes - a.votes);
      rounds.push({ round: rounds.length + 1, tallies, exhausted, majority });
      const leader = tallies[0];
      if (leader && leader.votes >= majority) { winner = leader; break; }
      if (active.length <= 1) { winner = leader || null; break; }
      const minVotes = Math.min(...tallies.map(t => t.votes));
      const losers = tallies.filter(t => t.votes === minVotes).map(t => t.candidate);
      // Tie-break deterministically: drop the lexicographically-last loser.
      const drop = losers.slice().sort()[losers.length - 1];
      eliminated.push(drop);
      active = active.filter(c => c !== drop);
    }
    return {
      ok: true,
      result: {
        method: "instant_runoff",
        totalBallots,
        majority,
        rounds,
        eliminated,
        winner: winner ? { candidate: winner.candidate, label: winner.label, votes: winner.votes } : null,
        decided: !!winner && winner.votes >= majority,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Decision archive + full-text search ──

  registerLensAction("council", "decision-archive", (ctx, _a, params = {}) => {
  try {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    // Fail-CLOSED: poisoned vote tallies (NaN/±Infinity/1e308/-1) must not be
    // silently coerced to 0 and archived as a real decision record. Default when
    // absent; reject when present-but-not-a-finite-non-negative-integer.
    const voteTally = (v, label) => {
      if (v === undefined || v === null || v === "") return 0;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return { _invalid: label };
      return Math.floor(n);
    };
    const votesFor = voteTally(params.votesFor, "votesFor");
    if (votesFor && typeof votesFor === "object") return { ok: false, error: "invalid_votesFor" };
    const votesAgainst = voteTally(params.votesAgainst, "votesAgainst");
    if (votesAgainst && typeof votesAgainst === "object") return { ok: false, error: "invalid_votesAgainst" };
    const record = {
      id: cNextId("dec"),
      title,
      summary: String(params.summary || "").trim(),
      outcome: String(params.outcome || "decided").trim(), // passed | rejected | tabled | decided
      proposalId: params.proposalId ? String(params.proposalId) : null,
      meetingId: params.meetingId ? String(params.meetingId) : null,
      votesFor,
      votesAgainst,
      tags: Array.isArray(params.tags) ? params.tags.map(t => String(t).trim()).filter(Boolean) : [],
      decidedAt: String(params.decidedAt || "").trim() || cNow(),
      createdAt: cNow(),
    };
    cList(s.decisions, cUid(ctx)).push(record);
    cSave();
    return { ok: true, result: { decision: record } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("council", "decision-search", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    let list = cList(s.decisions, cUid(ctx)).slice();
    const q = String(params.query || "").trim().toLowerCase();
    if (q) {
      list = list.filter(d => {
        const hay = `${d.title} ${d.summary} ${d.outcome} ${(d.tags || []).join(" ")}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (params.outcome && params.outcome !== "all") {
      list = list.filter(d => d.outcome === params.outcome);
    }
    list.sort((a, b) => String(b.decidedAt || "").localeCompare(String(a.decidedAt || "")));
    return { ok: true, result: { decisions: list, total: list.length, query: q } };
  });

  registerLensAction("council", "decision-delete", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const list = cList(s.decisions, cUid(ctx));
    const idx = list.findIndex(d => d.id === params.id);
    if (idx < 0) return { ok: false, error: "decision not found" };
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });
}
