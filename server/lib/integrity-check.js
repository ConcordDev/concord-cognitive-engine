/**
 * Data Integrity Audit & Repair System
 *
 * Detects and fixes silent corruption caused by swallowed errors.
 * All functions are pure — they take STATE as a parameter and never
 * import it globally.  No side effects on import.
 *
 * STATE shape (Maps unless noted):
 *   dtus              Map<id, dtu>          — dtu.lineage = {parents:[], children:[]} | []
 *   lensArtifacts     Map<id, artifact>     — artifact.domain, artifact.data.dtuId
 *   lensDomainIndex   Map<domain, Set<id>>  — O(1) domain→artifact lookup
 *   _social           { profiles: Map, follows: Map<uid,Set>, followers: Map<uid,Set>,
 *                       publicDtus: Set, citedBy: Map<dtuId,Set<citingId>> }
 *   wallets           Map<walletId, {balance, …}>         (credits/quest system)
 *   economic          { wallets: Map<odId, {balance,…}>, treasury: number, … }
 *   users             Map<userId, user>
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LENS_DOMAIN_KEYWORDS_KEYS = [
  "philosophy", "psychology", "science", "technology", "mathematics",
  "history", "economics", "politics", "art", "music", "literature",
  "education", "health", "environment", "religion", "sociology",
  "law", "engineering", "biology", "physics", "chemistry", "medicine",
  "linguistics", "anthropology", "geography", "astronomy", "logic",
  "ethics", "aesthetics", "epistemology", "metaphysics", "ontology",
  "neuroscience", "ai", "ml", "design", "architecture", "film",
  "games", "sports", "food", "travel", "business", "finance",
  "marketing", "security", "privacy", "governance", "culture",
];

/**
 * Extract the parent IDs from a DTU's lineage field.
 * Lineage can be:
 *   - { parents: [...], children: [...] }   (object form)
 *   - [parentId, ...]                       (array form)
 *   - undefined / null
 */
function getParentIds(dtu) {
  if (!dtu) return [];
  // Explicit parentId field
  const explicit = dtu.parentId ? [dtu.parentId] : [];
  const lineage = dtu.lineage;
  if (!lineage) return explicit;
  if (Array.isArray(lineage)) return [...new Set([...explicit, ...lineage])];
  if (Array.isArray(lineage.parents)) return [...new Set([...explicit, ...lineage.parents])];
  return explicit;
}

/**
 * Extract domains a DTU should be synced to (tags that match known domain keywords).
 */
function getDtuDomains(dtu) {
  if (!dtu || !Array.isArray(dtu.tags)) return [];
  return dtu.tags.filter(t => LENS_DOMAIN_KEYWORDS_KEYS.includes(t));
}

/**
 * Default no-op logger matching the project's structuredLog(level, event, data) pattern.
 */
function noop() {}

function makeLog(externalLog) {
  if (typeof externalLog === "function") return externalLog;
  // Accept the project's logger object (logger.info(source, msg, meta))
  if (externalLog && typeof externalLog.info === "function") {
    return (level, event, data) => {
      const fn = externalLog[level] || externalLog.info;
      fn("integrity-check", event, data);
    };
  }
  return noop;
}

// ---------------------------------------------------------------------------
// Cooperative execution. The audits/fixes below are generators that call `tick()` once per item and `yield`
// when it says so. runIntegrityCheck (sync) drives them with a tick that never yields, so its behaviour is
// unchanged; runIntegrityCheckAsync drives the SAME bodies with a time-sliced tick and hands the event loop
// back between slices. The periodic integrity check used to run synchronously on the main thread for 8-12 s
// (its first staggered fire lands ~60-75 s after every boot), freezing the whole backend.
// ---------------------------------------------------------------------------
const NEVER = () => false;

/** Run a generator to completion synchronously and return its return value. */
function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}


// ---------------------------------------------------------------------------
// AUDIT FUNCTIONS  (read-only — never mutate STATE)
// ---------------------------------------------------------------------------

/**
 * 1. auditEconomy — check wallet balances and vault/treasury backing.
 *
 * Two wallet systems exist:
 *   STATE.wallets          — credits/quest wallets  (walletId → {balance, …})
 *   STATE.economic.wallets — marketplace wallets     (odId → {balance, …})
 *
 * Returns { negativeBalances: [], circulatingSupply, treasury, vaultDeficit }
 */
function auditEconomy(STATE) {
  const findings = {
    negativeBalances: [],       // { source, id, balance }
    circulatingSupply: 0,
    treasury: 0,
    vaultDeficit: 0,            // positive = under-backed
    ok: true,
  };

  // -- Credits wallets (STATE.wallets) --
  const creditsWallets = STATE.wallets;
  if (creditsWallets && typeof creditsWallets.forEach === "function") {
    creditsWallets.forEach((wallet, id) => {
      const bal = wallet.balance ?? 0;
      if (bal < 0) {
        findings.negativeBalances.push({ source: "credits", id, balance: bal });
      }
      findings.circulatingSupply += bal;
    });
  }

  // -- Economic wallets (STATE.economic.wallets) --
  const eco = STATE.economic;
  if (eco) {
    const ecoWallets = eco.wallets;
    if (ecoWallets && typeof ecoWallets.forEach === "function") {
      ecoWallets.forEach((wallet, id) => {
        const bal = wallet.balance ?? 0;
        if (bal < 0) {
          findings.negativeBalances.push({ source: "economic", id, balance: bal });
        }
        findings.circulatingSupply += bal;
      });
    }
    findings.treasury = eco.treasury ?? 0;
    findings.circulatingSupply += findings.treasury;
  }

  // A negative deficit means the vault is over-backed (surplus).
  // We don't have a separate vault balance — treasury IS the backing reserve.
  // So deficit = circulatingSupply - treasury (how much more is circulating
  // than the treasury can back).  In a healthy system this equals the wallet totals.
  findings.vaultDeficit = findings.circulatingSupply - findings.treasury;

  if (findings.negativeBalances.length > 0) findings.ok = false;

  return findings;
}

/**
 * 2. auditLineage — orphaned parents + broken citations.
 *
 * Returns {
 *   orphanedLineage: [{ dtuId, missingParentId }],
 *   brokenCitations: [{ citedDtuId, citingDtuId, missing: "cited"|"citing" }]
 * }
 */
function* auditLineageGen(STATE, tick) {
  const findings = {
    orphanedLineage: [],
    brokenCitations: [],
    ok: true,
  };

  const dtus = STATE.dtus;
  if (!dtus) return findings;

  // -- Orphaned lineage (parent DTU doesn't exist) --
  for (const [id, dtu] of dtus) {
    const parents = getParentIds(dtu);
    for (const parentId of parents) {
      if (parentId && !dtus.has(parentId)) {
        findings.orphanedLineage.push({ dtuId: id, missingParentId: parentId });
      }
    }
    if (tick()) yield;
  }

  // -- Broken citations (social layer) --
  const social = STATE._social;
  if (social && social.citedBy) {
    for (const [citedDtuId, citers] of social.citedBy) {
      if (tick()) yield;
      if (!dtus.has(citedDtuId)) {
        for (const citingId of citers) {
          findings.brokenCitations.push({ citedDtuId, citingDtuId: citingId, missing: "cited" });
        }
      } else {
        for (const citingId of citers) {
          if (!dtus.has(citingId)) {
            findings.brokenCitations.push({ citedDtuId, citingDtuId: citingId, missing: "citing" });
          }
        }
      }
    }
  }

  if (findings.orphanedLineage.length > 0 || findings.brokenCitations.length > 0) {
    findings.ok = false;
  }

  return findings;
}

function auditLineage(STATE) { return runSync(auditLineageGen(STATE, NEVER)); }

/**
 * 3. auditLensSync — DTUs tagged with domains but missing from lens artifacts.
 *
 * Returns { unsynced: [{ dtuId, domain, expectedArtifactId }] }
 */
function* auditLensSyncGen(STATE, tick) {
  const findings = {
    unsynced: [],
    ok: true,
  };

  const dtus = STATE.dtus;
  const lensArtifacts = STATE.lensArtifacts;
  if (!dtus || !lensArtifacts) return findings;

  for (const [id, dtu] of dtus) {
    const domains = getDtuDomains(dtu);
    for (const domain of domains) {
      const expectedKey = `dtu_lens_${domain}_${id}`;
      if (!lensArtifacts.has(expectedKey)) {
        findings.unsynced.push({ dtuId: id, domain, expectedArtifactId: expectedKey });
      }
    }
    if (tick()) yield;
  }

  if (findings.unsynced.length > 0) findings.ok = false;

  return findings;
}

function auditLensSync(STATE) { return runSync(auditLensSyncGen(STATE, NEVER)); }

/**
 * 4. auditSocial — asymmetric follows + ghost follows.
 *
 * Returns {
 *   asymmetric: [{ followerId, followedId, direction }],
 *   ghostFollows: [{ followerId, followedId, reason }]
 * }
 */
function auditSocial(STATE) {
  const findings = {
    asymmetric: [],
    ghostFollows: [],
    ok: true,
  };

  const social = STATE._social;
  if (!social) return findings;

  const follows = social.follows;      // userId → Set<followedUserId>
  const followers = social.followers;    // userId → Set<followerUserId>
  const profiles = social.profiles;      // userId → profile

  if (!follows || !followers) return findings;

  // Check every follow relationship for symmetry and existence
  for (const [followerId, followedSet] of follows) {
    for (const followedId of followedSet) {
      // Ghost: followed user has no profile
      if (profiles && !profiles.has(followedId)) {
        findings.ghostFollows.push({
          followerId,
          followedId,
          reason: "followed_user_no_profile",
        });
      }

      // Asymmetric: A follows B but B's followers set doesn't include A
      const reverseSet = followers.get(followedId);
      if (!reverseSet || !reverseSet.has(followerId)) {
        findings.asymmetric.push({
          followerId,
          followedId,
          direction: "follows_missing_from_followers",
        });
      }
    }
  }

  // Reverse check: B has A as follower but A's follows set doesn't include B
  for (const [followedId, followerSet] of followers) {
    for (const followerId of followerSet) {
      const forwardSet = follows.get(followerId);
      if (!forwardSet || !forwardSet.has(followedId)) {
        findings.asymmetric.push({
          followerId,
          followedId,
          direction: "followers_missing_from_follows",
        });
      }
    }
  }

  if (findings.asymmetric.length > 0 || findings.ghostFollows.length > 0) {
    findings.ok = false;
  }

  return findings;
}

// ---------------------------------------------------------------------------
// FIX FUNCTIONS  (mutate STATE to repair, log every change)
// ---------------------------------------------------------------------------

/**
 * 5. fixNegativeBalances — set negative wallet balances to 0.
 */
function fixNegativeBalances(STATE, log) {
  const emit = makeLog(log);
  let fixed = 0;

  // Credits wallets
  const creditsWallets = STATE.wallets;
  if (creditsWallets && typeof creditsWallets.forEach === "function") {
    creditsWallets.forEach((wallet, id) => {
      if ((wallet.balance ?? 0) < 0) {
        const oldBalance = wallet.balance;
        wallet.balance = 0;
        fixed++;
        emit("warn", "integrity_fix_negative_balance", {
          source: "credits", walletId: id, oldBalance, newBalance: 0,
        });
      }
    });
  }

  // Economic wallets
  const eco = STATE.economic;
  if (eco && eco.wallets && typeof eco.wallets.forEach === "function") {
    eco.wallets.forEach((wallet, id) => {
      if ((wallet.balance ?? 0) < 0) {
        const oldBalance = wallet.balance;
        wallet.balance = 0;
        fixed++;
        emit("warn", "integrity_fix_negative_balance", {
          source: "economic", walletId: id, oldBalance, newBalance: 0,
        });
      }
    });
  }

  return { fixed };
}

/**
 * 6. fixOrphanedLineage — remove references to non-existent parent DTUs.
 */
function* fixOrphanedLineageGen(STATE, orphans, log, tick) {
  const emit = makeLog(log);
  let fixed = 0;
  const dtus = STATE.dtus;
  if (!dtus) return { fixed };

  for (const { dtuId, missingParentId } of orphans) {
    if (tick()) yield;
    const dtu = dtus.get(dtuId);
    if (!dtu) continue;

    // Remove from parentId field
    if (dtu.parentId === missingParentId) {
      dtu.parentId = null;
      fixed++;
      emit("warn", "integrity_fix_orphaned_parentId", {
        dtuId, removedParentId: missingParentId,
      });
    }

    // Remove from lineage array or object
    if (Array.isArray(dtu.lineage)) {
      const idx = dtu.lineage.indexOf(missingParentId);
      if (idx !== -1) {
        dtu.lineage.splice(idx, 1);
        fixed++;
        emit("warn", "integrity_fix_orphaned_lineage_array", {
          dtuId, removedParentId: missingParentId,
        });
      }
    } else if (dtu.lineage && Array.isArray(dtu.lineage.parents)) {
      const idx = dtu.lineage.parents.indexOf(missingParentId);
      if (idx !== -1) {
        dtu.lineage.parents.splice(idx, 1);
        fixed++;
        emit("warn", "integrity_fix_orphaned_lineage_parents", {
          dtuId, removedParentId: missingParentId,
        });
      }
    }
  }

  return { fixed };
}
function fixOrphanedLineage(STATE, orphans, log) { return runSync(fixOrphanedLineageGen(STATE, orphans, log, NEVER)); }

/**
 * 7. fixBrokenCitations — remove dead citation entries from _social.citedBy.
 *    If all citations for a given DTU are removed, it is effectively "original" now.
 */
function* fixBrokenCitationsGen(STATE, broken, log, tick) {
  const emit = makeLog(log);
  let fixed = 0;
  let entriesCleared = 0;

  const social = STATE._social;
  if (!social || !social.citedBy) return { fixed, entriesCleared };

  for (const { citedDtuId, citingDtuId, missing } of broken) {
    if (tick()) yield;
    if (missing === "cited") {
      // The cited DTU itself is gone — remove the entire entry
      if (social.citedBy.has(citedDtuId)) {
        const size = social.citedBy.get(citedDtuId).size;
        social.citedBy.delete(citedDtuId);
        entriesCleared++;
        fixed += size;
        emit("warn", "integrity_fix_broken_citation_entry_removed", {
          citedDtuId, removedCiters: size,
        });
      }
    } else if (missing === "citing") {
      // The citing DTU is gone — just remove that one reference
      const citers = social.citedBy.get(citedDtuId);
      if (citers && citers.has(citingDtuId)) {
        citers.delete(citingDtuId);
        fixed++;
        emit("warn", "integrity_fix_broken_citation_ref_removed", {
          citedDtuId, removedCitingDtuId: citingDtuId,
        });

        // If no citations remain, clean up the entry
        if (citers.size === 0) {
          social.citedBy.delete(citedDtuId);
          entriesCleared++;
          emit("info", "integrity_citation_entry_empty_cleared", {
            citedDtuId,
          });
        }
      }
    }
  }

  return { fixed, entriesCleared };
}
function fixBrokenCitations(STATE, broken, log) { return runSync(fixBrokenCitationsGen(STATE, broken, log, NEVER)); }

/**
 * 8. fixUnsyncedLens — create missing lens artifacts for DTUs that have domain tags.
 */
function* fixUnsyncedLensGen(STATE, unsynced, log, tick) {
  const emit = makeLog(log);
  let fixed = 0;

  const dtus = STATE.dtus;
  const lensArtifacts = STATE.lensArtifacts;
  const lensDomainIndex = STATE.lensDomainIndex;
  if (!dtus || !lensArtifacts) return { fixed };

  for (const { dtuId, domain, expectedArtifactId } of unsynced) {
    if (tick()) yield;
    // Skip if it appeared between audit and fix
    if (lensArtifacts.has(expectedArtifactId)) continue;

    const dtu = dtus.get(dtuId);
    if (!dtu) continue;

    const artifact = {
      id: expectedArtifactId,
      domain,
      type: dtu.tier || "regular",
      ownerId: dtu.createdBy || dtu.entityId || "system",
      title: dtu.title || "Untitled DTU",
      data: {
        dtuId: dtu.id,
        summary: dtu.human?.summary || dtu.cretiHuman || "",
        tier: dtu.tier || "regular",
        claims: (dtu.core?.claims || []).slice(0, 5),
        definitions: (dtu.core?.definitions || []).slice(0, 3),
      },
      meta: {
        tags: dtu.tags || [],
        status: "published",
        visibility: "public",
        scope: dtu.scope || "local",
        createdFrom: "integrity-repair",
      },
      createdAt: dtu.createdAt || new Date().toISOString(),
      updatedAt: dtu.updatedAt || dtu.createdAt || new Date().toISOString(),
      version: 1,
    };

    lensArtifacts.set(expectedArtifactId, artifact);

    // Update lensDomainIndex if available
    if (lensDomainIndex) {
      if (!lensDomainIndex.has(domain)) {
        lensDomainIndex.set(domain, new Set());
      }
      lensDomainIndex.get(domain).add(expectedArtifactId);
    }

    fixed++;
    emit("info", "integrity_fix_lens_sync", {
      dtuId, domain, artifactId: expectedArtifactId,
    });
  }

  return { fixed };
}
function fixUnsyncedLens(STATE, unsynced, log) { return runSync(fixUnsyncedLensGen(STATE, unsynced, log, NEVER)); }

/**
 * 9. fixAsymmetricFollows — repair bidirectional follow index + remove ghosts.
 */
function fixAsymmetricFollows(STATE, issues, log) {
  const emit = makeLog(log);
  let symmetryFixed = 0;
  let ghostsRemoved = 0;

  const social = STATE._social;
  if (!social) return { symmetryFixed, ghostsRemoved };

  const follows = social.follows;
  const followers = social.followers;
  if (!follows || !followers) return { symmetryFixed, ghostsRemoved };

  // -- Remove ghost follows first --
  if (issues.ghostFollows) {
    for (const { followerId, followedId } of issues.ghostFollows) {
      // Remove from follows
      const fSet = follows.get(followerId);
      if (fSet && fSet.has(followedId)) {
        fSet.delete(followedId);
        ghostsRemoved++;
        emit("warn", "integrity_fix_ghost_follow_removed", {
          followerId, followedId,
        });
      }
      // Also remove from followers (shouldn't exist, but be safe)
      const rSet = followers.get(followedId);
      if (rSet && rSet.has(followerId)) {
        rSet.delete(followerId);
      }
    }
  }

  // -- Fix asymmetric follows --
  if (issues.asymmetric) {
    for (const { followerId, followedId, direction } of issues.asymmetric) {
      // Skip if this was a ghost follow we already removed
      if (issues.ghostFollows?.some(g => g.followerId === followerId && g.followedId === followedId)) {
        continue;
      }

      if (direction === "follows_missing_from_followers") {
        // A follows B but B's followers doesn't have A → add A to B's followers
        if (!followers.has(followedId)) followers.set(followedId, new Set());
        if (!followers.get(followedId).has(followerId)) {
          followers.get(followedId).add(followerId);
          symmetryFixed++;
          emit("info", "integrity_fix_asymmetric_add_follower", {
            followerId, followedId,
          });
        }
      } else if (direction === "followers_missing_from_follows") {
        // B has A in followers but A's follows doesn't have B → add B to A's follows
        if (!follows.has(followerId)) follows.set(followerId, new Set());
        if (!follows.get(followerId).has(followedId)) {
          follows.get(followerId).add(followedId);
          symmetryFixed++;
          emit("info", "integrity_fix_asymmetric_add_follow", {
            followerId, followedId,
          });
        }
      }
    }
  }

  // Recompute totalFollows metric
  let totalFollows = 0;
  for (const [, fSet] of follows) totalFollows += fSet.size;
  social.metrics = social.metrics || {};
  social.metrics.totalFollows = totalFollows;

  return { symmetryFixed, ghostsRemoved };
}

// ---------------------------------------------------------------------------
// ORCHESTRATOR
// ---------------------------------------------------------------------------

/**
 * 10. runIntegrityCheck — run all audits, optionally apply fixes, return summary.
 *
 * @param {object} STATE     — the global Concord state object
 * @param {function|object} log — structuredLog function or logger object
 * @param {object} options   — { fix: boolean, verbose: boolean }
 * @returns {object}         — summary with counts of issues found and fixed
 */
function* integrityCheckGen(STATE, log, options, tick) {
  const { fix = false, verbose = false } = options;
  const emit = makeLog(log);
  const startMs = Date.now();

  emit("info", "integrity_check_start", { fix, verbose });

  // ── Run all audits ────────────────────────────────────────────────────
  const economy = auditEconomy(STATE);
  const lineage = yield* auditLineageGen(STATE, tick);
  const lensSync = yield* auditLensSyncGen(STATE, tick);
  const social = auditSocial(STATE);

  const issuesFound = {
    negativeBalances: economy.negativeBalances.length,
    orphanedLineage: lineage.orphanedLineage.length,
    brokenCitations: lineage.brokenCitations.length,
    unsyncedLens: lensSync.unsynced.length,
    asymmetricFollows: social.asymmetric.length,
    ghostFollows: social.ghostFollows.length,
  };

  const totalIssues = Object.values(issuesFound).reduce((a, b) => a + b, 0);

  if (verbose) {
    emit("info", "integrity_audit_complete", {
      issuesFound,
      totalIssues,
      economy: {
        circulatingSupply: economy.circulatingSupply,
        treasury: economy.treasury,
        vaultDeficit: economy.vaultDeficit,
      },
    });
  }

  // ── Apply fixes if requested ──────────────────────────────────────────
  const issuesFixed = {
    negativeBalances: 0,
    orphanedLineage: 0,
    brokenCitations: 0,
    brokenCitationEntriesCleared: 0,
    unsyncedLens: 0,
    symmetryFixed: 0,
    ghostsRemoved: 0,
  };

  if (fix && totalIssues > 0) {
    emit("info", "integrity_fix_start", { totalIssues });

    if (economy.negativeBalances.length > 0) {
      const r = fixNegativeBalances(STATE, log);
      issuesFixed.negativeBalances = r.fixed;
    }

    if (lineage.orphanedLineage.length > 0) {
      const r = yield* fixOrphanedLineageGen(STATE, lineage.orphanedLineage, log, tick);
      issuesFixed.orphanedLineage = r.fixed;
    }

    if (lineage.brokenCitations.length > 0) {
      const r = yield* fixBrokenCitationsGen(STATE, lineage.brokenCitations, log, tick);
      issuesFixed.brokenCitations = r.fixed;
      issuesFixed.brokenCitationEntriesCleared = r.entriesCleared;
    }

    if (lensSync.unsynced.length > 0) {
      const r = yield* fixUnsyncedLensGen(STATE, lensSync.unsynced, log, tick);
      issuesFixed.unsyncedLens = r.fixed;
    }

    if (social.asymmetric.length > 0 || social.ghostFollows.length > 0) {
      const r = fixAsymmetricFollows(STATE, social, log);
      issuesFixed.symmetryFixed = r.symmetryFixed;
      issuesFixed.ghostsRemoved = r.ghostsRemoved;
    }

    emit("info", "integrity_fix_complete", { issuesFixed });
  }

  const elapsedMs = Date.now() - startMs;

  const summary = {
    ok: totalIssues === 0,
    timestamp: new Date().toISOString(),
    elapsedMs,
    fixApplied: fix && totalIssues > 0,
    issuesFound,
    totalIssues,
    issuesFixed,
    audits: {
      economy: {
        ok: economy.ok,
        negativeBalances: economy.negativeBalances,
        circulatingSupply: economy.circulatingSupply,
        treasury: economy.treasury,
        vaultDeficit: economy.vaultDeficit,
      },
      lineage: {
        ok: lineage.ok,
        orphanedCount: lineage.orphanedLineage.length,
        brokenCitationCount: lineage.brokenCitations.length,
        ...(verbose ? { orphanedLineage: lineage.orphanedLineage, brokenCitations: lineage.brokenCitations } : {}),
      },
      lensSync: {
        ok: lensSync.ok,
        unsyncedCount: lensSync.unsynced.length,
        ...(verbose ? { unsynced: lensSync.unsynced } : {}),
      },
      social: {
        ok: social.ok,
        asymmetricCount: social.asymmetric.length,
        ghostFollowCount: social.ghostFollows.length,
        ...(verbose ? { asymmetric: social.asymmetric, ghostFollows: social.ghostFollows } : {}),
      },
    },
  };

  emit("info", "integrity_check_complete", {
    ok: summary.ok,
    totalIssues,
    fixApplied: summary.fixApplied,
    elapsedMs,
  });

  return summary;
}


/** Synchronous run (startup + any caller that needs the result inline). Behaviour unchanged. */
export function runIntegrityCheck(STATE, log, options = {}) {
  return runSync(integrityCheckGen(STATE, log, options, NEVER));
}

/**
 * Time-sliced run: the identical audits and fixes, but the event loop is handed back whenever a slice has used
 * `sliceMs` of wall time (checked every `checkEvery` items), so no single synchronous span grows with the size of
 * the store. Same result as runIntegrityCheck. Used by the 6-hourly periodic check.
 */
export async function runIntegrityCheckAsync(STATE, log, options = {}, { sliceMs = 25, checkEvery = 256, now = () => performance.now(), yieldLoop = () => new Promise((r) => setImmediate(r)) } = {}) {
  let n = 0;
  let sliceStart = now();
  const tick = () => {
    if ((++n % checkEvery) !== 0) return false;
    return now() - sliceStart >= sliceMs;
  };
  const gen = integrityCheckGen(STATE, log, options, tick);
  let r = gen.next();
  while (!r.done) {
    await yieldLoop();
    sliceStart = now();
    r = gen.next();
  }
  return r.value;
}
