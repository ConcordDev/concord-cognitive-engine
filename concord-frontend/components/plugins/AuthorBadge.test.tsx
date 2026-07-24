/// <reference types="@testing-library/jest-dom/vitest" />
// SDK-H — author identity/reputation badge. Pins that AuthorBadge:
//   - renders the author identity + real reputation tier/badge, sourced
//     ONLY from the server-computed `authorReputationSummary` (never
//     invented client-side);
//   - shows an honest "no reputation history yet" state for an author with
//     zero real activity, never a fabricated badge;
//   - renders the self-attested package-signing status (trusted/
//     trustDescription) in a SEPARATE, distinctly-labeled block — the two
//     signals must never collapse into one badge or one boolean.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuthorBadge } from './AuthorBadge';
import type { AuthorReputationSummary } from './types';

function reputation(over: Partial<AuthorReputationSummary> = {}): AuthorReputationSummary {
  return {
    authorId: 'author-1',
    available: true,
    hasActivity: false,
    totalCitations: 0,
    dtuCount: 0,
    worldsOwned: 0,
    reputationDomains: [],
    badges: [],
    topBadge: null,
    ...over,
  };
}

describe('AuthorBadge', () => {
  it('renders the author identity', () => {
    render(<AuthorBadge authorId="author-xyz" trusted={false} trustDescription="Unsigned." />);
    expect(screen.getByText('author-xyz')).toBeInTheDocument();
  });

  it('shows an honest "no reputation history yet" state for an author with zero activity — never a fabricated badge', () => {
    render(
      <AuthorBadge
        authorId="author-empty"
        reputation={reputation({ authorId: 'author-empty', hasActivity: false })}
        trusted={false}
        trustDescription="Unsigned, or the signature doesn't verify against a registered key. Not independently reviewed."
      />,
    );
    expect(screen.getByText('No reputation history yet.')).toBeInTheDocument();
  });

  it('shows the real topBadge tier label when the author has earned one — never invented client-side', () => {
    render(
      <AuthorBadge
        authorId="author-gold"
        reputation={reputation({
          authorId: 'author-gold',
          hasActivity: true,
          badges: [{ key: 'citations_received:gold', category: 'citations_received', tier: 'gold', label: 'Influential', threshold: 100 }],
          topBadge: { key: 'citations_received:gold', category: 'citations_received', tier: 'gold', label: 'Influential', threshold: 100 },
        })}
        trusted={true}
        trustDescription="Self-attested: signed with a key this author registered for themselves. Not independently reviewed."
      />,
    );
    expect(screen.getByText('Influential')).toBeInTheDocument();
    expect(screen.queryByText('No reputation history yet.')).not.toBeInTheDocument();
  });

  it('falls back to real DTU/citation counts when activity exists but no badge tier has been earned yet', () => {
    render(
      <AuthorBadge
        authorId="author-counts"
        reputation={reputation({ authorId: 'author-counts', hasActivity: true, dtuCount: 3, totalCitations: 7, topBadge: null })}
        trusted={false}
        trustDescription="Unsigned."
      />,
    );
    expect(screen.getByText(/3 DTUs · 7 citations/)).toBeInTheDocument();
  });

  it('renders peer reputation and self-attested signing as two SEPARATE, distinctly-labeled signals', () => {
    const { container } = render(
      <AuthorBadge
        authorId="author-both"
        reputation={reputation({
          authorId: 'author-both',
          hasActivity: true,
          topBadge: { key: 'downloads:silver', category: 'downloads', tier: 'silver', label: 'Spreading', threshold: 100 },
        })}
        trusted={true}
        trustDescription="Self-attested: signed with a key this author registered for themselves. Not independently reviewed."
      />,
    );
    const badge = container.firstChild as HTMLElement;
    expect(within(badge).getByText('Reputation:')).toBeInTheDocument();
    expect(within(badge).getByText('Package signing:')).toBeInTheDocument();
    expect(within(badge).getByText('Spreading')).toBeInTheDocument();
    expect(
      within(badge).getByText('Self-attested: signed with a key this author registered for themselves. Not independently reviewed.'),
    ).toBeInTheDocument();
    // The two labels must be genuinely distinct nodes, not the same text reused.
    expect(within(badge).getByText('Reputation:')).not.toBe(within(badge).getByText('Package signing:'));
  });

  it('honestly reflects an untrusted (unsigned) package independent of a strong reputation', () => {
    render(
      <AuthorBadge
        authorId="author-untrusted-but-reputable"
        reputation={reputation({
          authorId: 'author-untrusted-but-reputable',
          hasActivity: true,
          topBadge: { key: 'knowledge_entrepreneur:diamond', category: 'knowledge_entrepreneur', tier: 'diamond', label: 'Knowledge Sovereign', threshold: 20000 },
        })}
        trusted={false}
        trustDescription="Unsigned, or the signature doesn't verify against a registered key. Not independently reviewed."
      />,
    );
    // Strong reputation still shown...
    expect(screen.getByText('Knowledge Sovereign')).toBeInTheDocument();
    // ...but signing status is honestly reported as untrusted, not upgraded by reputation.
    expect(
      screen.getByText("Unsigned, or the signature doesn't verify against a registered key. Not independently reviewed."),
    ).toBeInTheDocument();
  });

  it('degrades honestly when no reputation summary is supplied at all (e.g. an older server response)', () => {
    render(<AuthorBadge authorId="author-no-summary" trusted={true} trustDescription="Self-attested." />);
    expect(screen.getByText('No reputation history yet.')).toBeInTheDocument();
  });
});
