// server/lib/conkay/knowledge/connectors/recordings.js
//
// Recorded excerpts of connector responses, for tests and the offline demo. A
// recording keeps only what the connectors read (PubChem: the information
// entries and the contributor list; NIST: the table rows used and the
// references text), plus the SHA-256 of the full response as retrieved, so the
// original can be re-identified. The full documents stay in the evidence store
// of whoever captured them (scripts/conkay-capture-knowledge.mjs), not in the repo.

import { sha256 } from "./fetcher.js";
import { pageText } from "./nist-webbook.js";

/** PubChem PUG View record: information entries + reference list (name, id, URL, license). */
export function excerptPubchemView(body) {
  const j = JSON.parse(body);
  if (!j.Record) return body;
  const trimSection = (s) => ({ TOCHeading: s.TOCHeading, ...(s.Section ? { Section: s.Section.map(trimSection) } : {}), ...(s.Information ? { Information: s.Information.map((i) => ({ ReferenceNumber: i.ReferenceNumber, Value: i.Value })) } : {}) });
  const r = j.Record;
  return JSON.stringify({ Record: { RecordType: r.RecordType, RecordNumber: r.RecordNumber, RecordTitle: r.RecordTitle, Section: (r.Section || []).map(trimSection), Reference: (r.Reference || []).map((x) => ({ ReferenceNumber: x.ReferenceNumber, SourceName: x.SourceName, SourceID: x.SourceID, URL: x.URL, ...(x.License ? { License: x.License } : {}) })) } });
}

/** NIST tab-delimited table: the header and the rows at the given temperatures. */
export function excerptNistTable(body, keepK) {
  const lines = body.trim().split(/\r?\n/);
  return [lines[0], ...lines.slice(1).filter((l) => keepK.some((t) => Math.abs(Number(l.split("\t")[0]) - t) < 1e-6))].join("\n") + "\n";
}

/** NIST results page: the "References and Notes" text only (where the uncertainty statements are). */
export function excerptNistPage(html) {
  const t = pageText(html);
  const i = t.indexOf("Additional fluid properties");
  return i >= 0 ? t.slice(i, i + 6000) : t.slice(0, 6000);
}

/** Build a recording entry from a full body and its excerpt. */
export function recording(url, fullBody, excerptBody, retrieved) {
  return { url, retrieved, fullSha256: sha256(fullBody), excerpt: excerptBody !== fullBody, body: excerptBody };
}
