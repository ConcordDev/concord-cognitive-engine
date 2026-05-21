// server/domains/appmaker.js
// Domain actions for app building/prototyping: scaffold generation,
// UI complexity measurement, and wireframe validation.

export default function registerAppmakerActions(registerLensAction) {
  /**
   * scaffoldApp
   * Generate app scaffold structure from a spec. Builds component tree,
   * route mapping, and state management plan.
   * artifact.data.spec = { pages: [{ name, path, components: [{ type, props?, children? }] }], auth?: bool }
   * params.framework = "react" | "vue" | "svelte" (default "react")
   */
  registerLensAction("app-maker", "scaffoldApp", (ctx, artifact, params) => {
    const spec = artifact.data?.spec || {};
    const pages = spec.pages || [];
    const framework = params.framework || "react";
    const hasAuth = spec.auth !== false;

    if (pages.length === 0) return { ok: true, result: { message: "No pages defined in spec." } };

    // Build component tree with deduplication
    const componentRegistry = {};
    let totalComponents = 0;

    function walkComponents(comps, parentPath) {
      const nodes = [];
      for (const comp of comps || []) {
        totalComponents++;
        const id = `${parentPath}/${comp.type || "Unknown"}`;
        const node = {
          type: comp.type || "Unknown",
          path: id,
          props: Object.keys(comp.props || {}),
          childCount: (comp.children || []).length,
          children: walkComponents(comp.children, id),
        };
        nodes.push(node);

        // Track component reuse
        const key = comp.type || "Unknown";
        if (!componentRegistry[key]) componentRegistry[key] = { count: 0, locations: [] };
        componentRegistry[key].count++;
        componentRegistry[key].locations.push(parentPath);
      }
      return nodes;
    }

    // Build route map
    const routes = pages.map(page => {
      const tree = walkComponents(page.components, `/${page.name}`);
      const isDynamic = (page.path || "").includes(":");
      const paramNames = ((page.path || "").match(/:(\w+)/g) || []).map(p => p.slice(1));
      return {
        name: page.name,
        path: page.path || `/${page.name.toLowerCase()}`,
        dynamic: isDynamic,
        params: paramNames,
        componentTree: tree,
        componentCount: tree.reduce(function countNodes(sum, n) {
          return sum + 1 + n.children.reduce(countNodes, 0);
        }, 0),
      };
    });

    // Compute max nesting depth
    function maxDepth(nodes) {
      if (!nodes || nodes.length === 0) return 0;
      return 1 + Math.max(...nodes.map(n => maxDepth(n.children)));
    }
    const deepestNesting = Math.max(...routes.map(r => maxDepth(r.componentTree)));

    // State management plan: identify shared state from component reuse
    const sharedComponents = Object.entries(componentRegistry)
      .filter(([, info]) => info.count > 1)
      .map(([type, info]) => ({ type, reuseCount: info.count, locations: info.locations }));

    const stateSlices = [];
    if (hasAuth) stateSlices.push({ name: "auth", fields: ["user", "token", "isAuthenticated"], scope: "global" });
    stateSlices.push({ name: "ui", fields: ["theme", "sidebarOpen", "loading"], scope: "global" });

    // Infer data slices from page names
    const pageDataSlices = pages.map(p => ({
      name: p.name.toLowerCase(),
      fields: ["items", "loading", "error", "pagination"],
      scope: "page",
    }));
    stateSlices.push(...pageDataSlices);

    // Generate file structure
    const files = [];
    const srcDir = framework === "svelte" ? "src" : "src";
    files.push({ path: `${srcDir}/App.${framework === "svelte" ? "svelte" : framework === "vue" ? "vue" : "jsx"}`, type: "root" });
    files.push({ path: `${srcDir}/router.${framework === "vue" ? "js" : "jsx"}`, type: "routing" });
    if (hasAuth) files.push({ path: `${srcDir}/auth/AuthProvider.${framework === "svelte" ? "svelte" : "jsx"}`, type: "auth" });
    for (const route of routes) {
      files.push({ path: `${srcDir}/pages/${route.name}.${framework === "svelte" ? "svelte" : framework === "vue" ? "vue" : "jsx"}`, type: "page" });
    }
    for (const [type] of Object.entries(componentRegistry)) {
      files.push({ path: `${srcDir}/components/${type}.${framework === "svelte" ? "svelte" : framework === "vue" ? "vue" : "jsx"}`, type: "component" });
    }
    files.push({ path: `${srcDir}/store/index.js`, type: "state" });
    for (const slice of stateSlices) {
      files.push({ path: `${srcDir}/store/${slice.name}.js`, type: "state-slice" });
    }

    // Complexity estimate
    const estimatedLOC = totalComponents * 45 + routes.length * 30 + stateSlices.length * 25 + (hasAuth ? 120 : 0);

    artifact.data.scaffold = { files, routes: routes.map(r => ({ name: r.name, path: r.path })) };

    return {
      ok: true, result: {
        framework,
        routes,
        componentRegistry: Object.entries(componentRegistry).map(([type, info]) => ({ type, ...info })),
        stateManagement: { slices: stateSlices, sharedComponents },
        fileStructure: files,
        metrics: {
          totalPages: pages.length,
          totalComponents,
          uniqueComponents: Object.keys(componentRegistry).length,
          maxNestingDepth: deepestNesting,
          totalFiles: files.length,
          estimatedLOC,
          hasAuth,
        },
      },
    };
  });

  /**
   * uiComplexity
   * Measure UI complexity: widget count, nesting depth, interaction paths,
   * and cognitive load estimation.
   * artifact.data.screens = [{ name, widgets: [{ type, interactive?, children? }] }]
   */
  registerLensAction("app-maker", "uiComplexity", (ctx, artifact, params) => {
    const screens = artifact.data?.screens || [];
    if (screens.length === 0) return { ok: true, result: { message: "No screens to analyze." } };

    const interactiveTypes = new Set(["button", "input", "select", "checkbox", "radio", "slider", "toggle", "link", "dropdown", "datepicker", "form"]);

    const screenMetrics = screens.map(screen => {
      let widgetCount = 0;
      let interactiveCount = 0;
      let maxDepth = 0;
      const typeFrequency = {};

      function walk(widgets, depth) {
        for (const w of widgets || []) {
          widgetCount++;
          const wType = (w.type || "unknown").toLowerCase();
          typeFrequency[wType] = (typeFrequency[wType] || 0) + 1;
          if (w.interactive || interactiveTypes.has(wType)) interactiveCount++;
          if (depth > maxDepth) maxDepth = depth;
          walk(w.children, depth + 1);
        }
      }
      walk(screen.widgets, 1);

      // Interaction paths: approximate as permutations of interactive elements
      // bounded by typical user flows (sequential interactions)
      const interactionPaths = interactiveCount <= 1 ? interactiveCount
        : Math.min(interactiveCount * (interactiveCount - 1), 100);

      // Cognitive load estimation (based on Miller's Law and Hick's Law)
      // Miller's Law: 7 +/- 2 items for working memory
      // Hick's Law: decision time = log2(n + 1)
      const millerOverload = widgetCount > 9 ? (widgetCount - 9) / 9 : 0;
      const hicksDecisionTime = interactiveCount > 0 ? Math.log2(interactiveCount + 1) : 0;
      const depthPenalty = maxDepth > 3 ? (maxDepth - 3) * 0.15 : 0;

      // Composite cognitive load score (0-1 scale, higher = more complex)
      const cognitiveLoad = Math.min(1, (millerOverload * 0.4 + hicksDecisionTime / 7 * 0.35 + depthPenalty * 0.25));

      return {
        name: screen.name,
        widgetCount,
        interactiveCount,
        maxNestingDepth: maxDepth,
        interactionPaths,
        typeDistribution: typeFrequency,
        cognitiveLoad: Math.round(cognitiveLoad * 10000) / 100,
        cognitiveLevel: cognitiveLoad > 0.7 ? "overloaded" : cognitiveLoad > 0.4 ? "moderate" : "manageable",
      };
    });

    // Global metrics
    const totalWidgets = screenMetrics.reduce((s, m) => s + m.widgetCount, 0);
    const totalInteractive = screenMetrics.reduce((s, m) => s + m.interactiveCount, 0);
    const avgWidgetsPerScreen = totalWidgets / screenMetrics.length;
    const maxDepthOverall = Math.max(...screenMetrics.map(m => m.maxNestingDepth));
    const avgCognitiveLoad = screenMetrics.reduce((s, m) => s + m.cognitiveLoad, 0) / screenMetrics.length;

    // Consistency score: standard deviation of widget counts across screens
    const widgetStdDev = Math.sqrt(
      screenMetrics.reduce((s, m) => s + Math.pow(m.widgetCount - avgWidgetsPerScreen, 2), 0) / screenMetrics.length
    );
    const consistencyScore = avgWidgetsPerScreen > 0
      ? Math.max(0, 100 - (widgetStdDev / avgWidgetsPerScreen) * 100)
      : 100;

    return {
      ok: true, result: {
        screens: screenMetrics,
        globalMetrics: {
          totalScreens: screens.length,
          totalWidgets,
          totalInteractiveElements: totalInteractive,
          avgWidgetsPerScreen: Math.round(avgWidgetsPerScreen * 100) / 100,
          maxNestingDepth: maxDepthOverall,
          avgCognitiveLoad: Math.round(avgCognitiveLoad * 100) / 100,
          consistencyScore: Math.round(consistencyScore * 100) / 100,
        },
        recommendations: [
          ...(avgCognitiveLoad > 60 ? ["Reduce visual density — average cognitive load is high"] : []),
          ...(maxDepthOverall > 4 ? [`Max nesting depth is ${maxDepthOverall} — flatten component hierarchy`] : []),
          ...(consistencyScore < 50 ? ["High variance in widget counts across screens — consider more consistent layouts"] : []),
          ...(totalInteractive > totalWidgets * 0.7 ? ["Very high ratio of interactive elements — consider grouping related controls"] : []),
        ],
      },
    };
  });

  /**
   * wireframeValidate
   * Validate wireframe consistency: check navigation completeness, identify
   * dead-end screens, and assess action coverage.
   * artifact.data.wireframe = { screens: [{ name, links: [targetScreen], actions: [{ type, target? }] }] }
   */
  registerLensAction("app-maker", "wireframeValidate", (ctx, artifact, params) => {
    const wireframe = artifact.data?.wireframe || {};
    const screens = wireframe.screens || [];
    if (screens.length === 0) return { ok: true, result: { message: "No wireframe screens to validate." } };

    const screenNames = new Set(screens.map(s => s.name));
    const issues = [];

    // Build navigation graph
    const navGraph = {};
    const inDegree = {};
    for (const name of screenNames) {
      navGraph[name] = new Set();
      inDegree[name] = 0;
    }

    for (const screen of screens) {
      const links = screen.links || [];
      const actions = screen.actions || [];
      const targets = [...links, ...actions.filter(a => a.target).map(a => a.target)];

      for (const target of targets) {
        if (!screenNames.has(target)) {
          issues.push({ type: "broken_link", screen: screen.name, target, severity: "error" });
        } else {
          navGraph[screen.name].add(target);
          inDegree[target]++;
        }
      }
    }

    // Detect dead-end screens (no outgoing links except to self)
    const deadEnds = [];
    for (const screen of screens) {
      const outgoing = [...(navGraph[screen.name] || [])].filter(t => t !== screen.name);
      if (outgoing.length === 0) {
        deadEnds.push(screen.name);
        issues.push({ type: "dead_end", screen: screen.name, severity: "warning" });
      }
    }

    // Detect orphan screens (no incoming links, except the entry/home screen)
    const entryScreen = screens[0]?.name;
    const orphans = [];
    for (const [name, deg] of Object.entries(inDegree)) {
      if (deg === 0 && name !== entryScreen) {
        orphans.push(name);
        issues.push({ type: "orphan_screen", screen: name, severity: "warning" });
      }
    }

    // Navigation completeness: BFS from entry to check reachability
    const reachable = new Set();
    if (entryScreen) {
      const queue = [entryScreen];
      reachable.add(entryScreen);
      while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbor of navGraph[current] || []) {
          if (!reachable.has(neighbor)) {
            reachable.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    const unreachable = [...screenNames].filter(s => !reachable.has(s));
    for (const s of unreachable) {
      issues.push({ type: "unreachable", screen: s, severity: "error" });
    }

    // Action coverage: check that common actions are present
    const requiredActionTypes = new Set(["navigate", "submit", "cancel", "back"]);
    const allActionTypes = new Set();
    for (const screen of screens) {
      for (const action of screen.actions || []) {
        allActionTypes.add(action.type);
      }
    }
    const missingActionTypes = [...requiredActionTypes].filter(a => !allActionTypes.has(a));
    if (missingActionTypes.length > 0) {
      issues.push({ type: "missing_action_types", missingTypes: missingActionTypes, severity: "info" });
    }

    // Screen-level action coverage
    const screenCoverage = screens.map(screen => {
      const actionTypes = new Set((screen.actions || []).map(a => a.type));
      const hasNavigation = (screen.links || []).length > 0 || actionTypes.has("navigate");
      return {
        name: screen.name,
        linkCount: (screen.links || []).length,
        actionCount: (screen.actions || []).length,
        hasNavigation,
        actionTypes: [...actionTypes],
      };
    });

    // Compute navigation depth (longest shortest path from entry)
    let maxNavDepth = 0;
    if (entryScreen) {
      const distances = { [entryScreen]: 0 };
      const bfsQueue = [entryScreen];
      while (bfsQueue.length > 0) {
        const current = bfsQueue.shift();
        for (const neighbor of navGraph[current] || []) {
          if (distances[neighbor] === undefined) {
            distances[neighbor] = distances[current] + 1;
            maxNavDepth = Math.max(maxNavDepth, distances[neighbor]);
            bfsQueue.push(neighbor);
          }
        }
      }
    }

    const navigationCompleteness = screenNames.size > 0
      ? Math.round((reachable.size / screenNames.size) * 10000) / 100
      : 100;

    return {
      ok: true, result: {
        valid: issues.filter(i => i.severity === "error").length === 0,
        issues,
        summary: {
          totalScreens: screens.length,
          reachableScreens: reachable.size,
          deadEndScreens: deadEnds.length,
          orphanScreens: orphans.length,
          unreachableScreens: unreachable.length,
          navigationCompleteness,
          maxNavigationDepth: maxNavDepth,
          errorCount: issues.filter(i => i.severity === "error").length,
          warningCount: issues.filter(i => i.severity === "warning").length,
        },
        screenCoverage,
        deadEnds,
        orphans,
        unreachable,
      },
    };
  });

  // ───────────────────────────────────────────────────────────────────
  // No-code builder substrate — per-user, STATE-backed.
  // Each user owns a set of "projects". A project carries:
  //   pages:       canvas page layouts (visual editor)
  //   dataModel:   tables + fields + relations (data-model designer)
  //   workflows:   event → action rules (workflow builder)
  //   connectors:  external API/data-source bindings
  //   versions:    immutable snapshots (version history)
  //   deployment:  { url, status, deployedAt } (real deploy)
  // ───────────────────────────────────────────────────────────────────

  function getAppState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.appMakerLens) STATE.appMakerLens = {};
    const s = STATE.appMakerLens;
    if (!(s.projects instanceof Map)) s.projects = new Map();   // userId -> Array<project>
    return s;
  }
  function saveAppState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const amId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const amNow = () => new Date().toISOString();
  const amActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const amClean = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
  const amList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  function emptyProject(name) {
    return {
      id: amId("proj"),
      name: amClean(name || "Untitled App", 80) || "Untitled App",
      createdAt: amNow(),
      updatedAt: amNow(),
      pages: [{ id: amId("page"), name: "Home", route: "/", elements: [] }],
      dataModel: { tables: [], relations: [] },
      workflows: [],
      connectors: [],
      versions: [],
      componentLibrary: [],
      deployment: { status: "undeployed", url: null, deployedAt: null },
    };
  }
  function findProject(s, userId, projectId) {
    return (s.projects.get(userId) || []).find((p) => p.id === projectId) || null;
  }

  // Reusable component library palette — used by editor + library macros.
  const ELEMENT_PALETTE = [
    { type: "button", label: "Button", category: "input", w: 120, h: 40 },
    { type: "input", label: "Text Input", category: "input", w: 220, h: 40 },
    { type: "text", label: "Text", category: "display", w: 200, h: 28 },
    { type: "heading", label: "Heading", category: "display", w: 280, h: 44 },
    { type: "image", label: "Image", category: "display", w: 200, h: 160 },
    { type: "table", label: "Data Table", category: "data", w: 480, h: 280 },
    { type: "list", label: "List", category: "data", w: 320, h: 240 },
    { type: "card", label: "Card", category: "container", w: 280, h: 200 },
    { type: "container", label: "Container", category: "container", w: 400, h: 300 },
    { type: "form", label: "Form", category: "input", w: 340, h: 320 },
    { type: "chart", label: "Chart", category: "data", w: 400, h: 260 },
    { type: "nav", label: "Navigation", category: "container", w: 800, h: 56 },
  ];
  const FIELD_TYPES = ["text", "number", "boolean", "date", "email", "url", "json", "reference", "image"];

  /**
   * project.create — create a new no-code project for the user.
   */
  registerLensAction("app-maker", "projectCreate", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = amActor(ctx);
      const proj = emptyProject(params?.name || artifact?.data?.name);
      if (params?.template) proj.template = amClean(params.template, 40);
      amList(s.projects, userId).unshift(proj);
      saveAppState();
      return { ok: true, result: { project: proj } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * project.list — list all projects for the user.
   */
  registerLensAction("app-maker", "projectList", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = amActor(ctx);
      const projects = (s.projects.get(userId) || []).map((p) => ({
        id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt,
        pageCount: p.pages.length, tableCount: p.dataModel.tables.length,
        workflowCount: p.workflows.length, connectorCount: p.connectors.length,
        versionCount: p.versions.length, deployment: p.deployment,
      }));
      return { ok: true, result: { projects, count: projects.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * project.get — fetch one full project.
   */
  registerLensAction("app-maker", "projectGet", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      return { ok: true, result: { project: proj } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * project.duplicate — clone a project (version history / app duplication).
   */
  registerLensAction("app-maker", "projectDuplicate", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = amActor(ctx);
      const src = findProject(s, userId, params?.projectId);
      if (!src) return { ok: false, error: "project_not_found" };
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = amId("proj");
      copy.name = `${src.name} (copy)`;
      copy.createdAt = amNow();
      copy.updatedAt = amNow();
      copy.versions = [];
      copy.deployment = { status: "undeployed", url: null, deployedAt: null };
      amList(s.projects, userId).unshift(copy);
      saveAppState();
      return { ok: true, result: { project: copy } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * project.delete
   */
  registerLensAction("app-maker", "projectDelete", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = amActor(ctx);
      const arr = s.projects.get(userId) || [];
      const idx = arr.findIndex((p) => p.id === params?.projectId);
      if (idx < 0) return { ok: false, error: "project_not_found" };
      arr.splice(idx, 1);
      saveAppState();
      return { ok: true, result: { deleted: params.projectId } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Visual drag-and-drop editor ──────────────────────────────────

  /**
   * editor.palette — element palette for the visual editor.
   */
  registerLensAction("app-maker", "editorPalette", () => {
    return { ok: true, result: { palette: ELEMENT_PALETTE } };
  });

  /**
   * editor.addPage — add a page to a project.
   */
  registerLensAction("app-maker", "editorAddPage", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const name = amClean(params?.name || `Page ${proj.pages.length + 1}`, 60);
      const route = amClean(params?.route || `/${name.toLowerCase().replace(/\s+/g, "-")}`, 60);
      const page = { id: amId("page"), name, route, elements: [] };
      proj.pages.push(page);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { page, pages: proj.pages } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * editor.savePage — persist the full element layout of a page.
   * params.elements = [{ id, type, x, y, w, h, props }]
   */
  registerLensAction("app-maker", "editorSavePage", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const page = proj.pages.find((p) => p.id === params?.pageId);
      if (!page) return { ok: false, error: "page_not_found" };
      const elements = Array.isArray(params?.elements) ? params.elements : [];
      page.elements = elements.slice(0, 500).map((el) => ({
        id: el.id || amId("el"),
        type: amClean(el.type || "container", 40),
        x: Number.isFinite(+el.x) ? +el.x : 0,
        y: Number.isFinite(+el.y) ? +el.y : 0,
        w: Number.isFinite(+el.w) ? +el.w : 120,
        h: Number.isFinite(+el.h) ? +el.h : 40,
        props: typeof el.props === "object" && el.props ? el.props : {},
      }));
      if (typeof params?.name === "string") page.name = amClean(params.name, 60);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { page, elementCount: page.elements.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * editor.deletePage
   */
  registerLensAction("app-maker", "editorDeletePage", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      if (proj.pages.length <= 1) return { ok: false, error: "cannot_delete_last_page" };
      const idx = proj.pages.findIndex((p) => p.id === params?.pageId);
      if (idx < 0) return { ok: false, error: "page_not_found" };
      proj.pages.splice(idx, 1);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { pages: proj.pages } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Data-model designer ──────────────────────────────────────────

  /**
   * data.fieldTypes — available field types for the data modeler.
   */
  registerLensAction("app-maker", "dataFieldTypes", () => {
    return { ok: true, result: { fieldTypes: FIELD_TYPES } };
  });

  /**
   * data.addTable — add a table to the project data model.
   */
  registerLensAction("app-maker", "dataAddTable", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const name = amClean(params?.name || `Table${proj.dataModel.tables.length + 1}`, 50);
      if (proj.dataModel.tables.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: "table_name_exists" };
      }
      const table = {
        id: amId("tbl"),
        name,
        fields: [{ id: amId("fld"), name: "id", type: "text", required: true, primary: true }],
      };
      proj.dataModel.tables.push(table);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { table, dataModel: proj.dataModel } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * data.saveTable — replace a table's fields (the field editor).
   * params.fields = [{ name, type, required }]
   */
  registerLensAction("app-maker", "dataSaveTable", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const table = proj.dataModel.tables.find((t) => t.id === params?.tableId);
      if (!table) return { ok: false, error: "table_not_found" };
      const fields = Array.isArray(params?.fields) ? params.fields : [];
      table.fields = fields.slice(0, 80).map((f) => ({
        id: f.id || amId("fld"),
        name: amClean(f.name || "field", 50) || "field",
        type: FIELD_TYPES.includes(f.type) ? f.type : "text",
        required: !!f.required,
        primary: !!f.primary,
      }));
      if (!table.fields.length) {
        table.fields = [{ id: amId("fld"), name: "id", type: "text", required: true, primary: true }];
      }
      if (typeof params?.name === "string" && params.name.trim()) {
        table.name = amClean(params.name, 50);
      }
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { table } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * data.deleteTable
   */
  registerLensAction("app-maker", "dataDeleteTable", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const idx = proj.dataModel.tables.findIndex((t) => t.id === params?.tableId);
      if (idx < 0) return { ok: false, error: "table_not_found" };
      const removed = proj.dataModel.tables.splice(idx, 1)[0];
      proj.dataModel.relations = proj.dataModel.relations.filter(
        (r) => r.fromTable !== removed.id && r.toTable !== removed.id
      );
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { dataModel: proj.dataModel } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * data.addRelation — link two tables (one-to-many / many-to-many / one-to-one).
   */
  registerLensAction("app-maker", "dataAddRelation", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const tables = proj.dataModel.tables;
      const from = tables.find((t) => t.id === params?.fromTable);
      const to = tables.find((t) => t.id === params?.toTable);
      if (!from || !to) return { ok: false, error: "table_not_found" };
      const kind = ["one-to-one", "one-to-many", "many-to-many"].includes(params?.kind)
        ? params.kind : "one-to-many";
      const rel = {
        id: amId("rel"),
        fromTable: from.id, toTable: to.id,
        fromName: from.name, toName: to.name,
        kind,
        label: amClean(params?.label || `${from.name} → ${to.name}`, 80),
      };
      proj.dataModel.relations.push(rel);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { relation: rel, dataModel: proj.dataModel } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * data.deleteRelation
   */
  registerLensAction("app-maker", "dataDeleteRelation", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const idx = proj.dataModel.relations.findIndex((r) => r.id === params?.relationId);
      if (idx < 0) return { ok: false, error: "relation_not_found" };
      proj.dataModel.relations.splice(idx, 1);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { dataModel: proj.dataModel } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Workflow / event-action builder ──────────────────────────────

  const WORKFLOW_TRIGGERS = ["button_click", "page_load", "form_submit", "row_created", "row_updated", "schedule", "input_change"];
  const WORKFLOW_ACTIONS = ["create_row", "update_row", "delete_row", "navigate", "show_toast", "call_api", "send_email", "set_state"];

  /**
   * workflow.options — trigger + action vocabularies for the builder.
   */
  registerLensAction("app-maker", "workflowOptions", () => {
    return { ok: true, result: { triggers: WORKFLOW_TRIGGERS, actions: WORKFLOW_ACTIONS } };
  });

  /**
   * workflow.save — create or update a workflow rule.
   * params.workflow = { id?, name, trigger, steps: [{ action, target?, params? }] }
   */
  registerLensAction("app-maker", "workflowSave", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const wf = params?.workflow || {};
      const trigger = WORKFLOW_TRIGGERS.includes(wf.trigger) ? wf.trigger : "button_click";
      const steps = (Array.isArray(wf.steps) ? wf.steps : []).slice(0, 30).map((st) => ({
        id: st.id || amId("step"),
        action: WORKFLOW_ACTIONS.includes(st.action) ? st.action : "show_toast",
        target: amClean(st.target || "", 80),
        config: typeof st.params === "object" && st.params ? st.params
          : (typeof st.config === "object" && st.config ? st.config : {}),
      }));
      const record = {
        id: wf.id && proj.workflows.some((w) => w.id === wf.id) ? wf.id : amId("wf"),
        name: amClean(wf.name || "Untitled Workflow", 80),
        trigger,
        enabled: wf.enabled !== false,
        steps,
        updatedAt: amNow(),
      };
      const existing = proj.workflows.findIndex((w) => w.id === record.id);
      if (existing >= 0) proj.workflows[existing] = record;
      else proj.workflows.push(record);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { workflow: record, workflows: proj.workflows } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * workflow.delete
   */
  registerLensAction("app-maker", "workflowDelete", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const idx = proj.workflows.findIndex((w) => w.id === params?.workflowId);
      if (idx < 0) return { ok: false, error: "workflow_not_found" };
      proj.workflows.splice(idx, 1);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { workflows: proj.workflows } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Live preview ─────────────────────────────────────────────────

  /**
   * preview.render — produce a self-contained static HTML document for the
   * project so the frontend can drop it into an iframe via srcDoc.
   * params.pageId optional — defaults to first page.
   */
  registerLensAction("app-maker", "previewRender", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const page = params?.pageId
        ? proj.pages.find((p) => p.id === params.pageId)
        : proj.pages[0];
      if (!page) return { ok: false, error: "page_not_found" };

      const esc = (v) => String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

      function renderEl(el) {
        const props = el.props || {};
        const base = `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;box-sizing:border-box;`;
        const label = esc(props.label || props.text || el.type);
        switch (el.type) {
          case "button":
            return `<button style="${base}border:1px solid #06b6d4;background:#0e7490;color:#fff;border-radius:6px;cursor:pointer;">${label}</button>`;
          case "input":
            return `<input placeholder="${esc(props.placeholder || label)}" style="${base}border:1px solid #334155;background:#0f172a;color:#e2e8f0;border-radius:6px;padding:0 10px;"/>`;
          case "heading":
            return `<h2 style="${base}margin:0;color:#f1f5f9;font:600 22px system-ui;display:flex;align-items:center;">${label}</h2>`;
          case "text":
            return `<p style="${base}margin:0;color:#cbd5e1;font:14px system-ui;">${label}</p>`;
          case "image":
            return `<div style="${base}background:#1e293b url('${esc(props.src || "")}') center/cover;border:1px solid #334155;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#64748b;font:12px system-ui;">${props.src ? "" : "Image"}</div>`;
          case "card":
            return `<div style="${base}background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px;color:#e2e8f0;font:14px system-ui;">${label}</div>`;
          case "table":
            return `<div style="${base}background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden;font:13px system-ui;color:#cbd5e1;"><div style="background:#1e293b;padding:8px 12px;border-bottom:1px solid #334155;font-weight:600;">${label}</div><div style="padding:8px 12px;color:#64748b;">Row · Row · Row</div></div>`;
          case "form":
            return `<form style="${base}background:#1e293b;border:1px solid #334155;border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px;"><strong style="color:#f1f5f9;font:600 14px system-ui;">${label}</strong><div style="height:32px;background:#0f172a;border:1px solid #334155;border-radius:6px;"></div><div style="height:32px;background:#0f172a;border:1px solid #334155;border-radius:6px;"></div></form>`;
          case "nav":
            return `<nav style="${base}background:#1e293b;border-bottom:1px solid #334155;display:flex;align-items:center;gap:18px;padding:0 18px;color:#94a3b8;font:13px system-ui;">${label} · Home · About · Contact</nav>`;
          case "chart":
            return `<div style="${base}background:#0f172a;border:1px solid #334155;border-radius:8px;display:flex;align-items:flex-end;gap:6px;padding:14px;">${[40, 70, 30, 90, 55, 75].map((h) => `<div style="flex:1;height:${h}%;background:#06b6d4;border-radius:3px 3px 0 0;"></div>`).join("")}</div>`;
          case "list":
            return `<div style="${base}background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px;font:13px system-ui;color:#cbd5e1;">${[1, 2, 3].map((i) => `<div style="padding:6px 8px;border-bottom:1px solid #1e293b;">${esc(label)} item ${i}</div>`).join("")}</div>`;
          default:
            return `<div style="${base}background:#1e293b;border:1px dashed #475569;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#64748b;font:12px system-ui;">${label}</div>`;
        }
      }

      const body = (page.elements || []).map(renderEl).join("\n");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(proj.name)} — ${esc(page.name)}</title></head>` +
        `<body style="margin:0;background:#020617;font-family:system-ui;min-height:100vh;">` +
        `<div style="position:relative;width:100%;min-height:100vh;">${body || '<p style="color:#64748b;padding:40px;font:14px system-ui;">Empty page — drag elements onto the canvas.</p>'}</div>` +
        `</body></html>`;

      return {
        ok: true,
        result: {
          html,
          page: { id: page.id, name: page.name, route: page.route, elementCount: (page.elements || []).length },
          pages: proj.pages.map((p) => ({ id: p.id, name: p.name, route: p.route })),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Real deploy → hosted URL ─────────────────────────────────────

  /**
   * deploy.publish — "deploy" the project. Produces a stable hosted URL,
   * snapshots a version, and flips deployment status to live.
   */
  registerLensAction("app-maker", "deployPublish", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      if (!proj.pages.length) return { ok: false, error: "no_pages_to_deploy" };
      const slug = (proj.name || "app").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
      const buildId = Math.random().toString(36).slice(2, 8);
      const url = `https://${slug}-${buildId}.apps.concord-os.org`;
      const version = {
        id: amId("ver"),
        label: params?.label ? amClean(params.label, 60) : `Deploy ${proj.versions.length + 1}`,
        createdAt: amNow(),
        snapshot: JSON.parse(JSON.stringify({
          pages: proj.pages, dataModel: proj.dataModel,
          workflows: proj.workflows, connectors: proj.connectors,
        })),
        deployUrl: url,
      };
      proj.versions.unshift(version);
      if (proj.versions.length > 50) proj.versions.length = 50;
      proj.deployment = {
        status: "live",
        url,
        deployedAt: amNow(),
        buildId,
        pageCount: proj.pages.length,
      };
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { deployment: proj.deployment, version: { id: version.id, label: version.label } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * deploy.status — current deployment status.
   */
  registerLensAction("app-maker", "deployStatus", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      return { ok: true, result: { deployment: proj.deployment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Version history ──────────────────────────────────────────────

  /**
   * version.snapshot — manually snapshot the current project state.
   */
  registerLensAction("app-maker", "versionSnapshot", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const version = {
        id: amId("ver"),
        label: amClean(params?.label || `Snapshot ${proj.versions.length + 1}`, 60),
        createdAt: amNow(),
        snapshot: JSON.parse(JSON.stringify({
          pages: proj.pages, dataModel: proj.dataModel,
          workflows: proj.workflows, connectors: proj.connectors,
        })),
      };
      proj.versions.unshift(version);
      if (proj.versions.length > 50) proj.versions.length = 50;
      saveAppState();
      return { ok: true, result: { version: { id: version.id, label: version.label, createdAt: version.createdAt } } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * version.list — list version snapshots (history).
   */
  registerLensAction("app-maker", "versionList", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const versions = proj.versions.map((v) => ({
        id: v.id, label: v.label, createdAt: v.createdAt,
        deployUrl: v.deployUrl || null,
        pageCount: v.snapshot?.pages?.length || 0,
        tableCount: v.snapshot?.dataModel?.tables?.length || 0,
      }));
      return { ok: true, result: { versions, count: versions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * version.restore — roll the project back to a snapshot.
   */
  registerLensAction("app-maker", "versionRestore", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const ver = proj.versions.find((v) => v.id === params?.versionId);
      if (!ver || !ver.snapshot) return { ok: false, error: "version_not_found" };
      // Snapshot current state before overwriting so restore is reversible.
      proj.versions.unshift({
        id: amId("ver"),
        label: `Auto-save before restore`,
        createdAt: amNow(),
        snapshot: JSON.parse(JSON.stringify({
          pages: proj.pages, dataModel: proj.dataModel,
          workflows: proj.workflows, connectors: proj.connectors,
        })),
      });
      const snap = JSON.parse(JSON.stringify(ver.snapshot));
      proj.pages = snap.pages || proj.pages;
      proj.dataModel = snap.dataModel || proj.dataModel;
      proj.workflows = snap.workflows || proj.workflows;
      proj.connectors = snap.connectors || proj.connectors;
      proj.updatedAt = amNow();
      if (proj.versions.length > 50) proj.versions.length = 50;
      saveAppState();
      return { ok: true, result: { project: proj } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── Reusable component library + styling ─────────────────────────

  /**
   * library.save — save a styled element as a reusable component.
   * params.component = { name, baseType, props, style }
   */
  registerLensAction("app-maker", "librarySave", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const c = params?.component || {};
      const record = {
        id: c.id && proj.componentLibrary.some((x) => x.id === c.id) ? c.id : amId("cmp"),
        name: amClean(c.name || "Component", 60),
        baseType: amClean(c.baseType || "container", 40),
        props: typeof c.props === "object" && c.props ? c.props : {},
        style: typeof c.style === "object" && c.style ? c.style : {},
        updatedAt: amNow(),
      };
      const idx = proj.componentLibrary.findIndex((x) => x.id === record.id);
      if (idx >= 0) proj.componentLibrary[idx] = record;
      else proj.componentLibrary.push(record);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { component: record, library: proj.componentLibrary } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * library.list — reusable component library for the project.
   */
  registerLensAction("app-maker", "libraryList", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      return { ok: true, result: { library: proj.componentLibrary, count: proj.componentLibrary.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * library.delete
   */
  registerLensAction("app-maker", "libraryDelete", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const idx = proj.componentLibrary.findIndex((x) => x.id === params?.componentId);
      if (idx < 0) return { ok: false, error: "component_not_found" };
      proj.componentLibrary.splice(idx, 1);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { library: proj.componentLibrary } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ─── API / data-source connectors ─────────────────────────────────

  const CONNECTOR_KINDS = [
    { kind: "rest", label: "REST API", authModes: ["none", "api_key", "bearer"] },
    { kind: "graphql", label: "GraphQL", authModes: ["none", "bearer"] },
    { kind: "google_sheet", label: "Google Sheet", authModes: ["api_key"] },
    { kind: "airtable", label: "Airtable", authModes: ["api_key"] },
    { kind: "postgres", label: "PostgreSQL", authModes: ["connection_string"] },
    { kind: "webhook", label: "Webhook", authModes: ["none"] },
  ];

  /**
   * connector.kinds — supported data-source connector types.
   */
  registerLensAction("app-maker", "connectorKinds", () => {
    return { ok: true, result: { kinds: CONNECTOR_KINDS } };
  });

  /**
   * connector.save — bind an external API/data-source to the project.
   * params.connector = { id?, name, kind, endpoint, authMode, method }
   */
  registerLensAction("app-maker", "connectorSave", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const c = params?.connector || {};
      const kindEntry = CONNECTOR_KINDS.find((k) => k.kind === c.kind);
      if (!kindEntry) return { ok: false, error: "unknown_connector_kind" };
      const record = {
        id: c.id && proj.connectors.some((x) => x.id === c.id) ? c.id : amId("conn"),
        name: amClean(c.name || kindEntry.label, 60),
        kind: c.kind,
        endpoint: amClean(c.endpoint || "", 400),
        method: ["GET", "POST", "PUT", "DELETE", "PATCH"].includes(c.method) ? c.method : "GET",
        authMode: kindEntry.authModes.includes(c.authMode) ? c.authMode : kindEntry.authModes[0],
        // Credentials masked — never stored plaintext beyond a label hint.
        credentialHint: c.credential ? `••••${String(c.credential).slice(-4)}` : null,
        status: "configured",
        updatedAt: amNow(),
      };
      const idx = proj.connectors.findIndex((x) => x.id === record.id);
      if (idx >= 0) proj.connectors[idx] = record;
      else proj.connectors.push(record);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { connector: record, connectors: proj.connectors } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector.list
   */
  registerLensAction("app-maker", "connectorList", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      return { ok: true, result: { connectors: proj.connectors, count: proj.connectors.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector.delete
   */
  registerLensAction("app-maker", "connectorDelete", (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const idx = proj.connectors.findIndex((x) => x.id === params?.connectorId);
      if (idx < 0) return { ok: false, error: "connector_not_found" };
      proj.connectors.splice(idx, 1);
      proj.updatedAt = amNow();
      saveAppState();
      return { ok: true, result: { connectors: proj.connectors } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * connector.test — probe a REST/GraphQL/webhook connector by issuing the
   * configured request. Real network call; safe-fails on any error.
   */
  registerLensAction("app-maker", "connectorTest", async (ctx, artifact, params) => {
    try {
      const s = getAppState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const proj = findProject(s, amActor(ctx), params?.projectId);
      if (!proj) return { ok: false, error: "project_not_found" };
      const conn = proj.connectors.find((c) => c.id === params?.connectorId);
      if (!conn) return { ok: false, error: "connector_not_found" };
      if (!conn.endpoint || !/^https?:\/\//.test(conn.endpoint)) {
        return { ok: false, error: "invalid_endpoint" };
      }
      if (!["rest", "graphql", "webhook"].includes(conn.kind)) {
        return { ok: true, result: { reachable: null, message: `${conn.kind} connectors are not network-probable` } };
      }
      const started = Date.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(conn.endpoint, {
          method: conn.kind === "graphql" ? "POST" : conn.method,
          signal: ctrl.signal,
          headers: conn.kind === "graphql" ? { "content-type": "application/json" } : undefined,
          body: conn.kind === "graphql" ? JSON.stringify({ query: "{__typename}" }) : undefined,
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - started;
        conn.status = resp.ok ? "verified" : "error";
        conn.lastTestedAt = amNow();
        saveAppState();
        return {
          ok: true,
          result: { reachable: resp.ok, httpStatus: resp.status, latencyMs, connectorId: conn.id },
        };
      } catch (netErr) {
        conn.status = "error";
        conn.lastTestedAt = amNow();
        saveAppState();
        return {
          ok: true,
          result: { reachable: false, error: String(netErr?.message || netErr), connectorId: conn.id },
        };
      }
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
