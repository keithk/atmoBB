// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  await import('./atm-reorder');
});
afterEach(() => {
  document.body.innerHTML = '';
});

// The same shape as the profile page editor's panel list: a hidden order input,
// a checkbox, and move buttons that submit the form without JavaScript.
function mountList(tag = 'atm-reorder') {
  const row = (id: string, i: number, last: number) => `
    <li data-reorder-item data-reorder-label="Panel ${id}">
      <span data-reorder-handle></span>
      <input type="hidden" name="panel" value="${id}" />
      <label><input type="checkbox" name="show" value="${id}" checked /> Panel ${id}</label>
      <button type="submit" formaction="?/move" name="move" value="panel:up:${id}" data-reorder-up ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="submit" formaction="?/move" name="move" value="panel:down:${id}" data-reorder-down ${i === last ? 'disabled' : ''}>↓</button>
    </li>`;
  document.body.innerHTML = `
    <form method="POST" action="?/save">
      <${tag}><ol>${['1', '2', '3'].map((id, i) => row(id, i, 2)).join('')}</ol></${tag}>
    </form>`;
  const form = document.querySelector('form')!;
  const list = form.querySelector(tag) as HTMLElement & { move(item: Element, index: number): boolean };
  const items = () => [...list.querySelectorAll('[data-reorder-item]')];
  const item = (id: string) => items().find((el) => el.querySelector('input[name=panel]')?.getAttribute('value') === id)!;
  const order = () => new FormData(form).getAll('panel');
  const announced = () => list.querySelector('[role=status]')?.textContent ?? '';
  return { form, list, items, item, order, announced };
}

const altKey = (key: string) => new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true });

describe('<atm-reorder>', () => {
  it('moves the third item to the top, so the form posts the order 3, 1, 2', () => {
    const { list, item, order } = mountList();
    expect(list.move(item('3'), 0)).toBe(true);
    expect(order()).toEqual(['3', '1', '2']);
  });

  it('tells the page about a move with a bubbling reorder event', () => {
    const { list, item } = mountList();
    const heard = vi.fn();
    document.body.addEventListener('reorder', heard);
    list.move(item('1'), 2);
    expect(heard).toHaveBeenCalledTimes(1);
    list.move(item('1'), 2);
    expect(heard).toHaveBeenCalledTimes(1);
    document.body.removeEventListener('reorder', heard);
  });

  it('moves an item up with Alt+ArrowUp, keeps focus on it and announces where it went', () => {
    const { item, order, announced } = mountList();
    const checkbox = item('2').querySelector('input[type=checkbox]') as HTMLInputElement;
    checkbox.focus();
    const event = altKey('ArrowUp');
    checkbox.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(order()).toEqual(['2', '1', '3']);
    expect(document.activeElement).toBe(checkbox);
    expect(announced()).toBe('Moved Panel 2 to position 1 of 3');
  });

  it('does nothing and announces nothing for Alt+ArrowDown on the last item', () => {
    const { item, order, announced } = mountList();
    const checkbox = item('3').querySelector('input[type=checkbox]') as HTMLInputElement;
    checkbox.focus();
    checkbox.dispatchEvent(altKey('ArrowDown'));
    expect(order()).toEqual(['1', '2', '3']);
    expect(announced()).toBe('');
  });

  it('ignores arrow keys without Alt', () => {
    const { item, order } = mountList();
    item('2').querySelector('input[type=checkbox]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(order()).toEqual(['1', '2', '3']);
  });

  it('moves in place with the move buttons instead of submitting, and keeps their disabled state in step', () => {
    const { form, item, order, announced } = mountList();
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    const up = item('3').querySelector('[data-reorder-up]') as HTMLButtonElement;
    up.focus();
    up.click();
    up.click();
    expect(submitted).not.toHaveBeenCalled();
    expect(order()).toEqual(['3', '1', '2']);
    expect(announced()).toBe('Moved Panel 3 to position 1 of 3');
    // Now first, its up button is disabled, so focus moves to its down button.
    expect(up.disabled).toBe(true);
    expect(document.activeElement).toBe(item('3').querySelector('[data-reorder-down]'));
    expect((item('1').querySelector('[data-reorder-up]') as HTMLButtonElement).disabled).toBe(false);
    expect((item('2').querySelector('[data-reorder-down]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('drags an item by its handle to where the pointer is', () => {
    const { item, items, order, announced } = mountList();
    // happy-dom has no layout, so give each row a 40px box stacked top to bottom.
    items().forEach((row, i) => {
      row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40 }) as DOMRect;
    });
    const handle = item('1').querySelector('[data-reorder-handle]')!;
    handle.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerId: 1, clientY: 20, bubbles: true }));
    expect(item('1').hasAttribute('data-reorder-dragging')).toBe(true);
    handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY: 110, bubbles: true }));
    expect(order()).toEqual(['2', '3', '1']);
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientY: 110, bubbles: true }));
    expect(item('1').hasAttribute('data-reorder-dragging')).toBe(false);
    expect(announced()).toBe('Moved Panel 1 to position 3 of 3');
  });

  it('leaves the move buttons as plain submit buttons before the element is defined', () => {
    const { form, item, order } = mountList('atm-reorder-undefined');
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    const up = item('3').querySelector('[data-reorder-up]') as HTMLButtonElement;
    expect(up.type).toBe('submit');
    expect(up.getAttribute('formaction')).toBe('?/move');
    up.click();
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(order()).toEqual(['1', '2', '3']);
  });

  it('can be imported twice without defining the element twice', async () => {
    vi.resetModules();
    await expect(import('./atm-reorder')).resolves.toBeDefined();
  });
});
