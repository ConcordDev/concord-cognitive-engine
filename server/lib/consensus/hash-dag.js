/**
 * Hash-DAG — Byzantine-resilient, content-addressed causal history.
 *
 * A content-addressed DAG of signed updates. Each node commits, via its own
 * hash, to its entire causal history (its parents' hashes are part of what
 * gets hashed) — so history cannot be silently rewritten: mutate a payload
 * anywhere in the chain and every hash downstream of it stops matching.
 *
 * Reuse, not reinvention:
 *   - Canonicalization is `canonicalStringify` from `../dtu-protocol.js` —
 *     the same recursive, sorted-key JSON serializer the rest of the DTU
 *     substrate hashes against, so this engine's hashes are consistent with
 *     it (and don't silently drop nested keys the way a naive top-level-only
 *     sort would).
 *   - Signing follows the same shape as `../plugin-signing.js`: Ed25519 via
 *     `node:crypto` (`generateKeyPairSync`, `sign(null, ...)`,
 *     `verify(null, ...)`), signing the raw hash bytes.
 *
 * No global clock is used anywhere in this file — not in hashing, not in
 * signing, not in ordering. Deterministic convergence comes entirely from
 * causal order (vector clocks / DAG parentage) with a stable hash tiebreak
 * for genuinely concurrent nodes. See the module docstring in
 * `vector-clock.js` for why that matters.
 *
 * HONEST BOUNDARY: this is Byzantine-resilient CONVERGENCE, not Byzantine
 * AGREEMENT. There is no quorum, no leader election, no 3f+1 safety
 * threshold — nothing here can force a decision in the presence of an
 * active adversary. What it does provide: (1) deterministic eventual
 * convergence given the same delivered update set, in any order, with
 * duplicates, and (2) cryptographic detection — not prevention — of
 * tampering and of equivocation (a node signing two different updates at
 * the same causal position). A Byzantine node cannot rewrite history or
 * unsay a signed message without leaving proof, but nothing here stops it
 * from equivocating in the first place, and a permanently partitioned
 * replica simply stays divergent until it receives the missing updates —
 * this engine does not provide delivery, only makes misbehavior undeniable
 * once updates do arrive.
 */

import crypto from "node:crypto";
import { canonicalStringify } from "../dtu-protocol.js";
import { merge as vcMerge, increment as vcIncrement } from "./vector-clock.js";

// ── Hashing + signing primitives ────────────────────────────────────────────

/**
 * The node's own hash commits to {nodeId, payload, parents, vectorClock} —
 * i.e. its author, its content, its entire declared causal history (parent
 * hashes), and its causal position. `hash` and `signature` are deliberately
 * excluded from what gets hashed (they're derived FROM this hash, not part
 * of the thing being hashed).
 */
function computeNodeHash({ nodeId, payload, parents, vectorClock }) {
  const canonical = canonicalStringify({ nodeId, payload, parents, vectorClock });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function signHash(hashHex, privateKeyPem) {
  return crypto.sign(null, Buffer.from(hashHex, "hex"), { key: privateKeyPem, format: "pem" }).toString("base64");
}

function verifyHashSignature(hashHex, signatureB64, publicKeyPem) {
  try {
    return crypto.verify(
      null,
      Buffer.from(hashHex, "hex"),
      { key: publicKeyPem, format: "pem" },
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    // Malformed key/signature bytes must be a rejection, never a throw that
    // could crash a caller mid-merge.
    return false;
  }
}

/** Generate an Ed25519 keypair for a DAG author. Same shape as plugin-signing.js. */
export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function positionKey(nodeId, parents) {
  return `${nodeId}|${[...parents].sort().join(",")}`;
}

// ── The DAG ──────────────────────────────────────────────────────────────

export class HashDag {
  /**
   * @param {object} [opts]
   * @param {Map<string,string>} [opts.trustedKeys] - nodeId -> publicKeyPem,
   *   pre-seeded if the caller already knows the authors. Otherwise this DAG
   *   trusts-on-first-use: the first valid, self-consistent message seen
   *   from a nodeId binds that nodeId to the publicKeyPem it carried, and
   *   every subsequent message claiming that nodeId is checked against the
   *   BOUND key (never against whatever key a later message happens to
   *   carry) — so an attacker who doesn't control the real key cannot
   *   impersonate an already-seen author, even by embedding their own key.
   */
  constructor(opts = {}) {
    this.nodes = new Map(); // hash -> integrated, validated node record
    this.heads = new Set(); // hashes with no known child yet
    this.deferred = new Map(); // hash -> validated-but-parent-incomplete record
    this.pendingByMissingParent = new Map(); // missing parent hash -> Set(waiting hash)
    this.trustedKeys = opts.trustedKeys instanceof Map ? opts.trustedKeys : new Map();
    this.positionIndex = new Map(); // "nodeId|sortedParents" -> Set(hash) — equivocation detection
  }

  /** Current DAG heads (hashes with no known child). */
  getHeads() {
    return [...this.heads];
  }

  has(hash) {
    return this.nodes.has(hash);
  }

  get(hash) {
    return this.nodes.get(hash) || null;
  }

  get size() {
    return this.nodes.size;
  }

  // ── Local authorship ─────────────────────────────────────────────────────

  /**
   * Create, sign, and integrate a new update authored by this replica.
   *
   * @param {object} args
   * @param {string} args.nodeId - author identity
   * @param {*} args.payload - arbitrary JSON-serializable content
   * @param {string} args.privateKeyPem - Ed25519 private key (PKCS8 PEM)
   * @param {string} args.publicKeyPem - matching public key (SPKI PEM)
   * @param {string[]} [args.parents] - explicit parent hashes; defaults to
   *   the current heads. Callers building genuinely CONCURRENT branches
   *   (two authors both building off the same earlier state before seeing
   *   each other's latest write) pass an explicit, earlier heads snapshot.
   * @returns {object} the signed node record — this is the wire message to
   *   broadcast to other replicas via mergeRemote().
   */
  appendUpdate({ nodeId, payload, privateKeyPem, publicKeyPem, parents } = {}) {
    if (!nodeId || typeof nodeId !== "string") throw new Error("nodeId_required");
    if (!privateKeyPem || !publicKeyPem) throw new Error("keypair_required");

    const parentHashes = (Array.isArray(parents) ? [...parents] : [...this.heads]).sort();

    let vectorClock = {};
    for (const p of parentHashes) {
      const parentNode = this.nodes.get(p);
      if (!parentNode) throw new Error(`unknown_parent:${p}`);
      vectorClock = vcMerge(vectorClock, parentNode.vectorClock);
    }
    vectorClock = vcIncrement(vectorClock, nodeId);

    const hash = computeNodeHash({ nodeId, payload, parents: parentHashes, vectorClock });
    const signature = signHash(hash, privateKeyPem);
    const record = { nodeId, payload, parents: parentHashes, vectorClock, signature, publicKeyPem, hash };

    // Bind our own key the same way a remote replica would trust-on-first-use.
    if (!this.trustedKeys.has(nodeId)) this.trustedKeys.set(nodeId, publicKeyPem);

    this._integrate(record);
    this._resolveWaiters(hash);
    return record;
  }

  // ── Remote integration ───────────────────────────────────────────────────

  /**
   * Accept a remote node. Verifies signature + hash integrity + known
   * parentage before integrating. Never silently accepts a node whose
   * causal chain isn't fully known — such a node is honestly DEFERRED, not
   * dropped and not force-integrated with a broken chain.
   *
   * @param {object} record - a node record as produced by appendUpdate()
   *   (or received from a peer, wire-deserialized)
   * @returns {{ok:boolean, duplicate?:boolean, integrated?:boolean, deferred?:boolean, missingParents?:string[], error?:string}}
   */
  mergeRemote(record) {
    if (!record || typeof record !== "object") return { ok: false, error: "invalid_record" };
    const { nodeId, payload, parents, vectorClock, signature, hash } = record;
    if (
      !nodeId || typeof nodeId !== "string" ||
      !Array.isArray(parents) ||
      !vectorClock || typeof vectorClock !== "object" ||
      !signature || typeof signature !== "string" ||
      !hash || typeof hash !== "string"
    ) {
      return { ok: false, error: "malformed_record" };
    }

    // Already fully integrated — content-addressed, so identical hash means
    // identical content (short of a SHA-256 collision). Safe no-op, and this
    // is what makes duplicate delivery harmless.
    if (this.nodes.has(hash)) return { ok: true, duplicate: true, hash };

    // Already validated once and sitting in deferred (parents still
    // incomplete last time we saw it) — re-check parentage without redoing
    // hash/signature verification, which already passed the first time.
    if (this.deferred.has(hash)) {
      const missing = parents.filter((p) => !this.nodes.has(p));
      if (missing.length === 0) {
        this._tryIntegrateDeferred(hash);
        return { ok: true, integrated: true, hash };
      }
      return { ok: false, deferred: true, missingParents: missing };
    }

    // Tamper detection: recompute the hash from the claimed content and
    // compare. A mismatch means the payload (or parents, or vector clock)
    // was altered after the fact — reject before even looking at the
    // signature.
    const expectedHash = computeNodeHash({ nodeId, payload, parents, vectorClock });
    if (expectedHash !== hash) {
      return { ok: false, error: "hash_mismatch", expected: expectedHash, claimed: hash };
    }

    // Signature verification. A key already bound to this nodeId (via prior
    // trust-on-first-use or pre-seeding) ALWAYS wins over whatever key this
    // message happens to carry — otherwise an attacker could simply embed
    // their own key and self-sign, impersonating an already-known author.
    let publicKeyPem = this.trustedKeys.get(nodeId);
    let firstContact = false;
    if (!publicKeyPem) {
      publicKeyPem = record.publicKeyPem;
      if (!publicKeyPem) return { ok: false, error: "unknown_author" };
      firstContact = true;
    }
    if (!verifyHashSignature(hash, signature, publicKeyPem)) {
      return { ok: false, error: "signature_invalid" };
    }
    if (firstContact) this.trustedKeys.set(nodeId, publicKeyPem);

    const stored = {
      nodeId,
      payload,
      parents: [...parents],
      vectorClock: { ...vectorClock },
      signature,
      hash,
      publicKeyPem: record.publicKeyPem || publicKeyPem,
    };

    const missing = parents.filter((p) => !this.nodes.has(p));
    if (missing.length > 0) {
      this.deferred.set(hash, stored);
      for (const m of missing) {
        if (!this.pendingByMissingParent.has(m)) this.pendingByMissingParent.set(m, new Set());
        this.pendingByMissingParent.get(m).add(hash);
      }
      return { ok: false, deferred: true, missingParents: missing };
    }

    this._integrate(stored);
    this._resolveWaiters(hash);
    return { ok: true, integrated: true, hash };
  }

  _integrate(record) {
    this.nodes.set(record.hash, record);
    for (const p of record.parents) this.heads.delete(p);
    this.heads.add(record.hash);
    const key = positionKey(record.nodeId, record.parents);
    if (!this.positionIndex.has(key)) this.positionIndex.set(key, new Set());
    this.positionIndex.get(key).add(record.hash);
  }

  _tryIntegrateDeferred(hash) {
    const record = this.deferred.get(hash);
    if (!record) return;
    const missing = record.parents.filter((p) => !this.nodes.has(p));
    if (missing.length > 0) return; // still blocked on something else
    this.deferred.delete(hash);
    this._integrate(record);
    this._resolveWaiters(hash);
  }

  _resolveWaiters(hash) {
    const waiters = this.pendingByMissingParent.get(hash);
    if (!waiters) return;
    this.pendingByMissingParent.delete(hash);
    for (const w of [...waiters]) this._tryIntegrateDeferred(w);
  }

  // ── Byzantine detection ──────────────────────────────────────────────────

  /**
   * Find equivocation: a nodeId that has signed two (or more) DIFFERENT
   * updates at the SAME causal position (same declared parent set). Both
   * messages are validly signed by that author — that's exactly what makes
   * this undeniable: the author cannot claim either message is forged.
   *
   * @param {string} [nodeId] - restrict to one author; omit to scan all.
   * @returns {Array<{nodeId:string, positionKey:string, conflicting:object[]}>}
   */
  detectEquivocation(nodeId) {
    const evidence = [];
    for (const [key, hashes] of this.positionIndex) {
      if (hashes.size < 2) continue;
      const [id] = key.split("|");
      if (nodeId && id !== nodeId) continue;
      const conflicting = [...hashes].map((h) => this.nodes.get(h)).filter(Boolean);
      if (conflicting.length >= 2) evidence.push({ nodeId: id, positionKey: key, conflicting });
    }
    return evidence;
  }

  // ── Deterministic convergence ────────────────────────────────────────────

  /**
   * A deterministic linear extension of the causal partial order: Kahn's
   * algorithm over the DAG, breaking ties among concurrently-eligible nodes
   * by ascending hash. This is the whole point of the engine — the same set
   * of integrated nodes always produces the same linearization, regardless
   * of what order they were delivered/merged in, because the tiebreak is a
   * property of the content (its hash), never of wall-clock arrival time.
   *
   * @returns {string[]} node hashes in deterministic causal+hash order
   */
  linearize() {
    const inDegree = new Map();
    const children = new Map();
    for (const [hash, node] of this.nodes) {
      inDegree.set(hash, node.parents.length);
      for (const p of node.parents) {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(hash);
      }
    }

    const frontier = [...this.nodes.keys()].filter((h) => inDegree.get(h) === 0);
    frontier.sort();
    const order = [];
    while (frontier.length) {
      const hash = frontier.shift();
      order.push(hash);
      for (const child of children.get(hash) || []) {
        const d = inDegree.get(child) - 1;
        inDegree.set(child, d);
        if (d === 0) {
          const idx = frontier.findIndex((h) => h > child);
          if (idx === -1) frontier.push(child);
          else frontier.splice(idx, 0, child);
        }
      }
    }
    return order;
  }

  /**
   * Fold the DAG's payloads into a plain key/value state, applying updates
   * in `linearize()` order. Payloads shaped `{ key, value }` behave as a
   * causally-ordered-with-hash-tiebreak register per key — the deterministic
   * replacement for wall-clock LWW. Payloads without a `key` field are
   * skipped (this fold is a convenience for register-shaped payloads, not a
   * requirement — `linearize()` itself is the general convergence proof).
   *
   * @returns {object}
   */
  materializeState() {
    const state = {};
    for (const hash of this.linearize()) {
      const node = this.nodes.get(hash);
      const payload = node?.payload;
      if (payload && typeof payload === "object" && !Array.isArray(payload) && "key" in payload) {
        state[payload.key] = payload.value;
      }
    }
    return state;
  }

  /** Canonical serialization of materializeState() — for byte-exact replica comparison. */
  serializeState() {
    return canonicalStringify(this.materializeState());
  }

  /** Canonical serialization of the full linearization — the strongest convergence proof. */
  serializeStructure() {
    return canonicalStringify(this.linearize());
  }
}

export default HashDag;
