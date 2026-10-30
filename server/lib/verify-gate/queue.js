// server/lib/verify-gate/queue.js
//
// Async, budgeted verification queue: the subconscious keeps working while checks are pending.
//   submit(candidate)        enqueue (deduped by id; a full queue drops the newest and counts it)
//   drain(verifyFn, opts)    process at most perCycle items within budgetMs, yielding to the event loop between
//                            items (setImmediate), so a drain can never become a long synchronous loop
//   metrics()                candidates/hour, outcome counts, queue depth, Lean latency
//   rejected()               the small REFUTED log (capped, expires) kept for learning, never as knowledge
// A PENDING outcome (a checker was down) is re-queued with a back-off up to maxRetries, then left PENDING.

export function createVerifyQueue({ maxQueue = 500, perCycle = 5, budgetMs = 3000, maxRetries = 5, retryBackoffMs = 60_000, rejectedCap = 200, rejectedTtlMs = 7 * 24 * 3600e3, now = Date.now } = {}) {
  const items = []; // { candidate, tries, notBefore }
  const ids = new Set();
  const submittedAt = [];
  const counts = { VERIFIED: 0, PARTIAL: 0, REFUTED: 0, UNTESTABLE: 0, PENDING: 0 };
  const lean = { count: 0, ewmaMs: 0 };
  let dropped = 0;
  let rejectedLog = [];

  const pruneRejected = () => { const cut = now() - rejectedTtlMs; rejectedLog = rejectedLog.filter((r) => r.at >= cut).slice(-rejectedCap); };
  const yieldNow = () => new Promise((resolve) => { setImmediate(resolve); });

  function submit(candidate) {
    const id = candidate?.id;
    if (!id || ids.has(id)) return { queued: false, reason: id ? "duplicate" : "no id" };
    if (items.length >= maxQueue) { dropped++; return { queued: false, reason: "queue full" }; }
    items.push({ candidate, tries: 0, notBefore: 0 });
    ids.add(id);
    submittedAt.push(now());
    if (submittedAt.length > 5000) submittedAt.splice(0, submittedAt.length - 5000);
    return { queued: true };
  }

  async function drain(verifyFn, { onOutcome } = {}) {
    const t0 = now();
    let processed = 0;
    for (let i = 0; i < items.length && processed < perCycle && now() - t0 < budgetMs;) {
      const it = items[i];
      if (it.notBefore > now()) { i++; continue; }
      items.splice(i, 1);
      processed++;
      let res;
      try { res = await verifyFn(it.candidate); } catch (e) { res = { outcome: "PENDING", receipt: { error: String(e?.message || e), claims: [] } }; }
      const { outcome, receipt } = res;
      if (outcome === "PENDING" && ++it.tries < maxRetries) {
        it.notBefore = now() + retryBackoffMs * it.tries;
        items.push(it); // keep its id reserved
      } else {
        ids.delete(it.candidate.id);
        counts[outcome] = (counts[outcome] || 0) + 1;
        for (const c of receipt?.claims || []) {
          if (typeof c.leanElapsedMs === "number") { lean.ewmaMs = lean.count ? lean.ewmaMs * 0.8 + c.leanElapsedMs * 0.2 : c.leanElapsedMs; lean.count++; }
        }
        if (outcome === "REFUTED") { rejectedLog.push({ at: now(), id: it.candidate.id, title: it.candidate.title || null, why: (receipt?.claims || []).filter((c) => c.result === "refuted").map((c) => c.detail).slice(0, 3) }); pruneRejected(); }
        if (typeof onOutcome === "function") { try { await onOutcome(it.candidate, res); } catch { /* applying an outcome must not stop the queue */ } }
      }
      await yieldNow();
    }
    return { processed, remaining: items.length, ms: now() - t0 };
  }

  function metrics() {
    const hourAgo = now() - 3600e3;
    return {
      queueDepth: items.length,
      candidatesLastHour: submittedAt.filter((t) => t >= hourAgo).length,
      dropped,
      outcomes: { ...counts },
      leanLatencyMs: { ewma: Math.round(lean.ewmaMs), samples: lean.count },
    };
  }

  return { submit, drain, metrics, rejected: () => { pruneRejected(); return [...rejectedLog]; }, size: () => items.length };
}
