// tests/depth/astronomy-behavior.test.js — REAL behavioral tests for the
// `astronomy` domain (Stellarium/SkySafari-parity sky lens; registerLensAction
// family, invoked via lensRun). Exact-value assertions on the deterministic
// ephemeris + orbital-mechanics math (Kepler's third law, light-travel time,
// fixed-date sky-chart alt/az + moon phase, whats-up ranking, ephemeris
// calendar, Messier catalog filtering) + observing-target / observation-log /
// session CRUD round-trips + validation rejections.
//
// SKIPPED — network macros that fail under no-egress: `apod` (NASA APOD),
// `iss-current-location` (wheretheiss.at), `near-earth-objects` (NASA NeoWs),
// `feed` (NASA APOD batch), `observing-forecast` (Open-Meteo). Also SKIPPED:
// `celestialPosition` / `planObservation` read `new Date()` internally (no
// `when` param) so they are not date-deterministic — the deterministic sky math
// is fully covered by `sky-chart` / `whats-up` / `ephemeris-calendar` which DO
// accept a fixed `when`/`startDate`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("astronomy — orbital mechanics + distance math (exact values)", () => {
  it("orbitalMechanics: Kepler T²=a³/M (a=4 AU, M=1 → 8 yr), peri/aph, eccentric class", async () => {
    const r = await lensRun("astronomy", "orbitalMechanics", {
      data: { semiMajorAxis: 4, eccentricity: 0.5, centralMass: 1, name: "Test Body" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 8);          // sqrt(4^3 / 1) = 8
    assert.equal(r.result.periodDays, 2922);        // 8 * 365.25
    assert.equal(r.result.perihelionAU, 2);         // 4 * (1 - 0.5)
    assert.equal(r.result.aphelionAU, 6);           // 4 * (1 + 0.5)
    assert.equal(r.result.avgOrbitalVelocityKmS, 14.9); // 29.78 / sqrt(4)
    assert.equal(r.result.orbitType, "highly-eccentric"); // e=0.5 is not < 0.5
  });

  it("orbitalMechanics: a nearly-circular low-e orbit is classified nearly-circular", async () => {
    const r = await lensRun("astronomy", "orbitalMechanics", {
      data: { semiMajorAxis: 1, eccentricity: 0.0167, centralMass: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.periodYears, 1);          // Earth: 1 AU, 1 solar mass → 1 yr
    assert.equal(r.result.orbitType, "nearly-circular"); // e < 0.05
  });

  it("lightTravelTime: 4.246 ly → parsec conversion + lookback prose", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", {
      data: { distanceLightYears: 4.246, name: "Proxima Centauri" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 4.246);
    assert.equal(r.result.distanceParsecs, 1.302); // 4.246 / 3.2616
    assert.equal(r.result.distanceKm, "4.017e+13");
    assert.equal(r.result.travelTimeLight, "4.25 years"); // round(4.246*100)/100
    assert.ok(r.result.lookbackTime.includes("4.25 years ago"));
  });

  it("lightTravelTime: parsecs input converts to light-years (1 pc → 3.262 ly)", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", {
      data: { distanceParsecs: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.distanceLightYears, 3.262); // 1 * 3.2616 rounded to 3 dp
  });

  it("lightTravelTime: no distance given returns a guidance message, not a number", async () => {
    const r = await lensRun("astronomy", "lightTravelTime", { data: {} });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("light-years"));
  });
});

describe("astronomy — fixed-date ephemeris (deterministic alt/az + moon phase)", () => {
  // Polaris altitude ≈ observer latitude is a robust physics invariant of the
  // equatorial→horizontal transform, independent of sidereal time.
  it("sky-chart: Polaris altitude ≈ observer latitude (NYC 40.7°N, fixed when)", async () => {
    const r = await lensRun("astronomy", "sky-chart", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-03-20T04:00:00Z" },
    });
    assert.equal(r.ok, true);
    const polaris = r.result.stars.find((s) => s.name === "Polaris");
    assert.ok(polaris, "Polaris present in star list");
    assert.equal(polaris.altitude, 40.27); // ≈ latitude
    assert.equal(polaris.visible, true);
    assert.equal(r.result.constellationLines.length, 3); // Orion, Big Dipper, Gemini
  });

  it("sky-chart: moon phase + Sun daytime flag are computed for a fixed instant", async () => {
    const r = await lensRun("astronomy", "sky-chart", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-01-15T22:00:00Z" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.moon.phase, "Waning Crescent");
    assert.equal(r.result.moon.illumination, 0.081);
    assert.equal(r.result.sun.isDaytime, false); // sun alt -1.94 < -0.833
    assert.equal(r.result.siderealTimeDeg, 11.36);
  });

  it("whats-up: ranks objects above minAltitude, highest first (Polaris visible)", async () => {
    const r = await lensRun("astronomy", "whats-up", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-03-20T04:00:00Z", minAltitude: 10 },
    });
    assert.equal(r.ok, true);
    // Sorted descending by altitude — first object is the highest.
    for (let i = 1; i < r.result.objects.length; i++) {
      assert.ok(r.result.objects[i - 1].altitude >= r.result.objects[i].altitude);
    }
    assert.ok(r.result.objects.every((o) => o.altitude >= 10));
    assert.ok(r.result.objects.some((o) => o.name === "Polaris"));
    assert.equal(r.result.best, r.result.objects[0]);
  });

  it("ephemeris-calendar: fixed startDate gives deterministic moon phase per day", async () => {
    const r = await lensRun("astronomy", "ephemeris-calendar", {
      params: { latitude: 40.7, longitude: -74.0, startDate: "2026-01-15", days: 3 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.calendar[0].date, "2026-01-15");
    assert.equal(r.result.calendar[0].moonPhase, "Waning Crescent");
    assert.equal(r.result.calendar[0].moonIllumination, 0.104); // moon at noon
  });

  it("sky-chart: missing latitude/longitude is rejected", async () => {
    const r = await lensRun("astronomy", "sky-chart", { params: { latitude: 40.7 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /latitude and longitude required/);
  });
});

describe("astronomy — Messier catalog filtering (exact)", () => {
  it("catalog-list filters by type and sorts by magnitude ascending", async () => {
    const r = await lensRun("astronomy", "catalog-list", { params: { type: "galaxy" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 6); // M31, M51, M63, M81, M101, M104
    assert.ok(r.result.catalog.every((c) => c.type === "galaxy"));
    for (let i = 1; i < r.result.catalog.length; i++) {
      assert.ok(r.result.catalog[i - 1].magnitude <= r.result.catalog[i].magnitude);
    }
  });

  it("catalog-list maxMagnitude keeps only bright objects (mag <= 4 → M45 brightest)", async () => {
    const r = await lensRun("astronomy", "catalog-list", { params: { maxMagnitude: 4.0 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 4); // M45, M31, M44, M42
    assert.ok(r.result.catalog.every((c) => c.magnitude <= 4.0));
    assert.equal(r.result.catalog[0].id, "M45"); // brightest (mag 1.6) sorts first
  });
});

describe("astronomy — observing-target + log + session CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-crud-${randomUUID()}`); });

  it("target-add → target-list → catalog-import → observation-log round-trip", async () => {
    const added = await lensRun("astronomy", "target-add", {
      params: { name: "My Comet", type: "comet", constellation: "Leo", magnitude: 7.2 },
    }, ctx);
    assert.equal(added.ok, true);
    const targetId = added.result.target.id;
    assert.equal(added.result.target.type, "comet");

    const list = await lensRun("astronomy", "target-list", {}, ctx);
    assert.ok(list.result.targets.some((t) => t.id === targetId));

    // Import a real Messier object as a target, then log an observation on it.
    const imported = await lensRun("astronomy", "catalog-import", { params: { catalogId: "M31" } }, ctx);
    assert.equal(imported.ok, true);
    assert.ok(imported.result.target.name.includes("Andromeda Galaxy"));
    const m31Id = imported.result.target.id;

    const logged = await lensRun("astronomy", "observation-log", {
      params: { targetId: m31Id, conditions: "clear", rating: 5, notes: "naked eye smudge" },
    }, ctx);
    assert.equal(logged.ok, true);
    assert.equal(logged.result.observation.rating, 5);
    assert.equal(logged.result.observation.targetName, imported.result.target.name);

    // The observation makes the target read back as observed with count 1.
    const detail = await lensRun("astronomy", "target-detail", { params: { id: m31Id } }, ctx);
    assert.equal(detail.result.observations.length, 1);
    const relisted = await lensRun("astronomy", "target-list", {}, ctx);
    const m31 = relisted.result.targets.find((t) => t.id === m31Id);
    assert.equal(m31.observed, true);
    assert.equal(m31.observationCount, 1);
  });

  it("rating is clamped to 0..5 (input 9 → 5)", async () => {
    const t = await lensRun("astronomy", "target-add", { params: { name: "Clamp Target" } }, ctx);
    const obs = await lensRun("astronomy", "observation-log", {
      params: { targetId: t.result.target.id, rating: 9 },
    }, ctx);
    assert.equal(obs.ok, true);
    assert.equal(obs.result.observation.rating, 5); // Math.min(5, round(9))
  });

  it("session-create clamps bortle to 1..9 and defaults seeing to a valid enum", async () => {
    const s = await lensRun("astronomy", "session-create", {
      params: { location: "Backyard", bortle: 42, seeing: "nonsense" },
    }, ctx);
    assert.equal(s.ok, true);
    assert.equal(s.result.session.bortle, 9);       // clamped from 42
    assert.equal(s.result.session.seeing, "average"); // invalid → default
  });
});

describe("astronomy — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-reject-${randomUUID()}`); });

  it("target-add without a name is rejected", async () => {
    const bad = await lensRun("astronomy", "target-add", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target name required/);
  });

  it("observation-log against an unknown target is rejected", async () => {
    const bad = await lensRun("astronomy", "observation-log", { params: { targetId: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target not found/);
  });

  it("catalog-import of an unknown catalog id is rejected", async () => {
    const bad = await lensRun("astronomy", "catalog-import", { params: { catalogId: "M999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /catalog object not found/);
  });
});

describe("astronomy — target/observation/session/equipment/wishlist/event extra CRUD", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-crud2-${randomUUID()}`); });

  it("target-update edits fields; unknown id rejected; bad type → 'other'", async () => {
    const added = await lensRun("astronomy", "target-add", {
      params: { name: "Edit Me", type: "not_a_type", magnitude: 5 },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.target.type, "other"); // unknown type falls back

    const id = added.result.target.id;
    const upd = await lensRun("astronomy", "target-update", {
      params: { id, name: "Edited Name", constellation: "Orion", magnitude: 2.1 },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.target.name, "Edited Name");
    assert.equal(upd.result.target.constellation, "Orion");
    assert.equal(upd.result.target.magnitude, 2.1);

    const bad = await lensRun("astronomy", "target-update", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /target not found/);
  });

  it("target-delete removes the target; second delete rejected", async () => {
    const added = await lensRun("astronomy", "target-add", { params: { name: "Delete Me" } }, ctx);
    const id = added.result.target.id;
    const del = await lensRun("astronomy", "target-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const again = await lensRun("astronomy", "target-delete", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /target not found/);
    // And it no longer appears in the list.
    const list = await lensRun("astronomy", "target-list", {}, ctx);
    assert.ok(!list.result.targets.some((t) => t.id === id));
  });

  it("observation-list filters by targetId and observation-delete removes a row", async () => {
    const t = await lensRun("astronomy", "target-add", { params: { name: "ObsList Target" } }, ctx);
    const tid = t.result.target.id;
    const o1 = await lensRun("astronomy", "observation-log", {
      params: { targetId: tid, date: "2026-01-01", rating: 3 },
    }, ctx);
    await lensRun("astronomy", "observation-log", {
      params: { targetId: tid, date: "2026-02-01", rating: 4 },
    }, ctx);
    assert.equal(o1.ok, true);

    const listed = await lensRun("astronomy", "observation-list", { params: { targetId: tid } }, ctx);
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 2);
    // Sorted by date descending — newest first.
    assert.equal(listed.result.observations[0].date, "2026-02-01");
    assert.equal(listed.result.observations[1].date, "2026-01-01");

    const del = await lensRun("astronomy", "observation-delete", {
      params: { id: o1.result.observation.id },
    }, ctx);
    assert.equal(del.ok, true);
    const after = await lensRun("astronomy", "observation-list", { params: { targetId: tid } }, ctx);
    assert.equal(after.result.count, 1);

    const badDel = await lensRun("astronomy", "observation-delete", { params: { id: "nope" } }, ctx);
    assert.equal(badDel.result.ok, false);
    assert.match(badDel.result.error, /observation not found/);
  });

  it("session-list counts observations linked by sessionId; session-detail returns them", async () => {
    const ses = await lensRun("astronomy", "session-create", {
      params: { location: "Hilltop", bortle: 3, seeing: "good" },
    }, ctx);
    assert.equal(ses.ok, true);
    assert.equal(ses.result.session.bortle, 3);
    assert.equal(ses.result.session.seeing, "good");
    const sid = ses.result.session.id;

    const t = await lensRun("astronomy", "target-add", { params: { name: "Session Target" } }, ctx);
    await lensRun("astronomy", "observation-log", {
      params: { targetId: t.result.target.id, sessionId: sid, rating: 5 },
    }, ctx);

    const list = await lensRun("astronomy", "session-list", {}, ctx);
    const found = list.result.sessions.find((x) => x.id === sid);
    assert.ok(found, "session present in list");
    assert.equal(found.observationCount, 1);

    const detail = await lensRun("astronomy", "session-detail", { params: { id: sid } }, ctx);
    assert.equal(detail.ok, true);
    assert.equal(detail.result.observations.length, 1);

    const bad = await lensRun("astronomy", "session-detail", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /session not found/);
  });

  it("equipment-add/list/delete round-trip; bad kind → 'telescope'; nameless rejected", async () => {
    const noName = await lensRun("astronomy", "equipment-add", { params: {} }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(noName.result.error, /equipment name required/);

    const eq = await lensRun("astronomy", "equipment-add", {
      params: { name: "8in Dob", kind: "bogus", aperture: 203, focalLength: 1200 },
    }, ctx);
    assert.equal(eq.ok, true);
    assert.equal(eq.result.equipment.kind, "telescope"); // bad kind falls back
    assert.equal(eq.result.equipment.aperture, 203);

    const list = await lensRun("astronomy", "equipment-list", {}, ctx);
    assert.ok(list.result.equipment.some((e) => e.id === eq.result.equipment.id));

    const del = await lensRun("astronomy", "equipment-delete", { params: { id: eq.result.equipment.id } }, ctx);
    assert.equal(del.ok, true);
    const badDel = await lensRun("astronomy", "equipment-delete", { params: { id: "nope" } }, ctx);
    assert.equal(badDel.result.ok, false);
    assert.match(badDel.result.error, /equipment not found/);
  });

  it("wishlist-add/list sorts by priority and marks observed-by-name; remove deletes", async () => {
    // A 'high' priority entry whose name matches a logged observation reads observed.
    const hi = await lensRun("astronomy", "wishlist-add", {
      params: { name: "Andromeda Galaxy", type: "galaxy", priority: "high" },
    }, ctx);
    assert.equal(hi.ok, true);
    assert.equal(hi.result.entry.priority, "high");
    const lo = await lensRun("astronomy", "wishlist-add", {
      params: { name: "Some Faint Smudge", priority: "low" },
    }, ctx);
    assert.equal(lo.result.entry.type, "other"); // no type → other

    // Log an observation whose targetName matches the high-priority wishlist name.
    const t = await lensRun("astronomy", "target-add", { params: { name: "Andromeda Galaxy" } }, ctx);
    await lensRun("astronomy", "observation-log", { params: { targetId: t.result.target.id } }, ctx);

    const list = await lensRun("astronomy", "wishlist-list", {}, ctx);
    assert.equal(list.ok, true);
    // 'high' sorts before 'low'.
    assert.equal(list.result.items[0].priority, "high");
    const andromeda = list.result.items.find((w) => w.name === "Andromeda Galaxy");
    assert.equal(andromeda.observed, true); // matched by name to the observation
    // remaining counts only un-observed entries.
    assert.equal(list.result.remaining, list.result.items.filter((w) => !w.observed).length);

    const rm = await lensRun("astronomy", "wishlist-remove", { params: { id: lo.result.entry.id } }, ctx);
    assert.equal(rm.ok, true);
    const badRm = await lensRun("astronomy", "wishlist-remove", { params: { id: "nope" } }, ctx);
    assert.equal(badRm.result.ok, false);
    assert.match(badRm.result.error, /wishlist entry not found/);
  });

  it("event-add requires name + date; event-list flags upcoming & next; delete removes", async () => {
    const noName = await lensRun("astronomy", "event-add", { params: { date: "2099-01-01" } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(noName.result.error, /event name required/);
    const noDate = await lensRun("astronomy", "event-add", { params: { name: "Eclipse" } }, ctx);
    assert.equal(noDate.result.ok, false);
    assert.match(noDate.result.error, /date required/);

    // A far-future event is always 'upcoming'; bad kind falls back to 'other'.
    const future = await lensRun("astronomy", "event-add", {
      params: { name: "Total Eclipse", date: "2099-08-12", kind: "bogus" },
    }, ctx);
    assert.equal(future.ok, true);
    assert.equal(future.result.event.kind, "other");
    // A long-past event is not upcoming.
    await lensRun("astronomy", "event-add", {
      params: { name: "Old Meteor Shower", date: "2000-01-01", kind: "meteor_shower" },
    }, ctx);

    const list = await lensRun("astronomy", "event-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.upcoming >= 1);
    assert.ok(list.result.next, "a next upcoming event exists");
    assert.equal(list.result.next.upcoming, true);
    // sorted ascending by date — the year-2000 event sorts before 2099.
    assert.equal(list.result.events[0].date, "2000-01-01");

    const del = await lensRun("astronomy", "event-delete", { params: { id: future.result.event.id } }, ctx);
    assert.equal(del.ok, true);
    const badDel = await lensRun("astronomy", "event-delete", { params: { id: "nope" } }, ctx);
    assert.equal(badDel.result.ok, false);
    assert.match(badDel.result.error, /event not found/);
  });

  it("astro-dashboard aggregates targets/observations/sessions/events for the user", async () => {
    const dctx = await depthCtx(`astronomy-dash-${randomUUID()}`);
    // Empty dashboard first.
    const empty = await lensRun("astronomy", "astro-dashboard", {}, dctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.targets, 0);
    assert.equal(empty.result.observations, 0);

    const t = await lensRun("astronomy", "target-add", { params: { name: "Dash Target" } }, dctx);
    await lensRun("astronomy", "observation-log", { params: { targetId: t.result.target.id, rating: 4 } }, dctx);
    await lensRun("astronomy", "session-create", { params: { location: "Field" } }, dctx);
    await lensRun("astronomy", "event-add", { params: { name: "Future Event", date: "2099-12-31" } }, dctx);

    const d = await lensRun("astronomy", "astro-dashboard", {}, dctx);
    assert.equal(d.ok, true);
    assert.equal(d.result.targets, 1);
    assert.equal(d.result.observed, 1);   // one target has an observation
    assert.equal(d.result.observations, 1);
    assert.equal(d.result.sessions, 1);
    assert.equal(d.result.upcomingEvents, 1);
  });
});

describe("astronomy — constellations + AR resolver (deterministic geometry)", () => {
  it("constellations returns IAU topology + full Messier deep-sky list (no observer)", async () => {
    const r = await lensRun("astronomy", "constellations", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3); // Orion, Big Dipper, Gemini
    assert.equal(r.result.deepSkyCount, 16); // MESSIER_CATALOG length
    const orion = r.result.constellations.find((c) => c.name === "Orion");
    assert.ok(orion, "Orion present");
    // Each segment carries the J2000 endpoint coords; with no observer there's no alt/az.
    const seg = orion.segments[0];
    assert.ok(seg.fromRaDec && seg.toRaDec, "endpoint RA/Dec present");
    assert.equal(seg.fromAltAz, undefined); // no observer → no horizontal coords
  });

  it("constellations with observer adds alt/az to each segment endpoint", async () => {
    const r = await lensRun("astronomy", "constellations", {
      params: { latitude: 40.7, longitude: -74.0, when: "2026-03-20T04:00:00Z" },
    });
    assert.equal(r.ok, true);
    const gemini = r.result.constellations.find((c) => c.name === "Gemini");
    const seg = gemini.segments[0];
    assert.ok(seg.fromAltAz && typeof seg.fromAltAz.altitude === "number");
    assert.ok(seg.toAltAz && typeof seg.toAltAz.azimuth === "number");
  });

  it("ar-resolve: pointing exactly at Polaris's alt/az finds it with ~0 separation", async () => {
    const when = "2026-03-20T04:00:00Z";
    // Get Polaris's true alt/az from the sky-chart at this instant, then point there.
    const chart = await lensRun("astronomy", "sky-chart", {
      params: { latitude: 40.7, longitude: -74.0, when },
    });
    const polaris = chart.result.stars.find((s) => s.name === "Polaris");
    assert.ok(polaris.visible);

    const r = await lensRun("astronomy", "ar-resolve", {
      params: { latitude: 40.7, longitude: -74.0, altitude: polaris.altitude, azimuth: polaris.azimuth, when, fov: 10 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.nearest.name, "Polaris");
    assert.ok(r.result.nearest.separationDeg <= 0.2); // pointing dead-on
    assert.ok(r.result.matches.every((m) => m.separationDeg <= 10)); // within fov
  });

  it("ar-resolve: missing observer / missing orientation are rejected", async () => {
    const noObs = await lensRun("astronomy", "ar-resolve", { params: { altitude: 45, azimuth: 90 } });
    assert.equal(noObs.result.ok, false);
    assert.match(noObs.result.error, /latitude and longitude required/);

    const noOrient = await lensRun("astronomy", "ar-resolve", {
      params: { latitude: 40.7, longitude: -74.0 },
    });
    assert.equal(noOrient.result.ok, false);
    assert.match(noOrient.result.error, /altitude and azimuth/);
  });
});

describe("astronomy — telescope GoTo (INDI/ASCOM bridge) round-trip", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`astronomy-goto-${randomUUID()}`); });

  it("goto-mount-set normalizes protocol + clamps port; goto-mount-get reads it back", async () => {
    const empty = await lensRun("astronomy", "goto-mount-get", {}, ctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.mount, null);

    const set = await lensRun("astronomy", "goto-mount-set", {
      params: { protocol: "bogus", host: "scope.local", port: 999999, name: "Backyard Rig" },
    }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.result.mount.protocol, "indi"); // unknown protocol → default indi
    assert.equal(set.result.mount.port, 65535);      // clamped to max
    assert.equal(set.result.mount.host, "scope.local");

    const got = await lensRun("astronomy", "goto-mount-get", {}, ctx);
    assert.equal(got.result.mount.name, "Backyard Rig");
    assert.equal(got.result.mount.protocol, "indi");
  });

  it("goto-command resolves alt/az when observer given, queues it, and reflects mount", async () => {
    // Point at Polaris (RA/Dec) from NYC — altitude should be ≈ latitude.
    const cmd = await lensRun("astronomy", "goto-command", {
      params: { targetName: "Polaris", ra: 37.954, dec: 89.264, latitude: 40.7, longitude: -74.0 },
    }, ctx);
    assert.equal(cmd.ok, true);
    assert.equal(cmd.result.command.targetName, "Polaris");
    assert.equal(cmd.result.command.protocol, "indi"); // from the mount set above
    assert.equal(cmd.result.command.status, "queued");
    assert.equal(cmd.result.mountConnected, true);
    assert.ok(cmd.result.command.altAz, "alt/az resolved from observer");
    assert.ok(Math.abs(cmd.result.command.altAz.altitude - 40.7) < 1.5); // Polaris alt ≈ lat
    assert.equal(cmd.result.command.belowHorizon, false);

    const queue = await lensRun("astronomy", "goto-queue", {}, ctx);
    assert.ok(queue.result.queue.some((c) => c.id === cmd.result.command.id));
    assert.ok(queue.result.count >= 1);
  });

  it("goto-command rejects missing targetName / non-numeric ra/dec", async () => {
    const noName = await lensRun("astronomy", "goto-command", { params: { ra: 10, dec: 10 } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(noName.result.error, /targetName required/);

    const noCoords = await lensRun("astronomy", "goto-command", { params: { targetName: "X" } }, ctx);
    assert.equal(noCoords.result.ok, false);
    assert.match(noCoords.result.error, /ra and dec/);
  });

  it("goto-mount-set defaults port per protocol; ascom default 11880", async () => {
    const ctx2 = await depthCtx(`astronomy-goto2-${randomUUID()}`);
    const ascom = await lensRun("astronomy", "goto-mount-set", {
      params: { protocol: "ascom", host: "pc.local" },
    }, ctx2);
    assert.equal(ascom.ok, true);
    assert.equal(ascom.result.mount.protocol, "ascom");
    assert.equal(ascom.result.mount.port, 11880); // ascom default
    assert.equal(ascom.result.mount.name, "My Mount"); // no name → default
    assert.equal(ascom.result.mount.host, "pc.local");
  });

  it("goto-command without a mount returns status 'no-mount' and mountConnected false", async () => {
    const ctx3 = await depthCtx(`astronomy-goto3-${randomUUID()}`);
    const cmd = await lensRun("astronomy", "goto-command", {
      params: { targetName: "Vega", ra: 279.234, dec: 38.784 },
    }, ctx3);
    assert.equal(cmd.ok, true);
    assert.equal(cmd.result.command.status, "no-mount");
    assert.equal(cmd.result.command.protocol, null);
    assert.equal(cmd.result.mountConnected, false);
    assert.equal(cmd.result.command.altAz, null);     // no observer → no alt/az
    assert.equal(cmd.result.command.belowHorizon, null);
    assert.equal(cmd.result.command.ra, 279.234);     // round(ra*1000)/1000
  });

  it("goto-command-update transitions status; goto-clear drops completed/cancelled", async () => {
    // Queue two commands (no observer → status 'queued' since a mount is set).
    const a = await lensRun("astronomy", "goto-command", {
      params: { targetName: "A", ra: 100, dec: 10 },
    }, ctx);
    const b = await lensRun("astronomy", "goto-command", {
      params: { targetName: "B", ra: 200, dec: -10 },
    }, ctx);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    const upd = await lensRun("astronomy", "goto-command-update", {
      params: { id: a.result.command.id, status: "completed" },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.command.status, "completed");

    const badUpd = await lensRun("astronomy", "goto-command-update", { params: { id: "nope" } }, ctx);
    assert.equal(badUpd.result.ok, false);
    assert.match(badUpd.result.error, /command not found/);

    const beforeClear = await lensRun("astronomy", "goto-queue", {}, ctx);
    const completedCount = beforeClear.result.queue.filter((c) => c.status === "completed").length;
    assert.ok(completedCount >= 1);

    const clear = await lensRun("astronomy", "goto-clear", {}, ctx);
    assert.equal(clear.ok, true);
    assert.equal(clear.result.removed, completedCount); // removed all completed/cancelled
    const after = await lensRun("astronomy", "goto-queue", {}, ctx);
    assert.ok(!after.result.queue.some((c) => c.status === "completed"));
  });
});

describe("astronomy — celestialPosition deterministic formatting + visibility", () => {
  // altitude/azimuth depend on `new Date()` so they aren't pinned, but the
  // coordinate echo, observer defaults, and the visible↔altitude consistency
  // are deterministic invariants we CAN assert.
  it("echoes RA/Dec with units, names the object, defaults the observer to NYC", async () => {
    const r = await lensRun("astronomy", "celestialPosition", {
      data: { rightAscension: 5.5, declination: -8.2, name: "Rigel" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.object, "Rigel");
    assert.equal(r.result.ra, "5.5h");
    assert.equal(r.result.dec, "-8.2°");
    assert.equal(r.result.observerLocation.lat, 40.7);  // default observer
    assert.equal(r.result.observerLocation.lon, -74.0);
    // visible flag is exactly (altitude > 0); bestViewing partitions on altitude.
    assert.equal(r.result.visible, r.result.altitude > 0);
    if (r.result.altitude > 30) assert.equal(r.result.bestViewing, "excellent");
    else if (r.result.altitude > 15) assert.equal(r.result.bestViewing, "good");
    else if (r.result.altitude > 0) assert.equal(r.result.bestViewing, "low-on-horizon");
    else assert.equal(r.result.bestViewing, "below-horizon");
    // azimuth is normalized into [0,360).
    assert.ok(r.result.azimuth >= 0 && r.result.azimuth < 360);
  });

  it("an explicit observer is honored over the NYC default", async () => {
    const r = await lensRun("astronomy", "celestialPosition", {
      data: { rightAscension: 0, declination: 0, latitude: -33.9, longitude: 151.2 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.observerLocation.lat, -33.9);
    assert.equal(r.result.observerLocation.lon, 151.2);
  });
});

describe("astronomy — planObservation deterministic difficulty/priority classification", () => {
  it("with no targets returns a guidance message, not a plan", async () => {
    const r = await lensRun("astronomy", "planObservation", { data: { targets: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("RA/Dec"));
  });

  it("classifies difficulty + priority from magnitude (telescope/binoculars/naked-eye)", async () => {
    const r = await lensRun("astronomy", "planObservation", {
      data: {
        targets: [
          { name: "Faint Quasar", magnitude: 12 },  // >6 → telescope-only
          { name: "Globular", magnitude: 5 },        // >4 → binoculars
          { name: "Bright Star", magnitude: 1.2 },   // <=2 → naked-eye, high priority
        ],
      },
    });
    assert.equal(r.ok, true);
    const quasar = r.result.targets.find((t) => t.name === "Faint Quasar");
    const globular = r.result.targets.find((t) => t.name === "Globular");
    const bright = r.result.targets.find((t) => t.name === "Bright Star");
    assert.equal(quasar.difficulty, "telescope-only");
    assert.equal(globular.difficulty, "binoculars");
    assert.equal(bright.difficulty, "naked-eye");
    assert.equal(bright.priority, "high");      // mag <= 2
    assert.equal(globular.priority, "medium");  // mag > 2
    // bestTargets is exactly the naked-eye subset.
    assert.equal(r.result.bestTargets.length, 1);
    assert.equal(r.result.bestTargets[0].name, "Bright Star");
    // a telescope-only target forces the telescope recommendation.
    assert.equal(r.result.equipmentNeeded, "Telescope recommended");
    // moon-driven darkness factor is one of the four deterministic enums.
    assert.ok(["excellent", "good", "fair", "poor"].includes(r.result.darknessFactor));
  });

  it("with only naked-eye/binoculars targets, binoculars suffice", async () => {
    const r = await lensRun("astronomy", "planObservation", {
      data: { targets: [{ name: "Moon-ish", magnitude: 3 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.equipmentNeeded, "Binoculars sufficient");
  });
});

describe("astronomy — network macros: pre-fetch validation branches (no egress)", () => {
  // These macros hit external APIs; we ONLY exercise the deterministic
  // validation that returns BEFORE any fetch — never the network path.
  it("near-earth-objects rejects a malformed startDate before any fetch", async () => {
    const r = await lensRun("astronomy", "near-earth-objects", {
      params: { startDate: "not-a-date" },
    });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("YYYY-MM-DD"));
  });

  it("near-earth-objects rejects a malformed endDate before any fetch", async () => {
    const r = await lensRun("astronomy", "near-earth-objects", {
      params: { startDate: "2026-01-01", endDate: "2026/01/08" },
    });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("YYYY-MM-DD"));
  });

  it("observing-forecast rejects a missing observer before any fetch", async () => {
    const r = await lensRun("astronomy", "observing-forecast", { params: { latitude: 40.7 } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("latitude and longitude required"));
  });
});
