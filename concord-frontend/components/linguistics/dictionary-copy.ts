/** User copy for a failed live_dictionary call. The reason token stays off the screen. */
export function dictionaryFailureCopy(reason: string | null | undefined): string {
  if (reason === "missing_word") return "Type a word to look it up.";
  if (reason === "word_too_long") return "Use 60 characters or fewer.";
  return "The dictionary did not respond. Check the word, or try again in a moment.";
}
