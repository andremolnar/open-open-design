# card-lift-hover: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original CSS also transitions box-shadow and keeps will-change set.
These are not proof of transform-only/GPU-safe behavior. Prefer a static shadow
or an opacity-faded shadow layer, and scope/remove promotion in the actual
component; follow the host performance rules over the original recipe claims.

## Upstream usage guidance

# card-lift-hover

A clickable card that lifts on hover. Pure CSS. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Clickable cards / tiles in a grid that should feel tactile.

## When NOT to use it (restraint)
- Non-interactive cards — the lift implies it is clickable.
- Very dense grids where many simultaneous lifts feel noisy.

## How to apply
1. Copy `card-lift-hover.css` and link it.
2. Add the class: `<a class="lift-card" href="…">…</a>`. No JavaScript needed.

## Accessibility & performance
- `prefers-reduced-motion`: no lift (a subtle shadow change remains). Transform + shadow only.

## Bundled implementation files

### File: card-lift-hover.css

<!-- source-file: recipes/web/card-lift-hover/card-lift-hover.css; sha256: 4aa2ef9232a5d7438af65951502df3e3d9f21aa5eedee73c5a45a68cee33a46e -->
```css
/* card-lift-hover.css — motion-anything recipe · category: hover-press
 * Pure CSS. Transform + shadow only. Static under reduced-motion. */

.lift-card {
  transform: translateY(0);
  box-shadow: 0 2px 10px rgba(20, 18, 14, 0.06);
  /* fast band, ease-out */
  transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 200ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform;
}
.lift-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 16px 32px rgba(20, 18, 14, 0.13);
}
.lift-card:active {
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .lift-card,
  .lift-card:hover,
  .lift-card:active { transform: none; transition: box-shadow 120ms ease; }
}
```
