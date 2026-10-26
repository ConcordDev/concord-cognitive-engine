// server/lib/lens-input-schemas-wave1.js
//
// Wave 1 of the shared lens input schema: money and regulated writes in
// accounting, finance, veterinary, and pharmacy. Optional fields stay
// optional so a handler default still applies when the key is omitted.
// A present bad value is refused (never coerced to 0 or to a default enum).
//
// Lat/lng/temperature/offset fields are not in this map.

const money = { type: "number", money: true };
const qty = { type: "number", qty: true };
const date = { type: "isoDate" };
const en = (values) => ({ type: "enum", enum: values });
const fkPatient = {
  type: "string",
  fk: { store: "veterinaryLens.patients", owned: true },
};

function spec(paramSchema, extra) {
  return extra ? { paramSchema, ...extra } : { paramSchema };
}

const WAVE1 = {
  accounting: {
    "employee-create": spec({
      name: { type: "string", required: true },
      rate: money,
      payType: en(["salary", "hourly"]),
    }),
    "employee-update": spec({
      rate: money,
      payType: en(["salary", "hourly"]),
    }),
    "budget-create": spec({
      name: { type: "string", required: true },
      fiscalYear: { type: "int", min: 1, max: 9999 },
    }),
    "item-create": spec({
      name: { type: "string", required: true },
      cost: money,
      price: money,
      qtyOnHand: qty,
      type: en(["service", "inventory"]),
    }),
    "item-update": spec({
      cost: money,
      price: money,
    }),
    "je-post": spec({ date }),
    "invoice-create": spec({
      dueAt: date,
      issuedAt: date,
    }),
    "bills-create": spec({ dueAt: date, issuedAt: date }),
    "tax-payment-record": spec({ amount: money, date }),
    "expenses-create": spec({ date, amount: money }),
  },
  finance: {
    "envelopes-create": spec({
      category: { type: "string", required: true },
      monthlyTarget: money,
    }),
    "bills-add": spec({
      name: { type: "string", required: true },
      amount: money,
      dueDay: { type: "int", min: 1, max: 31 },
      cadence: en(["monthly", "annual", "weekly", "biweekly"]),
    }),
    "bills-pay": spec({ amount: money }),
    "goals-create": spec({
      name: { type: "string", required: true },
      target: money,
      initialSaved: money,
      monthlyContribution: money,
      targetDate: date,
    }),
    "recurring-create": spec({
      amount: money,
      cadence: en(["weekly", "biweekly", "monthly"]),
    }),
    "rules-create": spec({
      matchKind: en(["contains", "starts_with", "regex"]),
      priority: { type: "number", min: 0 },
    }),
    "household-budget-create": spec({ monthlyTarget: money }),
  },
  veterinary: {
    "patient-add": spec({
      name: { type: "string", required: true },
      ageYears: qty,
      weightLbs: qty,
      species: en(["dog", "cat", "bird", "rabbit", "reptile", "horse", "other"]),
    }),
    "visit-log": spec({
      patientId: { ...fkPatient, required: true },
      cost: money,
      date,
    }),
    "appointment-book": spec({
      patientId: fkPatient,
      durationMin: { type: "number", min: 0 },
      date,
    }),
    "invoice-create": spec({
      taxRate: { type: "number", min: 0 },
      patientId: fkPatient,
    }),
    "inventory-add": spec({
      quantity: qty,
      reorderLevel: qty,
      unitCost: money,
      category: en(["medication", "vaccine", "supply", "food", "equipment", "other"]),
      expiryDate: date,
    }),
    "prescription-add": spec({
      patientId: fkPatient,
      durationDays: qty,
    }),
    "vaccine-record": spec({
      patientId: { ...fkPatient, required: true },
      date,
    }),
  },
  pharmacy: {
    "med-add": spec({ quantity: qty }),
    "med-update": spec({ quantity: qty }),
    "coupon-save": spec({ discountedPrice: money }),
    "dose-log": spec({ date }),
    "appointment-add": spec({
      dateTime: { type: "isoDate", required: true },
    }),
    "measurement-log": spec({ date }),
    "caregiver-add": spec({
      name: { type: "string", required: true },
      // Handler stores this as a boolean (`=== true`). The sweep sent a
      // date-like "whenever"; that is expected_boolean, not a calendar date.
      notifyOnRefillDue: { type: "boolean" },
      missedThreshold: { type: "int", min: 1, max: 10 },
    }),
  },
};

export function wave1Spec(domain, action) {
  return WAVE1[domain]?.[action] || null;
}

/**
 * Wrap a domain's registerLensAction so wave-1 actions carry a spec.
 * An explicit spec passed by the caller (paramSchema or nonEmptyCreate) wins.
 */
export function bindWave1(register) {
  return function registerWithWave1(domain, action, handler, explicit) {
    const hasExplicit = explicit && typeof explicit === "object"
      && (explicit.paramSchema || explicit.nonEmptyCreate);
    const attached = hasExplicit ? explicit : (wave1Spec(domain, action) || explicit);
    return register(domain, action, handler, attached);
  };
}
