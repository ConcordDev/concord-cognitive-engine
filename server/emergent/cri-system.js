/**
 * System 7: CRI — Concord Research Institutes
 *
 * Digital research institute infrastructure for organizing sustained
 * research programs, running summits, managing simulation chambers,
 * and producing DTUs through structured collaborative inquiry.
 *
 * Summit Protocol:
 *   1. Schedule summit with participants and agenda
 *   2. Auto-generate agenda from open hypotheses, knowledge gaps, research results
 *   3. Run summit: participants review, council voices weigh in, debate simulator runs
 *   4. Complete summit: decisions recorded as DTUs, new research jobs, hypotheses updated
 *
 * Additive only. One file. Silent failure. No existing logic changes.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Constants ───────────────────────────────────────────────────────────────

export const CRI_ROLES = Object.freeze({
  LEAD_RESEARCHER:   "lead_researcher",
  CONTRIBUTOR:       "contributor",
  REVIEWER:          "reviewer",
  OBSERVER:          "observer",
  ADVISOR:           "advisor",
  SIMULATION_OPS:    "simulation_ops",
});

const CRI_STATUSES = Object.freeze({
  ACTIVE:     "active",
  PAUSED:     "paused",
  ARCHIVED:   "archived",
});

const PROGRAM_STATUSES = Object.freeze({
  ACTIVE:     "active",
  COMPLETED:  "completed",
  PAUSED:     "paused",
  CANCELLED:  "cancelled",
});

const SUMMIT_STATUSES = Object.freeze({
  SCHEDULED:  "scheduled",
  IN_PROGRESS: "in_progress",
  COMPLETED:  "completed",
  CANCELLED:  "cancelled",
});

// ── In-Memory State ─────────────────────────────────────────────────────────

const _cris = new LruMap();           // criId -> CRI object
const _crisByDomain = new LruMap();   // domain -> Set<criId>

// ── CRI Lifecycle ───────────────────────────────────────────────────────────

/**
 * Create a new Concord Research Institute.
 *
 * @param {string} name - Institute name (e.g., "CRI Physics")
 * @param {string} domain - Research domain (e.g., "physics")
 * @returns {{ ok: boolean, cri?: object, error?: string }}
 */
export function createCRI(name, domain) {
  try {
    if (!name || !domain) {
      return { ok: false, error: "name_and_domain_required" };
    }

    const id = uid("cri");
    const now = nowISO();

    const cri = {
      id,
      name: String(name).slice(0, 300),
      domain: String(domain).toLowerCase().slice(0, 100),
      status: CRI_STATUSES.ACTIVE,
      members: [],
      programs: [],
      summits: {
        scheduled: [],
        completed: [],
      },
      simulationChamber: {
        activeSimulations: [],
        completedSimulations: [],
        config: {
          maxConcurrent: 3,
          defaultDepth: "deep",
          temporalOSAccess: true,
        },
      },
      resources: {
        dtuBudget: 1000,
        ingestBudget: 500,
        computeBudget: "standard",
      },
      createdAt: now,
    };

    _cris.set(id, cri);

    // Index by domain
    if (!_crisByDomain.has(cri.domain)) {
      _crisByDomain.set(cri.domain, new Set());
    }
    _crisByDomain.get(cri.domain).add(id);

    return { ok: true, cri };
  } catch {
    return { ok: false, error: "create_failed" };
  }
}

/**
 * Get a CRI by ID.
 *
 * @param {string} id - CRI identifier
 * @returns {{ ok: boolean, cri?: object, error?: string }}
 */
export function getCRI(id) {
  try {
    const cri = _cris.get(id);
    if (!cri) return { ok: false, error: "not_found" };
    return { ok: true, cri };
  } catch {
    return { ok: false, error: "get_failed" };
  }
}

/**
 * List all CRIs, optionally filtered by domain or status.
 *
 * @param {{ domain?: string, status?: string }} [filters]
 * @returns {{ ok: boolean, cris: object[], total: number }}
 */
export function listCRIs(filters = {}) {
  try {
    let results = Array.from(_cris.values());

    if (filters.domain) {
      results = results.filter(c => c.domain === filters.domain);
    }
    if (filters.status) {
      results = results.filter(c => c.status === filters.status);
    }

    return {
      ok: true,
      cris: results.map(c => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        status: c.status,
        memberCount: c.members.length,
        programCount: c.programs.length,
        createdAt: c.createdAt,
      })),
      total: results.length,
    };
  } catch {
    return { ok: false, cris: [], total: 0 };
  }
}

// ── Member Management ───────────────────────────────────────────────────────

/**
 * Add a member to a CRI.
 *
 * @param {string} criId - CRI identifier
 * @param {string} entityId - Entity or user ID to add
 * @param {string} role - One of CRI_ROLES values
 * @returns {{ ok: boolean, member?: object, error?: string }}
 */
export function addMember(criId, entityId, role) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    if (!entityId) return { ok: false, error: "entity_id_required" };

    const validRoles = Object.values(CRI_ROLES);
    if (!validRoles.includes(role)) {
      return { ok: false, error: "invalid_role", validRoles };
    }

    // Check for duplicate membership
    const existing = cri.members.find(m => m.entityId === entityId);
    if (existing) {
      return { ok: false, error: "already_a_member" };
    }

    const member = {
      entityId,
      role,
      joinedAt: nowISO(),
    };

    cri.members.push(member);

    return { ok: true, member };
  } catch {
    return { ok: false, error: "add_member_failed" };
  }
}

/**
 * Remove a member from a CRI.
 *
 * @param {string} criId - CRI identifier
 * @param {string} entityId - Entity or user ID to remove
 * @returns {{ ok: boolean, removed?: string, error?: string }}
 */
export function removeMember(criId, entityId) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    const idx = cri.members.findIndex(m => m.entityId === entityId);
    if (idx < 0) return { ok: false, error: "not_a_member" };

    cri.members.splice(idx, 1);

    return { ok: true, removed: entityId };
  } catch {
    return { ok: false, error: "remove_member_failed" };
  }
}

// ── Research Programs ───────────────────────────────────────────────────────

/**
 * Create a research program within a CRI.
 *
 * @param {string} criId - CRI identifier
 * @param {string} title - Program title
 * @param {string} lead - Entity ID of the program lead
 * @returns {{ ok: boolean, program?: object, error?: string }}
 */
export function createProgram(criId, title, lead) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    if (!title) return { ok: false, error: "title_required" };
    if (!lead) return { ok: false, error: "lead_required" };

    const program = {
      id: uid("prog"),
      title: String(title).slice(0, 500),
      status: PROGRAM_STATUSES.ACTIVE,
      lead,
      researchJobs: [],
      hypotheses: [],
      dtusProduced: 0,
      startedAt: nowISO(),
    };

    cri.programs.push(program);

    return { ok: true, program };
  } catch {
    return { ok: false, error: "create_program_failed" };
  }
}

/**
 * Get the status of a specific program within a CRI.
 *
 * @param {string} criId - CRI identifier
 * @param {string} programId - Program identifier
 * @returns {{ ok: boolean, program?: object, error?: string }}
 */
export function getProgramStatus(criId, programId) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    const program = cri.programs.find(p => p.id === programId);
    if (!program) return { ok: false, error: "program_not_found" };

    return {
      ok: true,
      program: {
        ...program,
        jobCount: program.researchJobs.length,
        hypothesisCount: program.hypotheses.length,
      },
    };
  } catch {
    return { ok: false, error: "get_program_status_failed" };
  }
}

// ── Summit Protocol ─────────────────────────────────────────────────────────

/**
 * Schedule a summit within a CRI.
 *
 * @param {string} criId - CRI identifier
 * @param {string} title - Summit title
 * @param {string[]} participants - Entity IDs participating
 * @param {string[]} agenda - Agenda items
 * @returns {{ ok: boolean, summit?: object, error?: string }}
 */
export function scheduleSummit(criId, title, participants, agenda) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    if (!title) return { ok: false, error: "title_required" };

    // Auto-generate agenda items from open hypotheses and research gaps
    const autoAgenda = _generateAgenda(cri);
    const fullAgenda = [...(Array.isArray(agenda) ? agenda : []), ...autoAgenda];

    const summit = {
      id: uid("summit"),
      title: String(title).slice(0, 500),
      status: SUMMIT_STATUSES.SCHEDULED,
      participants: Array.isArray(participants) ? [...participants] : [],
      agenda: fullAgenda,
      outcomes: {
        decisionsReached: [],
        newResearchJobs: [],
        hypothesesUpdated: [],
      },
      date: nowISO(),
      transcript: "",
    };

    cri.summits.scheduled.push(summit);

    return { ok: true, summit };
  } catch {
    return { ok: false, error: "schedule_summit_failed" };
  }
}

/**
 * Run a scheduled summit — transitions to in_progress, simulates council
 * voice deliberation and debate on each agenda item.
 *
 * @param {string} criId - CRI identifier
 * @param {string} summitId - Summit identifier
 * @returns {{ ok: boolean, summit?: object, error?: string }}
 */
export function runSummit(criId, summitId) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    const idx = cri.summits.scheduled.findIndex(s => s.id === summitId);
    if (idx < 0) return { ok: false, error: "summit_not_found" };

    const summit = cri.summits.scheduled[idx];

    if (summit.status !== SUMMIT_STATUSES.SCHEDULED) {
      return { ok: false, error: "summit_not_scheduled" };
    }

    summit.status = SUMMIT_STATUSES.IN_PROGRESS;

    // Simulate summit deliberation for each agenda item
    const transcriptParts = [];
    transcriptParts.push(`=== Summit: ${summit.title} ===`);
    transcriptParts.push(`Date: ${nowISO()}`);
    transcriptParts.push(`Participants: ${summit.participants.join(", ") || "none listed"}`);
    transcriptParts.push("");

    for (let i = 0; i < summit.agenda.length; i++) {
      const item = summit.agenda[i];
      transcriptParts.push(`--- Agenda Item ${i + 1}: ${item} ---`);

      // Council voice deliberation (simulated perspectives)
      const voices = _simulateCouncilDeliberation(item);
      for (const voice of voices) {
        transcriptParts.push(`  [${voice.label}] ${voice.position}`);
      }

      // Debate simulation
      const debateResult = _simulateDebate(item, summit.participants);
      transcriptParts.push(`  Debate outcome: ${debateResult.outcome}`);
      transcriptParts.push(`  Confidence: ${debateResult.confidence}`);
      transcriptParts.push("");
    }

    summit.transcript = transcriptParts.join("\n");

    return { ok: true, summit };
  } catch {
    return { ok: false, error: "run_summit_failed" };
  }
}

/**
 * Complete a summit with outcomes. Moves from scheduled/in_progress to completed.
 * Outcomes become DTUs, research jobs are created, hypotheses updated.
 *
 * @param {string} criId - CRI identifier
 * @param {string} summitId - Summit identifier
 * @param {{ decisionsReached?: string[], newResearchJobs?: string[], hypothesesUpdated?: string[], factionIds?: string[] }} outcomes
 * @param {object} [bridge] - optional injected bridge { db, bridgeSummitToWorld, createEvent }
 *                            for surfacing referendum outcomes into world events +
 *                            faction_policy_state. Failure is silent.
 * @returns {{ ok: boolean, summit?: object, error?: string }}
 */
export function completeSummit(criId, summitId, outcomes, bridge = null) {
  try {
    const cri = _cris.get(criId);
    if (!cri) return { ok: false, error: "cri_not_found" };

    // Find in scheduled list
    const idx = cri.summits.scheduled.findIndex(s => s.id === summitId);
    if (idx < 0) return { ok: false, error: "summit_not_found" };

    const summit = cri.summits.scheduled[idx];

    if (summit.status !== SUMMIT_STATUSES.SCHEDULED &&
        summit.status !== SUMMIT_STATUSES.IN_PROGRESS) {
      return { ok: false, error: "summit_not_completable" };
    }

    // Apply outcomes
    const o = outcomes || {};
    summit.outcomes = {
      decisionsReached: Array.isArray(o.decisionsReached) ? o.decisionsReached : [],
      newResearchJobs: Array.isArray(o.newResearchJobs) ? o.newResearchJobs : [],
      hypothesesUpdated: Array.isArray(o.hypothesesUpdated) ? o.hypothesesUpdated : [],
    };

    summit.status = SUMMIT_STATUSES.COMPLETED;
    summit.completedAt = nowISO();

    // Append outcomes to transcript
    if (summit.transcript) {
      summit.transcript += "\n\n=== Outcomes ===\n";
    } else {
      summit.transcript = "=== Outcomes ===\n";
    }
    summit.transcript += `Decisions: ${summit.outcomes.decisionsReached.join("; ") || "none"}\n`;
    summit.transcript += `New Research Jobs: ${summit.outcomes.newResearchJobs.join("; ") || "none"}\n`;
    summit.transcript += `Hypotheses Updated: ${summit.outcomes.hypothesesUpdated.join("; ") || "none"}\n`;

    // Move from scheduled to completed
    cri.summits.scheduled.splice(idx, 1);
    cri.summits.completed.push(summit);

    // Feed new research jobs back into active programs
    if (summit.outcomes.newResearchJobs.length > 0 && cri.programs.length > 0) {
      const activeProgram = cri.programs.find(p => p.status === PROGRAM_STATUSES.ACTIVE);
      if (activeProgram) {
        for (const job of summit.outcomes.newResearchJobs) {
          activeProgram.researchJobs.push({
            id: uid("rjob"),
            description: job,
            createdFrom: summitId,
            createdAt: nowISO(),
            status: "open",
          });
        }
      }
    }

    // Update hypotheses on active programs
    if (summit.outcomes.hypothesesUpdated.length > 0 && cri.programs.length > 0) {
      const activeProgram = cri.programs.find(p => p.status === PROGRAM_STATUSES.ACTIVE);
      if (activeProgram) {
        for (const hyp of summit.outcomes.hypothesesUpdated) {
          const existing = activeProgram.hypotheses.find(h => h.title === hyp);
          if (existing) {
            existing.updatedAt = nowISO();
            existing.updatedBy = summitId;
          } else {
            activeProgram.hypotheses.push({
              id: uid("hyp"),
              title: hyp,
              status: "open",
              createdFrom: summitId,
              createdAt: nowISO(),
            });
          }
        }
      }
    }

    // Bridge to world: publish a referendum world event and persist faction
    // policy state so NPC dialogue + behavior can react. Strictly best-effort —
    // bridge failure must never block the summit completion.
    if (bridge && typeof bridge.bridgeSummitToWorld === "function") {
      try {
        bridge.bridgeSummitToWorld({
          db:          bridge.db,
          summit,
          cri,
          createEvent: bridge.createEvent,
          factionIds:  Array.isArray(outcomes?.factionIds) ? outcomes.factionIds : [],
        });
      } catch { /* silent — heartbeat invariant */ }
    }

    return { ok: true, summit };
  } catch {
    return { ok: false, error: "complete_summit_failed" };
  }
}

// ── Status and Metrics ──────────────────────────────────────────────────────

/**
 * Get detailed status of a CRI including program progress,
 * summit history, simulation chamber state, and resource usage.
 *
 * @param {string} id - CRI identifier
 * @returns {{ ok: boolean, status?: object, error?: string }}
 */
export function getCRIStatus(id) {
  try {
    const cri = _cris.get(id);
    if (!cri) return { ok: false, error: "not_found" };

    const activePrograms = cri.programs.filter(p => p.status === PROGRAM_STATUSES.ACTIVE);
    const completedPrograms = cri.programs.filter(p => p.status === PROGRAM_STATUSES.COMPLETED);

    const totalDtusProduced = cri.programs.reduce((sum, p) => sum + (p.dtusProduced || 0), 0);
    const totalResearchJobs = cri.programs.reduce((sum, p) => sum + p.researchJobs.length, 0);
    const openResearchJobs = cri.programs.reduce((sum, p) =>
      sum + p.researchJobs.filter(j => j.status === "open").length, 0);
    const totalHypotheses = cri.programs.reduce((sum, p) => sum + p.hypotheses.length, 0);
    const openHypotheses = cri.programs.reduce((sum, p) =>
      sum + p.hypotheses.filter(h => h.status === "open").length, 0);

    return {
      ok: true,
      status: {
        id: cri.id,
        name: cri.name,
        domain: cri.domain,
        status: cri.status,
        members: {
          total: cri.members.length,
          byRole: _countByRole(cri.members),
        },
        programs: {
          total: cri.programs.length,
          active: activePrograms.length,
          completed: completedPrograms.length,
          dtusProduced: totalDtusProduced,
        },
        research: {
          totalJobs: totalResearchJobs,
          openJobs: openResearchJobs,
          totalHypotheses,
          openHypotheses,
        },
        summits: {
          scheduled: cri.summits.scheduled.length,
          completed: cri.summits.completed.length,
          lastCompleted: cri.summits.completed.length > 0
            ? cri.summits.completed[cri.summits.completed.length - 1].completedAt || null
            : null,
        },
        simulationChamber: {
          activeSimulations: cri.simulationChamber.activeSimulations.length,
          completedSimulations: cri.simulationChamber.completedSimulations.length,
          config: { ...cri.simulationChamber.config },
        },
        resources: { ...cri.resources },
        createdAt: cri.createdAt,
      },
    };
  } catch {
    return { ok: false, error: "get_status_failed" };
  }
}

/**
 * Get aggregate metrics across all CRIs.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getCRIMetrics() {
  try {
    const allCris = Array.from(_cris.values());

    const totalCRIs = allCris.length;
    const activeCRIs = allCris.filter(c => c.status === CRI_STATUSES.ACTIVE).length;
    const totalMembers = allCris.reduce((sum, c) => sum + c.members.length, 0);
    const totalPrograms = allCris.reduce((sum, c) => sum + c.programs.length, 0);
    const activePrograms = allCris.reduce((sum, c) =>
      sum + c.programs.filter(p => p.status === PROGRAM_STATUSES.ACTIVE).length, 0);
    const totalDtusProduced = allCris.reduce((sum, c) =>
      sum + c.programs.reduce((ps, p) => ps + (p.dtusProduced || 0), 0), 0);
    const totalSummitsCompleted = allCris.reduce((sum, c) =>
      sum + c.summits.completed.length, 0);
    const totalSummitsScheduled = allCris.reduce((sum, c) =>
      sum + c.summits.scheduled.length, 0);
    const totalResearchJobs = allCris.reduce((sum, c) =>
      sum + c.programs.reduce((ps, p) => ps + p.researchJobs.length, 0), 0);
    const totalHypotheses = allCris.reduce((sum, c) =>
      sum + c.programs.reduce((ps, p) => ps + p.hypotheses.length, 0), 0);
    const totalActiveSimulations = allCris.reduce((sum, c) =>
      sum + c.simulationChamber.activeSimulations.length, 0);

    const domainDistribution = {};
    for (const cri of allCris) {
      domainDistribution[cri.domain] = (domainDistribution[cri.domain] || 0) + 1;
    }

    return {
      ok: true,
      metrics: {
        totalCRIs,
        activeCRIs,
        totalMembers,
        totalPrograms,
        activePrograms,
        totalDtusProduced,
        totalSummitsCompleted,
        totalSummitsScheduled,
        totalResearchJobs,
        totalHypotheses,
        totalActiveSimulations,
        domainDistribution,
      },
    };
  } catch {
    return { ok: false, metrics: {} };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Auto-generate agenda items from CRI state: open hypotheses,
 * knowledge gaps, recent research results, and agent findings.
 */
function _generateAgenda(cri) {
  const items = [];

  try {
    for (const program of cri.programs) {
      if (program.status !== PROGRAM_STATUSES.ACTIVE) continue;

      // Open hypotheses need review
      const openHyps = program.hypotheses.filter(h => h.status === "open");
      for (const hyp of openHyps) {
        items.push(`Review hypothesis: ${hyp.title}`);
      }

      // Open research jobs need prioritization
      const openJobs = program.researchJobs.filter(j => j.status === "open");
      if (openJobs.length > 0) {
        items.push(`Prioritize ${openJobs.length} open research job(s) in "${program.title}"`);
      }

      // DTU production review
      if (program.dtusProduced > 0) {
        items.push(`Review ${program.dtusProduced} DTUs produced by "${program.title}"`);
      }
    }

    // Simulation results to review
    const completedSims = cri.simulationChamber.completedSimulations;
    if (completedSims.length > 0) {
      items.push(`Review ${completedSims.length} completed simulation(s)`);
    }
  } catch {
    // Silent failure — return whatever items we gathered
  }

  return items;
}

/**
 * Simulate council voice deliberation on an agenda item.
 * Five voices provide distinct perspectives.
 */
function _simulateCouncilDeliberation(agendaItem) {
  const item = String(agendaItem);
  return [
    {
      label: "Skeptic",
      position: `What evidence supports "${item}"? What could falsify this?`,
    },
    {
      label: "Socratic",
      position: `What assumptions underlie "${item}"? What are we not asking?`,
    },
    {
      label: "Opposer",
      position: `What are the risks if "${item}" fails? What are the unintended consequences?`,
    },
    {
      label: "Idealist",
      position: `How does "${item}" serve long-term research goals and knowledge advancement?`,
    },
    {
      label: "Pragmatist",
      position: `Is "${item}" feasible within current resources? What is the first actionable step?`,
    },
  ];
}

/**
 * Simulate a debate among participants on an agenda item.
 */
function _simulateDebate(agendaItem, participants) {
  const participantCount = Array.isArray(participants) ? participants.length : 0;

  // Simple heuristic: more participants = higher confidence from diverse input
  const baseConfidence = 0.5;
  const participantBonus = Math.min(participantCount * 0.05, 0.3);
  const confidence = Math.round((baseConfidence + participantBonus) * 100) / 100;

  return {
    agendaItem,
    participantCount,
    outcome: confidence >= 0.7 ? "consensus_reached" : "further_discussion_needed",
    confidence,
  };
}

/**
 * Count members grouped by role.
 */
function _countByRole(members) {
  const counts = {};
  for (const m of members) {
    counts[m.role] = (counts[m.role] || 0) + 1;
  }
  return counts;
}
