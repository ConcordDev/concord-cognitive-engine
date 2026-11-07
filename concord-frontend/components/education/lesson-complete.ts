/** What the player says after lessons-complete. The number is the server's. */
export function lessonCompleteNotice(pointsAwarded: number, already: boolean): string {
  if (already || !(pointsAwarded > 0)) return "Already completed. Energy points stay as they were.";
  return `+${pointsAwarded} energy points. That counts toward the day streak.`;
}

/** Empty player copy. A course with no lessons is not a broken player. */
export function playerEmptyCopy(enrolled: boolean, lessonCount: number): string | null {
  if (!enrolled) return "Enroll in a course to open its lessons.";
  if (lessonCount === 0) return "This course has no lessons yet. Completing a lesson is what moves energy points and the day streak.";
  return null;
}
