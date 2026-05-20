// server/domains/law.js
// Domain actions for law: case analysis, statute lookup, deadline
// tracking, billing calculation, plus real USPTO PatentsView (patent
// search) and CourtListener (federal + state case opinions).
//
// USPTO PatentsView is free + no API key.
// CourtListener search is free without auth; full text + dockets
// require a free COURTLISTENER_API_TOKEN env (courtlistener.com/help/api/rest/).

const USPTO_PATENTSVIEW = "https://search.patentsview.org/api/v1";
const COURTLISTENER_BASE = "https://www.courtlistener.com/api/rest/v4";

export default function registerLawActions(registerLensAction) {
  /**
   * caseAnalysis
   * Analyze case data: compute duration, categorize by type, track outcomes and win rates.
   * artifact.data.cases = [{ id, type, filedDate, closedDate, outcome, parties, judge, ... }]
   */
  registerLensAction("law", "caseAnalysis", (ctx, artifact, _params) => {
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
  });

  /**
   * statuteLookup
   * Search statutes by keyword in provisions array, rank by relevance.
   * artifact.data.statutes = [{ code, title, provisions: [{ section, text }], jurisdiction }]
   */
  registerLensAction("law", "statuteLookup", (ctx, artifact, _params) => {
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
  });

  /**
   * deadlineTracker
   * Calculate days remaining for legal deadlines, flag overdue and urgent items.
   * artifact.data.deadlines = [{ id, description, dueDate, category, status, filingType }]
   */
  registerLensAction("law", "deadlineTracker", (ctx, artifact, _params) => {
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
  });

  /**
   * billingCalculator
   * Compute legal billing from time entries: hourly rates, totals, by-attorney breakdown.
   * artifact.data.timeEntries = [{ attorney, hours, rate, date, description, category, billable }]
   */
  registerLensAction("law", "billingCalculator", (ctx, artifact, _params) => {
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
