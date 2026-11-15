// FIX-app-maker-001 S2 — preview runtime + bootstrap.
// Emission pins drive the real previewRender action; interpreter pins run
// the emitted platform runtime under a stub DOM (the runtime's DOM surface
// is deliberately narrow) and exercise the workflow vocabulary end to end.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import registerAppmakerActions from "../domains/appmaker.js";
import { APPMAKER_PREVIEW_RUNTIME, APPMAKER_RUNTIME_VERSION } from "../lib/appmaker-preview-runtime.js";

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

// A counter-flavoured project: input + button + a {{count}} heading, a
// connector with secrets that must never reach the document, two pages.
async function buildProject() {
  const p = await call("projectCreate", ctxA, { name: "Runtime App" });
  const proj = p.result.project;
  const page = proj.pages[0];
  await call("editorSavePage", ctxA, {
    projectId: proj.id, pageId: page.id,
    elements: [
      { id: "in1", type: "input", x: 0, y: 0, w: 160, h: 36, props: { placeholder: "type a number" } },
      { id: "btn1", type: "button", x: 0, y: 48, w: 120, h: 40, props: { label: "Add" } },
      { id: "hd1", type: "heading", x: 0, y: 100, w: 220, h: 40, props: { text: "{{count}}" } },
      { id: "hd2", type: "heading", x: 0, y: 150, w: 220, h: 40, props: { text: "{{echo}}" } },
    ],
  });
  const t = await call("dataAddTable", ctxA, { projectId: proj.id, name: "Customers" });
  assert.equal(t.ok, true);
  const c = await call("connectorSave", ctxA, {
    projectId: proj.id,
    connector: { name: "API", kind: "rest", endpoint: "https://93.184.216.34/secret-path-xyz", method: "GET", credential: "supersecret-token-9999" },
  });
  assert.equal(c.ok, true);
  const wf = async (name, trigger, steps) => {
    const r = await call("workflowSave", ctxA, { projectId: proj.id, workflow: { name, trigger, steps } });
    assert.equal(r.ok, true);
  };
  await wf("Set count", "button_click", [{ action: "set_state", target: "count", params: { value: "7" } }]);
  await wf("Echo input", "input_change", [{ action: "set_state", target: "echo" }]);
  await wf("Welcome", "page_load", [{ action: "show_toast", target: "Welcome!" }]);
  const r = await call("previewRender", ctxA, { projectId: proj.id });
  assert.equal(r.ok, true);
  return r.result;
}

describe("app-maker preview runtime emission (FIX-app-maker-001 S2)", () => {
  it("previewRender returns the bootstrap and embeds runtime + CSP + hooks", async () => {
    const res = await buildProject();
    assert.equal(res.runtime.v, 1);
    assert.equal(res.runtime.runtime, APPMAKER_RUNTIME_VERSION);
    assert.equal(res.runtime.pages[0].elements.length, 4);
    assert.equal(res.runtime.workflows.length, 3);
    assert.equal(res.runtime.tables[0].name, "Customers");
    assert.deepEqual(Object.keys(res.runtime.connectors[0]).sort(), ["id", "kind", "method", "name"]);
    assert.ok(res.html.includes('http-equiv="Content-Security-Policy"'));
    assert.ok(res.html.includes("connect-src 'none'"));
    assert.ok(res.html.includes('id="am-bootstrap"'));
    assert.ok(res.html.includes('data-el-id="btn1"'));
    assert.ok(res.html.includes('data-am-page='));
    assert.ok(res.html.includes(APPMAKER_RUNTIME_VERSION));
  });

  it("no connector endpoint or credential material reaches the document or bootstrap", async () => {
    const res = await buildProject();
    const whole = res.html + JSON.stringify(res.runtime);
    assert.ok(!whole.includes("secret-path-xyz"), "endpoint path absent");
    assert.ok(!whole.includes("supersecret-token-9999"), "credential absent");
    assert.ok(!whole.includes("credentialHint"), "no credential hint field");
  });
});

// ── Stub DOM interpreter harness ─────────────────────────────────────
function makeNode(tag) {
  return {
    tagName: tag, attrs: {}, style: {}, textContent: "", value: "", children: [], parentNode: null,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
  };
}
function bootRuntime(bootstrap, elementText = {}) {
  const elNodes = new Map();
  const containers = [];
  for (const page of bootstrap.pages) {
    const cont = makeNode("div");
    cont.setAttribute("data-am-page", page.id);
    containers.push(cont);
    for (const el of page.elements) {
      const n = makeNode("div");
      n.setAttribute("data-el-id", el.id);
      if (elementText[el.id] != null) n.textContent = elementText[el.id];
      n.parentNode = cont;
      elNodes.set(el.id, n);
    }
  }
  const bootNode = makeNode("script");
  bootNode.textContent = JSON.stringify(bootstrap);
  const body = makeNode("body");
  const handlers = {};
  const timers = [];
  const documentStub = {
    body,
    getElementById: (id) => (id === "am-bootstrap" ? bootNode : null),
    querySelectorAll: (sel) => {
      if (sel === "[data-el-id]") return [...elNodes.values()];
      if (sel === "[data-am-page]") return containers;
      if (sel === "[data-caption-for]") return [];
      return [];
    },
    createElement: (tag) => makeNode(tag),
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  const windowStub = { addEventListener: (type, fn) => { handlers["window:" + type] = fn; } };
  const parentStub = { messages: [], postMessage(m) { this.messages.push(m); } };
  const sandbox = {
    document: documentStub, window: windowStub, parent: parentStub,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    Date, JSON, console,
  };
  windowStub.__sandbox = sandbox;
  vm.runInNewContext(APPMAKER_PREVIEW_RUNTIME, sandbox);
  const chrome = {};
  for (const child of body.children) chrome[child.getAttribute("id")] = child;
  return { elNodes, containers, handlers, timers, parent: parentStub, chrome, window: windowStub };
}

describe("app-maker preview runtime interpreter (FIX-app-maker-001 S2)", () => {
  it("button_click fires set_state and the {{count}} heading renders it; page_load toasts", async () => {
    const res = await buildProject();
    const rt = bootRuntime(res.runtime, { hd1: "{{count}}", hd2: "{{echo}}" });
    assert.equal(rt.chrome["am-toast"].textContent, "Welcome!");
    rt.handlers.click({ target: rt.elNodes.get("btn1"), preventDefault() {} });
    assert.equal(rt.window.__amRuntime.state().count, "7");
    assert.equal(rt.elNodes.get("hd1").textContent, "7");
  });

  it("input_change carries the input's current value into state", async () => {
    const res = await buildProject();
    const rt = bootRuntime(res.runtime, { hd1: "{{count}}", hd2: "{{echo}}" });
    rt.elNodes.get("in1").value = "hello";
    rt.handlers.input({ target: rt.elNodes.get("in1"), preventDefault() {} });
    assert.equal(rt.elNodes.get("hd2").textContent, "hello");
  });

  it("an unknown navigate target and a call_api step speak in the strip; table steps post one bridge message and time out honestly", async () => {
    const p = await call("projectCreate", ctxA, { name: "Strip App" });
    const proj = p.result.project;
    const page = proj.pages[0];
    await call("editorSavePage", ctxA, {
      projectId: proj.id, pageId: page.id,
      elements: [{ id: "b", type: "button", x: 0, y: 0, w: 100, h: 36, props: { label: "Go" } }],
    });
    await call("workflowSave", ctxA, {
      projectId: proj.id,
      workflow: { name: "Mixed", trigger: "button_click", steps: [
        { action: "navigate", target: "Nowhere" },
        { action: "call_api", target: "API" },
        { action: "create_row", target: "Customers" },
      ] },
    });
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    const rt = bootRuntime(r.result.runtime);
    rt.handlers.click({ target: rt.elNodes.get("b"), preventDefault() {} });
    assert.ok(rt.chrome["am-error-strip"].textContent.includes("call_api is not run in preview"));
    assert.equal(rt.parent.messages.length, 1);
    assert.equal(rt.parent.messages[0].kind, "am-bridge");
    assert.equal(rt.parent.messages[0].action, "create_row");
    // The navigate refusal was overwritten by the later notice; fire only
    // the navigate step on a second runtime to pin its wording.
    const p2 = await call("projectCreate", ctxA, { name: "Nav App" });
    const proj2 = p2.result.project;
    await call("editorSavePage", ctxA, {
      projectId: proj2.id, pageId: proj2.pages[0].id,
      elements: [{ id: "b", type: "button", x: 0, y: 0, w: 100, h: 36, props: { label: "Go" } }],
    });
    await call("workflowSave", ctxA, {
      projectId: proj2.id,
      workflow: { name: "Nav", trigger: "button_click", steps: [{ action: "navigate", target: "Nowhere" }] },
    });
    const r2 = await call("previewRender", ctxA, { projectId: proj2.id });
    const rt2 = bootRuntime(r2.result.runtime);
    rt2.handlers.click({ target: rt2.elNodes.get("b"), preventDefault() {} });
    assert.ok(rt2.chrome["am-error-strip"].textContent.includes("no page named 'Nowhere'"));
    // Bridge timeout speaks instead of staying silent.
    for (const t of rt.timers) if (t.ms === 1500) t.fn();
    assert.ok(rt.chrome["am-error-strip"].textContent.includes("could not reach the app data store"));
  });

  it("a page_load navigate loop stops at the cascade depth cap", async () => {
    const p = await call("projectCreate", ctxA, { name: "Loop App" });
    const proj = p.result.project;
    const pageA = proj.pages[0];
    const add = await call("editorAddPage", ctxA, { projectId: proj.id, name: "B" });
    assert.equal(add.ok, true);
    const pageB = add.result.page;
    await call("workflowSave", ctxA, {
      projectId: proj.id,
      workflow: { name: "ToB", trigger: "page_load", steps: [{ action: "navigate", target: "B" }] },
    });
    const r = await call("previewRender", ctxA, { projectId: proj.id });
    // Both pages share the one page_load workflow; navigation fires
    // page_load again on the shown page — the depth cap must stop it.
    const rt = bootRuntime(r.result.runtime);
    assert.ok(rt.chrome["am-error-strip"].textContent.includes("cascade too deep"));
    assert.ok(pageA && pageB);
  });
});
