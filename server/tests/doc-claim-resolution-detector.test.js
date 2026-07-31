// tests/doc-claim-resolution-detector.test.js
//
// Bidirectional pin: a "fixed"-adjacent claim naming a file/symbol that no
// longer exists must be flagged; the same claim naming a real, still-present
// file/symbol must not be.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDocClaimResolutionDetector } from "../lib/detectors/doc-claim-resolution-detector.js";

async function tmpRepo({ claudeMd = "", serverFiles = {} }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dcr-"));
  await mkdir(path.join(dir, "server", "lib"), { recursive: true });
  await mkdir(path.join(dir, "docs"), { recursive: true });
  await writeFile(path.join(dir, "CLAUDE.md"), claudeMd, "utf8");
  for (const [name, content] of Object.entries(serverFiles)) {
    await writeFile(path.join(dir, "server", "lib", name), content, "utf8");
  }
  return dir;
}

describe("doc-claim-resolution detector — end to end", () => {
  let dir;
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("FLAGS a fixed-claim referencing a file that no longer exists", async () => {
    const claudeMd = `The SSRF gap in \`server/lib/gone-now.js\` was fixed last week.`;
    dir = await tmpRepo({ claudeMd });
    const r = await runDocClaimResolutionDetector({ root: dir });
    assert.equal(r.ok, true);
    const hit = r.findings.find((f) => f.id === "doc_claim_file_not_found");
    assert.ok(hit, "a fixed-claim on a nonexistent file must be flagged");
    assert.equal(hit.evidence.ref, "server/lib/gone-now.js");
  });

  it("does NOT flag a fixed-claim referencing a file that exists", async () => {
    const claudeMd = `The SSRF gap in \`server/lib/real-file.js\` was fixed last week.`;
    dir = await tmpRepo({ claudeMd, serverFiles: { "real-file.js": "// real content" } });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "server/lib/real-file.js");
    assert.equal(hit, undefined, "a real, existing file must not be flagged");
  });

  it("FLAGS a fixed-claim naming a function symbol no longer present in the file", async () => {
    const claudeMd = `\`server/lib/real-file.js#missingFn\` was patched.`;
    dir = await tmpRepo({ claudeMd, serverFiles: { "real-file.js": "export function otherFn() {}" } });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.id === "doc_claim_symbol_not_found");
    assert.ok(hit);
    assert.equal(hit.evidence.symbol, "missingFn");
  });

  it("does NOT flag a fixed-claim naming a symbol that IS present in the file", async () => {
    const claudeMd = `\`server/lib/real-file.js#realFn\` was resolved.`;
    dir = await tmpRepo({ claudeMd, serverFiles: { "real-file.js": "export function realFn() {}" } });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.symbol === "realFn");
    assert.equal(hit, undefined);
  });

  it("does NOT flag a file reference with no fixed/closed/resolved keyword nearby", async () => {
    const claudeMd = `See \`server/lib/gone-now.js\` for the pattern.`;
    dir = await tmpRepo({ claudeMd });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "server/lib/gone-now.js");
    assert.equal(hit, undefined, "no fixed-adjacent keyword on this line — not a resolution claim");
  });

  it("does NOT flag a file reference on a line citing a DIFFERENT project's GitHub repo", async () => {
    // Real instance found running this detector against the live tree:
    // docs/lens-specs/law-capability-map.md cites CourtListener's own
    // `cl/search/forms.py` as evidence for an API field name — the
    // "fixed/closed" keyword on that line describes the Concord macro, not
    // a claim that cl/search/forms.py exists in this repo.
    const claudeMd = `CLOSED — verified against github.com/freelawproject/courtlistener's \`cl/search/forms.py\` SearchForm.`;
    dir = await tmpRepo({ claudeMd });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "cl/search/forms.py");
    assert.equal(hit, undefined, "a citation of another project's own file must not be flagged as a stale Concord reference");
  });

  it("does NOT flag a file reference cited via raw.githubusercontent.com (no github.com/ URL)", async () => {
    const claudeMd = `CLOSED — re-fetched \`cl/search/forms.py\` from raw.githubusercontent.com and confirmed the field.`;
    dir = await tmpRepo({ claudeMd });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "cl/search/forms.py");
    assert.equal(hit, undefined, "a raw.githubusercontent.com citation is still an external-repo citation");
  });

  it("does NOT flag a file reference cited via a bare owner/repo shorthand near the word GitHub (no URL at all)", async () => {
    const claudeMd = `CLOSED — source: \`freelawproject/courtlistener\` GitHub — \`cl/search/forms.py\`.`;
    dir = await tmpRepo({ claudeMd });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "cl/search/forms.py");
    assert.equal(hit, undefined, "a bare owner/repo + GitHub mention is still an external-repo citation");
  });

  it("STILL flags a stale bare-shorthand ref even though it also has no repo-top-level-dir prefix (the fix must not be a blunt path-prefix filter)", async () => {
    const claudeMd = `The onboarding flow was fixed in \`register/page.tsx\`.`;
    dir = await tmpRepo({ claudeMd }); // no such file created — genuinely stale
    const r = await runDocClaimResolutionDetector({ root: dir });
    const hit = r.findings.find((f) => f.evidence?.ref === "register/page.tsx");
    assert.ok(hit, "a genuinely stale shorthand ref with no external-repo citation nearby must still be flagged");
  });

  it("does NOT flag a `path:123` reference where 123 is a line number, not a symbol", async () => {
    const claudeMd = `Fixed at \`server/lib/real-file.js:42\`.`;
    dir = await tmpRepo({ claudeMd, serverFiles: { "real-file.js": "line1\nline2" } });
    const r = await runDocClaimResolutionDetector({ root: dir });
    const symbolHit = r.findings.find((f) => f.id === "doc_claim_symbol_not_found");
    assert.equal(symbolHit, undefined, "a pure digit after : is a line number, never treated as a missing symbol");
  });
});
