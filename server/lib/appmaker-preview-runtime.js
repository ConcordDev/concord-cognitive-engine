// FIX-app-maker-001 S2 — the app-maker preview runtime.
//
// This is a PLATFORM-AUTHORED, versioned script that previewRender inlines
// into the preview document. It interprets the project's saved workflows
// (declarative trigger + step data) — user content is never executed as
// code; the runtime reads the JSON bootstrap and walks step data only.
//
// The DOM surface it uses is deliberately narrow (getElementById,
// querySelectorAll, createElement, addEventListener, textContent, style,
// value) so server tests can drive it under a stub DOM.
//
// Contracts (design of record: CB-0670 premise):
//  - Local actions execute in-frame: set_state · show_toast · navigate ·
//    triggers button_click / input_change / form_submit / page_load.
//  - Table actions (create_row / update_row / delete_row) post ONE bridge
//    message { kind: "am-bridge", v: 1, requestId, projectId, action,
//    table, config } to the parent and fail honestly in the error strip
//    if no answer arrives (the parent handler + data store are S3/S4).
//  - call_api / send_email steps and schedule workflows are NOT executed
//    (fork F2) and say so in the strip.
//  - Budgets: <=300 step-executions per event cascade, cascade depth <=3,
//    20 events/second, state JSON <= 64 KB. Every refusal speaks.

export const APPMAKER_RUNTIME_VERSION = "am-runtime/1";

export const APPMAKER_PREVIEW_RUNTIME = `(function () {
  "use strict";
  var VERSION = "am-runtime/1";
  var bootEl = document.getElementById("am-bootstrap");
  if (!bootEl) return;
  var boot = null;
  try { boot = JSON.parse(bootEl.textContent || "{}"); } catch (e) { return; }
  if (!boot || !boot.pages) return;

  var state = {};
  var tableRows = {};
  var currentPageId = boot.pageId;
  var stepBudget = 0;
  var cascadeDepth = 0;
  var eventTimes = [];
  var bridgeSeq = 0;
  var pending = {};

  function makeDiv(id, css) {
    var d = document.createElement("div");
    d.setAttribute("id", id);
    d.setAttribute("style", css);
    document.body.appendChild(d);
    return d;
  }
  var strip = makeDiv("am-error-strip", "display:none;position:fixed;left:8px;right:8px;bottom:8px;background:#450a0a;color:#fecaca;border:1px solid #7f1d1d;border-radius:8px;padding:8px 10px;font:12px system-ui;z-index:50;");
  var toastBox = makeDiv("am-toast", "display:none;position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#164e63;color:#ecfeff;border:1px solid #155e75;border-radius:8px;padding:8px 14px;font:13px system-ui;z-index:50;");
  var toastTimer = null;
  function complain(msg) { strip.textContent = msg; strip.style.display = "block"; }
  function toast(msg) {
    toastBox.textContent = msg; toastBox.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastBox.style.display = "none"; }, 2600);
  }

  function pageById(id) { for (var i = 0; i < boot.pages.length; i++) if (boot.pages[i].id === id) return boot.pages[i]; return null; }
  function elById(page, id) { if (!page) return null; var els = page.elements || []; for (var i = 0; i < els.length; i++) if (els[i].id === id) return els[i]; return null; }
  function domOf(id) {
    var nodes = document.querySelectorAll("[data-el-id]");
    for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute("data-el-id") === id) return nodes[i];
    return null;
  }
  function sourceValue(el) {
    var node = domOf(el.id);
    if (!node) return "";
    if (el.type === "input") return node.value || "";
    var p = el.props || {};
    return p.label || p.text || "";
  }
  function templateKey(el) {
    var p = el.props || {};
    var raw = (typeof p.text === "string" && p.text) || (typeof p.label === "string" && p.label) || "";
    var m = /^\\{\\{\\s*([A-Za-z0-9_.-]+)\\s*\\}\\}$/.exec(raw);
    return m ? m[1] : null;
  }
  function renderState() {
    var page = pageById(currentPageId);
    if (!page) return;
    (page.elements || []).forEach(function (el) {
      var key = templateKey(el);
      if (!key) return;
      var node = domOf(el.id);
      if (node) node.textContent = state[key] == null ? "" : String(state[key]);
    });
  }
  function renderBindings() {
    var page = pageById(currentPageId);
    if (!page) return;
    (page.elements || []).forEach(function (el) {
      if (!el.binding || el.binding.kind !== "table") return;
      var caps = document.querySelectorAll("[data-caption-for]");
      for (var i = 0; i < caps.length; i++) {
        if (caps[i].getAttribute("data-caption-for") !== el.id) continue;
        var tbl = null;
        (boot.tables || []).forEach(function (t) { if (t.id === el.binding.refId) tbl = t; });
        if (!tbl) return;
        var rows = tableRows[tbl.name];
        if (rows) caps[i].textContent = caps[i].textContent.replace(/ · \\d+ rows$/, "") + " · " + rows.length + " rows";
      }
    });
  }

  function bridge(req, wf, stepIdx) {
    var requestId = "am" + (++bridgeSeq);
    pending[requestId] = setTimeout(function () {
      delete pending[requestId];
      complain("Workflow '" + wf.name + "': " + req.action + " could not reach the app data store — table actions are unavailable in this preview.");
    }, 1500);
    try {
      parent.postMessage({ kind: "am-bridge", v: 1, requestId: requestId, projectId: boot.projectId, action: req.action, table: req.table, config: req.config || {} }, "*");
    } catch (e) { /* the timeout above reports it */ }
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("message", function (ev) {
      var d = ev && ev.data;
      if (!d || d.kind !== "am-bridge-reply" || d.v !== 1) return;
      var t = pending[d.requestId];
      if (t) { clearTimeout(t); delete pending[d.requestId]; }
      if (d.ok === false) { complain("Table action refused: " + (d.error || "unknown error")); return; }
      if (d.table && d.rows) { tableRows[d.table] = d.rows; renderBindings(); }
    });
  }

  function runStep(wf, step, idx, sourceEl) {
    var target = step.target || "";
    var cfg = step.config || {};
    switch (step.action) {
      case "show_toast":
        toast(cfg.message || target || wf.name);
        break;
      case "set_state": {
        if (!target) { complain("Workflow '" + wf.name + "': step " + (idx + 1) + " (set_state) names no state key."); break; }
        var value = ("value" in cfg) ? cfg.value : (sourceEl ? sourceValue(sourceEl) : "");
        var next = {}; for (var k in state) next[k] = state[k]; next[target] = value;
        if (JSON.stringify(next).length > 65536) { complain("Workflow '" + wf.name + "': app state is full (64 KB) — set_state refused."); break; }
        state = next;
        renderState();
        break;
      }
      case "navigate": {
        var page = null;
        (boot.pages || []).forEach(function (p) { if (p.id === target || p.name === target) page = p; });
        if (!page) { complain("Workflow '" + wf.name + "': step " + (idx + 1) + " — no page named '" + target + "'."); break; }
        showPage(page.id);
        break;
      }
      case "create_row": case "update_row": case "delete_row":
        bridge({ action: step.action, table: target, config: cfg }, wf, idx);
        break;
      case "call_api": case "send_email":
        complain("Workflow '" + wf.name + "': " + step.action + " is not run in preview.");
        break;
      default:
        complain("Workflow '" + wf.name + "': step " + (idx + 1) + " — unknown action '" + step.action + "'.");
    }
  }
  function runWorkflow(wf, sourceEl) {
    (wf.steps || []).forEach(function (step, idx) {
      if (stepBudget <= 0) { complain("Workflow '" + wf.name + "': step budget reached — remaining steps skipped."); return; }
      stepBudget--;
      try { runStep(wf, step, idx, sourceEl); }
      catch (e) { complain("Workflow '" + wf.name + "': step " + (idx + 1) + " failed — " + ((e && e.message) || e)); }
    });
  }
  function fire(trigger, sourceEl) {
    var now = Date.now();
    eventTimes = eventTimes.filter(function (t) { return now - t < 1000; });
    if (eventTimes.length >= 20) { complain("Too many events — some were dropped."); return; }
    eventTimes.push(now);
    if (cascadeDepth === 0) stepBudget = 300;
    cascadeDepth++;
    try {
      (boot.workflows || []).forEach(function (wf) {
        if (wf.enabled === false || wf.trigger !== trigger) return;
        if (cascadeDepth > 3) { complain("Workflow '" + wf.name + "': event cascade too deep — stopped."); return; }
        runWorkflow(wf, sourceEl);
      });
    } finally { cascadeDepth--; }
  }
  function showPage(pageId) {
    currentPageId = pageId;
    var containers = document.querySelectorAll("[data-am-page]");
    for (var i = 0; i < containers.length; i++) {
      containers[i].style.display = containers[i].getAttribute("data-am-page") === pageId ? "" : "none";
    }
    renderState();
    fire("page_load", null);
  }

  function enclosingEl(node) {
    var n = node;
    while (n && n.getAttribute) {
      var id = n.getAttribute("data-el-id");
      if (id) { var page = pageById(currentPageId); return elById(page, id); }
      n = n.parentNode;
    }
    return null;
  }
  document.addEventListener("click", function (ev) {
    var el = enclosingEl(ev.target);
    if (el && el.type === "button") fire("button_click", el);
  });
  document.addEventListener("input", function (ev) {
    var el = enclosingEl(ev.target);
    if (el && el.type === "input") fire("input_change", el);
  });
  document.addEventListener("submit", function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    var el = enclosingEl(ev.target);
    fire("form_submit", el);
  });

  (boot.workflows || []).forEach(function (wf) {
    if (wf.trigger === "schedule" && wf.enabled !== false) {
      complain("Workflow '" + wf.name + "': schedule triggers don't run in preview.");
    }
  });
  window.__amRuntime = { version: VERSION, fire: fire, state: function () { return state; } };
  fire("page_load", null);
})();
`;
