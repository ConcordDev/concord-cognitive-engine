/** Last bench row from education.bench-last. Null fields stay unrendered. */
export interface BenchGrade {
  studentsGraded: number;
  classStats?: { average?: number; median?: number; high?: number; low?: number };
  students?: unknown[];
}
export interface BenchProg {
  overallCompletionPct: number;
  totalRequirements?: number;
  completedRequirements?: number;
  remainingRequirements?: number;
  details?: unknown[];
}
export interface BenchRow {
  grade: BenchGrade | null;
  prog: BenchProg | null;
  mintedDtuId: string | null;
}

export function restoreBench(raw: unknown): BenchRow {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const gradeRaw = row.grade && typeof row.grade === "object" ? row.grade as Record<string, unknown> : null;
  const progRaw = row.prog && typeof row.prog === "object" ? row.prog as Record<string, unknown> : null;
  const grade = gradeRaw && typeof gradeRaw.studentsGraded === "number" && gradeRaw.classStats && typeof gradeRaw.classStats === "object"
    ? gradeRaw as unknown as BenchGrade
    : null;
  const prog = progRaw && typeof progRaw.overallCompletionPct === "number"
    ? progRaw as unknown as BenchProg
    : null;
  const mintedDtuId = typeof row.mintedDtuId === "string" && row.mintedDtuId.trim() ? row.mintedDtuId.trim() : null;
  return { grade, prog, mintedDtuId };
}
