// server/domains/law.js
// Domain actions for law: case analysis, statute lookup, deadline
// tracking, billing calculation, plus real USPTO PatentsView (patent
// search) and CourtListener (federal + state case opinions).
//
// USPTO PatentsView is free + no API key.
// CourtListener search is free without auth; full text + dockets
// require a free COURTLISTENER_API_TOKEN env (courtlistener.com/help/api/rest/).

import { createHash } from "node:crypto";

const USPTO_PATENTSVIEW = "https://search.patentsview.org/api/v1";
const COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v4";

export default function registerLawActions(registerLensAction) {
  /**
   * caseAnalysis
   * Analyze case data: compute duration, categorize by type, track outcomes and win rates.
   * artifact.data.cases = [{ id, type, filedDate, closedDate, outcome, parties, judge, ... }]
   */
  registerLensAction("law", "caseAnalysis", (ctx, artifact, _params) => {
  try {
    const cases = artifact.data?.cases || [];
    if (cases.length === 0) {
      return { ok: true, result: { message: "No case data provided. Supply artifact.data.cases as an array of case objects with fields: id, type, filedDate, closedDate, outcome." } };
    }

    const now = new Date();
    const r = (v) => Math.round(v * 100) / 100;

    // Compute duration for each case
    const analyzed = cases.map(c => {
      const filed = c.filedDate ? new Date(c.filedDate) : null;
      const closed = c.closedDate ? new Date(c.closedDate) : null;
      const endDate = closed || now;
      const durationDays = filed ? Math.ceil((endDate - filed) / (1000 * 60 * 60 * 24)) : null;
      return {
        id: c.id,
        type: (c.type || "unknown").toLowerCase(),
        outcome: (c.outcome || "pending").toLowerCase(),
        durationDays,
        isOpen: !closed,
        parties: c.parties || [],
        judge: c.judge || null,
      };
    });

    // Categorize by type
    const byType = {};
    for (const c of analyzed) {
      if (!byType[c.type]) byType[c.type] = { count: 0, totalDuration: 0, withDuration: 0, outcomes: {} };
      byType[c.type].count++;
      if (c.durationDays !== null) {
        byType[c.type].totalDuration += c.durationDays;
        byType[c.type].withDuration++;
      }
      const out = c.outcome;
      byType[c.type].outcomes[out] = (byType[c.type].outcomes[out] || 0) + 1;
    }

    // Compute averages per type
    const typeBreakdown = Object.entries(byType).map(([type, data]) => ({
      type,
      count: data.count,
      avgDurationDays: data.withDuration > 0 ? r(data.totalDuration / data.withDuration) : null,
      outcomes: data.outcomes,
    }));

    // Overall outcome tracking
    const outcomeCounts = {};
    let closedCount = 0;
    for (const c of analyzed) {
      if (!c.isOpen) {
        closedCount++;
        outcomeCounts[c.outcome] = (outcomeCounts[c.outcome] || 0) + 1;
      }
    }

    // Win rate calculation (outcomes containing "won", "win", "favorable", "settled")
    const winKeywords = ["won", "win", "favorable", "settled", "dismissed"];
    const lossKeywords = ["lost", "loss", "unfavorable", "adverse"];
    let wins = 0;
    let losses = 0;
    for (const [outcome, count] of Object.entries(outcomeCounts)) {
      if (winKeywords.some(k => outcome.includes(k))) wins += count;
      if (lossKeywords.some(k => outcome.includes(k))) losses += count;
    }
    const decided = wins + losses;
    const winRate = decided > 0 ? r((wins / decided) * 100) : null;

    // Duration statistics
    const durations = analyzed.filter(c => c.durationDays !== null).map(c => c.durationDays);
    const avgDuration = durations.length > 0 ? r(durations.reduce((s, d) => s + d, 0) / durations.length) : null;
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations.length > 0
      ? sortedDurations.length % 2 === 0
        ? r((sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2)
        : sortedDurations[Math.floor(sortedDurations.length / 2)]
      : null;

    // Judge breakdown
    const byJudge = {};
    for (const c of analyzed) {
      if (c.judge) {
        if (!byJudge[c.judge]) byJudge[c.judge] = { total: 0, wins: 0, losses: 0 };
        byJudge[c.judge].total++;
        if (!c.isOpen) {
          if (winKeywords.some(k => c.outcome.includes(k))) byJudge[c.judge].wins++;
          if (lossKeywords.some(k => c.outcome.includes(k))) byJudge[c.judge].losses++;
        }
      }
    }
    const judgeStats = Object.entries(byJudge).map(([judge, data]) => ({
      judge,
      totalCases: data.total,
      wins: data.wins,
      losses: data.losses,
      winRate: (data.wins + data.losses) > 0 ? r((data.wins / (data.wins + data.losses)) * 100) : null,
    }));

    return {
      ok: true,
      result: {
        totalCases: cases.length,
        openCases: analyzed.filter(c => c.isOpen).length,
        closedCases: closedCount,
        duration: { avgDays: avgDuration, medianDays: medianDuration, minDays: sortedDurations[0] || null, maxDays: sortedDurations[sortedDurations.length - 1] || null },
        typeBreakdown,
        outcomes: outcomeCounts,
        winRate: { wins, losses, decided, percentage: winRate },
        judgeStats,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * statuteLookup
   * Search statutes by keyword in provisions array, rank by relevance.
   * artifact.data.statutes = [{ code, title, provisions: [{ section, text }], jurisdiction }]
   */
  registerLensAction("law", "statuteLookup", (ctx, artifact, _params) => {
  try {
    const statutes = artifact.data?.statutes || [];
    const query = (artifact.data?.query || _params.query || "").toLowerCase().trim();

    if (statutes.length === 0) {
      return { ok: true, result: { message: "No statutes provided. Supply artifact.data.statutes as an array of statute objects with code, title, and provisions." } };
    }
    if (!query) {
      return { ok: true, result: { message: "No search query provided. Supply artifact.data.query or params.query with keywords to search.", totalStatutes: statutes.length } };
    }

    const keywords = query.split(/\s+/).filter(k => k.length > 0);

    // Score each provision against the query
    const results = [];
    for (const statute of statutes) {
      const provisions = statute.provisions || [];
      for (const provision of provisions) {
        const text = (provision.text || "").toLowerCase();
        const title = (provision.title || statute.title || "").toLowerCase();
        const section = provision.section || "";

        // Count keyword matches in text and title
        let textMatches = 0;
        let titleMatches = 0;
        const exactPhraseMatch = text.includes(query) || title.includes(query);

        for (const kw of keywords) {
          // Count occurrences in text
          let idx = 0;
          let count = 0;
          while ((idx = text.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
          textMatches += count;

          // Count occurrences in title
          idx = 0;
          count = 0;
          while ((idx = title.indexOf(kw, idx)) !== -1) { count++; idx += kw.length; }
          titleMatches += count;
        }

        if (textMatches === 0 && titleMatches === 0) continue;

        // Relevance scoring: title matches weighted 3x, exact phrase bonus, normalize by text length
        const textLen = Math.max(text.split(/\s+/).length, 1);
        const density = textMatches / textLen;
        const relevanceScore = (titleMatches * 3) + textMatches + (density * 10) + (exactPhraseMatch ? 5 : 0);

        results.push({
          code: statute.code,
          jurisdiction: statute.jurisdiction || null,
          section,
          title: statute.title || provision.title || "",
          snippet: extractSnippet(text, keywords, 120),
          relevanceScore: Math.round(relevanceScore * 100) / 100,
          keywordHits: textMatches + titleMatches,
          exactPhraseMatch,
        });
      }
    }

    // Sort by relevance descending
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Group by statute code
    const byCode = {};
    for (const r of results) {
      if (!byCode[r.code]) byCode[r.code] = { code: r.code, jurisdiction: r.jurisdiction, matchCount: 0, topScore: 0 };
      byCode[r.code].matchCount++;
      byCode[r.code].topScore = Math.max(byCode[r.code].topScore, r.relevanceScore);
    }

    return {
      ok: true,
      result: {
        query,
        keywords,
        totalMatches: results.length,
        matches: results.slice(0, 20),
        statuteSummary: Object.values(byCode).sort((a, b) => b.topScore - a.topScore),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * deadlineTracker
   * Calculate days remaining for legal deadlines, flag overdue and urgent items.
   * artifact.data.deadlines = [{ id, description, dueDate, category, status, filingType }]
   */
  registerLensAction("law", "deadlineTracker", (ctx, artifact, _params) => {
  try {
    const deadlines = artifact.data?.deadlines || [];
    if (deadlines.length === 0) {
      return { ok: true, result: { message: "No deadlines provided. Supply artifact.data.deadlines as an array with id, description, dueDate, category, and status fields." } };
    }

    const now = new Date();
    const urgentThresholdDays = _params.urgentDays || 7;
    const warningThresholdDays = _params.warningDays || 14;

    const processed = deadlines.map(d => {
      const due = d.dueDate ? new Date(d.dueDate) : null;
      if (!due || isNaN(due.getTime())) {
        return { ...d, daysRemaining: null, status: "invalid_date", priority: "unknown" };
      }

      const daysRemaining = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
      const isCompleted = (d.status || "").toLowerCase() === "completed" || (d.status || "").toLowerCase() === "done";

      let priority;
      if (isCompleted) priority = "completed";
      else if (daysRemaining < 0) priority = "overdue";
      else if (daysRemaining <= urgentThresholdDays) priority = "urgent";
      else if (daysRemaining <= warningThresholdDays) priority = "warning";
      else priority = "on_track";

      return {
        id: d.id,
        description: d.description || "Untitled deadline",
        category: d.category || "general",
        filingType: d.filingType || null,
        dueDate: d.dueDate,
        daysRemaining,
        priority,
        isCompleted,
        isOverdue: daysRemaining < 0 && !isCompleted,
        isUrgent: daysRemaining >= 0 && daysRemaining <= urgentThresholdDays && !isCompleted,
      };
    });

    // Sort: overdue first (most overdue at top), then by days remaining ascending
    processed.sort((a, b) => {
      if (a.isCompleted && !b.isCompleted) return 1;
      if (!a.isCompleted && b.isCompleted) return -1;
      if (a.daysRemaining === null) return 1;
      if (b.daysRemaining === null) return -1;
      return a.daysRemaining - b.daysRemaining;
    });

    // Category breakdown
    const byCategory = {};
    for (const d of processed) {
      const cat = d.category;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, overdue: 0, urgent: 0, onTrack: 0, completed: 0 };
      byCategory[cat].total++;
      if (d.isOverdue) byCategory[cat].overdue++;
      else if (d.isUrgent) byCategory[cat].urgent++;
      else if (d.isCompleted) byCategory[cat].completed++;
      else byCategory[cat].onTrack++;
    }

    // Summary counts
    const overdue = processed.filter(d => d.isOverdue);
    const urgent = processed.filter(d => d.isUrgent);
    const completed = processed.filter(d => d.isCompleted);
    const upcoming = processed.filter(d => !d.isOverdue && !d.isUrgent && !d.isCompleted && d.daysRemaining !== null);

    // Average days remaining for non-completed items
    const activeDays = processed.filter(d => !d.isCompleted && d.daysRemaining !== null).map(d => d.daysRemaining);
    const avgDaysRemaining = activeDays.length > 0 ? Math.round((activeDays.reduce((s, d) => s + d, 0) / activeDays.length) * 100) / 100 : null;

    return {
      ok: true,
      result: {
        summary: {
          total: processed.length,
          overdue: overdue.length,
          urgent: urgent.length,
          upcoming: upcoming.length,
          completed: completed.length,
          avgDaysRemaining,
        },
        overdue: overdue.map(d => ({ id: d.id, description: d.description, daysOverdue: Math.abs(d.daysRemaining), category: d.category })),
        urgent: urgent.map(d => ({ id: d.id, description: d.description, daysRemaining: d.daysRemaining, category: d.category })),
        byCategory,
        allDeadlines: processed,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * billingCalculator
   * Compute legal billing from time entries: hourly rates, totals, by-attorney breakdown.
   * artifact.data.timeEntries = [{ attorney, hours, rate, date, description, category, billable }]
   */
  registerLensAction("law", "billingCalculator", (ctx, artifact, _params) => {
  try {
    const entries = artifact.data?.timeEntries || [];
    if (entries.length === 0) {
      return { ok: true, result: { message: "No time entries provided. Supply artifact.data.timeEntries as an array with attorney, hours, rate, date, description, category, and billable fields." } };
    }

    const r = (v) => Math.round(v * 100) / 100;
    const taxRate = _params.taxRate || 0;
    const discountPercent = _params.discountPercent || 0;

    // Process each entry
    const processed = entries.map(e => {
      const hours = parseFloat(e.hours) || 0;
      const rate = parseFloat(e.rate) || 0;
      const isBillable = e.billable !== false;
      return {
        attorney: e.attorney || "Unassigned",
        hours,
        rate,
        amount: r(hours * rate),
        date: e.date || null,
        description: e.description || "",
        category: e.category || "general",
        billable: isBillable,
      };
    });

    // By-attorney breakdown
    const byAttorney = {};
    for (const e of processed) {
      if (!byAttorney[e.attorney]) {
        byAttorney[e.attorney] = { totalHours: 0, billableHours: 0, nonBillableHours: 0, totalAmount: 0, billableAmount: 0, rates: new Set(), entryCount: 0 };
      }
      byAttorney[e.attorney].totalHours += e.hours;
      byAttorney[e.attorney].entryCount++;
      if (e.billable) {
        byAttorney[e.attorney].billableHours += e.hours;
        byAttorney[e.attorney].billableAmount += e.amount;
      } else {
        byAttorney[e.attorney].nonBillableHours += e.hours;
      }
      byAttorney[e.attorney].totalAmount += e.amount;
      if (e.rate > 0) byAttorney[e.attorney].rates.add(e.rate);
    }

    const attorneyBreakdown = Object.entries(byAttorney).map(([attorney, data]) => ({
      attorney,
      totalHours: r(data.totalHours),
      billableHours: r(data.billableHours),
      nonBillableHours: r(data.nonBillableHours),
      billableAmount: r(data.billableAmount),
      totalAmount: r(data.totalAmount),
      utilizationRate: data.totalHours > 0 ? r((data.billableHours / data.totalHours) * 100) : 0,
      rates: [...data.rates].sort((a, b) => a - b),
      effectiveRate: data.billableHours > 0 ? r(data.billableAmount / data.billableHours) : 0,
      entryCount: data.entryCount,
    })).sort((a, b) => b.billableAmount - a.billableAmount);

    // By category
    const byCategory = {};
    for (const e of processed) {
      if (!byCategory[e.category]) byCategory[e.category] = { hours: 0, amount: 0, count: 0 };
      byCategory[e.category].hours += e.hours;
      byCategory[e.category].amount += e.amount;
      byCategory[e.category].count++;
    }
    const categoryBreakdown = Object.entries(byCategory).map(([category, data]) => ({
      category,
      hours: r(data.hours),
      amount: r(data.amount),
      count: data.count,
    })).sort((a, b) => b.amount - a.amount);

    // By date (monthly)
    const byMonth = {};
    for (const e of processed) {
      if (e.date) {
        const month = e.date.substring(0, 7); // YYYY-MM
        if (!byMonth[month]) byMonth[month] = { hours: 0, amount: 0, count: 0 };
        byMonth[month].hours += e.hours;
        byMonth[month].amount += e.amount;
        byMonth[month].count++;
      }
    }
    const monthlyBreakdown = Object.entries(byMonth)
      .map(([month, data]) => ({ month, hours: r(data.hours), amount: r(data.amount), count: data.count }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Grand totals
    const totalBillableHours = r(processed.filter(e => e.billable).reduce((s, e) => s + e.hours, 0));
    const totalNonBillableHours = r(processed.filter(e => !e.billable).reduce((s, e) => s + e.hours, 0));
    const subtotal = r(processed.filter(e => e.billable).reduce((s, e) => s + e.amount, 0));
    const discount = r(subtotal * (discountPercent / 100));
    const afterDiscount = r(subtotal - discount);
    const tax = r(afterDiscount * (taxRate / 100));
    const grandTotal = r(afterDiscount + tax);

    return {
      ok: true,
      result: {
        totals: {
          billableHours: totalBillableHours,
          nonBillableHours: totalNonBillableHours,
          totalHours: r(totalBillableHours + totalNonBillableHours),
          subtotal,
          discountPercent,
          discount,
          afterDiscount,
          taxRate,
          tax,
          grandTotal,
          entryCount: processed.length,
        },
        attorneyBreakdown,
        categoryBreakdown,
        monthlyBreakdown,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * uspto-patent-search — Real US patent search via USPTO PatentsView.
   * Free, no API key. Searches by inventor name, title keyword, or
   * assignee. Returns patent number, title, abstract, grant date,
   * inventor, assignee.
   *
   * params: { query: string, field?: "title"|"abstract"|"inventor"|"assignee", limit?: 1-100 }
   */
  registerLensAction("law", "uspto-patent-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const field = ["title", "abstract", "inventor", "assignee"].includes(params.field) ? params.field : "title";
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 25));
    const queryShape = field === "title"
      ? { _text_phrase: { patent_title: query } }
      : field === "abstract"
      ? { _text_phrase: { patent_abstract: query } }
      : field === "inventor"
      ? { _text_phrase: { inventor_name_last: query } }
      : { _text_phrase: { assignee_organization: query } };
    try {
      const url = `${USPTO_PATENTSVIEW}/patent/?q=${encodeURIComponent(JSON.stringify(queryShape))}&f=${encodeURIComponent(JSON.stringify(["patent_id","patent_title","patent_abstract","patent_date","inventors","assignees"]))}&o=${encodeURIComponent(JSON.stringify({ per_page: limit }))}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`uspto ${r.status}`);
      const data = await r.json();
      const patents = (data.patents || []).map((p) => ({
        patentId: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract,
        grantDate: p.patent_date,
        inventors: (p.inventors || []).map((i) => `${i.inventor_name_first} ${i.inventor_name_last}`.trim()),
        assignees: (p.assignees || []).map((a) => a.assignee_organization || a.assignee_individual_name).filter(Boolean),
      }));
      return {
        ok: true,
        result: {
          query, field,
          patents, count: patents.length,
          totalHits: data.count || data.total_patent_count,
          source: "uspto-patentsview",
        },
      };
    } catch (e) {
      return { ok: false, error: `uspto unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * courtlistener-search — Real federal + state case opinion search
   * via CourtListener (Free Law Project). Search-only endpoint is
   * unauthenticated; full-text + dockets require COURTLISTENER_API_TOKEN
   * env (free at courtlistener.com/help/api/rest/).
   *
   * params: { query: string, court?: court code (e.g. "scotus"|"ca9"|"cal-1"),
   *           dateAfter?: "YYYY-MM-DD", dateBefore?: "YYYY-MM-DD", limit?: 1-50 }
   */
  registerLensAction("law", "courtlistener-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    const token = process.env.COURTLISTENER_API_TOKEN;
    const qs = new URLSearchParams({ q: query, type: "o" });  // type=o = opinions
    if (params.court) qs.set("court", String(params.court));
    if (params.dateAfter) qs.set("filed_after", String(params.dateAfter));
    if (params.dateBefore) qs.set("filed_before", String(params.dateBefore));
    qs.set("page_size", String(limit));
    try {
      const headers = token ? { Authorization: `Token ${token}` } : {};
      const r = await fetch(`${COURTLISTENER_BASE}/search/?${qs.toString()}`, { headers });
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "courtlistener rate limit — set COURTLISTENER_API_TOKEN env" };
        throw new Error(`courtlistener ${r.status}`);
      }
      const data = await r.json();
      const results = (data.results || []).map((o) => ({
        id: o.id,
        caseName: o.caseName,
        court: o.court,
        courtId: o.court_id,
        dateFiled: o.dateFiled,
        absoluteUrl: o.absolute_url ? `https://www.courtlistener.com${o.absolute_url}` : null,
        snippet: o.snippet,
        citation: o.citation,
        precedentialStatus: o.status,
        docketNumber: o.docketNumber,
        judges: o.judge,
        author: o.author,
      }));
      return {
        ok: true,
        result: {
          query,
          results, count: results.length,
          totalHits: data.count,
          authenticatedWithToken: !!token,
          source: "courtlistener",
        },
      };
    } catch (e) {
      return { ok: false, error: `courtlistener unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Contract lifecycle management (Ironclad / LegalZoom 2026 parity) ───
  // Per-user STATE-backed contract repository: draft, compose from a
  // clause library, review for risk, sign, and track to expiry.

  function getLawState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.lawLens) STATE.lawLens = {};
    if (!(STATE.lawLens.contracts instanceof Map)) STATE.lawLens.contracts = new Map();
    return STATE.lawLens;
  }
  function saveLaw() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const lwId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const lwNow = () => new Date().toISOString();
  const lwActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const lwClean = (v, max = 280) => String(v == null ? "" : v).trim().slice(0, max);
  const lwList = (s, userId) => { if (!s.contracts.has(userId)) s.contracts.set(userId, []); return s.contracts.get(userId); };

  const CONTRACT_TYPES = ["nda", "services", "employment", "license", "lease", "sale", "partnership", "other"];
  const CONTRACT_STATUSES = ["draft", "in_review", "sent", "signed", "active", "expired", "terminated"];

  const CLAUSE_LIBRARY = {
    "data-protection": [
      { title: "Data Processing Agreement", text: "Each party shall process personal data only on documented instructions from the other party and in compliance with applicable data-protection law." },
      { title: "Sub-Processor Notification", text: "The Processor shall notify the Controller of any intended addition or replacement of Sub-Processors, giving the Controller the opportunity to object." },
      { title: "Data Breach Response", text: "The Processor shall notify the Controller without undue delay, and in any event within 72 hours, after becoming aware of a personal-data breach." },
    ],
    "intellectual-property": [
      { title: "IP Assignment", text: "All intellectual property created under this Agreement shall be the sole and exclusive property of the Client upon creation." },
      { title: "License Grant", text: "The Licensor grants the Licensee a non-exclusive, non-transferable license to use the Licensed Materials for the stated purpose." },
      { title: "Non-Compete Restriction", text: "During the term and for twelve (12) months thereafter, the Party shall not engage in any directly competing business within the defined territory." },
    ],
    "liability": [
      { title: "Limitation of Liability", text: "Neither party's aggregate liability shall exceed the total fees paid under this Agreement in the twelve (12) months preceding the claim." },
      { title: "Indemnification", text: "Each party shall indemnify and hold harmless the other against third-party claims arising from its breach of this Agreement." },
      { title: "Force Majeure", text: "Neither party shall be liable for any failure or delay in performance caused by events beyond its reasonable control." },
    ],
    "termination": [
      { title: "Termination for Convenience", text: "Either party may terminate this Agreement upon thirty (30) days' prior written notice to the other party." },
      { title: "Termination for Cause", text: "Either party may terminate immediately if the other materially breaches this Agreement and fails to cure within fifteen (15) days of notice." },
      { title: "Survival", text: "Provisions which by their nature should survive termination — including confidentiality, indemnification, and limitation of liability — shall survive." },
    ],
    "general": [
      { title: "Confidentiality", text: "Each party shall keep confidential all non-public information disclosed by the other party and use it only for the purposes of this Agreement." },
      { title: "Governing Law", text: "This Agreement shall be governed by and construed in accordance with the laws of the stated jurisdiction." },
      { title: "Dispute Resolution", text: "Any dispute shall first be submitted to good-faith negotiation and, failing resolution, to binding arbitration." },
      { title: "Entire Agreement", text: "This Agreement constitutes the entire agreement between the parties and supersedes all prior understandings." },
    ],
  };
  // Clauses a well-formed contract should carry — drives contract-review.
  const RECOMMENDED_CLAUSES = ["Confidentiality", "Limitation of Liability", "Governing Law", "Dispute Resolution", "Termination for Convenience"];

  registerLensAction("law", "clause-library", (_ctx, _a, params = {}) => {
    const cat = lwClean(params.category, 40).toLowerCase();
    if (cat && CLAUSE_LIBRARY[cat]) return { ok: true, result: { category: cat, clauses: CLAUSE_LIBRARY[cat] } };
    return {
      ok: true,
      result: {
        categories: Object.keys(CLAUSE_LIBRARY).map((c) => ({ category: c, count: CLAUSE_LIBRARY[c].length })),
        library: CLAUSE_LIBRARY,
      },
    };
  });

  registerLensAction("law", "contract-create", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = lwClean(params.title, 160);
    if (!title) return { ok: false, error: "contract title required" };
    const type = CONTRACT_TYPES.includes(params.type) ? params.type : "other";
    const contract = {
      id: lwId("ctr"),
      title,
      type,
      counterparty: lwClean(params.counterparty, 160) || "Unspecified",
      value: Math.max(0, Number(params.value) || 0),
      status: "draft",
      effectiveDate: lwClean(params.effectiveDate, 30) || null,
      expiryDate: lwClean(params.expiryDate, 30) || null,
      clauses: [],
      signatures: [],
      createdAt: lwNow(),
      updatedAt: lwNow(),
    };
    lwList(s, lwActor(ctx)).push(contract);
    saveLaw();
    return { ok: true, result: { contract } };
  });

  registerLensAction("law", "contract-list", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let cs = [...lwList(s, lwActor(ctx))];
    if (params.status && CONTRACT_STATUSES.includes(params.status)) cs = cs.filter((c) => c.status === params.status);
    cs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const contracts = cs.map((c) => ({
      id: c.id, title: c.title, type: c.type, counterparty: c.counterparty,
      value: c.value, status: c.status, clauseCount: c.clauses.length,
      signatureCount: c.signatures.length, expiryDate: c.expiryDate, updatedAt: c.updatedAt,
    }));
    return { ok: true, result: { contracts, count: contracts.length } };
  });

  registerLensAction("law", "contract-detail", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    return { ok: true, result: { contract: c } };
  });

  registerLensAction("law", "contract-update", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    if (params.title != null) c.title = lwClean(params.title, 160) || c.title;
    if (params.counterparty != null) c.counterparty = lwClean(params.counterparty, 160);
    if (params.value != null) c.value = Math.max(0, Number(params.value) || 0);
    if (params.effectiveDate != null) c.effectiveDate = lwClean(params.effectiveDate, 30) || null;
    if (params.expiryDate != null) c.expiryDate = lwClean(params.expiryDate, 30) || null;
    if (params.status != null && CONTRACT_STATUSES.includes(params.status)) c.status = params.status;
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { contract: c } };
  });

  registerLensAction("law", "contract-delete", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = lwList(s, lwActor(ctx));
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "contract not found" };
    arr.splice(i, 1);
    saveLaw();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("law", "clause-add", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
    if (!c) return { ok: false, error: "contract not found" };
    const title = lwClean(params.title, 120);
    if (!title) return { ok: false, error: "clause title required" };
    const clause = {
      id: lwId("cl"),
      category: lwClean(params.category, 40).toLowerCase() || "general",
      title,
      text: lwClean(params.text, 4000) || "(no text)",
      addedAt: lwNow(),
    };
    c.clauses.push(clause);
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { clause, clauseCount: c.clauses.length } };
  });

  registerLensAction("law", "clause-remove", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
    if (!c) return { ok: false, error: "contract not found" };
    const i = c.clauses.findIndex((x) => x.id === params.clauseId);
    if (i < 0) return { ok: false, error: "clause not found" };
    c.clauses.splice(i, 1);
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { removed: params.clauseId, clauseCount: c.clauses.length } };
  });

  registerLensAction("law", "contract-review", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const titles = c.clauses.map((cl) => cl.title.toLowerCase());
    const missing = RECOMMENDED_CLAUSES.filter((rc) => !titles.some((t) => t.includes(rc.toLowerCase().split(" ")[0])));
    const findings = [];
    for (const m of missing) findings.push({ severity: "warning", message: `Missing recommended clause: ${m}` });
    if (c.clauses.length === 0) findings.push({ severity: "high", message: "Contract has no clauses." });
    if (!c.expiryDate) findings.push({ severity: "info", message: "No expiry date set — contract is open-ended." });
    if (c.value === 0) findings.push({ severity: "info", message: "Contract value is zero or unset." });
    if (c.status === "active" && c.signatures.length < 2) {
      findings.push({ severity: "high", message: "Contract is marked active but has fewer than two signatures." });
    }
    const riskScore = Math.min(100, findings.reduce((n, f) => n + (f.severity === "high" ? 30 : f.severity === "warning" ? 12 : 4), 0));
    const grade = riskScore >= 60 ? "high-risk" : riskScore >= 25 ? "needs-attention" : "sound";
    return { ok: true, result: { contractId: c.id, riskScore, grade, findings, clauseCount: c.clauses.length } };
  });

  registerLensAction("law", "contract-sign", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const party = lwClean(params.party, 120);
    if (!party) return { ok: false, error: "party name required" };
    if (c.signatures.some((sig) => sig.party.toLowerCase() === party.toLowerCase())) {
      return { ok: false, error: "party has already signed" };
    }
    c.signatures.push({ party, signedAt: lwNow() });
    if (c.signatures.length >= 2 && c.status !== "active") c.status = "signed";
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { contractId: c.id, signatures: c.signatures, status: c.status } };
  });

  registerLensAction("law", "contract-dashboard", (ctx, _a, _params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cs = lwList(s, lwActor(ctx));
    const byStatus = {};
    for (const st of CONTRACT_STATUSES) byStatus[st] = 0;
    let totalValue = 0;
    let expiringSoon = 0;
    const soon = Date.now() + 30 * 86400000;
    for (const c of cs) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      totalValue += c.value;
      if (c.expiryDate) {
        const t = new Date(c.expiryDate).getTime();
        if (!Number.isNaN(t) && t > Date.now() && t < soon) expiringSoon += 1;
      }
    }
    return {
      ok: true,
      result: {
        total: cs.length,
        byStatus,
        totalValue,
        expiringSoon,
        unsigned: cs.filter((c) => c.signatures.length === 0).length,
      },
    };
  });

  // ─── Backlog item 1: Visual contract editor with redline / version diff ───
  // Each contract carries a versions[] array — a snapshot of the full
  // clause text at the moment of save. contract-version-save snapshots,
  // contract-version-list lists, contract-diff produces a line-level
  // redline between any two versions (or a version vs. current).

  function clauseTextBlock(c) {
    return c.clauses.map((cl) => `[${cl.title}]\n${cl.text}`).join("\n\n");
  }
  // Line-level diff — classic LCS over arrays of trimmed lines.
  function lineDiff(oldText, newText) {
    const a = String(oldText || "").split("\n");
    const b = String(newText || "").split("\n");
    const m = a.length, n = b.length;
    const lcs = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        lcs[i][j] = a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (a[i] === b[j]) { ops.push({ op: "same", text: a[i] }); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ op: "remove", text: a[i] }); i++; }
      else { ops.push({ op: "add", text: b[j] }); j++; }
    }
    while (i < m) { ops.push({ op: "remove", text: a[i] }); i++; }
    while (j < n) { ops.push({ op: "add", text: b[j] }); j++; }
    return ops;
  }

  registerLensAction("law", "contract-version-save", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    if (!Array.isArray(c.versions)) c.versions = [];
    const snapshot = {
      version: c.versions.length + 1,
      label: lwClean(params.label, 120) || `Version ${c.versions.length + 1}`,
      body: clauseTextBlock(c),
      clauseCount: c.clauses.length,
      savedBy: lwActor(ctx),
      savedAt: lwNow(),
    };
    c.versions.push(snapshot);
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { version: snapshot, versionCount: c.versions.length } };
  });

  registerLensAction("law", "contract-version-list", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const versions = (c.versions || []).map((v) => ({
      version: v.version, label: v.label, clauseCount: v.clauseCount,
      savedBy: v.savedBy, savedAt: v.savedAt, charCount: v.body.length,
    }));
    return { ok: true, result: { versions, count: versions.length } };
  });

  registerLensAction("law", "contract-diff", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const versions = c.versions || [];
    const findV = (n) => versions.find((v) => v.version === Number(n));
    const fromV = params.fromVersion != null ? findV(params.fromVersion) : null;
    if (params.fromVersion != null && !fromV) return { ok: false, error: "fromVersion not found" };
    const oldBody = fromV ? fromV.body : "";
    const newBody = params.toVersion != null
      ? (findV(params.toVersion)?.body ?? null)
      : clauseTextBlock(c);
    if (newBody === null) return { ok: false, error: "toVersion not found" };
    const ops = lineDiff(oldBody, newBody);
    const added = ops.filter((o) => o.op === "add").length;
    const removed = ops.filter((o) => o.op === "remove").length;
    return {
      ok: true,
      result: {
        contractId: c.id,
        from: fromV ? `v${fromV.version}` : "empty",
        to: params.toVersion != null ? `v${params.toVersion}` : "current",
        ops, added, removed, unchanged: ops.length - added - removed,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog item 2: AI clause extraction from an uploaded contract ───
  // Parses raw pasted/uploaded contract text into structured clauses,
  // detected dates, monetary amounts and obligation sentences. No LLM —
  // deterministic heading + sentence segmentation so it is reproducible.

  registerLensAction("law", "clause-extract", (_ctx, _a, params = {}) => {
  try {
    const text = String(params.text || "").trim();
    if (!text) return { ok: false, error: "contract text required" };
    if (text.length > 200000) return { ok: false, error: "text exceeds 200k chars" };

    // Split into clauses on numbered/lettered/CAPS headings.
    const lines = text.split(/\r?\n/);
    const clauses = [];
    let current = null;
    const headingRe = /^\s*((?:\d+(?:\.\d+)*\.?)|(?:[A-Z]\.)|(?:ARTICLE\s+[IVX0-9]+)|(?:SECTION\s+\d+))\s*[.:)-]?\s*(.{0,90}?)\s*$/;
    const capsHeadingRe = /^\s*([A-Z][A-Z \-&]{4,60})\s*$/;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const h = line.match(headingRe);
      const ch = !h && line.length < 70 ? line.match(capsHeadingRe) : null;
      if (h || ch) {
        if (current) clauses.push(current);
        const heading = h ? (h[2] || h[1]).trim() : ch[1].trim();
        current = { title: heading.slice(0, 120) || "Untitled clause", text: "" };
      } else if (current) {
        current.text += (current.text ? " " : "") + line;
      } else {
        current = { title: "Preamble", text: line };
      }
    }
    if (current) clauses.push(current);
    // Drop empties, cap.
    const extracted = clauses
      .filter((c) => c.text.length > 0)
      .slice(0, 200)
      .map((c) => ({ title: c.title, text: c.text.slice(0, 4000), wordCount: c.text.split(/\s+/).length }));

    // Date detection.
    const dateRe = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/gi;
    const dates = [...new Set((text.match(dateRe) || []).map((d) => d.trim()))].slice(0, 50);

    // Monetary amount detection.
    const moneyRe = /(?:USD?\s*)?\$\s?[\d,]+(?:\.\d{2})?|\b[\d,]+(?:\.\d{2})?\s+(?:dollars|USD|EUR|GBP)\b/gi;
    const amounts = [...new Set((text.match(moneyRe) || []).map((m) => m.trim()))].slice(0, 50);

    // Obligation sentences — contain modal duty verbs.
    const sentences = text.replace(/\n+/g, " ").split(/(?<=[.;])\s+/);
    const dutyRe = /\b(shall|must|will|agrees? to|is required to|undertakes? to|is obligated to)\b/i;
    const obligations = sentences
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && s.length < 400 && dutyRe.test(s))
      .slice(0, 60);

    return {
      ok: true,
      result: {
        clauses: extracted,
        clauseCount: extracted.length,
        detectedDates: dates,
        detectedAmounts: amounts,
        obligations,
        stats: { lines: lines.length, sentences: sentences.length, chars: text.length },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // clause-extract-apply — push extracted clauses straight onto a contract.
  registerLensAction("law", "clause-extract-apply", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
    if (!c) return { ok: false, error: "contract not found" };
    const incoming = Array.isArray(params.clauses) ? params.clauses : [];
    if (incoming.length === 0) return { ok: false, error: "clauses array required" };
    let added = 0;
    for (const cl of incoming.slice(0, 200)) {
      const title = lwClean(cl.title, 120);
      if (!title) continue;
      c.clauses.push({
        id: lwId("cl"),
        category: lwClean(cl.category, 40).toLowerCase() || "extracted",
        title,
        text: lwClean(cl.text, 4000) || "(no text)",
        addedAt: lwNow(),
        source: "extraction",
      });
      added++;
    }
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { added, clauseCount: c.clauses.length } };
  });

  // ─── Backlog item 3: Approval workflow ───
  // A contract carries an approvals[] ledger of named reviewers, each
  // with a state (pending/approved/rejected). The contract status moves
  // to in_review when a workflow starts; signature gating checks all
  // approvals cleared.

  registerLensAction("law", "approval-route", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const reviewers = Array.isArray(params.reviewers) ? params.reviewers : [];
    const cleaned = reviewers
      .map((r) => lwClean(typeof r === "string" ? r : r?.name, 120))
      .filter(Boolean);
    if (cleaned.length === 0) return { ok: false, error: "at least one reviewer required" };
    c.approvals = cleaned.map((name, i) => ({
      id: lwId("ap"),
      reviewer: name,
      order: i + 1,
      state: "pending",
      note: "",
      decidedAt: null,
    }));
    c.status = "in_review";
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { contractId: c.id, approvals: c.approvals, status: c.status } };
  });

  registerLensAction("law", "approval-decide", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const ap = (c.approvals || []).find((a) => a.id === params.approvalId);
    if (!ap) return { ok: false, error: "approval step not found" };
    const decision = ["approved", "rejected"].includes(params.decision) ? params.decision : null;
    if (!decision) return { ok: false, error: "decision must be approved or rejected" };
    ap.state = decision;
    ap.note = lwClean(params.note, 280);
    ap.decidedAt = lwNow();
    const all = c.approvals;
    const anyRejected = all.some((a) => a.state === "rejected");
    const allApproved = all.length > 0 && all.every((a) => a.state === "approved");
    if (anyRejected) c.status = "draft";
    else if (allApproved) c.status = "sent";
    c.updatedAt = lwNow();
    saveLaw();
    return {
      ok: true,
      result: {
        contractId: c.id,
        approvals: all,
        status: c.status,
        cleared: allApproved,
        blocked: anyRejected,
      },
    };
  });

  registerLensAction("law", "approval-status", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const all = c.approvals || [];
    return {
      ok: true,
      result: {
        contractId: c.id,
        approvals: all,
        pending: all.filter((a) => a.state === "pending").length,
        approved: all.filter((a) => a.state === "approved").length,
        rejected: all.filter((a) => a.state === "rejected").length,
        cleared: all.length > 0 && all.every((a) => a.state === "approved"),
      },
    };
  });

  // ─── Backlog item 4: Obligation tracking ───
  // Surfaces renewal / expiry / payment dates across all of a user's
  // contracts as a single actionable task list, sorted by urgency.

  registerLensAction("law", "obligation-add", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
    if (!c) return { ok: false, error: "contract not found" };
    const label = lwClean(params.label, 160);
    if (!label) return { ok: false, error: "obligation label required" };
    const kind = ["renewal", "expiry", "payment", "delivery", "review", "other"].includes(params.kind)
      ? params.kind : "other";
    const dueDate = lwClean(params.dueDate, 30);
    if (!dueDate || Number.isNaN(new Date(dueDate).getTime())) return { ok: false, error: "valid dueDate required" };
    if (!Array.isArray(c.obligations)) c.obligations = [];
    const obligation = {
      id: lwId("ob"),
      label,
      kind,
      dueDate,
      amount: Math.max(0, Number(params.amount) || 0),
      done: false,
      createdAt: lwNow(),
    };
    c.obligations.push(obligation);
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { obligation } };
  });

  registerLensAction("law", "obligation-complete", (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
    if (!c) return { ok: false, error: "contract not found" };
    const ob = (c.obligations || []).find((o) => o.id === params.obligationId);
    if (!ob) return { ok: false, error: "obligation not found" };
    ob.done = !ob.done;
    ob.completedAt = ob.done ? lwNow() : null;
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { obligation: ob } };
  });

  registerLensAction("law", "obligation-tracker", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cs = lwList(s, lwActor(ctx));
    const now = Date.now();
    const urgentDays = Math.max(1, Number(params.urgentDays) || 14);
    const tasks = [];
    for (const c of cs) {
      // Explicit obligations.
      for (const ob of c.obligations || []) {
        const due = new Date(ob.dueDate).getTime();
        const daysRemaining = Math.ceil((due - now) / 86400000);
        tasks.push({
          id: ob.id, contractId: c.id, contractTitle: c.title,
          label: ob.label, kind: ob.kind, dueDate: ob.dueDate, amount: ob.amount,
          done: !!ob.done, daysRemaining,
          priority: ob.done ? "completed" : daysRemaining < 0 ? "overdue"
            : daysRemaining <= urgentDays ? "urgent" : "upcoming",
        });
      }
      // Implicit expiry from contract.expiryDate.
      if (c.expiryDate && !Number.isNaN(new Date(c.expiryDate).getTime())) {
        const due = new Date(c.expiryDate).getTime();
        const daysRemaining = Math.ceil((due - now) / 86400000);
        tasks.push({
          id: `exp_${c.id}`, contractId: c.id, contractTitle: c.title,
          label: `Contract expires`, kind: "expiry", dueDate: c.expiryDate, amount: 0,
          done: c.status === "expired" || c.status === "terminated", daysRemaining,
          priority: (c.status === "expired" || c.status === "terminated") ? "completed"
            : daysRemaining < 0 ? "overdue"
            : daysRemaining <= urgentDays ? "urgent" : "upcoming",
          implicit: true,
        });
      }
    }
    tasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.daysRemaining - b.daysRemaining;
    });
    return {
      ok: true,
      result: {
        tasks,
        summary: {
          total: tasks.length,
          overdue: tasks.filter((t) => t.priority === "overdue").length,
          urgent: tasks.filter((t) => t.priority === "urgent").length,
          upcoming: tasks.filter((t) => t.priority === "upcoming").length,
          completed: tasks.filter((t) => t.done).length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog item 5: Cryptographic e-signature with audit certificate ───
  // Replaces the named-party ledger with a signature carrying a SHA-256
  // hash of (contract body + party + timestamp + intent), producing a
  // verifiable certificate. contract-verify recomputes hashes to detect
  // tampering.

  function contractDigest(c) {
    return createHash("sha256")
      .update(`${c.id}|${c.title}|${clauseTextBlock(c)}`)
      .digest("hex");
  }

  registerLensAction("law", "contract-esign", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const party = lwClean(params.party, 120);
    if (!party) return { ok: false, error: "party name required" };
    const intent = lwClean(params.intent, 200) || "I agree to be bound by this contract.";
    if (c.signatures.some((sig) => sig.party.toLowerCase() === party.toLowerCase())) {
      return { ok: false, error: "party has already signed" };
    }
    const signedAt = lwNow();
    const docHash = contractDigest(c);
    const sigPayload = `${docHash}|${party}|${signedAt}|${intent}`;
    const signatureHash = createHash("sha256").update(sigPayload).digest("hex");
    const certificate = {
      certificateId: lwId("cert"),
      party,
      intent,
      signedAt,
      documentHash: docHash,
      signatureHash,
      signerUserId: lwActor(ctx),
      algorithm: "sha256",
    };
    c.signatures.push({ party, signedAt, certificate });
    if (c.signatures.length >= 2 && c.status !== "active") c.status = "signed";
    c.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { contractId: c.id, certificate, status: c.status, signatureCount: c.signatures.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("law", "contract-verify", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const c = lwList(s, lwActor(ctx)).find((x) => x.id === params.id);
    if (!c) return { ok: false, error: "contract not found" };
    const currentHash = contractDigest(c);
    const certified = (c.signatures || []).filter((sig) => sig.certificate);
    const checks = certified.map((sig) => {
      const cert = sig.certificate;
      const docIntact = cert.documentHash === currentHash;
      const expectedSig = createHash("sha256")
        .update(`${cert.documentHash}|${cert.party}|${cert.signedAt}|${cert.intent}`)
        .digest("hex");
      const sigIntact = expectedSig === cert.signatureHash;
      return {
        party: cert.party,
        certificateId: cert.certificateId,
        signedAt: cert.signedAt,
        documentUnchangedSinceSigning: docIntact,
        signatureValid: sigIntact,
        valid: docIntact && sigIntact,
      };
    });
    return {
      ok: true,
      result: {
        contractId: c.id,
        currentDocumentHash: currentHash,
        certifiedSignatures: checks.length,
        allValid: checks.length > 0 && checks.every((x) => x.valid),
        tampered: checks.some((x) => !x.documentUnchangedSinceSigning),
        checks,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog item 6: Contract templates / playbooks ───
  // Pre-approved language sets that, applied to a contract, drop in a
  // curated bundle of clauses for a given contract type.

  const CONTRACT_PLAYBOOKS = {
    nda: {
      name: "Mutual NDA",
      description: "Two-way confidentiality with standard term and survival.",
      contractType: "nda",
      clauses: ["data-protection:0", "general:0", "general:1", "general:2", "termination:2"],
    },
    services: {
      name: "Services Agreement",
      description: "Vendor services with IP assignment, liability cap and termination rights.",
      contractType: "services",
      clauses: ["intellectual-property:0", "liability:0", "liability:1", "termination:0", "termination:1", "general:1"],
    },
    employment: {
      name: "Employment Offer",
      description: "Standard employment with IP, non-compete and confidentiality.",
      contractType: "employment",
      clauses: ["intellectual-property:0", "intellectual-property:2", "general:0", "termination:1"],
    },
    license: {
      name: "Software License",
      description: "License grant with liability limits and governing law.",
      contractType: "license",
      clauses: ["intellectual-property:1", "liability:0", "liability:2", "general:1"],
    },
    dpa: {
      name: "Data Processing Addendum",
      description: "GDPR-shaped processor obligations and breach response.",
      contractType: "other",
      clauses: ["data-protection:0", "data-protection:1", "data-protection:2", "liability:1"],
    },
  };

  function resolveClauseRef(ref) {
    const [cat, idx] = String(ref).split(":");
    const list = CLAUSE_LIBRARY[cat];
    if (!list) return null;
    const clause = list[Number(idx)];
    return clause ? { category: cat, title: clause.title, text: clause.text } : null;
  }

  registerLensAction("law", "playbook-list", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        playbooks: Object.entries(CONTRACT_PLAYBOOKS).map(([id, p]) => ({
          id, name: p.name, description: p.description,
          contractType: p.contractType, clauseCount: p.clauses.length,
        })),
      },
    };
  });

  registerLensAction("law", "playbook-detail", (_ctx, _a, params = {}) => {
    const p = CONTRACT_PLAYBOOKS[String(params.id || "").toLowerCase()];
    if (!p) return { ok: false, error: "playbook not found" };
    const clauses = p.clauses.map(resolveClauseRef).filter(Boolean);
    return {
      ok: true,
      result: {
        id: String(params.id).toLowerCase(),
        name: p.name, description: p.description,
        contractType: p.contractType, clauses,
      },
    };
  });

  registerLensAction("law", "playbook-apply", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const p = CONTRACT_PLAYBOOKS[String(params.playbookId || "").toLowerCase()];
    if (!p) return { ok: false, error: "playbook not found" };
    const clauses = p.clauses.map(resolveClauseRef).filter(Boolean);

    let contract;
    if (params.contractId) {
      contract = lwList(s, lwActor(ctx)).find((x) => x.id === params.contractId);
      if (!contract) return { ok: false, error: "contract not found" };
    } else {
      const title = lwClean(params.title, 160) || p.name;
      contract = {
        id: lwId("ctr"),
        title,
        type: p.contractType,
        counterparty: lwClean(params.counterparty, 160) || "Unspecified",
        value: Math.max(0, Number(params.value) || 0),
        status: "draft",
        effectiveDate: null,
        expiryDate: null,
        clauses: [],
        signatures: [],
        createdAt: lwNow(),
        updatedAt: lwNow(),
        fromPlaybook: String(params.playbookId).toLowerCase(),
      };
      lwList(s, lwActor(ctx)).push(contract);
    }
    let added = 0;
    for (const cl of clauses) {
      contract.clauses.push({
        id: lwId("cl"),
        category: cl.category,
        title: cl.title,
        text: cl.text,
        addedAt: lwNow(),
        source: "playbook",
      });
      added++;
    }
    contract.updatedAt = lwNow();
    saveLaw();
    return { ok: true, result: { contract, clausesAdded: added } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog item 7: Full-text contract repository search ───
  // Searches across every contract a user owns — title, counterparty,
  // and the full text of every clause — with a snippet per match.

  registerLensAction("law", "repository-search", (ctx, _a, params = {}) => {
  try {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const query = lwClean(params.query, 200).toLowerCase();
    if (!query || query.length < 2) return { ok: false, error: "query of at least 2 chars required" };
    const cs = lwList(s, lwActor(ctx));
    const keywords = query.split(/\s+/).filter(Boolean);
    const results = [];
    for (const c of cs) {
      const hits = [];
      const titleLc = (c.title || "").toLowerCase();
      const cpLc = (c.counterparty || "").toLowerCase();
      if (keywords.some((k) => titleLc.includes(k))) hits.push({ field: "title", snippet: c.title });
      if (keywords.some((k) => cpLc.includes(k))) hits.push({ field: "counterparty", snippet: c.counterparty });
      for (const cl of c.clauses || []) {
        const clauseText = (cl.text || "").toLowerCase();
        const clauseTitle = (cl.title || "").toLowerCase();
        if (keywords.some((k) => clauseText.includes(k) || clauseTitle.includes(k))) {
          hits.push({
            field: "clause",
            clauseTitle: cl.title,
            snippet: extractSnippet(clauseText, keywords, 160),
          });
        }
      }
      if (hits.length > 0) {
        results.push({
          contractId: c.id,
          contractTitle: c.title,
          status: c.status,
          type: c.type,
          matchCount: hits.length,
          hits: hits.slice(0, 10),
        });
      }
    }
    results.sort((a, b) => b.matchCount - a.matchCount);
    return {
      ok: true,
      result: {
        query,
        keywords,
        contractsSearched: cs.length,
        matchingContracts: results.length,
        results,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest recent federal/state court opinions (CourtListener) as DTUs.
  registerLensAction("law", "feed", async (ctx, _a, params = {}) => {
    const s = getLawState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    const token = process.env.COURTLISTENER_API_TOKEN;
    try {
      const headers = token ? { Authorization: `Token ${token}` } : {};
      const r = await fetch(`${COURTLISTENER_BASE}/search/?type=o&order_by=${encodeURIComponent("dateFiled desc")}&page_size=${limit}`, { headers });
      if (!r.ok) return { ok: false, error: `courtlistener ${r.status}` };
      const data = await r.json();
      const results = data.results || [];
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const o of results) {
        if (s.feedSeen.has(String(o.id))) { skipped++; continue; }
        const title = `Opinion: ${o.caseName || "Untitled case"}`;
        const url = o.absolute_url ? `https://www.courtlistener.com${o.absolute_url}` : null;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nCourt: ${o.court || "?"}\nFiled: ${o.dateFiled || "?"}\nCitation: ${o.citation || "—"}\n${o.snippet || ""}${url ? `\n\n${url}` : ""}`,
          tags: ["law", "feed", "court-opinion"],
          source: "courtlistener-feed",
          meta: { opinionId: o.id, caseName: o.caseName, court: o.court, dateFiled: o.dateFiled, url },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(String(o.id)); }
      }
      saveLaw();
      return { ok: true, result: { ingested, skipped, source: "courtlistener", dtuIds } };
    } catch (e) {
      return { ok: false, error: `courtlistener unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}

/**
 * Extract a text snippet around the first keyword match.
 */
function extractSnippet(text, keywords, maxLen) {
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    for (const kw of keywords) {
      if (words[i].includes(kw)) {
        const start = Math.max(0, i - 5);
        const end = Math.min(words.length, i + 15);
        let snippet = words.slice(start, end).join(" ");
        if (start > 0) snippet = "..." + snippet;
        if (end < words.length) snippet = snippet + "...";
        if (snippet.length > maxLen) snippet = snippet.substring(0, maxLen) + "...";
        return snippet;
      }
    }
  }
  return text.substring(0, maxLen) + (text.length > maxLen ? "..." : "");
}
