// server/domains/alliance.js
// Domain actions for partnership/alliance management: compatibility scoring, network analysis, risk assessment.

export default function registerAllianceActions(registerLensAction) {
  /**
   * compatibilityScore
   * Score compatibility between potential partners based on capabilities, values alignment,
   * resource complementarity using Jaccard similarity and weighted scoring.
   * artifact.data.partnerA: { name, capabilities: [string], values: [string], resources: [string], strengths: [string] }
   * artifact.data.partnerB: { name, capabilities: [string], values: [string], resources: [string], strengths: [string] }
   * params.weights — optional { capabilities, values, resources, complementarity } weight overrides
   */
  registerLensAction("alliance", "compatibilityScore", (ctx, artifact, params) => {
    const a = artifact.data.partnerA || {};
    const b = artifact.data.partnerB || {};

    const weights = {
      capabilities: 0.3,
      values: 0.35,
      resources: 0.15,
      complementarity: 0.2,
      ...(params.weights || {}),
    };

    // Jaccard similarity: |A ∩ B| / |A ∪ B|
    function jaccard(setA, setB) {
      const a = new Set(setA);
      const b = new Set(setB);
      if (a.size === 0 && b.size === 0) return 1;
      let intersection = 0;
      for (const item of a) {
        if (b.has(item)) intersection++;
      }
      const union = a.size + b.size - intersection;
      return union > 0 ? intersection / union : 0;
    }

    // Complementarity: items one has that the other lacks (mutual fill-the-gap)
    function complementarity(listA, listB) {
      const a = new Set(listA || []);
      const b = new Set(listB || []);
      if (a.size === 0 && b.size === 0) return 0;
      let aOnly = 0;
      let bOnly = 0;
      for (const item of a) {
        if (!b.has(item)) aOnly++;
      }
      for (const item of b) {
        if (!a.has(item)) bOnly++;
      }
      // High complementarity = both bring unique things, low overlap
      const totalUnique = aOnly + bOnly;
      const total = a.size + b.size;
      return total > 0 ? totalUnique / total : 0;
    }

    const capabilitySimilarity = jaccard(a.capabilities || [], b.capabilities || []);
    const valuesSimilarity = jaccard(a.values || [], b.values || []);
    const resourceSimilarity = jaccard(a.resources || [], b.resources || []);
    const resourceComplementarity = complementarity(a.resources || [], b.resources || []);
    const strengthComplementarity = complementarity(a.strengths || [], b.strengths || []);

    // Combined complementarity score: higher is better (partners bring different things)
    const complementarityScore = (resourceComplementarity + strengthComplementarity) / 2;

    // Weighted composite: values alignment and capability overlap are good,
    // complementarity in resources is good (they fill each other's gaps)
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
    const composite = (
      capabilitySimilarity * weights.capabilities +
      valuesSimilarity * weights.values +
      resourceSimilarity * weights.resources +
      complementarityScore * weights.complementarity
    ) / totalWeight;

    // Overlap analysis
    const capOverlap = (a.capabilities || []).filter(c => (b.capabilities || []).includes(c));
    const valOverlap = (a.values || []).filter(v => (b.values || []).includes(v));
    const resOverlap = (a.resources || []).filter(r => (b.resources || []).includes(r));

    // Unique contributions from each partner
    const aUniqueCapabilities = (a.capabilities || []).filter(c => !(b.capabilities || []).includes(c));
    const bUniqueCapabilities = (b.capabilities || []).filter(c => !(a.capabilities || []).includes(c));
    const aUniqueResources = (a.resources || []).filter(r => !(b.resources || []).includes(r));
    const bUniqueResources = (b.resources || []).filter(r => !(a.resources || []).includes(r));

    const compatibilityLevel = composite >= 0.75 ? "excellent"
      : composite >= 0.55 ? "good"
      : composite >= 0.35 ? "moderate"
      : "low";

    const result = {
      analyzedAt: new Date().toISOString(),
      partnerA: a.name || "Partner A",
      partnerB: b.name || "Partner B",
      compositeScore: Math.round(composite * 10000) / 100,
      compatibilityLevel,
      componentScores: {
        capabilitySimilarity: Math.round(capabilitySimilarity * 10000) / 100,
        valuesAlignment: Math.round(valuesSimilarity * 10000) / 100,
        resourceSimilarity: Math.round(resourceSimilarity * 10000) / 100,
        complementarity: Math.round(complementarityScore * 10000) / 100,
      },
      overlap: {
        capabilities: capOverlap,
        values: valOverlap,
        resources: resOverlap,
      },
      uniqueContributions: {
        [a.name || "partnerA"]: { capabilities: aUniqueCapabilities, resources: aUniqueResources },
        [b.name || "partnerB"]: { capabilities: bUniqueCapabilities, resources: bUniqueResources },
      },
      weights,
    };

    artifact.data.compatibilityScore = result;
    return { ok: true, result };
  });

  /**
   * networkAnalysis
   * Analyze alliance network for structural holes, brokerage positions,
   * and cluster coefficients.
   * artifact.data.nodes: [{ id, name, attributes? }]
   * artifact.data.edges: [{ source, target, weight? }]
   */
  registerLensAction("alliance", "networkAnalysis", (ctx, artifact, params) => {
    const nodes = artifact.data.nodes || [];
    const edges = artifact.data.edges || [];

    if (nodes.length === 0) {
      return { ok: true, result: { message: "No nodes provided for network analysis." } };
    }

    // Build adjacency list (undirected)
    const adj = {};
    const nodeSet = new Set(nodes.map(n => n.id));
    for (const n of nodes) {
      adj[n.id] = new Set();
    }
    for (const edge of edges) {
      if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
        adj[edge.source].add(edge.target);
        adj[edge.target].add(edge.source);
      }
    }

    // Degree centrality
    const degrees = {};
    const maxPossibleDegree = nodes.length - 1;
    for (const n of nodes) {
      degrees[n.id] = {
        degree: adj[n.id].size,
        centrality: maxPossibleDegree > 0 ? Math.round((adj[n.id].size / maxPossibleDegree) * 10000) / 10000 : 0,
      };
    }

    // Betweenness centrality (Brandes algorithm simplified for small networks)
    const betweenness = {};
    for (const n of nodes) betweenness[n.id] = 0;

    for (const s of nodes) {
      const stack = [];
      const pred = {};
      const sigma = {};
      const dist = {};
      const delta = {};

      for (const n of nodes) {
        pred[n.id] = [];
        sigma[n.id] = 0;
        dist[n.id] = -1;
        delta[n.id] = 0;
      }

      sigma[s.id] = 1;
      dist[s.id] = 0;
      const queue = [s.id];

      while (queue.length > 0) {
        const v = queue.shift();
        stack.push(v);
        for (const w of adj[v]) {
          if (dist[w] < 0) {
            queue.push(w);
            dist[w] = dist[v] + 1;
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            pred[w].push(v);
          }
        }
      }

      while (stack.length > 0) {
        const w = stack.pop();
        for (const v of pred[w]) {
          delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
        }
        if (w !== s.id) {
          betweenness[w] += delta[w];
        }
      }
    }

    // Normalize betweenness
    const n = nodes.length;
    const normFactor = n > 2 ? 2 / ((n - 1) * (n - 2)) : 1;
    for (const id of Object.keys(betweenness)) {
      betweenness[id] = Math.round(betweenness[id] * normFactor * 10000) / 10000;
    }

    // Local clustering coefficient for each node
    const clustering = {};
    for (const node of nodes) {
      const neighbors = [...adj[node.id]];
      const k = neighbors.length;
      if (k < 2) {
        clustering[node.id] = 0;
        continue;
      }
      let triangles = 0;
      for (let i = 0; i < neighbors.length; i++) {
        for (let j = i + 1; j < neighbors.length; j++) {
          if (adj[neighbors[i]].has(neighbors[j])) {
            triangles++;
          }
        }
      }
      const possibleTriangles = (k * (k - 1)) / 2;
      clustering[node.id] = Math.round((triangles / possibleTriangles) * 10000) / 10000;
    }

    // Global clustering coefficient
    const clusterValues = Object.values(clustering);
    const globalClustering = clusterValues.length > 0
      ? Math.round((clusterValues.reduce((s, v) => s + v, 0) / clusterValues.length) * 10000) / 10000
      : 0;

    // Structural holes: nodes with high betweenness but low clustering (brokers)
    const brokers = nodes
      .map(node => ({
        id: node.id,
        name: node.name,
        betweenness: betweenness[node.id],
        clustering: clustering[node.id],
        degree: degrees[node.id].degree,
        // Constraint measure: high betweenness + low clustering = structural hole
        brokerageScore: Math.round(((betweenness[node.id] || 0) * (1 - (clustering[node.id] || 0))) * 10000) / 10000,
      }))
      .sort((a, b) => b.brokerageScore - a.brokerageScore);

    // Identify connected components
    const visited = new Set();
    const components = [];
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const component = [];
      const bfsQueue = [node.id];
      visited.add(node.id);
      while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        component.push(current);
        for (const neighbor of adj[current]) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            bfsQueue.push(neighbor);
          }
        }
      }
      components.push(component);
    }

    // Network density
    const maxEdges = (n * (n - 1)) / 2;
    const density = maxEdges > 0 ? Math.round((edges.length / maxEdges) * 10000) / 10000 : 0;

    const result = {
      analyzedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      density,
      connectedComponents: components.length,
      componentSizes: components.map(c => c.length).sort((a, b) => b - a),
      globalClusteringCoefficient: globalClustering,
      degrees,
      betweennessCentrality: betweenness,
      localClustering: clustering,
      brokers: brokers.slice(0, 10),
      topByDegree: [...nodes].sort((a, b) => degrees[b.id].degree - degrees[a.id].degree).slice(0, 5).map(n => ({ id: n.id, name: n.name, degree: degrees[n.id].degree })),
      topByBetweenness: [...nodes].sort((a, b) => betweenness[b.id] - betweenness[a.id]).slice(0, 5).map(n => ({ id: n.id, name: n.name, betweenness: betweenness[n.id] })),
    };

    artifact.data.networkAnalysis = result;
    return { ok: true, result };
  });

  /**
   * riskAssessment
   * Evaluate alliance risks — dependency concentration, single points of failure,
   * diversification index.
   * artifact.data.alliances: [{ partnerId, partnerName, dependencyPct, categories: [string], revenue?, critical? }]
   * params.concentrationThreshold — pct threshold for concentration risk (default 30)
   */
  registerLensAction("alliance", "riskAssessment", (ctx, artifact, params) => {
    const alliances = artifact.data.alliances || [];
    if (alliances.length === 0) {
      return { ok: true, result: { message: "No alliances provided for risk assessment." } };
    }

    const concentrationThreshold = params.concentrationThreshold || 30;

    // Dependency concentration: partners with outsized dependency share
    const totalDependency = alliances.reduce((s, a) => s + (parseFloat(a.dependencyPct) || 0), 0);
    const concentrationRisks = alliances
      .map(a => {
        const dep = parseFloat(a.dependencyPct) || 0;
        const normalized = totalDependency > 0 ? (dep / totalDependency) * 100 : 0;
        return {
          partnerId: a.partnerId,
          partnerName: a.partnerName,
          dependencyPct: dep,
          normalizedPct: Math.round(normalized * 100) / 100,
          isConcentrated: dep >= concentrationThreshold,
        };
      })
      .sort((a, b) => b.dependencyPct - a.dependencyPct);

    // Herfindahl-Hirschman Index (HHI) for dependency concentration
    // HHI = sum of squared market shares; 10000 = monopoly, <1500 = diversified
    const hhi = alliances.reduce((sum, a) => {
      const share = totalDependency > 0
        ? ((parseFloat(a.dependencyPct) || 0) / totalDependency) * 100
        : 0;
      return sum + share * share;
    }, 0);
    const hhiRounded = Math.round(hhi);
    const hhiClassification = hhiRounded < 1500 ? "well-diversified"
      : hhiRounded < 2500 ? "moderately-concentrated"
      : "highly-concentrated";

    // Single points of failure: critical partners with no category overlap from others
    const categoryProviders = {};
    for (const alliance of alliances) {
      for (const cat of (alliance.categories || [])) {
        if (!categoryProviders[cat]) categoryProviders[cat] = [];
        categoryProviders[cat].push(alliance.partnerId);
      }
    }

    const singlePointsOfFailure = [];
    for (const [category, providers] of Object.entries(categoryProviders)) {
      if (providers.length === 1) {
        const partner = alliances.find(a => a.partnerId === providers[0]);
        singlePointsOfFailure.push({
          category,
          partnerId: providers[0],
          partnerName: partner ? partner.partnerName : providers[0],
          isCritical: partner ? !!partner.critical : false,
        });
      }
    }

    // Diversification index: 1 - (HHI / 10000)
    const diversificationIndex = Math.round((1 - hhi / 10000) * 10000) / 10000;

    // Category coverage analysis
    const allCategories = new Set();
    for (const a of alliances) {
      for (const cat of (a.categories || [])) allCategories.add(cat);
    }
    const categoryRedundancy = {};
    for (const cat of allCategories) {
      categoryRedundancy[cat] = {
        providerCount: categoryProviders[cat].length,
        providers: categoryProviders[cat],
        redundancy: categoryProviders[cat].length > 1 ? "redundant" : "single-source",
      };
    }

    // Revenue concentration risk
    const totalRevenue = alliances.reduce((s, a) => s + (parseFloat(a.revenue) || 0), 0);
    const revenueConcentration = alliances
      .filter(a => a.revenue)
      .map(a => ({
        partnerId: a.partnerId,
        partnerName: a.partnerName,
        revenue: parseFloat(a.revenue) || 0,
        revenuePct: totalRevenue > 0 ? Math.round(((parseFloat(a.revenue) || 0) / totalRevenue) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Overall risk score: 0-100, higher is riskier
    let riskScore = 0;
    // HHI contribution (0-40 points)
    riskScore += Math.min(40, (hhiRounded / 10000) * 40);
    // Single points of failure (0-30 points)
    const criticalSPOF = singlePointsOfFailure.filter(s => s.isCritical).length;
    riskScore += Math.min(30, criticalSPOF * 15 + (singlePointsOfFailure.length - criticalSPOF) * 5);
    // Concentration risk (0-30 points)
    const concentratedCount = concentrationRisks.filter(c => c.isConcentrated).length;
    riskScore += Math.min(30, concentratedCount * 10);
    riskScore = Math.round(Math.min(100, riskScore) * 100) / 100;

    const riskLevel = riskScore >= 70 ? "critical"
      : riskScore >= 45 ? "high"
      : riskScore >= 25 ? "moderate"
      : "low";

    const result = {
      analyzedAt: new Date().toISOString(),
      allianceCount: alliances.length,
      overallRiskScore: riskScore,
      riskLevel,
      hhi: hhiRounded,
      hhiClassification,
      diversificationIndex,
      concentrationRisks,
      singlePointsOfFailure,
      categoryRedundancy,
      revenueConcentration,
      summary: {
        concentratedPartners: concentratedCount,
        singleSourceCategories: singlePointsOfFailure.length,
        criticalSPOF: criticalSPOF,
        totalCategories: allCategories.size,
      },
    };

    artifact.data.riskAssessment = result;
    return { ok: true, result };
  });

  // ═══════════════════════════════════════════════════════════════
  //  Cross-org collaboration primitives — Slack Connect / Discord
  //  parity: threaded channels, real-time messaging, member invites
  //  + roles, shared proposal docs, quorum voting, reactions,
  //  attachments, notifications / unread badges.
  //
  //  Persistent per-user state lives in globalThis._concordSTATE.
  //  Every handler is try/catch wrapped and returns { ok, result?, error? }.
  // ═══════════════════════════════════════════════════════════════

  function getAllianceState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.allianceLens) {
      STATE.allianceLens = {
        alliances: new Map(), // allianceId -> Alliance
        channels: new Map(),  // allianceId -> Array<Channel>
        messages: new Map(),  // channelId -> Array<Message>
        invites: new Map(),   // allianceId -> Array<Invite>
        proposals: new Map(), // allianceId -> Array<Proposal>
        reads: new Map(),     // `${userId}:${channelId}` -> lastReadAt iso
        seq: 1,
      };
    }
    return STATE.allianceLens;
  }
  function saveAlliance() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* noop */ }
    }
  }
  function aid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function nowIso() { return new Date().toISOString(); }
  function listFor(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  }
  function emitRealtime(event, payload) {
    try {
      const fn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof fn === "function") fn(event, payload);
    } catch (_e) { /* realtime is best-effort */ }
  }

  // Role → permission matrix. owner > admin > member > guest.
  const ROLE_PERMS = {
    owner:  { invite: true, removeMember: true, manageChannels: true, post: true, createProposal: true, vote: true, closeProposal: true },
    admin:  { invite: true, removeMember: true, manageChannels: true, post: true, createProposal: true, vote: true, closeProposal: true },
    member: { invite: false, removeMember: false, manageChannels: false, post: true, createProposal: true, vote: true, closeProposal: false },
    guest:  { invite: false, removeMember: false, manageChannels: false, post: true, createProposal: false, vote: false, closeProposal: false },
  };
  function roleOf(alliance, userId) {
    const m = (alliance.members || []).find((x) => x.userId === userId);
    return m ? m.role : null;
  }
  function can(alliance, userId, perm) {
    const role = roleOf(alliance, userId);
    if (!role) return false;
    return !!(ROLE_PERMS[role] && ROLE_PERMS[role][perm]);
  }

  // ── Alliances (collaboration objects, distinct from analytics artifacts) ──

  registerLensAction("alliance", "alliance-create", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const validTypes = ["research", "security", "development", "governance"];
      const type = validTypes.includes(params.type) ? params.type : "research";
      const allianceId = uid("alc");
      const alliance = {
        id: allianceId,
        name,
        description: String(params.description || "").trim(),
        type,
        status: "forming",
        createdBy: userId,
        createdAt: nowIso(),
        members: [{ userId, displayName: params.displayName || userId, role: "owner", joinedAt: nowIso() }],
      };
      s.alliances.set(allianceId, alliance);
      // Every alliance is born with a #general channel.
      const general = {
        id: uid("chn"),
        allianceId,
        name: "general",
        topic: "Alliance-wide discussion",
        createdBy: userId,
        createdAt: nowIso(),
      };
      listFor(s.channels, allianceId).push(general);
      saveAlliance();
      emitRealtime("alliance:created", { allianceId, name });
      return { ok: true, result: { alliance, defaultChannel: general } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "alliance-list", (ctx, _a, _params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const mine = [];
      for (const alliance of s.alliances.values()) {
        if ((alliance.members || []).some((m) => m.userId === userId)) {
          const channels = listFor(s.channels, alliance.id);
          const proposals = listFor(s.proposals, alliance.id);
          mine.push({
            ...alliance,
            myRole: roleOf(alliance, userId),
            channelCount: channels.length,
            activeProposals: proposals.filter((p) => p.status === "open").length,
          });
        }
      }
      mine.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      return { ok: true, result: { alliances: mine, count: mine.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Threaded channels ──────────────────────────────────────────

  registerLensAction("alliance", "channel-create", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!can(alliance, userId, "manageChannels")) return { ok: false, error: "forbidden: requires admin role" };
      const name = String(params.name || "").trim().toLowerCase().replace(/\s+/g, "-");
      if (!name) return { ok: false, error: "channel name required" };
      const list = listFor(s.channels, alliance.id);
      if (list.some((c) => c.name === name)) return { ok: false, error: "channel name taken" };
      const channel = {
        id: uid("chn"),
        allianceId: alliance.id,
        name,
        topic: String(params.topic || "").trim(),
        createdBy: userId,
        createdAt: nowIso(),
      };
      list.push(channel);
      saveAlliance();
      emitRealtime("alliance:channel-created", { allianceId: alliance.id, channel });
      return { ok: true, result: { channel } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "channel-list", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!roleOf(alliance, userId)) return { ok: false, error: "forbidden: not a member" };
      const channels = listFor(s.channels, alliance.id).map((c) => {
        const msgs = listFor(s.messages, c.id);
        const lastRead = s.reads.get(`${userId}:${c.id}`) || "";
        const unread = msgs.filter((m) => m.createdAt > lastRead && m.userId !== userId).length;
        return {
          ...c,
          messageCount: msgs.length,
          unread,
          lastMessageAt: msgs.length ? msgs[msgs.length - 1].createdAt : null,
        };
      });
      return { ok: true, result: { channels, count: channels.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Messages — threaded, with attachments + reactions ──────────

  registerLensAction("alliance", "message-send", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const channelId = String(params.channelId || "");
      let parentAlliance = null;
      let channel = null;
      for (const [allianceId, list] of s.channels.entries()) {
        const found = list.find((c) => c.id === channelId);
        if (found) { channel = found; parentAlliance = s.alliances.get(allianceId); break; }
      }
      if (!channel || !parentAlliance) return { ok: false, error: "channel not found" };
      if (!can(parentAlliance, userId, "post")) return { ok: false, error: "forbidden: not a member" };
      const content = String(params.content || "").trim();
      if (!content) return { ok: false, error: "message content required" };
      const parentId = params.parentId ? String(params.parentId) : null;
      const msgs = listFor(s.messages, channelId);
      if (parentId && !msgs.some((m) => m.id === parentId)) {
        return { ok: false, error: "parent message not found" };
      }
      const attachments = Array.isArray(params.attachments)
        ? params.attachments
            .filter((x) => x && x.name)
            .map((x) => ({ name: String(x.name), url: String(x.url || ""), mime: String(x.mime || "application/octet-stream"), sizeBytes: Number(x.sizeBytes) || 0 }))
        : [];
      const message = {
        id: uid("msg"),
        channelId,
        allianceId: parentAlliance.id,
        userId,
        displayName: roleOf(parentAlliance, userId) ? ((parentAlliance.members.find((m) => m.userId === userId) || {}).displayName || userId) : userId,
        content,
        parentId,
        attachments,
        reactions: {}, // emoji -> [userId]
        createdAt: nowIso(),
      };
      msgs.push(message);
      s.reads.set(`${userId}:${channelId}`, message.createdAt);
      saveAlliance();
      emitRealtime("alliance:message", { allianceId: parentAlliance.id, channelId, message });
      return { ok: true, result: { message } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "message-list", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const channelId = String(params.channelId || "");
      let parentAlliance = null;
      for (const [allianceId, list] of s.channels.entries()) {
        if (list.some((c) => c.id === channelId)) { parentAlliance = s.alliances.get(allianceId); break; }
      }
      if (!parentAlliance) return { ok: false, error: "channel not found" };
      if (!roleOf(parentAlliance, userId)) return { ok: false, error: "forbidden: not a member" };
      const all = listFor(s.messages, channelId);
      const roots = all.filter((m) => !m.parentId);
      const threaded = roots.map((root) => ({
        ...root,
        replies: all.filter((m) => m.parentId === root.id).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1)),
      })).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
      // Mark this channel read for the caller.
      s.reads.set(`${userId}:${channelId}`, nowIso());
      saveAlliance();
      return { ok: true, result: { messages: threaded, total: all.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "message-react", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const channelId = String(params.channelId || "");
      const messageId = String(params.messageId || "");
      const emoji = String(params.emoji || "").trim();
      if (!emoji) return { ok: false, error: "emoji required" };
      let parentAlliance = null;
      for (const [allianceId, list] of s.channels.entries()) {
        if (list.some((c) => c.id === channelId)) { parentAlliance = s.alliances.get(allianceId); break; }
      }
      if (!parentAlliance) return { ok: false, error: "channel not found" };
      if (!can(parentAlliance, userId, "post")) return { ok: false, error: "forbidden: not a member" };
      const msg = listFor(s.messages, channelId).find((m) => m.id === messageId);
      if (!msg) return { ok: false, error: "message not found" };
      if (!msg.reactions) msg.reactions = {};
      const list = msg.reactions[emoji] || [];
      const idx = list.indexOf(userId);
      if (idx >= 0) list.splice(idx, 1); // toggle off
      else list.push(userId);
      if (list.length) msg.reactions[emoji] = list;
      else delete msg.reactions[emoji];
      saveAlliance();
      emitRealtime("alliance:reaction", { allianceId: parentAlliance.id, channelId, messageId, reactions: msg.reactions });
      return { ok: true, result: { messageId, reactions: msg.reactions } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Member invites + roles ─────────────────────────────────────

  registerLensAction("alliance", "invite-create", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!can(alliance, userId, "invite")) return { ok: false, error: "forbidden: requires admin role" };
      const inviteeId = String(params.inviteeId || "").trim();
      if (!inviteeId) return { ok: false, error: "inviteeId required" };
      if ((alliance.members || []).some((m) => m.userId === inviteeId)) {
        return { ok: false, error: "already a member" };
      }
      const validRoles = ["admin", "member", "guest"];
      const role = validRoles.includes(params.role) ? params.role : "member";
      const list = listFor(s.invites, alliance.id);
      const existing = list.find((i) => i.inviteeId === inviteeId && i.status === "pending");
      if (existing) return { ok: false, error: "invite already pending" };
      const invite = {
        id: uid("inv"),
        allianceId: alliance.id,
        allianceName: alliance.name,
        inviteeId,
        role,
        invitedBy: userId,
        status: "pending",
        createdAt: nowIso(),
      };
      list.push(invite);
      saveAlliance();
      emitRealtime("alliance:invite", { allianceId: alliance.id, inviteeId, invite });
      return { ok: true, result: { invite } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "invite-list", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      if (params.allianceId) {
        const alliance = s.alliances.get(String(params.allianceId));
        if (!alliance) return { ok: false, error: "alliance not found" };
        if (!roleOf(alliance, userId)) return { ok: false, error: "forbidden: not a member" };
        return { ok: true, result: { invites: listFor(s.invites, alliance.id), scope: "alliance" } };
      }
      // Default: invites addressed TO the caller (join-request inbox).
      const inbox = [];
      for (const list of s.invites.values()) {
        for (const inv of list) {
          if (inv.inviteeId === userId && inv.status === "pending") inbox.push(inv);
        }
      }
      return { ok: true, result: { invites: inbox, scope: "inbox" } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "invite-respond", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const inviteId = String(params.inviteId || "");
      const accept = params.accept === true || params.accept === "true";
      let invite = null;
      for (const list of s.invites.values()) {
        const found = list.find((i) => i.id === inviteId);
        if (found) { invite = found; break; }
      }
      if (!invite) return { ok: false, error: "invite not found" };
      if (invite.inviteeId !== userId) return { ok: false, error: "forbidden: not your invite" };
      if (invite.status !== "pending") return { ok: false, error: "invite already resolved" };
      invite.status = accept ? "accepted" : "declined";
      invite.respondedAt = nowIso();
      const alliance = s.alliances.get(invite.allianceId);
      if (accept && alliance && !(alliance.members || []).some((m) => m.userId === userId)) {
        alliance.members.push({ userId, displayName: params.displayName || userId, role: invite.role, joinedAt: nowIso() });
        if (alliance.status === "forming" && alliance.members.length >= 2) alliance.status = "active";
      }
      saveAlliance();
      emitRealtime("alliance:invite-resolved", { allianceId: invite.allianceId, inviteId, status: invite.status });
      return { ok: true, result: { invite, joined: accept } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "member-set-role", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (roleOf(alliance, userId) !== "owner") return { ok: false, error: "forbidden: requires owner role" };
      const targetId = String(params.memberId || "");
      const validRoles = ["admin", "member", "guest"];
      const role = params.role;
      if (!validRoles.includes(role)) return { ok: false, error: "invalid role" };
      const member = (alliance.members || []).find((m) => m.userId === targetId);
      if (!member) return { ok: false, error: "member not found" };
      if (member.role === "owner") return { ok: false, error: "cannot change owner role" };
      member.role = role;
      saveAlliance();
      return { ok: true, result: { member } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "member-remove", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!can(alliance, userId, "removeMember")) return { ok: false, error: "forbidden: requires admin role" };
      const targetId = String(params.memberId || "");
      const member = (alliance.members || []).find((m) => m.userId === targetId);
      if (!member) return { ok: false, error: "member not found" };
      if (member.role === "owner") return { ok: false, error: "cannot remove owner" };
      alliance.members = alliance.members.filter((m) => m.userId !== targetId);
      saveAlliance();
      emitRealtime("alliance:member-removed", { allianceId: alliance.id, memberId: targetId });
      return { ok: true, result: { removed: targetId, memberCount: alliance.members.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Shared proposal workspace + quorum voting ──────────────────

  registerLensAction("alliance", "proposal-create", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!can(alliance, userId, "createProposal")) return { ok: false, error: "forbidden: members only" };
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      const eligible = (alliance.members || []).filter((m) => ROLE_PERMS[m.role] && ROLE_PERMS[m.role].vote).length;
      // Quorum: default simple majority of eligible voters, clamped to [0,1].
      let quorum = typeof params.quorum === "number" ? params.quorum : 0.5;
      quorum = Math.max(0, Math.min(1, quorum));
      const proposal = {
        id: uid("prp"),
        allianceId: alliance.id,
        title,
        body: String(params.body || "").trim(),
        createdBy: userId,
        createdAt: nowIso(),
        status: "open",
        quorum,
        eligibleVoters: eligible,
        votes: {}, // userId -> 'yes' | 'no' | 'abstain'
        decision: null,
      };
      listFor(s.proposals, alliance.id).push(proposal);
      saveAlliance();
      emitRealtime("alliance:proposal-created", { allianceId: alliance.id, proposalId: proposal.id, title });
      return { ok: true, result: { proposal } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  function tallyProposal(proposal) {
    const votes = Object.values(proposal.votes || {});
    const yes = votes.filter((v) => v === "yes").length;
    const no = votes.filter((v) => v === "no").length;
    const abstain = votes.filter((v) => v === "abstain").length;
    const cast = votes.length;
    const eligible = proposal.eligibleVoters || 0;
    const participation = eligible > 0 ? cast / eligible : 0;
    const quorumMet = participation >= (proposal.quorum || 0);
    const decisive = yes + no;
    const passed = quorumMet && decisive > 0 && yes / decisive > 0.5;
    return { yes, no, abstain, cast, eligible, participation: Math.round(participation * 1000) / 1000, quorumMet, passed };
  }

  registerLensAction("alliance", "proposal-vote", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!can(alliance, userId, "vote")) return { ok: false, error: "forbidden: not eligible to vote" };
      const proposal = listFor(s.proposals, alliance.id).find((p) => p.id === String(params.proposalId || ""));
      if (!proposal) return { ok: false, error: "proposal not found" };
      if (proposal.status !== "open") return { ok: false, error: "proposal is closed" };
      const choice = params.choice;
      if (!["yes", "no", "abstain"].includes(choice)) return { ok: false, error: "choice must be yes|no|abstain" };
      proposal.votes[userId] = choice;
      const tally = tallyProposal(proposal);
      saveAlliance();
      emitRealtime("alliance:proposal-vote", { allianceId: alliance.id, proposalId: proposal.id, tally });
      return { ok: true, result: { proposalId: proposal.id, tally } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "proposal-list", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      if (!roleOf(alliance, userId)) return { ok: false, error: "forbidden: not a member" };
      const proposals = listFor(s.proposals, alliance.id).map((p) => ({
        ...p,
        tally: tallyProposal(p),
        myVote: p.votes[userId] || null,
      })).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      return { ok: true, result: { proposals, count: proposals.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "proposal-close", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const alliance = s.alliances.get(String(params.allianceId || ""));
      if (!alliance) return { ok: false, error: "alliance not found" };
      const proposal = listFor(s.proposals, alliance.id).find((p) => p.id === String(params.proposalId || ""));
      if (!proposal) return { ok: false, error: "proposal not found" };
      if (!can(alliance, userId, "closeProposal") && proposal.createdBy !== userId) {
        return { ok: false, error: "forbidden: requires admin role or proposal author" };
      }
      if (proposal.status !== "open") return { ok: false, error: "proposal already closed" };
      const tally = tallyProposal(proposal);
      proposal.status = "closed";
      proposal.closedAt = nowIso();
      proposal.decision = !tally.quorumMet ? "failed-quorum" : tally.passed ? "passed" : "rejected";
      proposal.finalTally = tally;
      saveAlliance();
      emitRealtime("alliance:proposal-closed", { allianceId: alliance.id, proposalId: proposal.id, decision: proposal.decision });
      return { ok: true, result: { proposal } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Notifications / unread badges ──────────────────────────────

  registerLensAction("alliance", "notifications", (ctx, _a, _params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      let totalUnread = 0;
      const perAlliance = [];
      for (const alliance of s.alliances.values()) {
        if (!roleOf(alliance, userId)) continue;
        let allianceUnread = 0;
        const channels = [];
        for (const channel of listFor(s.channels, alliance.id)) {
          const lastRead = s.reads.get(`${userId}:${channel.id}`) || "";
          const unread = listFor(s.messages, channel.id)
            .filter((m) => m.createdAt > lastRead && m.userId !== userId).length;
          allianceUnread += unread;
          if (unread > 0) channels.push({ channelId: channel.id, name: channel.name, unread });
        }
        const openProposals = listFor(s.proposals, alliance.id)
          .filter((p) => p.status === "open" && !(p.votes && p.votes[userId])).length;
        totalUnread += allianceUnread;
        if (allianceUnread > 0 || openProposals > 0) {
          perAlliance.push({ allianceId: alliance.id, name: alliance.name, unread: allianceUnread, channels, pendingVotes: openProposals });
        }
      }
      const pendingInvites = [];
      for (const list of s.invites.values()) {
        for (const inv of list) {
          if (inv.inviteeId === userId && inv.status === "pending") pendingInvites.push(inv);
        }
      }
      return {
        ok: true,
        result: {
          totalUnread,
          pendingInvites: pendingInvites.length,
          perAlliance,
          invites: pendingInvites,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("alliance", "mark-read", (ctx, _a, params = {}) => {
    try {
      const s = getAllianceState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aid(ctx);
      const channelId = String(params.channelId || "");
      if (!channelId) return { ok: false, error: "channelId required" };
      s.reads.set(`${userId}:${channelId}`, nowIso());
      saveAlliance();
      return { ok: true, result: { channelId, readAt: s.reads.get(`${userId}:${channelId}`) } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
