// The directory headline is the unweighted mean of listed mentors who
// have at least one review. The count is that set. Zero reviews is the
// same unavailable mark the Program view uses for session ratings.

export function mentorRatingCaption(avg: number, count: number): { value: string; caption: string } {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  if (n === 0 || typeof avg !== "number" || !Number.isFinite(avg) || avg <= 0) {
    return { value: "--", caption: "no mentor reviews yet" };
  }
  const who = n === 1 ? "1 listed mentor with a review" : `${n} listed mentors with a review`;
  return { value: String(avg), caption: `mean of ${who}` };
}
