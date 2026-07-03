// server/lib/provenance-ingest.js
//
// Shared primitive (P-A): turn a freshly-fetched external record into a
// provenance-stamped DTU envelope that is ready for `dtu.create`. This is the
// "one real consumer" of the C2PA-style provenance assertion added to
// dtu-protocol.js — it stamps WHERE the record came from (sourceUrl/sourceId),
// WHEN it was fetched, and a `contentSha256` computed from the DTU's own
// content, so any later edit of the content is detectable via `verify()`.
//
// Honest-by-construction: this never fabricates a record. The caller does the
// (SSRF-guarded, keyless) fetch and hands the real upstream payload in; this
// only wraps + stamps it.

import DTUProtocol from "./dtu-protocol.js";

const protocol = new DTUProtocol();

/**
 * Wrap a fetched external record in an Ingest DTU and stamp provenance onto it.
 *
 * @param {object} args
 * @param {string|null} [args.sourceUrl]  - the URL the record was fetched from
 * @param {string|null} [args.sourceId]   - the upstream record id, if any
 * @param {*}           [args.record]     - the fetched record payload (real data)
 * @param {string}      [args.recordName] - human label for the record
 * @param {string}      [args.ingestKind] - e.g. "open-data"
 * @param {object}      [args.creator]    - { name, id }
 * @param {string|null} [args.fetchedAt]  - ISO fetch time (defaults to now inside stampProvenance)
 * @param {string|null} [args.signer]     - signing identity, if any
 * @returns {object} a provenance-stamped Ingest DTU (validate()/verify() clean)
 */
export function stampIngestedRecord({
  sourceUrl = null,
  sourceId = null,
  record = {},
  recordName = null,
  ingestKind = "open-data",
  creator = undefined,
  fetchedAt = null,
  signer = null,
} = {}) {
  const dtu = protocol.createIngest({
    name: recordName || (record && (record.title || record.name)) || "Ingested Record",
    ingestKind,
    source: { url: sourceUrl, id: sourceId },
    record,
    creator,
  });
  return protocol.stampProvenance(dtu, {
    sourceUrl,
    sourceId,
    timecode: null,
    fetchedAt,
    signer,
  });
}

export { protocol as ingestProtocol };
