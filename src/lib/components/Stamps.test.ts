import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { Window } from 'happy-dom';
import StampRow from './StampRow.svelte';
import StampCollection from './StampCollection.svelte';
import type { TrayEntry } from '$lib/server/appview';

const tray: TrayEntry[] = Array.from({ length: 7 }, (_, i) => ({
  id: `stamp-${i}`, name: `Stamp ${i}`, source: 'admin',
  look: { bg: '#ffffff', ink: '#111111', shape: 'ticket', symbol: String.fromCharCode(65 + i) },
  trigger: { kind: 'firstPostHere' },
}));

function documentOf(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

describe('stamp rendering', () => {
  it('renders six compact symbols in order with named, keyboard-accessible details', () => {
    const { body } = render(StampRow, { props: { stamps: tray } });
    const doc = documentOf(body);
    expect([...doc.querySelectorAll('.atm-stamp')].map((el) => el.textContent)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const buttons = doc.querySelectorAll('.stamp-trigger');
    expect(buttons).toHaveLength(6);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toMatch(/About the Stamp \d stamp/);
      const panel = doc.getElementById(button.getAttribute('popovertarget')!);
      expect(panel?.getAttribute('popover')).toBe('auto');
      expect(panel?.textContent).toContain('Earned by making a first post on this forum.');
    }
  });

  it('keeps collection explanations and complete ordered form data available without JavaScript', () => {
    const { body } = render(StampCollection, { props: { tray, worn: ['stamp-2', 'stamp-0'], handle: 'member.test' } });
    const doc = documentOf(body);
    expect([...doc.querySelectorAll('input[name="wear"]')].map((el) => el.getAttribute('value'))).toEqual(['stamp-2', 'stamp-0']);
    expect(doc.querySelectorAll('.entry')).toHaveLength(7);
    expect(doc.querySelectorAll('button[formaction="?/toggle"]')).toHaveLength(7);
    expect(doc.querySelector('.count')?.textContent).toBe('2 of 6');
    expect(doc.querySelector('[aria-label="Move Stamp 2 earlier"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('disables only unworn choices at capacity, not the take-off controls', () => {
    const { body } = render(StampCollection, { props: { tray, worn: tray.slice(0, 6).map((s) => s.id), handle: 'member.test' } });
    const doc = documentOf(body);
    expect(doc.querySelector('[aria-label="Wear Stamp 6"]')?.hasAttribute('disabled')).toBe(true);
    expect(doc.querySelector('[aria-label="Take off Stamp 0"]')?.hasAttribute('disabled')).toBe(false);
  });

  it('renders a rejected draft and keeps its error visible', () => {
    const { body } = render(StampCollection, { props: {
      tray, worn: ['stamp-0'], handle: 'member.test', form: { message: 'Try again.', wear: ['stamp-2', 'stamp-1'] },
    } });
    const doc = documentOf(body);
    expect([...doc.querySelectorAll('input[name="wear"]')].map((el) => el.getAttribute('value'))).toEqual(['stamp-2', 'stamp-1']);
    expect(doc.querySelector('[role="alert"]')?.textContent).toBe('Try again.');
  });

  it('shows an actionable empty collection and no save form', () => {
    const { body } = render(StampCollection, { props: { tray: [], worn: [], handle: 'member.test' } });
    expect(body).toContain('Your collection starts here');
    expect(body).toContain('Explore the forum');
    expect(body).not.toContain('<form');
  });
});
