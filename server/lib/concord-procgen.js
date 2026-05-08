/**
 * concord-procgen.js
 *
 * Procedural generation engine for Concord world content.
 * Generates NPCs, quests, terrain, relationships, and supporting data.
 */

'use strict';

// ── Name Pools ──────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'James', 'Maria', 'Robert', 'Linda', 'Michael', 'Patricia', 'William',
  'Elizabeth', 'David', 'Jennifer', 'Carlos', 'Aisha', 'Kenji', 'Fatima',
  'Andre', 'Mei', 'Omar', 'Priya', 'Dmitri', 'Yara', 'Tomasz', 'Ingrid',
  'Rafael', 'Suki', 'Hassan', 'Nia', 'Liam', 'Rosa', 'Ethan', 'Zara',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson',
];

// ── Personality Traits ──────────────────────────────────────────────────────

const PERSONALITY_TRAITS = [
  'stoic', 'jovial', 'cautious', 'reckless', 'generous', 'greedy',
  'curious', 'superstitious', 'patient', 'hot-tempered', 'witty',
  'melancholic', 'optimistic', 'secretive', 'loyal', 'cunning',
  'compassionate', 'ambitious', 'humble', 'paranoid',
];

// ── Occupation Templates ────────────────────────────────────────────────────

const OCCUPATION_TEMPLATES = {
  blacksmith: {
    title: 'Blacksmith',
    schedule: [
      { time: '05:00', activity: 'Wake and stoke forge' },
      { time: '06:00', activity: 'Begin metalwork orders' },
      { time: '09:00', activity: 'Open shop for customers' },
      { time: '12:00', activity: 'Midday meal and rest' },
      { time: '13:00', activity: 'Resume smithing' },
      { time: '17:00', activity: 'Clean tools and close shop' },
      { time: '19:00', activity: 'Tavern or home for evening' },
    ],
  },
  merchant: {
    title: 'Merchant',
    schedule: [
      { time: '06:00', activity: 'Inventory check and restocking' },
      { time: '07:00', activity: 'Open market stall' },
      { time: '10:00', activity: 'Negotiate with suppliers' },
      { time: '12:00', activity: 'Lunch break' },
      { time: '13:00', activity: 'Afternoon sales' },
      { time: '16:00', activity: 'Bookkeeping and ledger review' },
      { time: '18:00', activity: 'Close stall, secure goods' },
    ],
  },
  guard: {
    title: 'Guard',
    schedule: [
      { time: '06:00', activity: 'Morning drill and briefing' },
      { time: '07:00', activity: 'Gate watch duty' },
      { time: '12:00', activity: 'Shift change and meal' },
      { time: '13:00', activity: 'Patrol streets' },
      { time: '17:00', activity: 'Report to captain' },
      { time: '18:00', activity: 'Off-duty rest' },
      { time: '22:00', activity: 'Optional night watch rotation' },
    ],
  },
  farmer: {
    title: 'Farmer',
    schedule: [
      { time: '04:30', activity: 'Rise and tend livestock' },
      { time: '06:00', activity: 'Field work - planting or harvesting' },
      { time: '11:00', activity: 'Midday meal' },
      { time: '12:00', activity: 'Irrigate and weed' },
      { time: '16:00', activity: 'Bring in harvest to storage' },
      { time: '18:00', activity: 'Evening chores and supper' },
      { time: '20:00', activity: 'Rest' },
    ],
  },
  scholar: {
    title: 'Scholar',
    schedule: [
      { time: '07:00', activity: 'Morning study and reading' },
      { time: '09:00', activity: 'Lecture or seminar' },
      { time: '11:00', activity: 'Research in archives' },
      { time: '13:00', activity: 'Light lunch, continued reading' },
      { time: '15:00', activity: 'Correspondence and writing' },
      { time: '18:00', activity: 'Discussion groups' },
      { time: '21:00', activity: 'Late-night study' },
    ],
  },
  innkeeper: {
    title: 'Innkeeper',
    schedule: [
      { time: '05:00', activity: 'Prepare breakfast for guests' },
      { time: '08:00', activity: 'Clean rooms and common area' },
      { time: '11:00', activity: 'Receive new arrivals' },
      { time: '12:00', activity: 'Serve lunch' },
      { time: '15:00', activity: 'Restock supplies' },
      { time: '18:00', activity: 'Serve dinner and manage bar' },
      { time: '23:00', activity: 'Close up, tally receipts' },
    ],
  },
  builder: {
    title: 'Builder',
    schedule: [
      { time: '05:30', activity: 'Arrive at construction site' },
      { time: '06:00', activity: 'Heavy construction work' },
      { time: '10:00', activity: 'Material inspection' },
      { time: '12:00', activity: 'Lunch break' },
      { time: '13:00', activity: 'Afternoon building' },
      { time: '16:00', activity: 'Site cleanup' },
      { time: '17:00', activity: 'Review plans for tomorrow' },
    ],
  },
  librarian: {
    title: 'Librarian',
    schedule: [
      { time: '07:00', activity: 'Open library, shelve returns' },
      { time: '09:00', activity: 'Assist patrons with research' },
      { time: '11:00', activity: 'Catalog new acquisitions' },
      { time: '13:00', activity: 'Lunch and personal reading' },
      { time: '14:00', activity: 'Restore and repair old texts' },
      { time: '17:00', activity: 'Close library' },
      { time: '18:00', activity: 'Evening at home' },
    ],
  },
  dockworker: {
    title: 'Dockworker',
    schedule: [
      { time: '04:00', activity: 'Arrive at docks for first ship' },
      { time: '05:00', activity: 'Unload cargo' },
      { time: '08:00', activity: 'Sort and inventory goods' },
      { time: '12:00', activity: 'Meal break' },
      { time: '13:00', activity: 'Load outbound cargo' },
      { time: '16:00', activity: 'Secure dock area' },
      { time: '17:00', activity: 'Off-duty' },
    ],
  },
  healer: {
    title: 'Healer',
    schedule: [
      { time: '06:00', activity: 'Gather herbs and prepare remedies' },
      { time: '08:00', activity: 'Open clinic for patients' },
      { time: '12:00', activity: 'House calls for severe cases' },
      { time: '14:00', activity: 'Light meal and rest' },
      { time: '15:00', activity: 'Afternoon clinic hours' },
      { time: '18:00', activity: 'Clean instruments and restock' },
      { time: '20:00', activity: 'On-call for emergencies' },
    ],
  },
  baker: {
    title: 'Baker',
    schedule: [
      { time: '03:00', activity: 'Start ovens and mix dough' },
      { time: '05:00', activity: 'First batch of bread and pastries' },
      { time: '07:00', activity: 'Open shop, sell morning goods' },
      { time: '11:00', activity: 'Prepare lunch items' },
      { time: '14:00', activity: 'Afternoon baking' },
      { time: '16:00', activity: 'Close shop, clean kitchen' },
      { time: '17:00', activity: 'Rest and plan next day orders' },
    ],
  },
  tailor: {
    title: 'Tailor',
    schedule: [
      { time: '07:00', activity: 'Open workshop, review orders' },
      { time: '08:00', activity: 'Cutting and sewing garments' },
      { time: '10:00', activity: 'Customer fittings' },
      { time: '12:00', activity: 'Lunch' },
      { time: '13:00', activity: 'Embroidery and detail work' },
      { time: '16:00', activity: 'Fabric sourcing and inventory' },
      { time: '18:00', activity: 'Close workshop' },
    ],
  },
  jeweler: {
    title: 'Jeweler',
    schedule: [
      { time: '08:00', activity: 'Open shop, inspect gemstones' },
      { time: '09:00', activity: 'Precision metalwork and setting' },
      { time: '12:00', activity: 'Lunch' },
      { time: '13:00', activity: 'Customer consultations' },
      { time: '15:00', activity: 'Design new pieces' },
      { time: '17:00', activity: 'Polish finished items' },
      { time: '18:00', activity: 'Secure vault and close shop' },
    ],
  },
  courier: {
    title: 'Courier',
    schedule: [
      { time: '05:00', activity: 'Collect morning dispatches' },
      { time: '06:00', activity: 'First delivery route' },
      { time: '10:00', activity: 'Return for midday parcels' },
      { time: '12:00', activity: 'Lunch at waystation' },
      { time: '13:00', activity: 'Afternoon delivery route' },
      { time: '17:00', activity: 'Final pickups and drop-offs' },
      { time: '18:00', activity: 'Log deliveries, rest' },
    ],
  },
};

// ── Quest Themes ────────────────────────────────────────────────────────────

const QUEST_THEMES = [
  {
    key: 'escort',
    titleTemplates: ['Escort the {target} to {destination}', 'Safe Passage to {destination}'],
    objectiveCount: 3,
  },
  {
    key: 'retrieve',
    titleTemplates: ['Retrieve the Lost {artifact}', 'The Missing {artifact}'],
    objectiveCount: 4,
  },
  {
    key: 'defend',
    titleTemplates: ['Defend {location} from Raiders', 'Hold the Line at {location}'],
    objectiveCount: 3,
  },
  {
    key: 'investigate',
    titleTemplates: ['Mystery of the {phenomenon}', 'Investigate the {phenomenon}'],
    objectiveCount: 5,
  },
  {
    key: 'build',
    titleTemplates: ['Construct the {structure}', 'Raise the {structure}'],
    objectiveCount: 4,
  },
  {
    key: 'negotiate',
    titleTemplates: ['Broker Peace with the {faction}', 'The {faction} Accord'],
    objectiveCount: 3,
  },
];

// ── Utility Helpers ─────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = arr.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uid() {
  return 'pg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── ConcordProcGen Class ────────────────────────────────────────────────────

class ConcordProcGen {
  /**
   * @param {object} [options]
   * @param {number} [options.seed] - Reserved for future deterministic seeding.
   */
  constructor(options = {}) {
    this.options = options;
    this._greetingCache = new Map();
  }

  // ── Name Generation ─────────────────────────────────────────────────────

  /**
   * Generate an array of full names.
   * @param {number} count
   * @param {string} [culture] - Reserved for future culture packs.
   * @returns {string[]}
   */
  generateNames(count, culture) {
    const names = [];
    for (let i = 0; i < count; i++) {
      names.push(`${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`);
    }
    return names;
  }

  // ── Schedule Generation ─────────────────────────────────────────────────

  /**
   * Return the daily schedule for a given occupation key.
   * @param {string} occupation - One of the 14 occupation keys.
   * @returns {{ time: string, activity: string }[]}
   */
  generateSchedule(occupation) {
    const template = OCCUPATION_TEMPLATES[occupation];
    if (!template) {
      throw new Error(`Unknown occupation: ${occupation}`);
    }
    return template.schedule.map((entry) => ({ ...entry }));
  }

  // ── NPC Generation ──────────────────────────────────────────────────────

  /**
   * Generate a batch of NPCs.
   * @param {object} config
   * @param {number} config.count - Number of NPCs to generate.
   * @param {number} [config.minAge=18]
   * @param {number} [config.maxAge=70]
   * @param {string[]} [config.occupations] - Constrain to these occupation keys.
   * @param {number} [config.relationshipDensity=0.3] - 0..1 density for relationships.
   * @param {number} [config.greetingCount=3] - Number of greetings per NPC.
   * @returns {object[]}
   */
  generateNPCs(config) {
    const {
      count,
      minAge = 18,
      maxAge = 70,
      occupations,
      relationshipDensity = 0.3,
      greetingCount = 3,
    } = config;

    const allowedOccupations = occupations || Object.keys(OCCUPATION_TEMPLATES);
    const npcs = [];

    for (let i = 0; i < count; i++) {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const fullName = `${firstName} ${lastName}`;
      const occupation = pick(allowedOccupations);
      const traits = pickN(PERSONALITY_TRAITS, 3);
      const age = randomInt(minAge, maxAge);
      const schedule = this.generateSchedule(occupation);

      const npc = {
        id: uid(),
        name: fullName,
        firstName,
        lastName,
        age,
        occupation,
        occupationTitle: OCCUPATION_TEMPLATES[occupation].title,
        traits,
        schedule,
        relationships: [],
        systemPrompt: '',
        greetings: [],
      };

      npc.systemPrompt = this.generateSystemPrompt(npc);
      npc.greetings = this.generateGreetings(npc, greetingCount);
      this._greetingCache.set(npc.id, npc.greetings);

      npcs.push(npc);
    }

    // Wire up relationships
    if (npcs.length > 1) {
      const relationships = this.generateRelationships(npcs, relationshipDensity);
      for (const rel of relationships) {
        const source = npcs.find((n) => n.id === rel.sourceId);
        const target = npcs.find((n) => n.id === rel.targetId);
        if (source) source.relationships.push(rel);
        if (target) target.relationships.push({ ...rel, sourceId: rel.targetId, targetId: rel.sourceId });
      }
    }

    return npcs;
  }

  // ── Relationship Generation ─────────────────────────────────────────────

  /**
   * Generate relationships between NPCs at a given density.
   * @param {object[]} npcs
   * @param {number} density - 0..1 probability of any two NPCs being related.
   * @returns {object[]}
   */
  generateRelationships(npcs, density) {
    const RELATION_TYPES = [
      'friend', 'rival', 'mentor', 'student', 'sibling',
      'spouse', 'business_partner', 'neighbor', 'old_acquaintance',
    ];

    const relationships = [];

    for (let i = 0; i < npcs.length; i++) {
      for (let j = i + 1; j < npcs.length; j++) {
        if (Math.random() < density) {
          relationships.push({
            id: uid(),
            sourceId: npcs[i].id,
            targetId: npcs[j].id,
            type: pick(RELATION_TYPES),
            strength: Math.round(Math.random() * 100) / 100,
          });
        }
      }
    }

    return relationships;
  }

  // ── System Prompt Generation ────────────────────────────────────────────

  /**
   * Build a character system prompt for an NPC.
   * @param {object} npc
   * @returns {string}
   */
  generateSystemPrompt(npc) {
    const traitStr = npc.traits.join(', ');
    return [
      `You are ${npc.name}, a ${npc.age}-year-old ${npc.occupationTitle}.`,
      `Your personality traits are: ${traitStr}.`,
      `You follow a daily schedule typical of a ${npc.occupationTitle.toLowerCase()}.`,
      `Stay in character at all times. Respond as ${npc.firstName} would,`,
      `reflecting your personality and life experience.`,
      `Never break the fourth wall or acknowledge you are an AI.`,
    ].join(' ');
  }

  // ── Greeting Generation ─────────────────────────────────────────────────

  /**
   * Generate a set of contextual greetings for an NPC.
   * @param {object} npc
   * @param {number} count
   * @returns {string[]}
   */
  generateGreetings(npc, count) {
    const templates = [
      `Well met, traveler. I'm ${npc.firstName}, the ${npc.occupationTitle.toLowerCase()} around here.`,
      `Ah, a new face! Name's ${npc.firstName}. Need anything ${npc.occupationTitle.toLowerCase()}-related?`,
      `Good day. ${npc.firstName} ${npc.lastName}, at your service.`,
      `Hm? Oh, hello there. I was just finishing up some work.`,
      `Welcome, welcome! Always good to see someone new in these parts.`,
      `You look like you've traveled far. ${npc.firstName} here. What can I do for you?`,
      `Another day, another coin. What brings you to my ${npc.occupationTitle.toLowerCase() === 'guard' ? 'post' : 'shop'}?`,
      `Don't mind the mess. I'm ${npc.firstName}, the local ${npc.occupationTitle.toLowerCase()}.`,
    ];

    return pickN(templates, Math.min(count, templates.length));
  }

  // ── Quest Generation ────────────────────────────────────────────────────

  /**
   * Generate a quest.
   * @param {object} config
   * @param {string} [config.theme] - Force a specific theme key.
   * @param {number} [config.budget=100] - Reward budget in CC.
   * @param {string} [config.location] - A location name for templates.
   * @returns {object}
   */
  generateQuest(config = {}) {
    const {
      theme: forcedTheme,
      budget = 100,
      location = 'the Old Quarter',
    } = config;

    const theme = forcedTheme
      ? QUEST_THEMES.find((t) => t.key === forcedTheme) || pick(QUEST_THEMES)
      : pick(QUEST_THEMES);

    const fillers = {
      target: pick(['merchant caravan', 'diplomat', 'scholar', 'healer']),
      destination: pick(['Northgate', 'the Harbor', 'Ironvale', 'Sunhaven']),
      artifact: pick(['Crest of Aelion', 'Starstone', 'Ancient Codex', 'Rune Blade']),
      location,
      phenomenon: pick(['strange lights', 'disappearances', 'tremors', 'plague']),
      structure: pick(['watchtower', 'bridge', 'granary', 'aqueduct']),
      faction: pick(['Iron Collective', 'River Clans', 'Merchant Guild', 'Free Folk']),
    };

    let titleTemplate = pick(theme.titleTemplates);
    for (const [key, val] of Object.entries(fillers)) {
      titleTemplate = titleTemplate.replace(`{${key}}`, val);
    }

    const objectives = [];
    for (let i = 0; i < theme.objectiveCount; i++) {
      objectives.push({
        index: i + 1,
        description: `Objective ${i + 1} for ${theme.key} quest`,
        isOptional: i === theme.objectiveCount - 1,
        rewardCC: Math.round(budget / theme.objectiveCount),
      });
    }

    const totalReward = objectives.reduce((sum, o) => sum + o.rewardCC, 0);

    return {
      id: uid(),
      theme: theme.key,
      title: titleTemplate,
      description: `A ${theme.key} quest set in ${location}. Prepare well.`,
      objectives,
      rewards: {
        totalCC: totalReward,
        bonusCC: Math.round(budget * 0.15),
        xp: budget * 10,
      },
      estimatedDurationMinutes: theme.objectiveCount * 15,
    };
  }

  // ── Terrain Generation ──────────────────────────────────────────────────

  /**
   * Generate a heightmap array for a river-valley terrain template.
   * @param {object} config
   * @param {number} [config.width=64]
   * @param {number} [config.height=64]
   * @param {number} [config.riverWidth=4]
   * @param {number} [config.valleyDepth=0.3]
   * @param {number} [config.hillHeight=1.0]
   * @returns {{ width: number, height: number, data: number[][] }}
   */
  generateTerrain(config = {}) {
    const {
      width = 64,
      height = 64,
      riverWidth = 4,
      valleyDepth = 0.3,
      hillHeight = 1.0,
    } = config;

    const centerX = Math.floor(width / 2);
    const data = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      // River meanders using a sine wave
      const riverCenter = centerX + Math.round(Math.sin(y * 0.15) * (width * 0.1));

      for (let x = 0; x < width; x++) {
        const distFromRiver = Math.abs(x - riverCenter);

        if (distFromRiver <= riverWidth / 2) {
          // River bed
          row.push(-valleyDepth);
        } else if (distFromRiver <= riverWidth * 2) {
          // Valley slopes
          const t = (distFromRiver - riverWidth / 2) / (riverWidth * 1.5);
          row.push(-valleyDepth + t * valleyDepth);
        } else {
          // Hills - height increases with distance from river
          const normalizedDist = (distFromRiver - riverWidth * 2) / (width / 2);
          const baseHeight = Math.min(normalizedDist * hillHeight, hillHeight);
          // Add slight noise
          const noise = (Math.random() - 0.5) * 0.1;
          row.push(Math.max(0, baseHeight + noise));
        }
      }
      data.push(row);
    }

    return { width, height, data };
  }
}

module.exports = ConcordProcGen;
