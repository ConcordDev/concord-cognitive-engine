/** quiz-submit returns { attempt }. The score fields live on that attempt. */
export interface QuizAttemptScore {
  score: number;
  totalPoints: number;
  percent: number;
  breakdown: Array<{
    questionId: string;
    prompt?: string;
    given?: string;
    correctAnswer?: string;
    correct?: boolean;
    points?: number;
    awarded?: number;
  }>;
}

export function quizAttemptFromSubmit(result: unknown): QuizAttemptScore | null {
  if (!result || typeof result !== "object") return null;
  const row = result as Record<string, unknown>;
  const inner = row.attempt && typeof row.attempt === "object" ? row.attempt as Record<string, unknown> : row;
  if (typeof inner.score !== "number" || typeof inner.totalPoints !== "number" || !Array.isArray(inner.breakdown)) {
    return null;
  }
  const percent = typeof inner.percent === "number" ? inner.percent : (
    inner.totalPoints > 0 ? Math.round((inner.score / inner.totalPoints) * 100) : 0
  );
  return {
    score: inner.score,
    totalPoints: inner.totalPoints,
    percent,
    breakdown: inner.breakdown as QuizAttemptScore["breakdown"],
  };
}

/** A stored cohort id is orientation only. It must still be one of the loaded cohorts. */
export function cohortStillListed(id: number | null, ids: number[]): number | null {
  if (id == null || !Number.isInteger(id)) return null;
  return ids.includes(id) ? id : null;
}

export function parseClassroomCohort(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}
