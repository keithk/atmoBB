# Forum theming

Forum owners pick a built-in theme, and can add CSS and WOFF/WOFF2 fonts, from **Admin → Appearance**. Custom CSS loads after atmobb's own styles and the chosen theme on every non-admin page. Admin pages keep the built-in styles (and the chosen theme) no matter what, so a stylesheet that breaks everything is still repairable.

## Built-in themes

**Admin → Appearance → Theme** offers nine themes. A theme sets colors, type and layout together, and the picker previews the forum's own home page in the theme you select before you save.

| Theme | Modes | Look |
| --- | --- | --- |
| Atmosphere | light and dark | Tinted sidebar with pill navigation, one white sheet of flat rows. New forums start here. |
| Coral | light and dark | The built-in look: a white card on greige with coral buttons. A forum with no saved theme shows this. |
| Bulletin | light and dark | A 2004 message board. Small Verdana, boxed tables, gradient header bars. |
| Bubblegum | light and dark | Thick outlines and hard drop shadows, each topic its own card. |
| Graphite | light and dark | Dense and quiet, like an issue tracker. |
| Daydream | light and dark | A gradient sky behind frosted, rounded panels. |
| Midnight | dark | Navy panels on a star field, amber for unread. |
| Terminal | dark | Monospace on near-black with dashed rules. |
| Arcade | dark | Pixel headings, square corners, cyan and magenta. |

The six light themes follow the visitor's device: someone in dark mode gets the theme's dark version. There is no switch on the forum. The three dark themes look the same in both modes.

A theme has two parts, both in the repo:

- Its colors are a full set of `--forum-*` values (plus the status hues and shadows) in `src/lib/themes.ts`, written to `:root` ahead of your custom CSS. A light theme's colors are written as `light-dark(light, dark)` pairs with `color-scheme: light dark`; a dark theme sets `color-scheme: dark`.
- Its layout and type rules are a stylesheet in `src/lib/styles/themes/`, loaded into the `atmobb-theme` cascade layer. Coral has no stylesheet because it is the built-in look.

The theme is stored on the forum profile as `theme`; an absent value means Coral. Records saved by earlier releases may still say `classic` or `forest`, which now read as Coral, or `sky`, which reads as Atmosphere.

Because your CSS comes later in the same style tag, you can start from a theme and override just the tokens you care about:

```css
/* Midnight, but with the coral accent */
:root {
  --forum-accent: #f79b7a;
  --forum-accent-ink: #4a2a1c;
  --forum-link: #ffb39a;
}
```

If your forum uses a light theme, a plain value like `--forum-bg: #fff` applies in dark mode too. Write `light-dark(#fff, #111)` to keep both modes, or set `color-scheme: light` on `:root` to keep the forum light for everyone.

### Personal themes

Members can choose a personal theme in **Edit profile → Styles**, for one forum or for every forum they visit. The preference lives on their `app.atmobb.actor.profile` record. **Forum default** (no preference) shows the forum the way its owner set it up.

A personal theme replaces the forum's whole look for that member. The forum's custom CSS and custom fonts are not loaded for them, since that CSS was written for the forum's own theme. It does not change anyone else's view.

### Previewing a theme

Add `?previewTheme=<name>` to any forum URL to see that page in another built-in theme, with the forum's custom CSS still applied. Nothing is saved. The admin picker uses this for its preview.

## Cascade contract

All built-in public-page CSS, Svelte component styles included, sits in a low-priority `atmobb` cascade layer, and the chosen theme's stylesheet sits in `atmobb-theme` just above it. Unlayered owner CSS beats both without `!important`, and without caring about selector specificity.

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

.atm-main {
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
| Default stamp look and member titles | `--forum-rank`, `--forum-rank-bg` |
| Font families | `--font-display`, `--font-wordmark`, `--font-body`, `--font-serif`, `--font-mono` |

Generated Open Graph images use this same token cascade. The selected built-in
theme is applied first, followed by `:root` overrides from Custom CSS. Color,
presence, `--radius-lg`, and `--shadow-sm` tokens are supported by the image
renderer. Selector rules such as `.atm-main { ... }` remain browser-only:
the lightweight image renderer does not run a browser or apply CSS classes.
Admin → Appearance → Branding shows the resulting generated card.

`src/lib/styles/tokens/` also defines spacing, radii, type sizes, shadows, and layout widths. I'll keep `--forum-*` and `--font-*` stable. The rest can move.

## Stable class hooks

Shared forum UI uses an `atm-` prefix with BEM-style parts and modifiers. The hooks worth knowing:

- shell: `.atm-page`, `.atm-sidebar`, `.atm-sidebar-nav`, `.atm-shell`, `.atm-main`, `.atm-pagebar`, `.atm-mobilebar`, `.atm-colophon`, `.atm-webring`
- surfaces: `.atm-card`, `.atm-panel`, `.atm-board-section`, `.atm-notice`, `.atm-empty`
- lists: `.atm-boardrow`, `.atm-threadrow`, `.atm-memberrow`
- threads: `.atm-post`, `.atm-postmeta`, `.atm-post__body`, `.atm-post__meta`, `.atm-composer`
- content: `.atm-richtext`, `.atm-sig`, `.atm-avatar`, `.atm-stamps`, `.atm-stamp`, `.atm-rank`, `.atm-chip`, `.atm-hovercard`, `.atm-spoiler`
- navigation: `.atm-crumbs`, `.atm-pager`, `.atm-tabs`, `.atm-bell`
- notifications: `.atm-notify-prompt`, `.atm-notify-delivery`, `.atm-notification`, `.atm-notification--unread`
- forms: `.atm-btn`, `.atm-linkbtn`, `.atm-field`, `.atm-label`, `.atm-input`, `.atm-textarea`, `.atm-select`, `.atm-toolbar`

Parts use `__` (`.atm-threadrow__title`), variants use `--` (`.atm-btn--primary`). Inspect the rendered markup to find the part hooks you want. Anything unprefixed is a page-local implementation detail and I will absolutely rename it.

### Long post previews

Thread starters and replies fold when their rendered body exceeds `36rem` plus
a small allowance for a final line. This is roughly four or five paragraphs;
images, quotes, and code count toward the height too. “Read full post” reveals
the rest in place. Signatures, polls, and post actions are not folded. Without
JavaScript, and when printing, the full text is shown.

Adjust the preview in Custom CSS (responsive overrides work too):

```css
:root {
  --post-preview-height: 44rem;
  --post-preview-fade: 3rem;
}

.atm-post-content__expand {
  color: var(--forum-link);
  background: var(--forum-surface-2);
}
```

To disable folding entirely, including the expand control:

```css
:root { --post-preview-height: 0px; }
```

Stable hooks are `.atm-post-content`, `.atm-post-content--collapsed`,
`.atm-post-content__preview`, `.atm-post-content__text`,
`.atm-post-content__expand`, and `.atm-post-content__chevron`. The fade uses
`--forum-surface`; override the preview's `::after` background if your post
surface differs. All built-in rules remain in the `atmobb` layer.

### Stamps

Members wear up to six stamps on the post rail, the hovercard, the member list, and their profile. Members who have not chosen still wear at most three defaults. Each stamp is an `.atm-stamp` inside an `.atm-stamps` list, with modifiers for its shape (`--stamp`, `--pill`, `--ticket`, `--pixel`), its size (`--full`, `--compact`), and where it came from (`--admin`, `--default`, `--network`, `--byHand`).

A stamp with fixed colors (an admin's own stamp, a board's first-post stamp in the board's color, the network set) carries `.atm-stamp--custom` and sets `--atm-stamp-bg` and `--atm-stamp-ink` inline. Every other stamp, the arrival stamp included, draws from `--forum-rank` and `--forum-rank-bg`, the same tokens the `.atm-rank` badge and member titles use, so a theme that restyles those tokens restyles the default stamps with them.

### Member profile pages

A member picks one of the nine themes as the skin of their profile page, and visitors see it on the profile body only; the masthead, navigation, and everything outside the profile keep the visitor's own theme. The skin sets the same `--forum-*` tokens on the profile body, so it beats a visitor's personal theme there. A banner is drawn in CSS from one of eight swatches and a pattern (plain, stars, scanlines, or checker).

Admin → Appearance has **Show member profile pages in this forum's colors**, stored as `hideProfileSkins` on the forum profile. With it on, profile pages ignore member skins and use the forum's theme and your CSS.

Unlayered owner CSS that hard-codes colors on `.atm-*` classes (`.atm-card { background: #fff }`) also wins over a member's skin, and can leave a skinned profile with unreadable text. Style with the `--forum-*` tokens instead and the skin carries through.

## Custom fonts

Upload one WOFF or WOFF2 file per weight and style, then point a font token at the family:

```css
:root {
  --font-display: 'Forum Display', sans-serif;
  --font-body: 'Forum Text', sans-serif;
}
```

Always include a fallback family. Fonts take a moment to load, and a font blob can go missing.
