import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerVet from "../domains/veterinary.js";
import registerPharmacy from "../domains/pharmacy.js";
import registerEco from "../domains/eco.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerVet(register);
  registerPharmacy(register);
  registerEco(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("clinic and pharmacy records can be corrected", () => {
  it("voids an unpaid invoice and discontinues a prescription, and a patient delete takes both", () => {
    const patient = call("veterinary", "patient-add", { name: "Mochi", species: "cat" });
    assert.equal(patient.ok, true);
    const id = patient.result.patient.id;
    const invoice = call("veterinary", "invoice-create", {
      patientId: id, patientName: "Mochi", lineItems: [{ description: "Exam", qty: 1, unitPrice: 40 }],
    });
    const rx = call("veterinary", "prescription-add", { patientId: id, drug: "Apoquel" });
    const removed = call("veterinary", "invoice-void", { id: invoice.result.invoice.id });
    assert.equal(removed.result.deleted, invoice.result.invoice.id);
    const stopped = call("veterinary", "prescription-discontinue", { id: rx.result.prescription.id });
    assert.equal(stopped.result.prescription.status, "discontinued");
    const again = call("veterinary", "invoice-create", {
      patientId: id, patientName: "Mochi", lineItems: [{ description: "Exam", qty: 1, unitPrice: 20 }],
    });
    call("veterinary", "patient-delete", { id });
    assert.equal(call("veterinary", "invoice-list", {}).result.count, 0);
    assert.equal(again.ok, true);
  });

  it("removes a price quote, undoes a taken dose, and deletes a journal note", () => {
    const med = call("pharmacy", "med-add", { name: "Ibuprofen" });
    assert.equal(med.ok, true);
    const medId = med.result.medication?.id || med.result.med?.id || med.result.id;
    const logged = call("pharmacy", "dose-log", { medId, status: "taken", scheduledTime: "08:00" });
    assert.equal(logged.ok, true);
    const undone = call("pharmacy", "dose-undo", { medId, scheduledTime: "08:00" });
    assert.equal(undone.ok, true);
    const price = call("pharmacy", "price-record", { drugName: "Ibuprofen", pharmacyName: "Corner", cashPrice: 8 });
    assert.equal(call("pharmacy", "price-delete", { id: price.result.price.id }).ok, true);
    const note = call("pharmacy", "journal-add", { note: "Slept well" });
    assert.equal(call("pharmacy", "journal-delete", { id: note.result.entry.id }).ok, true);
    assert.equal(call("pharmacy", "journal-list", {}).result.count, 0);
  });

  it("renames a footprint snapshot", () => {
    const saved = call("eco", "footprint-record", { totalKgCO2e: 12, label: "March" });
    const updated = call("eco", "footprint-update", { id: saved.result.entry.id, label: "March revised" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.entry.label, "March revised");
  });
});
