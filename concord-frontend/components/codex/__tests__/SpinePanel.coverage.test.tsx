import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SpinePanel } from '../SpinePanel';

const E = (id: string) => ({ id, title: `Title ${id}`, type: 'lore', era: 'Genesis', description: `About ${id}` });
describe('SpinePanel', () => {
  it('shows the three pillars in canon order and skips missing ones', () => {
    const v = render(<SpinePanel spine={[E('lore_first_refusal'), E('lore_first_thought'), E('other')] as never} />);
    expect(v.container.textContent).toMatch(/The Three Pillars/);
    expect(v.container.textContent).toMatch(/Title lore_first_thought/);
    expect(v.container.textContent).not.toMatch(/Title other/);
  });
  it('renders nothing without any pillar', () => {
    expect(render(<SpinePanel spine={[E('x')] as never} />).container.innerHTML).toBe('');
  });
});
