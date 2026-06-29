// scripts/crud-update-invariants.mjs
//
// STATEFUL UPDATE-REFLECTS sweep — the second half of the CRUD invariant set.
// For each entity with a field-mutating update action: create → read the field
// (baseline) → update the field to a NEW value → re-list → assert the field now
// equals the new value AND differs from the baseline. Catches:
//   • no-op updates (handler accepts the call but doesn't persist the change)
//   • wrong-field writes (update lands on a different column)
//   • read-after-write staleness (list returns the pre-update value)
// In-process, real handlers, one user context.

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "value-assert-fixed-secret-key-32plus-characters-2026";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", rst: "\x1b[0m" };
const mod = await import(new URL("../server/server.js", import.meta.url).href);
const { makeInternalCtx } = mod.__TEST__ || mod.default?.__TEST__;
const LA = globalThis.__concordLensActions;
const ctx = makeInternalCtx("upd_user_" + Math.random().toString(36).slice(2));

const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const unwrap = (r) => (r && typeof r === "object" && "result" in r ? r.result : r);
async function call(dom, act, params = {}) {
  const h = LA.get(`${dom}.${act}`);
  if (typeof h !== "function") return { ok: false, error: `no handler ${dom}.${act}` };
  try { return await h(ctx, { domain: dom, data: params }, params); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
function findField(listResult, arrPath, idField, id, field) {
  const arr = getPath(listResult, arrPath);
  if (!Array.isArray(arr)) return { found: false };
  const row = arr.find((e) => String(e?.[idField]) === String(id));
  return row ? { found: true, val: row[field] } : { found: false };
}

// [dom, label, createAct, createParams, idPath, updateAct, idParam, field, newValue, listAct, listArr, idField, listParams?]
const E = [
  ["construction", "budget", "budget-add", { costCode: "01", description: "D", budgetAmount: 1000, committed: 100 }, "line.id", "budget-update", "id", "committed", 500, "budget-list", "lines", "id"],
  ["construction", "punch", "punch-add", { description: "Fix", priority: "low" }, "item.id", "punch-update", "id", "status", "closed", "punch-list", "items", "id"],
  ["electrical", "priceItem", "priceListUpsert", { name: "Wire", unit: "ft", price: 1.5, category: "wire" }, "materials.0.id", "priceListUpsert", "id", "price", 2.75, "priceListGet", "materials", "id"],
  ["plumbing", "priceItem", "priceItemAdd", { name: "Valve", cost: 10, markupPct: 0 }, "item.id", "priceItemUpdate", "itemId", "cost", 25, "priceBookList", "items", "id"],
  ["marketing", "campaign", "campaign-create", { name: "Camp", budget: 100 }, "campaign.id", "campaign-update", "id", "name", "Renamed", "campaign-list", "campaigns", "id"],
  ["marketing", "lead", "lead-add", { name: "Lee", stage: "new" }, "lead.id", "lead-update-stage", "id", "stage", "qualified", "lead-list", "leads", "id"],
  ["marketing", "email", "email-create", { name: "E", subject: "Old" }, "email.id", "email-update", "id", "subject", "NewSubj", "email-list", "emails", "id"],
  ["marketing", "workflow", "workflow-create", { name: "W" }, "workflow.id", "workflow-update", "id", "name", "W2", "workflow-list", "workflows", "id"],
  ["marketing", "page", "page-create", { name: "P", headline: "Old" }, "page.id", "page-update", "id", "headline", "NewHead", "page-list", "pages", "id"],
  ["hr", "employee", "employee-add", { name: "Emp", title: "Jr" }, "employee.id", "employee-update", "id", "title", "Senior", "employee-list", "employees", "id"],
  ["legal", "matter", "matters-create", { name: "M", clientName: "C" }, "matter.id", "matters-update", "id", "name", "M2", "matters-list", "matters", "id"],
  ["legal", "contact", "contacts-create", { name: "Cory", email: "old@x.com" }, "contact.id", "contacts-update", "id", "email", "new@x.com", "contacts-list", "contacts", "id"],
  ["productivity", "task", "task-add", { content: "Old" }, "task.id", "task-update", "id", "content", "New", "task-list", "tasks", "id"],
  ["calendar", "calendar", "calendars-create", { name: "Cal" }, "calendar.id", "calendars-update", "id", "name", "Cal2", "calendars-list", "calendars", "id"],
  ["calendar", "event", "events-create", { title: "Old", start: "2026-06-10T10:00" }, "event.id", "events-update", "id", "title", "New", "events-list", "events", "id", { rangeStart: "2020-01-01", rangeEnd: "2030-12-31" }],
  ["household", "calendar-event", "calendar-event-create", { title: "Old", date: "2026-06-10" }, "event.id", "calendar-event-update", "id", "title", "New", "calendar-event-list", "events", "id"],
];

let pass = 0, fail = 0, err = 0; const issues = [];
console.log(`\nStateful UPDATE-reflects invariant (create → mutate field → re-read)\n`);
let cur = "";
for (const [dom, label, cAct, cParams, idPath, uAct, idParam, field, newVal, lAct, lArr, idField, lParams] of E) {
  if (dom !== cur) { cur = dom; console.log(`${C.dim}── ${dom} ──${C.rst}`); }
  const created = await call(dom, cAct, cParams);
  if (created?.ok === false) { err++; issues.push([`${dom}.${label}`, `create: ${created.error}`]); console.log(`  ${C.y}ERR ${C.rst}${label} ${C.dim}create: ${created.error}${C.rst}`); continue; }
  const id = getPath(unwrap(created), idPath);
  if (id == null) { err++; issues.push([`${dom}.${label}`, `no id @ ${idPath}`]); console.log(`  ${C.y}ERR ${C.rst}${label} ${C.dim}no id @ ${idPath}${C.rst}`); continue; }
  const base = findField(unwrap(await call(dom, lAct, lParams || {})), lArr, idField, id, field);
  const upd = await call(dom, uAct, { [idParam]: id, [field]: newVal });
  if (upd?.ok === false) { err++; issues.push([`${dom}.${label}`, `update: ${upd.error}`]); console.log(`  ${C.y}ERR ${C.rst}${label} ${C.dim}update: ${upd.error}${C.rst}`); continue; }
  const after = findField(unwrap(await call(dom, lAct, lParams || {})), lArr, idField, id, field);
  const reflected = after.found && String(after.val) === String(newVal);
  const changed = String(base.val) !== String(after.val);
  if (reflected && changed) { pass++; console.log(`  ${C.g}UPD✓${C.rst} ${label} ${C.dim}${field}: ${base.val} → ${after.val}${C.rst}`); }
  else { fail++; issues.push([`${dom}.${label}`, `field '${field}' ${base.val}→${after.val} (expected ${newVal}); reflected=${reflected} changed=${changed}`]); console.log(`  ${C.r}UPD✗${C.rst} ${label} ${C.dim}${field}: ${base.val} → ${after.val} (want ${newVal})${C.rst}`); }
}
console.log(`\nupdate-reflects ${C.g}${pass}✓${C.rst}/${fail ? C.r : C.dim}${fail}✗${C.rst}   errors ${err ? C.y : C.dim}${err}${C.rst}`);
if (issues.length) { console.log(`\n${C.r}Triage:${C.rst}`); for (const [k, v] of issues) console.log(`  • ${k}  ${C.dim}${v}${C.rst}`); }
setImmediate(() => process.exit((fail > 0 || err > 0) ? 1 : 0)); // defer past V8 async-module fulfillment (exit-133 race)
