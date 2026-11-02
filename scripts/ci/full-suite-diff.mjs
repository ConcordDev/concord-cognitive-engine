#!/usr/bin/env node
// scripts/ci/full-suite-diff.mjs
//
// Triage report for the sharded full-suite workflow. Reads the JUnit files every job uploaded, extracts the failing
// test ids, and compares them with the failing set of the latest main run, so a PR is judged only on NEW failures.
// This is a triage signal, not a merge gate.
//
//   report  --dir ci-out [--baseline failing.json] [--expect-shards N] [--summary file.md] [--out failing.json]
//   failing-files --junit file.xml          # unique test files that had a failure (for the isolated re-run)
//
// Files in --dir: junit-shard-<n>.xml, junit-shard-<n>-rerun.xml (isolated re-run of that shard's failing files),
// junit-fe.xml (vitest), junit-behavior.xml. Ids: "<file> :: <suite> :: <test>" (prefixed fe:/behavior:).
// Exit 1 only when there are NEW failures that did not also pass on the isolated re-run.

import fs from "node:fs";
import path from "node:path";

const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:.-]+)="([^"]*)"/g)) out[m[1]] = unesc(m[2]);
  return out;
}

function relFile(f) {
  if (!f) return "";
  const norm = f.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/server/");
  if (i >= 0) return norm.slice(i + 1);
  const j = norm.lastIndexOf("/concord-frontend/");
  if (j >= 0) return norm.slice(j + 1);
  return norm.replace(/^\.?\//, "");
}

/** Parse one JUnit document (node:test or vitest). Returns {total, passed, skipped, failures:[{id,file,suite,name,message}], ids:Set} */
export function parseJunit(xml, { prefix = "" } = {}) {
  const stack = [];
  const res = { total: 0, passed: 0, skipped: 0, failures: [], ids: new Set() };
  let cur = null;
  const tagRe = /<(\/?)(testsuite|testcase|failure|error|skipped)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, closing, tag, rawAttrs, selfClose] = m;
    if (tag === "testsuite") {
      if (closing) stack.pop();
      else if (!selfClose) stack.push(attrs(rawAttrs).name || "");
      continue;
    }
    if (tag === "testcase") {
      if (closing) {
        if (cur) finish(cur);
        cur = null;
      } else {
        const a = attrs(rawAttrs);
        cur = { name: a.name || "", file: relFile(a.file || a.classname || ""), suite: stack.filter(Boolean).join(" > "), failed: false, skipped: false, message: "" };
        if (selfClose) { finish(cur); cur = null; }
      }
      continue;
    }
    if (!cur || closing) continue;
    if (tag === "skipped") cur.skipped = true;
    else { cur.failed = true; cur.message = cur.message || (attrs(rawAttrs).message || "").split("\n")[0].slice(0, 200); }
  }
  if (cur) finish(cur);
  return res;

  function finish(c) {
    res.total++;
    const id = `${prefix}${c.file} :: ${c.suite} :: ${c.name}`;
    if (c.failed) { res.failures.push({ id, file: c.file, suite: c.suite, name: c.name, message: c.message }); res.ids.add(id); }
    else if (c.skipped) res.skipped++;
    else res.passed++;
  }
}

/**
 * @param {string[]} current   failing ids now
 * @param {string[]|null} baseline failing ids on the latest main run (null = no baseline available)
 * @param {Set<string>} flaky  ids that failed in the main pass but passed in the isolated re-run
 */
export function classify(current, baseline, flaky = new Set()) {
  const base = new Set(baseline || []);
  const cur = new Set(current);
  const real = [...cur].filter((id) => !flaky.has(id));
  return {
    newFailures: baseline ? real.filter((id) => !base.has(id)).sort() : [],
    preExisting: baseline ? real.filter((id) => base.has(id)).sort() : [],
    unattributed: baseline ? [] : real.sort(),
    flaky: [...cur].filter((id) => flaky.has(id)).sort(),
    fixed: baseline ? [...base].filter((id) => !cur.has(id)).sort() : [],
  };
}

function readDirReports(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^junit-.*\.xml$/.test(f)).sort() : [];
  const main = [], rerun = [];
  const shards = new Set();
  for (const f of files) {
    const prefix = f.startsWith("junit-fe") ? "fe:" : f.startsWith("junit-behavior") ? "behavior:" : "";
    const xml = fs.readFileSync(path.join(dir, f), "utf8");
    const parsed = parseJunit(xml, { prefix });
    const sm = f.match(/^junit-shard-(\d+)(-rerun)?\.xml$/);
    if (sm) { if (!sm[2]) shards.add(Number(sm[1])); }
    (f.endsWith("-rerun.xml") ? rerun : main).push({ file: f, ...parsed });
  }
  return { main, rerun, shards };
}

export function buildReport({ dir, baseline, expectShards = 0 }) {
  const { main, rerun, shards } = readDirReports(dir);
  const failures = new Map();
  let total = 0, passed = 0, skipped = 0;
  for (const r of main) { total += r.total; passed += r.passed; skipped += r.skipped; for (const f of r.failures) failures.set(f.id, f); }
  // Flaky = failed in the shard run, then RE-RUN in isolation and did not fail again. The re-run report holds
  // passing testcases too, so "executed and not failed" is checked against every id it ran.
  const rerunFailed = new Set();
  for (const r of rerun) for (const f of r.failures) rerunFailed.add(f.id);
  const rerunExecuted = new Set();
  for (const r of rerun) for (const id of collectAllIds(path.join(dir, r.file), r.file)) rerunExecuted.add(id);
  const flaky = new Set([...failures.keys()].filter((id) => rerunExecuted.has(id) && !rerunFailed.has(id)));
  const missing = [];
  for (let i = 1; i <= expectShards; i++) if (!shards.has(i)) missing.push(i);
  const cls = classify([...failures.keys()], baseline, flaky);
  return { total, passed, skipped, failed: failures.size, failures, cls, missingShards: missing, baselineAvailable: !!baseline };
}

function collectAllIds(file, name) {
  const xml = fs.readFileSync(file, "utf8");
  const prefix = name.startsWith("junit-fe") ? "fe:" : name.startsWith("junit-behavior") ? "behavior:" : "";
  const ids = new Set();
  const stack = [];
  const tagRe = /<(\/?)(testsuite|testcase)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(xml))) {
    const [, closing, tag, raw, selfClose] = m;
    if (tag === "testsuite") { if (closing) stack.pop(); else if (!selfClose) stack.push(attrs(raw).name || ""); }
    else if (!closing) { const a = attrs(raw); ids.add(`${prefix}${relFile(a.file || a.classname || "")} :: ${stack.filter(Boolean).join(" > ")} :: ${a.name || ""}`); }
  }
  return ids;
}

export function renderMarkdown(rep, { baselineLabel = "", title = "Full suite" } = {}) {
  const { cls } = rep;
  const L = [];
  L.push(`## ${title}`);
  L.push("");
  L.push(`**${rep.total}** tests run, **${rep.passed}** passed, **${rep.failed}** failed, ${rep.skipped} skipped.`);
  if (rep.missingShards.length) L.push(`\n> **INCOMPLETE:** shard(s) ${rep.missingShards.join(", ")} produced no report (runner crash or timeout). Their tests are NOT counted above; re-run those shards before trusting this summary.`);
  if (!rep.baselineAvailable) {
    L.push(`\n> No baseline from a previous main run was available, so failures below cannot be split into NEW vs PRE-EXISTING.`);
  } else if (baselineLabel) L.push(`\nBaseline: ${baselineLabel}`);
  const list = (ids, max = 60) => {
    const shown = ids.slice(0, max).map((id) => { const f = rep.failures.get(id); return `- \`${id}\`${f?.message ? `: ${f.message.replace(/`/g, "'")}` : ""}`; });
    if (ids.length > max) shown.push(`- … and ${ids.length - max} more (see failing.json)`);
    return shown.join("\n");
  };
  L.push("");
  if (rep.baselineAvailable) {
    L.push(`### NEW failures (${cls.newFailures.length})`);
    L.push(cls.newFailures.length ? list(cls.newFailures) : "None. This run adds no failures beyond main's.");
    L.push("");
    L.push(`<details><summary>PRE-EXISTING failures (${cls.preExisting.length}), also failing on main</summary>\n\n${list(cls.preExisting, 200)}\n\n</details>`);
    L.push("");
    L.push(`<details><summary>Fixed vs main (${cls.fixed.length})</summary>\n\n${cls.fixed.slice(0, 200).map((id) => `- \`${id}\``).join("\n")}\n\n</details>`);
  } else {
    L.push(`### Failures, unattributed (${cls.unattributed.length})`);
    L.push(cls.unattributed.length ? list(cls.unattributed) : "None.");
  }
  L.push("");
  L.push(`<details><summary>Flaky: failed in the shard run, passed on an isolated re-run (${cls.flaky.length})</summary>\n\n${list(cls.flaky, 100)}\n\n</details>`);
  L.push("");
  L.push("_Triage signal, not a merge gate. A NEW failure is a lead, not a verdict: re-run the shard if it looks like contention._");
  return L.join("\n") + "\n";
}

function arg(argv, name, dflt = null) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "failing-files") {
    const xml = fs.readFileSync(arg(rest, "--junit"), "utf8");
    const files = [...new Set(parseJunit(xml).failures.map((f) => f.file).filter(Boolean))].sort();
    process.stdout.write(files.join("\n") + (files.length ? "\n" : ""));
  } else if (cmd === "report") {
    const dir = arg(rest, "--dir", "ci-out");
    const basePath = arg(rest, "--baseline");
    let baseline = null;
    if (basePath && fs.existsSync(basePath)) { try { baseline = JSON.parse(fs.readFileSync(basePath, "utf8")).failing || null; } catch { baseline = null; } }
    const rep = buildReport({ dir, baseline, expectShards: Number(arg(rest, "--expect-shards", 0)) });
    const md = renderMarkdown(rep, { baselineLabel: arg(rest, "--baseline-label", "") });
    const sum = arg(rest, "--summary");
    if (sum) fs.appendFileSync(sum, md); else process.stdout.write(md);
    const out = arg(rest, "--out");
    // An incomplete run under-reports failures; if it became the next baseline, the next PR would look worse than
    // it is. --complete-only refuses to write the baseline file in that case.
    if (out && rest.includes("--complete-only") && rep.missingShards.length) {
      process.stderr.write(`not writing ${out}: shard(s) ${rep.missingShards.join(", ")} produced no report\n`);
    } else if (out) {
      fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), failing: [...rep.failures.keys()].sort(), incomplete: rep.missingShards }, null, 2));
    }
    process.exit(rep.cls.newFailures.length > 0 ? 1 : 0);
  } else {
    console.error("usage: full-suite-diff.mjs report|failing-files ...");
    process.exit(2);
  }
}
