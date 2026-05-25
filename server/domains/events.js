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
      tiers: [],
      registrations: [],
      budgetLines: [],
      agenda: [],
      seatTables: [],
      blasts: [],
      publicPage: null,
      createdAt: evNow(),
    };
    evList(s, evActor(ctx)).push(event);
    saveEvents();
    return { ok: true, result: { event } };
  });

  registerLensAction("events", "event-list", (ctx, _a, params = {}) => {
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("events", "event-detail", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = evList(s, evActor(ctx)).find((e) => e.id === params.id);
    if (!event) return { ok: false, error: "event not found" };
    const vendorCost = event.vendors.reduce((n, v) => n + v.cost, 0);
    return { ok: true, result: { event, vendorCost, budgetRemaining: event.budget - vendorCost } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Substrate field bootstrap — every event carries the new collections ──
  function ensureEventCollections(event) {
    if (!Array.isArray(event.tasks)) event.tasks = [];
    if (!Array.isArray(event.vendors)) event.vendors = [];
    if (!Array.isArray(event.tiers)) event.tiers = [];
    if (!Array.isArray(event.registrations)) event.registrations = [];
    if (!Array.isArray(event.budgetLines)) event.budgetLines = [];
    if (!Array.isArray(event.agenda)) event.agenda = [];
    if (!Array.isArray(event.seatTables)) event.seatTables = [];
    if (!Array.isArray(event.blasts)) event.blasts = [];
    return event;
  }

  // ═══ Feature 1 — Ticketing: tiers, registration, attendee list, capacity ══

  registerLensAction("events", "tier-create", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const name = evClean(params.name, 120);
    if (!name) return { ok: false, error: "tier name required" };
    const tier = {
      id: evId("tier"),
      name,
      price: Math.max(0, evNum(params.price)),
      quantity: Math.max(0, Math.round(evNum(params.quantity))),
      sold: 0,
      description: evClean(params.description, 400),
      perks: evClean(params.perks, 400),
      saleStart: evClean(params.saleStart, 30) || null,
      saleEnd: evClean(params.saleEnd, 30) || null,
      createdAt: evNow(),
    };
    event.tiers.push(tier);
    saveEvents();
    return { ok: true, result: { tier } };
  });

  registerLensAction("events", "tier-list", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const tiers = event.tiers.map((t) => ({
      ...t,
      remaining: Math.max(0, t.quantity - t.sold),
      soldOut: t.quantity > 0 && t.sold >= t.quantity,
      revenue: t.sold * t.price,
    }));
    return {
      ok: true,
      result: {
        tiers,
        count: tiers.length,
        totalRevenue: tiers.reduce((n, t) => n + t.revenue, 0),
        totalSold: tiers.reduce((n, t) => n + t.sold, 0),
        totalCapacity: tiers.reduce((n, t) => n + t.quantity, 0),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("events", "tier-update", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const tier = event.tiers.find((t) => t.id === params.tierId);
    if (!tier) return { ok: false, error: "tier not found" };
    if (params.name != null) tier.name = evClean(params.name, 120) || tier.name;
    if (params.price != null) tier.price = Math.max(0, evNum(params.price));
    if (params.quantity != null) tier.quantity = Math.max(tier.sold, Math.round(evNum(params.quantity)));
    if (params.description != null) tier.description = evClean(params.description, 400);
    if (params.perks != null) tier.perks = evClean(params.perks, 400);
    if (params.saleStart != null) tier.saleStart = evClean(params.saleStart, 30) || null;
    if (params.saleEnd != null) tier.saleEnd = evClean(params.saleEnd, 30) || null;
    saveEvents();
    return { ok: true, result: { tier } };
  });

  registerLensAction("events", "tier-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.tiers.findIndex((t) => t.id === params.tierId);
    if (i < 0) return { ok: false, error: "tier not found" };
    event.tiers.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.tierId } };
  });

  registerLensAction("events", "register-attendee", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const name = evClean(params.name, 160);
    const email = evClean(params.email, 200);
    if (!name) return { ok: false, error: "attendee name required" };
    if (!email) return { ok: false, error: "attendee email required" };
    const tier = event.tiers.find((t) => t.id === params.tierId);
    if (!tier) return { ok: false, error: "tier not found" };
    if (tier.quantity > 0 && tier.sold >= tier.quantity) {
      return { ok: false, error: "tier sold out" };
    }
    const qty = Math.max(1, Math.round(evNum(params.quantity) || 1));
    if (tier.quantity > 0 && tier.sold + qty > tier.quantity) {
      return { ok: false, error: "not enough tickets remaining in tier" };
    }
    const reg = {
      id: evId("reg"),
      name,
      email,
      tierId: tier.id,
      tierName: tier.name,
      quantity: qty,
      amountPaid: tier.price * qty,
      checkedIn: false,
      checkedInAt: null,
      ticketCode: `TKT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      notes: evClean(params.notes, 400),
      registeredAt: evNow(),
    };
    tier.sold += qty;
    event.registrations.push(reg);
    saveEvents();
    return { ok: true, result: { registration: reg } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("events", "registration-list", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    let regs = [...event.registrations];
    if (params.tierId) regs = regs.filter((r) => r.tierId === params.tierId);
    if (params.search) {
      const q = evClean(params.search, 100).toLowerCase();
      regs = regs.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    }
    const totalTickets = event.registrations.reduce((n, r) => n + r.quantity, 0);
    const capacity = event.tiers.reduce((n, t) => n + t.quantity, 0);
    return {
      ok: true,
      result: {
        registrations: regs,
        count: regs.length,
        totalTickets,
        capacity,
        checkedInCount: event.registrations.filter((r) => r.checkedIn).length,
        revenue: event.registrations.reduce((n, r) => n + r.amountPaid, 0),
        capacityPct: capacity > 0 ? Math.round((totalTickets / capacity) * 100) : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("events", "registration-cancel", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.registrations.findIndex((r) => r.id === params.registrationId);
    if (i < 0) return { ok: false, error: "registration not found" };
    const reg = event.registrations[i];
    const tier = event.tiers.find((t) => t.id === reg.tierId);
    if (tier) tier.sold = Math.max(0, tier.sold - reg.quantity);
    event.registrations.splice(i, 1);
    saveEvents();
    return { ok: true, result: { cancelled: reg.id, releasedTickets: reg.quantity } };
  });

  // ═══ Feature 2 — Public event page (shareable RSVP/registration landing) ══

  registerLensAction("events", "publish-page", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    if (!event.publicPage) {
      event.publicPage = { slug: null, published: false, headline: "", blurb: "", views: 0 };
    }
    event.publicPage.published = params.published !== false;
    if (params.headline != null) event.publicPage.headline = evClean(params.headline, 200);
    if (params.blurb != null) event.publicPage.blurb = evClean(params.blurb, 1200);
    if (!event.publicPage.slug) {
      const base = event.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
      event.publicPage.slug = `${base || "event"}-${Math.random().toString(36).slice(2, 7)}`;
    }
    event.publicPage.publishedAt = evNow();
    saveEvents();
    return {
      ok: true,
      result: {
        publicPage: event.publicPage,
        shareUrl: `/e/${event.publicPage.slug}`,
      },
    };
  });

  registerLensAction("events", "public-page", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    // Public lookup by slug across the actor's events (RSVP landing data).
    let found = null;
    const event = evList(s, evActor(ctx)).find((e) => {
      if (e.publicPage && e.publicPage.slug === params.slug) { found = e; return true; }
      return false;
    });
    if (!event || !found) return { ok: false, error: "public page not found" };
    ensureEventCollections(found);
    if (found.publicPage) found.publicPage.views = (found.publicPage.views || 0) + 1;
    saveEvents();
    const tiers = found.tiers.map((t) => ({
      id: t.id, name: t.name, price: t.price,
      remaining: Math.max(0, t.quantity - t.sold),
      soldOut: t.quantity > 0 && t.sold >= t.quantity,
      perks: t.perks, description: t.description,
    }));
    return {
      ok: true,
      result: {
        event: {
          id: found.id, name: found.name, type: found.type,
          date: found.date, venue: found.venue, status: found.status,
        },
        publicPage: found.publicPage,
        tiers,
        attendeeCount: found.registrations.reduce((n, r) => n + r.quantity, 0),
      },
    };
  });

  // ═══ Feature 3 — Seating / floor plan builder ════════════════════════════

  registerLensAction("events", "table-add", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const label = evClean(params.label, 60);
    if (!label) return { ok: false, error: "table label required" };
    const table = {
      id: evId("tbl"),
      label,
      capacity: Math.max(1, Math.round(evNum(params.capacity) || 8)),
      shape: ["round", "rectangle", "square"].includes(params.shape) ? params.shape : "round",
      x: Math.max(0, Math.round(evNum(params.x))),
      y: Math.max(0, Math.round(evNum(params.y))),
      seats: [],
    };
    event.seatTables.push(table);
    saveEvents();
    return { ok: true, result: { table } };
  });

  registerLensAction("events", "table-move", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const table = event.seatTables.find((t) => t.id === params.tableId);
    if (!table) return { ok: false, error: "table not found" };
    if (params.x != null) table.x = Math.max(0, Math.round(evNum(params.x)));
    if (params.y != null) table.y = Math.max(0, Math.round(evNum(params.y)));
    if (params.label != null) table.label = evClean(params.label, 60) || table.label;
    if (params.capacity != null) table.capacity = Math.max(table.seats.length, Math.round(evNum(params.capacity)));
    saveEvents();
    return { ok: true, result: { table } };
  });

  registerLensAction("events", "table-remove", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.seatTables.findIndex((t) => t.id === params.tableId);
    if (i < 0) return { ok: false, error: "table not found" };
    event.seatTables.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.tableId } };
  });

  registerLensAction("events", "seat-assign", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const table = event.seatTables.find((t) => t.id === params.tableId);
    if (!table) return { ok: false, error: "table not found" };
    const guestName = evClean(params.guestName, 160);
    if (!guestName) return { ok: false, error: "guest name required" };
    // Remove the guest from any other table first (no double-seating).
    event.seatTables.forEach((t) => {
      t.seats = t.seats.filter((g) => g.guestName !== guestName);
    });
    if (table.seats.length >= table.capacity) return { ok: false, error: "table is full" };
    const seat = { guestName, registrationId: evClean(params.registrationId, 60) || null };
    table.seats.push(seat);
    saveEvents();
    return { ok: true, result: { tableId: table.id, seat, seated: table.seats.length, capacity: table.capacity } };
  });

  registerLensAction("events", "seat-unassign", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const guestName = evClean(params.guestName, 160);
    let removed = false;
    event.seatTables.forEach((t) => {
      const before = t.seats.length;
      t.seats = t.seats.filter((g) => g.guestName !== guestName);
      if (t.seats.length < before) removed = true;
    });
    if (!removed) return { ok: false, error: "guest not seated" };
    saveEvents();
    return { ok: true, result: { unseated: guestName } };
  });

  registerLensAction("events", "floor-plan", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const totalSeats = event.seatTables.reduce((n, t) => n + t.capacity, 0);
    const assigned = event.seatTables.reduce((n, t) => n + t.seats.length, 0);
    return {
      ok: true,
      result: {
        tables: event.seatTables,
        tableCount: event.seatTables.length,
        totalSeats,
        assignedSeats: assigned,
        openSeats: totalSeats - assigned,
      },
    };
  });

  // ═══ Feature 4 — Budget builder with line items → budgetReconcile ════════

  registerLensAction("events", "budget-line-add", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const label = evClean(params.label, 160);
    if (!label) return { ok: false, error: "line item label required" };
    const line = {
      id: evId("bl"),
      label,
      category: evClean(params.category, 60) || "misc",
      kind: params.kind === "revenue" ? "revenue" : "expense",
      budgeted: Math.max(0, evNum(params.budgeted)),
      actual: Math.max(0, evNum(params.actual)),
      paid: params.paid === true,
      createdAt: evNow(),
    };
    event.budgetLines.push(line);
    saveEvents();
    return { ok: true, result: { line } };
  });

  registerLensAction("events", "budget-line-update", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const line = event.budgetLines.find((l) => l.id === params.lineId);
    if (!line) return { ok: false, error: "line item not found" };
    if (params.label != null) line.label = evClean(params.label, 160) || line.label;
    if (params.category != null) line.category = evClean(params.category, 60) || line.category;
    if (params.budgeted != null) line.budgeted = Math.max(0, evNum(params.budgeted));
    if (params.actual != null) line.actual = Math.max(0, evNum(params.actual));
    if (params.paid != null) line.paid = params.paid === true;
    if (params.kind != null) line.kind = params.kind === "revenue" ? "revenue" : "expense";
    saveEvents();
    return { ok: true, result: { line } };
  });

  registerLensAction("events", "budget-line-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.budgetLines.findIndex((l) => l.id === params.lineId);
    if (i < 0) return { ok: false, error: "line item not found" };
    event.budgetLines.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.lineId } };
  });

  registerLensAction("events", "budget-summary", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const expenses = event.budgetLines.filter((l) => l.kind === "expense");
    const revenueLines = event.budgetLines.filter((l) => l.kind === "revenue");
    const ticketRevenue = event.tiers.reduce((n, t) => n + t.sold * t.price, 0);
    const budgetedExpense = expenses.reduce((n, l) => n + l.budgeted, 0);
    const actualExpense = expenses.reduce((n, l) => n + l.actual, 0);
    const actualRevenue = revenueLines.reduce((n, l) => n + l.actual, 0) + ticketRevenue;
    const byCategory = {};
    expenses.forEach((l) => {
      if (!byCategory[l.category]) byCategory[l.category] = { budgeted: 0, actual: 0 };
      byCategory[l.category].budgeted += l.budgeted;
      byCategory[l.category].actual += l.actual;
    });
    const variance = budgetedExpense - actualExpense;
    return {
      ok: true,
      result: {
        eventBudget: event.budget,
        budgetedExpense,
        actualExpense,
        ticketRevenue,
        actualRevenue,
        netProfit: actualRevenue - actualExpense,
        variance,
        overBudget: actualExpense > budgetedExpense,
        byCategory,
        lineCount: event.budgetLines.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══ Feature 5 — Run-of-show / agenda timeline per event day ═════════════

  registerLensAction("events", "agenda-item-add", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const title = evClean(params.title, 200);
    if (!title) return { ok: false, error: "agenda item title required" };
    const item = {
      id: evId("ag"),
      title,
      day: evClean(params.day, 30) || (event.date || "Day 1"),
      startTime: evClean(params.startTime, 10) || "09:00",
      durationMin: Math.max(0, Math.round(evNum(params.durationMin) || 30)),
      track: evClean(params.track, 80) || "Main",
      owner: evClean(params.owner, 120),
      notes: evClean(params.notes, 600),
      createdAt: evNow(),
    };
    event.agenda.push(item);
    saveEvents();
    return { ok: true, result: { item } };
  });

  registerLensAction("events", "agenda-item-update", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const item = event.agenda.find((a) => a.id === params.itemId);
    if (!item) return { ok: false, error: "agenda item not found" };
    if (params.title != null) item.title = evClean(params.title, 200) || item.title;
    if (params.day != null) item.day = evClean(params.day, 30) || item.day;
    if (params.startTime != null) item.startTime = evClean(params.startTime, 10) || item.startTime;
    if (params.durationMin != null) item.durationMin = Math.max(0, Math.round(evNum(params.durationMin)));
    if (params.track != null) item.track = evClean(params.track, 80) || item.track;
    if (params.owner != null) item.owner = evClean(params.owner, 120);
    if (params.notes != null) item.notes = evClean(params.notes, 600);
    saveEvents();
    return { ok: true, result: { item } };
  });

  registerLensAction("events", "agenda-item-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.agenda.findIndex((a) => a.id === params.itemId);
    if (i < 0) return { ok: false, error: "agenda item not found" };
    event.agenda.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.itemId } };
  });

  registerLensAction("events", "agenda-timeline", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const items = [...event.agenda].sort((a, b) => {
      const d = (a.day || "").localeCompare(b.day || "");
      return d !== 0 ? d : (a.startTime || "").localeCompare(b.startTime || "");
    });
    const days = {};
    items.forEach((it) => {
      if (!days[it.day]) days[it.day] = [];
      // Compute an end time from the start + duration.
      const [h, m] = (it.startTime || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
      const endTotal = h * 60 + m + it.durationMin;
      const endTime = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
      days[it.day].push({ ...it, endTime });
    });
    return {
      ok: true,
      result: {
        items,
        days,
        dayCount: Object.keys(days).length,
        totalItems: items.length,
        totalDurationMin: items.reduce((n, it) => n + it.durationMin, 0),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══ Feature 6 — Check-in / QR scanning for attendees ════════════════════

  registerLensAction("events", "check-in", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const code = evClean(params.ticketCode, 40).toUpperCase();
    let reg = null;
    if (params.registrationId) reg = event.registrations.find((r) => r.id === params.registrationId);
    if (!reg && code) reg = event.registrations.find((r) => r.ticketCode.toUpperCase() === code);
    if (!reg) return { ok: false, error: "ticket not found — invalid code" };
    if (reg.checkedIn) {
      return { ok: false, error: `already checked in at ${reg.checkedInAt}`, result: { registration: reg } };
    }
    reg.checkedIn = true;
    reg.checkedInAt = evNow();
    saveEvents();
    return {
      ok: true,
      result: {
        registration: reg,
        checkedInCount: event.registrations.filter((r) => r.checkedIn).length,
        totalRegistered: event.registrations.length,
      },
    };
  });

  registerLensAction("events", "check-in-undo", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const reg = event.registrations.find((r) => r.id === params.registrationId);
    if (!reg) return { ok: false, error: "registration not found" };
    reg.checkedIn = false;
    reg.checkedInAt = null;
    saveEvents();
    return { ok: true, result: { registration: reg } };
  });

  registerLensAction("events", "check-in-status", (ctx, _a, params = {}) => {
  try {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const checkedIn = event.registrations.filter((r) => r.checkedIn);
    const pending = event.registrations.filter((r) => !r.checkedIn);
    return {
      ok: true,
      result: {
        checkedIn: checkedIn.map((r) => ({ id: r.id, name: r.name, tierName: r.tierName, ticketCode: r.ticketCode, checkedInAt: r.checkedInAt })),
        pending: pending.map((r) => ({ id: r.id, name: r.name, tierName: r.tierName, ticketCode: r.ticketCode })),
        checkedInCount: checkedIn.length,
        pendingCount: pending.length,
        totalRegistered: event.registrations.length,
        attendanceRate: event.registrations.length > 0
          ? Math.round((checkedIn.length / event.registrations.length) * 100) : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ═══ Feature 7 — Email / notification blasts to registrants ══════════════

  registerLensAction("events", "blast-send", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const subject = evClean(params.subject, 200);
    const body = evClean(params.body, 4000);
    if (!subject) return { ok: false, error: "blast subject required" };
    if (!body) return { ok: false, error: "blast body required" };
    const segment = ["all", "checked-in", "not-checked-in"].includes(params.segment) ? params.segment : "all";
    let recipients = event.registrations;
    if (segment === "checked-in") recipients = recipients.filter((r) => r.checkedIn);
    if (segment === "not-checked-in") recipients = recipients.filter((r) => !r.checkedIn);
    const blast = {
      id: evId("bl"),
      subject,
      body,
      segment,
      recipientCount: recipients.length,
      recipients: recipients.map((r) => ({ name: r.name, email: r.email })),
      sentAt: evNow(),
    };
    event.blasts.push(blast);
    saveEvents();
    return {
      ok: true,
      result: { blast, delivered: recipients.length },
    };
  });

  registerLensAction("events", "blast-list", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    return {
      ok: true,
      result: {
        blasts: [...event.blasts].reverse(),
        count: event.blasts.length,
        totalDelivered: event.blasts.reduce((n, b) => n + b.recipientCount, 0),
      },
    };
  });

  registerLensAction("events", "blast-delete", (ctx, _a, params = {}) => {
    const s = getEventsState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const event = findEvent(s, ctx, params.eventId);
    if (!event) return { ok: false, error: "event not found" };
    ensureEventCollections(event);
    const i = event.blasts.findIndex((b) => b.id === params.blastId);
    if (i < 0) return { ok: false, error: "blast not found" };
    event.blasts.splice(i, 1);
    saveEvents();
    return { ok: true, result: { deleted: params.blastId } };
  });
};
