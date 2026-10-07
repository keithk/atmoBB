import { describe, expect, it } from 'vitest';
import { PROFILE_PANELS, profileLook, resolvePanels } from './profile-page';

const look = (input: Partial<Parameters<typeof profileLook>[0]> = {}) =>
  profileLook({ forumHidesSkins: false, ownerBanned: false, ...input });

describe('profileLook', () => {
  it('gives a banned owner the plain forum page, whatever they saved', () => {
    const result = look({ ownerBanned: true, profileSkin: 'midnight', banner: { pattern: 'stars', swatch: 'navy' } });
    expect(result).toEqual({ style: undefined, banner: null, plain: true });
  });

  it('keeps forum colors and draws the banner in accent tokens when the forum hides skins', () => {
    const result = look({ forumHidesSkins: true, profileSkin: 'midnight', banner: { pattern: 'stars', swatch: 'navy' } });
    expect(result.style).toBeUndefined();
    expect(result.plain).toBe(false);
    expect(result.banner?.style).toContain('background-color:var(--forum-accent)');
    expect(result.banner?.style).toContain('var(--forum-accent-ink)');
    expect(result.banner?.style).not.toContain('#1f3a68');
  });

  it('keeps forum colors and uses the owner swatch when no skin is set', () => {
    const result = look({ banner: { pattern: 'scanlines', swatch: 'navy' } });
    expect(result.style).toBeUndefined();
    expect(result.banner?.style).toContain('background-color:#1f3a68');
    expect(result.banner?.style).toContain('repeating-linear-gradient');
  });

  it('uses the owner skin and banner when skins are allowed', () => {
    const result = look({ profileSkin: 'midnight', banner: { pattern: 'checker', swatch: 'teal' } });
    expect(result.style).toContain('--forum-bg:#12131a');
    expect(result.style).toContain('color-scheme:dark');
    expect(result.banner?.style).toContain('background-color:#1f6f6b');
    expect(look({ profileSkin: 'sky' }).style).toContain('color-scheme:light');
    expect(look({ profileSkin: 'sky' }).style).toContain('--danger-bg:#f6ded9');
  });

  it('shows no banner when the owner has not set one', () => {
    expect(look({ profileSkin: 'sky' }).banner).toBeNull();
    expect(look({ forumHidesSkins: true }).banner).toBeNull();
  });

  it('falls back to the forum look for an unknown skin', () => {
    expect(look({ profileSkin: 'neon' }).style).toBeUndefined();
    expect(look({ profileSkin: 'red;background:url(x)' }).style).toBeUndefined();
  });

  it('falls back to plain and the default swatch for unknown banner values, never echoing them', () => {
    const hostile = 'red;background:url(x)';
    const result = look({ banner: { pattern: hostile, swatch: hostile } });
    expect(result.banner?.style).not.toContain('url(');
    expect(result.banner?.style).not.toContain(hostile);
    expect(result.banner?.style).not.toContain('gradient');
    expect(result.banner?.style).toContain('background-color:#4a5563');
    expect(look({ banner: 'stars' }).banner).toBeNull();
  });
});

describe('resolvePanels', () => {
  const allFilled = Object.fromEntries(PROFILE_PANELS.map((id) => [id, true]));
  const ids = (result: ReturnType<typeof resolvePanels>) => result.panels.map((panel) => panel.id);

  it('registers only the phase 1 panels, in default order', () => {
    expect([...PROFILE_PANELS]).toEqual(['about', 'pinned', 'stamps', 'activity', 'bluesky', 'signature']);
  });

  it('keeps saved order, ignores unknown and unregistered ids, and appends missing panels', () => {
    const result = resolvePanels({
      panels: [{ id: 'signature' }, { id: 'nonsense' }, { id: 'regulars' }, { id: 'stamps' }, { id: 'signature' }],
      hasContent: allFilled,
      viewer: 'visitor',
      plain: false,
    });
    expect(ids(result)).toEqual(['signature', 'stamps', 'about', 'pinned', 'activity', 'bluesky']);
  });

  it('uses the default order for a missing or malformed list', () => {
    for (const panels of [undefined, 'about', [null, 42, { id: 7 }]]) {
      expect(ids(resolvePanels({ panels, hasContent: allFilled, viewer: 'visitor', plain: false }))).toEqual([...PROFILE_PANELS]);
    }
  });

  it('shows visitors only filled panels and gives the owner prompts in the empty ones', () => {
    const hasContent = { about: true, signature: true };
    const visitor = resolvePanels({ panels: undefined, hasContent, viewer: 'visitor', plain: false });
    expect(visitor.panels).toEqual([{ id: 'about', state: 'content' }, { id: 'signature', state: 'content' }]);
    expect(visitor.chips).toEqual(['about', 'signature']);

    const owner = resolvePanels({ panels: undefined, hasContent, viewer: 'owner', plain: false });
    expect(owner.panels).toEqual([
      { id: 'about', state: 'content' },
      { id: 'pinned', state: 'prompt' },
      { id: 'stamps', state: 'prompt' },
      { id: 'activity', state: 'prompt' },
      { id: 'bluesky', state: 'prompt' },
      { id: 'signature', state: 'content' },
    ]);
    expect(owner.chips).toEqual([...PROFILE_PANELS]);
  });

  it('gives the owner a stub for a hidden panel, outside the chip row, and hides it from visitors', () => {
    const panels = [{ id: 'stamps', hidden: true }];
    const owner = resolvePanels({ panels, hasContent: allFilled, viewer: 'owner', plain: false });
    expect(owner.panels).toContainEqual({ id: 'stamps', state: 'stub' });
    expect(owner.chips).not.toContain('stamps');

    const visitor = resolvePanels({ panels, hasContent: allFilled, viewer: 'visitor', plain: false });
    expect(ids(visitor)).not.toContain('stamps');
    expect(visitor.chips).not.toContain('stamps');
  });

  it('leaves About me out of a plain page even when it is filled', () => {
    for (const viewer of ['owner', 'visitor'] as const) {
      const result = resolvePanels({ panels: undefined, hasContent: allFilled, viewer, plain: true });
      expect(ids(result)).not.toContain('about');
      expect(result.chips).not.toContain('about');
    }
  });

  it('never reports post counts', () => {
    const result = resolvePanels({ panels: undefined, hasContent: allFilled, viewer: 'owner', plain: false });
    expect(JSON.stringify(result)).not.toMatch(/count/i);
  });
});
