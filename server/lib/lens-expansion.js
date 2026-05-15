/**
 * Lens Expansion Engine — Batch registration of new domain lenses
 *
 * Uses the Lens Developer Kit (server/lib/lens-developer-kit.js)
 * to register new domains in batch. Each new lens gets:
 *   1. Registration in the lens manifest
 *   2. 10 seed DTUs generated via conscious brain (fallback: template)
 *   3. An entity tutor spawned for the domain
 *
 * This is System 8 of the Concord Educational Engine. It intentionally
 * never throws — every failure is captured into a result entry so that
 * partial expansions are still useful.
 */

import { TASK_PROMPTS } from "./prompt-registry.js";

/**
 * Full catalog of expansion domains grouped by category. The lens expansion
 * engine iterates this map to seed 225+ new lenses in batch.
 *
 * @type {Record<string, string[]>}
 */
export const EXPANSION_DOMAINS = {
  medical: [
    "neurology", "cardiology", "oncology", "psychiatry",
    "dermatology", "pediatrics", "geriatrics", "immunology",
    "endocrinology", "gastroenterology", "radiology",
    "anesthesiology", "orthopedics", "urology", "nephrology",
  ],
  physics: [
    "particle-physics", "condensed-matter", "astrophysics",
    "cosmology", "plasma-physics", "biophysics", "fluid-dynamics",
    "thermodynamics", "statistical-mechanics", "qed", "qcd",
    "string-theory",
  ],
  chemistry: [
    "organic-chem", "inorganic-chem", "biochem", "analytical-chem",
    "physical-chem", "polymer-chem", "medicinal-chem", "electrochem",
    "nuclear-chem", "surface-chem", "green-chem", "computational-chem",
    "photochem", "supramolecular-chem",
  ],
  mathematics: [
    "topology", "number-theory", "algebraic-geometry",
    "differential-equations", "probability", "statistics",
    "combinatorics", "logic", "category-theory", "set-theory",
    "real-analysis", "complex-analysis", "functional-analysis",
    "differential-geometry", "graph-theory", "numerical-analysis",
    "game-theory", "measure-theory",
  ],
  trades: [
    "hvac-specialist", "electrician-advanced", "plumber-advanced",
    "carpenter-advanced", "mason-advanced", "welder",
    "machinist", "auto-mechanic", "aircraft-mechanic",
    "diesel-mechanic", "locksmith", "glazier", "roofer",
    "drywall", "tile-setter", "painter-finisher",
    "heavy-equipment", "crane-operator", "ironworker",
    "elevator-technician",
  ],
  arts: [
    "ballet", "modern-dance", "hip-hop-dance", "sculpture",
    "ceramics", "glassblowing", "metalwork", "jewelry",
    "fashion-design", "interior-design", "industrial-design",
    "graphic-design", "ux-design", "typography", "calligraphy",
    "illustration", "voice-acting", "sound-design", "foley",
    "stage-lighting", "stage-management", "directing",
    "cinematography", "screenwriting", "playwriting",
  ],
  languages: [
    "spanish", "mandarin", "arabic", "hindi", "french",
    "portuguese", "russian", "japanese", "korean", "german",
    "italian", "turkish", "vietnamese", "thai", "swahili",
    "hebrew", "persian", "polish", "dutch", "greek",
    "latin", "sanskrit", "classical-chinese", "ancient-greek",
    "biblical-hebrew", "sumerian", "old-english",
    "rust-lang", "go-lang", "swift-lang", "kotlin-lang",
    "scala-lang", "haskell-lang", "erlang-lang", "elixir-lang",
    "julia-lang", "r-lang", "lua-lang", "zig-lang",
  ],
  music: [
    "jazz-theory", "blues", "funk", "soul", "gospel",
    "hip-hop-production", "trap-production", "lo-fi",
    "classical-composition", "orchestration", "opera",
    "electronic-production", "house-music", "techno", "drum-and-bass",
    "dubstep", "ambient-music", "noise-music", "industrial-music",
    "metal-theory", "progressive-rock", "psychedelic",
    "afrobeat", "reggae", "dancehall", "bossa-nova",
    "flamenco", "indian-classical", "gamelan", "tuvan-throat",
    "musical-set-theory", "spectral-composition",
    "algorithmic-composition", "psychoacoustics",
  ],
  philosophy: [
    "stoicism", "buddhism-phil", "existentialism", "phenomenology",
    "analytic-philosophy", "pragmatism", "continental-philosophy",
    "confucianism", "taoism", "vedanta", "ubuntu-philosophy",
    "absurdism", "nihilism", "ethics-applied", "aesthetics",
    "philosophy-of-mind", "philosophy-of-science",
    "philosophy-of-language", "political-philosophy",
    "philosophy-of-mathematics",
  ],
  wellness: [
    "meditation", "karate", "judo", "muay-thai", "bjj",
    "capoeira", "yoga-hatha", "yoga-ashtanga", "breathwork",
    "sleep-science", "circadian-optimization", "cold-therapy",
    "movement-therapy", "nutrition-science", "fasting",
    "tai-chi", "qigong", "pilates", "aikido", "kendo",
    "wing-chun", "krav-maga", "parkour", "functional-movement",
    "stretching-science", "mobility-training", "breath-hold-training",
    "heat-therapy", "hydrotherapy", "somatics",
  ],
};

/** Default rate limit (ms) between individual lens expansions. */
const DEFAULT_RATE_LIMIT_MS = 25;

/** Default number of seed DTUs per domain. */
const DEFAULT_SEED_COUNT = 10;

/**
 * The Lens Expansion Engine — batch registers new lenses, seeds their DTU
 * corpus, and spawns an entity tutor for each.
 */
export class LensExpansionEngine {
  /**
   * @param {object} [deps]
   * @param {object} [deps.lensDeveloperKit] — LDK module (exports publishLens, etc.)
   * @param {object} [deps.brainService]     — Conscious brain service for seed DTU generation
   * @param {object} [deps.dtuStore]         — DTU persistence layer
   * @param {object} [deps.entitySystem]     — Entity tutor spawn system
   * @param {object} [deps.lensManifest]     — Lens manifest module (registerUserLens, hasManifest)
   * @param {number} [deps.rateLimitMs]      — Delay between lens expansions
   */
  constructor({
    lensDeveloperKit,
    brainService,
    dtuStore,
    entitySystem,
    lensManifest,
    rateLimitMs = DEFAULT_RATE_LIMIT_MS,
  } = {}) {
    this.ldk = lensDeveloperKit || null;
    this.brainService = brainService || null;
    this.dtuStore = dtuStore || null;
    this.entitySystem = entitySystem || null;
    this.lensManifest = lensManifest || null;
    this.rateLimitMs = Math.max(0, rateLimitMs | 0);
    /** @type {Set<string>} domains already expanded */
    this.expanded = new Set();
  }

  /**
   * Expand every domain within a category.
   *
   * @param {string} category — Key from EXPANSION_DOMAINS
   * @returns {Promise<{category: string, expanded: number, results: object[]}>}
   */
  async expandCategory(category) {
    const domains = EXPANSION_DOMAINS[category] || [];
    const results = [];
    for (const domain of domains) {
      try {
        const r = await this.expandLens(domain, category);
        results.push(r);
      } catch (err) {
        results.push({
          domain,
          status: "error",
          error: err && err.message ? err.message : String(err),
        });
      }
      if (this.rateLimitMs > 0) {
        await this._sleep(this.rateLimitMs);
      }
    }
    return { category, expanded: results.length, results };
  }

  /**
   * Expand every category in sequence with rate limiting between them.
   *
   * @returns {Promise<{categories: object[], totalDomains: number, totalExpanded: number}>}
   */
  async expandAll() {
    const categories = [];
    let totalDomains = 0;
    let totalExpanded = 0;
    for (const category of Object.keys(EXPANSION_DOMAINS)) {
      try {
        const result = await this.expandCategory(category);
        categories.push(result);
        totalDomains += (EXPANSION_DOMAINS[category] || []).length;
        totalExpanded += result.results.filter(r => r.status === "expanded" || r.status === "already-expanded").length;
      } catch (err) {
        categories.push({
          category,
          expanded: 0,
          results: [],
          error: err && err.message ? err.message : String(err),
        });
      }
      // Inter-category pause (longer than per-lens pause) to let the registry settle.
      if (this.rateLimitMs > 0) {
        await this._sleep(this.rateLimitMs * 4);
      }
    }
    return { categories, totalDomains, totalExpanded };
  }

  /**
   * Expand a single lens: register via LDK, seed DTUs, spawn tutor.
   *
   * @param {string} domain   — Domain slug (e.g. "neurology")
   * @param {string} category — Category key (e.g. "medical")
   * @returns {Promise<{domain: string, status: string, seedDTUs?: number, tutor?: object|null, error?: string}>}
   */
  async expandLens(domain, category) {
    try {
      if (!domain || typeof domain !== "string") {
        return { domain: String(domain), status: "error", error: "invalid domain" };
      }

      // 1. Already expanded?
      if (this.expanded.has(domain)) {
        return { domain, status: "already-expanded", seedDTUs: 0, tutor: null };
      }

      // 2. Register via LDK / lens manifest.
      const manifest = {
        lensId: domain,
        domain,
        name: this.formatDomainName(domain),
        description: `${this.formatDomainName(domain)} lens (${category})`,
        category,
        tags: [category, domain],
        icon: this.getIconForCategory(category),
        color: this.getColorForCategory(category),
        source: "expansion",
      };

      let registered = false;
      try {
        if (this.lensManifest && typeof this.lensManifest.registerUserLens === "function") {
          // Skip if already present
          if (typeof this.lensManifest.hasManifest === "function" && this.lensManifest.hasManifest(domain)) {
            registered = true;
          } else {
            this.lensManifest.registerUserLens(manifest);
            registered = true;
          }
        }
      } catch (err) {
        // Non-fatal: fall through and still try seeds/tutor.
      }

      // 3. Generate seed DTUs.
      let seedDTUs = 0;
      try {
        const seeds = await this.generateSeedDTUs(domain, DEFAULT_SEED_COUNT);
        seedDTUs = Array.isArray(seeds) ? seeds.length : 0;
      } catch {
        seedDTUs = 0;
      }

      // 4. Spawn entity tutor.
      let tutor = null;
      try {
        tutor = await this.spawnTutorForDomain(domain);
      } catch {
        tutor = null;
      }

      this.expanded.add(domain);

      return {
        domain,
        status: "expanded",
        category,
        registered,
        seedDTUs,
        tutor,
      };
    } catch (err) {
      return {
        domain,
        status: "error",
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  /**
   * Generate seed DTUs for a newly expanded domain.
   *
   * Prefers the conscious brain service; falls back to template-generated
   * skeletons if the brain is unavailable or rejects the request.
   *
   * @param {string} domain
   * @param {number} [count=10]
   * @returns {Promise<object[]>}
   */
  async generateSeedDTUs(domain, count = DEFAULT_SEED_COUNT) {
    const n = Math.max(1, Math.min(50, count | 0));
    const seeds = [];
    const name = this.formatDomainName(domain);

    // Try conscious brain first.
    if (this.brainService && typeof this.brainService.generate === "function") {
      try {
        const response = await this.brainService.generate({
          brain: "conscious",
          prompt: `Generate ${n} seed learning units for the domain "${name}". ` +
            `Each unit should be a short self-contained fact, procedure, or principle. ` +
            `Return as a JSON array of { title, body } objects.`,
          maxTokens: 1200,
        });
        const text = typeof response === "string" ? response : (response && response.text) || "";
        const parsed = this._safeParseJsonArray(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          for (const item of parsed.slice(0, n)) {
            seeds.push(this._buildSeedDTU(domain, item.title || `${name} seed`, item.body || String(item)));
          }
        }
      } catch {
        // Fall through to template.
      }
    }

    // Template fallback: generate N skeleton seeds.
    if (seeds.length === 0) {
      for (let i = 0; i < n; i++) {
        seeds.push(
          this._buildSeedDTU(
            domain,
            `${name} — foundations ${i + 1}`,
            `Seed learning unit ${i + 1} for ${name}. This is a template placeholder ` +
              `that the conscious brain will elaborate on subsequent passes.`
          )
        );
      }
    }

    // Persist if a store is available.
    if (this.dtuStore && typeof this.dtuStore.put === "function") {
      for (const seed of seeds) {
        try {
          this.dtuStore.put(seed);
        } catch {
          // ignore individual put failures
        }
      }
    } else if (this.dtuStore && typeof this.dtuStore.insert === "function") {
      for (const seed of seeds) {
        try {
          this.dtuStore.insert(seed);
        } catch {
          // ignore
        }
      }
    }

    return seeds;
  }

  /**
   * Spawn an entity tutor for a domain via the entity system.
   *
   * @param {string} domain
   * @returns {Promise<object|null>}
   */
  async spawnTutorForDomain(domain) {
    const name = this.formatDomainName(domain);
    const spec = {
      kind: "tutor",
      role: "tutor",
      domain,
      name: `${name} Tutor`,
      description: `Autonomous tutor for the ${name} domain.`,
      persona: TASK_PROMPTS.patientTutor({ name }),
    };

    if (!this.entitySystem) {
      return { ...spec, spawned: false };
    }

    try {
      if (typeof this.entitySystem.spawnTutor === "function") {
        const r = await this.entitySystem.spawnTutor(spec);
        return r || { ...spec, spawned: true };
      }
      if (typeof this.entitySystem.spawn === "function") {
        const r = await this.entitySystem.spawn(spec);
        return r || { ...spec, spawned: true };
      }
      if (typeof this.entitySystem.create === "function") {
        const r = await this.entitySystem.create(spec);
        return r || { ...spec, spawned: true };
      }
    } catch {
      return { ...spec, spawned: false };
    }
    return { ...spec, spawned: false };
  }

  /**
   * Convert a kebab/snake slug to a display name.
   * @param {string} slug
   * @returns {string}
   */
  formatDomainName(slug) {
    if (!slug) return "";
    return String(slug)
      .replace(/[-_]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /**
   * Suggest an icon glyph for a category.
   * @param {string} category
   * @returns {string}
   */
  getIconForCategory(category) {
    const icons = {
      medical: "stethoscope",
      physics: "atom",
      chemistry: "flask",
      mathematics: "sigma",
      trades: "wrench",
      arts: "palette",
      languages: "globe",
      music: "music",
      philosophy: "scroll",
      wellness: "leaf",
    };
    return icons[category] || "book";
  }

  /**
   * Suggest a category color (hex).
   * @param {string} category
   * @returns {string}
   */
  getColorForCategory(category) {
    const colors = {
      medical: "#e74c3c",
      physics: "#3498db",
      chemistry: "#9b59b6",
      mathematics: "#2c3e50",
      trades: "#e67e22",
      arts: "#e91e63",
      languages: "#16a085",
      music: "#f39c12",
      philosophy: "#7f8c8d",
      wellness: "#27ae60",
    };
    return colors[category] || "#34495e";
  }

  /**
   * List every domain that has been expanded in this engine instance.
   * @returns {string[]}
   */
  listExpanded() {
    return [...this.expanded];
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Build a seed DTU envelope.
   * @private
   */
  _buildSeedDTU(domain, title, body) {
    const now = new Date().toISOString();
    return {
      id: `dtu-seed-${domain}-${Math.random().toString(36).slice(2, 10)}`,
      type: "seed",
      domain,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 4000),
      sources: [domain],
      createdAt: now,
      origin: "lens-expansion",
    };
  }

  /**
   * Parse a JSON array from model output, robust to code fences and prose.
   * @private
   */
  _safeParseJsonArray(text) {
    if (!text || typeof text !== "string") return null;
    // Try direct parse first.
    try {
      const direct = JSON.parse(text);
      if (Array.isArray(direct)) return direct;
    } catch {
      // continue
    }
    // Extract first [...] block.
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // continue
      }
    }
    return null;
  }

  /** @private */
  _sleep(ms) {
    return new Promise(resolve => { setTimeout(resolve, ms); });
  }
}

/**
 * Factory for the LensExpansionEngine.
 *
 * @param {object} [deps]
 * @returns {LensExpansionEngine}
 */
export function createLensExpansionEngine(deps = {}) {
  return new LensExpansionEngine(deps);
}

export default {
  EXPANSION_DOMAINS,
  LensExpansionEngine,
  createLensExpansionEngine,
};
