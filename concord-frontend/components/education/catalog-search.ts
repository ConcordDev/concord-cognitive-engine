/** Same fields as education.courses-search. An empty query keeps every loaded course. */
export function catalogMatchesQuery(
  course: { title?: string; description?: string; category?: string; instructor?: string; institution?: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [course.title, course.description, course.category, course.instructor, course.institution]
    .some((value) => String(value || "").toLowerCase().includes(q));
}
