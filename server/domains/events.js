export default function registerEventsActions(registerLensAction) {
  registerLensAction("events", "budgetReconcile", (ctx, artifact, _params) => {
    const projectedBudget = artifact.data?.budget || 0;
    const expenses = artifact.data?.expenses || [];
    const revenue = artifact.data?.revenue || [];
    const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalRevenue = revenue.reduce((s, r) => s + (r.amount || 0), 0);
    const variance = projectedBudget - totalExpenses;
    const byCategory = {};
    expenses.forEach(e => { byCategory[e.category || 'Other'] = (byCategory[e.category || 'Other'] || 0) + (e.amount || 0); });
    return { ok: true, result: { event: artifact.title, projectedBudget, totalExpenses, totalRevenue, netProfit: totalRevenue - totalExpenses, variance, overBudget: variance < 0, byCategory } };
  });

  registerLensAction("events", "advanceSheet", (ctx, artifact, _params) => {
    const venue = artifact.data?.venue || {};
    const sheet = {
      event: artifact.title,
      date: artifact.data?.date || 'TBD',
      venue: { name: venue.name || 'TBD', address: venue.address || '', capacity: venue.capacity || 0, contact: venue.contact || '' },
      schedule: {
        loadIn: artifact.data?.loadIn || 'TBD',
        soundcheck: artifact.data?.soundcheck || 'TBD',
        doors: artifact.data?.doors || 'TBD',
        showTime: artifact.data?.showTime || 'TBD',
        curfew: artifact.data?.curfew || 'TBD',
      },
      production: { stage: venue.stageSize || 'TBD', sound: venue.soundSystem || 'House', lighting: venue.lighting || 'House', backline: venue.backline || 'None' },
      hospitality: artifact.data?.hospitality || { catering: 'TBD', greenRoom: 'TBD', parking: 'TBD' },
      generatedAt: new Date().toISOString(),
    };
    return { ok: true, result: { advanceSheet: sheet } };
  });

  registerLensAction("events", "techRiderMatch", (ctx, artifact, params) => {
    const riderRequirements = artifact.data?.riderRequirements || params.requirements || [];
    const venueEquipment = artifact.data?.venueEquipment || params.venueEquipment || [];
    const venueSet = new Set(venueEquipment.map(e => (e.name || e).toLowerCase()));
    const matches = riderRequirements.map(req => {
      const reqName = (req.name || req).toLowerCase();
      const available = venueSet.has(reqName) || [...venueSet].some(v => v.includes(reqName));
      return { requirement: req.name || req, quantity: req.quantity || 1, available, notes: available ? 'Provided by venue' : 'Must be rented' };
    });
    const fulfilled = matches.filter(m => m.available).length;
    return { ok: true, result: { performer: artifact.title, matches, fulfilled, total: matches.length, fulfillmentRate: matches.length > 0 ? Math.round((fulfilled / matches.length) * 100) : 0 } };
  });

  registerLensAction("events", "settlementCalc", (ctx, artifact, params) => {
    const guarantee = artifact.data?.guarantee || params.guarantee || 0;
    const doorSplit = artifact.data?.doorSplit || params.doorSplit || 80;
    const ticketsSold = artifact.data?.ticketsSold || params.ticketsSold || 0;
    const ticketPrice = artifact.data?.ticketPrice || params.ticketPrice || 0;
    const grossDoor = ticketsSold * ticketPrice;
    const artistDoorShare = grossDoor * (doorSplit / 100);
    const settlement = Math.max(guarantee, artistDoorShare);
    const method = artistDoorShare > guarantee ? 'door_split' : 'guarantee';
    return { ok: true, result: { performer: artifact.title, guarantee, doorSplit: `${doorSplit}%`, grossDoor, artistDoorShare, settlement, method, ticketsSold } };
  });

  // ─── Event-planning substrate (per-user, STATE-backed) ───────────────

  function getEventsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.eventsLens) STATE.eventsLens = {};
    if (!(STATE.eventsLens.events instanceof Map)) STATE.eventsLens.events = new Map(); // userId -> Array
    return STATE.eventsLens;
  }
  function saveEvents() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const evId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const evNow = () => new Date().toISOString();
  const evActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const evClean = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
  const evNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const evList = (s, userId) => { if (!s.events.has(userId)) s.events.set(userId, []); return s.events.get(userId); };
  const EVENT_TYPES = ["conference", "wedding", "concert", "festival", "corporate", "social"];

  registerLensAction("events", "event-create", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = evClean(params.name, 200);
    if (!name) return { ok: false, error: "event name required" };
    const event = {
      id: evId("evt"),
      name,
      type: EVENT_TYPES.includes(params.type) ? params.type : "social",
      date: evClean(params.date, 30) || null,
      venue: evClean(params.venue, 200) || null,
      budget: Math.max(0, evNum(params.budget)),
      guestCount: Math.max(0, Math.round(evNum(params.guestCount))),
      status: "planning",
      tasks: [],
      vendors: [],
      createdAt: evNow(),
    };
    evList(s, evActor(ctx)).push(event);
    saveEvents();
    return { ok: true, result: { event } };
  });

  registerLensAction("events", "event-list", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let events = [...evList(s, evActor(ctx))];
    if (params.type) events = events.filter((e) => e.type === params.type);
    if (params.status) events = events.filter((e) => e.status === params.status);
    events.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    const out = events.map((e) => ({
      id: e.id, name: e.name, type: e.type, date: e.date, venue: e.venue,
      budget: e.budget, guestCount: e.guestCount, status: e.status,
      taskCount: e.tasks.length, doneTaskCount: e.tasks.filter((t) => t.done).length,
      vendorCost: e.vendors.reduce((n, v) => n + v.cost, 0),
    }));
    return { ok: true, result: { events: out, count: out.length } };
  });

  registerLensAction("events", "event-detail", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = evList(s, evActor(ctx)).find((e) => e.id === params.id);
    if (!event) return { ok: false, error: "event not found" };
    const vendorCost = event.vendors.reduce((n, v) => n + v.cost, 0);
    return { ok: true, result: { event, vendorCost, budgetRemaining: event.budget - vendorCost } };
  });

  registerLensAction("events", "event-update", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = evList(s, evActor(ctx)).find((e) => e.id === params.id);
    if (!event) return { ok: false, error: "event not found" };
    if (params.name != null) event.name = evClean(params.name, 200) || event.name;
    if (params.date != null) event.date = evClean(params.date, 30) || null;
    if (params.venue != null) event.venue = evClean(params.venue, 200) || null;
    if (params.budget != null) event.budget = Math.max(0, evNum(params.budget));
    if (params.guestCount != null) event.guestCount = Math.max(0, Math.round(evNum(params.guestCount)));
    if (params.status != null && ["planning", "confirmed", "complete", "cancelled"].includes(params.status)) event.status = params.status;
    saveEvents();
    return { ok: true, result: { event } };
  });

  registerLensAction("events", "event-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = evList(s, evActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "event not found" };
    arr.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.id } };
  });

  function findEvent(s, ctx, eventId) {
    return evList(s, evActor(ctx)).find((e) => e.id === eventId);
  }

  registerLensAction("events", "task-add", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const title = evClean(params.title, 200);
    if (!title) return { ok: false, error: "task title required" };
    const task = { id: evId("tk"), title, dueDate: evClean(params.dueDate, 30) || null, done: false, createdAt: evNow() };
    event.tasks.push(task);
    saveEvents();
    return { ok: true, result: { task } };
  });

  registerLensAction("events", "task-toggle", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const task = event.tasks.find((t) => t.id === params.taskId);
    if (!task) return { ok: false, error: "task not found" };
    task.done = !task.done;
    saveEvents();
    return { ok: true, result: { taskId: task.id, done: task.done } };
  });

  registerLensAction("events", "task-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const i = event.tasks.findIndex((t) => t.id === params.taskId);
    if (i < 0) return { ok: false, error: "task not found" };
    event.tasks.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.taskId } };
  });

  registerLensAction("events", "vendor-add", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const name = evClean(params.name, 160);
    if (!name) return { ok: false, error: "vendor name required" };
    const vendor = {
      id: evId("vn"), name,
      role: evClean(params.role, 80) || "vendor",
      cost: Math.max(0, evNum(params.cost)),
      booked: params.booked === true,
    };
    event.vendors.push(vendor);
    saveEvents();
    return { ok: true, result: { vendor } };
  });

  registerLensAction("events", "vendor-remove", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    const i = event.vendors.findIndex((v) => v.id === params.vendorId);
    if (i < 0) return { ok: false, error: "vendor not found" };
    event.vendors.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.vendorId } };
  });

  registerLensAction("events", "events-dashboard", (ctx, _a, _params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const events = evList(s, evActor(ctx));
    const now = new Date().toISOString().slice(0, 10);
    return {
      ok: true,
      result: {
        totalEvents: events.length,
        upcoming: events.filter((e) => e.date && e.date >= now && e.status !== "cancelled").length,
        planning: events.filter((e) => e.status === "planning").length,
        totalBudget: events.reduce((n, e) => n + e.budget, 0),
        openTasks: events.reduce((n, e) => n + e.tasks.filter((t) => !t.done).length, 0),
      },
    };
  });
};
