// scripts/ci/junit-file-reporter.mjs
//
// A node:test reporter that writes JUnit XML where EVERY testcase carries the test FILE it ran in. Node 22's
// built-in junit reporter omits `file`, which makes failures impossible to attribute (and "same name in two files"
// indistinguishable) in the full-suite triage. Used as:
//   node --test --test-reporter=./scripts/ci/junit-file-reporter.mjs --test-reporter-destination=out.xml ...
//
// One <testsuite name="<describe path>"> wraps each leaf testcase; describe-level events are skipped (their leaves
// carry the verdict). File-level failures (a file that timed out or crashed has no leaves) appear as a testcase
// named after the file.

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export default async function* reporter(source) {
  const stacks = new Map(); // file -> names by nesting depth
  const out = [];
  for await (const ev of source) {
    const d = ev.data;
    if (!d || typeof d.nesting !== "number") continue;
    const file = d.file || "";
    if (ev.type === "test:start") {
      const st = stacks.get(file) || [];
      st.length = d.nesting;
      st[d.nesting] = d.name;
      stacks.set(file, st);
      continue;
    }
    if (ev.type !== "test:pass" && ev.type !== "test:fail") continue;
    if (d.details?.type === "suite") continue;
    const st = stacks.get(file) || [];
    const suite = st.slice(0, d.nesting).filter(Boolean).join(" > ");
    const t = `<testcase name="${esc(d.name)}" time="${((d.details?.duration_ms ?? 0) / 1000).toFixed(6)}" classname="test" file="${esc(file)}"`;
    let body;
    if (ev.type === "test:fail") {
      const err = d.details?.error;
      const msg = String(err?.cause?.message || err?.message || "failed").split("\n").slice(0, 3).join(" | ").slice(0, 300);
      body = `${t}><failure type="${esc(err?.failureType || err?.code || "failure")}" message="${esc(msg)}"/></testcase>`;
    } else if (d.skip || d.todo) {
      body = `${t}><skipped/></testcase>`;
    } else {
      body = `${t}/>`;
    }
    out.push(`\t<testsuite name="${esc(suite)}">\n\t\t${body}\n\t</testsuite>`);
  }
  yield `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${out.join("\n")}\n</testsuites>\n`;
}
