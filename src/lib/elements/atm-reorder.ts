/**
 * <atm-reorder> lets members reorder a list in place: drag a row by its handle,
 * press Alt+ArrowUp / Alt+ArrowDown on anything inside a row, or use the row's
 * move buttons.
 *
 * It works on light DOM it doesn't own. The markup inside opts in with attributes:
 *
 *   [data-reorder-item]     a row; rows that share a parent reorder among themselves
 *   [data-reorder-label]    on the row, the name read out after a move ("Moved About me…")
 *   [data-reorder-handle]   inside a row, where a pointer drag starts
 *   [data-reorder-up/down]  inside a row, move buttons
 *
 * A move only changes DOM order, so any form fields inside the rows submit in
 * the new order. Nothing is saved until the form is.
 *
 * Without JavaScript (or before this element is defined) none of this runs: the
 * move buttons stay ordinary submit buttons and the server does the moving.
 */
export class AtmReorder extends HTMLElement {
  #status: HTMLElement | null = null;
  #dragging: { item: Element; from: number } | null = null;

  constructor() {
    super();
    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerEnd);
    this.addEventListener('pointercancel', this.#onPointerEnd);
  }

  connectedCallback() {
    // A visually hidden polite live region for announcing moves.
    if (this.#status) return;
    this.#status = document.createElement('span');
    this.#status.setAttribute('role', 'status');
    this.#status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
    this.append(this.#status);
  }

  /**
   * Moves a row to `index` among its sibling rows. Returns whether anything
   * moved, and fires a bubbling `reorder` event when it did.
   */
  move(item: Element, index: number): boolean {
    const rows = siblingRows(item);
    const from = rows.indexOf(item);
    const to = Math.max(0, Math.min(index, rows.length - 1));
    if (from === -1 || from === to) return false;
    // Move the rows in between around `item` rather than moving `item` itself:
    // taking a node out of the document drops its focus and pointer capture.
    if (to < from) item.after(...rows.slice(to, from));
    else item.before(...rows.slice(from + 1, to + 1));
    this.#syncButtons(item.parentElement);
    this.dispatchEvent(new Event('reorder', { bubbles: true }));
    return true;
  }

  #step(item: Element, by: -1 | 1): boolean {
    const rows = siblingRows(item);
    const moved = this.move(item, rows.indexOf(item) + by);
    if (moved) this.#announce(item);
    return moved;
  }

  #announce(item: Element) {
    const rows = siblingRows(item);
    const label = item.getAttribute('data-reorder-label') ?? item.textContent?.trim() ?? '';
    if (this.#status) this.#status.textContent = `Moved ${label} to position ${rows.indexOf(item) + 1} of ${rows.length}`;
  }

  // Keeps each row's move buttons disabled at the ends, as the server renders them.
  #syncButtons(parent: Element | null) {
    if (!parent) return;
    const rows = [...parent.children].filter(isRow);
    rows.forEach((row, i) => {
      const up = row.querySelector<HTMLButtonElement>('[data-reorder-up]');
      const down = row.querySelector<HTMLButtonElement>('[data-reorder-down]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  }

  #rowFor(target: EventTarget | null): Element | null {
    const row = target instanceof Element ? target.closest('[data-reorder-item]') : null;
    return row && this.contains(row) ? row : null;
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const row = this.#rowFor(event.target);
    if (!row) return;
    event.preventDefault();
    this.#step(row, event.key === 'ArrowUp' ? -1 : 1);
  };

  #onClick = (event: MouseEvent) => {
    const button = event.target instanceof Element ? event.target.closest('[data-reorder-up], [data-reorder-down]') : null;
    const row = this.#rowFor(button);
    if (!button || !row) return;
    // Move here instead of submitting the form to the server's move action.
    event.preventDefault();
    this.#step(row, button.hasAttribute('data-reorder-up') ? -1 : 1);
    // A button that just became disabled can't keep focus; hand it to its partner.
    if (button instanceof HTMLButtonElement && button.disabled) {
      row.querySelector<HTMLElement>(button.hasAttribute('data-reorder-up') ? '[data-reorder-down]' : '[data-reorder-up]')?.focus();
    }
  };

  #onPointerDown = (event: PointerEvent) => {
    const handle = event.target instanceof Element ? event.target.closest('[data-reorder-handle]') : null;
    const row = this.#rowFor(handle);
    if (!handle || !row || event.button !== 0) return;
    event.preventDefault();
    // Keep receiving pointer events even when the pointer leaves the handle.
    handle.setPointerCapture?.(event.pointerId);
    this.#dragging = { item: row, from: siblingRows(row).indexOf(row) };
    row.setAttribute('data-reorder-dragging', '');
  };

  #onPointerMove = (event: PointerEvent) => {
    if (!this.#dragging) return;
    const { item } = this.#dragging;
    // The dragged row belongs after every other row whose middle is above the pointer.
    const others = siblingRows(item).filter((row) => row !== item);
    const index = others.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top + box.height / 2 < event.clientY;
    }).length;
    this.move(item, index);
  };

  #onPointerEnd = () => {
    if (!this.#dragging) return;
    const { item, from } = this.#dragging;
    this.#dragging = null;
    item.removeAttribute('data-reorder-dragging');
    if (siblingRows(item).indexOf(item) !== from) this.#announce(item);
  };
}

function isRow(element: Element): boolean {
  return element.hasAttribute('data-reorder-item');
}

function siblingRows(item: Element): Element[] {
  return item.parentElement ? [...item.parentElement.children].filter(isRow) : [];
}

// Guarded so a second import (hot reload, two pages) doesn't throw.
if (!customElements.get('atm-reorder')) customElements.define('atm-reorder', AtmReorder);
