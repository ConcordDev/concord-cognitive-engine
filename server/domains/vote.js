// server/domains/vote.js
// Domain actions for voting and decision-making: multi-method tallying,
// fairness checking, and consensus measurement.

export default function registerVoteActions(registerLensAction) {
  /**
   * tallyVotes
   * Multi-method vote tallying: plurality, Borda count, approval voting,
   * and Condorcet winner detection.
   * artifact.data.ballots = [{ voter?, rankings: string[] }]
   *   — rankings[0] is most preferred, rankings[n-1] is least preferred
   * artifact.data.candidates = string[] (optional, auto-detected)
   * For approval voting: artifact.data.approvals = [{ voter?, approved: string[] }]
   */
  registerLensAction("vote", "tallyVotes", (ctx, artifact, _params) => {
    const ballots = artifact.data?.ballots || [];
    const approvals = artifact.data?.approvals || [];
    if (ballots.length === 0 && approvals.length === 0) {
      return { ok: false, error: "No ballots or approval data provided." };
    }

    const r = (v) => Math.round(v * 1000) / 1000;

    // Detect candidates from ballots
    const candidateSet = new Set(artifact.data?.candidates || []);
    for (const b of ballots) {
      for (const c of (b.rankings || [])) candidateSet.add(c);
    }
    for (const a of approvals) {
      for (const c of (a.approved || [])) candidateSet.add(c);
    }
    const candidates = [...candidateSet];
    const numCandidates = candidates.length;
    const numVoters = Math.max(ballots.length, approvals.length);

    // --- Plurality: first-choice votes ---
    const pluralityCount = {};
    for (const c of candidates) pluralityCount[c] = 0;
    for (const b of ballots) {
      if (b.rankings && b.rankings.length > 0) {
        const first = b.rankings[0];
        if (pluralityCount[first] !== undefined) pluralityCount[first]++;
      }
    }
    const pluralityRanked = Object.entries(pluralityCount)
      .map(([candidate, votes]) => ({ candidate, votes, share: r(numVoters > 0 ? votes / numVoters : 0) }))
      .sort((a, b) => b.votes - a.votes);
    const pluralityWinner = pluralityRanked[0]?.candidate || null;
    const hasMajority = pluralityRanked[0]?.share > 0.5;

    // --- Borda count ---
    const bordaCount = {};
    for (const c of candidates) bordaCount[c] = 0;
    for (const b of ballots) {
      const ranked = b.rankings || [];
      for (let i = 0; i < ranked.length; i++) {
        // Points: (n-1) for first place, (n-2) for second, etc.
        const points = numCandidates - 1 - i;
        if (bordaCount[ranked[i]] !== undefined) bordaCount[ranked[i]] += points;
      }
    }
    const bordaRanked = Object.entries(bordaCount)
      .map(([candidate, points]) => ({ candidate, points }))
      .sort((a, b) => b.points - a.points);
    const bordaWinner = bordaRanked[0]?.candidate || null;

    // --- Approval voting ---
    const approvalCount = {};
    for (const c of candidates) approvalCount[c] = 0;
    const approvalBallots = approvals.length > 0 ? approvals : ballots.map(b => ({
      approved: (b.rankings || []).slice(0, Math.ceil(numCandidates / 2)),
    }));
    for (const a of approvalBallots) {
      for (const c of (a.approved || [])) {
        if (approvalCount[c] !== undefined) approvalCount[c]++;
      }
    }
    const approvalRanked = Object.entries(approvalCount)
      .map(([candidate, votes]) => ({ candidate, votes, approvalRate: r(numVoters > 0 ? votes / numVoters : 0) }))
      .sort((a, b) => b.votes - a.votes);
    const approvalWinner = approvalRanked[0]?.candidate || null;

    // --- Condorcet winner detection ---
    // Build pairwise preference matrix
    const pairwise = {};
    for (const c1 of candidates) {
      pairwise[c1] = {};
      for (const c2 of candidates) pairwise[c1][c2] = 0;
    }
    for (const b of ballots) {
      const ranked = b.rankings || [];
      for (let i = 0; i < ranked.length; i++) {
        for (let j = i + 1; j < ranked.length; j++) {
          // ranked[i] is preferred over ranked[j]
          if (pairwise[ranked[i]] && pairwise[ranked[i]][ranked[j]] !== undefined) {
            pairwise[ranked[i]][ranked[j]]++;
          }
        }
      }
    }

    // Condorcet winner: beats all others in pairwise comparisons
    let condorcetWinner = null;
    for (const c1 of candidates) {
      let beatsAll = true;
      for (const c2 of candidates) {
        if (c1 === c2) continue;
        if (pairwise[c1][c2] <= pairwise[c2][c1]) {
          beatsAll = false;
          break;
        }
      }
      if (beatsAll) { condorcetWinner = c1; break; }
    }

    // Check for Condorcet cycle
    let hasCycle = false;
    if (!condorcetWinner && candidates.length >= 3) {
      // Simple cycle detection: check if A>B>C>A exists
      for (const a of candidates) {
        for (const b of candidates) {
          if (a === b) continue;
          if (pairwise[a][b] <= pairwise[b][a]) continue;
          for (const c of candidates) {
            if (c === a || c === b) continue;
            if (pairwise[b][c] > pairwise[c][b] && pairwise[c][a] > pairwise[a][c]) {
              hasCycle = true;
              break;
            }
          }
          if (hasCycle) break;
        }
        if (hasCycle) break;
      }
    }

    // Method agreement
    const winners = [pluralityWinner, bordaWinner, approvalWinner, condorcetWinner].filter(Boolean);
    const uniqueWinners = [...new Set(winners)];
    const methodAgreement = uniqueWinners.length === 1 ? "unanimous" : uniqueWinners.length <= 2 ? "partial" : "divergent";

    return {
      ok: true,
      result: {
        candidates,
        numVoters,
        numCandidates,
        plurality: { ranking: pluralityRanked, winner: pluralityWinner, hasMajority },
        bordaCount: { ranking: bordaRanked, winner: bordaWinner },
        approvalVoting: { ranking: approvalRanked, winner: approvalWinner },
        condorcet: { winner: condorcetWinner, hasCycle, pairwiseMatrix: pairwise },
        methodAgreement,
        overallWinner: condorcetWinner || (methodAgreement === "unanimous" ? uniqueWinners[0] : pluralityWinner),
      },
    };
  });

  /**
   * fairnessCheck
   * Check voting fairness — detect strategic voting patterns,
   * compute Gallagher index of disproportionality, and verify majority criterion.
   * artifact.data.ballots = [{ voter?, rankings: string[] }]
   * artifact.data.results = { [candidate]: seatShare } (for Gallagher index)
   */
  registerLensAction("vote", "fairnessCheck", (ctx, artifact, _params) => {
    const ballots = artifact.data?.ballots || [];
    const results = artifact.data?.results || {};
    if (ballots.length === 0) return { ok: false, error: "No ballot data provided." };

    const r = (v) => Math.round(v * 1000) / 1000;
    const numVoters = ballots.length;

    // Detect candidates
    const candidateSet = new Set();
    for (const b of ballots) {
      for (const c of (b.rankings || [])) candidateSet.add(c);
    }
    const candidates = [...candidateSet];

    // First-choice vote shares
    const firstChoice = {};
    for (const c of candidates) firstChoice[c] = 0;
    for (const b of ballots) {
      if (b.rankings?.[0]) firstChoice[b.rankings[0]]++;
    }
    const voteShares = {};
    for (const c of candidates) voteShares[c] = numVoters > 0 ? firstChoice[c] / numVoters : 0;

    // --- Gallagher Index of Disproportionality ---
    // LSq = sqrt(0.5 * sum((v_i - s_i)^2))
    let gallagherSum = 0;
    const seatShares = {};
    if (Object.keys(results).length > 0) {
      const totalSeats = Object.values(results).reduce((s, v) => s + v, 0);
      for (const c of candidates) {
        seatShares[c] = totalSeats > 0 ? (results[c] || 0) / totalSeats : 0;
        const diff = (voteShares[c] || 0) * 100 - seatShares[c] * 100;
        gallagherSum += diff * diff;
      }
    }
    const gallagherIndex = Math.sqrt(gallagherSum / 2);
    const gallagherLabel = gallagherIndex < 2 ? "highly proportional" : gallagherIndex < 5 ? "moderately proportional" : gallagherIndex < 10 ? "disproportional" : "highly disproportional";

    // --- Majority criterion check ---
    // If a candidate has > 50% first-choice votes, they should win
    const majorityCandidate = candidates.find(c => voteShares[c] > 0.5);
    const declaredWinner = Object.entries(results).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const majorityCriterionMet = !majorityCandidate || majorityCandidate === declaredWinner;

    // --- Strategic voting detection ---
    // Detect burying: voter ranks a strong competitor last despite that
    // candidate being popular (high first-choice count)
    const popularity = { ...firstChoice };
    const popularCandidates = candidates
      .filter(c => voteShares[c] > 1 / candidates.length)
      .sort((a, b) => popularity[b] - popularity[a]);

    let buryingCount = 0;
    let compromiseCount = 0;
    const strategicPatterns = [];

    for (const b of ballots) {
      const ranked = b.rankings || [];
      if (ranked.length < 3) continue;

      // Burying: a popular candidate placed last
      const lastChoice = ranked[ranked.length - 1];
      if (popularCandidates.includes(lastChoice) && popularity[lastChoice] > numVoters * 0.2) {
        buryingCount++;
      }

      // Compromise: voter's first choice is unpopular, but second choice is very popular
      // This might indicate strategic voting
      const first = ranked[0];
      const second = ranked[1];
      if (first && second && popularity[first] < numVoters * 0.1 && popularity[second] > numVoters * 0.25) {
        compromiseCount++;
      }
    }

    if (buryingCount > numVoters * 0.1) {
      strategicPatterns.push({ type: "burying", count: buryingCount, severity: buryingCount > numVoters * 0.2 ? "high" : "moderate" });
    }
    if (compromiseCount > numVoters * 0.15) {
      strategicPatterns.push({ type: "compromise", count: compromiseCount, severity: compromiseCount > numVoters * 0.3 ? "high" : "moderate" });
    }

    // --- Monotonicity check via preference reversal count ---
    // Count how often a candidate ranked higher by more voters still loses
    const pairwiseLosses = {};
    for (const c of candidates) pairwiseLosses[c] = 0;
    for (const c1 of candidates) {
      for (const c2 of candidates) {
        if (c1 === c2) continue;
        let prefC1 = 0;
        for (const b of ballots) {
          const idx1 = (b.rankings || []).indexOf(c1);
          const idx2 = (b.rankings || []).indexOf(c2);
          if (idx1 !== -1 && (idx2 === -1 || idx1 < idx2)) prefC1++;
        }
        if (prefC1 < numVoters / 2) pairwiseLosses[c1]++;
      }
    }

    // Effective number of parties/candidates (Laakso-Taagepera)
    const voteShareValues = Object.values(voteShares);
    const hhi = voteShareValues.reduce((s, v) => s + v * v, 0);
    const effectiveNCandidates = hhi > 0 ? 1 / hhi : candidates.length;

    return {
      ok: true,
      result: {
        numVoters,
        numCandidates: candidates.length,
        effectiveCandidates: r(effectiveNCandidates),
        voteShares,
        gallagherIndex: Object.keys(results).length > 0 ? r(gallagherIndex) : "N/A (no seat data)",
        gallagherLabel: Object.keys(results).length > 0 ? gallagherLabel : null,
        majorityCriterion: {
          majorityCandidate,
          met: majorityCriterionMet,
          detail: majorityCandidate
            ? (majorityCriterionMet ? `${majorityCandidate} has majority and wins — criterion met` : `${majorityCandidate} has majority but did not win — criterion VIOLATED`)
            : "No candidate has a majority of first-choice votes",
        },
        strategicVoting: {
          detected: strategicPatterns.length > 0,
          patterns: strategicPatterns,
          buryingSuspects: buryingCount,
          compromiseSuspects: compromiseCount,
        },
        pairwiseLosses,
      },
    };
  });

  /**
   * consensusMeasure
   * Measure group consensus from ratings or rankings.
   * artifact.data.ratings = [{ voter?, items: { [item]: number } }]
   *   — each voter rates each item on a numeric scale
   * OR artifact.data.ballots = [{ voter?, rankings: string[] }]
   */
  registerLensAction("vote", "consensusMeasure", (ctx, artifact, _params) => {
    const ratings = artifact.data?.ratings || [];
    const ballots = artifact.data?.ballots || [];

    if (ratings.length === 0 && ballots.length === 0) {
      return { ok: false, error: "No ratings or ballot data provided." };
    }

    const r = (v) => Math.round(v * 1000) / 1000;

    // Use ratings if available, otherwise convert rankings to ratings
    let ratingMatrix = ratings;
    if (ratingMatrix.length === 0 && ballots.length > 0) {
      const allItems = new Set();
      for (const b of ballots) for (const c of (b.rankings || [])) allItems.add(c);
      const items = [...allItems];
      ratingMatrix = ballots.map(b => {
        const itemRatings = {};
        const ranked = b.rankings || [];
        for (const item of items) {
          const idx = ranked.indexOf(item);
          itemRatings[item] = idx === -1 ? 0 : items.length - idx;
        }
        return { voter: b.voter, items: itemRatings };
      });
    }

    const numVoters = ratingMatrix.length;
    const allItems = new Set();
    for (const r of ratingMatrix) for (const item of Object.keys(r.items || {})) allItems.add(item);
    const items = [...allItems];
    const numItems = items.length;

    if (numVoters < 2 || numItems === 0) {
      return { ok: false, error: "Need at least 2 voters and 1 item." };
    }

    // --- Agreement percentage ---
    // For each pair of items, check if voters agree on relative ordering
    let agreementPairs = 0;
    let totalPairs = 0;
    for (let i = 0; i < numItems; i++) {
      for (let j = i + 1; j < numItems; j++) {
        let prefI = 0, prefJ = 0;
        for (const voter of ratingMatrix) {
          const ri = voter.items?.[items[i]] ?? 0;
          const rj = voter.items?.[items[j]] ?? 0;
          if (ri > rj) prefI++;
          else if (rj > ri) prefJ++;
        }
        const maxPref = Math.max(prefI, prefJ);
        agreementPairs += maxPref;
        totalPairs += prefI + prefJ;
      }
    }
    const agreementPercent = totalPairs > 0 ? (agreementPairs / totalPairs) * 100 : 100;

    // --- Fleiss' Kappa ---
    // Categorize ratings into bins for kappa computation
    const allValues = [];
    for (const voter of ratingMatrix) {
      for (const val of Object.values(voter.items || {})) allValues.push(val);
    }
    const uniqueValues = [...new Set(allValues)].sort((a, b) => a - b);
    const numCategories = uniqueValues.length;
    const valueMap = {};
    uniqueValues.forEach((v, i) => { valueMap[v] = i; });

    // n_ij: number of raters who assigned category j to item i
    const nij = [];
    for (const item of items) {
      const row = new Array(numCategories).fill(0);
      for (const voter of ratingMatrix) {
        const val = voter.items?.[item];
        if (val !== undefined && valueMap[val] !== undefined) {
          row[valueMap[val]]++;
        }
      }
      nij.push(row);
    }

    // P_i for each item
    const Pi = nij.map(row => {
      const sum = row.reduce((s, v) => s + v * (v - 1), 0);
      const total = row.reduce((s, v) => s + v, 0);
      return total > 1 ? sum / (total * (total - 1)) : 0;
    });

    // P_bar (mean agreement)
    const Pbar = Pi.reduce((s, p) => s + p, 0) / numItems;

    // P_e (expected agreement by chance)
    const totalRatings = numItems * numVoters;
    const pj = new Array(numCategories).fill(0);
    for (const row of nij) {
      for (let j = 0; j < numCategories; j++) pj[j] += row[j];
    }
    for (let j = 0; j < numCategories; j++) pj[j] /= totalRatings;
    const Pe = pj.reduce((s, p) => s + p * p, 0);

    const fleissKappa = Pe < 1 ? (Pbar - Pe) / (1 - Pe) : 1;
    const kappaLabel = fleissKappa > 0.8 ? "almost perfect" : fleissKappa > 0.6 ? "substantial" : fleissKappa > 0.4 ? "moderate" : fleissKappa > 0.2 ? "fair" : fleissKappa > 0 ? "slight" : "poor";

    // --- Entropy-based disagreement ---
    // Shannon entropy per item across voter ratings
    let totalEntropy = 0;
    const itemEntropies = {};
    for (const item of items) {
      const valueCounts = {};
      for (const voter of ratingMatrix) {
        const val = voter.items?.[item];
        if (val !== undefined) valueCounts[val] = (valueCounts[val] || 0) + 1;
      }
      const total = Object.values(valueCounts).reduce((s, v) => s + v, 0);
      let entropy = 0;
      for (const count of Object.values(valueCounts)) {
        const p = count / total;
        if (p > 0) entropy -= p * Math.log2(p);
      }
      itemEntropies[item] = r(entropy);
      totalEntropy += entropy;
    }
    const avgEntropy = numItems > 0 ? totalEntropy / numItems : 0;
    const maxPossibleEntropy = numVoters > 0 ? Math.log2(numVoters) : 1;
    const normalizedDisagreement = maxPossibleEntropy > 0 ? avgEntropy / maxPossibleEntropy : 0;

    // --- Polarization index ---
    // Measure bimodality of rating distributions per item
    let polarizationSum = 0;
    for (const item of items) {
      const vals = ratingMatrix.map(v => v.items?.[item] ?? 0);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      // Variance and bimodality coefficient
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const m3 = vals.reduce((s, v) => s + (v - mean) ** 3, 0) / vals.length;
      const m4 = vals.reduce((s, v) => s + (v - mean) ** 4, 0) / vals.length;
      const skewness = variance > 0 ? m3 / Math.pow(Math.sqrt(variance), 3) : 0;
      const kurtosis = variance > 0 ? m4 / (variance * variance) : 0;
      // Bimodality coefficient: (skewness^2 + 1) / kurtosis
      // Values > 5/9 suggest bimodality (polarization)
      const bimodalityCoeff = kurtosis > 0 ? (skewness * skewness + 1) / kurtosis : 0;
      polarizationSum += bimodalityCoeff > 5 / 9 ? 1 : 0;
    }
    const polarizationIndex = numItems > 0 ? polarizationSum / numItems : 0;

    // Per-item consensus summary
    const itemConsensus = items.map(item => {
      const vals = ratingMatrix.map(v => v.items?.[item] ?? 0);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      return { item, mean: r(mean), stdDev: r(std), entropy: itemEntropies[item] };
    }).sort((a, b) => a.stdDev - b.stdDev);

    return {
      ok: true,
      result: {
        numVoters,
        numItems,
        agreementPercent: r(agreementPercent),
        fleissKappa: r(fleissKappa),
        kappaInterpretation: kappaLabel,
        entropy: {
          average: r(avgEntropy),
          normalizedDisagreement: r(normalizedDisagreement),
          perItem: itemEntropies,
        },
        polarizationIndex: r(polarizationIndex),
        polarizationLabel: polarizationIndex > 0.6 ? "highly polarized" : polarizationIndex > 0.3 ? "moderately polarized" : "low polarization",
        itemConsensus: {
          mostAgreed: itemConsensus.slice(0, 3),
          mostDisputed: itemConsensus.slice(-3).reverse(),
        },
        overallConsensus: fleissKappa > 0.6 && polarizationIndex < 0.3 ? "strong" : fleissKappa > 0.3 ? "moderate" : "weak",
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Polis / Decidim / Snapshot parity — persistent governance substrate.
  // Per-user data lives under globalThis._concordSTATE.voteLens keyed by userId.
  // Voting methods: plurality, ranked-choice (IRV), approval, score, quadratic.
  // ─────────────────────────────────────────────────────────────────────────

  function getVoteState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.voteLens) STATE.voteLens = {};
    const s = STATE.voteLens;
    for (const k of ["polls", "ballots", "delegations", "receipts"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveVoteState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const vtid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const vtnow = () => new Date().toISOString();
  const vtaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const vtclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const vtnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const vtround = (v) => Math.round(v * 1000) / 1000;
  // every poll is visible to all users (governance is collective) — flatten across owners
  function allPolls(s) {
    const out = [];
    for (const arr of s.polls.values()) for (const p of arr) out.push(p);
    return out;
  }
  function findPoll(s, pollId) {
    for (const arr of s.polls.values()) {
      const p = arr.find((x) => x.id === pollId);
      if (p) return p;
    }
    return null;
  }
  // sha-free deterministic hash for verifiable receipts
  function receiptHash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  const VOTE_METHODS = new Set(["plurality", "ranked", "approval", "score", "quadratic"]);

  // resolve a poll's lifecycle status from its deadline + manual close flag
  function pollStatus(poll) {
    if (poll.closedAt) return "closed";
    if (poll.deadline && new Date(poll.deadline).getTime() <= Date.now()) return "closed";
    if (poll.opensAt && new Date(poll.opensAt).getTime() > Date.now()) return "pending";
    return "open";
  }

  // ── Tally engine — runs the poll's voting method over its ballots ────────
  function tallyPoll(poll, ballots) {
    const opts = poll.options;
    const method = poll.method;
    const r = vtround;

    if (method === "plurality") {
      const count = {};
      for (const o of opts) count[o] = 0;
      for (const b of ballots) {
        const c = b.choice;
        if (count[c] !== undefined) count[c] += b.weight;
      }
      const totalW = ballots.reduce((s, b) => s + b.weight, 0);
      const ranking = Object.entries(count)
        .map(([option, votes]) => ({ option, votes: r(votes), share: r(totalW > 0 ? votes / totalW : 0) }))
        .sort((a, b) => b.votes - a.votes);
      return { method, ranking, winner: ranking[0]?.option || null, totalWeight: r(totalW), rounds: null };
    }

    if (method === "approval") {
      const count = {};
      for (const o of opts) count[o] = 0;
      for (const b of ballots) {
        for (const c of (b.approved || [])) if (count[c] !== undefined) count[c] += b.weight;
      }
      const totalW = ballots.reduce((s, b) => s + b.weight, 0);
      const ranking = Object.entries(count)
        .map(([option, votes]) => ({ option, votes: r(votes), share: r(totalW > 0 ? votes / totalW : 0) }))
        .sort((a, b) => b.votes - a.votes);
      return { method, ranking, winner: ranking[0]?.option || null, totalWeight: r(totalW), rounds: null };
    }

    if (method === "score") {
      const sum = {}; const n = {};
      for (const o of opts) { sum[o] = 0; n[o] = 0; }
      for (const b of ballots) {
        for (const [opt, sc] of Object.entries(b.scores || {})) {
          if (sum[opt] !== undefined) { sum[opt] += sc * b.weight; n[opt] += b.weight; }
        }
      }
      const ranking = opts
        .map((option) => ({ option, total: r(sum[option]), avg: r(n[option] > 0 ? sum[option] / n[option] : 0) }))
        .sort((a, b) => b.total - a.total);
      return { method, ranking, winner: ranking[0]?.option || null, totalWeight: null, rounds: null };
    }

    if (method === "quadratic") {
      // each voter buys vote-credits; effective votes = sqrt(credits) per option, signed by direction
      const sum = {};
      for (const o of opts) sum[o] = 0;
      for (const b of ballots) {
        for (const [opt, credits] of Object.entries(b.credits || {})) {
          if (sum[opt] === undefined) continue;
          const c = vtnum(credits, 0);
          const effective = Math.sign(c) * Math.sqrt(Math.abs(c)) * b.weight;
          sum[opt] += effective;
        }
      }
      const ranking = opts
        .map((option) => ({ option, effectiveVotes: r(sum[option]) }))
        .sort((a, b) => b.effectiveVotes - a.effectiveVotes);
      return { method, ranking, winner: ranking[0]?.option || null, totalWeight: null, rounds: null };
    }

    // method === "ranked" — Instant-Runoff Voting (IRV)
    let remaining = [...opts];
    const rounds = [];
    let working = ballots.map((b) => ({ rankings: (b.rankings || []).slice(), weight: b.weight }));
    let winner = null;
    let guard = 0;
    while (remaining.length > 0 && guard++ < 64) {
      const count = {};
      for (const o of remaining) count[o] = 0;
      let totalW = 0;
      for (const b of working) {
        const top = (b.rankings || []).find((c) => remaining.includes(c));
        if (top !== undefined) { count[top] += b.weight; totalW += b.weight; }
      }
      const tally = Object.entries(count)
        .map(([option, votes]) => ({ option, votes: r(votes), share: r(totalW > 0 ? votes / totalW : 0) }))
        .sort((a, b) => b.votes - a.votes);
      rounds.push({ round: rounds.length + 1, tally, exhausted: r(ballots.reduce((s, b) => s + b.weight, 0) - totalW) });
      if (tally.length === 0) break;
      if (tally[0].share > 0.5 || remaining.length === 1) { winner = tally[0].option; break; }
      // eliminate lowest
      const lowest = tally[tally.length - 1].option;
      remaining = remaining.filter((o) => o !== lowest);
    }
    const finalRanking = (rounds[rounds.length - 1]?.tally || []);
    return { method, ranking: finalRanking, winner, totalWeight: null, rounds };
  }

  // resolve pass/fail against the poll's quorum + threshold rules
  function resolvePoll(poll, ballots, tally) {
    const totalBallots = ballots.length;
    const quorum = poll.quorum || 0;
    const quorumMet = totalBallots >= quorum;
    const winner = tally.winner;
    let outcome = "pending";
    let detail = "";
    if (!quorumMet) {
      outcome = "failed";
      detail = `Quorum not met: ${totalBallots}/${quorum} ballots.`;
    } else if (poll.passThreshold != null && winner) {
      // for plurality/approval/score, winner must clear the support threshold
      const top = tally.ranking[0];
      const support = top
        ? (top.share != null ? top.share : (poll.method === "score" ? (top.avg / Math.max(poll.scoreMax || 5, 1)) : 1))
        : 0;
      if (support >= poll.passThreshold) {
        outcome = "passed";
        detail = `${winner} cleared ${Math.round(poll.passThreshold * 100)}% support threshold (${Math.round(support * 100)}%).`;
      } else {
        outcome = "failed";
        detail = `Winner support ${Math.round(support * 100)}% below ${Math.round(poll.passThreshold * 100)}% threshold.`;
      }
    } else if (winner) {
      outcome = "passed";
      detail = `${winner} won under ${poll.method} voting.`;
    }
    return { outcome, detail, quorumMet, quorum, totalBallots };
  }

  /**
   * poll-create — create a governance poll with a chosen voting method,
   * quorum/threshold rules, eligibility, and a voting-period lifecycle.
   */
  registerLensAction("vote", "poll-create", (ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const title = vtclean(params.title, 160);
    if (!title) return { ok: false, error: "poll title required" };
    const method = VOTE_METHODS.has(params.method) ? params.method : "plurality";
    const options = (Array.isArray(params.options) ? params.options : [])
      .map((o) => vtclean(o, 120)).filter(Boolean);
    if (options.length < 2) return { ok: false, error: "at least 2 options required" };
    if (options.length > 30) return { ok: false, error: "at most 30 options allowed" };

    const durationDays = Math.max(0, Math.min(365, vtnum(params.durationDays, 7)));
    const deadline = durationDays > 0
      ? new Date(Date.now() + durationDays * 86400000).toISOString()
      : (params.deadline ? new Date(params.deadline).toISOString() : null);

    const poll = {
      id: vtid("poll"),
      title,
      description: vtclean(params.description, 2000) || null,
      method,
      options,
      owner: vtaid(ctx),
      ownerLabel: vtclean(params.ownerLabel, 80) || "Anonymous",
      createdAt: vtnow(),
      opensAt: params.opensAt ? new Date(params.opensAt).toISOString() : null,
      deadline,
      closedAt: null,
      quorum: Math.max(0, Math.round(vtnum(params.quorum, 0))),
      passThreshold: params.passThreshold != null
        ? Math.max(0, Math.min(1, vtnum(params.passThreshold, 0.5))) : null,
      // eligibility: 'all' | 'list'  — when 'list', only eligibleVoters may cast
      eligibility: params.eligibility === "list" ? "list" : "all",
      eligibleVoters: (Array.isArray(params.eligibleVoters) ? params.eligibleVoters : [])
        .map((v) => vtclean(v, 80)).filter(Boolean),
      // weighting: 'equal' | 'custom' — custom uses weights map keyed by voterId
      weighting: params.weighting === "custom" ? "custom" : "equal",
      weights: params.weights && typeof params.weights === "object" ? { ...params.weights } : {},
      scoreMax: Math.max(1, Math.min(100, Math.round(vtnum(params.scoreMax, 5)))),
      creditBudget: Math.max(1, Math.min(1000, Math.round(vtnum(params.creditBudget, 100)))),
    };
    if (!s.polls.has(poll.owner)) s.polls.set(poll.owner, []);
    s.polls.get(poll.owner).push(poll);
    if (!s.ballots.has(poll.id)) s.ballots.set(poll.id, []);
    saveVoteState();
    return { ok: true, result: { poll: { ...poll, status: pollStatus(poll) } } };
  });

  /**
   * poll-list — list all governance polls with live status + ballot counts.
   */
  registerLensAction("vote", "poll-list", (_ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const filter = vtclean(params.status, 16);
    const polls = allPolls(s)
      .map((p) => {
        const ballots = s.ballots.get(p.id) || [];
        return {
          ...p,
          status: pollStatus(p),
          ballotCount: ballots.length,
        };
      })
      .filter((p) => !filter || filter === "all" || p.status === filter)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { ok: true, result: { polls, count: polls.length } };
  });

  /**
   * poll-close — manually close a voting period (owner only).
   */
  registerLensAction("vote", "poll-close", (ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const poll = findPoll(s, vtclean(params.pollId, 80));
    if (!poll) return { ok: false, error: "poll not found" };
    if (poll.owner !== vtaid(ctx)) return { ok: false, error: "only the poll owner can close it" };
    if (poll.closedAt) return { ok: false, error: "poll already closed" };
    poll.closedAt = vtnow();
    saveVoteState();
    return { ok: true, result: { poll: { ...poll, status: "closed" } } };
  });

  /**
   * cast-ballot — cast a ballot for a poll. Shape varies by method:
   *   plurality: { choice }
   *   ranked:    { rankings: [opt,...] }
   *   approval:  { approved: [opt,...] }
   *   score:     { scores: { opt: n } }
   *   quadratic: { credits: { opt: n } }  (sum |credits| <= creditBudget)
   * Enforces eligibility, lifecycle, weighting; emits a verifiable receipt;
   * a voter re-casting overwrites their prior ballot (one ballot per voter).
   */
  registerLensAction("vote", "cast-ballot", (ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const poll = findPoll(s, vtclean(params.pollId, 80));
    if (!poll) return { ok: false, error: "poll not found" };
    const status = pollStatus(poll);
    if (status !== "open") return { ok: false, error: `poll is ${status}, not accepting ballots` };

    const voter = vtaid(ctx);
    // eligibility gate
    if (poll.eligibility === "list" && !poll.eligibleVoters.includes(voter)) {
      return { ok: false, error: "voter not on the eligibility list for this poll" };
    }
    // weight resolution
    let weight = 1;
    if (poll.weighting === "custom") {
      const w = vtnum(poll.weights[voter], 1);
      weight = w > 0 ? w : 1;
    }

    const ballot = { id: vtid("ballot"), voter, weight, castAt: vtnow() };
    if (poll.method === "plurality") {
      const choice = vtclean(params.choice, 120);
      if (!poll.options.includes(choice)) return { ok: false, error: "choice not a poll option" };
      ballot.choice = choice;
    } else if (poll.method === "ranked") {
      const rankings = (Array.isArray(params.rankings) ? params.rankings : [])
        .map((o) => vtclean(o, 120)).filter((o) => poll.options.includes(o));
      if (rankings.length === 0) return { ok: false, error: "at least one ranked choice required" };
      if (new Set(rankings).size !== rankings.length) return { ok: false, error: "duplicate ranked choices" };
      ballot.rankings = rankings;
    } else if (poll.method === "approval") {
      const approved = (Array.isArray(params.approved) ? params.approved : [])
        .map((o) => vtclean(o, 120)).filter((o) => poll.options.includes(o));
      if (approved.length === 0) return { ok: false, error: "approve at least one option" };
      ballot.approved = [...new Set(approved)];
    } else if (poll.method === "score") {
      const scores = {};
      for (const [opt, sc] of Object.entries(params.scores || {})) {
        if (!poll.options.includes(opt)) continue;
        const n = Math.max(0, Math.min(poll.scoreMax, Math.round(vtnum(sc, 0))));
        scores[opt] = n;
      }
      if (Object.keys(scores).length === 0) return { ok: false, error: "score at least one option" };
      ballot.scores = scores;
    } else if (poll.method === "quadratic") {
      const credits = {};
      let spent = 0;
      for (const [opt, c] of Object.entries(params.credits || {})) {
        if (!poll.options.includes(opt)) continue;
        const n = Math.round(vtnum(c, 0));
        credits[opt] = n;
        spent += Math.abs(n);
      }
      if (Object.keys(credits).length === 0) return { ok: false, error: "allocate credits to at least one option" };
      if (spent > poll.creditBudget) {
        return { ok: false, error: `credit budget exceeded: spent ${spent}/${poll.creditBudget}` };
      }
      ballot.credits = credits;
      ballot.creditsSpent = spent;
    }

    const arr = s.ballots.get(poll.id) || [];
    const prevIdx = arr.findIndex((b) => b.voter === voter);
    if (prevIdx >= 0) arr[prevIdx] = ballot;
    else arr.push(ballot);
    s.ballots.set(poll.id, arr);

    // verifiable receipt
    const payload = JSON.stringify({ p: poll.id, v: voter, b: ballot.id, t: ballot.castAt });
    const receipt = {
      id: vtid("rcpt"),
      pollId: poll.id,
      ballotId: ballot.id,
      voter,
      castAt: ballot.castAt,
      hash: receiptHash(payload),
      verified: true,
    };
    if (!s.receipts.has(poll.id)) s.receipts.set(poll.id, []);
    const rArr = s.receipts.get(poll.id);
    const prevR = rArr.findIndex((x) => x.voter === voter);
    if (prevR >= 0) rArr[prevR] = receipt; else rArr.push(receipt);

    saveVoteState();
    return { ok: true, result: { ballot, receipt, replaced: prevIdx >= 0 } };
  });

  /**
   * delegate-vote — liquid democracy. A voter delegates their voting power
   * to another voter, optionally scoped to a single poll. Delegated weight
   * is folded into the delegate's ballot at tally time.
   */
  registerLensAction("vote", "delegate-vote", (ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const from = vtaid(ctx);
    const to = vtclean(params.delegateTo, 80);
    if (!to) return { ok: false, error: "delegateTo required" };
    if (to === from) return { ok: false, error: "cannot delegate to yourself" };
    const pollId = vtclean(params.pollId, 80) || "*"; // '*' = global delegation

    if (!s.delegations.has(from)) s.delegations.set(from, []);
    const arr = s.delegations.get(from);
    // detect a direct delegation cycle (to → from already delegated for same scope)
    const reverse = (s.delegations.get(to) || [])
      .some((d) => d.to === from && (d.pollId === pollId || d.pollId === "*"));
    if (reverse) return { ok: false, error: "delegation would create a cycle" };

    const existing = arr.findIndex((d) => d.pollId === pollId);
    const delegation = { id: vtid("dlg"), from, to, pollId, createdAt: vtnow() };
    if (existing >= 0) arr[existing] = delegation; else arr.push(delegation);
    saveVoteState();
    return { ok: true, result: { delegation } };
  });

  /**
   * revoke-delegation — withdraw a delegation (back to direct voting).
   */
  registerLensAction("vote", "revoke-delegation", (ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const from = vtaid(ctx);
    const pollId = vtclean(params.pollId, 80) || "*";
    const arr = s.delegations.get(from) || [];
    const i = arr.findIndex((d) => d.pollId === pollId);
    if (i < 0) return { ok: false, error: "no delegation found for that scope" };
    arr.splice(i, 1);
    saveVoteState();
    return { ok: true, result: { revoked: true, pollId } };
  });

  /**
   * delegation-list — list delegations made by and received by the caller.
   */
  registerLensAction("vote", "delegation-list", (ctx, _a, _params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const me = vtaid(ctx);
    const outgoing = s.delegations.get(me) || [];
    const incoming = [];
    for (const arr of s.delegations.values()) {
      for (const d of arr) if (d.to === me) incoming.push(d);
    }
    return { ok: true, result: { outgoing, incoming, outgoingCount: outgoing.length, incomingCount: incoming.length } };
  });

  // resolve a voter's effective delegate for a poll (follows the chain)
  function resolveDelegate(s, voter, pollId) {
    let cur = voter;
    const seen = new Set([voter]);
    let hops = 0;
    while (hops++ < 32) {
      const arr = s.delegations.get(cur) || [];
      const d = arr.find((x) => x.pollId === pollId) || arr.find((x) => x.pollId === "*");
      if (!d) return cur;
      if (seen.has(d.to)) return cur; // cycle guard
      seen.add(d.to);
      cur = d.to;
    }
    return cur;
  }

  /**
   * poll-results — tally a poll under its method, fold in delegated weight,
   * resolve pass/fail against quorum + threshold, and return a chart-ready
   * results payload plus a consensus-over-time series.
   */
  registerLensAction("vote", "poll-results", (_ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const poll = findPoll(s, vtclean(params.pollId, 80));
    if (!poll) return { ok: false, error: "poll not found" };
    const rawBallots = (s.ballots.get(poll.id) || []).map((b) => ({ ...b }));

    // fold delegated weight: each non-voting delegator's weight flows to the
    // delegate's ballot (if the delegate cast one for this poll)
    const ballotByVoter = new Map(rawBallots.map((b) => [b.voter, b]));
    const delegators = [];
    for (const [from, arr] of s.delegations.entries()) {
      const scoped = arr.find((d) => d.pollId === poll.id) || arr.find((d) => d.pollId === "*");
      if (!scoped) continue;
      if (ballotByVoter.has(from)) continue; // delegator voted directly — delegation inert
      const target = resolveDelegate(s, from, poll.id);
      const tgtBallot = ballotByVoter.get(target);
      if (tgtBallot) {
        let dw = 1;
        if (poll.weighting === "custom") { const w = vtnum(poll.weights[from], 1); dw = w > 0 ? w : 1; }
        tgtBallot.weight += dw;
        delegators.push({ from, to: target, weight: dw });
      }
    }

    const tally = tallyPoll(poll, rawBallots);
    const resolution = resolvePoll(poll, rawBallots, tally);

    // consensus-over-time: cumulative leading-share at each ballot timestamp
    const chrono = [...(s.ballots.get(poll.id) || [])].sort((a, b) => String(a.castAt).localeCompare(String(b.castAt)));
    const series = [];
    for (let i = 1; i <= chrono.length; i++) {
      const slice = chrono.slice(0, i).map((b) => ({ ...b }));
      const t = tallyPoll(poll, slice);
      const lead = t.ranking[0];
      const leadShare = lead
        ? (lead.share != null ? lead.share : (lead.avg != null ? lead.avg / Math.max(poll.scoreMax, 1) : 0))
        : 0;
      series.push({ ballot: i, at: chrono[i - 1].castAt, leadShare: vtround(leadShare), leader: lead?.option || null });
    }

    return {
      ok: true,
      result: {
        pollId: poll.id,
        title: poll.title,
        method: poll.method,
        status: pollStatus(poll),
        tally,
        resolution,
        delegatedBallots: delegators.length,
        delegators,
        consensusSeries: series,
        chartData: tally.ranking.map((row) => ({
          option: row.option,
          votes: vtround(row.votes ?? row.total ?? row.effectiveVotes ?? 0),
        })),
      },
    };
  });

  /**
   * opinion-cluster — Polis-style. Group voters into agreement clusters from
   * their stance on a set of comment statements. Each voter's vote on each
   * comment is +1 (agree) / 0 (pass) / -1 (disagree). Voters are clustered by
   * cosine similarity of their opinion vectors via greedy seeding.
   * params.comments = [commentId,...]
   * params.votes = [{ voter, opinions: { commentId: -1|0|1 } }]
   */
  registerLensAction("vote", "opinion-cluster", (_ctx, _a, params = {}) => {
    const comments = (Array.isArray(params.comments) ? params.comments : [])
      .map((c) => vtclean(c, 120)).filter(Boolean);
    const votes = Array.isArray(params.votes) ? params.votes : [];
    if (comments.length < 1) return { ok: false, error: "at least 1 comment required" };
    if (votes.length < 2) return { ok: false, error: "at least 2 voters required" };

    // build opinion vectors
    const voters = votes.map((v) => {
      const vec = comments.map((c) => {
        const o = vtnum(v.opinions?.[c], 0);
        return o > 0 ? 1 : o < 0 ? -1 : 0;
      });
      return { voter: vtclean(v.voter, 80) || "anon", vec };
    });

    const cosine = (a, b) => {
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
      if (na === 0 || nb === 0) return 0;
      return dot / (Math.sqrt(na) * Math.sqrt(nb));
    };

    // greedy clustering: seed clusters when no existing centroid is similar enough
    const SIM_THRESHOLD = 0.5;
    const clusters = [];
    for (const v of voters) {
      let best = -1, bestSim = SIM_THRESHOLD;
      for (let i = 0; i < clusters.length; i++) {
        const sim = cosine(v.vec, clusters[i].centroid);
        if (sim >= bestSim) { bestSim = sim; best = i; }
      }
      if (best === -1) {
        clusters.push({ members: [v], centroid: v.vec.slice() });
      } else {
        const cl = clusters[best];
        cl.members.push(v);
        // recompute centroid
        cl.centroid = comments.map((_, ci) =>
          cl.members.reduce((s, m) => s + m.vec[ci], 0) / cl.members.length);
      }
    }

    // characterize each cluster: per-comment agreement, divisive vs consensus comments
    const groups = clusters.map((cl, i) => {
      const perComment = comments.map((cid, ci) => {
        const vals = cl.members.map((m) => m.vec[ci]);
        const agree = vals.filter((x) => x > 0).length;
        const disagree = vals.filter((x) => x < 0).length;
        const pass = vals.filter((x) => x === 0).length;
        return {
          comment: cid,
          agree, disagree, pass,
          stance: agree > disagree ? "agree" : disagree > agree ? "disagree" : "split",
        };
      });
      return {
        groupId: `group-${String.fromCharCode(65 + i)}`,
        size: cl.members.length,
        members: cl.members.map((m) => m.voter),
        perComment,
        signatureComments: perComment.filter((c) => c.stance !== "split").slice(0, 5),
      };
    }).sort((a, b) => b.size - a.size);

    // consensus comments: agreed across ALL groups in the same direction
    const consensusComments = comments.filter((cid, ci) => {
      const stances = groups.map((g) => g.perComment[ci].stance);
      return stances.every((st) => st === "agree") || stances.every((st) => st === "disagree");
    });
    // divisive comments: groups split apart
    const divisiveComments = comments.filter((cid, ci) => {
      const stances = new Set(groups.map((g) => g.perComment[ci].stance));
      return stances.size > 1 && (stances.has("agree") && stances.has("disagree"));
    });

    return {
      ok: true,
      result: {
        numVoters: voters.length,
        numComments: comments.length,
        numGroups: groups.length,
        groups,
        consensusComments,
        divisiveComments,
        polarization: vtround(divisiveComments.length / Math.max(comments.length, 1)),
      },
    };
  });

  /**
   * audit-trail — return the verifiable receipt log for a poll. Each receipt
   * carries a deterministic content hash for vote verification.
   */
  registerLensAction("vote", "audit-trail", (_ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const poll = findPoll(s, vtclean(params.pollId, 80));
    if (!poll) return { ok: false, error: "poll not found" };
    const receipts = (s.receipts.get(poll.id) || [])
      .slice()
      .sort((a, b) => String(a.castAt).localeCompare(String(b.castAt)));
    const ballots = s.ballots.get(poll.id) || [];
    return {
      ok: true,
      result: {
        pollId: poll.id,
        title: poll.title,
        receiptCount: receipts.length,
        ballotCount: ballots.length,
        integrity: receipts.length === ballots.length ? "consistent" : "mismatch",
        receipts,
      },
    };
  });

  /**
   * verify-receipt — verify a single vote receipt against the recorded ballot.
   */
  registerLensAction("vote", "verify-receipt", (_ctx, _a, params = {}) => {
    const s = getVoteState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const pollId = vtclean(params.pollId, 80);
    const receiptId = vtclean(params.receiptId, 80);
    const receipts = s.receipts.get(pollId) || [];
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) return { ok: false, error: "receipt not found" };
    const ballots = s.ballots.get(pollId) || [];
    const ballot = ballots.find((b) => b.id === receipt.ballotId);
    const ballotPresent = !!ballot;
    const expected = receiptHash(JSON.stringify({
      p: receipt.pollId, v: receipt.voter, b: receipt.ballotId, t: receipt.castAt,
    }));
    const hashValid = expected === receipt.hash;
    return {
      ok: true,
      result: {
        receiptId,
        valid: hashValid && ballotPresent,
        hashValid,
        ballotPresent,
        receipt,
      },
    };
  });
}
