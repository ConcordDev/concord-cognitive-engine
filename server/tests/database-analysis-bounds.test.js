// S8 (Database rework, PR #1716): the analysis quartet answers to
// direct panel input (params.input) as well as artifacts, and the F13
// execution bounds are real — a 1000-row result cap with an honest
// truncation flag, and a join scan budget that aborts runaway joins.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params, artifact) => handlers.get(`database.${action}`)(ctx, artifact || null, params || {});
const CTX = { actor: { userId: "u-analysis" } };
let connId;

function csvFor(prefix, n) {
  const lines = ["id,v"];
  for (let i = 1; i <= n; i++) lines.push(`${i},${prefix}${i}`);
  return lines.join("\n");
}

describe("S8 — analysis quartet inputs + execution bounds", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "An", readOnly: false }).result.connection.id;
    run("dataset-import-csv", CTX, { connectionId: connId, name: "big", csv: csvFor("r", 1500) });
    run("dataset-import-csv", CTX, { connectionId: connId, name: "big2", csv: csvFor("s", 1500) });
  });

  it("schemaAnalysis answers panel input (params.input) and flags a missing PK honestly", () => {
    const r = run("schemaAnalysis", CTX, { input: { tables: [{ name: "t", columns: [{ name: "a", type: "text" }, { name: "b", type: "text" }, { name: "c", type: "text" }, { name: "d", type: "text" }] }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.tables[0].hasPrimaryKey, false);
    assert.ok(r.result.tables[0].issues.includes("Missing primary key"));
  });

  it("queryOptimize grades a SELECT * with no LIMIT", () => {
    const r = run("queryOptimize", CTX, { input: { query: "SELECT * FROM books" } });
    assert.equal(r.ok, true);
    assert.ok(r.result.issues.some((i) => /SELECT \*/.test(i.issue)));
  });

  it("migrationPlan marks a drop high-risk with the backup recommendation", () => {
    const r = run("migrationPlan", CTX, { input: { changes: [{ type: "drop", table: "books", column: "isbn" }] } });
    assert.equal(r.result.highRiskChanges, 1);
    assert.match(r.result.recommendation, /backup/i);
  });

  it("indexRecommendation derives columns from real queries", () => {
    const r = run("indexRecommendation", CTX, { input: { tables: [], queries: ["SELECT * FROM books WHERE author = 'x' ORDER BY title"] } });
    const cols = r.result.recommendations.map((x) => x.column);
    assert.ok(cols.includes("author"));
    assert.ok(cols.includes("title"));
  });

  it("SELECT past 1000 rows is capped with the truncation flag, count stays honest", () => {
    const r = run("query-run", CTX, { connectionId: connId, sql: "SELECT * FROM big" });
    assert.equal(r.result.success, true);
    assert.equal(r.result.rows.length, 1000);
    assert.equal(r.result.rowCount, 1500);
    assert.equal(r.result.truncated, true);
    assert.equal(r.result.cap, 1000);
  });

  it("a runaway join on the nested-loop path aborts on the scan budget", () => {
    // Bare `v = v` is ambiguous (both tables have v) so it takes the
    // nested loop; big.v is r1..r1500 and big2.v is s1..s1500 — zero
    // matches, so the loop would visit all 2.25M pairs unbounded.
    const r = run("query-run", CTX, { connectionId: connId, sql: "SELECT * FROM big JOIN big2 ON v = v" });
    assert.equal(r.result.success, false);
    assert.match(r.result.error, /visit budget/);
  });

  it("a matching join under the budget completes normally", () => {
    const r = run("query-run", CTX, { connectionId: connId, sql: "SELECT COUNT(*) FROM big JOIN big2 ON big.id = big2.id" });
    assert.equal(r.result.success, true);
    assert.equal(r.result.rows[0].count, 1500);
  });
});
