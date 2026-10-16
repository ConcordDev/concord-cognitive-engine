// server/lib/conkay/chat/session.js
//
// A chat session for class problems (conversational-loop item 6): the user's turns are joined and read again by the
// brief parser, so each answer fills what the last reply asked for. A turn returns either the questions still open
// (the parser's policy, then what the solver still lacks, at most MAX_QUESTIONS) or the solved problem with every
// step's numbers substituted (chat/structures.js). Nothing is filled in silently: a value is the user's, a cited
// default, or asked for.

import { parseChatBrief } from "./brief-parser.js";
import { MAX_QUESTIONS } from "./question-policy.js";
import { solveBracket, solveBeam, solveTrussProblem } from "./structures.js";

export const SESSION_VERSION = "1.0.0";

const SOLVER_QUESTIONS = {
  material: "Which material? (for example A36 steel or 6061-T6 aluminium)",
  safetyFactor: "What safety factor? (none is cited by default for this material; A36 steel takes AISC 360-16's Ω = 1.67)",
  widthM: "How wide is the section?",
  loads: "What loads act on it, and where?",
};

export class ChatSession {
  constructor() { this.turns = []; }

  ask(text) {
    this.turns.push(String(text || "").trim());
    const merged = this.turns.filter(Boolean).join(". ");
    const p = parseChatBrief(merged);
    const turn = this.turns.length;
    if (!p.ok) return { turn, kind: "error", errors: p.errors };
    const base = { turn, domain: p.domain, claims: p.claims, assumptions: p.assumptions };
    if (p.questions.length) return { ...base, kind: "questions", questions: p.questions };
    if (p.domain === "bracket") {
      const r = solveBracket(p.ir);
      if (!r.ok && r.missing) return { ...base, kind: "questions", questions: r.missing.slice(0, MAX_QUESTIONS).map((f) => ({ field: f, question: SOLVER_QUESTIONS[f] || `What is the ${f}?`, reason: "the solver needs it" })) };
      return { ...base, kind: "answer", answer: r };
    }
    if (p.domain === "beam") {
      const r = solveBeam(p.ir);
      if (!r.ok && r.missing) return { ...base, kind: "questions", questions: r.missing.slice(0, MAX_QUESTIONS).map((f) => ({ field: f, question: SOLVER_QUESTIONS[f] || `What is the ${f}?`, reason: "the solver needs it" })) };
      return { ...base, kind: "answer", answer: r, ...(r.needs ? { followUps: r.needs } : {}) };
    }
    if (p.domain === "truss") {
      const r = solveTrussProblem(p.ir);
      return { ...base, kind: r.ok ? "answer" : "error", answer: r, ...(r.ok ? {} : { errors: [{ error: r.error || `missing ${r.missing.join(", ")}` }] }) };
    }
    return { ...base, kind: "handoff", note: `a ${p.domain} design runs through the orchestrator (chat/run.js designFromChat), not the class-problem solvers`, ir: p.ir };
  }
}
