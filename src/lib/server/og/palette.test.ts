import { describe, expect, it } from 'vitest';
import { ogSkin } from './palette';

describe('ogSkin', () => {
  it('uses the same built-in theme tokens as public pages', () => {
    const colors = ogSkin('bubblegum');

    expect(colors.bg).toBe('#fdf0f5');
    expect(colors.accent).toBe('#f472b6');
    expect(colors.link).toBe('#0f8f8a');
  });

  it('applies :root custom-property overrides after the selected theme', () => {
    const colors = ogSkin('midnight', `
      :root {
        --brand-pink: #ff4ead;
        --forum-bg: #fff1f8;
        --forum-accent: var(--brand-pink);
        --forum-ink: rgb(24, 18, 22);
        --radius-lg: 2rem;
      }
    `);

    expect(colors.bg).toBe('#fff1f8');
    expect(colors.accent).toBe('#ff4ead');
    expect(colors.ink).toBe('rgb(24, 18, 22)');
    expect(colors.body).toBe(colors.ink);
    expect(colors.radius).toBe(32);
  });

  it('does not treat scoped custom properties or external images as global OG styles', () => {
    const colors = ogSkin('classic', `
      .atm-card { --forum-bg: red; }
      :root { --forum-surface: url(https://example.com/tracker.png); }
    `);

    expect(colors.bg).toBe('#eceae7');
    expect(colors.surface).toBe('#ffffff');
  });

});
