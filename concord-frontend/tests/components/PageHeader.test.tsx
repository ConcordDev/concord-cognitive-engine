import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PageHeader } from '@/components/common/PageHeader';

describe('PageHeader', () => {
  it('renders title, subtitle, and actions', () => {
    render(
      <PageHeader
        title="My Dashboard"
        subtitle="Good morning — here is your corner"
        actions={<button>Customize</button>}
      />
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('My Dashboard');
    expect(screen.getByText('Good morning — here is your corner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeInTheDocument();
  });

  it('omits subtitle and actions when not provided', () => {
    const { container } = render(<PageHeader title="Bare" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bare');
    expect(container.querySelector('p')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
