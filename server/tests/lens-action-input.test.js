/**
 * Shared lens input validator — schema language, dispatch hook, wave 1
 * (accounting, finance, veterinary, pharmacy).
 *
 * Run: NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs tests/lens-action-input.test.js
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  validateParamSchema,
  validateLensActionInput,
  isRealCalendarDate,
} from "../lib/macro-param-schema.js";
import { invokeLensHandler, invalidInputFromThrow, handlerFailure } from "../lib/lens-action-dispatch.js";
import { httpStatusForLensFailure } from "../lib/lens-run-http.js";
import { bindWave1 } from "../lib/lens-input-schemas-wave1.js";
import registerAccountingActions from "../domains/accounting.js";
import registerFinanceActions from "../domains/finance.js";
import registerVeterinaryActions from "../domains/veterinary.js";
import registerPharmacyActions from "../domains/pharmacy.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadDomains() {
  const actions = new Map();
  const specs = new Map();
  const register = (domain, action, handler, spec) => {
    actions.set(`${domain}.${action}`, handler);
    if (spec && (spec.paramSchema || spec.nonEmptyCreate)) specs.set(`${domain}.${action}`, spec);
  };
  const wrapped = bindWave1(register);
  registerAccountingActions(wrapped);
  registerFinanceActions(wrapped);
  registerVeterinaryActions(wrapped);
  registerPharmacyActions(wrapped);
  return { actions, specs };
}

const { actions, specs } = loadDomains();

function ctxFor(userId) {
  return { actor: { userId }, userId, state: globalThis._concordSTATE };
}

async function run(domain, action, params, userId = "user_a") {
  const key = `${domain}.${action}`;
  const handler = actions.get(key);
  assert.ok(handler, `registered ${key}`);
  const artifact = { id: null, domain, type: "domain_action", data: params, meta: {} };
  return invokeLensHandler(handler, ctxFor(userId), artifact, params, specs.get(key) || null);
}

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("schema language", () => {
  test("existing Gate D reasons are unchanged", () => {
    const r = validateParamSchema(
      { count: { type: "number", min: 1, max: 100 }, mode: { type: "string", enum: ["a", "b"] }, s: { type: "string", maxLength: 3 } },
      { count: 0, mode: "c", s: "toolong" },
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors.map((e) => e.reason), ["min_1", "enum:a|b", "maxLength_3"]);
  });

  test("money and qty default to min 0; lat and temperature stay negative-legal", () => {
    assert.equal(validateParamSchema({ amount: { type: "number", money: true } }, { amount: -5 }).errors[0].reason, "min_0");
    assert.equal(validateParamSchema({ qty: { type: "int", qty: true } }, { qty: -1 }).errors[0].reason, "min_0");
    assert.equal(validateParamSchema({ lat: { type: "number", min: -90, max: 90 } }, { lat: -5 }).ok, true);
    assert.equal(validateParamSchema({ celsius: { type: "number" } }, { celsius: -5 }).ok, true);
    assert.equal(validateParamSchema({ amount: { type: "number", money: true } }, { amount: "abc" }).errors[0].reason, "expected_number");
  });

  test("isoDate refuses impossible days and non-dates", () => {
    assert.equal(isRealCalendarDate("whenever"), false);
    assert.equal(isRealCalendarDate("2026-13-45"), false);
    assert.equal(isRealCalendarDate("2026-02-31"), false);
    assert.equal(isRealCalendarDate("not-a-date"), false);
    assert.equal(isRealCalendarDate("2026-10-26"), true);
    assert.equal(isRealCalendarDate("2026-10-26T15:04:00Z"), true);
    const bad = validateLensActionInput({ paramSchema: { dueAt: { type: "isoDate" } } }, { dueAt: "2026-13-45" });
    assert.equal(bad.reason, "expected_isoDate");
    assert.equal(bad.error, "invalid_input");
    assert.equal("stack" in bad, false);
  });

  test("enum type refuses and does not coerce", () => {
    const bad = validateLensActionInput(
      { paramSchema: { payType: { type: "enum", enum: ["salary", "hourly"] } } },
      { payType: "zz_bogus" },
    );
    assert.equal(bad.reason, "unknown_enum");
    assert.equal(bad.field, "payType");
  });

  test("url is http or https only", () => {
    assert.equal(validateParamSchema({ site: { type: "url" } }, { site: "javascript:alert(1)" }).ok, false);
    assert.equal(validateParamSchema({ site: { type: "url" } }, { site: "https://concord-os.org/a" }).ok, true);
  });

  test("nonEmptyCreate refuses {}", () => {
    const bad = validateLensActionInput({ paramSchema: {}, nonEmptyCreate: true }, {});
    assert.deepEqual(bad, { ok: false, error: "invalid_input", field: null, reason: "empty_create" });
    assert.equal(validateLensActionInput({ paramSchema: {}, nonEmptyCreate: true }, { name: "Operating" }), null);
  });

  test("fk owned requires the caller's own parent row", () => {
    globalThis._concordSTATE = {
      veterinaryLens: {
        patients: new Map([
          ["user_a", [{ id: "pat_a" }]],
          ["user_b", [{ id: "pat_b" }]],
        ]),
      },
    };
    const schema = { patientId: { type: "string", fk: { store: "veterinaryLens.patients", owned: true } } };
    const ctxA = { actor: { userId: "user_a" }, state: globalThis._concordSTATE };
    assert.equal(validateParamSchema(schema, { patientId: "pat_a" }, ctxA).ok, true);
    assert.equal(validateParamSchema(schema, { patientId: "pat_b" }, ctxA).errors[0].reason, "fk_not_found");
    assert.equal(validateParamSchema(schema, { patientId: "missing" }, ctxA).errors[0].reason, "fk_not_found");
    const ctxAdmin = { actor: { userId: "admin_1", role: "admin" }, state: globalThis._concordSTATE };
    assert.equal(validateParamSchema(schema, { patientId: "pat_b" }, ctxAdmin).ok, true);
  });

  test("a flat owned array uses requireOwner", () => {
    const schema = { parentId: { type: "string", fk: { store: "rows", owned: true } } };
    const state = { rows: [{ id: "r1", userId: "user_a" }] };
    assert.equal(validateParamSchema(schema, { parentId: "r1" }, { actor: { userId: "user_a" }, state }).ok, true);
    assert.equal(
      validateParamSchema(schema, { parentId: "r1" }, { actor: { userId: "user_b" }, state }).errors[0].reason,
      "fk_not_owned",
    );
  });
});

describe("dispatch", () => {
  test("TypeError from .map becomes invalid_input with no stack", async () => {
    const handler = (_ctx, _artifact, input) => input.rows.map((x) => x);
    const out = await invokeLensHandler(handler, ctxFor("user_a"), {}, { rows: "nope" }, null);
    assert.equal(out.ok, false);
    assert.equal(out.error, "invalid_input");
    assert.equal(out.reason, "not_a_function");
    assert.equal(out.stack, undefined);
    assert.equal(out.message, undefined);
    assert.equal(invalidInputFromThrow(new Error("nope")), null);
    const sliceMap = handlerFailure(new TypeError("(opts.behavior || []).slice.map is not a function or its return value is not iterable"));
    assert.equal(sliceMap.error, "invalid_input");
    assert.equal(sliceMap.reason, "not_a_function");
    assert.equal(sliceMap.message, undefined);
    const time = handlerFailure(new RangeError("Invalid time value"));
    assert.equal(time.error, "invalid_input");
    assert.equal(time.reason, "invalid_time");
    assert.equal(time.message, undefined);
    const other = handlerFailure(new Error("disk full"));
    assert.equal(other.error, "handler_error");
    assert.match(other.message, /disk full/);
    assert.equal(httpStatusForLensFailure("invalid_input"), 400);
    assert.equal(httpStatusForLensFailure("invalid_status"), 422);
    assert.equal(httpStatusForLensFailure("invalid_transition"), 422);
  });

  test("server dispatch and MCP mirror call the validator before the handler", () => {
    const serverSrc = readFileSync(join(here, "../server.js"), "utf8");
    const mcpSrc = readFileSync(join(here, "../lib/mcp-execution-bridge.js"), "utf8");
    assert.match(serverSrc, /function registerLensAction\(domain, action, handler, spec\)/);
    assert.match(serverSrc, /rememberLensActionSpec\(`\$\{domain\}\.\$\{action\}`, spec\)/);
    assert.ok((serverSrc.match(/invokeLensHandler\(/g) || []).length >= 4);
    assert.match(mcpSrc, /invokeLensHandler\(resolved\.handler/);
  });
});

describe("wave 1 sweep cases", () => {
  const cases = [
    ["accounting", "employee-create", { name: "Ada", rate: 20, payType: "hourly" }, [
      ["rate", -5, "min_0"],
      ["rate", "abc", "expected_number"],
      ["payType", "zz_bogus", "unknown_enum"],
    ]],
    ["accounting", "budget-create", { name: "FY", fiscalYear: 2026 }, [
      ["fiscalYear", -5, "min_1"],
      ["fiscalYear", "abc", "expected_int"],
    ]],
    ["accounting", "item-create", { name: "Bolt", cost: 1, price: 2, qtyOnHand: 3, type: "inventory" }, [
      ["cost", -5, "min_0"],
      ["price", "abc", "expected_number"],
      ["qtyOnHand", -5, "min_0"],
      ["type", "zz_bogus", "unknown_enum"],
    ]],
    ["accounting", "je-post", { date: "2026-10-26", lines: [] }, [
      ["date", "whenever", "expected_isoDate"],
      ["date", "2026-13-45", "expected_isoDate"],
    ]],
    ["accounting", "invoice-create", { customerName: "Ada", total: 10, dueAt: "2026-11-01", issuedAt: "2026-10-01" }, [
      ["dueAt", "not-a-date", "expected_isoDate"],
    ]],
    ["accounting", "tax-payment-record", { amount: 12, date: "2026-10-26" }, [
      ["amount", -5, "min_0"],
      ["amount", "abc", "expected_number"],
    ]],
    ["finance", "envelopes-create", { category: "Food", monthlyTarget: 400 }, [
      ["monthlyTarget", -5, "min_0"],
      ["monthlyTarget", "abc", "expected_number"],
    ]],
    ["finance", "bills-add", { name: "Rent", amount: 900, dueDay: 1, cadence: "monthly" }, [
      ["amount", -5, "min_0"],
      ["amount", "abc", "expected_number"],
      ["dueDay", -5, "min_1"],
      ["cadence", "zz_bogus", "unknown_enum"],
    ]],
    ["finance", "bills-pay", { id: "missing", amount: 10 }, [
      ["amount", -50, "min_0"],
    ]],
    ["finance", "goals-create", { name: "Trip", target: 1000, initialSaved: 10, monthlyContribution: 50, targetDate: "2027-01-01" }, [
      ["target", -5, "min_0"],
      ["initialSaved", "abc", "expected_number"],
      ["monthlyContribution", -5, "min_0"],
      ["targetDate", "whenever", "expected_isoDate"],
    ]],
    ["finance", "rules-create", { matchText: "uber", category: "Transport", matchKind: "contains", priority: 10 }, [
      ["matchKind", "zz_bogus", "unknown_enum"],
      ["priority", -5, "min_0"],
      ["priority", "abc", "expected_number"],
    ]],
    ["veterinary", "patient-add", { name: "Miso", ageYears: 4, weightLbs: 12, species: "cat" }, [
      ["ageYears", -5, "min_0"],
      ["weightLbs", "abc", "expected_number"],
      ["species", "zz_bogus", "unknown_enum"],
    ]],
    ["veterinary", "inventory-add", { name: "Gauze", quantity: 4, reorderLevel: 1, unitCost: 2, category: "supply", expiryDate: "2027-01-01" }, [
      ["quantity", -5, "min_0"],
      ["unitCost", -5, "min_0"],
      ["reorderLevel", "abc", "expected_number"],
      ["category", "zz_bogus", "unknown_enum"],
      ["expiryDate", "whenever", "expected_isoDate"],
    ]],
    ["pharmacy", "med-add", { name: "Ibuprofen", quantity: 30 }, [
      ["quantity", -5, "min_0"],
      ["quantity", "abc", "expected_number"],
    ]],
    ["pharmacy", "coupon-save", { drugName: "Ibuprofen", discountedPrice: 4 }, [
      ["discountedPrice", -5, "min_0"],
      ["discountedPrice", "abc", "expected_number"],
    ]],
    ["pharmacy", "appointment-add", { providerName: "Ada", dateTime: "2026-10-26T15:00:00Z" }, [
      ["dateTime", "whenever", "expected_isoDate"],
    ]],
    ["pharmacy", "caregiver-add", { name: "Kai", notifyOnRefillDue: true, missedThreshold: 2 }, [
      ["notifyOnRefillDue", "whenever", "expected_boolean"],
      ["missedThreshold", -5, "min_1"],
      ["missedThreshold", "abc", "expected_int"],
    ]],
    ["pharmacy", "measurement-log", { kind: "weight", value: 70, date: "2026-10-26" }, [
      ["date", "whenever", "expected_isoDate"],
    ]],
  ];

  for (const [domain, action, good, bads] of cases) {
    test(`${domain}.${action} accepts a real body and refuses sweep junk`, async () => {
      const ok = await run(domain, action, good);
      assert.notEqual(ok.error, "invalid_input", JSON.stringify(ok));
      for (const [field, value, reason] of bads) {
        const bad = await run(domain, action, { ...good, [field]: value });
        assert.equal(bad.ok, false, `${field}=${value} should refuse`);
        assert.equal(bad.error, "invalid_input");
        assert.equal(bad.field, field);
        assert.equal(bad.reason, reason, `${domain}.${action} ${field}`);
        assert.equal(bad.stack, undefined);
      }
    });
  }

  test("veterinary visit-log refuses another user's patient and a nonsense date", async () => {
    const created = await run("veterinary", "patient-add", { name: "Miso", species: "cat", ageYears: 2, weightLbs: 9 });
    assert.equal(created.ok, true, JSON.stringify(created));
    const patientId = created.result.patient.id;
    const mine = await run("veterinary", "visit-log", { patientId, cost: 40, date: "2026-10-01" });
    assert.equal(mine.ok, true, JSON.stringify(mine));
    const stolen = await run("veterinary", "visit-log", { patientId, cost: 40, date: "2026-10-01" }, "user_b");
    assert.equal(stolen.error, "invalid_input");
    assert.equal(stolen.field, "patientId");
    assert.equal(stolen.reason, "fk_not_found");
    const dated = await run("veterinary", "visit-log", { patientId, cost: -5, date: "whenever" });
    assert.equal(dated.reason, "min_0");
    assert.equal(dated.field, "cost");
  });

  test("valid finance and pharmacy writes still persist", async () => {
    const bill = await run("finance", "bills-add", { name: "Rent", amount: 900, dueDay: 1, cadence: "monthly" });
    assert.equal(bill.ok, true, JSON.stringify(bill));
    assert.equal(bill.result.bill.amount, 900);
    const med = await run("pharmacy", "med-add", { name: "Ibuprofen", quantity: 30 });
    assert.equal(med.ok, true, JSON.stringify(med));
    assert.equal(med.result.medication.quantity, 30);
  });
});
