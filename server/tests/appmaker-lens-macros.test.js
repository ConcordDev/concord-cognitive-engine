// Behavioral macro tests for server/domains/appmaker.js — the no-code app
// builder substrate the /lenses/app-maker lens drives.
//
// WIRING NOTE (load-bearing): every handler in server/domains/appmaker.js
// registers under the domain id "app-maker" (HYPHEN). The /api/lens/:domain/:id/run
// + /api/lens/run dispatch keys on the EXACT `${domain}.${action}` string with no
// normalization (server.js:39128 / 39281), so the page MUST call domain
// 'app-maker', not 'appmaker' — a non-hyphen call resolves to NO receiver
// (unknown_macro). This harness pins the registered domain so a regression that
// flips the id surfaces here.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39281):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention,
// where `virtualArtifact.data === input`. Our harness calls
// `fn(ctx, { ...data: input }, input)` so a regression that confuses the param
// positions (e.g. reading params from `ctx`) surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips (create project → it appears in the list → edit pages /
// data model / workflows → deploy flips status to live with a real URL → version
// snapshot/restore round-trips). Per-user isolation holds. Pure-compute macros
// (scaffoldApp / uiComplexity / wireframeValidate) are driven on their
// DETERMINISTIC paths (no LLM, no network). Poisoned inputs fail CLOSED. Empty
// STATE degrades graceful (ok:true / structured ok:false, never no_db / throw).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAppmakerActions from "../domains/appmaker.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "app-maker", `unexpected domain: ${domain} (must be the hyphenated id the page calls)`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input), virtualArtifact.data === input.
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  const virtualArtifact = { id: null, domain: "app-maker", type: "domain_action", data: input || {}, meta: {} };
  return await fn(ctx, virtualArtifact, input || {});
}

before(() => { registerAppmakerActions(registerLensAction); });
beforeEach(() => {
  // Isolate per-test STATE so projects/graphs/marketplace never leak.
  globalThis._concordSTATE = {};
  // Network is disabled — connectorTest must fail safe, never reach out.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

async function freshProject(ctx = ctxA, name = "Test App") {
  const r = await call("projectCreate", ctx, { name });
  assert.equal(r.ok, true);
  return r.result.project;
}

describe("app-maker — registration (every lens-driven macro present)", () => {
  it("registers all macros the page + AppBuilderStudio call", () => {
    for (const m of [
      // page.tsx compute-action panel (useRunArtifact)
      "scaffoldApp", "uiComplexity", "wireframeValidate",
      // AppBuilderStudio — project lifecycle
      "projectCreate", "projectList", "projectGet", "projectDuplicate", "projectDelete",
      // visual editor
      "editorPalette", "editorAddPage", "editorSavePage", "editorDeletePage",
      // data model
      "dataFieldTypes", "dataAddTable", "dataSaveTable", "dataDeleteTable",
      "dataAddRelation", "dataDeleteRelation",
      // workflows
      "workflowOptions", "workflowSave", "workflowDelete",
      // preview + deploy + versions
      "previewRender", "deployPublish", "deployStatus",
      "versionSnapshot", "versionList", "versionRestore",
      // library + connectors + bindings
      "librarySave", "libraryList", "libraryDelete",
      "connectorKinds", "connectorSave", "connectorList", "connectorDelete", "connectorTest",
      "dataBindElement", "dataUnbindElement", "dataBindings",
      // quest authoring + marketplace
      "questGraphCreate", "questGraphList", "questGraphGet", "questGraphDelete",
      "questNodeSave", "questNodeDelete", "questEdgeAdd", "questEdgeDelete", "questGraphValidate",
      "marketPublish", "marketBrowse", "marketInstall", "marketUnpublish",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing app-maker.${m}`);
    }
  });
});

describe("app-maker — scaffoldApp (deterministic, no LLM)", () => {
  it("computes the real route map, dedups shared components, and reports honest metrics", async () => {
    // Two pages reuse a Button → component reuse must be tracked.
    const spec = {
      auth: true,
      pages: [
        { name: "Home", path: "/", components: [
          { type: "Header", children: [{ type: "Nav" }] },
          { type: "Button" },
        ] },
        { name: "Profile", path: "/user/:id", components: [
          { type: "Button" },
          { type: "Avatar" },
        ] },
      ],
    };
    const r = await call("scaffoldApp", ctxA, { spec, framework: "react" });
    assert.equal(r.ok, true);
    const res = r.result;
    // 2 routes, one dynamic with a real param name.
    assert.equal(res.routes.length, 2);
    const profile = res.routes.find((x) => x.name === "Profile");
    assert.equal(profile.dynamic, true);
    assert.deepEqual(profile.params, ["id"]);
    // total components counted across both pages (Header, Nav, Button, Button, Avatar = 5).
    assert.equal(res.metrics.totalComponents, 5);
    // Button appears twice → it is a shared component with reuseCount 2.
    const shared = res.stateManagement.sharedComponents.find((c) => c.type === "Button");
    assert.ok(shared, "Button detected as shared");
    assert.equal(shared.reuseCount, 2);
    // Auth on → an auth state slice + AuthProvider file exist.
    assert.equal(res.metrics.hasAuth, true);
    assert.ok(res.fileStructure.some((f) => f.type === "auth"));
    assert.ok(res.stateManagement.slices.some((s) => s.name === "auth"));
    // estimatedLOC is a real positive finite number, not a placeholder.
    assert.ok(Number.isFinite(res.metrics.estimatedLOC) && res.metrics.estimatedLOC > 0);
    // max nesting depth: Home/Header/Nav → 2.
    assert.equal(res.metrics.maxNestingDepth, 2);
  });

  it("degrades graceful on an empty spec (ok:true with an honest message, never throws)", async () => {
    const r = await call("scaffoldApp", ctxA, { spec: { pages: [] } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No pages/i);
  });

  it("survives a poisoned spec (non-array pages) without throwing", async () => {
    const r = await call("scaffoldApp", ctxA, { spec: { pages: "not-an-array" } });
    // Either a clean ok:false handler_error OR an ok:true "no pages" — never an uncaught throw.
    assert.equal(typeof r.ok, "boolean");
  });
});

describe("app-maker — uiComplexity (deterministic cognitive-load math)", () => {
  it("counts widgets + interactive elements and grades cognitive level", async () => {
    const screens = [
      { name: "Dense", widgets: [
        { type: "button" }, { type: "input" }, { type: "select" },
        { type: "text" }, { type: "text" }, { type: "card", children: [{ type: "button" }] },
      ] },
    ];
    const r = await call("uiComplexity", ctxA, { screens });
    assert.equal(r.ok, true);
    const s = r.result.screens[0];
    // 7 widgets total (6 top + 1 nested button).
    assert.equal(s.widgetCount, 7);
    // interactive: button, input, select, nested button = 4.
    assert.equal(s.interactiveCount, 4);
    // nested card → depth 2.
    assert.equal(s.maxNestingDepth, 2);
    assert.ok(["manageable", "moderate", "overloaded"].includes(s.cognitiveLevel));
    assert.ok(Number.isFinite(r.result.globalMetrics.consistencyScore));
  });

  it("empty screens → ok:true honest message", async () => {
    const r = await call("uiComplexity", ctxA, { screens: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No screens/i);
  });
});

describe("app-maker — wireframeValidate (graph reachability + dead-ends)", () => {
  it("flags broken links, orphans, dead-ends and unreachable screens", async () => {
    const wireframe = { screens: [
      { name: "Home", links: ["Settings", "Ghost"], actions: [{ type: "navigate" }] },
      { name: "Settings", links: [], actions: [{ type: "back" }] },     // dead-end
      { name: "Lonely", links: [], actions: [] },                       // orphan + unreachable + dead-end
    ] };
    const r = await call("wireframeValidate", ctxA, { wireframe });
    assert.equal(r.ok, true);
    const res = r.result;
    // "Ghost" is not a real screen → broken_link error → valid:false.
    assert.equal(res.valid, false);
    assert.ok(res.issues.some((i) => i.type === "broken_link" && i.target === "Ghost"));
    assert.ok(res.deadEnds.includes("Settings"));
    assert.ok(res.orphans.includes("Lonely"));
    assert.ok(res.unreachable.includes("Lonely"));
    // navigationCompleteness is a real percentage (Home + Settings reachable / 3 screens).
    assert.ok(res.summary.navigationCompleteness < 100);
  });

  it("a clean two-screen flow validates valid:true", async () => {
    const wireframe = { screens: [
      { name: "Home", links: ["Detail"], actions: [{ type: "navigate" }, { type: "submit" }, { type: "cancel" }, { type: "back" }] },
      { name: "Detail", links: ["Home"], actions: [{ type: "back" }] },
    ] };
    const r = await call("wireframeValidate", ctxA, { wireframe });
    assert.equal(r.ok, true);
    assert.equal(r.result.valid, true);
    assert.equal(r.result.summary.errorCount, 0);
  });
});

describe("app-maker — project lifecycle round-trip", () => {
  it("create → list reflects it → get returns the full project → delete removes it", async () => {
    const proj = await freshProject();
    assert.ok(proj.id);
    assert.equal(proj.pages.length, 1);

    const list = await call("projectList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].id, proj.id);
    assert.equal(list.result.projects[0].pageCount, 1);

    const got = await call("projectGet", ctxA, { projectId: proj.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.project.name, "Test App");

    const del = await call("projectDelete", ctxA, { projectId: proj.id });
    assert.equal(del.ok, true);
    assert.equal((await call("projectList", ctxA, {})).result.count, 0);
  });

  it("duplicate clones content but resets deployment + versions + id", async () => {
    const proj = await freshProject();
    await call("deployPublish", ctxA, { projectId: proj.id });
    const dup = await call("projectDuplicate", ctxA, { projectId: proj.id });
    assert.equal(dup.ok, true);
    assert.notEqual(dup.result.project.id, proj.id);
    assert.match(dup.result.project.name, /\(copy\)/);
    assert.equal(dup.result.project.deployment.status, "undeployed");
    assert.equal(dup.result.project.versions.length, 0);
  });

  it("acting on an unknown projectId is a structured not_found, never a throw", async () => {
    for (const m of ["projectGet", "projectDelete", "editorAddPage", "dataAddTable", "deployStatus", "versionList"]) {
      const r = await call(m, ctxA, { projectId: "ghost" });
      assert.equal(r.ok, false);
      assert.equal(r.error, "project_not_found");
    }
  });
});

describe("app-maker — editor + data model + workflow round-trips", () => {
  it("adds a page, saves a clamped element layout, and refuses to delete the last page", async () => {
    const proj = await freshProject();
    const add = await call("editorAddPage", ctxA, { projectId: proj.id, name: "Dashboard" });
    assert.equal(add.ok, true);
    assert.equal(add.result.pages.length, 2);
    const pageId = add.result.page.id;

    // Save a layout with one valid + one garbage element; garbage is coerced, not dropped.
    const save = await call("editorSavePage", ctxA, {
      projectId: proj.id, pageId,
      elements: [
        { type: "button", x: 10, y: 20, w: 120, h: 40 },
        { type: "text", x: "bad", y: NaN, w: undefined, h: null },
      ],
    });
    assert.equal(save.ok, true);
    assert.equal(save.result.elementCount, 2);
    // bad numerics coerced to defaults, not NaN/undefined.
    assert.equal(save.result.page.elements[1].x, 0);
    assert.equal(save.result.page.elements[1].w, 120);

    // delete the new page (ok), then deleting the last remaining page is refused.
    assert.equal((await call("editorDeletePage", ctxA, { projectId: proj.id, pageId })).ok, true);
    const last = await call("editorDeletePage", ctxA, { projectId: proj.id, pageId: proj.pages[0].id });
    assert.equal(last.ok, false);
    assert.equal(last.error, "cannot_delete_last_page");
  });

  it("data model: add table → save fields (whitelist) → relation → delete cascades relations", async () => {
    const proj = await freshProject();
    const t1 = (await call("dataAddTable", ctxA, { projectId: proj.id, name: "Users" })).result.table;
    const t2 = (await call("dataAddTable", ctxA, { projectId: proj.id, name: "Posts" })).result.table;
    // duplicate table name rejected.
    assert.equal((await call("dataAddTable", ctxA, { projectId: proj.id, name: "users" })).error, "table_name_exists");

    // save fields — an unknown field type falls back to "text".
    const saved = await call("dataSaveTable", ctxA, {
      projectId: proj.id, tableId: t1.id,
      fields: [{ name: "email", type: "email" }, { name: "weird", type: "not-a-type" }],
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.table.fields.find((f) => f.name === "weird").type, "text");

    const rel = await call("dataAddRelation", ctxA, {
      projectId: proj.id, fromTable: t1.id, toTable: t2.id, kind: "one-to-many",
    });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.dataModel.relations.length, 1);

    // deleting t2 cascades — the relation referencing it is removed.
    const del = await call("dataDeleteTable", ctxA, { projectId: proj.id, tableId: t2.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.dataModel.relations.length, 0);
  });

  it("workflow save normalizes unknown trigger/action to safe defaults", async () => {
    const proj = await freshProject();
    const wf = await call("workflowSave", ctxA, {
      projectId: proj.id,
      workflow: { name: "On click", trigger: "nope", steps: [{ action: "evil" }] },
    });
    assert.equal(wf.ok, true);
    assert.equal(wf.result.workflow.trigger, "button_click");
    assert.equal(wf.result.workflow.steps[0].action, "show_toast");
    // delete it.
    assert.equal((await call("workflowDelete", ctxA, { projectId: proj.id, workflowId: wf.result.workflow.id })).result.workflows.length, 0);
  });
});

describe("app-maker — preview + deploy + version round-trips", () => {
  it("previewRender escapes user content into safe static HTML (no raw injection)", async () => {
    const proj = await freshProject();
    const pageId = proj.pages[0].id;
    await call("editorSavePage", ctxA, {
      projectId: proj.id, pageId,
      elements: [{ type: "heading", x: 0, y: 0, w: 200, h: 40, props: { text: "<script>alert(1)</script>" } }],
    });
    const r = await call("previewRender", ctxA, { projectId: proj.id, pageId });
    assert.equal(r.ok, true);
    assert.match(r.result.html, /^<!doctype html>/i);
    // The raw script tag must be escaped, never emitted verbatim.
    assert.ok(!r.result.html.includes("<script>alert(1)</script>"));
    assert.ok(r.result.html.includes("&lt;script&gt;"));
  });

  it("deployPublish flips status to live with a real concord-os URL + snapshots a version", async () => {
    const proj = await freshProject();
    const dep = await call("deployPublish", ctxA, { projectId: proj.id });
    assert.equal(dep.ok, true);
    assert.equal(dep.result.deployment.status, "live");
    assert.match(dep.result.deployment.url, /^https:\/\/[a-z0-9-]+\.apps\.concord-os\.org$/);

    // deployStatus reflects the live deployment.
    const st = await call("deployStatus", ctxA, { projectId: proj.id });
    assert.equal(st.result.deployment.status, "live");

    // a version was snapshotted by the deploy.
    const vl = await call("versionList", ctxA, { projectId: proj.id });
    assert.equal(vl.result.count, 1);
  });

  it("version snapshot → mutate → restore rolls the project back", async () => {
    const proj = await freshProject();
    const snap = await call("versionSnapshot", ctxA, { projectId: proj.id, label: "v1" });
    assert.equal(snap.ok, true);
    const verId = snap.result.version.id;

    // mutate: add a page so state differs from the snapshot.
    await call("editorAddPage", ctxA, { projectId: proj.id, name: "Extra" });
    assert.equal((await call("projectGet", ctxA, { projectId: proj.id })).result.project.pages.length, 2);

    // restore → back to 1 page (and an auto-save version is pushed, so count grows).
    const restore = await call("versionRestore", ctxA, { projectId: proj.id, versionId: verId });
    assert.equal(restore.ok, true);
    assert.equal(restore.result.project.pages.length, 1);
  });
});

describe("app-maker — connectors fail safe + never store plaintext credentials", () => {
  it("connectorSave masks the credential and rejects unknown kinds", async () => {
    const proj = await freshProject();
    const bad = await call("connectorSave", ctxA, { projectId: proj.id, connector: { kind: "telepathy" } });
    assert.equal(bad.error, "unknown_connector_kind");

    const c = await call("connectorSave", ctxA, {
      projectId: proj.id,
      connector: { name: "API", kind: "rest", endpoint: "https://example.com/api", method: "GET", credential: "supersecret-token-1234" },
    });
    assert.equal(c.ok, true);
    // credential is never stored plaintext — only a masked hint.
    assert.equal(c.result.connector.credential, undefined);
    assert.match(c.result.connector.credentialHint, /^•+1234$/);
  });

  it("connectorTest fails safe (network disabled) without throwing", async () => {
    const proj = await freshProject();
    const c = (await call("connectorSave", ctxA, {
      projectId: proj.id, connector: { name: "API", kind: "rest", endpoint: "https://example.com", method: "GET" },
    })).result.connector;
    const r = await call("connectorTest", ctxA, { projectId: proj.id, connectorId: c.id });
    // fetch throws in tests → handler returns ok:true with reachable:false, never an uncaught throw.
    assert.equal(r.ok, true);
    assert.equal(r.result.reachable, false);
  });

  it("connectorTest rejects a non-http endpoint as invalid (no SSRF on a bad scheme)", async () => {
    const proj = await freshProject();
    // Force a saved connector with a non-http endpoint by editing through saveTable-less path:
    const c = (await call("connectorSave", ctxA, {
      projectId: proj.id, connector: { name: "Bad", kind: "rest", endpoint: "file:///etc/passwd", method: "GET" },
    })).result.connector;
    const r = await call("connectorTest", ctxA, { projectId: proj.id, connectorId: c.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_endpoint");
  });
});

describe("app-maker — quest graph authoring round-trip + validation", () => {
  it("create graph → add node + edge → validate flags missing ending", async () => {
    const g = (await call("questGraphCreate", ctxA, { title: "Q1" })).result.graph;
    const startId = g.nodes[0].id;
    const step = (await call("questNodeSave", ctxA, { graphId: g.id, node: { kind: "step", title: "Talk" } })).result.node;
    const edge = await call("questEdgeAdd", ctxA, { graphId: g.id, from: startId, to: step.id });
    assert.equal(edge.ok, true);
    // self-edge + duplicate edge are rejected.
    assert.equal((await call("questEdgeAdd", ctxA, { graphId: g.id, from: startId, to: startId })).error, "cannot_connect_to_self");
    assert.equal((await call("questEdgeAdd", ctxA, { graphId: g.id, from: startId, to: step.id })).error, "edge_exists");

    const v = await call("questGraphValidate", ctxA, { graphId: g.id });
    assert.equal(v.ok, true);
    assert.equal(v.result.valid, true); // no error-severity issues
    assert.ok(v.result.issues.some((i) => i.type === "no_ending"));
  });

  it("cannot delete the start node", async () => {
    const g = (await call("questGraphCreate", ctxA, {})).result.graph;
    const r = await call("questNodeDelete", ctxA, { graphId: g.id, nodeId: g.nodes[0].id });
    assert.equal(r.error, "cannot_delete_start_node");
  });
});

describe("app-maker — component marketplace (cross-user, ownership-gated)", () => {
  it("publish → another user browses + installs → only the publisher can unpublish", async () => {
    // user_a builds a project, saves a library component, publishes it.
    const projA = await freshProject(ctxA);
    const comp = (await call("librarySave", ctxA, {
      projectId: projA.id, component: { name: "Fancy Button", baseType: "button", style: { color: "cyan" } },
    })).result.component;
    const listing = (await call("marketPublish", ctxA, {
      projectId: projA.id, componentId: comp.id, category: "buttons", description: "A nice button",
    })).result.listing;
    assert.ok(listing.id);

    // user_b browses (cross-user) and installs into their own project.
    const browse = await call("marketBrowse", ctxB, { category: "buttons" });
    assert.equal(browse.ok, true);
    assert.equal(browse.result.count, 1);
    const projB = await freshProject(ctxB, "B App");
    const inst = await call("marketInstall", ctxB, { projectId: projB.id, listingId: listing.id });
    assert.equal(inst.ok, true);
    assert.equal(inst.result.component.fromMarketplace, listing.id);

    // install bumped the listing's install count.
    assert.equal((await call("marketBrowse", ctxA, {})).result.listings[0].installs, 1);

    // user_b cannot unpublish user_a's listing.
    assert.equal((await call("marketUnpublish", ctxB, { listingId: listing.id })).error, "not_publisher");
    // user_a can.
    assert.equal((await call("marketUnpublish", ctxA, { listingId: listing.id })).ok, true);
  });
});

describe("app-maker — per-user isolation", () => {
  it("one user's projects + quest graphs never leak to another", async () => {
    await freshProject(ctxA, "A only");
    await call("questGraphCreate", ctxA, { title: "A graph" });
    assert.equal((await call("projectList", ctxA, {})).result.count, 1);
    assert.equal((await call("projectList", ctxB, {})).result.count, 0);
    assert.equal((await call("questGraphList", ctxA, {})).result.count, 1);
    assert.equal((await call("questGraphList", ctxB, {})).result.count, 0);
  });
});

describe("app-maker — degrade-graceful on empty STATE (never no_db)", () => {
  it("read macros on empty STATE return ok:true empty collections, not no_db", async () => {
    // fresh STATE (beforeEach reset) — no projects, no graphs, no marketplace.
    const pl = await call("projectList", ctxA, {});
    assert.equal(pl.ok, true);
    assert.equal(pl.result.count, 0);
    assert.notEqual(pl.error, "no_db");

    const ql = await call("questGraphList", ctxA, {});
    assert.equal(ql.ok, true);
    assert.equal(ql.result.count, 0);

    const mb = await call("marketBrowse", ctxA, {});
    assert.equal(mb.ok, true);
    assert.equal(mb.result.count, 0);

    // Static catalogs always resolve.
    assert.deepEqual((await call("editorPalette", ctxA, {})).ok, true);
    assert.ok((await call("dataFieldTypes", ctxA, {})).result.fieldTypes.includes("email"));
    assert.ok((await call("workflowOptions", ctxA, {})).result.triggers.length > 0);
    assert.ok((await call("connectorKinds", ctxA, {})).result.kinds.length > 0);
  });
});
