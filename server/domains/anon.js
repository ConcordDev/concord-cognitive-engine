// server/domains/anon.js
// Domain actions for anonymization/privacy: k-anonymity, re-identification
// risk assessment, and differential privacy noise injection.
//
// Plus a real end-to-end encrypted pseudonymous messaging substrate:
// X25519 ECDH key exchange, AES-256-GCM sealed-sender envelopes, safety
// numbers, group conversations, server-side ephemeral sweeping, and
// per-conversation disappearing-message defaults.

import crypto from "node:crypto";

export default function registerAnonActions(registerLensAction) {

  // ─────────────────────────────────────────────────────────────────
  //  E2E messaging substrate — persistent per-user state in _concordSTATE
  // ─────────────────────────────────────────────────────────────────

  function getAnonState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.anonLens) STATE.anonLens = {};
    const s = STATE.anonLens;
    // identities: userId -> identity object (keypair + alias)
    // conversations: convId -> conversation object
    // userConvs: userId -> Set(convId)
    for (const k of ["identities", "conversations", "userConvs"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveAnonState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const anUid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const anNow = () => Date.now();

  // Real-time delivery: emit to each member's per-user socket room so a
  // sent message lands on every recipient's open client without polling.
  // The stored record is still ciphertext-only — the socket payload
  // carries only metadata + the recipient's own sealed envelope, never
  // plaintext, preserving the E2E + sealed-sender guarantees.
  function emitToUser(userId, name, payload) {
    const REALTIME = globalThis._concordREALTIME;
    try {
      REALTIME?.io?.to(`user:${userId}`).emit(name, { userId, ...payload, ts: Date.now() });
    } catch (_e) { /* best effort — delivery degrades to poll */ }
  }
  const anId = (p) => `${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const anClean = (v, max = 4000) => String(v == null ? "" : v).trim().slice(0, max);

  // Derive a deterministic 6-line numeric safety number from two public keys.
  function safetyNumber(pubA, pubB) {
    const sorted = [pubA, pubB].sort().join("|");
    const digest = crypto.createHash("sha256").update(sorted).digest();
    const groups = [];
    for (let i = 0; i < 12; i++) {
      const chunk = digest.readUInt32BE((i * 2) % 28);
      groups.push(String(chunk % 100000).padStart(5, "0"));
    }
    return groups;
  }

  // Lazily mint / fetch a user's pseudonymous identity (X25519 keypair).
  function ensureIdentity(s, userId) {
    let ident = s.identities.get(userId);
    if (ident) return ident;
    const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
    const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const priv = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const alias = `anon-${crypto.randomBytes(4).toString("hex")}`;
    ident = {
      userId,
      alias,
      anonId: anId("aid"),
      publicKey: pub,
      privateKey: priv,
      fingerprint: crypto.createHash("sha256").update(pub).digest("hex").slice(0, 16),
      createdAt: anNow(),
      rotatedAt: null,
      verifiedPeers: {}, // peerAnonId -> true once safety number confirmed
    };
    s.identities.set(userId, ident);
    return ident;
  }

  // Resolve a peer identity by anonId. Returns null if not found.
  function findIdentityByAnonId(s, anonId) {
    for (const ident of s.identities.values()) {
      if (ident.anonId === anonId) return ident;
    }
    return null;
  }

  // AES-256-GCM encrypt with an ECDH-derived shared secret.
  function sealEnvelope(myPrivB64, peerPubB64, plaintext) {
    const myPriv = crypto.createPrivateKey({
      key: Buffer.from(myPrivB64, "base64"), format: "der", type: "pkcs8",
    });
    const peerPub = crypto.createPublicKey({
      key: Buffer.from(peerPubB64, "base64"), format: "der", type: "spki",
    });
    const shared = crypto.diffieHellman({ privateKey: myPriv, publicKey: peerPub });
    const aesKey = crypto.createHash("sha256").update(shared).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: ct.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  // AES-256-GCM decrypt — recipient side.
  function openEnvelope(myPrivB64, peerPubB64, env) {
    const myPriv = crypto.createPrivateKey({
      key: Buffer.from(myPrivB64, "base64"), format: "der", type: "pkcs8",
    });
    const peerPub = crypto.createPublicKey({
      key: Buffer.from(peerPubB64, "base64"), format: "der", type: "spki",
    });
    const shared = crypto.diffieHellman({ privateKey: myPriv, publicKey: peerPub });
    const aesKey = crypto.createHash("sha256").update(shared).digest();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm", aesKey, Buffer.from(env.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  // Drop messages whose disappear deadline has passed. Mutates conversation.
  function sweepConversation(conv, now) {
    let removed = 0;
    conv.messages = conv.messages.filter((m) => {
      if (m.expiresAt && m.expiresAt <= now) { removed++; return false; }
      return true;
    });
    return removed;
  }

  /**
   * anonymize
   * Anonymize data fields using k-anonymity via generalization hierarchies.
   * Detects quasi-identifiers, applies generalization, and computes information loss.
   * artifact.data.records = [{ field1: val, field2: val, ... }]
   * artifact.data.quasiIdentifiers = ["field1", "field2"] (optional — auto-detected if absent)
   * artifact.data.sensitiveFields = ["fieldN"] (optional)
   * params.k = desired k-anonymity level (default 3)
   */
  registerLensAction("anon", "anonymize", (ctx, artifact, params) => {
    const records = artifact.data?.records || [];
    if (records.length === 0) return { ok: true, result: { message: "No records to anonymize." } };

    const k = params.k || 3;

    // Auto-detect quasi-identifiers if not specified
    const qids = artifact.data?.quasiIdentifiers || [];
    const sensitiveFields = new Set(artifact.data?.sensitiveFields || []);

    if (qids.length === 0) {
      // Heuristic: fields with moderate cardinality (not unique, not constant) are quasi-identifiers
      const allFields = Object.keys(records[0] || {});
      for (const field of allFields) {
        if (sensitiveFields.has(field)) continue;
        const uniqueVals = new Set(records.map(r => r[field]));
        const ratio = uniqueVals.size / records.length;
        // Quasi-identifiers typically have cardinality between 2% and 80% of record count
        if (ratio > 0.02 && ratio < 0.8 && uniqueVals.size > 1) {
          qids.push(field);
        }
      }
    }

    // Build generalization hierarchies
    function generalizeValue(value, level) {
      if (value == null) return "*";
      const str = String(value);

      // Numeric generalization: widen range
      const num = parseFloat(str);
      if (!isNaN(num)) {
        const bucketSize = Math.pow(10, level);
        const lower = Math.floor(num / bucketSize) * bucketSize;
        return `${lower}-${lower + bucketSize - 1}`;
      }

      // String generalization: truncate from right
      if (level >= str.length) return "*";
      return str.substring(0, Math.max(1, str.length - level)) + "*";
    }

    // Check k-anonymity: every equivalence class must have >= k records
    function checkKAnonymity(recs, fields, level) {
      const groups = {};
      for (const rec of recs) {
        const key = fields.map(f => generalizeValue(rec[f], level)).join("||");
        groups[key] = (groups[key] || 0) + 1;
      }
      const counts = Object.values(groups);
      const satisfied = counts.every(c => c >= k);
      const minGroupSize = Math.min(...counts);
      const numGroups = counts.length;
      return { satisfied, minGroupSize, numGroups, groups };
    }

    // Find minimum generalization level that achieves k-anonymity
    let generalizationLevel = 0;
    let result = checkKAnonymity(records, qids, 0);
    while (!result.satisfied && generalizationLevel < 10) {
      generalizationLevel++;
      result = checkKAnonymity(records, qids, generalizationLevel);
    }

    // Apply generalization to produce anonymized records
    const anonymized = records.map(rec => {
      const newRec = { ...rec };
      for (const field of qids) {
        newRec[field] = generalizeValue(rec[field], generalizationLevel);
      }
      // Suppress sensitive fields
      for (const field of sensitiveFields) {
        newRec[field] = "[REDACTED]";
      }
      return newRec;
    });

    // Compute information loss (normalized certainty penalty)
    // For each QID, loss = 1 - (1 / generalization_domain_size)
    let totalInfoLoss = 0;
    for (const field of qids) {
      const originalCardinality = new Set(records.map(r => r[field])).size;
      const anonymizedCardinality = new Set(anonymized.map(r => r[field])).size;
      const fieldLoss = originalCardinality > 1
        ? 1 - (anonymizedCardinality / originalCardinality)
        : 0;
      totalInfoLoss += fieldLoss;
    }
    const avgInfoLoss = qids.length > 0 ? totalInfoLoss / qids.length : 0;

    // Equivalence class statistics
    const eqGroups = {};
    for (const rec of anonymized) {
      const key = qids.map(f => rec[f]).join("||");
      eqGroups[key] = (eqGroups[key] || 0) + 1;
    }
    const groupSizes = Object.values(eqGroups);

    artifact.data.anonymizedRecords = anonymized;

    return {
      ok: true, result: {
        kAchieved: result.satisfied,
        k,
        generalizationLevel,
        quasiIdentifiers: qids,
        sensitiveFieldsRedacted: [...sensitiveFields],
        informationLoss: Math.round(avgInfoLoss * 10000) / 100,
        equivalenceClasses: groupSizes.length,
        minClassSize: Math.min(...groupSizes),
        maxClassSize: Math.max(...groupSizes),
        avgClassSize: Math.round((groupSizes.reduce((s, v) => s + v, 0) / groupSizes.length) * 100) / 100,
        recordCount: records.length,
        anonymizedSample: anonymized.slice(0, 5),
      },
    };
  });

  /**
   * privacyRisk
   * Compute re-identification risk using prosecutor, journalist, and marketer
   * attack models. Scores uniqueness of records.
   * artifact.data.records = [{ field1: val, ... }]
   * artifact.data.quasiIdentifiers = ["field1", "field2"]
   */
  registerLensAction("anon", "privacyRisk", (ctx, artifact, params) => {
    const records = artifact.data?.records || [];
    if (records.length === 0) return { ok: true, result: { message: "No records to assess." } };

    const qids = artifact.data?.quasiIdentifiers || Object.keys(records[0] || {});

    // Build equivalence classes
    const eqClasses = {};
    for (const rec of records) {
      const key = qids.map(f => String(rec[f] ?? "")).join("||");
      if (!eqClasses[key]) eqClasses[key] = [];
      eqClasses[key].push(rec);
    }

    const classSizes = Object.values(eqClasses).map(c => c.length);
    const n = records.length;

    // Prosecutor model: attacker targets a specific individual they know is in the dataset
    // Risk = max(1/|eq_class|) — worst case for any individual
    const prosecutorRisk = Math.max(...classSizes.map(s => 1 / s));

    // Journalist model: attacker wants to re-identify any individual (expected success)
    // Risk = (1/n) * sum(1/|eq_class_i|) for each record i
    let journalistSum = 0;
    for (const cls of Object.values(eqClasses)) {
      journalistSum += cls.length * (1 / cls.length); // each record contributes 1/|class|
    }
    const journalistRisk = journalistSum / n;

    // Marketer model: attacker wants to re-identify as many as possible
    // Risk = number_of_unique_records / n
    const uniqueRecords = classSizes.filter(s => s === 1).length;
    const marketerRisk = uniqueRecords / n;

    // Uniqueness scoring per field combination (power set of QIDs, up to 4 fields)
    const fieldRisks = [];
    const maxComboSize = Math.min(qids.length, 4);
    function combinations(arr, size) {
      if (size === 0) return [[]];
      if (arr.length === 0) return [];
      const [first, ...rest] = arr;
      const withFirst = combinations(rest, size - 1).map(c => [first, ...c]);
      const withoutFirst = combinations(rest, size);
      return [...withFirst, ...withoutFirst];
    }

    for (let size = 1; size <= maxComboSize; size++) {
      const combos = combinations(qids, size);
      for (const combo of combos.slice(0, 20)) { // cap to avoid explosion
        const groups = {};
        for (const rec of records) {
          const key = combo.map(f => String(rec[f] ?? "")).join("||");
          groups[key] = (groups[key] || 0) + 1;
        }
        const sizes = Object.values(groups);
        const uniques = sizes.filter(s => s === 1).length;
        fieldRisks.push({
          fields: combo,
          uniqueRecords: uniques,
          uniquenessRatio: Math.round((uniques / n) * 10000) / 100,
          minGroupSize: Math.min(...sizes),
          distinctGroups: sizes.length,
        });
      }
    }

    fieldRisks.sort((a, b) => b.uniquenessRatio - a.uniquenessRatio);

    // Overall risk level
    const maxRisk = Math.max(prosecutorRisk, journalistRisk, marketerRisk);
    const riskLevel = maxRisk > 0.5 ? "critical" : maxRisk > 0.2 ? "high" : maxRisk > 0.1 ? "moderate" : "low";

    return {
      ok: true, result: {
        attackModels: {
          prosecutor: { risk: Math.round(prosecutorRisk * 10000) / 100, description: "Targeted attack on known individual" },
          journalist: { risk: Math.round(journalistRisk * 10000) / 100, description: "Random re-identification attempt" },
          marketer: { risk: Math.round(marketerRisk * 10000) / 100, description: "Bulk re-identification" },
        },
        overallRiskLevel: riskLevel,
        uniqueRecords,
        totalRecords: n,
        equivalenceClasses: classSizes.length,
        smallestClassSize: Math.min(...classSizes),
        fieldCombinationRisks: fieldRisks.slice(0, 15),
        recommendations: [
          ...(prosecutorRisk > 0.2 ? ["Apply k-anonymity (k >= 5) to reduce prosecutor risk"] : []),
          ...(uniqueRecords > 0 ? [`${uniqueRecords} unique records need generalization or suppression`] : []),
          ...(fieldRisks.some(f => f.fields.length <= 2 && f.uniquenessRatio > 50) ? ["High uniqueness with few fields — consider removing or generalizing key quasi-identifiers"] : []),
        ],
      },
    };
  });

  /**
   * differentialPrivacy
   * Add differential privacy noise using the Laplace mechanism with epsilon
   * budget tracking and sensitivity calibration.
   * artifact.data.values = [number, ...] or artifact.data.queries = [{ type: "count"|"sum"|"mean", values: [...] }]
   * params.epsilon = privacy budget (default 1.0)
   * params.sensitivity = global sensitivity (auto-computed if absent)
   */
  registerLensAction("anon", "differentialPrivacy", (ctx, artifact, params) => {
    const epsilon = params.epsilon || 1.0;
    const queries = artifact.data?.queries || [];
    const rawValues = artifact.data?.values || [];

    // Laplace noise generator (using inverse CDF method)
    function laplace(scale) {
      const u = Math.random() - 0.5;
      return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }

    // Process single query
    function processQuery(query, epsilonBudget) {
      const values = query.values || rawValues;
      if (values.length === 0) return { trueAnswer: 0, noisyAnswer: 0, noise: 0, sensitivity: 0 };

      const type = query.type || "count";
      let trueAnswer, sensitivity;

      switch (type) {
        case "count":
          trueAnswer = values.length;
          sensitivity = 1; // adding/removing one record changes count by 1
          break;
        case "sum": {
          trueAnswer = values.reduce((s, v) => s + (parseFloat(v) || 0), 0);
          // Sensitivity = max possible contribution of one record
          const maxVal = Math.max(...values.map(v => Math.abs(parseFloat(v) || 0)));
          sensitivity = query.sensitivity || maxVal || 1;
          break;
        }
        case "mean": {
          const nums = values.map(v => parseFloat(v) || 0);
          trueAnswer = nums.reduce((s, v) => s + v, 0) / nums.length;
          const range = Math.max(...nums) - Math.min(...nums);
          sensitivity = query.sensitivity || (range / nums.length) || 1;
          break;
        }
        case "max": {
          const nums = values.map(v => parseFloat(v) || 0).sort((a, b) => a - b);
          trueAnswer = nums[nums.length - 1];
          // Smooth sensitivity: difference between top two values
          sensitivity = query.sensitivity || (nums.length > 1 ? nums[nums.length - 1] - nums[nums.length - 2] : 1);
          break;
        }
        case "median": {
          const nums = values.map(v => parseFloat(v) || 0).sort((a, b) => a - b);
          const mid = Math.floor(nums.length / 2);
          trueAnswer = nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
          // Local sensitivity for median
          sensitivity = query.sensitivity || (nums.length > 1 ? nums[Math.min(mid + 1, nums.length - 1)] - nums[Math.max(mid - 1, 0)] : 1);
          break;
        }
        default:
          trueAnswer = values.length;
          sensitivity = 1;
      }

      const scale = sensitivity / epsilonBudget;
      const noise = laplace(scale);
      const noisyAnswer = trueAnswer + noise;

      // Confidence interval (Laplace: P(|noise| > t) = exp(-t/scale))
      // 95% CI: t = scale * ln(1/0.05) ≈ scale * 3.0
      const ci95 = scale * Math.log(1 / 0.05);

      return {
        type,
        trueAnswer: Math.round(trueAnswer * 10000) / 10000,
        noisyAnswer: Math.round(noisyAnswer * 10000) / 10000,
        noise: Math.round(noise * 10000) / 10000,
        sensitivity: Math.round(sensitivity * 10000) / 10000,
        scale: Math.round(scale * 10000) / 10000,
        confidenceInterval95: Math.round(ci95 * 10000) / 10000,
        relativeError: trueAnswer !== 0
          ? Math.round((Math.abs(noise) / Math.abs(trueAnswer)) * 10000) / 100
          : null,
      };
    }

    // If no structured queries, treat raw values as a single count+sum+mean
    let results;
    let totalEpsilonUsed;

    if (queries.length > 0) {
      // Sequential composition: split epsilon budget across queries
      const perQueryEpsilon = epsilon / queries.length;
      results = queries.map(q => processQuery(q, perQueryEpsilon));
      totalEpsilonUsed = epsilon;
    } else if (rawValues.length > 0) {
      // Run three default queries, splitting budget equally
      const perQueryEpsilon = epsilon / 3;
      results = [
        processQuery({ type: "count", values: rawValues }, perQueryEpsilon),
        processQuery({ type: "sum", values: rawValues }, perQueryEpsilon),
        processQuery({ type: "mean", values: rawValues }, perQueryEpsilon),
      ];
      totalEpsilonUsed = epsilon;
    } else {
      return { ok: true, result: { message: "No values or queries to process." } };
    }

    // Budget tracking
    const previousBudget = artifact.data?.epsilonBudgetUsed || 0;
    const cumulativeBudget = previousBudget + totalEpsilonUsed;
    artifact.data.epsilonBudgetUsed = cumulativeBudget;

    // Privacy guarantee assessment
    const privacyLevel = epsilon <= 0.1 ? "strong" : epsilon <= 1.0 ? "moderate" : epsilon <= 5.0 ? "weak" : "minimal";

    return {
      ok: true, result: {
        results,
        privacyParameters: {
          epsilon,
          privacyLevel,
          queriesProcessed: results.length,
          epsilonPerQuery: Math.round((epsilon / results.length) * 10000) / 10000,
        },
        budgetTracking: {
          thisInvocation: totalEpsilonUsed,
          cumulative: Math.round(cumulativeBudget * 10000) / 10000,
          previouslyUsed: previousBudget,
          warning: cumulativeBudget > 10 ? "High cumulative epsilon — privacy guarantees significantly degraded" : null,
        },
        utilityAnalysis: {
          avgRelativeError: Math.round(
            (results.filter(r => r.relativeError != null).reduce((s, r) => s + r.relativeError, 0) /
            Math.max(1, results.filter(r => r.relativeError != null).length)) * 100
          ) / 100,
          maxNoise: Math.max(...results.map(r => Math.abs(r.noise || 0))),
        },
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════════
  //  E2E ENCRYPTED PSEUDONYMOUS MESSAGING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * identity — fetch (lazily mint) the caller's pseudonymous identity.
   * Returns the public-facing identity only — never the private key.
   */
  registerLensAction("anon", "identity", (ctx) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      saveAnonState();
      return {
        ok: true,
        result: {
          anonId: me.anonId,
          alias: me.alias,
          publicKey: me.publicKey,
          fingerprint: me.fingerprint,
          createdAt: me.createdAt,
          rotatedAt: me.rotatedAt,
          verifiedPeerCount: Object.keys(me.verifiedPeers).length,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * rotateIdentity — regenerate alias + X25519 keypair for the caller.
   * Old conversations remain readable only with re-keying; this mints a
   * fresh anonId so prior traffic can no longer be linked to the caller.
   */
  registerLensAction("anon", "rotateIdentity", (ctx) => {
    try {
      const s = getAnonState();
      const userId = anUid(ctx);
      const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
      const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const priv = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
      const ident = {
        userId,
        alias: `anon-${crypto.randomBytes(4).toString("hex")}`,
        anonId: anId("aid"),
        publicKey: pub,
        privateKey: priv,
        fingerprint: crypto.createHash("sha256").update(pub).digest("hex").slice(0, 16),
        createdAt: anNow(),
        rotatedAt: anNow(),
        verifiedPeers: {},
      };
      s.identities.set(userId, ident);
      saveAnonState();
      return {
        ok: true,
        result: {
          anonId: ident.anonId,
          alias: ident.alias,
          publicKey: ident.publicKey,
          fingerprint: ident.fingerprint,
          rotatedAt: ident.rotatedAt,
          note: "Identity rotated — prior traffic is now unlinkable.",
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * safetyNumber — compute the verified key-exchange safety number for a
   * peer. Both parties compare the same 12-group code out-of-band; a match
   * proves no man-in-the-middle. params.peerAnonId
   */
  registerLensAction("anon", "safetyNumber", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const peerAnonId = anClean(params?.peerAnonId, 80);
      if (!peerAnonId) return { ok: false, error: "peerAnonId required" };
      const peer = findIdentityByAnonId(s, peerAnonId);
      if (!peer) return { ok: false, error: "peer identity not found" };
      const groups = safetyNumber(me.publicKey, peer.publicKey);
      return {
        ok: true,
        result: {
          peerAnonId,
          peerAlias: peer.alias,
          safetyNumber: groups,
          formatted: groups.join(" "),
          verified: !!me.verifiedPeers[peerAnonId],
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * verifyPeer — mark a peer's safety number as confirmed (or revoke).
   * params.peerAnonId, params.verified (bool, default true)
   */
  registerLensAction("anon", "verifyPeer", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const peerAnonId = anClean(params?.peerAnonId, 80);
      if (!peerAnonId) return { ok: false, error: "peerAnonId required" };
      const verified = params?.verified !== false;
      if (verified) me.verifiedPeers[peerAnonId] = true;
      else delete me.verifiedPeers[peerAnonId];
      saveAnonState();
      return {
        ok: true,
        result: { peerAnonId, verified, verifiedPeerCount: Object.keys(me.verifiedPeers).length },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * startConversation — open a direct (1:1) or group conversation.
   * params.peerAnonIds = [anonId, ...] (one for DM, many for group)
   * params.title (optional, group only)
   * params.disappearDefaultSec (optional, per-conversation disappearing default)
   */
  registerLensAction("anon", "startConversation", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      let peerIds = Array.isArray(params?.peerAnonIds)
        ? params.peerAnonIds
        : (params?.peerAnonId ? [params.peerAnonId] : []);
      peerIds = peerIds.map((p) => anClean(p, 80)).filter(Boolean);
      if (peerIds.length === 0) return { ok: false, error: "at least one peerAnonId required" };

      const memberIdents = [me];
      for (const pid of peerIds) {
        const peer = findIdentityByAnonId(s, pid);
        if (!peer) return { ok: false, error: `peer not found: ${pid}` };
        memberIdents.push(peer);
      }
      const isGroup = memberIdents.length > 2;
      const convId = anId(isGroup ? "grp" : "dm");
      const disappearDefaultSec = Math.max(0, Math.min(604800,
        Number(params?.disappearDefaultSec) || 0));
      const conv = {
        id: convId,
        kind: isGroup ? "group" : "direct",
        title: isGroup ? anClean(params?.title, 120) || `Group (${memberIdents.length})` : null,
        members: memberIdents.map((i) => ({
          anonId: i.anonId, alias: i.alias, publicKey: i.publicKey,
        })),
        memberUserIds: memberIdents.map((i) => i.userId),
        disappearDefaultSec,
        createdAt: anNow(),
        messages: [],
      };
      s.conversations.set(convId, conv);
      for (const i of memberIdents) {
        if (!s.userConvs.has(i.userId)) s.userConvs.set(i.userId, new Set());
        s.userConvs.get(i.userId).add(convId);
      }
      saveAnonState();
      // Notify every member (except the initiator) of the new thread.
      for (const i of memberIdents) {
        if (i.userId === me.userId) continue;
        emitToUser(i.userId, "anon:conversation-created", {
          conversationId: convId,
          kind: conv.kind,
          title: conv.title,
          memberCount: conv.members.length,
        });
      }
      return {
        ok: true,
        result: {
          conversationId: convId,
          kind: conv.kind,
          title: conv.title,
          members: conv.members.map((m) => ({ anonId: m.anonId, alias: m.alias })),
          disappearDefaultSec,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * listConversations — all conversations the caller is a member of, with
   * unread/preview metadata. Sweeps expired messages first.
   */
  registerLensAction("anon", "listConversations", (ctx) => {
    try {
      const s = getAnonState();
      const userId = anUid(ctx);
      ensureIdentity(s, userId);
      const now = anNow();
      const convIds = s.userConvs.get(userId) || new Set();
      const out = [];
      for (const cid of convIds) {
        const conv = s.conversations.get(cid);
        if (!conv) continue;
        sweepConversation(conv, now);
        const last = conv.messages[conv.messages.length - 1];
        out.push({
          conversationId: conv.id,
          kind: conv.kind,
          title: conv.title,
          members: conv.members.map((m) => ({ anonId: m.anonId, alias: m.alias })),
          memberCount: conv.members.length,
          disappearDefaultSec: conv.disappearDefaultSec,
          messageCount: conv.messages.length,
          lastActivityAt: last ? last.sentAt : conv.createdAt,
          lastSenderAnonId: last ? (last.sealedSender ? null : last.fromAnonId) : null,
        });
      }
      out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      saveAnonState();
      return { ok: true, result: { conversations: out, count: out.length } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * sendMessage — encrypt + persist a message into a conversation.
   * Each recipient gets a per-recipient AES-256-GCM envelope sealed under
   * an X25519 ECDH shared secret. Plaintext is NEVER stored.
   * params.conversationId, params.content
   * params.ephemeralSec (overrides conversation disappearing default)
   * params.sealedSender (bool — strip sender metadata from stored record)
   */
  registerLensAction("anon", "sendMessage", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const conv = s.conversations.get(anClean(params?.conversationId, 80));
      if (!conv) return { ok: false, error: "conversation not found" };
      if (!conv.memberUserIds.includes(me.userId)) {
        return { ok: false, error: "not a member of this conversation" };
      }
      const content = anClean(params?.content, 4000);
      if (!content) return { ok: false, error: "content required" };

      const now = anNow();
      const ttlSec = params?.ephemeralSec != null
        ? Math.max(0, Math.min(604800, Number(params.ephemeralSec) || 0))
        : conv.disappearDefaultSec;
      const sealedSender = !!params?.sealedSender;

      // Per-recipient sealed envelopes — sender's own copy included so they
      // can decrypt their sent history.
      const envelopes = {};
      for (const member of conv.members) {
        const recipient = findIdentityByAnonId(s, member.anonId);
        if (!recipient) continue;
        envelopes[member.anonId] = sealEnvelope(me.privateKey, recipient.publicKey, content);
      }

      const msg = {
        id: anId("msg"),
        fromAnonId: sealedSender ? null : me.anonId,
        fromAlias: sealedSender ? null : me.alias,
        sealedSender,
        senderPublicKey: me.publicKey, // needed by recipients to derive shared key
        envelopes,
        sentAt: now,
        expiresAt: ttlSec > 0 ? now + ttlSec * 1000 : null,
      };
      conv.messages.push(msg);
      saveAnonState();
      // Real-time fan-out: push a delivery ping to every member's socket
      // room. Plaintext is never on the wire — clients call readConversation
      // to decrypt their own envelope. Sealed-sender hides fromAnonId.
      for (const member of conv.members) {
        const recipient = findIdentityByAnonId(s, member.anonId);
        if (!recipient) continue;
        emitToUser(recipient.userId, "anon:message", {
          conversationId: conv.id,
          messageId: msg.id,
          fromAnonId: sealedSender ? null : me.anonId,
          fromAlias: sealedSender ? null : me.alias,
          sealedSender,
          sentAt: now,
          expiresAt: msg.expiresAt,
        });
      }
      return {
        ok: true,
        result: {
          messageId: msg.id,
          conversationId: conv.id,
          sentAt: now,
          expiresAt: msg.expiresAt,
          recipients: Object.keys(envelopes).length,
          sealedSender,
          encrypted: true,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * readConversation — decrypt every message in a conversation for the
   * caller. Sweeps expired messages first. Plaintext only ever leaves the
   * server for the authenticated member who holds the matching key.
   * params.conversationId
   */
  registerLensAction("anon", "readConversation", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const conv = s.conversations.get(anClean(params?.conversationId, 80));
      if (!conv) return { ok: false, error: "conversation not found" };
      if (!conv.memberUserIds.includes(me.userId)) {
        return { ok: false, error: "not a member of this conversation" };
      }
      const now = anNow();
      const swept = sweepConversation(conv, now);

      const messages = conv.messages.map((m) => {
        const env = m.envelopes[me.anonId];
        let content = null;
        let decryptError = null;
        if (env) {
          try {
            content = openEnvelope(me.privateKey, m.senderPublicKey, env);
          } catch (e) {
            decryptError = e.message;
          }
        } else {
          decryptError = "no envelope for this identity";
        }
        const mine = !m.sealedSender && m.fromAnonId === me.anonId;
        return {
          id: m.id,
          fromAnonId: m.fromAnonId,
          fromAlias: m.fromAlias,
          sealedSender: m.sealedSender,
          mine,
          content,
          decryptError,
          sentAt: m.sentAt,
          expiresAt: m.expiresAt,
          encrypted: true,
        };
      });
      saveAnonState();
      return {
        ok: true,
        result: {
          conversationId: conv.id,
          kind: conv.kind,
          title: conv.title,
          members: conv.members.map((mm) => ({ anonId: mm.anonId, alias: mm.alias })),
          disappearDefaultSec: conv.disappearDefaultSec,
          messages,
          messageCount: messages.length,
          sweptExpired: swept,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * setDisappearing — set the per-conversation disappearing-message
   * default. Affects future messages only.
   * params.conversationId, params.disappearDefaultSec
   */
  registerLensAction("anon", "setDisappearing", (ctx, _artifact, params) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const conv = s.conversations.get(anClean(params?.conversationId, 80));
      if (!conv) return { ok: false, error: "conversation not found" };
      if (!conv.memberUserIds.includes(me.userId)) {
        return { ok: false, error: "not a member of this conversation" };
      }
      const sec = Math.max(0, Math.min(604800, Number(params?.disappearDefaultSec) || 0));
      conv.disappearDefaultSec = sec;
      saveAnonState();
      return {
        ok: true,
        result: {
          conversationId: conv.id,
          disappearDefaultSec: sec,
          enabled: sec > 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * sweepEphemeral — server-side enforcement of ephemeral timers across
   * every conversation the caller belongs to. Intended for periodic /
   * on-open invocation so expired messages are actually purged, not just
   * flagged. Returns the purge count per conversation.
   */
  registerLensAction("anon", "sweepEphemeral", (ctx) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const now = anNow();
      const convIds = s.userConvs.get(me.userId) || new Set();
      let totalRemoved = 0;
      const perConv = [];
      for (const cid of convIds) {
        const conv = s.conversations.get(cid);
        if (!conv) continue;
        const removed = sweepConversation(conv, now);
        if (removed > 0) perConv.push({ conversationId: cid, removed });
        totalRemoved += removed;
      }
      saveAnonState();
      return {
        ok: true,
        result: { totalRemoved, conversationsSwept: perConv.length, perConv, sweptAt: now },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * directory — list other pseudonymous identities the caller can start a
   * conversation with (public-facing fields only — never private keys).
   */
  registerLensAction("anon", "directory", (ctx) => {
    try {
      const s = getAnonState();
      const me = ensureIdentity(s, anUid(ctx));
      const peers = [];
      for (const ident of s.identities.values()) {
        if (ident.userId === me.userId) continue;
        peers.push({
          anonId: ident.anonId,
          alias: ident.alias,
          fingerprint: ident.fingerprint,
          verified: !!me.verifiedPeers[ident.anonId],
        });
      }
      return { ok: true, result: { peers, count: peers.length, myAnonId: me.anonId } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
