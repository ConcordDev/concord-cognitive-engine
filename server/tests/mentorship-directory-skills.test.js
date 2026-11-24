// FIX-mentorship-008 residual: the mentor directory's aggregate skills
// list (which feeds the public "Filter by skill" dropdown) must not carry
// QA-harness fixture skills. Harness profiles stay listed and labelled
// (FIX-mentorship-008's accepted cure) — only the unlabelled aggregate
// list is in scope here.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerMentorshipActions from "../domains/mentorship.js";

const actions = new Map();
registerMentorshipActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));

function seedState() {
  const mentors = new Map();
  mentors.set("u-real", {
    id: "u-real", name: "Rosa Alvarez", headline: "Career coach",
    bio: "Ten years in product.", skills: ["carpentry", "mentoring"],
    experienceYears: 10, availability: "weekly", capacity: 3, menteeCount: 1,
    rating: 4.9, reviewCount: 12, listed: true,
  });
  mentors.set("u-qa", {
    id: "u-qa", name: "QA mentor smtmv820475", headline: "QA bio smtmv820475",
    bio: "QA bio smtmv820475 is the only mentor acctl may request.",
    skills: ["tz1026220427mi", "qa-harnessing", "carpentry"],
    experienceYears: 1, availability: "weekly", capacity: 3, menteeCount: 0,
    rating: 5, reviewCount: 1, listed: true,
  });
  globalThis._concordSTATE = { mentorshipLens: { mentors } };
}

const ctx = { actor: { userId: "u-seeker" } };

test("directory skills list carries no harness fixture skills", () => {
  seedState();
  const out = actions.get("mentorship.mentor-directory")(ctx, {}, {});
  assert.equal(out.ok, true);
  const skills = out.result.skills;
  assert.ok(!skills.includes("tz1026220427mi"), "tz-token skill leaked into the filter list");
  assert.ok(!skills.includes("qa-harnessing"), "skill unique to the harness profile leaked");
});

test("real mentors' skills still feed the filter list", () => {
  seedState();
  const out = actions.get("mentorship.mentor-directory")(ctx, {}, {});
  assert.ok(out.result.skills.includes("carpentry"));
  assert.ok(out.result.skills.includes("mentoring"));
});

test("harness profile stays listed and labelled sample (FIX-mentorship-008 cure untouched)", () => {
  seedState();
  const out = actions.get("mentorship.mentor-directory")(ctx, {}, {});
  const qa = out.result.mentors.find((m) => m.id === "u-qa");
  assert.ok(qa, "harness profile should remain listed");
  assert.equal(qa.sample, true);
  const real = out.result.mentors.find((m) => m.id === "u-real");
  assert.equal(real.sample, false);
});
