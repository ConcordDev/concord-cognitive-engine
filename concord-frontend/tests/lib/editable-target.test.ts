import { describe, expect, it, vi } from 'vitest';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

describe('activateOnEnterOrSpace', () => {
  it('does not click the dialog while a nested field has focus', () => {
    const field = document.createElement('textarea');
    const chrome = document.createElement('div');
    chrome.appendChild(field);
    document.body.appendChild(chrome);
    field.focus();
    const click = vi.spyOn(chrome, 'click');
    activateOnEnterOrSpace({
      key: ' ',
      target: chrome,
      currentTarget: chrome,
      preventDefault: () => {},
    });
    expect(click).not.toHaveBeenCalled();
    chrome.remove();
  });
});
