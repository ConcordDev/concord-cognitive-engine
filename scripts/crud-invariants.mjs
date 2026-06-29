// scripts/crud-invariants.mjs
//
// STATEFUL-INVARIANT SWEEP — the layer value-assertion can't reach.
// For every per-user STATE-backed CRUD entity, assert three properties through the
// REAL registered handlers (in-process), using two distinct user contexts:
//   RT  (round-trip) : create as A → A's list contains it
//   ISO (isolation)  : create as A → B's list does NOT contain it   ← data-leak / privacy bug class
//   DEL (delete)     : create as A → delete as A → A's list no longer contains it
//
// A failing ISO is a security-class bug (one user seeing another's data). A failing RT
// means create silently didn't persist. A failing DEL means delete is a no-op.

process.env.NODE_ENV = "test";
process.env.CONCORD_NO_LISTEN = "true";
process.env.JWT_SECRET = process.env.JWT_SECRET || "value-assert-fixed-secret-key-32plus-characters-2026";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", dim: "\x1b[2m", rst: "\x1b[0m" };
const mod = await import(new URL("../server/server.js", import.meta.url).href);
const T = mod.__TEST__ || mod.default?.__TEST__;
const { makeInternalCtx } = T;
const LA = globalThis.__concordLensActions;

const ctxA = makeInternalCtx("user_A_" + Math.random().toString(36).slice(2));
const ctxB = makeInternalCtx("user_B_" + Math.random().toString(36).slice(2));

function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj); }
async function call(ctx, dom, act, params = {}) {
  const h = LA.get(`${dom}.${act}`);
  if (typeof h !== "function") return { ok: false, error: `no handler ${dom}.${act}` };
  try { return await h(ctx, { domain: dom, data: params }, params); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
const unwrap = (raw) => (raw && typeof raw === "object" && "result" in raw ? raw.result : raw);
function listHas(listResult, arrPath, idField, id) {
  const arr = getPath(listResult, arrPath);
  if (!Array.isArray(arr)) return null; // can't determine
  return arr.some((e) => String(e?.[idField]) === String(id));
}

// Entity table: [domain, label, createAct, createParams, idPath(relative to result),
//                listAct, listArrayPath, idField, delAct?, delParam?, listParams?]
const E = [
  // construction (getConState)
  ["construction", "rfi", "rfi-submit", { subject: "S", question: "Q", discipline: "architectural", priority: "normal" }, "rfi.id", "rfi-list", "rfis", "id", "rfi-delete", "id"],
  ["construction", "submittal", "submittal-create", { title: "T", specSection: "01 00", type: "shop_drawing" }, "submittal.id", "submittal-list", "submittals", "id", "submittal-delete", "id"],
  ["construction", "dailylog", "dailylog-create", { date: "2026-01-01", author: "A" }, "log.id", "dailylog-list", "logs", "id", "dailylog-delete", "id"],
  ["construction", "punch", "punch-add", { description: "Fix trim" }, "item.id", "punch-list", "items", "id", "punch-delete", "id"],
  ["construction", "changeorder", "changeorder-create", { title: "T", amount: 100 }, "changeOrder.id", "changeorder-list", "changeOrders", "id", "changeorder-delete", "id"],
  ["construction", "drawing", "drawing-add", { sheetNumber: "A1", title: "Plan" }, "drawing.id", "drawing-list", "drawings", "id", "drawing-delete", "id"],
  ["construction", "budget", "budget-add", { costCode: "01", description: "D", budgetAmount: 1000 }, "line.id", "budget-list", "lines", "id", "budget-delete", "id"],
  // electrical (getState — keyed uid(ctx))
  ["electrical", "panel", "panelCreate", { name: "P1" }, "id", "panelList", "panels", "id", "panelDelete", "panelId"],
  ["electrical", "estimate", "estimateCreate", { client: "C", title: "T" }, "id", "estimateList", "estimates", "id", "estimateDelete", "estimateId"],
  ["electrical", "checklist", "checklistCreate", { template: "rough_in", jobName: "J" }, "id", "checklistList", "checklists", "id", "checklistDelete", "checklistId"],
  ["electrical", "diagram", "diagramCreate", { name: "D1" }, "id", "diagramList", "diagrams", "id", "diagramDelete", "diagramId"],
  // plumbing (getPlumbState)
  ["plumbing", "tech", "techAdd", { name: "Tina" }, "tech.id", "techList", "techs", "id", "techRemove", "techId"],
  ["plumbing", "priceItem", "priceItemAdd", { name: "Pipe", cost: 10 }, "item.id", "priceBookList", "items", "id", "priceItemRemove", "itemId"],
  ["plumbing", "plan", "planCreate", { client: "C", cadence: "monthly", fee: 50 }, "plan.id", "planList", "plans", "id", null, null],
  // hvac (getHvacState)
  ["hvac", "tech", "tech-add", { name: "Hank" }, "technician.id", "tech-list", "technicians", "id", "tech-delete", "id"],
  ["hvac", "asset", "asset-add", { address: "1 Main", equipmentType: "AC" }, "asset.id", "asset-list", "assets", "id", "asset-delete", "id"],
  ["hvac", "agreement", "agreement-create", { client: "C", tier: "basic" }, "agreement.id", "agreement-list", "agreements", "id", null, null],
  // marketing (getMktState)
  ["marketing", "campaign", "campaign-create", { name: "Camp" }, "campaign.id", "campaign-list", "campaigns", "id", "campaign-delete", "id"],
  ["marketing", "lead", "lead-add", { name: "Lee" }, "lead.id", "lead-list", "leads", "id", "lead-delete", "id"],
  ["marketing", "email", "email-create", { name: "E" }, "email.id", "email-list", "emails", "id", "email-delete", "id"],
  ["marketing", "workflow", "workflow-create", { name: "W" }, "workflow.id", "workflow-list", "workflows", "id", "workflow-delete", "id"],
  ["marketing", "page", "page-create", { name: "P" }, "page.id", "page-list", "pages", "id", "page-delete", "id"],
  // retail (getRetailState) — idField sku
  ["retail", "product", "product-upsert", { sku: "SKU1", name: "Widget", price: 10, stock: 5 }, "product.sku", "product-list", "products", "sku", "product-delete", "sku"],
  // hr (getHrState)
  ["hr", "employee", "employee-add", { name: "Emp" }, "employee.id", "employee-list", "employees", "id", null, null],
  // legal (getLegalState)
  ["legal", "matter", "matters-create", { name: "M", clientName: "C" }, "matter.id", "matters-list", "matters", "id", null, null],
  ["legal", "contact", "contacts-create", { name: "Cory" }, "contact.id", "contacts-list", "contacts", "id", "contacts-delete", "id"],
  // productivity (getProdState)
  ["productivity", "task", "task-add", { content: "Do it" }, "task.id", "task-list", "tasks", "id", "task-delete", "id"],
  ["productivity", "project", "project-create", { name: "Proj" }, "project.id", "project-list", "projects", "id", "project-delete", "id"],
  ["productivity", "habit", "habit-create", { name: "Hab" }, "habit.id", "habit-list", "habits", "id", "habit-delete", "id"],
  ["productivity", "reminder", "reminder-add", { remindAt: "2026-01-01T10:00", note: "N" }, "reminder.id", "reminder-list", "reminders", "id", "reminder-delete", "id"],
  ["productivity", "filter", "filter-save", { name: "F", query: "p1" }, "filter.id", "filter-list", "filters", "id", "filter-delete", "id"],
  // calendar (getCalState)
  ["calendar", "calendar", "calendars-create", { name: "Cal" }, "calendar.id", "calendars-list", "calendars", "id", "calendars-delete", "id"],
  ["calendar", "event", "events-create", { title: "Ev", start: "2026-01-01T10:00" }, "event.id", "events-list", "events", "id", "events-delete", "id", { rangeStart: "2020-01-01", rangeEnd: "2030-12-31" }],
  ["calendar", "task", "tasks-create", { title: "Ct" }, "task.id", "tasks-list", "tasks", "id", "tasks-delete", "id"],
  // household (getHomeState / getCoState)
  ["household", "room", "room-create", { name: "Kitchen" }, "room.id", "room-list", "rooms", "id", "room-delete", "id"],
  ["household", "expense", "expense-add", { description: "Food", amount: 100, paidBy: "A", splitAmong: ["A", "B"] }, "expense.id", "expense-list", "expenses", "id", "expense-delete", "id"],
  ["household", "shoppinglist", "shopping-list-create", { name: "Groceries" }, "list.id", "shopping-list-list", "lists", "id", "shopping-list-delete", "id"],
  ["household", "meal", "meal-plan-set", { date: "2026-01-01", slot: "dinner", recipe: "Pasta" }, "meal.id", "meal-plan-list", "meals", "id", "meal-plan-delete", "id"],
  ["household", "tasktemplate", "task-template-create", { name: "Tpl" }, "template.id", "task-template-list", "templates", "id", "task-template-delete", "id"],
  // mentalhealth (per-user STATE)
  ["mental-health", "course", "course-create", { name: "Mind" }, "course.id", "course-list", "courses", "id", "course-delete", "id"],
  ["mental-health", "factor", "factor-create", { name: "Sleep" }, "factor.id", "factor-list", "factors", "id", "factor-delete", "id"],
  ["mental-health", "worksheet", "worksheet-save", { templateId: "thought_record", responses: { situation: "x" } }, "worksheet.id", "worksheet-list", "worksheets", "id", "worksheet-delete", "id"],
];

let rtP = 0, rtF = 0, isoP = 0, isoF = 0, delP = 0, delF = 0, errs = 0;
const issues = [];
console.log(`\nStateful CRUD invariants — round-trip · isolation · delete (in-process)\n`);
let curDom = "";
for (const [dom, label, cAct, cParams, idPath, lAct, lArr, idField, dAct, dParam, lParams] of E) {
  if (dom !== curDom) { curDom = dom; console.log(`${C.dim}── ${dom} ──${C.rst}`); }
  // create as A
  const created = await call(ctxA, dom, cAct, cParams);
  if (created?.ok === false) { errs++; issues.push([`${dom}.${label}`, `create err: ${created.error}`]); console.log(`  ${C.y}ERR ${C.rst}${label}  ${C.dim}create: ${created.error}${C.rst}`); continue; }
  const id = getPath(unwrap(created), idPath);
  if (id == null) { errs++; issues.push([`${dom}.${label}`, `no id at result.${idPath}`]); console.log(`  ${C.y}ERR ${C.rst}${label}  ${C.dim}no id at ${idPath}${C.rst}`); continue; }
  // round-trip: A lists it
  const listA = unwrap(await call(ctxA, dom, lAct, lParams || {}));
  const inA = listHas(listA, lArr, idField, id);
  // isolation: B does NOT list it
  const listB = unwrap(await call(ctxB, dom, lAct, lParams || {}));
  const inB = listHas(listB, lArr, idField, id);
  const rt = inA === true;
  const iso = inB === false; // must be explicitly absent
  rt ? rtP++ : rtF++; iso ? isoP++ : isoF++;
  // delete lifecycle
  let delStr = "—";
  if (dAct) {
    await call(ctxA, dom, dAct, { [dParam]: id });
    const listA2 = unwrap(await call(ctxA, dom, lAct, lParams || {}));
    const stillThere = listHas(listA2, lArr, idField, id);
    const del = stillThere === false;
    del ? delP++ : delF++;
    delStr = del ? `${C.g}DEL✓${C.rst}` : `${C.r}DEL✗${C.rst}`;
    if (!del) issues.push([`${dom}.${label}`, "delete did not remove the entity"]);
  }
  if (!rt) issues.push([`${dom}.${label}`, `ROUND-TRIP: created id not in owner's list (inA=${inA})`]);
  if (!iso) issues.push([`${dom}.${label}`, `ISOLATION: id visible to other user OR list shape unknown (inB=${inB})`]);
  const rtStr = rt ? `${C.g}RT✓${C.rst}` : `${C.r}RT✗${C.rst}`;
  const isoStr = iso ? `${C.g}ISO✓${C.rst}` : (inB === null ? `${C.y}ISO?${C.rst}` : `${C.r}ISO✗${C.rst}`);
  console.log(`  ${rtStr} ${isoStr} ${delStr}  ${label}`);
}
console.log(`\nround-trip ${C.g}${rtP}✓${C.rst}/${rtF ? C.r : C.dim}${rtF}✗${C.rst}   isolation ${C.g}${isoP}✓${C.rst}/${isoF ? C.r : C.dim}${isoF}✗${C.rst}   delete ${C.g}${delP}✓${C.rst}/${delF ? C.r : C.dim}${delF}✗${C.rst}   errors ${errs ? C.y : C.dim}${errs}${C.rst}`);
if (issues.length) { console.log(`\n${C.r}Triage:${C.rst}`); for (const [k, v] of issues) console.log(`  • ${k}  ${C.dim}${v}${C.rst}`); }
setImmediate(() => process.exit((rtF + isoF + delF + errs) > 0 ? 1 : 0)); // defer past V8 async-module fulfillment (exit-133 race)
