# Lien Review — Style Guide

**Direction:** Technical Precision
**Personality:** Clean, sharp, confident. Engineered, not decorated. Unmistakably Lien.

---

## 1. Typography

One type system, two families. No mixing, no exceptions.

### Sans — Satoshi

Source: Fontshare CDN (`https://api.fontshare.com`), free for commercial use.

Used for all UI text: headings, body, labels, buttons, navigation. Modern geometric sans-serif with wider letterforms and distinctive character shapes.

| Role        | Size   | Weight | Tracking     |
|-------------|--------|--------|--------------|
| Page title  | 24px   | 500    | 0            |
| Section h2  | 18px   | 500    | 0            |
| Body        | 14px   | 400    | 0            |
| Label/meta  | 12px   | 500    | 0.01em       |
| Small       | 11px   | 400    | 0.01em       |

Neutral tracking everywhere. Headings are medium (500), never bold (700) — precision, not emphasis. Body text uses the natural 400 weight; the `antialiased` + `optimizeLegibility` rules keep text crisp on dark backgrounds without a weight override.

### Mono — JetBrains Mono

Source: Google Fonts. SIL Open Font License.

Designed for code readability with increased letter height and distinct character shapes (0 vs O, l vs 1). Used for: SHAs, file paths, code blocks, log viewer, config JSON, terminal output.

| Role        | Size   | Weight |
|-------------|--------|--------|
| Inline code | 12px   | 400    |
| Log viewer  | 13px   | 400    |
| Code block  | 13px   | 400    |

### Text Rendering

Dark backgrounds expose thin rendering in variable fonts. These rules ensure readable, crisp text across platforms:

- **Font smoothing:** Grayscale antialiasing (`-webkit-font-smoothing: antialiased`) is applied at the body level in CSS, not via Tailwind utility classes.
- **`text-rendering: optimizeLegibility`** is applied globally for improved kerning and ligature rendering.
- **`line-height: 1.5`** is set globally on `body` for improved reading comfort on dark backgrounds. Tailwind utilities override where needed.

### Rules

- Never use bold (700) or semibold (600) anywhere. Medium (500) is the heaviest weight.
- Never use italic for emphasis. Use color or weight.
- Monospace is only for machine-readable content (code, hashes, paths, config). Never for labels or UI text.

---

## 2. Color

Dark-first. The UI should feel like a refined terminal — high contrast content on deep backgrounds.

### Brand (Purple)

Purple is the brand identity. On dark surfaces, the lighter end of the scale provides excellent contrast while maintaining a distinctive, analytical feel.

| Token         | Hex       | Usage                              |
|---------------|-----------|-------------------------------------|
| brand-300     | #d8b4fe   | Hover accent, active states         |
| brand-400     | #c084fc   | Primary text links, active nav      |
| brand-500     | #a855f7   | Primary buttons, focus rings        |
| brand-600     | #9333ea   | Button hover (dark bg), logo fill   |
| brand-900     | #581c87   | Tinted surfaces, badge backgrounds  |
| brand-950     | #2e1065   | Subtle brand tint on dark surfaces  |

Key contrast ratios on zinc-900 (#18181b):
- brand-400 (#c084fc): ~6.0:1 — passes AA for normal text
- brand-300 (#d8b4fe): ~9.2:1 — excellent for hover states
- brand-500 (#a855f7): ~4.1:1 — passes AA for large text (buttons)

### Neutral (Zinc)

Zinc gray, not cool gray — warmer undertone pairs well with purple.

| Token         | Hex       | Usage                              |
|---------------|-----------|-------------------------------------|
| zinc-950      | #09090b   | Page background                     |
| zinc-900      | #18181b   | Card/surface background             |
| zinc-800      | #27272a   | Elevated surfaces, borders          |
| zinc-700      | #3f3f46   | Hover borders, dividers             |
| zinc-500      | #71717a   | Placeholder text, disabled controls, decorative icons, timestamps in logs — never for text users must read |
| zinc-400      | #a1a1aa   | Table headers, secondary text, descriptions, labels, empty states |
| zinc-300      | #d4d4d8   | Prominent secondary text, subtitles |
| zinc-200      | #e4e4e7   | Body text                           |
| zinc-100      | #f4f4f5   | Headings, primary text, emphasis    |

### Semantic

| State      | Background  | Text/Icon   | Usage                    |
|------------|-------------|-------------|--------------------------|
| Success    | green-900/30| green-400   | Completed, posted        |
| Error      | red-900/30  | red-400     | Failed, error            |
| Warning    | amber-900/30| amber-400   | Suppressed, warnings     |
| Info       | blue-900/30 | blue-400    | Pending, running, new    |
| Neutral    | zinc-800    | zinc-400    | Skipped, deduped, muted  |

Semantic colors always use a dark translucent background with a saturated text/icon. Never bright solid backgrounds.

### Light Mode (Secondary)

Support as an opt-in preference. Invert the scale: zinc-50 page, white cards, zinc-200 borders. Brand colors shift to 600/700 range. Dark mode is the default and the design priority.

---

## 3. Surfaces & Layout

### Elevation Model

Three surface levels. Differentiated by background, not shadow.

| Level     | Background | Border       | Usage                          |
|-----------|------------|--------------|--------------------------------|
| Base      | zinc-950   | —            | Page background                |
| Surface   | zinc-900   | zinc-800 1px | Cards, panels, tables          |
| Elevated  | zinc-800   | zinc-700 1px | Dropdowns, overlays, tooltips  |

No box shadows except on floating elements (dropdowns, modals) where a subtle `shadow-xl` with black/50 is acceptable.

### Border Radius

| Element   | Radius   | Tailwind     |
|-----------|----------|--------------|
| Cards     | 8px      | rounded-lg   |
| Buttons   | 6px      | rounded-md   |
| Badges    | 4px      | rounded      |
| Inputs    | 6px      | rounded-md   |
| Avatars   | 50%      | rounded-full |

Consistent, restrained. No rounded-xl or rounded-2xl except on special marketing elements.

### Spacing

Tailwind's 4px base grid. Standard gaps:

| Context              | Gap      |
|----------------------|----------|
| Between sections     | 32px (8) |
| Between cards in grid| 16px (4) |
| Inside cards (padding)| 20px (5)|
| Between form fields  | 16px (4) |
| Between label + input| 6px (1.5)|

### Max Width

Content: `max-w-6xl` (72rem). Not 7xl — tighter feels more intentional.

---

## 4. Components

### Buttons

| Variant   | Background    | Text        | Border       | Usage            |
|-----------|---------------|-------------|--------------|------------------|
| Primary   | brand-500     | white       | —            | Main actions     |
| Secondary | transparent   | zinc-300    | zinc-700 1px | Secondary actions|
| Ghost     | transparent   | zinc-400    | —            | Tertiary, nav    |
| Danger    | red-500/10    | red-400     | red-500/20   | Destructive      |

Hover: Primary darkens (brand-600). Secondary/ghost gets zinc-800 bg. All transitions 150ms.

Size: Single size. `px-4 py-2 text-sm font-medium`. No large/small variants unless truly needed.

### Badges / Status Pills

```
rounded px-2 py-0.5 text-xs font-medium
```

Background: semantic color at 10-20% opacity. Text: semantic color at full saturation. No borders. This replaces the current `rounded-full` pill shape — squared-off badges feel more precise.

### Tables

- Header: `text-xs font-medium text-zinc-400` — sentence case, not uppercase
- Rows: `text-sm text-zinc-200` with `border-b border-zinc-800`
- Hover: `bg-zinc-800/50` transition 150ms
- No alternating row colors
- Clickable rows get `cursor-pointer` and slightly bolder hover

### Cards

```
bg-zinc-900 border border-zinc-800 rounded-lg p-5
```

Hover (if interactive): `border-zinc-700` transition 150ms. No shadow lift.

### Inputs

```
bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-200
placeholder:text-zinc-600
focus: border-brand-500 ring-1 ring-brand-500/20
```

### Toggle Switches

Small, precise. Off: zinc-700 track, zinc-400 knob. On: brand-500 track, white knob. Transition 150ms.

---

## 5. Motion

### Philosophy

Motion communicates state changes, not personality. Every animation earns its place by serving a function: guiding attention, confirming action, or smoothing transitions. If removing an animation wouldn't confuse the user, remove it.

### Timing

| Context              | Duration | Easing        |
|----------------------|----------|---------------|
| Hover/focus          | 150ms    | ease-out      |
| Element enter        | 200ms    | ease-out      |
| Element exit         | 150ms    | ease-in       |
| Page transition      | 200ms    | ease-in-out   |
| Data/chart update    | 300ms    | ease-in-out   |

### Patterns

- **Page transitions:** Subtle opacity fade (1 → 0 → 1) on route change via Inertia. No slide.
- **Deferred content:** Fade-in from opacity 0 when skeleton resolves. 200ms ease-out.
- **Card grids:** Staggered fade-up (translateY 8px → 0, opacity 0 → 1). 50ms delay per card. Max 5 cards animated, rest appear immediately.
- **Stat counters:** No animated counting. Instant render. The data is the point, not the animation.
- **Toasts:** Slide in from right (current is fine). 200ms in, 150ms out.
- **Skeleton shimmer:** Subtle left-to-right gradient sweep. Not pulsing opacity.

### What NOT to animate

- Table row appearance (too many elements, becomes noisy)
- Badge/pill state changes (instant swap)
- Navigation link active state (instant color change)
- Form validation errors (instant appear)

---

## 6. Icons

Inline SVGs. Heroicons outline style (24px default, 20px in compact contexts, 16px inline).

Stroke width: 1.5 (Heroicons default). Color inherits from text (`currentColor`).

No filled icons except for active/selected states (e.g., filled star vs outline star).

No emoji. No decorative icons. Every icon serves a functional purpose.

---

## 7. Logo

The Lien logo (purple rounded-rect with white L-shape) works well at small sizes. On dark backgrounds, the purple fill provides good contrast.

Usage:
- Navigation: `sm` size (24px), no text label
- Welcome page: `lg` size (40px), with "Lien Review" text in zinc-100
- Favicon: purple square with white L

---

## 8. Code & Terminal

### Inline Code

```
bg-zinc-800 text-brand-300 rounded px-1.5 py-0.5 font-mono text-xs
```

Purple-tinted monospace on dark chip. Used for SHAs, file paths, short references.

### Code Blocks

```
bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-[13px] text-zinc-300
```

Line numbers: `text-zinc-500`, right-aligned, non-selectable. Syntax highlighting via Shiki with a dark theme (e.g., `github-dark`, `vitesse-dark`, or custom matching the brand palette).

### Log Viewer

```
bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-[13px]
```

Log levels: info → zinc-400, warning → amber-400, error → red-400. Timestamps in zinc-500. Live indicator: brand-400 dot with subtle pulse.

---

## 9. Responsive Behavior

Breakpoints follow Tailwind defaults: sm(640), md(768), lg(1024), xl(1280).

- Cards: 1 col → 2 col (md) → 3 col (lg)
- Tables: Horizontal scroll on mobile. No card-collapse transformation.
- Nav: Stays horizontal. On mobile (< sm), collapse to logo + hamburger.
- Charts: Full width at all sizes. Maintain aspect ratio.

---

## 10. Accessibility

- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text and UI elements (WCAG AA)
- All interactive elements have visible focus indicators (brand-500 ring)
- `aria-label` on icon-only buttons
- `aria-current="page"` on active nav links
- Semantic HTML: `<nav>`, `<main>`, `<table>` with `<thead>`/`<tbody>`, proper heading hierarchy
- Reduced motion: Respect `prefers-reduced-motion` — disable all transitions/animations
- Color is never the only differentiator — always pair with text labels or icons
