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
  // Real Proposal artifacts (concord-frontend/app/lenses/council/page.tsx's
  // `Proposal` interface) store votes as `Record<stakeholderId, VoteChoice>` —
  // a KEYED OBJECT, never an array — and never set `agenda`/`attendees`/
  // `decisions`/`actionItems`/`parties` at all (they carry `discussion` /
  // `amendments` / `coSponsors` / `sponsor` / `votingMethod` instead). The
  // CouncilActionPanel virtual-artifact convention, by contrast, calls these
  // same macros with a synthetic artifact whose `data` IS the caller's raw
  // params (`{ votes: [...] }`, `{ agenda, attendees, decisions, actionItems }`,
  // `{ issue, parties }`). Both shapes are handled below — real fields are
  // read/mapped where a genuine analog exists, and never fabricated as a
  // faux-empty success where no analog exists (see conflictResolution).
  function _looksLikeRealProposal(data) {
    return Array.isArray(data.discussion) || Array.isArray(data.amendments) ||
      Array.isArray(data.coSponsors) || typeof data.sponsor === "string" ||
      typeof data.votingMethod === "string" ||
      (data.votes && typeof data.votes === "object" && !Array.isArray(data.votes));
  }

  registerLensAction("council", "voteCount", (ctx, artifact, _params) => {
    const rawVotes = artifact.data?.votes;
    let votes;
    if (Array.isArray(rawVotes)) {
      // CouncilActionPanel shape: an array of ballot rows [{ vote|position }].
      votes = rawVotes;
    } else if (rawVotes && typeof rawVotes === "object") {
      // Real Proposal shape: Record<stakeholderId, VoteChoice>. Object.values
      // gives us the VoteChoice string per stakeholder; wrap each as a
      // pseudo-ballot row so the tally loop below is unchanged.
      votes = Object.values(rawVotes).map(choice => ({ vote: choice }));
    } else {
      votes = [];
    }
    const tally = { for: 0, against: 0, abstain: 0 };
    // VoteChoice enum values (strongly_support/support/abstain/oppose/
    // strongly_oppose/block) map onto the for/against/abstain tally alongside
    // the legacy for/yes/support/against/no/oppose strings the panel sends.
    const FOR_CHOICES = new Set(["for", "yes", "support", "strongly_support"]);
    const AGAINST_CHOICES = new Set(["against", "no", "oppose", "strongly_oppose", "block"]);
    // String()-coerce the vote value: a poisoned non-string vote (number) must
    // not reach .toLowerCase() and throw uncaught.
    for (const v of votes) {
      const pos = String((v && (v.vote ?? v.position)) ?? "abstain").toLowerCase();
      if (FOR_CHOICES.has(pos)) tally.for++;
      else if (AGAINST_CHOICES.has(pos)) tally.against++;
      else tally.abstain++;
    }
    const total = votes.length;
    const forPercent = total > 0 ? Math.round((tally.for / total) * 100) : 0;
    // quorumRequired is the real Proposal field name; `quorum` is kept for the
    // generic/virtual-artifact caller convention.
    const quorum = parseInt(artifact.data?.quorumRequired ?? artifact.data?.quorum) || 3;
    return { ok: true, result: { tally, total, forPercent, passed: forPercent >= 67, passThreshold: "67% supermajority", quorumMet: total >= quorum } };
  });
  registerLensAction("council", "generateMinutes", (ctx, artifact, _params) => {
  try {
    const data = artifact.data || {};
    // Array-guard list inputs (a poisoned non-array string must not reach .map()
    // and throw uncaught) and String()-coerce title/date so the RETURN shape is
    // stable regardless of input poisoning.
    const hasExplicitMeetingShape = Array.isArray(data.agenda) || Array.isArray(data.attendees) ||
      Array.isArray(data.decisions) || Array.isArray(data.actionItems);
    const asProposal = !hasExplicitMeetingShape && _looksLikeRealProposal(data);

    let agenda, attendees, decisions;
    if (asProposal) {
      // Agenda ← the proposal's real discussion thread (each comment is a
      // topic that was actually raised and discussed).
      agenda = Array.isArray(data.discussion)
        ? data.discussion.map(c => ({ topic: (c && c.content) || "discussion", status: "discussed" }))
        : [];
      // Attendees ← sponsor + co-sponsors, the real participant list a
      // Proposal tracks (there is no meeting-attendance concept on Proposal).
      attendees = [
        ...(typeof data.sponsor === "string" && data.sponsor ? [data.sponsor] : []),
        ...(Array.isArray(data.coSponsors) ? data.coSponsors : []),
      ];
      // Decisions ← amendments: an amendment's accepted/rejected status IS a
      // real decision the council made on that proposal.
      decisions = Array.isArray(data.amendments)
        ? data.amendments.map(a => ({ text: (a && a.title) || "amendment", votedBy: (a && a.author) || "council", passed: !!a && a.status === "accepted" }))
        : [];
      // actionItems: Proposal has no action-item field at all — leaving this
      // empty is the honest answer (nothing invented), not a bug.
    } else {
      agenda = Array.isArray(data.agenda) ? data.agenda : [];
      attendees = Array.isArray(data.attendees) ? data.attendees : [];
      decisions = Array.isArray(data.decisions) ? data.decisions : [];
    }
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];
    return {
      ok: true,
      result: {
        title: String(data.title || "Council Meeting Minutes"),
        date: String(data.date || new Date().toISOString().split("T")[0]),
        attendees: attendees.length,
        agendaItems: agenda.map((a, i) => ({ item: i + 1, topic: (a && a.topic) || a, status: (a && a.status) || "discussed" })),
        decisions: decisions.map(d => ({ decision: (d && d.text) || d, votedBy: (d && d.votedBy) || "council", passed: !d || d.passed !== false })),
        actionItems: actionItems.map(a => ({ task: (a && a.task) || a, assignee: (a && a.assignee) || "unassigned", dueDate: (a && a.dueDate) || "TBD" })),
        ...(asProposal ? { derivedFrom: "proposal", note: "Agenda/attendees/decisions derived from this proposal's discussion, sponsors, and amendments — proposals don't track a formal meeting agenda or action items." } : {}),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
  registerLensAction("council", "conflictResolution", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    // Array-guard parties + String()-coerce issue so poisoned input degrades
    // instead of throwing on parties.map() / issue.slice().
    const partiesGiven = Array.isArray(data.parties) ? data.parties : null;
    // A real Proposal has no "opposing parties with positions/priorities"
    // concept at all — discussion authors aren't structured that way, and
    // inventing priority/position fields for them would be fabrication, not
    // derivation. When parties genuinely weren't supplied AND this is a real
    // Proposal artifact, say so honestly instead of returning an empty-but-
    // successful conflict analysis that looks like "no conflict found."
    if (partiesGiven === null && _looksLikeRealProposal(data)) {
      return {
        ok: false,
        error: "not_applicable",
        reason: "not_applicable",
        message: "Proposals don't track structured conflict parties (names/positions/priorities) — conflict resolution needs that data supplied explicitly, or use Deliberate instead.",
      };
    }
    const parties = partiesGiven || [];
    const issue = String(data.issue ?? data.description ?? "");
    const positions = parties.map(p => ({ party: (p && p.name) || p, position: (p && p.position) || "unstated", priority: (p && p.priority) || "medium" }));
    const commonGround = positions.filter(p => p.priority === "high").length > positions.length / 2 ? "shared-urgency" : "divergent-priorities";
    return { ok: true, result: { issue: issue.slice(0, 200), parties: positions, commonGround, suggestedApproach: commonGround === "shared-urgency" ? "Mediated negotiation — both sides want resolution" : "Structured dialogue — find common interests first", steps: ["Identify shared interests", "Map each party's needs vs wants", "Generate options that satisfy core needs", "Evaluate options against criteria", "Build agreement incrementally"] } };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2026 feature-parity backlog — meeting scheduling, agenda builder,
  // action-item tracking, quorum enforcement, document packet, ranked-choice
  // tabulation, decision archive. Parity targets: Loomio + Convene.
  //
  // One shared council. Meetings, actions, decisions, proposals, votes,
  // members, and the audit log live under the "_shared" key. Older per-user
  // buckets are folded in (authorId kept) and left in place — the fold is
  // idempotent and does not delete the source arrays.
  // ─────────────────────────────────────────────────────────────────────────

  const C_SHARED = "_shared";
  const C_VOTE_CHOICES = ["strongly_support", "support", "abstain", "oppose", "strongly_oppose", "block"];
  const C_VOTE_FOR = new Set(["strongly_support", "support", "for", "yes", "approve"]);
  const C_VOTE_AGAINST = new Set(["oppose", "strongly_oppose", "block", "against", "no"]);
  const C_PROPOSAL_TYPES = ["policy", "budget", "amendment", "resolution", "motion"];
  const C_PROPOSAL_STATUSES = ["draft", "discussion", "voting", "decided", "implemented", "rejected"];
  const C_VOTING_METHODS = ["simple_majority", "supermajority", "ranked_choice", "approval", "consent"];
  const C_AUDIT_CATEGORIES = ["vote", "proposal", "amendment", "budget", "stakeholder", "debate"];

  function getCouncilState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.councilLens) STATE.councilLens = {};
    const s = STATE.councilLens;
    for (const k of ["meetings", "actions", "decisions", "proposals", "audit", "members"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    if (!Array.isArray(s.foldedIds)) s.foldedIds = [];
    migrateCouncilShared(s);
    return s;
  }
  function cUid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  // Signed-in actors only. "anon" is the missing-user fallback, not a member.
  function cUser(ctx) {
    const id = ctx?.actor?.userId || ctx?.userId || "";
    if (!id || id === "anon") return null;
    return String(id);
  }
  function cShared(map) {
    if (!map.has(C_SHARED)) map.set(C_SHARED, []);
    return map.get(C_SHARED);
  }
  // Every read/write goes to the shared list. The userId argument remains so
  // existing call sites stay stable; it is not a partition key.
  function cList(map, _userId) {
    return cShared(map);
  }
  function cOneOf(value, allowed, fallback) {
    const v = String(value || "");
    return allowed.includes(v) ? v : fallback;
  }
  function cActorName(ctx, params) {
    const raw = params?.authorName || params?.actorName || params?.displayName
      || ctx?.actor?.displayName || ctx?.actor?.username || "";
    const name = String(raw).trim().slice(0, 80);
    if (name && name.toLowerCase() !== "council chair") return name;
    return cUser(ctx) || cUid(ctx);
  }
  function cCopyItem(item, authorId) {
    const copy = { ...item, authorId: item.authorId || authorId };
    for (const k of ["agenda", "attendees", "packet", "tags", "discussion", "amendments", "coSponsors", "linkedBudgetItems"]) {
      if (Array.isArray(item[k])) copy[k] = item[k].map((x) => (x && typeof x === "object" ? { ...x } : x));
    }
    if (item.voters && typeof item.voters === "object" && !Array.isArray(item.voters)) {
      copy.voters = { ...item.voters };
    }
    if (item.votes && typeof item.votes === "object" && !Array.isArray(item.votes)) {
      copy.votes = { ...item.votes };
      if (!copy.voters) copy.voters = { ...item.votes };
    }
    return copy;
  }
  // Fold per-user buckets into "_shared". Source arrays are not removed.
  // foldedIds remembers every id already considered so a later delete from
  // the shared list is not resurrected on the next read.
  function migrateCouncilShared(s) {
    const folded = new Set(s.foldedIds);
    const remember = (mark) => {
      if (folded.has(mark)) return;
      folded.add(mark);
      s.foldedIds.push(mark);
    };
    const fold = (map, bucket) => {
      const shared = cShared(map);
      const seen = new Set(shared.map((x) => x && x.id).filter(Boolean));
      for (const [key, arr] of map.entries()) {
        if (key === C_SHARED || !Array.isArray(arr)) continue;
        for (const item of arr) {
          if (!item || typeof item !== "object" || !item.id) continue;
          const mark = `${bucket}:${item.id}`;
          if (seen.has(item.id) || folded.has(mark)) {
            remember(mark);
            continue;
          }
          shared.push(cCopyItem(item, key));
          seen.add(item.id);
          remember(mark);
        }
      }
    };
    fold(s.meetings, "meetings");
    fold(s.actions, "actions");
    fold(s.decisions, "decisions");
    fold(s.proposals, "proposals");
    fold(s.audit, "audit");
    fold(s.members, "members");
  }
  function cIsMember(s, userId) {
    return cShared(s.members).some((m) => m && (m.userId === userId || m.id === userId));
  }
  function cEnsureMember(s, userId, name) {
    const list = cShared(s.members);
    let member = list.find((m) => m && (m.userId === userId || m.id === userId));
    if (!member) {
      member = { id: userId, userId, name: name || userId, role: "member", joinedAt: cNow() };
      list.push(member);
    } else if (name && name !== userId) {
      member.name = name;
      member.userId = member.userId || userId;
    }
    return member;
  }
  function cProposalQuorum(s, proposal) {
    const eligible = cShared(s.members).length;
    const required = eligible > 0 ? Math.floor(eligible / 2) + 1 : 0;
    const voters = proposal?.voters && typeof proposal.voters === "object" && !Array.isArray(proposal.voters)
      ? proposal.voters : {};
    const votesCast = Object.keys(voters).length;
    const tally = { for: 0, against: 0, abstain: 0 };
    for (const choice of Object.values(voters)) {
      const c = String(choice);
      if (C_VOTE_FOR.has(c)) tally.for += 1;
      else if (C_VOTE_AGAINST.has(c)) tally.against += 1;
      else tally.abstain += 1;
    }
    // Zero eligible members, a zero threshold, or zero ballots is never "met".
    const quorumMet = eligible > 0 && required > 0 && votesCast > 0 && votesCast >= required;
    return { eligible, votesCast, required, quorumMet, tally };
  }
  function cPublicProposal(s, proposal) {
    const q = cProposalQuorum(s, proposal);
    const votes = { ...(proposal.voters || {}) };
    return {
      ...proposal,
      votes,
      voters: votes,
      quorumRequired: q.required,
      eligible: q.eligible,
      votesCast: q.votesCast,
      quorumMet: q.quorumMet,
      tally: q.tally,
      discussion: Array.isArray(proposal.discussion) ? proposal.discussion : [],
      amendments: Array.isArray(proposal.amendments) ? proposal.amendments : [],
      tags: Array.isArray(proposal.tags) ? proposal.tags : [],
      coSponsors: Array.isArray(proposal.coSponsors) ? proposal.coSponsors : [],
      linkedBudgetItems: Array.isArray(proposal.linkedBudgetItems) ? proposal.linkedBudgetItems : [],
    };
  }
  function cAppendAudit(s, ctx, fields) {
    const entry = {
      id: cNextId("aud"),
      timestamp: cNow(),
      authorId: cUser(ctx),
      actor: cActorName(ctx, fields),
      action: String(fields.action || "Noted").trim().slice(0, 160) || "Noted",
      target: String(fields.target || "").slice(0, 200),
      details: String(fields.details || "").slice(0, 500),
      category: cOneOf(fields.category, C_AUDIT_CATEGORIES, "proposal"),
    };
    cShared(s.audit).push(entry);
    return entry;
  }
  function cNeedUser(ctx) {
    if (!cUser(ctx)) return { ok: false, error: "sign in required" };
    return null;
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
      authorId: cUid(ctx),
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
    if (list[idx].authorId && list[idx].authorId !== userId) {
      return { ok: false, error: "only the author can delete" };
    }
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
    // A threshold of 0, or nobody present, is never "met" — including the
    // old `required <= 0 && attendees.length > 0` path that reported Met
    // with zero voters.
    const met = required > 0 && present > 0 && present >= required;
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
      authorId: cUid(ctx),
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
    const userId = cUid(ctx);
    const list = cList(s.actions, userId);
    const idx = list.findIndex(x => x.id === params.id);
    if (idx < 0) return { ok: false, error: "action not found" };
    if (list[idx].authorId && list[idx].authorId !== userId) {
      return { ok: false, error: "only the author can delete" };
    }
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
      authorId: userId,
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
    const record = {
      id: cNextId("dec"),
      authorId: cUid(ctx),
      title,
      summary: String(params.summary || "").trim(),
      outcome: String(params.outcome || "decided").trim(), // passed | rejected | tabled | decided
      proposalId: params.proposalId ? String(params.proposalId) : null,
      meetingId: params.meetingId ? String(params.meetingId) : null,
      votesFor: Math.max(0, parseInt(params.votesFor) || 0),
      votesAgainst: Math.max(0, parseInt(params.votesAgainst) || 0),
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
    const userId = cUid(ctx);
    const list = cList(s.decisions, userId);
    const idx = list.findIndex(d => d.id === params.id);
    if (idx < 0) return { ok: false, error: "decision not found" };
    if (list[idx].authorId && list[idx].authorId !== userId) {
      return { ok: false, error: "only the author can delete" };
    }
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Shared proposals, members, votes, audit ──
  // Eligible voters are council members (real accounts), not a fabricated
  // stakeholder weight. Quorum is a majority of current members and is never
  // met when nobody has voted.

  registerLensAction("council", "member-list", (ctx, _a, _params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return { ok: true, result: { members: [], total: 0, signedIn: false } };
    const members = cShared(s.members).slice();
    return { ok: true, result: { members, total: members.length, signedIn: true } };
  });

  registerLensAction("council", "member-join", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const userId = cUser(ctx);
    const member = cEnsureMember(s, userId, cActorName(ctx, params));
    cSave();
    return { ok: true, result: { member, total: cShared(s.members).length } };
  });

  registerLensAction("council", "proposal-create", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const authorId = cUser(ctx);
    const authorName = cActorName(ctx, params);
    cEnsureMember(s, authorId, authorName);
    const tags = Array.isArray(params.tags)
      ? params.tags.map((t) => String(t).trim()).filter(Boolean)
      : String(params.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    const proposal = {
      id: cNextId("prop"),
      title,
      description: String(params.description || "").trim(),
      type: cOneOf(params.type, C_PROPOSAL_TYPES, "policy"),
      status: "draft",
      authorId,
      authorName,
      sponsor: authorName,
      coSponsors: [],
      createdAt: cNow(),
      updatedAt: cNow(),
      discussion: [],
      amendments: [],
      impactAssessment: String(params.impactAssessment || "").trim(),
      linkedBudgetItems: [],
      votingMethod: cOneOf(params.votingMethod, C_VOTING_METHODS, "simple_majority"),
      votingDeadline: params.votingDeadline ? String(params.votingDeadline) : null,
      voters: {},
      tags,
    };
    cShared(s.proposals).push(proposal);
    cAppendAudit(s, ctx, {
      authorName,
      action: "Created proposal",
      target: proposal.id,
      details: proposal.title,
      category: "proposal",
    });
    cSave();
    return { ok: true, result: { proposal: cPublicProposal(s, proposal) } };
  });

  registerLensAction("council", "proposal-list", (ctx, _a, _params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!cUser(ctx)) return { ok: true, result: { proposals: [], total: 0, signedIn: false } };
    const proposals = cShared(s.proposals).slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .map((p) => cPublicProposal(s, p));
    return { ok: true, result: { proposals, total: proposals.length, signedIn: true } };
  });

  function findProposal(s, id) {
    if (!id) return null;
    return cShared(s.proposals).find((p) => p.id === id) || null;
  }

  registerLensAction("council", "proposal-update", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const p = findProposal(s, params.id);
    if (!p) return { ok: false, error: "proposal not found" };
    if (params.title !== undefined) {
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      p.title = title;
    }
    if (params.description !== undefined) p.description = String(params.description);
    if (params.type !== undefined) p.type = cOneOf(params.type, C_PROPOSAL_TYPES, p.type);
    if (params.status !== undefined && C_PROPOSAL_STATUSES.includes(params.status)) p.status = params.status;
    if (params.impactAssessment !== undefined) p.impactAssessment = String(params.impactAssessment);
    if (params.votingMethod !== undefined) p.votingMethod = cOneOf(params.votingMethod, C_VOTING_METHODS, p.votingMethod);
    if (params.votingDeadline !== undefined) p.votingDeadline = params.votingDeadline ? String(params.votingDeadline) : null;
    if (Array.isArray(params.tags)) p.tags = params.tags.map((t) => String(t).trim()).filter(Boolean);
    if (Array.isArray(params.discussion)) p.discussion = params.discussion;
    if (Array.isArray(params.amendments)) p.amendments = params.amendments;
    if (Array.isArray(params.linkedBudgetItems)) p.linkedBudgetItems = params.linkedBudgetItems;
    if (Array.isArray(params.coSponsors)) p.coSponsors = params.coSponsors;
    if (params.budget && typeof params.budget === "object") p.budget = params.budget;
    // Votes and authorship stay server-owned. A client blob cannot rewrite them.
    p.updatedAt = cNow();
    cSave();
    return { ok: true, result: { proposal: cPublicProposal(s, p) } };
  });

  registerLensAction("council", "proposal-vote", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const userId = cUser(ctx);
    const p = findProposal(s, params.id);
    if (!p) return { ok: false, error: "proposal not found" };
    if (!cIsMember(s, userId)) return { ok: false, error: "not eligible" };
    const choice = String(params.choice || params.vote || "").trim();
    if (!C_VOTE_CHOICES.includes(choice)) return { ok: false, error: "vote invalid" };
    if (!p.voters || typeof p.voters !== "object" || Array.isArray(p.voters)) p.voters = {};
    p.voters[userId] = choice;
    p.updatedAt = cNow();
    const quorum = cProposalQuorum(s, p);
    cAppendAudit(s, ctx, {
      authorName: cActorName(ctx, params),
      action: "Voted",
      target: p.id,
      details: choice.replace(/_/g, " "),
      category: "vote",
    });
    cSave();
    return { ok: true, result: { proposal: cPublicProposal(s, p), quorum } };
  });

  registerLensAction("council", "proposal-delete", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const userId = cUser(ctx);
    const list = cShared(s.proposals);
    const idx = list.findIndex((p) => p.id === params.id);
    if (idx < 0) return { ok: false, error: "proposal not found" };
    if (list[idx].authorId !== userId) return { ok: false, error: "only the author can delete" };
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("council", "audit-append", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const action = String(params.action || "").trim();
    if (!action) return { ok: false, error: "action required" };
    const entry = cAppendAudit(s, ctx, params);
    cSave();
    return { ok: true, result: { entry } };
  });

  registerLensAction("council", "audit-list", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!cUser(ctx)) return { ok: true, result: { entries: [], total: 0, signedIn: false } };
    let entries = cShared(s.audit).slice();
    if (params.category && params.category !== "all") {
      entries = entries.filter((e) => e.category === params.category);
    }
    entries.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
    return { ok: true, result: { entries, total: entries.length, signedIn: true } };
  });

  registerLensAction("council", "audit-update", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const userId = cUser(ctx);
    const entry = cShared(s.audit).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "audit entry not found" };
    if (entry.authorId !== userId) return { ok: false, error: "only the author can edit" };
    if (params.details !== undefined) entry.details = String(params.details).slice(0, 500);
    cSave();
    return { ok: true, result: { entry } };
  });

  registerLensAction("council", "audit-delete", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const userId = cUser(ctx);
    const list = cShared(s.audit);
    const idx = list.findIndex((e) => e.id === params.id);
    if (idx < 0) return { ok: false, error: "audit entry not found" };
    if (list[idx].authorId !== userId) return { ok: false, error: "only the author can delete" };
    list.splice(idx, 1);
    cSave();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("council", "budget-simulate", (ctx, _a, params = {}) => {
    const s = getCouncilState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const gate = cNeedUser(ctx);
    if (gate) return gate;
    const p = findProposal(s, params.id);
    if (!p) return { ok: false, error: "proposal not found" };
    const budget = (params.budget && typeof params.budget === "object") ? params.budget : (p.budget || { total: 0, items: [] });
    const items = Array.isArray(budget.items) ? budget.items : [];
    const itemBreakdown = items.map((item) => {
      const amount = Number(item.amount || item.cost || 0) || 0;
      const variance = Number(item.variance || item.uncertainty || 0.15) || 0.15;
      const low = amount * (1 - variance);
      const high = amount * (1 + variance);
      const expected = amount * (1 + variance * 0.1);
      return {
        name: item.name || item.label,
        budgeted: amount,
        low: Math.round(low),
        high: Math.round(high),
        expected: Math.round(expected),
        variance,
      };
    });
    const totalBudgeted = items.reduce((sum, i) => sum + (Number(i.amount || i.cost || 0) || 0), 0) || Number(budget.total) || 0;
    const totalExpected = itemBreakdown.reduce((sum, i) => sum + i.expected, 0) || totalBudgeted;
    const totalLow = itemBreakdown.reduce((sum, i) => sum + i.low, 0) || Math.round(totalBudgeted * 0.85);
    const totalHigh = itemBreakdown.reduce((sum, i) => sum + i.high, 0) || Math.round(totalBudgeted * 1.15);
    const overBudgetRisk = totalBudgeted > 0 ? Math.round(((totalHigh - totalBudgeted) / totalBudgeted) * 100) / 100 : 0;
    const risks = [];
    if (overBudgetRisk > 0.2) risks.push("high_cost_overrun_risk");
    if (items.some((i) => (Number(i.variance) || 0.15) > 0.3)) risks.push("high_variance_items_present");
    if (items.length === 0) risks.push("no_line_items_for_analysis");
    const voters = p.voters && typeof p.voters === "object" ? p.voters : {};
    const voteValues = Object.values(voters);
    const approvalRate = voteValues.length > 0
      ? voteValues.filter((v) => C_VOTE_FOR.has(String(v))).length / voteValues.length
      : null;
    const confidence = items.length > 0
      ? Math.round(Math.max(0.3, 1 - items.reduce((sum, i) => sum + (Number(i.variance || i.uncertainty) || 0.15), 0) / items.length) * 100) / 100
      : 0.5;
    const simulation = {
      projected: totalExpected,
      totalBudgeted,
      range: { low: totalLow, high: totalHigh },
      confidence,
      overBudgetRisk,
      risks,
      approvalRate,
      itemBreakdown,
      simulatedAt: cNow(),
    };
    p.budget = budget;
    p.budgetSimulation = simulation;
    p.updatedAt = cNow();
    cAppendAudit(s, ctx, {
      action: "Simulated budget",
      target: p.id,
      details: `Projected ${totalExpected}`,
      category: "budget",
    });
    cSave();
    return { ok: true, result: { simulation, proposal: cPublicProposal(s, p) } };
  });
}
