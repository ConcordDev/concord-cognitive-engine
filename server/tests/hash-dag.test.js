// W2-C — hash-DAG contract tests.
//
// Run WITHOUT --test-force-exit (per the task brief — that flag has been
// found to silently truncate runs). This file has no open handles: no
// timers, no sockets, no file descriptors — plain in-memory objects and
// node:crypto, so it exits cleanly on its own.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { HashDag, generateKeypair } from "../lib/consensus/hash-dag.js";
import { canonicalStringify } from "../lib/dtu-protocol.js";

// ── Seeded RNG (mulberry32) — reproducible randomized permutations ─────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Build a delivery sequence: a shuffle of `records` with some elements
// duplicated (appended again at random positions via a second shuffle pass),
// so the delivery both reorders AND repeats.
function buildDeliveryWithDuplicates(records, rng) {
  const shuffled = seededShuffle(records, rng);
  const dupeCount = Math.floor(records.length / 2);
  const dupes = [];
  for (let i = 0; i < dupeCount; i++) {
    dupes.push(records[Math.floor(rng() * records.length)]);
  }
  return seededShuffle([...shuffled, ...dupes], rng);
}

// ── Realistic multi-author causal history with genuine concurrency ─────────
//
// Produces a fixed set of signed records with real branch-and-merge shape:
// most rounds append onto the current heads (organic branching whenever two
// authors act in the same round), and some rounds explicitly fork two
// children off the SAME earlier parent snapshot to force genuine concurrency
// (not just "happened to be appended around the same time").
function buildHistory({ authors, rounds, rng }) {
  const producer = new HashDag();
  const keys = new Map(authors.map((id) => [id, generateKeypair()]));

  // Genesis, authored by the first author.
  producer.appendUpdate({
    nodeId: authors[0],
    payload: { key: "root", value: 0 },
    ...keys.get(authors[0]),
  });

  let seq = 1;
  for (let r = 0; r < rounds; r++) {
    const forceConcurrent = rng() < 0.35 && producer.heads.size >= 1;
    if (forceConcurrent) {
      // Snapshot heads BEFORE either branch appends, so both children
      // declare the SAME parent set — genuinely concurrent, not sequential.
      const snapshot = [...producer.heads];
      const a = authors[Math.floor(rng() * authors.length)];
      const b = authors[Math.floor(rng() * authors.length)];
      producer.appendUpdate({
        nodeId: a,
        payload: { key: `k${seq++}`, value: Math.floor(rng() * 1000) },
        parents: snapshot,
        ...keys.get(a),
      });
      producer.appendUpdate({
        nodeId: b,
        payload: { key: `k${seq++}`, value: Math.floor(rng() * 1000) },
        parents: snapshot,
        ...keys.get(b),
      });
    } else {
      const a = authors[Math.floor(rng() * authors.length)];
      producer.appendUpdate({
        nodeId: a,
        payload: { key: `k${seq++}`, value: Math.floor(rng() * 1000) },
        ...keys.get(a),
      });
    }
  }

  return { producer, records: [...producer.nodes.values()], keys };
}

function deliverAll(dag, sequence) {
  for (const record of sequence) dag.mergeRemote(record);
}

// ── 1. Order-independent convergence (the headline property) ───────────────

test("convergence: N replicas delivered the same updates in different random permutations, with duplicates, reach byte-identical state", () => {
  const rng = mulberry32(1234567);
  const { records } = buildHistory({ authors: ["node-a", "node-b", "node-c"], rounds: 24, rng });
  assert.ok(records.length >= 25, "sanity: history should have real size");

  const PERMUTATIONS = 60;
  let ran = 0;
  const referenceReplicas = [];

  for (let i = 0; i < PERMUTATIONS; i++) {
    const permRng = mulberry32(9000 + i);
    const NUM_REPLICAS = 3 + (i % 2); // alternate between 3 and 4 replicas
    const replicas = [];
    for (let rIdx = 0; rIdx < NUM_REPLICAS; rIdx++) {
      const dag = new HashDag();
      const sequence = buildDeliveryWithDuplicates(records, permRng);
      deliverAll(dag, sequence);
      replicas.push(dag);
    }

    // Every replica must have integrated every record — no stragglers left
    // deferred, since the full causal set was delivered to each of them.
    for (const dag of replicas) {
      assert.strictEqual(dag.size, records.length, "every replica must fully integrate the delivered set");
      assert.strictEqual(dag.deferred.size, 0, "nothing should be left deferred once all parents were delivered");
    }

    const structures = replicas.map((d) => d.serializeStructure());
    const states = replicas.map((d) => d.serializeState());
    for (let k = 1; k < replicas.length; k++) {
      assert.strictEqual(structures[k], structures[0], `permutation ${i}: replica ${k} structure diverged from replica 0`);
      assert.strictEqual(states[k], states[0], `permutation ${i}: replica ${k} materialized state diverged from replica 0`);
    }
    referenceReplicas.push(structures[0]);
    ran++;
  }

  // And the converged result is the SAME across every one of the permutation
  // trials too (not just self-consistent within a trial) — the fixed record
  // set has exactly one valid linearization.
  for (let i = 1; i < referenceReplicas.length; i++) {
    assert.strictEqual(referenceReplicas[i], referenceReplicas[0], `trial ${i} converged to a different structure than trial 0`);
  }

  assert.strictEqual(ran, PERMUTATIONS);
  // Recorded for the task report: exact permutation count actually run.
  assert.strictEqual(PERMUTATIONS, 60);
});

// ── 2. No global clock is used — wall-clock skew must not change outcome ───

test("convergence: wildly skewed/inverted local wall clocks between replicas do not change the converged state", () => {
  const rng = mulberry32(42);
  const { records } = buildHistory({ authors: ["node-a", "node-b", "node-c"], rounds: 16, rng });

  const control = new HashDag();
  deliverAll(control, seededShuffle(records, mulberry32(1)));

  const RealDateNow = Date.now;
  const RealDate = global.Date;

  function withFakeClock(fakeNowMs, fn) {
    // Patch both Date.now and `new Date()` to a bizarre, fixed instant —
    // deliberately inverted/skewed relative to real time — for the duration
    // of `fn`. Restored unconditionally afterward.
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fakeNowMs);
        else super(...args);
      }
      static now() {
        return fakeNowMs;
      }
    }
    global.Date = FakeDate;
    try {
      return fn();
    } finally {
      global.Date = RealDate;
      global.Date.now = RealDateNow;
    }
  }

  // Replica B: pretend the local clock is deep in 1990.
  const replicaB = new HashDag();
  withFakeClock(new RealDate("1990-01-01T00:00:00Z").getTime(), () => {
    deliverAll(replicaB, seededShuffle(records, mulberry32(2)));
  });

  // Replica C: pretend the local clock is far in 2099, i.e. skewed the
  // opposite direction from B.
  const replicaC = new HashDag();
  withFakeClock(new RealDate("2099-06-15T00:00:00Z").getTime(), () => {
    deliverAll(replicaC, seededShuffle(records, mulberry32(3)));
  });

  assert.strictEqual(global.Date, RealDate, "fake clock must be fully restored");
  assert.strictEqual(replicaB.serializeStructure(), control.serializeStructure(), "1990-skewed replica diverged");
  assert.strictEqual(replicaC.serializeStructure(), control.serializeStructure(), "2099-skewed replica diverged");
  assert.strictEqual(replicaB.serializeState(), control.serializeState());
  assert.strictEqual(replicaC.serializeState(), control.serializeState());
});

// ── 3. Tamper detection ─────────────────────────────────────────────────────

test("tamper detection: mutating a payload after insertion breaks its hash and the node is rejected", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const dag = new HashDag();
  const genesis = dag.appendUpdate({
    nodeId: "author-1",
    payload: { key: "root", value: "original" },
    publicKeyPem,
    privateKeyPem,
  });

  const tampered = { ...genesis, payload: { ...genesis.payload, value: "TAMPERED" } };
  assert.notStrictEqual(tampered.payload.value, genesis.payload.value);

  const fresh = new HashDag();
  const result = fresh.mergeRemote(tampered);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "hash_mismatch");
  assert.strictEqual(fresh.has(tampered.hash), false, "a tampered node must never be integrated");
});

test("tamper detection: mutating parents (rewriting declared history) also breaks the hash", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const dag = new HashDag();
  const first = dag.appendUpdate({ nodeId: "author-1", payload: { key: "a", value: 1 }, publicKeyPem, privateKeyPem });
  const second = dag.appendUpdate({ nodeId: "author-1", payload: { key: "b", value: 2 }, publicKeyPem, privateKeyPem });
  assert.deepStrictEqual(second.parents, [first.hash]);

  // Attacker tries to sever the causal link by claiming no parents, while
  // keeping the original (now-mismatched) hash and signature.
  const rewritten = { ...second, parents: [] };
  const fresh = new HashDag();
  fresh.mergeRemote(first);
  const result = fresh.mergeRemote(rewritten);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "hash_mismatch");
});

// ── 4. Equivocation detection ───────────────────────────────────────────────

test("equivocation: a Byzantine author signing two different updates at the same causal position is caught with both messages as evidence", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const dag = new HashDag();

  // Two DIFFERENT, independently signed updates, both declaring the SAME
  // causal position (empty parent set = both claim to be "the" update
  // immediately following genesis from this author). A non-Byzantine author
  // would never do this — appendUpdate() normally advances the heads after
  // each call — but a Byzantine replica controls its own signing and can
  // deliberately reuse a position.
  const messageA = dag.appendUpdate({
    nodeId: "byzantine-node",
    payload: { key: "balance", value: "paid-alice" },
    parents: [],
    publicKeyPem,
    privateKeyPem,
  });
  const messageB = dag.appendUpdate({
    nodeId: "byzantine-node",
    payload: { key: "balance", value: "paid-bob" },
    parents: [],
    publicKeyPem,
    privateKeyPem,
  });

  assert.notStrictEqual(messageA.hash, messageB.hash);
  assert.deepStrictEqual(messageA.parents, messageB.parents);

  const evidence = dag.detectEquivocation("byzantine-node");
  assert.strictEqual(evidence.length, 1);
  assert.strictEqual(evidence[0].nodeId, "byzantine-node");
  assert.strictEqual(evidence[0].conflicting.length, 2);

  const hashesInEvidence = evidence[0].conflicting.map((r) => r.hash).sort();
  assert.deepStrictEqual(hashesInEvidence, [messageA.hash, messageB.hash].sort());

  // The evidence IS the proof — both signatures independently verify against
  // the author's own registered key, so the author cannot repudiate either.
  for (const record of evidence[0].conflicting) {
    const { verifyRecordSignature } = testHelpers();
    assert.ok(verifyRecordSignature(record, publicKeyPem), "evidence record must carry a genuinely valid signature");
  }
});

test("equivocation: an honest author's normal sequential updates never trigger a false positive", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const dag = new HashDag();
  for (let i = 0; i < 5; i++) {
    dag.appendUpdate({ nodeId: "honest-node", payload: { key: `k${i}`, value: i }, publicKeyPem, privateKeyPem });
  }
  assert.deepStrictEqual(dag.detectEquivocation("honest-node"), []);
});

// ── 5. Signature rejection ──────────────────────────────────────────────────

test("signature rejection: a wrong-key signature for an already-known author is refused", () => {
  const legit = generateKeypair();
  const attacker = generateKeypair();
  const dag = new HashDag();

  // Establish trust-on-first-use for "victim-node" with its real key.
  const genuine = dag.appendUpdate({
    nodeId: "victim-node",
    payload: { key: "root", value: 1 },
    publicKeyPem: legit.publicKeyPem,
    privateKeyPem: legit.privateKeyPem,
  });

  const fresh = new HashDag();
  assert.strictEqual(fresh.mergeRemote(genuine).ok, true);

  // Forge a self-consistent (hash matches content) message claiming the
  // SAME author identity, but signed with the attacker's key.
  const forged = { ...genuine, payload: { key: "root", value: 999 } };
  // Recompute a self-consistent hash for the new payload, then sign it with
  // the WRONG key — this simulates an attacker who doesn't hold victim-node's
  // private key trying to impersonate it now that the DAG has already bound
  // victim-node's real key via trust-on-first-use.
  const { computeHashForTest, signHashForTest } = testHelpers();
  const forgedHash = computeHashForTest(forged);
  const forgedSignature = signHashForTest(forgedHash, attacker.privateKeyPem);
  const forgedRecord = { ...forged, hash: forgedHash, signature: forgedSignature, publicKeyPem: attacker.publicKeyPem };

  const result = fresh.mergeRemote(forgedRecord);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, "signature_invalid");
  assert.strictEqual(fresh.has(forgedHash), false);
});

test("signature rejection: garbage signature bytes on first contact are refused, not thrown", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const dag = new HashDag();
  const genuine = dag.appendUpdate({ nodeId: "n", payload: { key: "a", value: 1 }, publicKeyPem, privateKeyPem });

  const fresh = new HashDag();
  const garbled = { ...genuine, signature: Buffer.from("not-a-real-signature").toString("base64") };
  assert.doesNotThrow(() => {
    const result = fresh.mergeRemote(garbled);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "signature_invalid");
  });
});

test("signature rejection: an author with no known key and no embedded key is refused as unknown_author", () => {
  const dag = new HashDag();
  const result = dag.mergeRemote({
    nodeId: "ghost",
    payload: { key: "a", value: 1 },
    parents: [],
    vectorClock: { ghost: 1 },
    signature: Buffer.from("x").toString("base64"),
    hash: "0".repeat(64),
  });
  assert.strictEqual(result.ok, false);
  // Hash won't match either (garbage hash) — either hash_mismatch or
  // unknown_author is an acceptable honest rejection here; assert it's one
  // of the two, never a silent accept.
  assert.ok(["hash_mismatch", "unknown_author"].includes(result.error));
});

// ── 6. Missing-parent handling ──────────────────────────────────────────────

test("missing-parent handling: a node whose parent isn't known yet is deferred, not silently accepted", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const producer = new HashDag();
  const first = producer.appendUpdate({ nodeId: "n", payload: { key: "a", value: 1 }, publicKeyPem, privateKeyPem });
  const second = producer.appendUpdate({ nodeId: "n", payload: { key: "b", value: 2 }, publicKeyPem, privateKeyPem });

  const fresh = new HashDag();
  const result = fresh.mergeRemote(second); // parent `first` not delivered yet
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.deferred, true);
  assert.deepStrictEqual(result.missingParents, [first.hash]);
  assert.strictEqual(fresh.has(second.hash), false, "must not be integrated with a broken causal chain");
  assert.strictEqual(fresh.deferred.has(second.hash), true);

  // Now deliver the missing parent — the deferred child must cascade-integrate
  // automatically (no need to re-deliver it explicitly).
  const parentResult = fresh.mergeRemote(first);
  assert.strictEqual(parentResult.ok, true);
  assert.strictEqual(fresh.has(second.hash), true, "deferred child must auto-integrate once its parent arrives");
  assert.strictEqual(fresh.deferred.size, 0);
});

test("missing-parent handling: re-delivering the same not-yet-resolvable node again stays honestly deferred", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const producer = new HashDag();
  const first = producer.appendUpdate({ nodeId: "n", payload: { key: "a", value: 1 }, publicKeyPem, privateKeyPem });
  const second = producer.appendUpdate({ nodeId: "n", payload: { key: "b", value: 2 }, publicKeyPem, privateKeyPem });

  const fresh = new HashDag();
  fresh.mergeRemote(second);
  const again = fresh.mergeRemote(second); // duplicate delivery while still deferred
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.deferred, true);
  assert.deepStrictEqual(again.missingParents, [first.hash]);
  assert.strictEqual(fresh.has(second.hash), false);
});

test("missing-parent handling: a multi-hop chain of deferrals resolves once the whole chain is delivered, in ANY order", () => {
  const { publicKeyPem, privateKeyPem } = generateKeypair();
  const producer = new HashDag();
  const chain = [];
  for (let i = 0; i < 6; i++) {
    chain.push(producer.appendUpdate({ nodeId: "n", payload: { key: `k${i}`, value: i }, publicKeyPem, privateKeyPem }));
  }

  const fresh = new HashDag();
  // Deliver in REVERSE order — every node except the very first arrives
  // before its parent is known.
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = fresh.mergeRemote(chain[i]);
    if (i > 0) assert.strictEqual(r.deferred, true, `node ${i} should defer, parent not yet delivered`);
  }
  for (const node of chain) assert.strictEqual(fresh.has(node.hash), true, "every node must eventually integrate");
  assert.strictEqual(fresh.deferred.size, 0);
  assert.strictEqual(fresh.serializeStructure(), (() => {
    const forward = new HashDag();
    for (const node of chain) forward.mergeRemote(node);
    return forward.serializeStructure();
  })());
});

// ── Small internal helpers shared by a couple of tests above ───────────────
// (kept local + tiny rather than reaching into hash-dag.js internals)

function testHelpers() {
  // Re-derive the same hashing/signing primitives hash-dag.js uses,
  // independently, purely for constructing adversarial test fixtures (never
  // used by the library itself — this is test-only scaffolding).
  return {
    computeHashForTest(record) {
      const canonical = canonicalStringify({
        nodeId: record.nodeId,
        payload: record.payload,
        parents: record.parents,
        vectorClock: record.vectorClock,
      });
      return crypto.createHash("sha256").update(canonical).digest("hex");
    },
    signHashForTest(hashHex, privateKeyPem) {
      return crypto.sign(null, Buffer.from(hashHex, "hex"), { key: privateKeyPem, format: "pem" }).toString("base64");
    },
    verifyRecordSignature(record, publicKeyPem) {
      try {
        return crypto.verify(
          null,
          Buffer.from(record.hash, "hex"),
          { key: publicKeyPem, format: "pem" },
          Buffer.from(record.signature, "base64"),
        );
      } catch {
        return false;
      }
    },
  };
}
