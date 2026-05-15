// server/emergent/corpus-ingest-cycle.js
//
// Heartbeat wrapper for the open-corpus ingest pipeline. Fires once
// per ~hour on the platform heartbeat (frequency 240). Inside the
// handler each individual source has its own per-day quota (see
// corpus-ingest.js), so calling more often than the source quotas
// allow is a free no-op rather than a quota burn — the heartbeat
// frequency is "max cadence," the source caps are the actual brake.
//
// Wire-up in server.js: registerHeartbeat("corpus-ingest-cycle", { ... }).
// Never throws — heartbeat modules MUST be defensive.

import logger from "../logger.js";

const FREQUENCY = Number(process.env.CONCORD_CORPUS_INGEST_FREQUENCY) || 240; // ~60min

export const CORPUS_INGEST_FREQUENCY = FREQUENCY;

export async function runCorpusIngestCycle({ db: _db, bridgeEvent } = {}) {
  if (typeof bridgeEvent !== "function") {
    return { ok: false, reason: "no_bridge_event_callback" };
  }
  try {
    const { runCorpusIngest } = await import("./corpus-ingest.js");
    const r = await runCorpusIngest(bridgeEvent);
    if (r?.totalPulled > 0) {
      logger.info?.("corpus-ingest-cycle", "ingested", {
        totalPulled: r.totalPulled,
        perSource: (r.perSource || []).map(s => `${s.source}=${s.pulled || 0}`).join(","),
      });
    }
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
