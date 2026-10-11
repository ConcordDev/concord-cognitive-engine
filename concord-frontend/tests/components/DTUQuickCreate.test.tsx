import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const create = vi.fn();
const addToast = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { create: (...args: unknown[]) => create(...args) } },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

import { DTUQuickCreate } from '@/components/dtu/DTUQuickCreate';

function renderCreate(props: Partial<React.ComponentProps<typeof DTUQuickCreate>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onSuccess = props.onSuccess ?? vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <DTUQuickCreate onClose={onClose} onSuccess={onSuccess} source={props.source} defaultTags={props.defaultTags} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, onSuccess };
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

/**
 * jsdom does not apply Tailwind, so this repeats the dialog's layout rule:
 * the form is capped to the viewport minus the overlay padding, and the
 * footer is a sibling after the scroller. A button inside the field list
 * would sit below that cap once the fields exceed it.
 */
function createButtonBottom(viewportHeight: number) {
  const dialog = screen.getByRole('dialog', { name: 'Create New DTU' });
  const submit = screen.getByRole('button', { name: 'Create DTU' });
  const scroller = dialog.querySelector('.overflow-y-auto');
  expect(scroller).toBeInstanceOf(HTMLElement);
  const footer = submit.parentElement;
  expect(footer?.parentElement).toBe(dialog);
  const cap = viewportHeight - 32;
  const headerH = 64;
  const footerH = 56;
  const fieldsH = 1200;
  const insideScroller = scroller!.contains(submit);
  const top = 16;
  const buttonTop = insideScroller ? top + headerH + fieldsH : top + cap - footerH;
  return { submit, dialog, scroller: scroller as HTMLElement, buttonBottom: buttonTop + 38, cap };
}

describe('DTUQuickCreate', () => {
  beforeEach(() => {
    create.mockReset();
    addToast.mockReset();
    document.body.style.overflow = '';
  });

  afterEach(() => {
    cleanup();
  });

  it('portals to document.body, scrolls the fields, and keeps Create inside 1280x800', () => {
    setViewport(1280, 800);
    renderCreate({ defaultTags: ['usability', 'test'] });

    const dialog = screen.getByRole('dialog', { name: 'Create New DTU' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.className).toContain('max-h-[calc(100dvh-2rem)]');
    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.parentElement?.className).toContain('z-[80]');
    expect(document.body.style.overflow).toBe('hidden');

    const scroller = dialog.querySelector('.overflow-y-auto') as HTMLElement;
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.className).toContain('overscroll-contain');
    expect(screen.getByPlaceholderText('A descriptive title for this thought...')).toBeTruthy();
    expect(screen.getByPlaceholderText('The thought content...')).toBeTruthy();
    expect(screen.getByLabelText('License scopes')).toBeTruthy();
    expect((screen.getByPlaceholderText('research, science, hypothesis') as HTMLInputElement).value).toBe('usability, test');

    fireEvent.change(screen.getByPlaceholderText('The thought content...'), {
      target: { value: 'A thought that has to stay on screen' },
    });

    const { submit, buttonBottom, cap } = createButtonBottom(window.innerHeight);
    expect(scroller.contains(submit)).toBe(false);
    expect(submit.parentElement?.className).toContain('shrink-0');
    expect(scroller.nextElementSibling).toBe(submit.parentElement);
    expect(cap).toBe(768);
    expect(buttonBottom).toBeLessThanOrEqual(800);
    expect(submit).toBeEnabled();
  });

  it('creates a DTU from the filled fields and reports success', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-1' } });
    const { onSuccess } = renderCreate({ source: 'chat-lens', defaultTags: ['seed'] });

    fireEvent.change(screen.getByPlaceholderText('A descriptive title for this thought...'), {
      target: { value: 'Usability DTU' },
    });
    fireEvent.change(screen.getByPlaceholderText('The thought content...'), {
      target: { value: 'Browser-created note' },
    });
    fireEvent.change(screen.getByPlaceholderText('research, science, hypothesis'), {
      target: { value: 'usability, , test' },
    });
    const tier = screen.getAllByRole('combobox').find((el) => (el as HTMLSelectElement).value === 'regular');
    fireEvent.change(tier!, { target: { value: 'shadow' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Make global' }));
    fireEvent.click(screen.getByRole('button', { name: /Local/ }));
    fireEvent.change(screen.getByLabelText('Content class'), { target: { value: 'media' } });
    fireEvent.click(screen.getByLabelText(/Marketplace sale/));

    fireEvent.click(screen.getByRole('button', { name: 'Create DTU' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const arg = create.mock.calls[0][0];
    expect(arg).toMatchObject({
      title: 'Usability DTU',
      content: 'Browser-created note',
      tags: ['usability', 'test'],
      source: 'chat-lens',
      isGlobal: true,
      contentClass: 'media',
    });
    expect(arg.licenseScopes).toEqual(expect.arrayContaining(['private', 'marketplace_sale']));
    expect(arg.scopes).toEqual(arg.licenseScopes);
    expect(arg.license.scopes).toEqual(arg.licenseScopes);
    expect(arg.meta).toMatchObject({ contentClass: 'media', tier: 'shadow', visibilityScope: 'local' });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith({ type: 'success', message: 'DTU created successfully' }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('omits an empty title and tags, and marks a global visibility scope', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-2' } });
    renderCreate();

    fireEvent.change(screen.getByPlaceholderText('The thought content...'), {
      target: { value: 'Only the thought' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Global/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create DTU' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const arg = create.mock.calls[0][0];
    expect(arg.title).toBeUndefined();
    expect(arg.tags).toBeUndefined();
    expect(arg.source).toBe('manual');
    expect(arg.isGlobal).toBe(true);
    expect(arg.meta.visibilityScope).toBe('global');
  });

  it('does not submit blank content', () => {
    const { onClose } = renderCreate();
    const submit = screen.getByRole('button', { name: 'Create DTU' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    fireEvent.change(screen.getByPlaceholderText('The thought content...'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Create DTU' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('dialog', { name: 'Create New DTU' }));
    expect(create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('toasts when create fails', async () => {
    create.mockRejectedValue(new Error('nope'));
    const { onSuccess } = renderCreate();
    fireEvent.change(screen.getByPlaceholderText('The thought content...'), { target: { value: 'Will fail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create DTU' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'Failed to create DTU' }));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows a spinner while the create request is in flight', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    create.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderCreate();
    fireEvent.change(screen.getByPlaceholderText('The thought content...'), { target: { value: 'Pending' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create DTU' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create DTU' }).querySelector('.animate-spin')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Create DTU' })).toBeDisabled();
    resolveCreate({ data: { id: 'dtu-pending' } });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('closes from Cancel, the header control, and the backdrop', () => {
    const { onClose, unmount } = renderCreate();
    const dialog = screen.getByRole('dialog', { name: 'Create New DTU' });
    const backdrop = dialog.parentElement?.querySelector('.absolute.inset-0') as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(backdrop);
    fireEvent.keyDown(backdrop, { key: 'Enter' });
    fireEvent.keyDown(backdrop, { key: ' ' });
    fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(5);

    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
