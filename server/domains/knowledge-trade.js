// server/domains/knowledge-trade.js
//
// Phase 1.5 — macro surface for knowledge trade (NPC marketplace + mentorship
// + demonstration).
//
// Macros:
//   knowledge_trade.mentorship_request — player requests mentorship from NPC
//   knowledge_trade.mentorship_complete_session — finish one teaching session
//   knowledge_trade.mentorship_list_for_student — student-facing list
//   knowledge_trade.mentorship_list_for_mentor  — mentor-facing list
//   knowledge_trade.witness — record a player demonstration that an NPC saw

import {
  requestMentorship,
  completeMentorshipSession,
  listMentorshipsForStudent,
  listMentorshipsForMentor,
  recordDemonstration,
} from "../lib/mentorship.js";

export default function registerKnowledgeTradeMacros(register) {
  /**
   * knowledge_trade.mentorship_request
   * input: { mentorNpcId, recipeDtuId }
   */
  register("knowledge_trade", "mentorship_request", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const studentUserId = ctx?.actor?.userId;
    if (!studentUserId) return { ok: false, reason: "no_actor" };
    return requestMentorship(db, {
      mentorNpcId: input.mentorNpcId,
      studentUserId,
      recipeDtuId: input.recipeDtuId,
    });
  }, { note: "request mentorship from an NPC" });

  /**
   * knowledge_trade.mentorship_complete_session
   * input: { mentorshipId, studentRecipeId? }
   */
  register("knowledge_trade", "mentorship_complete_session", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return completeMentorshipSession(db, {
      mentorshipId: input.mentorshipId,
      studentRecipeId: input.studentRecipeId,
    });
  }, { note: "complete one mentorship session" });

  /**
   * knowledge_trade.mentorship_list_for_student
   * input: { studentKind?, studentId? } — defaults to ('player', ctx.actor.userId)
   */
  register("knowledge_trade", "mentorship_list_for_student", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const kind = input.studentKind || "player";
    const id = input.studentId || ctx?.actor?.userId;
    if (!id) return { ok: false, reason: "no_student_id" };
    return { ok: true, mentorships: listMentorshipsForStudent(db, kind, id) };
  }, { note: "list mentorships I'm enrolled in" });

  /**
   * knowledge_trade.mentorship_list_for_mentor
   * input: { mentorKind, mentorId }
   */
  register("knowledge_trade", "mentorship_list_for_mentor", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.mentorKind || !input.mentorId) return { ok: false, reason: "missing_mentor" };
    return { ok: true, mentorships: listMentorshipsForMentor(db, input.mentorKind, input.mentorId) };
  }, { note: "list mentorships I'm teaching" });

  /**
   * knowledge_trade.witness
   * input: { witnessedNpcId, recipeDtuId, revisionNum, element?, worldId?, casterNpcId? }
   * Caller (the combat path) records a demonstration the NPC saw.
   */
  register("knowledge_trade", "witness", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return recordDemonstration(db, {
      witnessedNpcId: input.witnessedNpcId,
      casterUserId: ctx?.actor?.userId,
      casterNpcId: input.casterNpcId,
      recipeDtuId: input.recipeDtuId,
      revisionNum: input.revisionNum,
      element: input.element,
      worldId: input.worldId,
    });
  }, { note: "record a player demonstration witnessed by an NPC" });
}
