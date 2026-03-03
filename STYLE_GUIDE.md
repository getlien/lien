# Lien Brand Style Guide

Design identity for all Lien properties (documentation site, platform app).

---

## Typography

### Typefaces

| Role | Family | Weights | Usage |
|------|--------|---------|-------|
| UI / body | **Satoshi** | 400, 500 | All prose, labels, nav, buttons |
| Code / mono | **JetBrains Mono** | 400, 500 | Code blocks, inline code, terminal output |

- Satoshi is served from [fontshare.com](https://api.fontshare.com/v2/css?f[]=satoshi@400,500&display=swap)
- JetBrains Mono is served from [Google Fonts](https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap)

### Weight Scale

| Token | Value | Use |
|-------|-------|-----|
| Regular | 400 | Body text, descriptions |
| Medium | 500 | Labels, nav items, code |
| **No bold (600+)** | — | Avoid — disrupts visual rhythm |

### CSS Variables (VitePress)

```css
--vp-font-family-base: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
--vp-font-family-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
```

---

## Color System

### Philosophy

- **Dark-first** — dark mode is the primary design target
- **Zinc neutrals** — surfaces use zinc/gray scale, not blue-gray
- **Purple accent** — single accent color, no secondary hues

### Accent Scale (Purple)

| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| brand-300 | `#c084fc` | purple-400 | Dark mode interactive highlights |
| brand-500 | `#a855f7` | purple-500 | Primary accent (links, active states) |
| brand-600 | `#9333ea` | purple-600 | Buttons, CTAs, logo gradient start |
| brand-soft | `rgba(168,85,247,0.14)` | — | Subtle tints, badges |

### VitePress CSS Variables

```css
/* Light + default */
:root {
  --vp-c-brand-1: #a855f7;   /* interactive elements */
  --vp-c-brand-2: #9333ea;   /* hover states */
  --vp-c-brand-3: #c084fc;   /* softer accents */
  --vp-c-brand-soft: rgba(168, 85, 247, 0.14);
}

/* Dark mode */
.dark {
  --vp-c-brand-1: #a855f7;
  --vp-c-brand-2: #c084fc;   /* lighter in dark for readability */
  --vp-c-brand-3: #9333ea;
  --vp-c-brand-soft: rgba(168, 85, 247, 0.16);
}
```

### Neutrals

Use VitePress `--vp-c-*` surface tokens. Do not hardcode neutral grays — they adapt between light/dark automatically.

### What Not to Use

- `#646cff` — old indigo brand color (replaced)
- `#4a9eff` — old sky blue (replaced)
- `rgba(99,102,241,*)` — indigo RGBA (replaced)
- `rgba(74,158,255,*)` — sky blue RGBA (replaced)

---

## Surfaces & Elevation

| Level | Token / value | Use |
|-------|---------------|-----|
| Base | `--vp-c-bg` | Page background |
| Raised | `--vp-c-bg-soft` | Cards, sidebars |
| Overlay | `--vp-c-bg-elv` | Dropdowns, modals |
| Border | `--vp-c-divider` | Dividers, card outlines |

---

## Logo & Favicon

### Logo (logo.svg)

- Chain-link icon with linear gradient: `#9333ea` (brand-600) → `#a855f7` (brand-500), top-left to bottom-right
- No stroke, opacity 0.9 on top link element

### Favicon (favicon.svg)

- 32×32 rounded rect, `rx=6`, fill `#9333ea`
- Letter "L" centered, `font-weight="500"`, `fill="white"`

---

## Component Patterns

### Interactive Background (documentation homepage)

Floating language logos behind the hero section.

- Default opacity: `0.25` (mobile: `0.15`)
- Hover glow — light: `drop-shadow(0 0 20px rgba(168, 85, 247, 0.6))`
- Hover glow — dark: `drop-shadow(0 0 25px rgba(192, 132, 252, 0.7))`
- Pulse radial — light: `rgba(168, 85, 247, 0.2)`
- Pulse radial — dark: `rgba(192, 132, 252, 0.2)`
- Logo name label: `font-weight: 500`

---

## Mermaid Diagrams

Theme: `dark`. Accent lines and borders use brand-500:

```js
themeVariables: {
  primaryBorderColor: '#a855f7',
  lineColor: '#a855f7',
  border1: '#a855f7',
  border2: '#a855f7',
}
```

Dark-mode CSS overrides also use `#a855f7` for strokes.

---

## Motion

| Property | Value | Rationale |
|----------|-------|-----------|
| Easing | `cubic-bezier(0.4, 0, 0.2, 1)` | Material-style ease-in-out |
| Duration (micro) | `0.4s` | Hover/fade transitions |
| Reduce-motion | `opacity: 0.4`, no animation | Respect `prefers-reduced-motion` |

---

## Accessibility

- All interactive text must meet **WCAG AA** contrast (4.5:1 for normal text, 3:1 for large/bold)
- `brand-500` (`#a855f7`) on a dark background (`#1a1a1a`) passes AA at normal size
- Never convey information by color alone — pair with icons or labels
- Respect `prefers-reduced-motion` — wrap animations in the media query
