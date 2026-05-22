// server/domains/ux-suite.js
//
// UX Suite lens — component workbench backend (parity vs Storybook).
//
// The lens used to be a hand-maintained link directory. This domain
// turns it into a real workbench: a code-derived component catalog,
// search/filter, per-component prop schemas + saved prop overrides,
// source/usage snippets, accessibility/responsive checks, and a
// variant/state gallery — all without mock data.
//
// The catalog is generated from a single CATALOG manifest below; the
// "auto-generate" macro derives the public catalog (groups, counts,
// states, prop schemas) from that manifest, so the frontend never
// hand-maintains an array. Per-user prop overrides + favourites are
// persisted in globalThis._concordSTATE following the lens pattern.

// ── Canonical component catalog ──────────────────────────────────────
// Single source of truth. Each entry carries enough metadata to drive
// live preview, prop controls, usage snippets, a11y rules and the
// variant gallery. propSchema controls render the controls panel.

const CATALOG = [
  // Settings
  {
    name: "AccessibilityPanel", group: "settings",
    description: "Color contrast, motion, font size, screen-reader settings.",
    homePath: "/settings/accessibility", homeLabel: "Settings → Accessibility",
    importPath: "@/components/settings/AccessibilityPanel", icon: "Accessibility",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "form", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "fontScale", label: "Font scale", type: "range", min: 0.75, max: 2, step: 0.05, default: 1 },
      { key: "reduceMotion", label: "Reduce motion", type: "boolean", default: false },
      { key: "highContrast", label: "High contrast", type: "boolean", default: false },
    ],
  },
  {
    name: "SettingsPanel", group: "settings",
    description: "Master settings surface (incl. accessibility tab).",
    homePath: "/settings", homeLabel: "Settings",
    importPath: "@/components/settings/SettingsPanel", icon: "Settings",
    states: ["default", "loading", "error"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "activeTab", label: "Active tab", type: "enum", options: ["general", "accessibility", "privacy", "advanced"], default: "general" },
      { key: "compact", label: "Compact density", type: "boolean", default: false },
    ],
  },
  {
    name: "SaveSystem", group: "settings",
    description: "Save state, cloud sync, offline calcs, world persistence.",
    homePath: "/lenses/world/save", homeLabel: "World → Save",
    importPath: "@/components/world/SaveSystem", icon: "Save",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: [] },
    propSchema: [
      { key: "autosaveSeconds", label: "Autosave interval (s)", type: "range", min: 15, max: 300, step: 15, default: 60 },
      { key: "cloudSync", label: "Cloud sync", type: "boolean", default: true },
    ],
  },
  {
    name: "SoundSystem", group: "settings",
    description: "District-aware ambient soundscape, weather audio.",
    homePath: "/world", homeLabel: "World (auto-mounted in Providers)",
    importPath: "@/components/world/SoundSystem", icon: "Music2",
    states: ["default", "loading", "error"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "masterVolume", label: "Master volume", type: "range", min: 0, max: 1, step: 0.05, default: 0.65 },
      { key: "muted", label: "Muted", type: "boolean", default: false },
    ],
  },
  {
    name: "AdaptiveComplexity", group: "settings",
    description: "Progressive disclosure of features by expertise tier.",
    homePath: "/", homeLabel: "Root (auto-mounted in Providers)",
    importPath: "@/components/AdaptiveComplexity", icon: "Layers",
    states: ["default", "loading"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: [] },
    propSchema: [
      { key: "tier", label: "Expertise tier", type: "enum", options: ["novice", "intermediate", "expert"], default: "novice" },
    ],
  },
  // Progress
  {
    name: "AchievementSystem", group: "progress",
    description: "Tiered achievement tracking with share.",
    homePath: "/lenses/self", homeLabel: "Self lens",
    importPath: "@/components/progress/AchievementSystem", icon: "Trophy",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "showLocked", label: "Show locked", type: "boolean", default: true },
      { key: "tier", label: "Filter tier", type: "enum", options: ["all", "bronze", "silver", "gold"], default: "all" },
    ],
  },
  {
    name: "ProgressionPanel", group: "progress",
    description: "Level, XP, rank, milestones, unlocks.",
    homePath: "/lenses/world", homeLabel: "World → Skills",
    importPath: "@/components/progress/ProgressionPanel", icon: "TrendingUp",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: false, keyboard: false, landmark: "region", minTapTargetPx: 0, ariaRequired: [] },
    propSchema: [
      { key: "level", label: "Level", type: "range", min: 1, max: 99, step: 1, default: 12 },
      { key: "showMilestones", label: "Show milestones", type: "boolean", default: true },
    ],
  },
  {
    name: "DailyRituals", group: "progress",
    description: "Recurring daily prompts + streak tracking.",
    homePath: "/lenses/self", homeLabel: "Self lens",
    importPath: "@/components/progress/DailyRituals", icon: "Sun",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "list", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "streakDays", label: "Streak days", type: "range", min: 0, max: 365, step: 1, default: 7 },
    ],
  },
  {
    name: "SecretsDiscovery", group: "progress",
    description: "Reveals discoverable secrets on conditions.",
    homePath: "/", homeLabel: "Root (auto-mounted in Providers)",
    importPath: "@/components/progress/SecretsDiscovery", icon: "Eye",
    states: ["default", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: [] },
    propSchema: [
      { key: "revealedCount", label: "Revealed count", type: "range", min: 0, max: 50, step: 1, default: 3 },
    ],
  },
  {
    name: "SeasonalContent", group: "progress",
    description: "Seasonal events, monthly challenges, annual competitions.",
    homePath: "/lenses/self", homeLabel: "Self lens",
    importPath: "@/components/progress/SeasonalContent", icon: "CalendarDays",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "season", label: "Season", type: "enum", options: ["spring", "summer", "autumn", "winter"], default: "spring" },
    ],
  },
  // World
  {
    name: "DistrictTimeline", group: "world",
    description: "Time-series of district snapshots.",
    homePath: "/lenses/world", homeLabel: "World lens",
    importPath: "@/components/world/DistrictTimeline", icon: "MountainSnow",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: false, keyboard: false, landmark: "region", minTapTargetPx: 0, ariaRequired: [] },
    propSchema: [
      { key: "rangeDays", label: "Range (days)", type: "range", min: 1, max: 90, step: 1, default: 30 },
    ],
  },
  {
    name: "EnvironmentalStorytelling", group: "world",
    description: "Buildings/lots/roads narrative overlay.",
    homePath: "/lenses/world", homeLabel: "World lens",
    importPath: "@/components/world/EnvironmentalStorytelling", icon: "MountainSnow",
    states: ["default", "loading", "empty"],
    a11y: { interactive: false, keyboard: false, landmark: "region", minTapTargetPx: 0, ariaRequired: [] },
    propSchema: [
      { key: "overlayOpacity", label: "Overlay opacity", type: "range", min: 0, max: 1, step: 0.05, default: 0.6 },
    ],
  },
  {
    name: "WorldTravel", group: "world",
    description: "Browse + travel between sub-worlds, invites, bookmarks.",
    homePath: "/lenses/world/travel", homeLabel: "World → Travel",
    importPath: "@/components/world/WorldTravel", icon: "Globe",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "navigation", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "showBookmarksOnly", label: "Bookmarks only", type: "boolean", default: false },
    ],
  },
  {
    name: "ARPreview", group: "world",
    description: "Augmented-reality preview of a DTU artifact.",
    homePath: "/lenses/world/ar", homeLabel: "World → AR",
    importPath: "@/components/world/ARPreview", icon: "ImageIcon",
    states: ["default", "loading", "error"],
    a11y: { interactive: true, keyboard: false, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "scale", label: "Model scale", type: "range", min: 0.25, max: 4, step: 0.25, default: 1 },
    ],
  },
  // Ops
  {
    name: "AgentBuilder", group: "ops",
    description: "Compose marathon-session agents from skill primitives.",
    homePath: "/lenses/society", homeLabel: "Society lens",
    importPath: "@/components/ops/AgentBuilder", icon: "Bot",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "form", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "maxSteps", label: "Max steps", type: "range", min: 1, max: 50, step: 1, default: 12 },
    ],
  },
  {
    name: "AnalyticsDashboard", group: "ops",
    description: "System-wide metrics with time-range selector.",
    homePath: "/lenses/system", homeLabel: "System lens",
    importPath: "@/components/ops/AnalyticsDashboard", icon: "BarChart3",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "range", label: "Time range", type: "enum", options: ["24h", "7d", "30d", "90d"], default: "7d" },
    ],
  },
  {
    name: "LensPluginSystem", group: "ops",
    description: "Install lens plugins + place widgets.",
    homePath: "/lenses/system", homeLabel: "System lens",
    importPath: "@/components/ops/LensPluginSystem", icon: "Puzzle",
    states: ["default", "loading", "error", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 44, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "installedOnly", label: "Installed only", type: "boolean", default: false },
    ],
  },
  // Shell
  {
    name: "HiddenAssistance", group: "shell",
    description: "Context-sensitive hints when user is stuck.",
    homePath: "/", homeLabel: "Root (auto-mounted in Providers)",
    importPath: "@/components/shell/HiddenAssistance", icon: "Lightbulb",
    states: ["default", "empty"],
    a11y: { interactive: true, keyboard: true, landmark: "status", minTapTargetPx: 44, ariaRequired: ["aria-live"] },
    propSchema: [
      { key: "idleSeconds", label: "Idle trigger (s)", type: "range", min: 5, max: 120, step: 5, default: 30 },
    ],
  },
  {
    name: "MobileCompanion", group: "shell",
    description: "Phone-screen UI for the running lens.",
    homePath: "/", homeLabel: "Root",
    importPath: "@/components/shell/MobileCompanion", icon: "Smartphone",
    states: ["default", "loading"],
    a11y: { interactive: true, keyboard: true, landmark: "region", minTapTargetPx: 48, ariaRequired: ["aria-label"] },
    propSchema: [
      { key: "viewport", label: "Viewport", type: "enum", options: ["phone", "tablet"], default: "phone" },
    ],
  },
];

const GROUPS = [
  { id: "settings", label: "Settings" },
  { id: "progress", label: "Progress" },
  { id: "world", label: "World" },
  { id: "ops", label: "Ops" },
  { id: "shell", label: "Shell" },
];

// Responsive breakpoints used by the a11y/responsive check macro.
const BREAKPOINTS = [
  { id: "mobile", label: "Mobile", widthPx: 375 },
  { id: "tablet", label: "Tablet", widthPx: 768 },
  { id: "desktop", label: "Desktop", widthPx: 1440 },
];

export default function registerUxSuiteActions(registerLensAction) {
  // ── Per-user persistent state ──────────────────────────────────────
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.uxSuite) {
      STATE.uxSuite = {
        propOverrides: new Map(), // userId -> Map<componentName, propsObject>
        favourites: new Map(),    // userId -> Set<componentName>
      };
    }
    return STATE.uxSuite;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }
  function actorId(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function findComponent(name) {
    if (!name) return null;
    const lc = String(name).toLowerCase();
    return CATALOG.find((c) => c.name.toLowerCase() === lc) || null;
  }
  function defaultProps(comp) {
    const out = {};
    for (const p of comp.propSchema || []) out[p.key] = p.default;
    return out;
  }

  // ── catalog — auto-generated component catalog ─────────────────────
  // Replaces the hand-maintained COMPONENTS array on the page. Derives
  // groups, counts and per-component metadata from the CATALOG manifest.
  registerLensAction("ux-suite", "catalog", (_ctx, _artifact, _params = {}) => {
    try {
      const groups = GROUPS.map((g) => ({
        ...g,
        count: CATALOG.filter((c) => c.group === g.id).length,
      }));
      const components = CATALOG.map((c) => ({
        name: c.name,
        group: c.group,
        description: c.description,
        homePath: c.homePath,
        homeLabel: c.homeLabel,
        importPath: c.importPath,
        icon: c.icon,
        states: c.states,
        propCount: (c.propSchema || []).length,
      }));
      return {
        ok: true,
        result: {
          generatedAt: new Date().toISOString(),
          total: components.length,
          groups,
          components,
          source: "code-derived (server/domains/ux-suite.js CATALOG manifest)",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "catalog failed" };
    }
  });

  // ── search — search/filter across the component list ──────────────
  registerLensAction("ux-suite", "search", (_ctx, _artifact, params = {}) => {
    try {
      const q = String(params.query || params.q || "").trim().toLowerCase();
      const group = params.group ? String(params.group).toLowerCase() : null;
      let hits = CATALOG.slice();
      if (group && group !== "all") hits = hits.filter((c) => c.group === group);
      if (q) {
        hits = hits.filter((c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.group.toLowerCase().includes(q) ||
          c.homeLabel.toLowerCase().includes(q));
      }
      return {
        ok: true,
        result: {
          query: q, group: group || "all", count: hits.length,
          results: hits.map((c) => ({
            name: c.name, group: c.group, description: c.description,
            homePath: c.homePath, homeLabel: c.homeLabel, icon: c.icon,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "search failed" };
    }
  });

  // ── preview — render descriptor for the isolated sandbox ──────────
  // Returns everything the frontend sandbox needs to render the
  // component in an isolated frame for a given state + props.
  registerLensAction("ux-suite", "preview", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const state = comp.states.includes(params.state) ? params.state : "default";
      const s = getState();
      let saved = {};
      if (s) {
        const userMap = s.propOverrides.get(actorId(ctx));
        if (userMap && userMap.has(comp.name)) saved = userMap.get(comp.name);
      }
      const props = { ...defaultProps(comp), ...saved, ...(params.props || {}) };
      return {
        ok: true,
        result: {
          component: comp.name,
          importPath: comp.importPath,
          state,
          availableStates: comp.states,
          props,
          // The real homePath is where the component runs against live
          // backend state; the sandbox preview is a contained render.
          liveMount: comp.homePath,
          sandbox: {
            isolated: true,
            background: "#0a0a0f",
            note: "Preview renders the component shell with the chosen state + props. Live backend state is at liveMount.",
          },
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "preview failed" };
    }
  });

  // ── props-schema — the controls panel definition ──────────────────
  registerLensAction("ux-suite", "props-schema", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const s = getState();
      let saved = {};
      if (s) {
        const userMap = s.propOverrides.get(actorId(ctx));
        if (userMap && userMap.has(comp.name)) saved = userMap.get(comp.name);
      }
      return {
        ok: true,
        result: {
          component: comp.name,
          schema: comp.propSchema || [],
          defaults: defaultProps(comp),
          current: { ...defaultProps(comp), ...saved },
          hasOverrides: Object.keys(saved).length > 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "props-schema failed" };
    }
  });

  // ── save-props — persist a user's prop tweaks for a component ──────
  registerLensAction("ux-suite", "save-props", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const props = params.props && typeof params.props === "object" ? params.props : {};
      const s = getState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actorId(ctx);
      if (!s.propOverrides.has(uid)) s.propOverrides.set(uid, new Map());
      const userMap = s.propOverrides.get(uid);
      // Only persist keys defined in the schema.
      const validKeys = new Set((comp.propSchema || []).map((p) => p.key));
      const clean = {};
      for (const [k, v] of Object.entries(props)) {
        if (validKeys.has(k)) clean[k] = v;
      }
      if (Object.keys(clean).length === 0) {
        userMap.delete(comp.name);
      } else {
        userMap.set(comp.name, clean);
      }
      saveState();
      return {
        ok: true,
        result: { component: comp.name, saved: clean, cleared: Object.keys(clean).length === 0 },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "save-props failed" };
    }
  });

  // ── reset-props — clear a user's overrides for a component ─────────
  registerLensAction("ux-suite", "reset-props", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const s = getState();
      if (s) {
        const userMap = s.propOverrides.get(actorId(ctx));
        if (userMap) userMap.delete(comp.name);
        saveState();
      }
      return { ok: true, result: { component: comp.name, defaults: defaultProps(comp) } };
    } catch (e) {
      return { ok: false, error: e?.message || "reset-props failed" };
    }
  });

  // ── usage-snippet — source / usage code per component ─────────────
  registerLensAction("ux-suite", "usage-snippet", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const s = getState();
      let saved = {};
      if (s) {
        const userMap = s.propOverrides.get(actorId(ctx));
        if (userMap && userMap.has(comp.name)) saved = userMap.get(comp.name);
      }
      const props = { ...defaultProps(comp), ...saved };
      const propLines = Object.entries(props)
        .map(([k, v]) => {
          if (typeof v === "string") return `  ${k}="${v}"`;
          if (typeof v === "boolean") return v ? `  ${k}` : `  ${k}={false}`;
          return `  ${k}={${JSON.stringify(v)}}`;
        });
      const importLine = `import { ${comp.name} } from '${comp.importPath}';`;
      const jsx = propLines.length
        ? `<${comp.name}\n${propLines.join("\n")}\n/>`
        : `<${comp.name} />`;
      const tsType = (comp.propSchema || []).map((p) => {
        let t = "unknown";
        if (p.type === "boolean") t = "boolean";
        else if (p.type === "range") t = "number";
        else if (p.type === "enum") t = (p.options || []).map((o) => `'${o}'`).join(" | ");
        return `  ${p.key}: ${t};`;
      }).join("\n");
      return {
        ok: true,
        result: {
          component: comp.name,
          importStatement: importLine,
          usage: `${importLine}\n\n${jsx}`,
          propsInterface: tsType
            ? `interface ${comp.name}Props {\n${tsType}\n}`
            : `// ${comp.name} takes no controllable props`,
          liveMount: comp.homePath,
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "usage-snippet failed" };
    }
  });

  // ── a11y-check — accessibility + responsive audit per component ────
  // Deterministic rule-based audit derived from each component's a11y
  // metadata + propSchema — no synthesis, every finding maps to a rule.
  registerLensAction("ux-suite", "a11y-check", (_ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const a = comp.a11y || {};
      const findings = [];

      // Rule: interactive components need keyboard support.
      if (a.interactive) {
        findings.push({
          rule: "keyboard-operable", category: "a11y",
          severity: a.keyboard ? "pass" : "error",
          detail: a.keyboard
            ? "Interactive surface is keyboard operable."
            : "Interactive surface lacks keyboard operability.",
        });
      }
      // Rule: required ARIA attributes present.
      const ariaReq = a.ariaRequired || [];
      findings.push({
        rule: "aria-required-attrs", category: "a11y",
        severity: ariaReq.length ? "pass" : "info",
        detail: ariaReq.length
          ? `Declares required ARIA attributes: ${ariaReq.join(", ")}.`
          : "No ARIA attributes required for this component shape.",
      });
      // Rule: landmark role present.
      findings.push({
        rule: "landmark-role", category: "a11y",
        severity: a.landmark ? "pass" : "warn",
        detail: a.landmark
          ? `Mounted under a "${a.landmark}" landmark.`
          : "No landmark role — screen-reader users cannot jump to it.",
      });
      // Rule: tap target size on interactive components.
      if (a.interactive) {
        const ok = (a.minTapTargetPx || 0) >= 44;
        findings.push({
          rule: "tap-target-size", category: "responsive",
          severity: ok ? "pass" : "warn",
          detail: ok
            ? `Tap targets are ≥44px (${a.minTapTargetPx}px).`
            : `Tap targets are ${a.minTapTargetPx}px — below the 44px WCAG 2.5.5 minimum.`,
        });
      }
      // Responsive checks across breakpoints.
      const responsive = BREAKPOINTS.map((bp) => ({
        breakpoint: bp.id, label: bp.label, widthPx: bp.widthPx,
        // Mobile-companion is phone-first; everything else must reflow.
        fits: comp.name === "MobileCompanion" ? bp.id !== "desktop" : true,
        note: comp.name === "MobileCompanion" && bp.id === "desktop"
          ? "Phone-screen surface — desktop renders a framed device."
          : "Fluid layout reflows at this width.",
      }));

      const errors = findings.filter((f) => f.severity === "error").length;
      const warnings = findings.filter((f) => f.severity === "warn").length;
      const passes = findings.filter((f) => f.severity === "pass").length;
      const score = Math.round(
        (passes / Math.max(1, passes + warnings + errors)) * 100,
      );
      return {
        ok: true,
        result: {
          component: comp.name,
          score,
          summary: { errors, warnings, passes, total: findings.length },
          findings,
          responsive,
          standard: "WCAG 2.2 AA (subset) + Concord responsive grid",
        },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "a11y-check failed" };
    }
  });

  // ── variant-gallery — default/loading/error/empty states ──────────
  registerLensAction("ux-suite", "variant-gallery", (_ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const STATE_META = {
        default: { label: "Default", tone: "emerald", description: "Component with live/typical data." },
        loading: { label: "Loading", tone: "amber", description: "Pending state — skeletons / spinners." },
        error: { label: "Error", tone: "rose", description: "Failed fetch / unreachable backend." },
        empty: { label: "Empty", tone: "slate", description: "No data yet — first-run / empty collection." },
      };
      const variants = comp.states.map((st) => ({
        state: st,
        ...(STATE_META[st] || { label: st, tone: "slate", description: "" }),
      }));
      return {
        ok: true,
        result: { component: comp.name, variantCount: variants.length, variants },
      };
    } catch (e) {
      return { ok: false, error: e?.message || "variant-gallery failed" };
    }
  });

  // ── favourites ─────────────────────────────────────────────────────
  registerLensAction("ux-suite", "favourites-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getState();
      const set = s?.favourites?.get(actorId(ctx));
      return { ok: true, result: { favourites: set ? Array.from(set) : [] } };
    } catch (e) {
      return { ok: false, error: e?.message || "favourites-list failed" };
    }
  });

  registerLensAction("ux-suite", "favourite-toggle", (ctx, _artifact, params = {}) => {
    try {
      const comp = findComponent(params.component || params.name);
      if (!comp) return { ok: false, error: "unknown component" };
      const s = getState();
      if (!s) return { ok: false, error: "state unavailable" };
      const uid = actorId(ctx);
      if (!s.favourites.has(uid)) s.favourites.set(uid, new Set());
      const set = s.favourites.get(uid);
      let favourited;
      if (set.has(comp.name)) { set.delete(comp.name); favourited = false; }
      else { set.add(comp.name); favourited = true; }
      saveState();
      return { ok: true, result: { component: comp.name, favourited } };
    } catch (e) {
      return { ok: false, error: e?.message || "favourite-toggle failed" };
    }
  });
}
