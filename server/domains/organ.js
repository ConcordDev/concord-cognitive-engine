// server/domains/organ.js
// Domain actions for organization/team management: org chart analysis,
// team composition evaluation, and communication flow modeling.

export default function registerOrganActions(registerLensAction) {
  /**
   * orgChart
   * Analyze org chart structure from artifact.data.employees:
   * [{ id, name, managerId, title?, level? }]
   * Computes span of control, depth, flatness ratio, bottleneck managers.
   */
  registerLensAction("organ", "orgChart", (ctx, artifact, _params) => {
    const employees = artifact.data?.employees || [];
    if (employees.length === 0) {
      return { ok: true, result: { message: "No employee data to analyze." } };
    }

    // Build adjacency: managerId -> list of direct reports
    const byId = {};
    const children = {};
    const roots = [];
    for (const emp of employees) {
      byId[emp.id] = emp;
      if (!children[emp.id]) children[emp.id] = [];
    }
    for (const emp of employees) {
      if (emp.managerId == null || !byId[emp.managerId]) {
        roots.push(emp.id);
      } else {
        if (!children[emp.managerId]) children[emp.managerId] = [];
        children[emp.managerId].push(emp.id);
      }
    }

    // Compute depth of each node via BFS from roots
    const depth = {};
    const queue = roots.map(id => ({ id, d: 0 }));
    while (queue.length > 0) {
      const { id, d } = queue.shift();
      depth[id] = d;
      for (const childId of (children[id] || [])) {
        queue.push({ id: childId, d: d + 1 });
      }
    }

    const maxDepth = Math.max(...Object.values(depth), 0);
    const totalNodes = employees.length;

    // Span of control: direct reports per manager
    const managers = Object.entries(children)
      .filter(([, reports]) => reports.length > 0)
      .map(([id, reports]) => ({
        id,
        name: byId[id]?.name || id,
        title: byId[id]?.title || "unknown",
        directReports: reports.length,
        depth: depth[id] ?? 0,
      }));

    const spans = managers.map(m => m.directReports);
    const avgSpan = spans.length > 0 ? spans.reduce((s, v) => s + v, 0) / spans.length : 0;
    const maxSpan = spans.length > 0 ? Math.max(...spans) : 0;
    const minSpan = spans.length > 0 ? Math.min(...spans) : 0;
    const spanStdDev = spans.length > 1
      ? Math.sqrt(spans.reduce((s, v) => s + Math.pow(v - avgSpan, 2), 0) / spans.length)
      : 0;

    // Flatness ratio: ratio of max possible depth (n-1) to actual depth
    const flatnessRatio = totalNodes > 1 ? 1 - (maxDepth / (totalNodes - 1)) : 1;

    // Bottleneck managers: span > avgSpan + 1.5 * stdDev or > 10
    const bottleneckThreshold = Math.max(avgSpan + 1.5 * spanStdDev, 8);
    const bottlenecks = managers
      .filter(m => m.directReports >= bottleneckThreshold)
      .sort((a, b) => b.directReports - a.directReports);

    // Level distribution
    const levelCounts = {};
    for (const d of Object.values(depth)) {
      levelCounts[d] = (levelCounts[d] || 0) + 1;
    }

    // Compute subtree sizes for each manager
    function subtreeSize(id) {
      let size = 1;
      for (const c of (children[id] || [])) {
        size += subtreeSize(c);
      }
      return size;
    }
    const managerSubtrees = managers.map(m => ({
      ...m,
      subtreeSize: subtreeSize(m.id),
    })).sort((a, b) => b.subtreeSize - a.subtreeSize);

    const r = (v) => Math.round(v * 1000) / 1000;

    return {
      ok: true,
      result: {
        totalEmployees: totalNodes,
        totalManagers: managers.length,
        individualContributors: totalNodes - managers.length,
        roots: roots.map(id => byId[id]?.name || id),
        depth: { max: maxDepth, levelDistribution: levelCounts },
        spanOfControl: {
          average: r(avgSpan),
          min: minSpan,
          max: maxSpan,
          stdDev: r(spanStdDev),
        },
        flatnessRatio: r(flatnessRatio),
        flatnessLabel: flatnessRatio > 0.9 ? "very flat" : flatnessRatio > 0.7 ? "flat" : flatnessRatio > 0.4 ? "moderate" : "tall",
        bottleneckManagers: bottlenecks.slice(0, 10),
        largestSubtrees: managerSubtrees.slice(0, 5).map(m => ({
          name: m.name, title: m.title, subtreeSize: m.subtreeSize, directReports: m.directReports,
        })),
      },
    };
  });

  /**
   * teamComposition
   * Evaluate team composition from artifact.data.team:
   * [{ name, skills: [string], role?, demographics?: { ... } }]
   * Computes skills coverage, diversity metrics, Belbin role balance.
   */
  registerLensAction("organ", "teamComposition", (ctx, artifact, params) => {
    const team = artifact.data?.team || [];
    const requiredSkills = params.requiredSkills || artifact.data?.requiredSkills || [];
    if (team.length === 0) {
      return { ok: true, result: { message: "No team data to analyze." } };
    }

    // Skills coverage matrix
    const allSkills = new Set();
    for (const member of team) {
      for (const skill of (member.skills || [])) allSkills.add(skill.toLowerCase());
    }
    for (const skill of requiredSkills) allSkills.add(skill.toLowerCase());

    const skillCoverage = {};
    for (const skill of allSkills) {
      const holders = team.filter(m => (m.skills || []).map(s => s.toLowerCase()).includes(skill));
      skillCoverage[skill] = {
        count: holders.length,
        holders: holders.map(m => m.name),
        coverage: team.length > 0 ? Math.round((holders.length / team.length) * 100) : 0,
        isRequired: requiredSkills.map(s => s.toLowerCase()).includes(skill),
      };
    }

    // Identify gaps: required skills with zero coverage
    const gaps = requiredSkills
      .filter(s => (skillCoverage[s.toLowerCase()]?.count || 0) === 0)
      .map(s => s);

    // Single-point-of-failure: required skills held by only one person
    const singlePoints = requiredSkills
      .filter(s => (skillCoverage[s.toLowerCase()]?.count || 0) === 1)
      .map(s => ({
        skill: s,
        holder: skillCoverage[s.toLowerCase()].holders[0],
      }));

    // Skill diversity: Shannon entropy over skill distribution
    const skillCounts = team.map(m => (m.skills || []).length);
    const totalSkillInstances = skillCounts.reduce((s, v) => s + v, 0);
    const skillFreqs = {};
    for (const member of team) {
      for (const skill of (member.skills || [])) {
        const s = skill.toLowerCase();
        skillFreqs[s] = (skillFreqs[s] || 0) + 1;
      }
    }
    let skillEntropy = 0;
    if (totalSkillInstances > 0) {
      for (const count of Object.values(skillFreqs)) {
        const p = count / totalSkillInstances;
        if (p > 0) skillEntropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = allSkills.size > 0 ? Math.log2(allSkills.size) : 0;
    const skillDiversityIndex = maxEntropy > 0 ? skillEntropy / maxEntropy : 0;

    // Belbin role balance scoring
    const belbinRoles = [
      "plant", "monitor-evaluator", "coordinator", "resource-investigator",
      "implementer", "completer-finisher", "teamworker", "shaper", "specialist",
    ];
    const roleMapping = {};
    for (const role of belbinRoles) roleMapping[role] = 0;
    for (const member of team) {
      const role = (member.role || "").toLowerCase();
      if (roleMapping[role] !== undefined) {
        roleMapping[role]++;
      }
    }
    const filledRoles = Object.values(roleMapping).filter(c => c > 0).length;
    const belbinBalance = filledRoles / belbinRoles.length;
    const missingBelbinRoles = belbinRoles.filter(r => roleMapping[r] === 0);

    // Demographic diversity (Simpson's diversity index) per attribute
    const demographics = {};
    const demoKeys = new Set();
    for (const member of team) {
      if (member.demographics) {
        for (const key of Object.keys(member.demographics)) demoKeys.add(key);
      }
    }
    for (const key of demoKeys) {
      const groups = {};
      for (const member of team) {
        const val = member.demographics?.[key] || "unspecified";
        groups[val] = (groups[val] || 0) + 1;
      }
      const n = team.length;
      // Simpson's diversity: 1 - sum(p_i^2)
      let simpsonSum = 0;
      for (const count of Object.values(groups)) {
        const p = count / n;
        simpsonSum += p * p;
      }
      demographics[key] = {
        groups,
        simpsonDiversity: Math.round((1 - simpsonSum) * 1000) / 1000,
        uniqueValues: Object.keys(groups).length,
      };
    }

    const r = (v) => Math.round(v * 1000) / 1000;

    return {
      ok: true,
      result: {
        teamSize: team.length,
        uniqueSkills: allSkills.size,
        skillCoverage,
        gaps,
        singlePointsOfFailure: singlePoints,
        skillDiversity: {
          shannonEntropy: r(skillEntropy),
          normalizedDiversity: r(skillDiversityIndex),
          label: skillDiversityIndex > 0.8 ? "excellent" : skillDiversityIndex > 0.6 ? "good" : skillDiversityIndex > 0.4 ? "moderate" : "low",
        },
        belbinRoleBalance: {
          score: r(belbinBalance),
          filledRoles,
          totalRoles: belbinRoles.length,
          missingRoles: missingBelbinRoles,
          distribution: roleMapping,
        },
        demographics,
      },
    };
  });

  /**
   * communicationFlow
   * Analyze communication patterns from artifact.data.communications:
   * [{ from, to, channel?, timestamp?, weight? }]
   * Builds communication graph, detects silos, computes flow efficiency.
   */
  registerLensAction("organ", "communicationFlow", (ctx, artifact, _params) => {
    const comms = artifact.data?.communications || [];
    if (comms.length === 0) {
      return { ok: true, result: { message: "No communication data to analyze." } };
    }

    // Build adjacency matrix and node set
    const nodes = new Set();
    const edges = {};
    const inDegree = {};
    const outDegree = {};
    for (const c of comms) {
      if (!c.from || !c.to) continue;
      nodes.add(c.from);
      nodes.add(c.to);
      const key = `${c.from}|${c.to}`;
      const w = c.weight || 1;
      edges[key] = (edges[key] || 0) + w;
      outDegree[c.from] = (outDegree[c.from] || 0) + w;
      inDegree[c.to] = (inDegree[c.to] || 0) + w;
    }

    const nodeList = [...nodes];
    const n = nodeList.length;
    const nodeIdx = {};
    nodeList.forEach((nd, i) => { nodeIdx[nd] = i; });

    // Build adjacency list for reachability
    const adj = {};
    for (const nd of nodeList) adj[nd] = new Set();
    for (const c of comms) {
      if (c.from && c.to) adj[c.from].add(c.to);
    }

    // Detect connected components (undirected) for silo detection
    const visited = new Set();
    const components = [];
    for (const nd of nodeList) {
      if (visited.has(nd)) continue;
      const component = [];
      const stack = [nd];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (visited.has(cur)) continue;
        visited.add(cur);
        component.push(cur);
        // Treat as undirected for component detection
        for (const neighbor of (adj[cur] || [])) {
          if (!visited.has(neighbor)) stack.push(neighbor);
        }
        // Reverse edges
        for (const other of nodeList) {
          if (adj[other]?.has(cur) && !visited.has(other)) stack.push(other);
        }
      }
      components.push(component);
    }

    // Density: actual edges / possible edges
    const uniqueEdges = Object.keys(edges).length;
    const maxEdges = n * (n - 1);
    const density = maxEdges > 0 ? uniqueEdges / maxEdges : 0;

    // Reciprocity: fraction of edges with reciprocal
    let reciprocalCount = 0;
    for (const key of Object.keys(edges)) {
      const [from, to] = key.split("|");
      const reverseKey = `${to}|${from}`;
      if (edges[reverseKey]) reciprocalCount++;
    }
    const reciprocity = uniqueEdges > 0 ? reciprocalCount / uniqueEdges : 0;

    // Hub analysis: nodes with highest total degree
    const totalDegree = {};
    for (const nd of nodeList) {
      totalDegree[nd] = (inDegree[nd] || 0) + (outDegree[nd] || 0);
    }
    const hubs = nodeList
      .map(nd => ({ node: nd, totalDegree: totalDegree[nd], inDegree: inDegree[nd] || 0, outDegree: outDegree[nd] || 0 }))
      .sort((a, b) => b.totalDegree - a.totalDegree);

    // Betweenness centrality approximation (BFS shortest paths)
    const betweenness = {};
    for (const nd of nodeList) betweenness[nd] = 0;
    for (const source of nodeList) {
      // BFS
      const dist = {};
      const sigma = {};
      const pred = {};
      for (const nd of nodeList) { dist[nd] = -1; sigma[nd] = 0; pred[nd] = []; }
      dist[source] = 0;
      sigma[source] = 1;
      const bfsQueue = [source];
      const order = [];
      while (bfsQueue.length > 0) {
        const v = bfsQueue.shift();
        order.push(v);
        for (const w of (adj[v] || [])) {
          if (dist[w] < 0) {
            dist[w] = dist[v] + 1;
            bfsQueue.push(w);
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            pred[w].push(v);
          }
        }
      }
      const delta = {};
      for (const nd of nodeList) delta[nd] = 0;
      while (order.length > 0) {
        const w = order.pop();
        for (const v of pred[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== source) betweenness[w] += delta[w];
      }
    }

    const brokers = nodeList
      .map(nd => ({ node: nd, betweenness: Math.round(betweenness[nd] * 1000) / 1000 }))
      .sort((a, b) => b.betweenness - a.betweenness);

    // Silo detection: components with >= 2 members and weak inter-component links
    const silos = components.filter(c => c.length >= 2).map(c => ({
      members: c,
      size: c.length,
    }));

    // Channel distribution
    const channelCounts = {};
    for (const c of comms) {
      const ch = c.channel || "unspecified";
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
    }

    // Information flow efficiency: avg shortest path length
    let totalPathLength = 0;
    let reachablePairs = 0;
    for (const source of nodeList) {
      const dist = {};
      dist[source] = 0;
      const q = [source];
      while (q.length > 0) {
        const v = q.shift();
        for (const w of (adj[v] || [])) {
          if (dist[w] === undefined) {
            dist[w] = dist[v] + 1;
            q.push(w);
          }
        }
      }
      for (const target of nodeList) {
        if (target !== source && dist[target] !== undefined) {
          totalPathLength += dist[target];
          reachablePairs++;
        }
      }
    }
    const avgPathLength = reachablePairs > 0 ? totalPathLength / reachablePairs : Infinity;
    const reachability = maxEdges > 0 ? reachablePairs / maxEdges : 0;

    const r = (v) => Math.round(v * 1000) / 1000;

    return {
      ok: true,
      result: {
        nodes: n,
        edges: uniqueEdges,
        totalMessages: comms.length,
        density: r(density),
        reciprocity: r(reciprocity),
        connectedComponents: components.length,
        silos: silos.length > 1 ? silos : [],
        siloDetected: components.length > 1,
        hubs: hubs.slice(0, 5),
        brokers: brokers.slice(0, 5),
        channels: channelCounts,
        flowEfficiency: {
          avgPathLength: r(avgPathLength),
          reachability: r(reachability),
          label: avgPathLength <= 2 ? "excellent" : avgPathLength <= 3 ? "good" : avgPathLength <= 5 ? "moderate" : "poor",
        },
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Persistent org-design substrate (per-user, STATE-backed).
  // ChartHop-parity: roster CRUD, HRIS import, visual chart, drag-reassign,
  // comp rollups, headcount scenarios, tenure/attrition, org snapshots.
  // ─────────────────────────────────────────────────────────────────────

  function getOrganState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.organLens) STATE.organLens = {};
    const o = STATE.organLens;
    if (!(o.roster instanceof Map)) o.roster = new Map();      // userId -> Array<Employee>
    if (!(o.scenarios instanceof Map)) o.scenarios = new Map(); // userId -> Array<Scenario>
    if (!(o.snapshots instanceof Map)) o.snapshots = new Map(); // userId -> Array<Snapshot>
    return o;
  }
  function saveOrgan() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const oId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const oActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const oClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const oNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const oRound = (v) => Math.round(v * 100) / 100;
  const oList = (s, k, userId) => { if (!s[k].has(userId)) s[k].set(userId, []); return s[k].get(userId); };

  // Parse a date-ish value into epoch ms or null.
  function parseDate(v) {
    if (v == null || v === "") return null;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  // Years between an epoch-ms start and now.
  function yearsSince(ms) {
    if (ms == null) return null;
    return oRound((Date.now() - ms) / (365.25 * 24 * 3600 * 1000));
  }

  // Normalize a raw employee record into the canonical roster shape.
  function normEmployee(raw, existingId) {
    return {
      id: existingId || oClean(raw.id, 80) || oId("emp"),
      name: oClean(raw.name, 160) || "Unnamed",
      title: oClean(raw.title, 160) || "",
      department: oClean(raw.department, 120) || "",
      managerId: raw.managerId == null || raw.managerId === "" ? null : oClean(raw.managerId, 80),
      email: oClean(raw.email, 200) || "",
      location: oClean(raw.location, 120) || "",
      compensation: Math.max(0, oNum(raw.compensation)),
      startDate: oClean(raw.startDate, 40) || "",
      level: oClean(raw.level, 40) || "",
      status: ["active", "on_leave", "departed", "open_req"].includes(raw.status) ? raw.status : "active",
      skills: Array.isArray(raw.skills)
        ? raw.skills.map((s) => oClean(s, 60)).filter(Boolean).slice(0, 40)
        : (typeof raw.skills === "string" && raw.skills
            ? raw.skills.split(/[;,|]/).map((s) => oClean(s, 60)).filter(Boolean).slice(0, 40)
            : []),
    };
  }

  // Build a tree of TreeNode shapes from the roster for the visual chart.
  function buildChartTree(roster) {
    const byId = {};
    const children = {};
    for (const e of roster) { byId[e.id] = e; children[e.id] = []; }
    const roots = [];
    for (const e of roster) {
      if (e.managerId && byId[e.managerId]) children[e.managerId].push(e.id);
      else roots.push(e.id);
    }
    const subtree = (id) => {
      const e = byId[id];
      const kids = children[id].map(subtree);
      const tone = e.status === "open_req" ? "warn"
        : e.status === "departed" ? "bad"
        : e.status === "on_leave" ? "info"
        : kids.length > 0 ? "good" : "default";
      return {
        id: e.id,
        label: e.name,
        detail: [e.title, e.department].filter(Boolean).join(" · "),
        tone,
        directReports: children[id].length,
        children: kids,
      };
    };
    return roots.map(subtree);
  }

  /**
   * roster-set — replace the entire stored roster (used by editor save).
   */
  registerLensAction("organ", "roster-set", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const incoming = Array.isArray(params.employees) ? params.employees : [];
      const roster = incoming.slice(0, 5000).map((e) => normEmployee(e, oClean(e.id, 80) || null));
      s.roster.set(oActor(ctx), roster);
      saveOrgan();
      return { ok: true, result: { count: roster.length, employees: roster } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * roster-list — return the stored roster + a chart tree + headline stats.
   */
  registerLensAction("organ", "roster-list", (ctx, _a, _params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      const active = roster.filter((e) => e.status === "active" || e.status === "on_leave");
      const openReqs = roster.filter((e) => e.status === "open_req");
      const departments = [...new Set(roster.map((e) => e.department).filter(Boolean))];
      return {
        ok: true,
        result: {
          employees: roster,
          count: roster.length,
          activeCount: active.length,
          openReqCount: openReqs.length,
          departedCount: roster.filter((e) => e.status === "departed").length,
          departments,
          tree: buildChartTree(roster),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * employee-upsert — add or update a single employee.
   */
  registerLensAction("organ", "employee-upsert", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      const id = oClean(params.id, 80);
      let emp;
      if (id) {
        const idx = roster.findIndex((e) => e.id === id);
        if (idx === -1) return { ok: false, error: "employee not found" };
        emp = normEmployee({ ...roster[idx], ...params }, id);
        roster[idx] = emp;
      } else {
        if (!oClean(params.name, 160)) return { ok: false, error: "name required" };
        emp = normEmployee(params, null);
        roster.push(emp);
      }
      saveOrgan();
      return { ok: true, result: { employee: emp, count: roster.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * employee-remove — delete an employee; reassigns orphaned reports to its manager.
   */
  registerLensAction("organ", "employee-remove", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      const id = oClean(params.id, 80);
      const idx = roster.findIndex((e) => e.id === id);
      if (idx === -1) return { ok: false, error: "employee not found" };
      const removed = roster[idx];
      let reassigned = 0;
      for (const e of roster) {
        if (e.managerId === id) { e.managerId = removed.managerId; reassigned++; }
      }
      roster.splice(idx, 1);
      saveOrgan();
      return { ok: true, result: { removed: removed.id, reassigned, count: roster.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * reassign — drag-to-reassign: move an employee under a new manager.
   * Rejects cycles (cannot report to one of your own descendants).
   */
  registerLensAction("organ", "reassign", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      const empId = oClean(params.employeeId, 80);
      const newMgr = params.newManagerId == null || params.newManagerId === ""
        ? null : oClean(params.newManagerId, 80);
      const emp = roster.find((e) => e.id === empId);
      if (!emp) return { ok: false, error: "employee not found" };
      if (newMgr) {
        if (newMgr === empId) return { ok: false, error: "cannot report to self" };
        if (!roster.find((e) => e.id === newMgr)) return { ok: false, error: "manager not found" };
        // cycle check: walk newMgr's chain — empId must not appear.
        const childMap = {};
        for (const e of roster) {
          if (e.managerId) (childMap[e.managerId] = childMap[e.managerId] || []).push(e.id);
        }
        const descendants = new Set();
        const stack = [empId];
        while (stack.length) {
          const cur = stack.pop();
          for (const c of (childMap[cur] || [])) {
            if (!descendants.has(c)) { descendants.add(c); stack.push(c); }
          }
        }
        if (descendants.has(newMgr)) return { ok: false, error: "would create a reporting cycle" };
      }
      const prev = emp.managerId;
      emp.managerId = newMgr;
      saveOrgan();
      return { ok: true, result: { employeeId: empId, previousManagerId: prev, newManagerId: newMgr, tree: buildChartTree(roster) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * hris-import — parse a CSV roster (BambooHR / Workday / generic export).
   * Columns matched case-insensitively: name,title,department,manager,
   * managerId,email,location,compensation,salary,startDate,level,status,skills.
   */
  registerLensAction("organ", "hris-import", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const csv = String(params.csv || "").trim();
      if (!csv) return { ok: false, error: "csv content required" };
      const mode = params.mode === "merge" ? "merge" : "replace";

      // Minimal CSV parser (handles quoted fields + embedded commas).
      function parseCSV(text) {
        const rows = [];
        let row = [], field = "", inQuotes = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQuotes) {
            if (ch === '"') {
              if (text[i + 1] === '"') { field += '"'; i++; }
              else inQuotes = false;
            } else field += ch;
          } else if (ch === '"') inQuotes = true;
          else if (ch === ",") { row.push(field); field = ""; }
          else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            if (row.some((c) => c.trim() !== "")) rows.push(row);
            row = [];
          } else field += ch;
        }
        if (field !== "" || row.length) { row.push(field); if (row.some((c) => c.trim() !== "")) rows.push(row); }
        return rows;
      }

      const rows = parseCSV(csv);
      if (rows.length < 2) return { ok: false, error: "csv has no data rows" };
      const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
      const colOf = (...names) => {
        for (const nm of names) { const i = headers.indexOf(nm); if (i !== -1) return i; }
        return -1;
      };
      const cols = {
        id: colOf("id", "employeeid", "workerid"),
        name: colOf("name", "fullname", "employeename", "displayname"),
        title: colOf("title", "jobtitle", "position"),
        department: colOf("department", "dept", "team", "businessunit"),
        managerId: colOf("managerid", "supervisorid"),
        managerName: colOf("manager", "supervisor", "reportsto"),
        email: colOf("email", "workemail", "emailaddress"),
        location: colOf("location", "office", "site"),
        compensation: colOf("compensation", "salary", "basesalary", "comp", "pay"),
        startDate: colOf("startdate", "hiredate", "joindate"),
        level: colOf("level", "grade", "band", "tier"),
        status: colOf("status", "employmentstatus"),
        skills: colOf("skills", "competencies"),
      };
      if (cols.name === -1) return { ok: false, error: "csv must have a 'name' column" };

      const at = (r, c) => (c === -1 ? "" : (r[c] || "").trim());
      const imported = [];
      const nameToId = {};
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const emp = normEmployee({
          id: at(r, cols.id),
          name: at(r, cols.name),
          title: at(r, cols.title),
          department: at(r, cols.department),
          managerId: at(r, cols.managerId),
          email: at(r, cols.email),
          location: at(r, cols.location),
          compensation: at(r, cols.compensation).replace(/[$,]/g, ""),
          startDate: at(r, cols.startDate),
          level: at(r, cols.level),
          status: at(r, cols.status).toLowerCase().replace(/[\s-]+/g, "_") || "active",
          skills: at(r, cols.skills),
        }, at(r, cols.id) || null);
        emp._mgrName = at(r, cols.managerName);
        imported.push(emp);
        nameToId[emp.name.toLowerCase()] = emp.id;
      }
      // Resolve manager-by-name links when managerId wasn't supplied.
      for (const emp of imported) {
        if (!emp.managerId && emp._mgrName) {
          const resolved = nameToId[emp._mgrName.toLowerCase()];
          if (resolved && resolved !== emp.id) emp.managerId = resolved;
        }
        delete emp._mgrName;
      }
      const target = oList(s, "roster", oActor(ctx));
      let roster;
      if (mode === "merge") {
        const map = new Map(target.map((e) => [e.id, e]));
        for (const e of imported) map.set(e.id, e);
        roster = [...map.values()];
      } else roster = imported;
      s.roster.set(oActor(ctx), roster);
      saveOrgan();
      return {
        ok: true,
        result: {
          imported: imported.length,
          mode,
          totalCount: roster.length,
          columnsDetected: Object.entries(cols).filter(([, v]) => v !== -1).map(([k]) => k),
          employees: roster,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * comp-rollup — total compensation per department + per manager subtree.
   */
  registerLensAction("organ", "comp-rollup", (ctx, _a, _params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx)).filter((e) => e.status !== "departed");
      if (roster.length === 0) return { ok: true, result: { message: "No roster — import or add employees first.", departments: [], subtrees: [] } };

      const byDept = {};
      for (const e of roster) {
        const d = e.department || "Unassigned";
        if (!byDept[d]) byDept[d] = { department: d, headcount: 0, totalComp: 0, openReqs: 0 };
        byDept[d].headcount++;
        byDept[d].totalComp += e.compensation;
        if (e.status === "open_req") byDept[d].openReqs++;
      }
      const departments = Object.values(byDept)
        .map((d) => ({ ...d, totalComp: oRound(d.totalComp), avgComp: oRound(d.totalComp / Math.max(1, d.headcount)) }))
        .sort((a, b) => b.totalComp - a.totalComp);

      // Subtree comp rollup per manager.
      const byId = {}, children = {};
      for (const e of roster) { byId[e.id] = e; children[e.id] = []; }
      for (const e of roster) {
        if (e.managerId && byId[e.managerId]) children[e.managerId].push(e.id);
      }
      const subComp = (id) => {
        let total = byId[id].compensation, count = 1;
        for (const c of children[id]) { const r2 = subComp(c); total += r2.total; count += r2.count; }
        return { total, count };
      };
      const subtrees = roster
        .filter((e) => children[e.id].length > 0)
        .map((e) => { const { total, count } = subComp(e.id); return { managerId: e.id, manager: e.name, department: e.department, subtreeComp: oRound(total), subtreeHeadcount: count }; })
        .sort((a, b) => b.subtreeComp - a.subtreeComp);

      const totalComp = roster.reduce((sum, e) => sum + e.compensation, 0);
      return {
        ok: true,
        result: {
          totalComp: oRound(totalComp),
          headcount: roster.length,
          avgComp: oRound(totalComp / Math.max(1, roster.length)),
          departments,
          subtrees: subtrees.slice(0, 25),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * tenure-attrition — time-in-role + flight-risk overlay.
   */
  registerLensAction("organ", "tenure-attrition", (ctx, _a, _params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      if (roster.length === 0) return { ok: true, result: { message: "No roster — import or add employees first.", employees: [] } };

      const active = roster.filter((e) => e.status === "active" || e.status === "on_leave");
      const departed = roster.filter((e) => e.status === "departed");
      const withTenure = active
        .map((e) => ({ ...e, tenureYears: yearsSince(parseDate(e.startDate)) }))
        .filter((e) => e.tenureYears != null);

      // Flight-risk heuristic: long tenure (>3.5y) with no level info, or
      // bucket-tail employees with very long stays in the same role.
      const scored = withTenure.map((e) => {
        let risk = 0;
        if (e.tenureYears > 4) risk += 0.4;
        else if (e.tenureYears > 2.5) risk += 0.25;
        else if (e.tenureYears < 0.5) risk += 0.15; // new-hire churn
        if (!e.level) risk += 0.15;
        if (!e.title) risk += 0.1;
        risk = Math.min(1, oRound(risk));
        return { id: e.id, name: e.name, department: e.department, tenureYears: e.tenureYears, flightRisk: risk, riskLabel: risk >= 0.5 ? "high" : risk >= 0.25 ? "moderate" : "low" };
      }).sort((a, b) => b.flightRisk - a.flightRisk);

      const tenures = withTenure.map((e) => e.tenureYears);
      const avgTenure = tenures.length ? oRound(tenures.reduce((x, y) => x + y, 0) / tenures.length) : 0;
      // Attrition rate: departed / (active + departed).
      const attritionRate = roster.length ? oRound(departed.length / (active.length + departed.length || 1)) : 0;

      // Tenure buckets for charting.
      const buckets = [
        { range: "<1y", min: 0, max: 1 },
        { range: "1-2y", min: 1, max: 2 },
        { range: "2-4y", min: 2, max: 4 },
        { range: "4-7y", min: 4, max: 7 },
        { range: "7y+", min: 7, max: Infinity },
      ].map((b) => ({ range: b.range, count: withTenure.filter((e) => e.tenureYears >= b.min && e.tenureYears < b.max).length }));

      return {
        ok: true,
        result: {
          avgTenureYears: avgTenure,
          attritionRate,
          activeCount: active.length,
          departedCount: departed.length,
          highRiskCount: scored.filter((e) => e.flightRisk >= 0.5).length,
          tenureBuckets: buckets,
          employees: scored,
          unknownStartDates: active.length - withTenure.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * scenario-create — headcount planning what-if. Models open reqs added on
   * top of the live roster; projects fully-loaded cost.
   */
  registerLensAction("organ", "scenario-create", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const name = oClean(params.name, 120);
      if (!name) return { ok: false, error: "scenario name required" };
      const reqs = Array.isArray(params.openReqs) ? params.openReqs : [];
      const loadFactor = Math.max(1, Math.min(2.5, oNum(params.loadFactor) || 1.3)); // benefits/taxes
      const planned = reqs.slice(0, 500).map((r2) => ({
        title: oClean(r2.title, 160) || "Open Req",
        department: oClean(r2.department, 120) || "Unassigned",
        level: oClean(r2.level, 40) || "",
        baseComp: Math.max(0, oNum(r2.baseComp)),
        count: Math.max(1, Math.round(oNum(r2.count) || 1)),
      }));
      const roster = oList(s, "roster", oActor(ctx)).filter((e) => e.status !== "departed");
      const currentHeadcount = roster.length;
      const currentComp = roster.reduce((sum, e) => sum + e.compensation, 0);
      const addedHeadcount = planned.reduce((sum, p) => sum + p.count, 0);
      const addedBaseComp = planned.reduce((sum, p) => sum + p.baseComp * p.count, 0);
      const scenario = {
        id: oId("scn"),
        name,
        createdAt: new Date().toISOString(),
        loadFactor,
        openReqs: planned,
        projection: {
          currentHeadcount,
          projectedHeadcount: currentHeadcount + addedHeadcount,
          currentComp: oRound(currentComp),
          addedBaseComp: oRound(addedBaseComp),
          addedFullyLoadedCost: oRound(addedBaseComp * loadFactor),
          projectedTotalCost: oRound(currentComp + addedBaseComp * loadFactor),
          headcountGrowthPct: currentHeadcount ? oRound((addedHeadcount / currentHeadcount) * 100) : null,
        },
      };
      oList(s, "scenarios", oActor(ctx)).push(scenario);
      saveOrgan();
      return { ok: true, result: { scenario } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * scenario-list — all saved headcount scenarios for the user.
   */
  registerLensAction("organ", "scenario-list", (ctx, _a, _params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const scenarios = oList(s, "scenarios", oActor(ctx));
      return { ok: true, result: { scenarios, count: scenarios.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * scenario-delete — remove a saved scenario.
   */
  registerLensAction("organ", "scenario-delete", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const scenarios = oList(s, "scenarios", oActor(ctx));
      const id = oClean(params.id, 80);
      const idx = scenarios.findIndex((x) => x.id === id);
      if (idx === -1) return { ok: false, error: "scenario not found" };
      scenarios.splice(idx, 1);
      saveOrgan();
      return { ok: true, result: { removed: id, count: scenarios.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * snapshot-capture — freeze the current roster as a dated org snapshot.
   */
  registerLensAction("organ", "snapshot-capture", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const roster = oList(s, "roster", oActor(ctx));
      if (roster.length === 0) return { ok: false, error: "roster is empty — nothing to snapshot" };
      const snapshots = oList(s, "snapshots", oActor(ctx));
      const snap = {
        id: oId("snap"),
        label: oClean(params.label, 120) || new Date().toLocaleDateString(),
        capturedAt: new Date().toISOString(),
        headcount: roster.filter((e) => e.status !== "departed" && e.status !== "open_req").length,
        totalComp: oRound(roster.filter((e) => e.status !== "departed").reduce((sum, e) => sum + e.compensation, 0)),
        roster: roster.map((e) => ({ ...e })),
      };
      snapshots.push(snap);
      if (snapshots.length > 50) snapshots.splice(0, snapshots.length - 50);
      saveOrgan();
      return { ok: true, result: { snapshot: { id: snap.id, label: snap.label, capturedAt: snap.capturedAt, headcount: snap.headcount, totalComp: snap.totalComp }, count: snapshots.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * snapshot-list — metadata of all captured snapshots (roster omitted).
   */
  registerLensAction("organ", "snapshot-list", (ctx, _a, _params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const snapshots = oList(s, "snapshots", oActor(ctx));
      return {
        ok: true,
        result: {
          snapshots: snapshots.map((sn) => ({ id: sn.id, label: sn.label, capturedAt: sn.capturedAt, headcount: sn.headcount, totalComp: sn.totalComp })),
          count: snapshots.length,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * snapshot-diff — diff two snapshots (or one snapshot vs the live roster)
   * to surface hires, departures, reorgs, and comp drift.
   */
  registerLensAction("organ", "snapshot-diff", (ctx, _a, params = {}) => {
    try {
      const s = getOrganState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const snapshots = oList(s, "snapshots", oActor(ctx));
      const roster = oList(s, "roster", oActor(ctx));

      const resolve = (key) => {
        if (!key || key === "live") {
          return { label: "Live roster", capturedAt: new Date().toISOString(), roster };
        }
        const sn = snapshots.find((x) => x.id === key);
        return sn ? { label: sn.label, capturedAt: sn.capturedAt, roster: sn.roster } : null;
      };
      const from = resolve(oClean(params.fromId, 80));
      const to = resolve(oClean(params.toId, 80) || "live");
      if (!from) return { ok: false, error: "from snapshot not found" };
      if (!to) return { ok: false, error: "to snapshot not found" };

      const fromMap = new Map(from.roster.map((e) => [e.id, e]));
      const toMap = new Map(to.roster.map((e) => [e.id, e]));

      const hires = [], departures = [], reorgs = [], compChanges = [];
      for (const [id, e] of toMap) {
        if (!fromMap.has(id)) hires.push({ id, name: e.name, title: e.title, department: e.department });
      }
      for (const [id, e] of fromMap) {
        if (!toMap.has(id)) departures.push({ id, name: e.name, title: e.title, department: e.department });
      }
      for (const [id, after] of toMap) {
        const before = fromMap.get(id);
        if (!before) continue;
        if (before.managerId !== after.managerId || before.department !== after.department || before.title !== after.title) {
          reorgs.push({ id, name: after.name, from: { managerId: before.managerId, department: before.department, title: before.title }, to: { managerId: after.managerId, department: after.department, title: after.title } });
        }
        if (before.compensation !== after.compensation) {
          compChanges.push({ id, name: after.name, before: before.compensation, after: after.compensation, delta: oRound(after.compensation - before.compensation) });
        }
      }
      const fromHc = from.roster.filter((e) => e.status !== "departed" && e.status !== "open_req").length;
      const toHc = to.roster.filter((e) => e.status !== "departed" && e.status !== "open_req").length;
      const fromComp = from.roster.filter((e) => e.status !== "departed").reduce((x, e) => x + e.compensation, 0);
      const toComp = to.roster.filter((e) => e.status !== "departed").reduce((x, e) => x + e.compensation, 0);

      return {
        ok: true,
        result: {
          from: { label: from.label, capturedAt: from.capturedAt },
          to: { label: to.label, capturedAt: to.capturedAt },
          headcountDelta: toHc - fromHc,
          compDelta: oRound(toComp - fromComp),
          hires,
          departures,
          reorgs,
          compChanges: compChanges.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
          summary: {
            hired: hires.length,
            departed: departures.length,
            reorganized: reorgs.length,
            compAdjusted: compChanges.length,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
