/**
 * Component Registry — Hosted Service for DTU Packages
 *
 * A centralized registry for publishing, discovering, and downloading
 * reusable DTU component packages. Engineers publish structural components,
 * material definitions, NPC templates, and quest templates. Other users
 * discover them via search, browse, or semantic query.
 *
 * Features:
 *   - Publish packages with metadata and validation
 *   - Search by keyword, category, material, citation count
 *   - Semantic search via natural language engineering queries
 *   - Trending packages by period
 *   - Deprecation and deletion lifecycle
 *   - Creator profiles and download statistics
 */

'use strict';

const crypto = require('crypto');

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = 'pkg') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Categories ──────────────────────────────────────────────────────────────

const CATEGORIES = Object.freeze([
  'structural',
  'foundation',
  'material',
  'mechanical',
  'electrical',
  'architectural',
  'npc-template',
  'quest-template',
  'environmental',
  'utility',
]);

// ── Seed Packages ───────────────────────────────────────────────────────────

function buildSeedPackages() {
  const now = nowISO();
  const seeds = [
    {
      name: 'steel-i-beam',
      version: '1.2.0',
      category: 'structural',
      description: 'Standard W-shape steel I-beam with AISC property tables.',
      creator: '@structural_eng',
      material: 'steel',
      tags: ['beam', 'steel', 'W-shape', 'AISC'],
      citations: 342,
      downloads: 8910,
    },
    {
      name: 'concrete-column-round',
      version: '2.0.1',
      category: 'structural',
      description: 'Reinforced concrete circular column with ACI 318 compliance.',
      creator: '@concrete_lab',
      material: 'concrete',
      tags: ['column', 'concrete', 'reinforced', 'ACI'],
      citations: 218,
      downloads: 5430,
    },
    {
      name: 'spread-footing',
      version: '1.0.0',
      category: 'foundation',
      description: 'Isolated spread footing for single column support.',
      creator: '@geotech_pro',
      material: 'concrete',
      tags: ['foundation', 'footing', 'spread', 'isolated'],
      citations: 156,
      downloads: 3200,
    },
    {
      name: 'mat-foundation',
      version: '1.1.0',
      category: 'foundation',
      description: 'Mat/raft foundation for distributed column loads on weak soils.',
      creator: '@geotech_pro',
      material: 'concrete',
      tags: ['foundation', 'mat', 'raft', 'soil'],
      citations: 89,
      downloads: 2100,
    },
    {
      name: 'cmu-shear-wall',
      version: '3.0.0',
      category: 'structural',
      description: 'Concrete masonry unit shear wall with grouted cells and rebar.',
      creator: '@masonry_guild',
      material: 'masonry',
      tags: ['wall', 'shear', 'masonry', 'CMU'],
      citations: 274,
      downloads: 6100,
    },
    {
      name: 'a992-steel',
      version: '1.0.0',
      category: 'material',
      description: 'ASTM A992 structural steel material properties and allowables.',
      creator: '@materials_db',
      material: 'steel',
      tags: ['material', 'steel', 'A992', 'ASTM'],
      citations: 510,
      downloads: 14200,
    },
    {
      name: 'c4000-concrete',
      version: '1.0.0',
      category: 'material',
      description: '4000 psi normal weight concrete with ACI mix design parameters.',
      creator: '@materials_db',
      material: 'concrete',
      tags: ['material', 'concrete', '4000psi', 'ACI'],
      citations: 398,
      downloads: 11800,
    },
    {
      name: 'blacksmith-npc',
      version: '2.1.0',
      category: 'npc-template',
      description: 'Blacksmith NPC template with trade dialog, inventory, and upgrade tree.',
      creator: '@quest_forge',
      material: null,
      tags: ['npc', 'blacksmith', 'trade', 'crafting'],
      citations: 67,
      downloads: 1890,
    },
    {
      name: 'fetch-quest',
      version: '1.3.0',
      category: 'quest-template',
      description: 'Generic fetch/retrieve quest template with configurable objectives.',
      creator: '@quest_forge',
      material: null,
      tags: ['quest', 'fetch', 'retrieve', 'template'],
      citations: 45,
      downloads: 1200,
    },
    {
      name: 'escort-quest',
      version: '1.0.0',
      category: 'quest-template',
      description: 'Escort mission quest template with waypoints and threat encounters.',
      creator: '@quest_forge',
      material: null,
      tags: ['quest', 'escort', 'mission', 'template'],
      citations: 32,
      downloads: 890,
    },
  ];

  const map = new Map();
  for (const seed of seeds) {
    const key = `${seed.name}@${seed.version}`;
    map.set(key, {
      id: uid('pkg'),
      name: seed.name,
      version: seed.version,
      category: seed.category,
      description: seed.description,
      creator: seed.creator,
      material: seed.material,
      tags: seed.tags,
      citations: seed.citations,
      downloads: seed.downloads,
      deprecated: false,
      deprecationReason: null,
      publishedAt: now,
      updatedAt: now,
    });
  }
  return map;
}

// ── Component Registry ──────────────────────────────────────────────────────

class ComponentRegistry {
  constructor() {
    this.packages = buildSeedPackages();
    this.downloadLog = [];
  }

  /**
   * Publish a new package to the registry.
   * @param {object} packageMeta
   * @returns {object} published package record
   */
  publish(packageMeta) {
    const { name, version, category, description, creator } = packageMeta || {};

    if (!name || typeof name !== 'string') {
      return { ok: false, error: 'Package name is required.' };
    }
    if (!version || typeof version !== 'string') {
      return { ok: false, error: 'Version is required (semver string).' };
    }
    if (!creator || typeof creator !== 'string') {
      return { ok: false, error: 'Creator handle is required.' };
    }

    const key = `${name}@${version}`;
    if (this.packages.has(key)) {
      return { ok: false, error: `Package ${key} already exists. Bump the version to publish an update.` };
    }

    if (category && !CATEGORIES.includes(category)) {
      return { ok: false, error: `Invalid category "${category}". Must be one of: ${CATEGORIES.join(', ')}` };
    }

    const now = nowISO();
    const record = {
      id: uid('pkg'),
      name,
      version,
      category: category || 'utility',
      description: description || '',
      creator,
      material: packageMeta.material || null,
      tags: Array.isArray(packageMeta.tags) ? packageMeta.tags : [],
      citations: 0,
      downloads: 0,
      deprecated: false,
      deprecationReason: null,
      publishedAt: now,
      updatedAt: now,
    };

    this.packages.set(key, record);
    return { ok: true, package: record };
  }

  /**
   * Get a specific package by name and version.
   * @param {string} name
   * @param {string} version
   * @returns {object|null}
   */
  get(name, version) {
    if (!version) {
      // Return latest version
      const matches = [];
      for (const [key, pkg] of this.packages) {
        if (pkg.name === name) matches.push(pkg);
      }
      if (matches.length === 0) return null;
      matches.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      return matches[0];
    }
    return this.packages.get(`${name}@${version}`) || null;
  }

  /**
   * Search packages by structured parameters.
   * @param {object} params — query, category, minCitations, material, sortBy, page, pageSize
   * @returns {object} { results, total, page, pageSize }
   */
  search(params = {}) {
    const { query, category, minCitations, material, sortBy, page = 1, pageSize = 20 } = params;
    let results = Array.from(this.packages.values());

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(pkg =>
        pkg.name.toLowerCase().includes(q) ||
        pkg.description.toLowerCase().includes(q) ||
        pkg.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (category) {
      results = results.filter(pkg => pkg.category === category);
    }

    if (typeof minCitations === 'number') {
      results = results.filter(pkg => pkg.citations >= minCitations);
    }

    if (material) {
      results = results.filter(pkg => pkg.material === material);
    }

    results = results.filter(pkg => !pkg.deprecated);

    // Sort
    switch (sortBy) {
      case 'citations':
        results.sort((a, b) => b.citations - a.citations);
        break;
      case 'downloads':
        results.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'recent':
        results.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        break;
      default:
        results.sort((a, b) => b.citations - a.citations);
    }

    const total = results.length;
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return { results: paged, total, page, pageSize };
  }

  /**
   * Parse a natural language engineering query into structured requirements
   * and return matching packages.
   * @param {string} naturalQuery
   * @returns {object}
   */
  semanticSearch(naturalQuery) {
    if (!naturalQuery || typeof naturalQuery !== 'string') {
      return { ok: false, error: 'A natural language query string is required.' };
    }

    const q = naturalQuery.toLowerCase();
    const requirements = { materials: [], categories: [], keywords: [] };

    // Material detection
    const materialMap = { steel: 'steel', concrete: 'concrete', masonry: 'masonry', timber: 'timber', wood: 'timber' };
    for (const [keyword, mat] of Object.entries(materialMap)) {
      if (q.includes(keyword)) requirements.materials.push(mat);
    }

    // Category detection
    const categoryMap = {
      beam: 'structural', column: 'structural', wall: 'structural',
      foundation: 'foundation', footing: 'foundation',
      material: 'material', npc: 'npc-template', quest: 'quest-template',
    };
    for (const [keyword, cat] of Object.entries(categoryMap)) {
      if (q.includes(keyword)) requirements.categories.push(cat);
    }

    // Keyword extraction
    const stopWords = new Set(['i', 'need', 'a', 'an', 'the', 'for', 'with', 'that', 'can', 'of', 'to', 'in', 'and', 'or', 'my']);
    const keywords = q.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
    requirements.keywords = keywords;

    // Match packages
    let results = Array.from(this.packages.values()).filter(pkg => !pkg.deprecated);
    const scored = results.map(pkg => {
      let score = 0;
      if (requirements.materials.length && requirements.materials.includes(pkg.material)) score += 3;
      if (requirements.categories.length && requirements.categories.includes(pkg.category)) score += 2;
      for (const kw of requirements.keywords) {
        if (pkg.name.includes(kw)) score += 2;
        if (pkg.description.toLowerCase().includes(kw)) score += 1;
        if (pkg.tags.some(t => t.toLowerCase().includes(kw))) score += 1;
      }
      return { package: pkg, relevanceScore: score };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const matches = scored.filter(s => s.relevanceScore > 0).slice(0, 10);

    return {
      ok: true,
      query: naturalQuery,
      parsedRequirements: requirements,
      results: matches,
      total: matches.length,
    };
  }

  /**
   * Browse packages by category.
   * @param {string} category
   * @returns {object[]}
   */
  browse(category) {
    if (!category) return { categories: CATEGORIES };
    return Array.from(this.packages.values())
      .filter(pkg => pkg.category === category && !pkg.deprecated)
      .sort((a, b) => b.citations - a.citations);
  }

  /**
   * Get trending packages within a time period.
   * @param {string} period — 'day', 'week', 'month'
   * @returns {object[]}
   */
  trending(period = 'week') {
    const periodMs = { day: 86400000, week: 604800000, month: 2592000000 };
    const cutoff = Date.now() - (periodMs[period] || periodMs.week);
    const cutoffISO = new Date(cutoff).toISOString();

    // For seed data we use all packages; in production this would filter by download log
    const results = Array.from(this.packages.values())
      .filter(pkg => !pkg.deprecated)
      .sort((a, b) => (b.citations + b.downloads) - (a.citations + a.downloads))
      .slice(0, 20);

    return { period, results };
  }

  /**
   * Get all packages by a creator handle.
   * @param {string} handle
   * @returns {object[]}
   */
  getByCreator(handle) {
    if (!handle) return [];
    return Array.from(this.packages.values())
      .filter(pkg => pkg.creator === handle)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  /**
   * Mark a package version as deprecated.
   * @param {string} name
   * @param {string} version
   * @param {string} reason
   * @returns {object}
   */
  deprecate(name, version, reason) {
    const key = `${name}@${version}`;
    const pkg = this.packages.get(key);
    if (!pkg) return { ok: false, error: `Package ${key} not found.` };

    pkg.deprecated = true;
    pkg.deprecationReason = reason || 'No reason provided.';
    pkg.updatedAt = nowISO();
    return { ok: true, package: pkg };
  }

  /**
   * Delete a package (creator-only operation).
   * @param {string} name
   * @param {string} version
   * @param {string} userId — must match the creator handle
   * @returns {object}
   */
  delete(name, version, userId) {
    const key = `${name}@${version}`;
    const pkg = this.packages.get(key);
    if (!pkg) return { ok: false, error: `Package ${key} not found.` };
    if (pkg.creator !== userId) {
      return { ok: false, error: 'Only the package creator can delete it.' };
    }

    this.packages.delete(key);
    return { ok: true, deleted: key };
  }

  /**
   * Get registry-wide statistics.
   * @returns {object}
   */
  getStats() {
    const all = Array.from(this.packages.values());
    const totalDownloads = all.reduce((sum, p) => sum + p.downloads, 0);
    const creatorMap = {};
    for (const pkg of all) {
      if (!creatorMap[pkg.creator]) creatorMap[pkg.creator] = { handle: pkg.creator, packages: 0, totalCitations: 0 };
      creatorMap[pkg.creator].packages += 1;
      creatorMap[pkg.creator].totalCitations += pkg.citations;
    }
    const topCreators = Object.values(creatorMap)
      .sort((a, b) => b.totalCitations - a.totalCitations)
      .slice(0, 10);

    return {
      totalPackages: all.length,
      totalDownloads,
      categories: CATEGORIES,
      topCreators,
    };
  }
}

module.exports = ComponentRegistry;
