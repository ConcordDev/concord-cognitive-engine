// INC-147: saved.export CSV wrote formula-leading cells (=, +, -, @) verbatim, so a
// saved title like "=HYPERLINK(...)" ran as a formula when the export was opened in
// Excel/Sheets. Live repro r0352 (2026-10-19): title "=1+1" exported as "=1+1".
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSavedMacros from "../domains/saved.js";

const ACTIONS = new Map();
const register = (d, n, fn) => ACTIONS.set(`${d}.${n}`, fn);
const call = (n, ctx, input = {}) => ACTIONS.get(`saved.${n}`)(ctx, input);
const ctx = { actor: { userId: "user_csv" }, userId: "user_csv" };

before(() => registerSavedMacros(register));
beforeEach(() => { globalThis._concordSTATE = {}; });

describe("INC-147 saved CSV export", () => {
  it("prefixes formula-leading cells with a quote", () => {
    call("add", ctx, { title: "=HYPERLINK(\"http://evil\",\"x\")", note: "@SUM(A1)" });
    call("add", ctx, { title: "+1", note: "-2" });
    const r = call("export", ctx, { format: "csv" });
    assert.equal(r.ok, true);
    const body = r.result.content.split("\n").slice(1).join("\n");
    assert.doesNotMatch(body, /(^|,)"[=+\-@]/m, body);
    assert.match(body, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/);
    assert.match(body, /"'@SUM\(A1\)"/);
  });
  it("leaves ordinary cells unchanged", () => {
    call("add", ctx, { title: "Plain title", note: "a - b" });
    const r = call("export", ctx, { format: "csv" });
    assert.match(r.result.content, /"Plain title"/);
    assert.match(r.result.content, /"a - b"/);
  });
});
