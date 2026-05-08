// Tier-2 contract test for the cartograph orphan/headless matcher.
//
// Locks in the upgraded behaviour from Phase 0.X.14: an orphan lens
// must show NO backend evidence — name match (kebab/camel/snake) AND
// no runMacro/runDomain calls AND no /api/ fetches AND no
// server/domains/<name>.js file. Pre-upgrade the matcher reported ~150
// false positives.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { crossReferenceAll } from "../scripts/cartographer/cross-reference.js";

const ROOT = "/dev/null"; // unused by the orphan/headless paths in our fixture

function buildStatic(overrides = {}) {
  return {
    tables: [],
    tableRefs: [],
    routes: [],
    socketEvents: [],
    envVars: [],
    macroCallsites: [],
    heartbeatCallsites: [],
    lensDirs: [],
    domainFiles: [],
    ...overrides,
  };
}

function buildRuntime(overrides = {}) {
  return {
    moduleRegistry: [],
    heartbeats: [],
    macros: [],
    ...overrides,
  };
}

describe("cartograph matcher — orphan lens detection", () => {
  test("exact-match domain is not orphan", async () => {
    const staticData = buildStatic({
      lensDirs: [
        { name: "chat", hasPage: true, pageBytes: 100, apiCalls: [], macroDomainCalls: [] },
      ],
      domainFiles: ["chat"],
    });
    const runtime = buildRuntime({ macros: [{ domain: "chat", name: "send" }] });
    const x = await crossReferenceAll(ROOT, staticData, runtime);
    assert.equal(x.orphanLenses.length, 0);
  });

  test("kebab-case lens dir matches camelCase domain file", async () => {
    const staticData = buildStatic({
      lensDirs: [
        { name: "app-maker", hasPage: true, pageBytes: 100, apiCalls: [], macroDomainCalls: [] },
      ],
      domainFiles: ["appmaker"],
    });
    const x = await crossReferenceAll(ROOT, staticData, buildRuntime());
    assert.equal(x.orphanLenses.length, 0);
  });

  test("composite lens (calls runDomain) is not orphan even without name match", async () => {
    const staticData = buildStatic({
      lensDirs: [
        {
          name: "cognition",
          hasPage: true,
          pageBytes: 200,
          apiCalls: [],
          macroDomainCalls: ["hlr", "hlm", "breakthrough"],
        },
      ],
      domainFiles: [],
    });
    const x = await crossReferenceAll(ROOT, staticData, buildRuntime());
    assert.equal(x.orphanLenses.length, 0);
  });

  test("api-route-wired lens (calls /api/oracle/...) is not orphan", async () => {
    const staticData = buildStatic({
      lensDirs: [
        {
          name: "answers",
          hasPage: true,
          pageBytes: 200,
          apiCalls: ["oracle", "dtus"],
          macroDomainCalls: [],
        },
      ],
      domainFiles: [],
    });
    const x = await crossReferenceAll(ROOT, staticData, buildRuntime());
    assert.equal(x.orphanLenses.length, 0);
  });

  test("genuinely orphan lens (no evidence) is reported", async () => {
    const staticData = buildStatic({
      lensDirs: [
        {
          name: "totally-fake",
          hasPage: true,
          pageBytes: 50,
          apiCalls: [],
          macroDomainCalls: [],
        },
      ],
      domainFiles: ["chat", "voice"],
    });
    const runtime = buildRuntime({ macros: [{ domain: "chat", name: "send" }] });
    const x = await crossReferenceAll(ROOT, staticData, runtime);
    assert.equal(x.orphanLenses.length, 1);
    assert.equal(x.orphanLenses[0].frontendDir, "totally-fake");
    assert.equal(x.orphanLenses[0].reason, "no_backend_evidence_in_page_tsx");
  });

  test("missing page.tsx is reported separately", async () => {
    const staticData = buildStatic({
      lensDirs: [
        { name: "world-creator", hasPage: false, pageBytes: 0, apiCalls: [], macroDomainCalls: [] },
      ],
    });
    const x = await crossReferenceAll(ROOT, staticData, buildRuntime());
    assert.equal(x.orphanLenses.length, 1);
    assert.equal(x.orphanLenses[0].reason, "page_tsx_empty_or_missing");
  });

  test("[parent] template directory is excluded", async () => {
    const staticData = buildStatic({
      lensDirs: [
        { name: "[parent]", hasPage: false, pageBytes: 0, apiCalls: [], macroDomainCalls: [] },
        { name: ".hidden", hasPage: false, pageBytes: 0, apiCalls: [], macroDomainCalls: [] },
      ],
    });
    const x = await crossReferenceAll(ROOT, staticData, buildRuntime());
    assert.equal(x.orphanLenses.length, 0);
  });
});

describe("cartograph matcher — headless backend detection", () => {
  test("backend referenced by a composite lens is not headless", async () => {
    const staticData = buildStatic({
      lensDirs: [
        {
          name: "cognition",
          hasPage: true,
          pageBytes: 100,
          apiCalls: [],
          macroDomainCalls: ["hlr", "hlm"],
        },
      ],
      domainFiles: [],
    });
    const runtime = buildRuntime({
      macros: [
        { domain: "hlr", name: "run" },
        { domain: "hlm", name: "run" },
      ],
    });
    const x = await crossReferenceAll(ROOT, staticData, runtime);
    const headlessIds = x.headlessBackends.map((h) => h.domain);
    assert.ok(!headlessIds.includes("hlr"), "hlr should not be headless");
    assert.ok(!headlessIds.includes("hlm"), "hlm should not be headless");
  });

  test("backend with no UI consumer is headless", async () => {
    const staticData = buildStatic({ lensDirs: [], domainFiles: [] });
    const runtime = buildRuntime({ macros: [{ domain: "ghost-domain", name: "run" }] });
    const x = await crossReferenceAll(ROOT, staticData, runtime);
    assert.equal(x.headlessBackends.length, 1);
    assert.equal(x.headlessBackends[0].domain, "ghost-domain");
  });
});
