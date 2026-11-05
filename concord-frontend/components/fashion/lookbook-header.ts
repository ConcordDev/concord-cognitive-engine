// A lookbook that was just stored has to move the header count in this
// session. A refused create leaves that figure where it was.

export function notifyLookbookHeader(
  created: boolean,
  refreshHeader?: () => void | Promise<void>,
): void | Promise<void> {
  if (!created || !refreshHeader) return;
  return refreshHeader();
}
