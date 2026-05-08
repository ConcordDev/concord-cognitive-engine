/**
 * Concord Package Manager (CPM) — DTU-Based Component Package Management
 *
 * Manages packages of DTU-based components with dependency resolution,
 * validation, and citation tracking. Every install creates a citation
 * record linking the consumer to the original creator.
 *
 * Core invariants:
 *   - Every package is a validated DTU with content hash
 *   - Installs always create citation records (attribution is mandatory)
 *   - Dependencies are resolved recursively with semver matching
 *   - Compatibility checks enforce material/load/infrastructure constraints
 */

const { createHash, randomUUID } = require("crypto");

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function uid(prefix = "cpm") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Minimal semver comparison. Returns -1, 0, or 1.
 */
function semverCompare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

/**
 * Check if version satisfies a semver range (supports ^, ~, exact, and *).
 */
function semverSatisfies(version, range) {
  if (range === "*" || range === "latest") return true;
  const v = version.split(".").map(Number);
  if (range.startsWith("^")) {
    const r = range.slice(1).split(".").map(Number);
    if (v[0] !== r[0]) return false;
    return semverCompare(version, range.slice(1)) >= 0;
  }
  if (range.startsWith("~")) {
    const r = range.slice(1).split(".").map(Number);
    if (v[0] !== r[0] || v[1] !== r[1]) return false;
    return v[2] >= r[2];
  }
  if (range.startsWith(">=")) {
    return semverCompare(version, range.slice(2)) >= 0;
  }
  return version === range;
}

// ══════════════════════════════════════════════════════════════════════════════
// SEED REGISTRY DATA
// ══════════════════════════════════════════════════════════════════════════════

const SEED_PACKAGES = [
  {
    name: "usb-a-beam-6m",
    version: "2.1.0",
    creator: "concord-structural-lab",
    description: "Universal steel beam component, 6m span, W-flange profile with pre-drilled connection points",
    dtuId: "dtu_beam6m_a1b2c3d4",
    category: "structural",
    tags: ["beam", "steel", "structural", "6m", "w-flange"],
    citations: 342,
    downloads: 1847,
    validationStatus: "certified",
    validationExpires: "2027-03-15T00:00:00.000Z",
    dependencies: { "steel-column-wide-flange": "^1.0.0" },
    performance: { loadCapacity: "45kN/m", deflectionLimit: "L/360", fireRating: "2hr" },
    publishedAt: "2025-06-12T14:30:00.000Z",
  },
  {
    name: "seismic-foundation-class-7",
    version: "1.3.2",
    creator: "geo-dynamics-institute",
    description: "Seismic-rated foundation system for Class 7 soil conditions with integrated damping",
    dtuId: "dtu_seismic7_e5f6g7h8",
    category: "foundation",
    tags: ["foundation", "seismic", "class-7", "damping", "concrete"],
    citations: 198,
    downloads: 923,
    validationStatus: "certified",
    validationExpires: "2026-11-01T00:00:00.000Z",
    dependencies: {},
    performance: { seismicRating: "VII", soilClass: "D", dampingRatio: 0.05 },
    publishedAt: "2025-04-22T09:15:00.000Z",
  },
  {
    name: "steel-column-wide-flange",
    version: "1.2.0",
    creator: "concord-structural-lab",
    description: "Wide-flange steel column with standard AISC connection details",
    dtuId: "dtu_colwf_i9j0k1l2",
    category: "structural",
    tags: ["column", "steel", "wide-flange", "AISC", "structural"],
    citations: 567,
    downloads: 3102,
    validationStatus: "certified",
    validationExpires: "2027-01-20T00:00:00.000Z",
    dependencies: {},
    performance: { axialCapacity: "2200kN", momentCapacity: "450kN-m", sectionClass: 1 },
    publishedAt: "2025-02-10T11:00:00.000Z",
  },
  {
    name: "water-main-ductile-iron",
    version: "3.0.1",
    creator: "aqua-infrastructure-co",
    description: "Ductile iron water main pipe, DN300, push-fit joints with corrosion protection",
    dtuId: "dtu_watermain_m3n4o5p6",
    category: "infrastructure",
    tags: ["water", "pipe", "ductile-iron", "DN300", "utility"],
    citations: 89,
    downloads: 612,
    validationStatus: "certified",
    validationExpires: "2027-06-30T00:00:00.000Z",
    dependencies: {},
    performance: { pressureRating: "16bar", nominalDiameter: "DN300", designLife: "100yr" },
    publishedAt: "2025-08-05T16:45:00.000Z",
  },
  {
    name: "electrical-panel-200a",
    version: "1.0.4",
    creator: "volt-systems-inc",
    description: "200A main electrical distribution panel with 42 circuit breaker slots",
    dtuId: "dtu_epanel_q7r8s9t0",
    category: "electrical",
    tags: ["electrical", "panel", "200A", "distribution", "circuit-breaker"],
    citations: 156,
    downloads: 1044,
    validationStatus: "certified",
    validationExpires: "2026-09-15T00:00:00.000Z",
    dependencies: {},
    performance: { amperage: "200A", slots: 42, voltage: "120/240V", phasing: "single" },
    publishedAt: "2025-05-18T08:20:00.000Z",
  },
  {
    name: "weather-hudson-valley",
    version: "2.0.0",
    creator: "concord-environmental",
    description: "Hudson Valley regional weather model with seasonal precipitation and wind patterns",
    dtuId: "dtu_weather_u1v2w3x4",
    category: "environmental",
    tags: ["weather", "hudson-valley", "climate", "seasonal", "wind"],
    citations: 74,
    downloads: 389,
    validationStatus: "verified",
    validationExpires: "2026-12-31T00:00:00.000Z",
    dependencies: {},
    performance: { resolution: "1km", updateFrequency: "6hr", forecastHorizon: "72hr" },
    publishedAt: "2025-09-01T12:00:00.000Z",
  },
  {
    name: "npc-blacksmith-template",
    version: "1.1.0",
    creator: "world-builders-guild",
    description: "Blacksmith NPC template with dialogue trees, crafting schedule, and trade inventory",
    dtuId: "dtu_npcsmith_y5z6a7b8",
    category: "npc",
    tags: ["npc", "blacksmith", "medieval", "crafting", "dialogue"],
    citations: 213,
    downloads: 1560,
    validationStatus: "verified",
    validationExpires: "2027-02-28T00:00:00.000Z",
    dependencies: { "quest-chain-mystery": "^1.0.0" },
    performance: { dialogueNodes: 47, scheduleSteps: 12, tradeItems: 24 },
    publishedAt: "2025-07-14T10:30:00.000Z",
  },
  {
    name: "quest-chain-mystery",
    version: "1.0.3",
    creator: "world-builders-guild",
    description: "Mystery quest chain framework with branching outcomes and evidence tracking",
    dtuId: "dtu_questmyst_c9d0e1f2",
    category: "quest",
    tags: ["quest", "mystery", "branching", "narrative", "evidence"],
    citations: 145,
    downloads: 987,
    validationStatus: "verified",
    validationExpires: "2027-04-15T00:00:00.000Z",
    dependencies: {},
    performance: { branches: 8, outcomes: 5, minPlaytime: "45min", maxPlaytime: "3hr" },
    publishedAt: "2025-03-28T15:00:00.000Z",
  },
  {
    name: "hospital-template",
    version: "1.0.0",
    creator: "civic-design-collective",
    description: "Full hospital facility template with ER, ICU, pharmacy, and administrative wings",
    dtuId: "dtu_hospital_g3h4i5j6",
    category: "building",
    tags: ["hospital", "healthcare", "facility", "civic", "template"],
    citations: 32,
    downloads: 214,
    validationStatus: "certified",
    validationExpires: "2027-08-01T00:00:00.000Z",
    dependencies: {
      "electrical-panel-200a": "^1.0.0",
      "water-main-ductile-iron": "^3.0.0",
    },
    performance: { beds: 120, departments: 8, floors: 4, sqft: 185000 },
    publishedAt: "2025-10-10T09:00:00.000Z",
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// COMPATIBILITY RULES
// ══════════════════════════════════════════════════════════════════════════════

const COMPATIBILITY_RULES = {
  structural: {
    requires: ["foundation"],
    conflicts: [],
    maxPerProject: null,
  },
  foundation: {
    requires: [],
    conflicts: [],
    maxPerProject: 1,
  },
  electrical: {
    requires: [],
    conflicts: [],
    maxPerProject: null,
  },
  infrastructure: {
    requires: [],
    conflicts: [],
    maxPerProject: null,
  },
  environmental: {
    requires: [],
    conflicts: [],
    maxPerProject: 1,
  },
  npc: {
    requires: [],
    conflicts: [],
    maxPerProject: null,
  },
  quest: {
    requires: [],
    conflicts: [],
    maxPerProject: null,
  },
  building: {
    requires: ["structural", "electrical"],
    conflicts: [],
    maxPerProject: null,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// CPM MANAGER CLASS
// ══════════════════════════════════════════════════════════════════════════════

class CpmManager {
  /**
   * @param {object} [opts]
   * @param {object} [opts.brain] - Brain instance for natural language search
   * @param {function} [opts.log] - Structured logger function
   */
  constructor(opts = {}) {
    this.brain = opts.brain || null;
    this.log = opts.log || (() => {});
    this.registry = new Map();
    this.citations = [];
    this._seed();
  }

  /** Load seed packages into the registry. */
  _seed() {
    for (const pkg of SEED_PACKAGES) {
      this.registry.set(pkg.name, { ...pkg });
    }
    this.log("cpm", `Registry seeded with ${this.registry.size} packages`);
  }

  /**
   * Install a package by name. Resolves dependencies, checks compatibility,
   * and creates citation records for every installed package.
   *
   * @param {string} packageName
   * @param {string} [version="latest"]
   * @param {object} [manifest] - Current project manifest for compatibility checks
   * @returns {{ installed: object[], citations: object[], warnings: string[] }}
   */
  install(packageName, version = "latest", manifest = null) {
    const warnings = [];
    const installed = [];
    const newCitations = [];

    // Resolve full dependency tree
    const resolved = this.resolve(packageName);
    if (resolved.error) {
      return { installed: [], citations: [], warnings: [resolved.error] };
    }

    // Install each package in dependency order
    for (const depName of resolved.order) {
      const pkg = this.registry.get(depName);
      if (!pkg) {
        warnings.push(`Dependency '${depName}' not found in registry`);
        continue;
      }

      // Version check
      if (version !== "latest" && depName === packageName) {
        if (semverCompare(pkg.version, version) < 0) {
          warnings.push(`Requested version ${version} is newer than available ${pkg.version}`);
        }
      }

      // Validation status check
      if (pkg.validationStatus !== "certified" && pkg.validationStatus !== "verified") {
        warnings.push(`Package '${depName}' has validation status: ${pkg.validationStatus}`);
      }

      // Check expiration
      if (pkg.validationExpires && new Date(pkg.validationExpires) < new Date()) {
        warnings.push(`Package '${depName}' validation expired on ${pkg.validationExpires}`);
      }

      // Create citation record
      const citation = {
        id: uid("cite"),
        packageName: depName,
        packageVersion: pkg.version,
        creator: pkg.creator,
        dtuId: pkg.dtuId,
        installedAt: nowISO(),
        relationship: depName === packageName ? "direct" : "transitive",
      };
      newCitations.push(citation);
      this.citations.push(citation);

      // Increment download count
      pkg.downloads = (pkg.downloads || 0) + 1;

      installed.push({
        name: pkg.name,
        version: pkg.version,
        category: pkg.category,
        dtuId: pkg.dtuId,
        creator: pkg.creator,
      });
    }

    // Compatibility check against manifest
    if (manifest && manifest.installed) {
      const allPackages = [
        ...manifest.installed.map((i) => this.registry.get(i.name)).filter(Boolean),
        ...installed.map((i) => this.registry.get(i.name)).filter(Boolean),
      ];
      const compat = this.validateCompatibility(allPackages);
      if (compat.warnings.length > 0) {
        warnings.push(...compat.warnings);
      }
    }

    return { installed, citations: newCitations, warnings };
  }

  /**
   * Search the registry by query string and optional filters.
   *
   * @param {string} query
   * @param {object} [filters]
   * @param {string} [filters.category]
   * @param {string[]} [filters.tags]
   * @param {string} [filters.creator]
   * @param {string} [filters.validationStatus]
   * @returns {object[]}
   */
  search(query, filters = {}) {
    const q = (query || "").toLowerCase();
    const results = [];

    for (const [, pkg] of this.registry) {
      let score = 0;

      // Name match
      if (pkg.name.toLowerCase().includes(q)) score += 10;
      // Description match
      if (pkg.description.toLowerCase().includes(q)) score += 5;
      // Tag match
      if (pkg.tags && pkg.tags.some((t) => t.toLowerCase().includes(q))) score += 7;
      // Category match
      if (pkg.category && pkg.category.toLowerCase().includes(q)) score += 6;

      if (score === 0) continue;

      // Apply filters
      if (filters.category && pkg.category !== filters.category) continue;
      if (filters.creator && pkg.creator !== filters.creator) continue;
      if (filters.validationStatus && pkg.validationStatus !== filters.validationStatus) continue;
      if (filters.tags && filters.tags.length > 0) {
        const hasAll = filters.tags.every((ft) => pkg.tags.includes(ft));
        if (!hasAll) continue;
      }

      results.push({ ...pkg, _score: score });
    }

    results.sort((a, b) => b._score - a._score || b.downloads - a.downloads);
    return results.map(({ _score, ...rest }) => rest);
  }

  /**
   * Publish a new package to the registry.
   *
   * @param {object} packageMeta - Package metadata (name, version, creator, description, category, tags, dependencies, performance)
   * @param {object} dtu - The DTU document to publish
   * @returns {{ success: boolean, package?: object, error?: string }}
   */
  publish(packageMeta, dtu) {
    if (!packageMeta || !packageMeta.name) {
      return { success: false, error: "Package name is required" };
    }
    if (!dtu || !dtu.content) {
      return { success: false, error: "Valid DTU document is required" };
    }

    // Check name availability
    if (this.registry.has(packageMeta.name)) {
      const existing = this.registry.get(packageMeta.name);
      if (existing.creator !== packageMeta.creator) {
        return { success: false, error: `Package '${packageMeta.name}' is owned by '${existing.creator}'` };
      }
      // Same creator: version bump
      if (semverCompare(packageMeta.version, existing.version) <= 0) {
        return { success: false, error: `Version ${packageMeta.version} must be greater than ${existing.version}` };
      }
    }

    // Validate DTU has required fields
    if (!dtu.$schema && !dtu.dtuVersion) {
      return { success: false, error: "DTU must have $schema or dtuVersion field" };
    }

    // Generate content hash for the DTU
    const contentHash = createHash("sha256")
      .update(JSON.stringify(dtu.content || {}))
      .digest("hex");

    const pkg = {
      name: packageMeta.name,
      version: packageMeta.version || "1.0.0",
      creator: packageMeta.creator || "anonymous",
      description: packageMeta.description || "",
      dtuId: dtu.id || `dtu_${contentHash.slice(0, 16)}`,
      category: packageMeta.category || "general",
      tags: packageMeta.tags || [],
      citations: 0,
      downloads: 0,
      validationStatus: "pending",
      validationExpires: null,
      dependencies: packageMeta.dependencies || {},
      performance: packageMeta.performance || {},
      publishedAt: nowISO(),
      contentHash,
    };

    this.registry.set(pkg.name, pkg);
    this.log("cpm", `Published ${pkg.name}@${pkg.version} by ${pkg.creator}`);

    return { success: true, package: pkg };
  }

  /**
   * Recursively resolve all dependencies for a package.
   *
   * @param {string} packageName
   * @param {Set} [visited] - Cycle detection set
   * @param {string[]} [order] - Topological install order
   * @returns {{ order: string[], error?: string }}
   */
  resolve(packageName, visited = new Set(), order = []) {
    if (visited.has(packageName)) {
      return { order, error: null }; // Already resolved
    }

    const pkg = this.registry.get(packageName);
    if (!pkg) {
      return { order, error: `Package '${packageName}' not found in registry` };
    }

    visited.add(packageName);

    // Resolve dependencies first (depth-first)
    const deps = pkg.dependencies || {};
    for (const [depName, depRange] of Object.entries(deps)) {
      const depPkg = this.registry.get(depName);
      if (!depPkg) {
        return { order, error: `Dependency '${depName}' required by '${packageName}' not found` };
      }
      if (!semverSatisfies(depPkg.version, depRange)) {
        return {
          order,
          error: `Dependency '${depName}@${depPkg.version}' does not satisfy range '${depRange}' required by '${packageName}'`,
        };
      }

      const sub = this.resolve(depName, visited, order);
      if (sub.error) return sub;
    }

    order.push(packageName);
    return { order, error: null };
  }

  /**
   * Check compatibility between a set of packages.
   *
   * @param {object[]} packages - Array of package objects
   * @returns {{ compatible: boolean, warnings: string[] }}
   */
  validateCompatibility(packages) {
    const warnings = [];
    const categoryCounts = {};

    for (const pkg of packages) {
      const cat = pkg.category || "general";
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      const rules = COMPATIBILITY_RULES[cat];
      if (!rules) continue;

      // Check max per project
      if (rules.maxPerProject && categoryCounts[cat] > rules.maxPerProject) {
        warnings.push(
          `Category '${cat}' allows max ${rules.maxPerProject} package(s), found ${categoryCounts[cat]}`
        );
      }

      // Check required categories are present
      for (const req of rules.requires) {
        const hasReq = packages.some((p) => p.category === req);
        if (!hasReq) {
          warnings.push(
            `Package '${pkg.name}' (${cat}) requires a '${req}' category package`
          );
        }
      }

      // Check conflicts
      for (const conflict of rules.conflicts) {
        const hasConflict = packages.some((p) => p.category === conflict);
        if (hasConflict) {
          warnings.push(
            `Package '${pkg.name}' (${cat}) conflicts with '${conflict}' category`
          );
        }
      }
    }

    return { compatible: warnings.length === 0, warnings };
  }

  /**
   * Audit installed packages for expired validations and superseded versions.
   *
   * @param {object} manifest - Project manifest with installed packages
   * @returns {{ issues: object[], clean: boolean }}
   */
  audit(manifest) {
    const issues = [];
    const installed = (manifest && manifest.installed) || [];
    const now = new Date();

    for (const entry of installed) {
      const pkg = this.registry.get(entry.name);
      if (!pkg) {
        issues.push({ name: entry.name, severity: "error", message: "Package not found in registry" });
        continue;
      }

      // Check for newer version
      if (semverCompare(pkg.version, entry.version) > 0) {
        issues.push({
          name: entry.name,
          severity: "warn",
          message: `Update available: ${entry.version} -> ${pkg.version}`,
          currentVersion: entry.version,
          latestVersion: pkg.version,
        });
      }

      // Check validation expiration
      if (pkg.validationExpires && new Date(pkg.validationExpires) < now) {
        issues.push({
          name: entry.name,
          severity: "error",
          message: `Validation expired on ${pkg.validationExpires}`,
        });
      }

      // Check validation status
      if (pkg.validationStatus === "revoked" || pkg.validationStatus === "suspended") {
        issues.push({
          name: entry.name,
          severity: "critical",
          message: `Package validation is ${pkg.validationStatus}`,
        });
      }
    }

    return { issues, clean: issues.length === 0 };
  }

  /**
   * Get full details for a package.
   *
   * @param {string} packageName
   * @returns {object|null}
   */
  info(packageName) {
    const pkg = this.registry.get(packageName);
    if (!pkg) return null;

    // Enrich with citation stats
    const packageCitations = this.citations.filter((c) => c.packageName === packageName);
    return {
      ...pkg,
      citationHistory: packageCitations.slice(-20),
      dependents: this._findDependents(packageName),
    };
  }

  /**
   * Find all packages that depend on a given package.
   */
  _findDependents(packageName) {
    const dependents = [];
    for (const [name, pkg] of this.registry) {
      if (pkg.dependencies && packageName in pkg.dependencies) {
        dependents.push({ name, version: pkg.version, range: pkg.dependencies[packageName] });
      }
    }
    return dependents;
  }

  /**
   * List installed packages from a manifest, optionally as a dependency tree.
   *
   * @param {object} manifest - Project manifest
   * @param {object} [opts]
   * @param {boolean} [opts.tree] - Show dependency tree
   * @returns {object[]}
   */
  list(manifest, opts = {}) {
    const installed = (manifest && manifest.installed) || [];
    if (!opts.tree) {
      return installed.map((entry) => {
        const pkg = this.registry.get(entry.name);
        return {
          name: entry.name,
          version: entry.version,
          installedAt: entry.installedAt,
          status: pkg ? pkg.validationStatus : "unknown",
        };
      });
    }

    // Build tree view
    return installed.map((entry) => {
      const pkg = this.registry.get(entry.name);
      const deps = pkg && pkg.dependencies ? Object.keys(pkg.dependencies) : [];
      return {
        name: entry.name,
        version: entry.version,
        status: pkg ? pkg.validationStatus : "unknown",
        dependencies: deps.map((d) => {
          const depPkg = this.registry.get(d);
          return { name: d, version: depPkg ? depPkg.version : "unknown" };
        }),
      };
    });
  }

  /**
   * Update a specific package or all packages in a manifest.
   *
   * @param {string|null} packageName - Specific package or null for all
   * @param {object} manifest - Project manifest
   * @returns {{ updated: object[], warnings: string[] }}
   */
  update(packageName, manifest) {
    const installed = (manifest && manifest.installed) || [];
    const updated = [];
    const warnings = [];

    const targets = packageName
      ? installed.filter((i) => i.name === packageName)
      : installed;

    if (packageName && targets.length === 0) {
      warnings.push(`Package '${packageName}' is not installed`);
      return { updated, warnings };
    }

    for (const entry of targets) {
      const pkg = this.registry.get(entry.name);
      if (!pkg) {
        warnings.push(`Package '${entry.name}' not found in registry`);
        continue;
      }

      if (semverCompare(pkg.version, entry.version) > 0) {
        const oldVersion = entry.version;
        entry.version = pkg.version;
        entry.updatedAt = nowISO();

        // Create citation for the update
        const citation = {
          id: uid("cite"),
          packageName: entry.name,
          packageVersion: pkg.version,
          creator: pkg.creator,
          dtuId: pkg.dtuId,
          installedAt: nowISO(),
          relationship: "update",
        };
        this.citations.push(citation);
        pkg.downloads = (pkg.downloads || 0) + 1;

        updated.push({
          name: entry.name,
          from: oldVersion,
          to: pkg.version,
        });
      }
    }

    if (updated.length === 0) {
      warnings.push("All packages are up to date");
    }

    return { updated, warnings };
  }

  /**
   * Create a new concord.manifest.json structure.
   *
   * @param {string} name - Project name
   * @param {string} creator - Creator identifier
   * @returns {object}
   */
  createManifest(name, creator) {
    return {
      $schema: "https://concord.dev/schemas/manifest/v1",
      name: name || "untitled-project",
      version: "0.1.0",
      creator: creator || "anonymous",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      concordVersion: ">=1.0.0",
      installed: [],
      citations: [],
      compatibility: {
        platform: "concord",
        minVersion: "1.0.0",
      },
      scripts: {
        validate: "cpm validate",
        audit: "cpm audit",
        build: "cpm build",
      },
    };
  }
}

module.exports = CpmManager;
