// INC-32 follow-up — the user-authored stores #1151 left on
// SNAPSHOT_EXCLUDED_STATE_KEYS. Same restart as a clean shutdown:
// write through the real macros, JSON-round-trip serializeLensState,
// drop the live STATE, hydrate a fresh one. meshChannels stays out
// (channel PSKs). meshConsensusDags stays out (Ed25519 keypairs).
// The five money-adjacent stores are persisted by the owner-approved
// snapshot (#1156); they are not in SNAPSHOT_EXCLUDED_STATE_KEYS.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerAffect from "../domains/affect.js";
import registerCognitiveReplay from "../domains/cognitive-replay.js";
import registerDistrict from "../domains/district.js";
import registerFilm from "../domains/filmstudios.js";
import registerNews from "../domains/news.js";
import registerNotary from "../domains/notary.js";
import registerSeasonal from "../domains/seasonal.js";
import registerSentinel from "../domains/sentinel.js";
import registerSociety from "../domains/society.js";
import registerStandards from "../domains/standards.js";
import registerTelecom from "../domains/telecommunications.js";
import registerUx from "../domains/ux-suite.js";
import registerWellness from "../domains/wellness.js";
import registerMesh from "../domains/mesh.js";
import registerCobuild from "../domains/cobuild.js";
import registerCodeQuality from "../domains/code-quality.js";
import registerCrisis from "../domains/crisis.js";
import registerDreams from "../domains/dreams.js";
import registerGhost from "../domains/ghost-hunt.js";
import registerGlobal from "../domains/global.js";
import registerInheritance from "../domains/inheritance.js";
import registerFederation from "../domains/federation.js";
import {
  serializeLensState,
  hydrateLensState,
  LENS_STATE_KEYS,
  SNAPSHOT_EXCLUDED_STATE_KEYS,
  SNAPSHOT_STORE_CAPS,
} from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, { data: input }, input);
}
async function callFlat(domain, name, ctx, input = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return await fn(ctx, input);
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

function ok(res, label) {
  assert.equal(res?.ok, true, `${label}: ${JSON.stringify(res)}`);
  return res;
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const PERSISTED = [
  "affectMood", "cognitiveReplay", "districtSnapshots", "filmLensX", "newsParity",
  "notaryRecords", "seasonalChallenges", "seasonalCompetitions",
  "sentinelCases", "sentinelMonitors", "sentinelTimeline", "sentinelScanConfig",
  "sentinelQueries", "sentinelAlerts",
  "societyCharts", "standardsSaved", "telecom", "uxSuite", "wellnessTherapy",
  "meshNodes", "meshMessages", "meshQueue", "meshSeq",
  "cobuildSessions", "cobuildTasks", "cobuildAnnotations",
  "codeQuality",
  "crisisPlaybookProgress", "crisisTeams", "crisisTimelines", "crisisAlertAcks", "crisisResources",
  "dreamTags", "dreamInterpretations",
  "ghostHunts", "ghostHistory", "ghostRank",
  "globalSavedViews",
  "inheritanceEstates", "inheritanceNotices",
  "federation",
];

const FED_PUBLIC = "INC32-FED-PUBLIC-KEY-DO-NOT-LEAK-9f3a";
const MESH_PSK = "INC32-MESH-CHANNEL-PSK-DO-NOT-LEAK-9f3a";
const DAG_PEM = "INC32-PRIVATE-KEY-PEM-DO-NOT-LEAK-9f3a";
const PLANTED_PASSWORD = "INC32-PASSWORD-DO-NOT-LEAK-9f3a";

before(() => {
  registerAffect(register);
  registerCognitiveReplay(register);
  registerDistrict(register);
  registerFilm(register);
  registerNews(register);
  registerNotary(register);
  registerSeasonal(register);
  registerSentinel(register);
  registerSociety(register);
  registerStandards(register);
  registerTelecom(register);
  registerUx(register);
  registerWellness(register);
  registerMesh(register);
  registerCobuild(register);
  registerCodeQuality(register);
  registerCrisis(register);
  registerDreams(register);
  registerGhost(register);
  registerGlobal(register);
  registerInheritance(register);
  registerFederation(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe("INC-32 follow-up snapshot membership", () => {
  it("walks the newly persisted stores and still excludes channel credentials", () => {
    for (const key of PERSISTED) assert.ok(LENS_STATE_KEYS.includes(key), key);
    assert.equal(LENS_STATE_KEYS.includes("meshChannels"), false);
    for (const key of ["meshChannels", "meshConsensusDags"]) {
      assert.equal(typeof SNAPSHOT_EXCLUDED_STATE_KEYS[key], "string", key);
      assert.equal(LENS_STATE_KEYS.includes(key), false, key);
    }
    for (const key of ["predictionMarkets", "inheritPacts", "insAms", "serviceListings", "serviceOrders"]) {
      assert.equal(LENS_STATE_KEYS.includes(key), true, key);
      assert.equal(Object.hasOwn(SNAPSHOT_EXCLUDED_STATE_KEYS, key), false, key);
    }
    assert.ok(SNAPSHOT_STORE_CAPS.notaryRecords.max === 400);
    assert.ok(SNAPSHOT_STORE_CAPS.federation.moderation.max === 500);
  });
});

describe("affect mood survives a snapshot restart", () => {
  it("restores a check-in and a reminder for the owning account only", () => {
    ok(call("affect", "checkin", ctxA, { mood: 4, note: "river morning" }), "checkin");
    ok(call("affect", "setReminder", ctxA, { time: "07:30", label: "Ada check-in", condition: "daily" }), "reminder");
    ok(call("affect", "checkin", ctxB, { mood: 2, note: "other mood" }), "checkin b");
    restartFromSnapshot();
    const hist = ok(call("affect", "checkinHistory", ctxA, {}), "history");
    assert.equal(hist.result.entries.some((e) => e.note === "river morning"), true);
    assert.equal(hist.result.entries.some((e) => e.note === "other mood"), false);
    const nudges = ok(call("affect", "nudges", ctxA, {}), "nudges");
    assert.equal(nudges.result.reminders.some((r) => r.label === "Ada check-in"), true);
    const other = ok(call("affect", "checkinHistory", ctxB, {}), "history b");
    assert.equal(other.result.entries.some((e) => e.note === "river morning"), false);
    assert.equal(other.result.totalCheckins, 1);
  });
});

describe("cognitive replay survives a snapshot restart", () => {
  it("restores a snapshot and a chosen moment after the live session corpus is gone", () => {
    globalThis._concordSTATE.sessions = new Map([
      ["sess_a", {
        userId: "user_a",
        messages: [{ role: "user", content: "remember the river", ts: Date.now(), meta: { tokenCount: 12 } }],
      }],
    ]);
    const snap = ok(call("cognitive-replay", "snapshot-create", ctxA, { title: "River week", sinceDays: 7 }), "snap");
    ok(call("cognitive-replay", "moment-choose", ctxA, { title: "River line", line: "remember the river" }), "moment");
    restartFromSnapshot();
    assert.equal(globalThis._concordSTATE.sessions, undefined);
    const list = ok(call("cognitive-replay", "snapshot-list", ctxA, {}), "list");
    assert.equal(list.result.snapshots.some((s) => s.shareId === snap.result.shareId && s.title === "River week"), true);
    const moments = ok(call("cognitive-replay", "moment-list", ctxA, {}), "moments");
    assert.equal(moments.result.moments.some((m) => m.title === "River line"), true);
    const other = ok(call("cognitive-replay", "snapshot-list", ctxB, {}), "other snaps");
    assert.equal(other.result.count, 0);
    const otherMoments = ok(call("cognitive-replay", "moment-list", ctxB, {}), "other moments");
    assert.equal(otherMoments.result.count, 0);
    const shared = ok(call("cognitive-replay", "snapshot-get", ctxB, { shareId: snap.result.shareId }), "share");
    assert.equal(shared.result.snapshot.title, "River week");
  });
});

describe("district snapshots survive a snapshot restart", () => {
  it("keeps two districts as distinct shared records", () => {
    ok(call("district", "snapshot-record", ctxA, {
      districtId: "east-ward", buildingCount: 12, population: 400, activeUsers: 20,
    }), "east");
    ok(call("district", "snapshot-record", ctxB, {
      districtId: "west-ward", buildingCount: 3, population: 80, activeUsers: 4,
    }), "west");
    restartFromSnapshot();
    const east = ok(call("district", "timeline-list", ctxA, { districtId: "east-ward" }), "east list");
    const west = ok(call("district", "timeline-list", ctxB, { districtId: "west-ward" }), "west list");
    assert.equal(east.result.snapshots[0].population, 400);
    assert.equal(west.result.snapshots[0].population, 80);
    assert.equal(east.result.snapshots[0].districtId, "east-ward");
  });
});

describe("film studio extras survive a snapshot restart", () => {
  it("restores revisions, media, a watch party, and a festival row per account", () => {
    const project = ok(call("film-studios", "project-create", ctxA, { title: "River Cut" }), "project");
    const projectId = project.result.project.id;
    ok(call("film-studios", "revision-create", ctxA, { projectId, label: "Blue draft" }), "rev");
    const mediaA = ok(call("film-studios", "media-register", ctxA, {
      projectId, name: "A-cam", sourceUrl: "https://example.test/a.mov",
    }), "media a");
    const mediaB = ok(call("film-studios", "media-register", ctxA, {
      projectId, name: "B-cam", sourceUrl: "https://example.test/b.mov",
    }), "media b");
    ok(call("film-studios", "multicam-group", ctxA, {
      projectId, name: "Two cam", mediaIds: [mediaA.result.media.id, mediaB.result.media.id],
    }), "mcam");
    const party = ok(call("film-studios", "party-create", ctxA, { projectId, title: "Dailies" }), "party");
    ok(call("film-studios", "party-chat-post", ctxA, { id: party.result.party.id, text: "roll sound" }), "chat");
    ok(call("film-studios", "festival-submit", ctxA, { projectId, festival: "River Fest" }), "fest");
    const otherProject = ok(call("film-studios", "project-create", ctxB, { title: "Other Cut" }), "project b");
    restartFromSnapshot();
    const revs = ok(call("film-studios", "revision-list", ctxA, { projectId }), "revs");
    assert.equal(revs.result.revisions[0].label, "Blue draft");
    const media = ok(call("film-studios", "media-list", ctxA, { projectId }), "media");
    assert.equal(media.result.count, 2);
    const parties = ok(call("film-studios", "party-list", ctxA, { projectId }), "parties");
    assert.equal(parties.result.parties.some((p) => p.title === "Dailies"), true);
    const chat = ok(call("film-studios", "party-chat-list", ctxA, { id: party.result.party.id }), "chat list");
    assert.equal(chat.result.messages[0].text, "roll sound");
    const fests = ok(call("film-studios", "festival-list", ctxA, { projectId }), "fests");
    assert.equal(fests.result.submissions.some((s) => s.festival === "River Fest"), true);
    const otherRevs = ok(call("film-studios", "revision-list", ctxB, { projectId: otherProject.result.project.id }), "other revs");
    assert.equal(otherRevs.result.count, 0);
    const hidden = ok(call("film-studios", "revision-list", ctxB, { projectId }), "hidden");
    assert.equal(hidden.result.count, 0);
  });
});

describe("news parity survives a snapshot restart", () => {
  it("restores alert subscriptions, the alert feed, offline copies, and the digest", () => {
    const art = ok(call("news", "article-add", ctxA, {
      title: "Bridge reopens", source: "River Times", topic: "city", summary: "The span is open.",
    }), "article");
    ok(call("news", "alert-subscribe", ctxA, { kind: "topic", target: "city" }), "sub");
    ok(call("news", "alert-feed", ctxA, {}), "feed");
    ok(call("news", "offline-sync", ctxA, { id: art.result.article.id }), "offline");
    ok(call("news", "digest-schedule-set", ctxA, { cadence: "daily", hour: 7 }), "digest");
    restartFromSnapshot();
    const subs = ok(call("news", "alert-list", ctxA, {}), "subs");
    assert.equal(subs.result.subscriptions.some((s) => s.kind === "topic" && s.target === "city"), true);
    const feed = ok(call("news", "alert-feed", ctxA, {}), "feed again");
    assert.equal(feed.result.alerts.some((a) => a.title === "Bridge reopens"), true);
    const offline = ok(call("news", "offline-list", ctxA, {}), "offline list");
    assert.equal(offline.result.articles[0].title, "Bridge reopens");
    const digest = ok(call("news", "digest-schedule-get", ctxA, {}), "digest get");
    assert.equal(digest.result.schedule.cadence, "daily");
    assert.equal(digest.result.schedule.hour, 7);
    const otherSubs = ok(call("news", "alert-list", ctxB, {}), "other subs");
    assert.equal(otherSubs.result.count, 0);
    const otherOff = ok(call("news", "offline-list", ctxB, {}), "other offline");
    assert.equal(otherOff.result.count, 0);
    const otherDigest = ok(call("news", "digest-schedule-get", ctxB, {}), "other digest");
    assert.equal(otherDigest.result.schedule, null);
  });
});

describe("notary records survive a snapshot restart", () => {
  it("restores the hash chain for the owning account only", () => {
    const rec = ok(call("notary", "notarize", ctxA, { title: "River deed", content: "the span is open" }), "notarize");
    ok(call("notary", "notarize", ctxB, { title: "Other deed", content: "someone else" }), "notarize b");
    restartFromSnapshot();
    const list = ok(call("notary", "records-list", ctxA, {}), "list");
    assert.equal(list.result.count, 1);
    assert.equal(list.result.records[0].title, "River deed");
    assert.equal(list.result.records[0].contentHash, rec.result.record.contentHash);
    const other = ok(call("notary", "records-list", ctxB, {}), "other");
    assert.equal(other.result.records.some((r) => r.title === "River deed"), false);
    assert.equal(other.result.count, 1);
  });
});

describe("seasonal challenges survive a snapshot restart", () => {
  it("restores a challenge and a competition per account", () => {
    ok(call("seasonal", "challenge-create", ctxA, {
      title: "Span walks", objective: "Cross the bridge", maxProgress: 5,
    }), "chal");
    ok(call("seasonal", "competition-create", ctxA, {
      title: "River cup", categories: ["film"],
    }), "comp");
    ok(call("seasonal", "challenge-create", ctxB, {
      title: "Other walk", objective: "Stay home", maxProgress: 2,
    }), "chal b");
    restartFromSnapshot();
    const chals = ok(call("seasonal", "challenges-list", ctxA, {}), "chals");
    assert.equal(chals.result.challenges.some((c) => c.title === "Span walks"), true);
    assert.equal(chals.result.challenges.some((c) => c.title === "Other walk"), false);
    const comps = ok(call("seasonal", "competitions-list", ctxA, {}), "comps");
    assert.equal(comps.result.competitions[0].title, "River cup");
    const other = ok(call("seasonal", "competitions-list", ctxB, {}), "other comps");
    assert.equal(other.result.count, 0);
  });
});

describe("sentinel stores survive a snapshot restart", () => {
  it("restores cases, monitors, alerts, scan config, and saved queries per account", () => {
    ok(call("sentinel", "triage.open", ctxA, { threatId: "thr-river", title: "Span probe", severity: "high" }), "case");
    const mon = ok(call("sentinel", "monitor.create", ctxA, { name: "Span watch", minSeverity: "high" }), "mon");
    ok(call("sentinel", "monitor.run", ctxA, {
      monitorId: mon.result.monitor.monitorId,
      threats: [{ id: "thr-new", severity: "critical", description: "new probe" }],
    }), "run");
    ok(call("sentinel", "scan.config.set", ctxA, { activeScopes: ["files", "network"] }), "cfg");
    ok(call("sentinel", "query.save", ctxA, { name: "span query", query: "bridge probe" }), "query");
    ok(call("sentinel", "triage.open", ctxB, { threatId: "thr-other", title: "Other probe" }), "case b");
    restartFromSnapshot();
    const cases = ok(call("sentinel", "triage.list", ctxA, {}), "cases");
    assert.equal(cases.result.cases.some((c) => c.title === "Span probe"), true);
    assert.equal(cases.result.cases.some((c) => c.title === "Other probe"), false);
    const monitors = ok(call("sentinel", "monitor.list", ctxA, {}), "monitors");
    assert.equal(monitors.result.monitors[0].name, "Span watch");
    const alerts = ok(call("sentinel", "alerts.list", ctxA, {}), "alerts");
    assert.equal(alerts.result.alerts.some((a) => a.description === "new probe"), true);
    const timeline = ok(call("sentinel", "timeline.list", ctxA, {}), "timeline");
    assert.ok(timeline.result.total >= 1);
    const cfg = ok(call("sentinel", "scan.config.get", ctxA, {}), "cfg get");
    assert.deepEqual(cfg.result.config.activeScopes, ["files", "network"]);
    const queries = ok(call("sentinel", "query.list", ctxA, {}), "queries");
    assert.equal(queries.result.queries.some((q) => q.query === "bridge probe"), true);
    const otherAlerts = ok(call("sentinel", "alerts.list", ctxB, {}), "other alerts");
    assert.equal(otherAlerts.result.total, 0);
    const otherQ = ok(call("sentinel", "query.list", ctxB, {}), "other queries");
    assert.equal(otherQ.result.queries.length, 0);
  });
});

describe("society charts survive a snapshot restart", () => {
  it("lists charts per owner and still opens a chart by its share id", () => {
    const saved = ok(call("society", "wb-save-chart", ctxA, {
      title: "Span chart", spec: { indicator: "SP.POP.TOTL", countries: ["USA"] },
    }), "save");
    ok(call("society", "wb-save-chart", ctxB, {
      title: "Other chart", spec: { indicator: "NY.GDP.PCAP.CD" },
    }), "save b");
    restartFromSnapshot();
    const mine = ok(call("society", "wb-list-charts", ctxA, {}), "mine");
    assert.equal(mine.result.charts.length, 1);
    assert.equal(mine.result.charts[0].title, "Span chart");
    const other = ok(call("society", "wb-list-charts", ctxB, {}), "other");
    assert.equal(other.result.charts.some((c) => c.title === "Span chart"), false);
    const loaded = ok(call("society", "wb-load-chart", ctxB, { id: saved.result.id }), "load");
    assert.equal(loaded.result.title, "Span chart");
    assert.equal(loaded.result.spec.indicator, "SP.POP.TOTL");
  });
});

describe("saved standards survive a snapshot restart", () => {
  it("restores a catalog save for the owning account only", () => {
    ok(call("standards", "save", ctxA, { standardId: "IBC", note: "river code" }), "save");
    restartFromSnapshot();
    const list = ok(call("standards", "saved-list", ctxA, {}), "list");
    assert.equal(list.result.saved.some((s) => s.standardId === "IBC" && s.note === "river code"), true);
    const other = ok(call("standards", "saved-list", ctxB, {}), "other");
    assert.equal(other.result.count, 0);
  });
});

describe("telecom planning survives a snapshot restart", () => {
  it("restores towers, spectrum, outages, and drive tests per account", () => {
    ok(call("telecommunications", "towerSave", ctxA, { name: "Span tower", lat: 40.7, lon: -74.0 }), "tower");
    ok(call("telecommunications", "spectrumAllocate", ctxA, { band: "n77", startMhz: 3700, widthMhz: 100 }), "spec");
    ok(call("telecommunications", "outageReport", ctxA, { site: "Span tower", cause: "backhaul", severity: "major" }), "out");
    ok(call("telecommunications", "driveTestImport", ctxA, {
      measurements: [{ lat: 40.71, lon: -74.01, rsrpDbm: -90 }],
    }), "drive");
    ok(call("telecommunications", "towerSave", ctxB, { name: "Other tower", lat: 41, lon: -73 }), "tower b");
    restartFromSnapshot();
    const towers = ok(call("telecommunications", "towerList", ctxA, {}), "towers");
    assert.equal(towers.result.towers.some((t) => t.name === "Span tower"), true);
    assert.equal(towers.result.towers.some((t) => t.name === "Other tower"), false);
    const spec = ok(call("telecommunications", "spectrumList", ctxA, {}), "spec list");
    assert.equal(spec.result.allocations[0].band, "n77");
    const outages = ok(call("telecommunications", "outageList", ctxA, {}), "outages");
    assert.equal(outages.result.outages[0].cause, "backhaul");
    const drive = ok(call("telecommunications", "driveTestList", ctxA, {}), "drive list");
    assert.equal(drive.result.measurements?.[0]?.measuredRsrpDbm ?? drive.result.tests?.[0]?.measuredRsrpDbm ?? drive.result.driveTests?.[0]?.measuredRsrpDbm, -90);
    const other = ok(call("telecommunications", "spectrumList", ctxB, {}), "other spec");
    assert.equal(other.result.allocations.length, 0);
  });
});

describe("ux suite saves survive a snapshot restart", () => {
  it("restores prop overrides and favourites per account", () => {
    ok(call("ux-suite", "save-props", ctxA, { component: "AccessibilityPanel", props: { fontScale: 1.25 } }), "props");
    ok(call("ux-suite", "favourite-toggle", ctxA, { component: "AccessibilityPanel" }), "fav");
    restartFromSnapshot();
    const preview = ok(call("ux-suite", "props-schema", ctxA, { component: "AccessibilityPanel" }), "schema");
    assert.equal(preview.result.current.fontScale, 1.25);
    const favs = ok(call("ux-suite", "favourites-list", ctxA, {}), "favs");
    assert.ok(favs.result.favourites.includes("AccessibilityPanel"));
    const other = ok(call("ux-suite", "favourites-list", ctxB, {}), "other favs");
    assert.equal(other.result.favourites.includes("AccessibilityPanel"), false);
    const otherProps = ok(call("ux-suite", "props-schema", ctxB, { component: "AccessibilityPanel" }), "other schema");
    assert.equal(otherProps.result.current.fontScale, 1);
  });
});

describe("wellness therapy survives a snapshot restart", () => {
  it("restores fields, thought records, sessions, and wearable syncs per account", () => {
    ok(call("wellness", "self-field-compose", ctxA, { fieldKind: "rumination", intention: "name the loop" }), "field");
    ok(call("wellness", "cbt-record-create", ctxA, {
      fieldKind: "rumination", situation: "the bridge", automaticThought: "it will fail",
      intensityBefore: 70, intensityAfter: 40,
    }), "cbt");
    ok(call("wellness", "session-complete", ctxA, { catalogueId: "box_breathing", durationMin: 5 }), "session");
    ok(call("wellness", "wearable-import", ctxA, {
      source: "band", readings: [{ type: "hrv", value: 48, date: "2026-10-11" }],
    }), "wear");
    restartFromSnapshot();
    const fields = ok(call("wellness", "self-field-list", ctxA, {}), "fields");
    assert.equal(fields.result.fields.some((f) => f.intention === "name the loop"), true);
    const records = ok(call("wellness", "cbt-record-list", ctxA, {}), "records");
    assert.equal(records.result.records[0].automaticThought, "it will fail");
    const sessions = ok(call("wellness", "session-history", ctxA, {}), "sessions");
    assert.equal(sessions.result.count, 1);
    const syncs = ok(call("wellness", "wearable-sync-history", ctxA, {}), "syncs");
    assert.equal(syncs.result.syncs[0].source, "band");
    const other = ok(call("wellness", "cbt-record-list", ctxB, {}), "other");
    assert.equal(other.result.total, 0);
    const otherSync = ok(call("wellness", "wearable-sync-history", ctxB, {}), "other sync");
    assert.equal(otherSync.result.syncs.length, 0);
  });
});

describe("mesh nodes, messages, queue, and seq survive a snapshot restart", () => {
  it("restores nodes, messages, and the outbound queue, and leaves channel keys out", () => {
    const node = ok(call("mesh", "addNode", ctxA, { name: "Span relay" }), "node");
    ok(call("mesh", "addNode", ctxB, { name: "Other relay" }), "node b");
    ok(call("mesh", "sendMessage", ctxA, { to: "dark-peer", body: "hold this frame" }), "send");
    ok(call("mesh", "createChannel", ctxA, { name: "Span net", psk: MESH_PSK }), "channel");
    const seqBefore = globalThis._concordSTATE.meshSeq.get("user_a");
    const blob = restartFromSnapshot();
    const json = JSON.stringify(blob);
    assert.equal(json.includes(MESH_PSK), false);
    assert.equal(json.includes("meshChannels"), false);
    const nodes = ok(call("mesh", "listNodes", ctxA, {}), "nodes");
    assert.equal(nodes.result.nodes.some((n) => n.name === "Span relay"), true);
    assert.equal(nodes.result.nodes.some((n) => n.name === "Other relay"), false);
    const thread = ok(call("mesh", "conversation", ctxA, {}), "thread");
    assert.equal(thread.result.messages.some((m) => m.body === "hold this frame"), true);
    const queue = ok(call("mesh", "queueList", ctxA, {}), "queue");
    assert.equal(queue.result.total, 1);
    const channels = ok(call("mesh", "listChannels", ctxA, {}), "channels");
    assert.equal(channels.result.channels.length, 0);
    const otherThread = ok(call("mesh", "conversation", ctxB, {}), "other thread");
    assert.equal(otherThread.result.total, 0);
    const next = ok(call("mesh", "addNode", ctxA, { name: "Span relay 2" }), "next node");
    const nextSeq = Number(String(next.result.node.id).split("_")[1]);
    assert.equal(nextSeq, seqBefore + 1);
    assert.ok(node.result.node.id);
  });
});

describe("cobuild sessions survive a snapshot restart", () => {
  it("restores a session, its task, and its annotation for participants only", () => {
    const session = ok(call("cobuild", "session-create", ctxA, { name: "Span build", goal: "deck" }), "session");
    const sessionId = session.result.session.id;
    ok(call("cobuild", "task-create", ctxA, { sessionId, title: "Set the joists" }), "task");
    ok(call("cobuild", "annotation-add", ctxA, { sessionId, content: "check the span", kind: "issue" }), "ann");
    ok(call("cobuild", "session-create", ctxB, { name: "Other build" }), "session b");
    restartFromSnapshot();
    const mine = ok(call("cobuild", "session-list", ctxA, {}), "mine");
    assert.equal(mine.result.sessions.some((s) => s.name === "Span build"), true);
    assert.equal(mine.result.sessions.some((s) => s.name === "Other build"), false);
    const tasks = ok(call("cobuild", "task-list", ctxA, { sessionId }), "tasks");
    assert.equal(tasks.result.tasks[0].title, "Set the joists");
    const anns = ok(call("cobuild", "annotations-list", ctxA, { sessionId }), "anns");
    assert.equal(anns.result.annotations[0].content, "check the span");
    const other = ok(call("cobuild", "session-list", ctxB, {}), "other");
    assert.equal(other.result.sessions.some((s) => s.name === "Span build"), false);
  });
});

describe("code quality records survive a snapshot restart", () => {
  it("restores a scan, a tracked issue, and the gate per account", () => {
    const scan = ok(call("code-quality", "analyze", ctxA, { source: "function f(){ return 1; }\n", file: "span.js" }), "scan");
    ok(call("code-quality", "trackIssue", ctxA, { rule: "no-span", message: "joist unchecked", severity: "high" }), "issue");
    ok(call("code-quality", "setGate", ctxA, { maxHigh: 2 }), "gate");
    ok(call("code-quality", "trackIssue", ctxB, { rule: "other", message: "other issue" }), "issue b");
    restartFromSnapshot();
    const gate = ok(call("code-quality", "evaluateGate", ctxA, { scanId: scan.result.scanId }), "eval");
    assert.equal(gate.result.scanId, scan.result.scanId);
    assert.equal(gate.result.gate.maxHigh, 2);
    const issues = ok(call("code-quality", "listIssues", ctxA, {}), "issues");
    assert.equal(issues.result.issues.some((i) => i.message === "joist unchecked"), true);
    assert.equal(issues.result.issues.some((i) => i.message === "other issue"), false);
    const other = ok(call("code-quality", "listIssues", ctxB, {}), "other");
    assert.equal(other.result.total, 1);
    const otherGate = ok(call("code-quality", "getGate", ctxB, {}), "other gate");
    assert.notEqual(otherGate.result.gate.maxHigh, 2);
  });
});

describe("crisis records survive a snapshot restart", () => {
  it("keeps playbook progress, acks, and resources per account, and the roster by crisis id", async () => {
    const crisisId = "crisis-span";
    ok(await callFlat("crisis", "playbook_step", ctxA, { crisisId, stepId: "step_0" }), "step");
    ok(await callFlat("crisis", "assign", ctxA, { crisisId, responder: "Ada", role: "incident_commander" }), "assign");
    ok(await callFlat("crisis", "log_event", ctxA, { crisisId, note: "span closed" }), "log");
    ok(await callFlat("crisis", "acknowledge_alert", ctxA, { alertId: "alert-span" }), "ack");
    ok(await callFlat("crisis", "resource_upsert", ctxA, { name: "pumps", quantity: 4, unit: "units" }), "res");
    ok(await callFlat("crisis", "resource_upsert", ctxB, { name: "blankets", quantity: 2 }), "res b");
    restartFromSnapshot();
    const book = ok(await callFlat("crisis", "playbook", ctxA, { crisisType: "flood", crisisId }), "book");
    assert.equal(book.result.steps.find((s) => s.id === "step_0").done, true);
    const otherBook = ok(await callFlat("crisis", "playbook", ctxB, { crisisType: "flood", crisisId }), "book b");
    assert.equal(otherBook.result.steps.find((s) => s.id === "step_0").done, false);
    const team = ok(await callFlat("crisis", "team", ctxB, { crisisId }), "team");
    assert.equal(team.result.team.some((m) => m.responder === "Ada"), true);
    const timeline = ok(await callFlat("crisis", "timeline", ctxA, { crisisId }), "timeline");
    assert.equal(timeline.result.entries?.some((e) => e.note === "span closed") || timeline.result.events?.some((e) => e.note === "span closed") || timeline.result.timeline?.some((e) => e.note === "span closed"), true);
    const resources = ok(await callFlat("crisis", "resources", ctxA, {}), "resources");
    assert.equal(resources.result.resources.some((r) => r.name === "pumps"), true);
    assert.equal(resources.result.resources.some((r) => r.name === "blankets"), false);
    const otherRes = ok(await callFlat("crisis", "resources", ctxB, {}), "other res");
    assert.equal(otherRes.result.resources.some((r) => r.name === "blankets"), true);
    assert.equal(otherRes.result.resources.some((r) => r.name === "pumps"), false);
  });
});

describe("dream tags and interpretations survive a snapshot restart", () => {
  it("restores tags and a cached interpretation for the dream owner only", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dreams (
      id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, dream_dtu_id TEXT,
      fragment_count INTEGER, signature TEXT, composer TEXT, composed_at INTEGER
    )`);
    db.prepare(`INSERT INTO dreams (id, user_id, world_id, dream_dtu_id, fragment_count, signature, composer, composed_at)
      VALUES (?, ?, ?, NULL, 2, 'sig', 'dream', 1)`).run("dream-a", "user_a", "world-1");
    db.prepare(`INSERT INTO dreams (id, user_id, world_id, dream_dtu_id, fragment_count, signature, composer, composed_at)
      VALUES (?, ?, ?, NULL, 1, 'sig', 'dream', 1)`).run("dream-b", "user_b", "world-1");
    const a = { ...ctxA, db };
    const b = { ...ctxB, db };
    ok(await callFlat("dreams", "tag", a, { dreamId: "dream-a", tags: ["bridge", "water"] }), "tag");
    const first = ok(await callFlat("dreams", "interpret", a, { dreamId: "dream-a" }), "interpret");
    assert.equal(first.cached, false);
    ok(await callFlat("dreams", "tag", b, { dreamId: "dream-b", tags: ["other"] }), "tag b");
    restartFromSnapshot();
    const cloud = ok(await callFlat("dreams", "tags", a, {}), "tags");
    assert.equal(cloud.tags.some((t) => t.tag === "bridge"), true);
    assert.equal(cloud.tags.some((t) => t.tag === "other"), false);
    const again = ok(await callFlat("dreams", "interpret", a, { dreamId: "dream-a" }), "cached");
    assert.equal(again.cached, true);
    const other = ok(await callFlat("dreams", "tags", b, {}), "other tags");
    assert.equal(other.tags.some((t) => t.tag === "bridge"), false);
    db.close();
  });
});

describe("ghost hunts survive a snapshot restart", () => {
  it("restores hunt stage, confront history, and rank per account", async () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE drift_alerts (
      id TEXT PRIMARY KEY, drift_type TEXT, severity TEXT, signature TEXT,
      context_json TEXT, detected_at INTEGER
    )`);
    db.prepare(`INSERT INTO drift_alerts (id, drift_type, severity, signature, context_json, detected_at)
      VALUES ('res-a', 'spectral', 'low', 'sig', '{}', 1)`).run();
    const a = { ...ctxA, db };
    ok(await callFlat("ghost-hunt", "advance", a, { residueId: "res-a" }), "advance");
    const faced = ok(await callFlat("ghost-hunt", "confront", a, { residueId: "res-a", worldId: "world-1" }), "confront");
    ok(await callFlat("ghost-hunt", "advance", ctxB, { residueId: "res-b" }), "advance b");
    restartFromSnapshot();
    const progress = ok(await callFlat("ghost-hunt", "progress", ctxA, { residueId: "res-a" }), "progress");
    assert.equal(progress.stage, faced.stage);
    const hist = ok(await callFlat("ghost-hunt", "history", ctxA, {}), "history");
    assert.equal(hist.count, 1);
    assert.equal(hist.history[0].residueId, "res-a");
    assert.ok(hist.summary.lifetime.confronts === undefined || hist.summary.lifetime.wins + hist.summary.lifetime.losses >= 1);
    const other = ok(await callFlat("ghost-hunt", "progress", ctxB, {}), "other");
    assert.equal(other.hunts.some((h) => h.residueId === "res-a"), false);
    assert.equal(other.hunts.some((h) => h.residueId === "res-b"), true);
    const otherHist = ok(await callFlat("ghost-hunt", "history", ctxB, {}), "other hist");
    assert.equal(otherHist.count, 0);
    db.close();
  });
});

describe("global saved views survive a snapshot restart", () => {
  it("restores a chart view per account", () => {
    ok(call("global", "saveView", ctxA, { view: { mode: "choropleth", label: "Span map", config: { indicator: "SP.POP.TOTL" } } }), "save");
    ok(call("global", "saveView", ctxB, { view: { mode: "scatter", label: "Other map", config: {} } }), "save b");
    restartFromSnapshot();
    const views = ok(call("global", "listViews", ctxA, {}), "views");
    assert.equal(views.result.views.some((v) => v.label === "Span map"), true);
    assert.equal(views.result.views.some((v) => v.label === "Other map"), false);
    const other = ok(call("global", "listViews", ctxB, {}), "other");
    assert.equal(other.result.total, 1);
  });
});

describe("inheritance estates and notices survive a snapshot restart", () => {
  it("keeps the estate on the author and delivers the notice to the heir", () => {
    ok(call("inheritance", "add_beneficiary", ctxA, { name: "Grace", sharePct: 40, heirUserId: "user_b" }), "ben");
    ok(call("inheritance", "author_will", ctxA, { title: "Span will", body: "the bridge goes to Grace" }), "will");
    ok(call("inheritance", "add_asset", ctxA, { label: "Span deed", category: "property", valueCc: 12 }), "asset");
    ok(call("inheritance", "assign_executor", ctxA, { name: "Ada" }), "exec");
    ok(call("inheritance", "track_lock", ctxA, { npcName: "Keeper", priceCc: 3 }), "lock");
    ok(call("inheritance", "notify_heir", ctxA, { heirUserId: "user_b", message: "you are named" }), "notice");
    restartFromSnapshot();
    const bens = ok(call("inheritance", "list_beneficiaries", ctxA, {}), "bens");
    assert.equal(bens.result.beneficiaries[0].name, "Grace");
    const wills = ok(call("inheritance", "list_will_versions", ctxA, {}), "wills");
    assert.equal(wills.result.versions[0].title, "Span will");
    const assets = ok(call("inheritance", "list_assets", ctxA, {}), "assets");
    assert.equal(assets.result.assets[0].label, "Span deed");
    const execs = ok(call("inheritance", "list_executors", ctxA, {}), "execs");
    assert.equal(execs.result.executors[0].name, "Ada");
    const locks = ok(call("inheritance", "list_locks", ctxA, {}), "locks");
    assert.equal(locks.result.locks[0].npcName, "Keeper");
    const heir = ok(call("inheritance", "list_notices", ctxB, {}), "heir");
    assert.equal(heir.result.notices[0].message, "you are named");
    const authorInbox = ok(call("inheritance", "list_notices", ctxA, {}), "author inbox");
    assert.equal(authorInbox.result.notices.length, 0);
    const otherEstate = ok(call("inheritance", "list_beneficiaries", ctxB, {}), "other estate");
    assert.equal(otherEstate.result.beneficiaries.length, 0);
  });
});

describe("federation access records survive a snapshot restart", () => {
  it("restores policy, moderation, sync, relays, trust, and metrics, and omits actor keys", () => {
    ok(call("federation", "setPeerPolicy", ctxA, { domain: "peer.example", policy: "block", reason: "abuse" }), "policy");
    ok(call("federation", "reportInbound", ctxA, { sourceDomain: "spam.example", reason: "spam wave", summary: "unsolicited" }), "mod");
    ok(call("federation", "setSyncPolicy", ctxA, { domain: "sync.example", inbound: true, outbound: false, classes: ["dtu"] }), "sync");
    ok(call("federation", "subscribeRelay", ctxA, { url: "https://relay.example/inbox", name: "Relay One" }), "relay");
    ok(call("federation", "recordTrustEvent", ctxA, { domain: "trusted.example", score: 0.8, reason: "clean pull" }), "trust");
    ok(call("federation", "recordMetric", ctxA, { inbound: 4, outbound: 1, label: "hour" }), "metric");
    ok(call("federation", "registerActorKey", ctxA, {
      domain: "actor.example", keyId: "key-1", publicKey: FED_PUBLIC,
    }), "key");
    ok(call("federation", "setPeerPolicy", ctxB, { domain: "other.example", policy: "allow", reason: "friend" }), "policy b");
    const access = globalThis._concordSTATE.federation.access.get("user_a");
    access.get("peer.example").publicKey = FED_PUBLIC;
    access.get("peer.example").password = PLANTED_PASSWORD;
    globalThis._concordSTATE.meshChannels = new Map([
      ["user_a", new Map([["ch1", { name: "secret", psk: MESH_PSK }]])],
    ]);
    globalThis._concordSTATE.meshConsensusDags = new Map([
      ["user_a", { keypair: { privateKeyPem: DAG_PEM, publicKeyPem: "INC32-PUBLIC-PEM" } }],
    ]);
    const liveKeys = globalThis._concordSTATE.federation.actorKeys;
    assert.equal(liveKeys.get("user_a").get("actor.example").publicKey, FED_PUBLIC);
    const blob = restartFromSnapshot();
    const json = JSON.stringify(blob);
    assert.equal(json.includes("actorKeys"), false);
    assert.equal(json.includes(FED_PUBLIC), false);
    assert.equal(json.includes(PLANTED_PASSWORD), false);
    assert.equal(json.includes(MESH_PSK), false);
    assert.equal(json.includes(DAG_PEM), false);
    assert.equal(json.includes("privateKeyPem"), false);
    assert.equal(liveKeys.get("user_a").get("actor.example").publicKey, FED_PUBLIC);
    const policies = ok(call("federation", "listPeerPolicies", ctxA, {}), "policies");
    assert.equal(policies.result.entries.some((e) => e.domain === "peer.example" && e.policy === "block"), true);
    assert.equal(policies.result.entries.some((e) => e.domain === "other.example"), false);
    assert.equal(policies.result.entries.find((e) => e.domain === "peer.example").publicKey, undefined);
    assert.equal(policies.result.entries.find((e) => e.domain === "peer.example").password, undefined);
    const queue = ok(call("federation", "listModerationQueue", ctxA, {}), "queue");
    assert.equal(queue.result.items?.some((i) => i.reason === "spam wave") || queue.result.queue?.some((i) => i.reason === "spam wave") || queue.result.entries?.some((i) => i.reason === "spam wave"), true);
    const sync = ok(call("federation", "listSyncPolicies", ctxA, {}), "sync list");
    assert.equal(sync.result.entries.some((e) => e.domain === "sync.example" && e.outbound === false), true);
    const relays = ok(call("federation", "listRelays", ctxA, {}), "relays");
    assert.equal(relays.result.relays.some((r) => r.name === "Relay One"), true);
    const trust = ok(call("federation", "trustHistory", ctxA, { domain: "trusted.example" }), "trust list");
    const points = trust.result.points || trust.result.series || trust.result.history || [];
    assert.ok(points.length >= 1);
    const metrics = ok(call("federation", "metricsDashboard", ctxA, {}), "metrics");
    assert.equal(metrics.result.totalInbound, 4);
    assert.equal(metrics.result.series.length, 1);
    const keys = ok(call("federation", "listActorKeys", ctxA, {}), "keys");
    assert.equal(keys.result.total, 0);
    const other = ok(call("federation", "listPeerPolicies", ctxB, {}), "other policies");
    assert.equal(other.result.entries.some((e) => e.domain === "peer.example"), false);
    assert.equal(other.result.total, 1);
  });

  it("strips actorKeys and key fields from a crafted snapshot on hydrate", () => {
    ok(call("federation", "setPeerPolicy", ctxA, { domain: "peer.example", policy: "allow" }), "policy");
    const blob = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
    blob.federation.actorKeys = {
      __type: "Map",
      entries: [["user_a", { __type: "Map", entries: [["evil.example", { publicKey: FED_PUBLIC, privateKeyPem: DAG_PEM }]] }]],
    };
    const access = blob.federation.access;
    const entries = access.entries.map(([uid, inner]) => {
      if (uid !== "user_a") return [uid, inner];
      const next = {
        __type: "Map",
        entries: inner.entries.map(([domain, rec]) => [domain, { ...rec, publicKey: FED_PUBLIC, psk: MESH_PSK, password: PLANTED_PASSWORD }]),
      };
      return [uid, next];
    });
    blob.federation.access = { __type: "Map", entries };
    const next = {};
    hydrateLensState(next, blob);
    assert.equal(next.federation.actorKeys, undefined);
    const restored = next.federation.access.get("user_a").get("peer.example");
    assert.equal(restored.policy, "allow");
    assert.equal(restored.publicKey, undefined);
    assert.equal(restored.psk, undefined);
    assert.equal(restored.password, undefined);
    assert.equal(JSON.stringify(restored).includes(FED_PUBLIC), false);
    globalThis._concordSTATE = next;
    const keys = ok(call("federation", "listActorKeys", ctxA, {}), "keys");
    assert.equal(keys.result.total, 0);
    const policies = ok(call("federation", "listPeerPolicies", ctxA, {}), "policies");
    const entry = policies.result.entries.find((e) => e.domain === "peer.example");
    assert.equal(entry.policy, "allow");
    assert.equal(entry.publicKey, undefined);
    assert.equal(entry.psk, undefined);
  });
});

describe("serialize-time caps copy and do not shrink the live store", () => {
  it("keeps the tail of an append list and the head of a newest-first list", () => {
    const notary = new Map();
    const records = [];
    for (let i = 0; i < 450; i++) records.push({ id: `n-${i}`, title: `n-${i}`, contentHash: `h-${i}` });
    notary.set("user_a", records);
    notary.set("user_b", [{ id: "b-0", title: "kept", contentHash: "hb" }]);
    const timeline = new Map();
    const events = [];
    for (let i = 0; i < 600; i++) events.push({ id: `t-${i}`, label: `t-${i}` });
    timeline.set("user_a", events);
    const charts = new Map();
    for (let i = 0; i < 120; i++) charts.set(`a-${i}`, { id: `a-${i}`, owner: "user_a", title: `a-${i}` });
    charts.set("b-0", { id: "b-0", owner: "user_b", title: "b-kept" });
    globalThis._concordSTATE = { notaryRecords: notary, sentinelTimeline: timeline, societyCharts: charts };
    const blob = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
    assert.equal(records.length, 450);
    assert.equal(events.length, 600);
    assert.equal(charts.size, 121);
    const next = {};
    hydrateLensState(next, blob);
    const kept = next.notaryRecords.get("user_a");
    assert.equal(kept.length, SNAPSHOT_STORE_CAPS.notaryRecords.max);
    assert.equal(kept[0].title, "n-50");
    assert.equal(kept.at(-1).title, "n-449");
    assert.equal(next.notaryRecords.get("user_b")[0].title, "kept");
    const head = next.sentinelTimeline.get("user_a");
    assert.equal(head.length, SNAPSHOT_STORE_CAPS.sentinelTimeline.max);
    assert.equal(head[0].label, "t-0");
    assert.equal(head.at(-1).label, "t-499");
    const mine = [...next.societyCharts.values()].filter((c) => c.owner === "user_a");
    assert.equal(mine.length, SNAPSHOT_STORE_CAPS.societyCharts.max);
    assert.equal(mine.some((c) => c.id === "a-0"), false);
    assert.equal(mine.some((c) => c.id === "a-119"), true);
    assert.equal(next.societyCharts.get("b-0").title, "b-kept");
  });
});
