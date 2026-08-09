import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ExternalReferenceLocale } from '@/components/lens/ExternalReferenceLocale';

describe('ExternalReferenceLocale — collapsed-by-default external reference locale', () => {
  it('starts collapsed: the label pill renders but the content does not', () => {
    render(
      <ExternalReferenceLocale label="Hacker News" source="hn.algolia.com">
        <div data-testid="hn-search-form">search form</div>
      </ExternalReferenceLocale>
    );
    expect(screen.getByText(/Look up Hacker News/i)).toBeInTheDocument();
    expect(screen.getByText('hn.algolia.com')).toBeInTheDocument();
    expect(screen.queryByTestId('hn-search-form')).not.toBeInTheDocument();
  });

  it('clicking the pill expands it and reveals the content, on demand', () => {
    render(
      <ExternalReferenceLocale label="Hacker News">
        <div data-testid="hn-search-form">search form</div>
      </ExternalReferenceLocale>
    );
    fireEvent.click(screen.getByRole('button', { name: /Look up Hacker News/i }));
    expect(screen.getByTestId('hn-search-form')).toBeInTheDocument();

    // Collapses again on a second click — never a permanently-mounted panel.
    fireEvent.click(screen.getByRole('button', { name: /Look up Hacker News/i }));
    expect(screen.queryByTestId('hn-search-form')).not.toBeInTheDocument();
  });

  it('renders without a source hint when none is given', () => {
    render(
      <ExternalReferenceLocale label="GitHub">
        <div>content</div>
      </ExternalReferenceLocale>
    );
    expect(screen.getByText(/Look up GitHub/i)).toBeInTheDocument();
  });
});
