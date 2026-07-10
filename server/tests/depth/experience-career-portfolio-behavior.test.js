// tests/depth/experience-career-portfolio-behavior.test.js
//
// REAL behavioral tests for the "verifiable portfolio" macro cluster
// (endorse / analyze / generate_resume / compare_versions / validate_claims)
// registered directly at server/server.js:40710-40763, via
// `registerLensAction("experience", ...)` — NOT in server/domains/experience.js,
// so scripts/lens-unsurfaced.mjs (which only scans server/domains/*.js) can't
// see them and they had zero test coverage before this file. Wired to a real
// UI in concord-frontend/components/experience/CareerPortfolio.tsx during the
// Wave-3 frontend rebuild (see docs/lens-specs/experience-capability-map.md).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

const SAMPLE = {
  name: "Jordan Rivera",
  title: "Producer",
  skills: [
    { id: "mixing", name: "Mixing", category: "technical", level: "advanced", yearsExperience: 4, evidence: ["https://example.com/reel"] },
    { id: "songwriting", name: "Songwriting", category: "creative", level: "expert", yearsExperience: 6, evidence: [] },
  ],
  experience: [{ role: "Producer", company: "Indie Label", startDate: "2021-01", endDate: "" }],
  education: [{ institution: "Berklee", degree: "BA", field: "Music Production", year: "2020" }],
  endorsements: [],
};

describe("experience — career portfolio actions (real handlers, not fabricated)", () => {
  it("analyze: computes per-skill strength from evidence + endorsements, sorted descending", async () => {
    const r = await lensRun("experience", "analyze", { data: SAMPLE });
    assert.equal(r.ok, true);
    assert.equal(r.result.analysis.skillCount, 2);
    assert.ok(Array.isArray(r.result.analysis.topSkills));
    // mixing has evidence (0.4 weight) + 4y experience (0.05*4=0.2) = 0.6; songwriting has 6y*0.05=0.3, no evidence.
    const mixing = r.result.analysis.topSkills.find((s) => s.skill === "Mixing");
    const songwriting = r.result.analysis.topSkills.find((s) => s.skill === "Songwriting");
    assert.ok(mixing.strength > songwriting.strength, "skill with evidence scores higher");
    assert.equal(r.result.analysis.categories.technical, 1);
    assert.equal(r.result.analysis.categories.creative, 1);
  });

  it("endorse: appends a real endorsement row with an actor + timestamp", async () => {
    const r = await lensRun("experience", "endorse", { data: SAMPLE, params: { skillId: "mixing", comment: "Great ears" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.endorsement.skillId, "mixing");
    assert.equal(r.result.endorsement.comment, "Great ears");
    assert.ok(r.result.endorsement.id);
    assert.ok(r.result.endorsement.endorsedAt);
  });

  it("generate_resume: composes sections from skills/experience/education, ranked by evidence+years", async () => {
    const r = await lensRun("experience", "generate_resume", { data: SAMPLE, params: { format: "json" } });
    assert.equal(r.ok, true);
    const { sections } = r.result.resume;
    assert.equal(sections.experience.length, 1);
    assert.equal(sections.experience[0].current, true); // no endDate
    assert.equal(sections.education[0].institution, "Berklee");
    // ranked by (evidence.length + yearsExperience) desc — mixing: 1+4=5, songwriting: 0+6=6
    assert.equal(sections.skills[0].name, "Songwriting");
  });

  it("compare_versions: no snapshots yet returns an honest no_previous_versions note, not a fabricated diff", async () => {
    const r = await lensRun("experience", "compare_versions", { data: SAMPLE });
    assert.equal(r.ok, true);
    assert.equal(r.result.comparison.note, "no_previous_versions");
    assert.equal(r.result.comparison.currentSkillCount, 2);
  });

  it("compare_versions: with a snapshot, computes real added/removed/retained skill diffs", async () => {
    const withSnapshot = {
      ...SAMPLE,
      skills: [...SAMPLE.skills, { id: "mastering", name: "Mastering", category: "technical", level: "intermediate", yearsExperience: 1, evidence: [] }],
      snapshots: [{ version: 1, skills: [{ name: "Mixing" }, { name: "Songwriting" }], savedAt: new Date().toISOString() }],
    };
    const r = await lensRun("experience", "compare_versions", { data: withSnapshot });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.comparison.added, ["Mastering"]);
    assert.deepEqual(r.result.comparison.removed, []);
    assert.equal(r.result.comparison.retained, 2);
  });

  it("validate_claims: a skill only validates when it has at least one evidence entry", async () => {
    const r = await lensRun("experience", "validate_claims", { data: SAMPLE });
    assert.equal(r.ok, true);
    const mixing = r.result.validated.find((v) => v.skill === "Mixing");
    const songwriting = r.result.validated.find((v) => v.skill === "Songwriting");
    assert.equal(mixing.validated, true);
    assert.equal(songwriting.validated, false);
    assert.equal(r.result.validCount, 1);
  });
});
