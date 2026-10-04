/**
 * The composer "I posted this" control calls thread.draft-publish.
 * That macro records the user's own attestation. It does not send the
 * thread anywhere. The sentence may say posted by you only when the
 * server returns postedManually and delivered: false.
 */

export function manualPostSentence(data: {
  ok?: boolean;
  result?: {
    delivered?: boolean;
    draft?: { id?: string; postedManually?: boolean; status?: string } | null;
  } | null;
  error?: string | null;
}): { claimed: boolean; text: string } {
  if (data.ok === false) {
    return { claimed: false, text: `Not marked. ${data.error || 'The server refused this.'}` };
  }
  const draft = data.result?.draft;
  const id = String(draft?.id || '');
  if (!id || draft?.postedManually !== true || draft?.status !== 'published' || data.result?.delivered !== false) {
    return { claimed: false, text: 'Not marked. Concord did not record this as posted by you.' };
  }
  return { claimed: true, text: `Marked as posted by you (${id}). Concord did not send it.` };
}
