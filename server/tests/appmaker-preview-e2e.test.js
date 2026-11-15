// FIX-app-maker-001 S5 (closing) — the ticket's counter app, exercised
// end to end through the real chain: domain actions build the app,
// previewRender emits the document + bootstrap, the REAL platform
// runtime executes under a stub DOM, its table step crosses the bridge
// contract into the REAL previewBridge action, and the reply re-renders.
// Plus the reload leg and bridge-spoof negatives.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import registerAppmakerActions from "../domains/appmaker.js";
import { APPMAKER_PREVIEW_RUNTIME } from "../lib/appmaker-preview-runtime.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "app-maker");
  ACTIONS.set(name, fn);
}
async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`app-maker.${name} not registered`);
  const virtualArtifact = { id: null, domain: "app-maker", type: "domain_action", data: input || {}, meta: {} };
  return await fn(ctx, virtualArtifact, input || {});
}
const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

before(() => { registerAppmakerActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

// The ticket's app: Heading + Text Input + Button, one table, the list
// element bound to it, and the two workflows the substrate supports.
async function buildCounterApp() {
  const p = await call("projectCreate", ctxA, { name: "Counter" });
  const proj = p.result.project;
  const page = proj.pages[0];
  await call("editorSavePage", ctxA, {
    projectId: proj.id, pageId: page.id,
    elements: [
      { id: "hd", type: "heading", x: 0, y: 0, w: 220, h: 40, props: { text: "{{count}}" } },
      { id: "in1", type: "input", x: 0, y: 52, w: 160, h: 36, props: { placeholder: "type a number" } },
      { id: "btn", type: "button", x: 0, y: 100, w: 120, h: 40, props: { label: "Add" } },
      { id: "lst", type: "list", x: 0, y: 152, w: 220, h: 80, props: { label: "Counts" } },
    ],
  });
  const t = await call("dataAddTable", ctxA, { projectId: proj.id, name: "Counts" });
  const tableId = t.result.table.id;
  await call("dataSaveTable", ctxA, {
    projectId: proj.id, tableId,
    fields: [{ name: "id", type: "text" }, { name: "label", type: "text" }],
  });
  await call("dataBindElement", ctxA, { projectId: proj.id, pageId: page.id, elementId: "lst", source: { kind: "table", refId: tableId } });
  await call("workflowSave", ctxA, {
    projectId: proj.id,
    workflow: { name: "Echo count", trigger: "input_change", steps: [{ action: "set_state", target: "count" }] },
  });
  await call("workflowSave", ctxA, {
    projectId: proj.id,
    workflow: { name: "Add click", trigger: "button_click", steps: [
      { action: "create_row", target: "Counts", params: { values: { label: "click" } } },
      { action: "show_toast", target: "Added" },
    ] },
  });
  return proj;
}

function makeNode(tag) {
  return {
    tagName: tag, attrs: {}, style: {}, textContent: "", value: "", children: [], parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
  };
}
function bootRuntime(bootstrap) {
  const elNodes = new Map();
  const captionNodes = [];
  const containers = [];
  for (const page of bootstrap.pages) {
    const cont = makeNode("div");
    cont.setAttribute("data-am-page", page.id);
    containers.push(cont);
    for (const el of page.elements) {
      const n = makeNode("div");
      n.setAttribute("data-el-id", el.id);
      if (el.props?.text) n.textContent = el.props.text;
      n.parentNode = cont;
      elNodes.set(el.id, n);
      if (el.binding?.kind === "table") {
        const cap = makeNode("div");
        cap.setAttribute("data-caption-for", el.id);
        cap.textContent = "Data: Counts — id, label";
        captionNodes.push(cap);
      }
    }
  }
  const bootNode = makeNode("script");
  bootNode.textContent = JSON.stringify(bootstrap);
  const body = makeNode("body");
  const handlers = {};
  const documentStub = {
    body,
    getElementById: (id) => (id === "am-bootstrap" ? bootNode : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-el-id]") return [...elNodes.values()];
      if (sel === "[data-am-page]") return containers;
      if (sel === "[data-caption-for]") return captionNodes;
      return [];
    },
    createElement: (tag) => makeNode(tag),
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  const windowStub = { addEventListener: (type, fn) => { handlers["window:" + type] = fn; } };
  const parentStub = { messages: [], postMessage(m) { this.messages.push(m); } };
  const sandbox = {
    document: documentStub, window: windowStub, parent: parentStub,
    setTimeout: () => 0, clearTimeout: () => {},
    Date, JSON, console,
  };
  vm.runInNewContext(APPMAKER_PREVIEW_RUNTIME, sandbox);
  const chrome = {};
  for (const child of body.children) chrome[child.getAttribute("id")] = child;
  return { elNodes, captionNodes, handlers, parent: parentStub, chrome, window: windowStub };
}

describe("app-maker preview end-to-end (FIX-app-maker-001 S5)", () => {
  it("the counter app: typing renders state; Add crosses the real bridge and the reply re-renders the binding", async () => {
    const proj = await buildCounterApp();
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    const rt = bootRuntime(r.result.runtime);

    // Type 7 → the heading renders it (the ticket's counter display).
    rt.elNodes.get("in1").value = "7";
    rt.handlers.input({ target: rt.elNodes.get("in1"), preventDefault() {} });
    assert.equal(rt.elNodes.get("hd").textContent, "7");

    // Click Add → the workflow's table step posts ONE bridge message.
    rt.handlers.click({ target: rt.elNodes.get("btn"), preventDefault() {} });
    assert.equal(rt.chrome["am-toast"].textContent, "Added");
    assert.equal(rt.parent.messages.length, 1);
    const msg = rt.parent.messages[0];
    assert.equal(msg.kind, "am-bridge");
    assert.equal(msg.action, "create_row");
    assert.equal(msg.table, "Counts");
    assert.equal(msg.projectId, proj.id);

    // Spoof negatives: forged requestId and wrong version are ignored.
    const deliver = rt.handlers["window:message"];
    deliver({ data: { kind: "am-bridge-reply", v: 1, requestId: "am999", ok: true, table: "Counts", rows: [{}, {}, {}] } });
    deliver({ data: { kind: "am-bridge-reply", v: 2, requestId: msg.requestId, ok: true, table: "Counts", rows: [{}, {}, {}] } });
    assert.equal(rt.captionNodes[0].textContent, "Data: Counts — id, label");

    // The real relay: the message's own fields into the REAL action.
    const bridged = await call("previewBridge", ctxA, {
      projectId: msg.projectId, sessionId: "pv_e2e", action: msg.action, table: msg.table, config: msg.config,
    });
    assert.equal(bridged.ok, true);
    assert.equal(bridged.result.rows.length, 1);
    assert.equal(bridged.result.rows[0].label, "click");
    deliver({ data: { kind: "am-bridge-reply", v: 1, requestId: msg.requestId, ok: true, table: "Counts", rows: bridged.result.rows } });
    assert.ok(rt.captionNodes[0].textContent.endsWith("· 1 rows"), "caption re-renders from the reply");
  });

  it("the reload leg: a fresh previewRender carries the same saved app and boots clean", async () => {
    const proj = await buildCounterApp();
    const r1 = await call("previewRender", ctxA, { projectId: proj.id });
    const r2 = await call("previewRender", ctxA, { projectId: proj.id });
    const ids = (rt) => rt.pages[0].elements.map((e) => e.id);
    assert.deepEqual(ids(r2.result.runtime), ids(r1.result.runtime));
    assert.equal(r2.result.runtime.workflows.length, 2);
    const rt = bootRuntime(r2.result.runtime);
    assert.equal(rt.chrome["am-error-strip"].textContent, "");
    assert.equal(rt.window.__amRuntime.state().count, undefined);
  });

  it("user strings move as text only: no innerHTML in the runtime; a hostile workflow name cannot break the bootstrap block", async () => {
    assert.ok(!APPMAKER_PREVIEW_RUNTIME.includes("innerHTML"));
    const p = await call("projectCreate", ctxA, { name: "Hostile" });
    const proj = p.result.project;
    await call("workflowSave", ctxA, {
      projectId: proj.id,
      workflow: { name: "Evil</script><script>alert(1)</script>", trigger: "page_load", steps: [{ action: "show_toast", target: "x" }] },
    });
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    assert.equal(r.ok, true);
    assert.ok(!r.result.html.includes("</script><script>alert"), "no script break-out");
    assert.equal((r.result.html.match(/<\/script>/g) || []).length, 2, "exactly the bootstrap + runtime blocks close");
  });
});
