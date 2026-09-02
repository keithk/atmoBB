# Forum theming

Forum owners can add CSS and WOFF/WOFF2 fonts from **Admin → Appearance**. Custom CSS loads after atmobb's own styles on every non-admin page. Admin pages keep the built-in styles no matter what, so a theme that breaks everything is still repairable.

## Cascade contract

All built-in public-page CSS, Svelte component styles included, sits in a low-priority `atmobb` cascade layer. Unlayered owner CSS beats it without `!important`, and without caring about selector specificity.

Just write normal CSS:

```css
:root {
  --forum-bg: #151d29;
  --forum-surface: #1f2a3a;
  --forum-surface-2: #253244;
  --forum-ink: #d9e3f0;
  --forum-ink-soft: #8797ab;
  --forum-link: #f0a985;
  --forum-link-hover: #ffc4a8;
  --forum-accent: #f79b7a;
  --forum-accent-ink: #2a1710;
}

.atm-masthead {
  border-radius: 0;
}
```

Don't wrap your rules in `@layer atmobb`. If you do, they inherit the built-in layer's ordering and you've thrown away the whole advantage.

## Theme tokens

Reach for tokens on colors and typography, because every shared component reads them.

| Role | Tokens |
| --- | --- |
| Surfaces | `--forum-bg`, `--forum-surface`, `--forum-surface-2`, `--forum-sunken` |
| Borders and bevels | `--forum-line`, `--forum-line-strong`, `--forum-edge`, `--forum-bevel` |
| Text | `--forum-ink`, `--forum-ink-soft`, `--forum-ink-faint` |
| Accent and links | `--forum-accent`, `--forum-accent-hover`, `--forum-accent-ink`, `--forum-accent-soft`, `--forum-link`, `--forum-link-hover` |
| Category bars | `--forum-cat-bg`, `--forum-cat-ink`, `--forum-cat-edge` |
| Masthead | `--forum-header-bg`, `--forum-header-ink` |
| Pinned content | `--forum-pin-bg`, `--forum-pin-edge` |
| Ranks and titles | `--forum-rank`, `--forum-rank-bg` |
| Font families | `--font-display`, `--font-wordmark`, `--font-body`, `--font-serif`, `--font-mono` |

`src/lib/styles/tokens/` also defines spacing, radii, type sizes, shadows, and layout widths. I'll keep `--forum-*` and `--font-*` stable. The rest can move.

## Stable class hooks

Shared forum UI uses an `atm-` prefix with BEM-style parts and modifiers. The hooks worth knowing:

- shell: `.atm-shell`, `.atm-main`, `.atm-masthead`, `.atm-mastnav`, `.atm-colophon`, `.atm-webring`
- surfaces: `.atm-card`, `.atm-panel`, `.atm-board-section`, `.atm-notice`, `.atm-empty`
- lists: `.atm-boardrow`, `.atm-threadrow`, `.atm-memberrow`
- threads: `.atm-post`, `.atm-postmeta`, `.atm-post__body`, `.atm-post__meta`, `.atm-composer`
- content: `.atm-richtext`, `.atm-sig`, `.atm-avatar`, `.atm-rank`, `.atm-chip`, `.atm-hovercard`, `.atm-spoiler`
- navigation: `.atm-crumbs`, `.atm-pager`, `.atm-tabs`
- forms: `.atm-btn`, `.atm-linkbtn`, `.atm-field`, `.atm-label`, `.atm-input`, `.atm-textarea`, `.atm-select`, `.atm-toolbar`

Parts use `__` (`.atm-threadrow__title`), variants use `--` (`.atm-btn--primary`). Inspect the rendered markup to find the part hooks you want. Anything unprefixed is a page-local implementation detail and I will absolutely rename it.

## Custom fonts

Upload one WOFF or WOFF2 file per weight and style, then point a font token at the family:

```css
:root {
  --font-display: 'Forum Display', sans-serif;
  --font-body: 'Forum Text', sans-serif;
}
```

Always include a fallback family. Fonts take a moment to load, and a font blob can go missing.
