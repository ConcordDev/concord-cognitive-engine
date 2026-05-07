/**
 * World Events System for Concord Cognitive Engine
 *
 * Concerts, tournaments, workshops, markets, and community gatherings.
 * Events create DTUs — a workshop generates knowledge, a concert
 * generates art, a tournament generates competitive data.
 *
 * Every event is a real knowledge-creation engine, not just social fluff.
 */

import { v4 as uuid } from "uuid";

// ── Event Types ──────────────────────────────────────────────────────────────

const EVENT_TYPES = {
  concert:      { id: "concert",      name: "Concert / Performance",   category: "entertainment", lens: "music",       minPlayers: 5,  maxPlayers: 200, defaultDuration: 120 },
  tournament:   { id: "tournament",   name: "Tournament / Competition", category: "competitive",  lens: "gaming",      minPlayers: 4,  maxPlayers: 64,  defaultDuration: 180 },
  workshop:     { id: "workshop",     name: "Workshop / Class",         category: "educational",  lens: "education",   minPlayers: 2,  maxPlayers: 30,  defaultDuration: 90 },
  market:       { id: "market",       name: "Market / Trade Fair",      category: "commerce",     lens: "marketplace", minPlayers: 3,  maxPlayers: 100, defaultDuration: 240 },
  meetup:       { id: "meetup",       name: "Community Meetup",         category: "social",       lens: "general",     minPlayers: 2,  maxPlayers: 50,  defaultDuration: 60 },
  exhibition:   { id: "exhibition",   name: "Art Exhibition / Gallery", category: "creative",     lens: "art",         minPlayers: 1,  maxPlayers: 100, defaultDuration: 180 },
  hackathon:    { id: "hackathon",    name: "Hackathon / Build Sprint", category: "technical",    lens: "engineering", minPlayers: 4,  maxPlayers: 50,  defaultDuration: 480 },
  debate:       { id: "debate",       name: "Debate / Discussion",      category: "intellectual", lens: "philosophy",  minPlayers: 2,  maxPlayers: 30,  defaultDuration: 90 },
  rally:        { id: "rally",        name: "City Rally / Parade",      category: "civic",        lens: "government",  minPlayers: 10, maxPlayers: 500, defaultDuration: 60 },
  ceremony:     { id: "ceremony",     name: "Awards Ceremony",          category: "recognition",  lens: "general",     minPlayers: 5,  maxPlayers: 200, defaultDuration: 60 },
  raid:         { id: "raid",         name: "World Raid / Boss Event",  category: "cooperative",  lens: "gaming",      minPlayers: 10, maxPlayers: 100, defaultDuration: 120 },
  festival:     { id: "festival",     name: "Multi-Day Festival",       category: "celebration",  lens: "general",     minPlayers: 20, maxPlayers: 500, defaultDuration: 1440 },
};

// ── Event Storage ────────────────────────────────────────────────────────────

/** @type {Map<string, object>} eventId → event */
const events = new Map();

/** @type {Map<string, string[]>} cityId → eventId[] */
const cityEvents = new Map();

// ── Event CRUD ───────────────────────────────────────────────────────────────

/**
 * Create a new event.
 */
export function createEvent({
  cityId, hostId, type, name, description = "",
  districtId = null, lens = null,
  startTime, endTime, duration = null,
  maxAttendees = null, entryFee = 0,
  rewards = [], tags = [],
  recurring = null, // { pattern: "weekly", dayOfWeek: 3, time: "19:00" }
  visibility = "public",
} = {}) {
  const eventType = EVENT_TYPES[type];
  if (!eventType) throw new Error(`Invalid event type: ${type}`);
  if (!cityId) throw new Error("cityId is required");
  if (!hostId) throw new Error("hostId is required");
  if (!name) throw new Error("Event name is required");

  const now = new Date().toISOString();
  const durationMin = duration || eventType.defaultDuration;

  const event = {
    id: uuid(),
    cityId,
    hostId,
    type,
    typeMeta: eventType,
    name,
    description,
    districtId,
    lens: lens || eventType.lens,
    startTime: startTime || now,
    endTime: endTime || new Date(Date.now() + durationMin * 60_000).toISOString(),
    durationMinutes: durationMin,
    maxAttendees: maxAttendees || eventType.maxPlayers,
    entryFee,
    rewards,
    tags: [...tags, type, eventType.category],
    recurring,
    visibility,
    status: "scheduled", // scheduled | active | completed | cancelled
    attendees: new Map(), // userId → { rsvp, joinedAt, role }
    rsvpCount: 0,
    chatLog: [],
    dtusGenerated: [],
    createdAt: now,
    updatedAt: now,
  };

  events.set(event.id, event);

  if (!cityEvents.has(cityId)) cityEvents.set(cityId, []);
  cityEvents.get(cityId).push(event.id);

  return _serializeEvent(event);
}

/**
 * Get an event by ID.
 */
export function getEvent(eventId) {
  const event = events.get(eventId);
  return event ? _serializeEvent(event) : null;
}

/**
 * Update an event (host only).
 */
export function updateEvent(eventId, updates = {}, userId = null) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (userId && event.hostId !== userId) throw new Error("Only the host can update this event");
  if (event.status === "completed" || event.status === "cancelled") throw new Error("Cannot update a finished event");

  const allowed = ["name", "description", "startTime", "endTime", "maxAttendees", "entryFee", "rewards", "tags", "visibility"];
  for (const key of allowed) {
    if (updates[key] !== undefined) event[key] = updates[key];
  }
  event.updatedAt = new Date().toISOString();

  return _serializeEvent(event);
}

/**
 * Cancel an event.
 */
export function cancelEvent(eventId, userId = null) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (userId && event.hostId !== userId) throw new Error("Only the host can cancel this event");

  event.status = "cancelled";
  event.updatedAt = new Date().toISOString();

  return { ok: true, eventId, status: "cancelled" };
}

/**
 * Start an event (transition to active).
 */
export function startEvent(eventId, userId = null) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (userId && event.hostId !== userId) throw new Error("Only the host can start this event");
  if (event.status !== "scheduled") throw new Error(`Cannot start event in status: ${event.status}`);

  event.status = "active";
  event.startedAt = new Date().toISOString();
  event.updatedAt = new Date().toISOString();

  return _serializeEvent(event);
}

/**
 * End an event (transition to completed).
 */
export function endEvent(eventId, userId = null) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (userId && event.hostId !== userId) throw new Error("Only the host can end this event");
  if (event.status !== "active") throw new Error(`Cannot end event in status: ${event.status}`);

  event.status = "completed";
  event.endedAt = new Date().toISOString();
  event.updatedAt = new Date().toISOString();

  return {
    ..._serializeEvent(event),
    attendeeCount: event.attendees.size,
    dtusGenerated: event.dtusGenerated.length,
  };
}

// ── RSVP / Attendance ────────────────────────────────────────────────────────

/**
 * RSVP to an event.
 */
export function rsvpEvent(eventId, userId, { role = "attendee" } = {}) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (event.status === "completed" || event.status === "cancelled") {
    throw new Error("Cannot RSVP to a finished event");
  }
  if (event.attendees.has(userId)) {
    return { ok: true, alreadyRsvped: true, eventId };
  }
  if (event.attendees.size >= event.maxAttendees) {
    throw new Error("Event is full");
  }

  event.attendees.set(userId, {
    rsvp: "going",
    role,
    rsvpAt: new Date().toISOString(),
    joinedAt: null,
  });
  event.rsvpCount = event.attendees.size;

  return { ok: true, eventId, rsvpCount: event.rsvpCount };
}

/**
 * Cancel RSVP.
 */
export function cancelRsvp(eventId, userId) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");

  event.attendees.delete(userId);
  event.rsvpCount = event.attendees.size;

  return { ok: true, eventId, rsvpCount: event.rsvpCount };
}

/**
 * Mark a user as having joined an active event.
 */
export function joinEvent(eventId, userId) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");
  if (event.status !== "active") throw new Error("Event is not active");

  if (!event.attendees.has(userId)) {
    if (event.attendees.size >= event.maxAttendees) throw new Error("Event is full");
    event.attendees.set(userId, { rsvp: "walk-in", role: "attendee", rsvpAt: null, joinedAt: null });
    event.rsvpCount = event.attendees.size;
  }

  event.attendees.get(userId).joinedAt = new Date().toISOString();

  return { ok: true, eventId, joined: true };
}

/**
 * Get event attendees.
 */
export function getEventAttendees(eventId) {
  const event = events.get(eventId);
  if (!event) throw new Error("Event not found");

  return [...event.attendees.entries()].map(([userId, data]) => ({
    userId,
    ...data,
  }));
}

// ── Event Calendar ───────────────────────────────────────────────────────────

/**
 * Get events for a city, optionally filtered.
 */
export function getCityEvents(cityId, { status = null, type = null, lens = null, upcoming = false, limit = 50 } = {}) {
  const eventIds = cityEvents.get(cityId) || [];
  let results = eventIds.map(id => events.get(id)).filter(Boolean);

  if (status) results = results.filter(e => e.status === status);
  if (type) results = results.filter(e => e.type === type);
  if (lens) results = results.filter(e => e.lens === lens);
  if (upcoming) {
    const now = new Date().toISOString();
    results = results.filter(e => e.startTime > now && e.status === "scheduled");
  }

  results.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return results.slice(0, limit).map(_serializeEvent);
}

/**
 * Get a calendar view — events grouped by date.
 */
export function getEventCalendar(cityId, { month = null, year = null } = {}) {
  const now = new Date();
  const targetMonth = month || (now.getMonth() + 1);
  const targetYear = year || now.getFullYear();

  const eventIds = cityEvents.get(cityId) || [];
  const monthEvents = eventIds
    .map(id => events.get(id))
    .filter(e => {
      if (!e) return false;
      const d = new Date(e.startTime);
      return d.getMonth() + 1 === targetMonth && d.getFullYear() === targetYear;
    });

  const calendar = {};
  for (const e of monthEvents) {
    const day = new Date(e.startTime).getDate();
    if (!calendar[day]) calendar[day] = [];
    calendar[day].push(_serializeEvent(e));
  }

  return { month: targetMonth, year: targetYear, days: calendar, totalEvents: monthEvents.length };
}

/**
 * Get globally upcoming events across all cities.
 */
export function getUpcomingEvents({ limit = 20, type = null } = {}) {
  const now = new Date().toISOString();
  let upcoming = [...events.values()]
    .filter(e => e.startTime > now && e.status === "scheduled" && e.visibility === "public");

  if (type) upcoming = upcoming.filter(e => e.type === type);

  return upcoming
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, limit)
    .map(_serializeEvent);
}

// ── Recurring Events ─────────────────────────────────────────────────────────

/**
 * Process recurring events — creates next instances.
 * Called by a scheduled job or dream cycle.
 */
export function processRecurringEvents() {
  const now = Date.now();
  let created = 0;

  for (const event of events.values()) {
    if (!event.recurring) continue;
    if (event.status !== "completed") continue;

    const { pattern, dayOfWeek, time } = event.recurring;
    let nextStart;

    if (pattern === "daily") {
      nextStart = new Date(now + 86400_000);
    } else if (pattern === "weekly") {
      nextStart = new Date(now);
      while (nextStart.getDay() !== (dayOfWeek || 0)) {
        nextStart = new Date(nextStart.getTime() + 86400_000);
      }
    } else if (pattern === "monthly") {
      nextStart = new Date(now);
      nextStart.setMonth(nextStart.getMonth() + 1);
    } else {
      continue;
    }

    if (time) {
      const [h, m] = time.split(":").map(Number);
      nextStart.setHours(h, m, 0, 0);
    }

    // Create next occurrence
    try {
      createEvent({
        cityId: event.cityId,
        hostId: event.hostId,
        type: event.type,
        name: event.name,
        description: event.description,
        districtId: event.districtId,
        lens: event.lens,
        startTime: nextStart.toISOString(),
        duration: event.durationMinutes,
        maxAttendees: event.maxAttendees,
        entryFee: event.entryFee,
        rewards: event.rewards,
        tags: event.tags.filter(t => t !== event.type && t !== event.typeMeta?.category),
        recurring: event.recurring,
        visibility: event.visibility,
      });
      created++;
    } catch (_e) { /* skip failed recurring */ }
  }

  return { created };
}

// ── Event DTU Integration ────────────────────────────────────────────────────

/**
 * Record a DTU generated during an event.
 */
export function recordEventDTU(eventId, dtuId) {
  const event = events.get(eventId);
  if (!event) return { ok: false, reason: "event_not_found" };

  event.dtusGenerated.push({
    dtuId,
    recordedAt: new Date().toISOString(),
  });

  return { ok: true, totalDTUs: event.dtusGenerated.length };
}

// ── Chat Log ─────────────────────────────────────────────────────────────────

/**
 * Add a chat message to an event's log.
 */
export function addEventChat(eventId, userId, message) {
  const event = events.get(eventId);
  if (!event) return { ok: false, reason: "event_not_found" };

  event.chatLog.push({
    userId,
    message: String(message).slice(0, 1000),
    ts: new Date().toISOString(),
  });

  // Keep last 500 messages
  if (event.chatLog.length > 500) {
    event.chatLog = event.chatLog.slice(-500);
  }

  return { ok: true, messageCount: event.chatLog.length };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _serializeEvent(event) {
  return {
    id: event.id,
    cityId: event.cityId,
    hostId: event.hostId,
    type: event.type,
    name: event.name,
    description: event.description,
    districtId: event.districtId,
    lens: event.lens,
    startTime: event.startTime,
    endTime: event.endTime,
    durationMinutes: event.durationMinutes,
    maxAttendees: event.maxAttendees,
    entryFee: event.entryFee,
    rewards: event.rewards,
    tags: event.tags,
    recurring: event.recurring,
    visibility: event.visibility,
    status: event.status,
    rsvpCount: event.rsvpCount || event.attendees?.size || 0,
    dtusGenerated: event.dtusGenerated?.length || 0,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { EVENT_TYPES };

export default {
  createEvent,
  getEvent,
  updateEvent,
  cancelEvent,
  startEvent,
  endEvent,
  rsvpEvent,
  cancelRsvp,
  joinEvent,
  getEventAttendees,
  getCityEvents,
  getEventCalendar,
  getUpcomingEvents,
  processRecurringEvents,
  recordEventDTU,
  addEventChat,
};
