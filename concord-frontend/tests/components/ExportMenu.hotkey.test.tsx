/**
 * The header Export menu binds Ctrl+E on window. That chord must not
 * open the menu while a field is focused (FIX-hr-006 and the same steal).
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExportMenu } from '@/components/common/ExportMenu';

describe('ExportMenu Ctrl+E', () => {
  it('does not open while an input is focused', () => {
    render(
      <>
        <input aria-label="Title" />
        <ExportMenu domain="hr" />
      </>,
    );
    const input = screen.getByLabelText('Title');
    input.focus();
    fireEvent.keyDown(input, { key: 'e', ctrlKey: true });
    expect(screen.queryByText('Export as JSON')).not.toBeInTheDocument();
  });

  it('still opens from outside a field', () => {
    render(<ExportMenu domain="hr" />);
    fireEvent.keyDown(document.body, { key: 'e', ctrlKey: true });
    expect(screen.getByText('Export as JSON')).toBeInTheDocument();
  });
});
