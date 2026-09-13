# Forum theming

Forum owners pick a built-in color theme, and can add CSS and WOFF/WOFF2 fonts, from **Admin → Appearance**. Custom CSS loads after atmobb's own styles and the chosen theme on every non-admin page. Admin pages keep the built-in styles (and the chosen theme) no matter what, so a stylesheet that breaks everything is still repairable.

## Built-in themes

Users can choose a personal theme in **Edit profile → Theme**, then save changes. The preference lives on their `app.atmobb.actor.profile` record and follows their account across forums. **Forum default** (no preference) uses the admin-selected theme and custom CSS. A personal preset, including Classic, applies its color tokens after owner custom CSS, preserving forum layout adjustments and fixes; it does not change anyone else's view. Normal CSS specificity and `!important` still apply: later theme tokens override equally specific declarations, not every possible custom rule.

**Admin → Appearance → Theme** offers five presets: Classic (the greige-and-coral default), Sky (white and blue), Bubblegum (pink and teal), Midnight (dark navy and amber), and Forest (sage and moss). A preview on that page shows the masthead, a category bar, topic rows, and buttons in the selected colors before you save.

A theme is nothing more than a full set of `--forum-*` values written to `:root` ahead of your custom CSS. It lives in `src/lib/themes.ts` and is stored on the forum profile as `theme`; an absent value means Classic. Because your CSS comes later in the same style tag, you can start from a preset and override just the tokens you care about:

```css
/* Midnight, but with the classic coral accent */
:root {
  --forum-accent: #f79b7a;
  --forum-accent-ink: #4a2a1c;
  --forum-link: #ffb39a;
}
```

Midnight also re-tunes the shared status hues (`--ok-*`, `--warn-*`, `--danger-*`, `--info-*`) and shadows, since their light tints glare on dark panels, and sets `color-scheme: dark` so native form controls match.

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
| Default stamp look and member titles | `--forum-rank`, `--forum-rank-bg` |
| Font families | `--font-display`, `--font-wordmark`, `--font-body`, `--font-serif`, `--font-mono` |

Generated Open Graph images use this same token cascade. The selected built-in
theme is applied first, followed by `:root` overrides from Custom CSS. Color,
presence, `--radius-lg`, and `--shadow-sm` tokens are supported by the image
renderer. Selector rules such as `.atm-masthead { ... }` remain browser-only:
the lightweight image renderer does not run a browser or apply CSS classes.
Admin → Appearance → Branding shows the resulting generated card.

`src/lib/styles/tokens/` also defines spacing, radii, type sizes, shadows, and layout widths. I'll keep `--forum-*` and `--font-*` stable. The rest can move.

## Stable class hooks

Shared forum UI uses an `atm-` prefix with BEM-style parts and modifiers. The hooks worth knowing:

- shell: `.atm-shell`, `.atm-main`, `.atm-masthead`, `.atm-mastnav`, `.atm-colophon`, `.atm-webring`
- surfaces: `.atm-card`, `.atm-panel`, `.atm-board-section`, `.atm-notice`, `.atm-empty`
- lists: `.atm-boardrow`, `.atm-threadrow`, `.atm-memberrow`
- threads: `.atm-post`, `.atm-postmeta`, `.atm-post__body`, `.atm-post__meta`, `.atm-composer`
- content: `.atm-richtext`, `.atm-sig`, `.atm-avatar`, `.atm-stamps`, `.atm-stamp`, `.atm-rank`, `.atm-chip`, `.atm-hovercard`, `.atm-spoiler`
- navigation: `.atm-crumbs`, `.atm-pager`, `.atm-tabs`, `.atm-bell`
- notifications: `.atm-notify-prompt`, `.atm-notify-delivery`, `.atm-notification`, `.atm-notification--unread`
- forms: `.atm-btn`, `.atm-linkbtn`, `.atm-field`, `.atm-label`, `.atm-input`, `.atm-textarea`, `.atm-select`, `.atm-toolbar`

Parts use `__` (`.atm-threadrow__title`), variants use `--` (`.atm-btn--primary`). Inspect the rendered markup to find the part hooks you want. Anything unprefixed is a page-local implementation detail and I will absolutely rename it.

### Stamps

Members wear up to three stamps on the post rail, the hovercard, the member list, and their profile. Each stamp is an `.atm-stamp` inside an `.atm-stamps` list, with modifiers for its shape (`--stamp`, `--pill`, `--ticket`, `--pixel`), its size (`--full`, `--compact`), and where it came from (`--admin`, `--default`, `--network`, `--byHand`).

A stamp with fixed colors (an admin's own stamp, a board's first-post stamp in the board's color, the network set) carries `.atm-stamp--custom` and sets `--atm-stamp-bg` and `--atm-stamp-ink` inline. Every other stamp, the arrival stamp included, draws from `--forum-rank` and `--forum-rank-bg`, the same tokens the `.atm-rank` badge and member titles use, so a theme that restyles those tokens restyles the default stamps with them.

## Custom fonts

Upload one WOFF or WOFF2 file per weight and style, then point a font token at the family:

```css
:root {
  --font-display: 'Forum Display', sans-serif;
  --font-body: 'Forum Text', sans-serif;
}
```

Always include a fallback family. Fonts take a moment to load, and a font blob can go missing.
