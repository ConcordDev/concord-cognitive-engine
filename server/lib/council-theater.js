/**
 * Council Live Theater
 *
 * Schedules council deliberations as streaming public events. Every N
 * minutes a fresh proposal is drafted (from autogen pipeline output or
 * pending epistemic items) and streamed to anyone watching the council
 * lens — voice by voice, live.
 *
 * Three states:
 *   • idle      — no event scheduled
 *   • scheduled — next event in <T> seconds
 *   • streaming — event in progress, voices speaking on a timer
 *
 * Each session emits realtime events:
 *   council:theater:scheduled  { eventId, proposal, startsInMs }
 *   council:theater:voice      { eventId, voiceId, voiceName, response }
 *   council:theater:complete   { eventId, verdict, fullTranscript }
 */

import { runCouncilVoices, COUNCIL_VOICES } from "../emergent/council-voices.js";

const SESSION_INTERVAL_MS = 30 * 60 * 1000;   // every 30 min
const VOICE_GAP_MS        = 4 * 1000;          // 4s between voices for streaming feel
const MAX_HISTORY         = 24;

const state = {
  current: null,         // active session
  next:    null,         // { startsAt, proposal }
  history: [],           // recent completed sessions
  lastTickAt: 0,
};

/** Generate a council proposal from recent system signals. */
function draftProposal() {
  const now = new Date();
  const topics = [
    "Should the substrate prioritize archive recovery over forward synthesis this week?",
    "When two MEGA DTUs disagree, which lineage should be authoritative?",
    "Is the marketplace promotion floor too lenient toward dream-cycle output?",
    "Should the Concord Link courier oath be enforced by automatic contract penalties?",
    "Do NPCs whose secrets are revealed get retroactively re-vetted by the repair brain?",
    "Is the citation-chain quest threshold (depth >= 4) calibrated correctly?",
    "When two factions reach a referendum stalemate, who arbitrates?",
    "Should creator royalties cascade through dream-promoted listings?",
  ];
  const idx = Math.floor((now.getTime() / SESSION_INTERVAL_MS) % topics.length);
  return {
    id: `proposal_${now.toISOString()}`,
    topic: topics[idx],
    context: { surfacedAt: now.toISOString() },
  };
}

/**
 * Per-tick driver. Called from governorTick at low frequency. Schedules
 * the next session, starts a streaming session when due, and steps the
 * voice clock for a session in progress.
 */
export async function tick(emit) {
  const now = Date.now();
  state.lastTickAt = now;

  // Streaming session in progress?
  if (state.current) {
    return advanceCurrent(emit);
  }

  // Need to schedule the next?
  if (!state.next) {
    const startsAt = now + 30_000; // first session in 30s after server boot
    const proposal = draftProposal();
    state.next = { startsAt, proposal };
    emit?.("council:theater:scheduled", {
      eventId: proposal.id,
      proposal,
      startsInMs: startsAt - now,
    });
    return { scheduled: true, eventId: proposal.id };
  }

  // Time to start the scheduled session?
  if (now >= state.next.startsAt) {
    return startSession(emit);
  }

  return { idle: true, nextInMs: state.next.startsAt - now };
}

function startSession(emit) {
  if (state.current) return { skipped: "already_streaming" };
  if (!state.next) return { skipped: "no_session" };
  const { proposal } = state.next;
  state.next = null;

  // Run the council voices once; we'll stream them out one at a time.
  const result = runCouncilVoices(proposal, {});
  state.current = {
    eventId: proposal.id,
    proposal,
    voicesQueue: COUNCIL_VOICES.slice(),
    transcript: [],
    verdict: result?.verdict || null,
    rawResult: result,
    startedAt: Date.now(),
    nextVoiceAt: Date.now() + 200,
  };
  emit?.("council:theater:started", { eventId: proposal.id, proposal, voiceCount: COUNCIL_VOICES.length });
  return { started: true, eventId: proposal.id };
}

function advanceCurrent(emit) {
  const cur = state.current;
  if (!cur) return { idle: true };
  const now = Date.now();
  if (now < cur.nextVoiceAt) return { streaming: true, eventId: cur.eventId, queued: cur.voicesQueue.length };

  // Pop next voice.
  const voice = cur.voicesQueue.shift();
  if (!voice) {
    // Done — finalize.
    const final = {
      eventId: cur.eventId,
      verdict: cur.verdict,
      fullTranscript: cur.transcript,
      durationMs: now - cur.startedAt,
    };
    state.history.push({ ...cur, completedAt: now });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.current = null;
    emit?.("council:theater:complete", final);
    // Schedule the next session.
    const nextProposal = draftProposal();
    const startsAt = now + SESSION_INTERVAL_MS;
    state.next = { startsAt, proposal: nextProposal };
    emit?.("council:theater:scheduled", {
      eventId: nextProposal.id,
      proposal: nextProposal,
      startsInMs: startsAt - now,
    });
    return { completed: true, eventId: cur.eventId };
  }

  // Find the voice's response in the result for that voice id.
  const voiceResponse = (cur.rawResult?.voiceResponses || []).find(v => v.voiceId === voice.id);
  const response = voiceResponse?.response || `${voice.name} considers the proposal in silence.`;
  const entry = {
    voiceId: voice.id,
    voiceName: voice.name,
    response,
    ts: new Date(now).toISOString(),
  };
  cur.transcript.push(entry);
  cur.nextVoiceAt = now + VOICE_GAP_MS;
  emit?.("council:theater:voice", { eventId: cur.eventId, ...entry });
  return { streaming: true, eventId: cur.eventId, queued: cur.voicesQueue.length };
}

/** Snapshot for HTTP polling fallback. */
export function getCouncilTheaterState() {
  return {
    current: state.current
      ? {
          eventId: state.current.eventId,
          proposal: state.current.proposal,
          transcript: state.current.transcript,
          queued: state.current.voicesQueue.length,
          startedAt: state.current.startedAt,
        }
      : null,
    next: state.next,
    history: state.history.slice(-10).map(h => ({
      eventId: h.eventId,
      proposal: h.proposal,
      verdict: h.verdict,
      completedAt: h.completedAt,
    })),
    lastTickAt: state.lastTickAt,
  };
}
