import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classroomRecordRefusal, classroomSaveMessage } from "./classroom-record.ts";

describe("classroom record save", () => {
  it("names Title when the title is blank", () => {
    assert.equal(classroomRecordRefusal("   "), "Title is required.");
    assert.equal(classroomRecordRefusal(""), "Title is required.");
  });

  it("lets a titled course, lesson plan, or quiz through", () => {
    assert.equal(classroomRecordRefusal("PR2EDU-PROBE-1101"), null);
    assert.equal(classroomRecordRefusal("Week 1 plan"), null);
    assert.equal(classroomRecordRefusal("Chapter check"), null);
  });

  it("keeps a server sentence that names the field", () => {
    const err = new Error('Invalid status "nope" for domain "education". Valid statuses: enrolled');
    assert.match(classroomSaveMessage(err), /status/);
    assert.equal(classroomSaveMessage(new Error("validation_failed")), "Could not save this record. Check the fields and try again.");
  });
});
