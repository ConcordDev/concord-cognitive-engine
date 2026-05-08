/**
 * Concord Lens — Knowledge Lens Creation Framework
 *
 * Define knowledge lenses with sections, data sources, interactive elements,
 * and DTU connections. A lens is a curated knowledge view that combines
 * educational content, live data, and hands-on interactive components.
 *
 * Features:
 *   - Create and publish lenses with structured sections
 *   - Seed lenses for core engineering domains
 *   - Add data sources, interactives, and DTU connections per section
 *   - Search and browse lenses by domain/tags
 *   - Engagement metrics per lens
 *   - Template generation for new lens creation
 */

'use strict';

const crypto = require('crypto');

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = 'lens') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Seed Lenses ─────────────────────────────────────────────────────────────

function buildSeedLenses() {
  const now = nowISO();
  const seeds = [
    {
      id: uid('lens'),
      name: 'Structural Engineering Fundamentals',
      slug: 'structural-engineering',
      domain: 'structural-engineering',
      description: 'Core concepts of structural analysis, load paths, and member design.',
      tags: ['structural', 'beams', 'columns', 'load-paths', 'engineering'],
      creator: '@struct_academy',
      status: 'published',
      sections: [
        {
          id: uid('sec'),
          title: 'Load Path Analysis',
          order: 1,
          learningOutcomes: [
            'Trace gravity loads from roof to foundation',
            'Identify lateral load resisting systems',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Beam Design',
          order: 2,
          learningOutcomes: [
            'Calculate bending moment and shear diagrams',
            'Select appropriate beam sections using AISC tables',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Column Buckling',
          order: 3,
          learningOutcomes: [
            'Apply Euler buckling formula for slender columns',
            'Determine effective length factors for various end conditions',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
      ],
    },
    {
      id: uid('lens'),
      name: 'Urban Planning Principles',
      slug: 'urban-planning',
      domain: 'urban-planning',
      description: 'Land use, zoning, transit-oriented development, and community design.',
      tags: ['urban', 'planning', 'zoning', 'transit', 'community'],
      creator: '@city_planner',
      status: 'published',
      sections: [
        {
          id: uid('sec'),
          title: 'Zoning and Land Use',
          order: 1,
          learningOutcomes: [
            'Classify land use types and zoning districts',
            'Evaluate mixed-use development impacts',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Transit-Oriented Development',
          order: 2,
          learningOutcomes: [
            'Design walkable neighborhoods around transit nodes',
            'Calculate ridership projections for new corridors',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
      ],
    },
    {
      id: uid('lens'),
      name: 'Materials Science Essentials',
      slug: 'materials-science',
      domain: 'materials-science',
      description: 'Properties, testing, and selection of engineering materials.',
      tags: ['materials', 'steel', 'concrete', 'composites', 'testing'],
      creator: '@materials_lab',
      status: 'published',
      sections: [
        {
          id: uid('sec'),
          title: 'Stress-Strain Behavior',
          order: 1,
          learningOutcomes: [
            'Interpret stress-strain curves for ductile and brittle materials',
            'Calculate modulus of elasticity and yield strength',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Concrete Mix Design',
          order: 2,
          learningOutcomes: [
            'Design concrete mixes for target compressive strength',
            'Understand water-cement ratio effects on durability',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
      ],
    },
    {
      id: uid('lens'),
      name: 'Marine Biology and Coastal Systems',
      slug: 'marine-biology',
      domain: 'marine-biology',
      description: 'Coastal ecosystems, marine organisms, and environmental engineering.',
      tags: ['marine', 'coastal', 'biology', 'ecosystems', 'environmental'],
      creator: '@ocean_institute',
      status: 'published',
      sections: [
        {
          id: uid('sec'),
          title: 'Coral Reef Dynamics',
          order: 1,
          learningOutcomes: [
            'Identify factors affecting coral reef health',
            'Model reef resilience under climate change scenarios',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Coastal Erosion and Protection',
          order: 2,
          learningOutcomes: [
            'Analyze wave action and sediment transport patterns',
            'Evaluate shoreline protection strategies',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
      ],
    },
    {
      id: uid('lens'),
      name: 'Electrical Engineering Foundations',
      slug: 'electrical-engineering',
      domain: 'electrical-engineering',
      description: 'Circuit analysis, power systems, and electrical safety.',
      tags: ['electrical', 'circuits', 'power', 'safety', 'engineering'],
      creator: '@circuits_lab',
      status: 'published',
      sections: [
        {
          id: uid('sec'),
          title: 'DC Circuit Analysis',
          order: 1,
          learningOutcomes: [
            'Apply Kirchhoff laws to solve series and parallel circuits',
            'Calculate power dissipation in resistive networks',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Power Distribution Systems',
          order: 2,
          learningOutcomes: [
            'Design single-line diagrams for building power systems',
            'Size transformers and conductors for given loads',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
        {
          id: uid('sec'),
          title: 'Electrical Safety and Grounding',
          order: 3,
          learningOutcomes: [
            'Implement grounding and bonding per NEC standards',
            'Identify arc flash hazards and PPE requirements',
          ],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        },
      ],
    },
  ];

  const map = new Map();
  for (const lens of seeds) {
    lens.createdAt = now;
    lens.updatedAt = now;
    lens.engagement = { views: Math.floor(Math.random() * 5000) + 200, completions: Math.floor(Math.random() * 800) + 50, dtusCreated: Math.floor(Math.random() * 120) + 5 };
    map.set(lens.id, lens);
  }
  return map;
}

// ── ConcordLens ─────────────────────────────────────────────────────────────

class ConcordLens {
  constructor() {
    this.lenses = buildSeedLenses();
  }

  /**
   * Create a new lens from a definition object.
   * @param {object} definition — name, domain, description, tags, creator, sections
   * @returns {object}
   */
  create(definition) {
    if (!definition || !definition.name) {
      return { ok: false, error: 'Lens name is required.' };
    }
    if (!definition.domain) {
      return { ok: false, error: 'Lens domain is required.' };
    }

    const now = nowISO();
    const lens = {
      id: uid('lens'),
      name: definition.name,
      slug: definition.slug || definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      domain: definition.domain,
      description: definition.description || '',
      tags: Array.isArray(definition.tags) ? definition.tags : [],
      creator: definition.creator || 'anonymous',
      status: 'draft',
      sections: [],
      createdAt: now,
      updatedAt: now,
      engagement: { views: 0, completions: 0, dtusCreated: 0 },
    };

    // Add initial sections if provided
    if (Array.isArray(definition.sections)) {
      for (let i = 0; i < definition.sections.length; i++) {
        const sec = definition.sections[i];
        lens.sections.push({
          id: uid('sec'),
          title: sec.title || `Section ${i + 1}`,
          order: i + 1,
          learningOutcomes: Array.isArray(sec.learningOutcomes) ? sec.learningOutcomes : [],
          dataSources: [],
          interactives: [],
          dtuConnections: [],
        });
      }
    }

    this.lenses.set(lens.id, lens);
    return { ok: true, lens };
  }

  /**
   * Publish a lens to the registry.
   * @param {string} lensId
   * @returns {object}
   */
  publish(lensId) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    if (lens.sections.length === 0) {
      return { ok: false, error: 'Cannot publish a lens with no sections.' };
    }

    lens.status = 'published';
    lens.updatedAt = nowISO();
    return { ok: true, lens };
  }

  /**
   * Get a lens by ID.
   * @param {string} lensId
   * @returns {object|null}
   */
  get(lensId) {
    return this.lenses.get(lensId) || null;
  }

  /**
   * Search lenses by name, domain, or tags.
   * @param {string} query
   * @returns {object[]}
   */
  search(query) {
    if (!query) return Array.from(this.lenses.values());
    const q = query.toLowerCase();

    return Array.from(this.lenses.values()).filter(lens =>
      lens.name.toLowerCase().includes(q) ||
      lens.domain.toLowerCase().includes(q) ||
      lens.description.toLowerCase().includes(q) ||
      lens.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Browse lenses by domain category.
   * @param {string} category — domain name
   * @returns {object[]}
   */
  browse(category) {
    if (!category) {
      const domains = new Set();
      for (const lens of this.lenses.values()) domains.add(lens.domain);
      return { domains: Array.from(domains) };
    }
    return Array.from(this.lenses.values())
      .filter(lens => lens.domain === category && lens.status === 'published');
  }

  /**
   * Add a knowledge section to a lens.
   * @param {string} lensId
   * @param {object} section — title, learningOutcomes
   * @returns {object}
   */
  addSection(lensId, section) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    const sec = {
      id: uid('sec'),
      title: section.title || 'Untitled Section',
      order: lens.sections.length + 1,
      learningOutcomes: Array.isArray(section.learningOutcomes) ? section.learningOutcomes : [],
      dataSources: [],
      interactives: [],
      dtuConnections: [],
    };

    lens.sections.push(sec);
    lens.updatedAt = nowISO();
    return { ok: true, section: sec };
  }

  /**
   * Add a data source to a section.
   * @param {string} lensId
   * @param {string} sectionId
   * @param {object} dataSource — name, type, url, description
   * @returns {object}
   */
  addDataSource(lensId, sectionId, dataSource) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    const section = lens.sections.find(s => s.id === sectionId);
    if (!section) return { ok: false, error: `Section ${sectionId} not found in lens.` };

    const ds = {
      id: uid('ds'),
      name: dataSource.name || 'Unnamed Source',
      type: dataSource.type || 'api',
      url: dataSource.url || null,
      description: dataSource.description || '',
      addedAt: nowISO(),
    };

    section.dataSources.push(ds);
    lens.updatedAt = nowISO();
    return { ok: true, dataSource: ds };
  }

  /**
   * Add an interactive element to a section.
   * @param {string} lensId
   * @param {string} sectionId
   * @param {object} interactive — name, type, config
   * @returns {object}
   */
  addInteractive(lensId, sectionId, interactive) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    const section = lens.sections.find(s => s.id === sectionId);
    if (!section) return { ok: false, error: `Section ${sectionId} not found in lens.` };

    const elem = {
      id: uid('int'),
      name: interactive.name || 'Unnamed Interactive',
      type: interactive.type || 'simulation',
      config: interactive.config || {},
      addedAt: nowISO(),
    };

    section.interactives.push(elem);
    lens.updatedAt = nowISO();
    return { ok: true, interactive: elem };
  }

  /**
   * Add a DTU connection to a section.
   * @param {string} lensId
   * @param {string} sectionId
   * @param {object} connection — dtuId, relationship, description
   * @returns {object}
   */
  addDTUConnection(lensId, sectionId, connection) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    const section = lens.sections.find(s => s.id === sectionId);
    if (!section) return { ok: false, error: `Section ${sectionId} not found in lens.` };

    const conn = {
      id: uid('conn'),
      dtuId: connection.dtuId || null,
      relationship: connection.relationship || 'reference',
      description: connection.description || '',
      addedAt: nowISO(),
    };

    section.dtuConnections.push(conn);
    lens.updatedAt = nowISO();
    return { ok: true, connection: conn };
  }

  /**
   * Get engagement metrics for a lens.
   * @param {string} lensId
   * @returns {object}
   */
  getEngagement(lensId) {
    const lens = this.lenses.get(lensId);
    if (!lens) return { ok: false, error: `Lens ${lensId} not found.` };

    return {
      lensId: lens.id,
      lensName: lens.name,
      views: lens.engagement.views,
      completions: lens.engagement.completions,
      dtusCreated: lens.engagement.dtusCreated,
      completionRate: lens.engagement.views > 0
        ? parseFloat(((lens.engagement.completions / lens.engagement.views) * 100).toFixed(1))
        : 0,
      sectionCount: lens.sections.length,
    };
  }

  /**
   * Return an empty lens template structure for new lens creation.
   * @returns {object}
   */
  getLensTemplate() {
    return {
      name: '',
      slug: '',
      domain: '',
      description: '',
      tags: [],
      creator: '',
      sections: [
        {
          title: '',
          learningOutcomes: [],
        },
      ],
    };
  }
}

module.exports = ConcordLens;
