// server/emergent/vacancy-recruit-cycle.js
//
// Living Society — Phase 1.5c: fill open settlement vacancies from the local
// candidate pool, or escalate resentment + a grievance vs the killer when a
// post stays empty. scope:'world'. Never throws. Kill-switch CONCORD_VACANCY=0.

import { listOpenVacancies, recruitForVacancy } from "../lib/settlements.js";

export function runVacancyRecruitCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (process.env.CONCORD_VACANCY === "0") return { ok: false, reason: "disabled" };
  let worlds = [];
  try {
    worlds = db.prepare(`SELECT DISTINCT world_id FROM settlement_vacancies WHERE filled_at IS NULL`).all().map((r) => r.world_id);
  } catch { return { ok: true, worlds: 0 }; }
  let filled = 0, escalated = 0;
  for (const w of worlds) {
    for (const vac of listOpenVacancies(db, w)) {
      try {
        const r = recruitForVacancy(db, vac);
        if (r.filled) filled++; else escalated++;
      } catch { /* per-vacancy isolation */ }
    }
  }
  return { ok: true, worlds: worlds.length, filled, escalated };
}
