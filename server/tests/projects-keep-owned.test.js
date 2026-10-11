// A created project is still listed for its owner, and Keep stores it as a
// private DTU that only that owner can read back.
//
// node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/projects-keep-owned.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load, lensRun } from "./depth/_harness.js";

const ME = "projects-keep-owner";
const OTHER = "projects-keep-other";

function fakeReq(id) {
  return {
    user: { id, role: "member" },
    ip: "127.0.0.1",
    method: "POST",
    path: "/api/lens/run",
    headers: {},
    query: {},
    get: () => "",
  };
}

describe("projects create persists and keep is a private DTU owned by the caller", () => {
  let makeCtx;

  before(async () => {
    ({ makeCtx } = await load());
  });

  it("lists the project after create, and another member cannot read the kept DTU", async () => {
    const me = makeCtx(fakeReq(ME));
    const other = makeCtx(fakeReq(OTHER));

    const created = await lensRun("projects", "project-create", {
      params: { name: "Bridge", key: "BR" },
    }, me);
    assert.equal(created.ok, true, JSON.stringify(created));
    const project = created.result.project;
    assert.equal(project.name, "Bridge");
    assert.equal(project.key, "BR");
    assert.ok(project.id);

    const listed = await lensRun("projects", "project-list", { params: {} }, me);
    assert.equal(listed.ok, true);
    const mine = (listed.result.projects || []).find((p) => p.id === project.id);
    assert.ok(mine, "project-list must still return the project");
    assert.equal(mine.name, "Bridge");
    assert.equal(mine.key, "BR");

    const stranger = await lensRun("projects", "project-list", { params: {} }, other);
    const seen = (stranger.result.projects || []).some((p) => p.id === project.id);
    assert.equal(seen, false);

    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: "BR Bridge",
        tags: ["projects", "project"],
        source: "projects-lens:project",
        visibility: "private",
        skipAutoTag: true,
        human: { summary: "BR Bridge\n\nProject ID: " + project.id + "\nName: Bridge\nKey: BR" },
        core: { definitions: ["BR Bridge"], claims: ["Bridge is a private project record."] },
        machine: {
          kind: "projects_project",
          projectId: project.id,
          name: project.name,
          key: project.key,
        },
        meta: {
          visibility: "private",
          consent: { allowCitations: false },
          createdFrom: "projects",
          skipAutoTag: true,
        },
      },
    }, me);
    assert.equal(dtuCreated.ok, true, JSON.stringify(dtuCreated));
    const stored = dtuCreated.result;
    assert.equal(stored.ok, true, JSON.stringify(stored));
    const dtu = stored.dtu;
    assert.ok(dtu.id);
    assert.equal(dtu.visibility, "private");
    assert.equal(dtu.ownerId, ME);

    const readMine = await lensRun("dtu", "get", { params: { id: dtu.id } }, me);
    assert.equal(readMine.result.ok, true, JSON.stringify(readMine));
    assert.equal(readMine.result.dtu.id, dtu.id);
    assert.equal(readMine.result.dtu.ownerId, ME);
    assert.equal(readMine.result.dtu.visibility, "private");

    const readOther = await lensRun("dtu", "get", { params: { id: dtu.id } }, other);
    assert.equal(readOther.result.ok, false);
    assert.equal(readOther.result.error, "DTU not found");
    assert.equal(readOther.result.dtu, undefined);
  });
});
