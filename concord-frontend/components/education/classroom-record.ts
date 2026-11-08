/** A classroom record with no title does not land. The sentence names the field. */
export function classroomRecordRefusal(title: string): string | null {
  if (!title.trim()) return "Title is required.";
  return null;
}

/** Show the server's sentence. A bare validation token does not name a field. */
export function classroomSaveMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = raw.replace(/_/g, " ").trim();
  if (!text || text === "validation failed") {
    return "Could not save this record. Check the fields and try again.";
  }
  return text;
}
