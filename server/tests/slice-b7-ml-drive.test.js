// Slice B7 drive — FIX-ml-002 automl-run record truth (server/domains/ml.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMlActions from "../domains/ml.js";

const actions = new Map();
registerMlActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`ml:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "ml", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("automl-run records a named configuration run — trees are not epochs", () => {
  const ds = call("dataset-register", { name: "churn", samples: 2000, features: 12 });
  assert.equal(ds.ok, true);
  const dsId = ds.result.dataset.id;

  const run = call("automl-run", { templateId: "tabular-classification", datasetId: dsId, name: "Churn baseline" });
  assert.equal(run.ok, true);

  const list = call("experiment-list", {});
  const exp = list.result.experiments.find((e) => e.id === run.result.run.experimentId);
  assert.ok(exp, "tracked experiment exists");
  assert.equal(exp.name, "Churn baseline");
  assert.equal(exp.kind, "automl-config");
  assert.equal(exp.hyperparams.epochs, 0);
  assert.equal(exp.hyperparams.nEstimators, 200);
  assert.equal(exp.metrics.length, 0);

  // Unnamed runs keep the auto-name.
  const run2 = call("automl-run", { templateId: "tabular-classification", datasetId: dsId });
  const exp2 = call("experiment-list", {}).result.experiments.find((e) => e.id === run2.result.run.experimentId);
  assert.match(exp2.name, /AutoML · Tabular Classification · churn/);
});
