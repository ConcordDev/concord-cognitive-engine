import { redirect } from 'next/navigation';

/**
 * The standalone Hypothesis Lab page is RETIRED (S1, F-C hypothesis
 * build): it was a sibling surface over its own store whose create
 * dialog could not create anything, wearing the lens's name. Under the
 * one-canonical-store ruling, the Hypothesis lens is the only
 * hypothesis surface — this route keeps old links and the sidebar's
 * historical path landing on the working Lab.
 */
export default function HypothesisLabPage() {
  redirect('/lenses/hypothesis');
}
