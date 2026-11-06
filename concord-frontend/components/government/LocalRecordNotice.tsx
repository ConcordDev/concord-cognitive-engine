/**
 * LocalRecordNotice — the Government lens's point-of-action official-status
 * label (S2, Review 2's first pass F2: the headline finding).
 *
 * Eleven submission-shaped flows in this lens present civic acts — file a
 * 311 request, apply for a permit, register to vote, issue a fine — in full
 * civic dress. The code-read behind the build (§8 Q3) settles that every
 * one of them is a LOCAL record write inside Concord: no handler transmits
 * anything to any authority. This notice is what tells the user that, at
 * the point of action, beside the button — the FOIA family's draft-only
 * construction is the in-house template, and this is its labelling half.
 *
 * `channelLabel`/`channelHref` name the real official channel where one
 * canonical channel exists (vote.gov for registration, FOIA.gov for FOIA).
 */
export function LocalRecordNotice({
  channelLabel,
  channelHref,
  children,
}: {
  channelLabel?: string;
  channelHref?: string;
  children?: React.ReactNode;
}) {
  return (
    <p
      role="note"
      className="text-[11px] leading-snug text-amber-200/90 bg-amber-400/10 border border-amber-400/25 rounded px-2.5 py-1.5"
    >
      {children ??
        'Local record only — Concord is not a government agency. Nothing you enter here is filed with, sent to, or acted on by any authority; it is saved only in your Concord workspace.'}
      {channelLabel && channelHref ? (
        <>
          {' '}
          To do this for real, use{' '}
          <a
            href={channelHref}
            target="_blank"
            rel="noreferrer"
            className="underline text-amber-100 font-medium"
          >
            {channelLabel}
          </a>
          .
        </>
      ) : null}
    </p>
  );
}
