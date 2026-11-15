import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveMeshSendDtu } from "../lib/mesh-send-dtu.js";

describe("resolveMeshSendDtu", () => {
  it("sends a DTU that exists only in the caller's local universe", () => {
    const local = new Map([["dtu_local", { id: "dtu_local", title: "mine", ownerId: "u1" }]]);
    const r = resolveMeshSendDtu({
      stateDtus: new Map(),
      localDtus: local,
      dtuId: "dtu_local",
      inlineDtu: null,
      userId: "u1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.dtu.id, "dtu_local");
  });

  it("still refuses another person's private DTU from the shared store", () => {
    const state = new Map([["dtu_x", { id: "dtu_x", ownerId: "u1", visibility: "private" }]]);
    const r = resolveMeshSendDtu({
      stateDtus: state,
      localDtus: new Map(),
      dtuId: "dtu_x",
      inlineDtu: null,
      userId: "u2",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_your_dtu");
  });

  it("names the missing id when neither store has it", () => {
    const r = resolveMeshSendDtu({
      stateDtus: new Map(),
      localDtus: new Map(),
      dtuId: "missing",
      inlineDtu: null,
      userId: "u1",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /No DTU specified/);
  });
});
