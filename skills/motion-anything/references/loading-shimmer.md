# loading-shimmer: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Upstream usage guidance

# loading-shimmer

Skeleton placeholders with a soft sweeping highlight. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Placeholders for content still loading (cards, lists, profiles, media). Improves perceived performance.

## When NOT to use it (restraint)
- Loads under ~300ms (a skeleton flash is worse than nothing). Never as pure decoration.

## How to apply
1. Copy `loading-shimmer.css` and link it.
2. Add `data-skeleton` to placeholder blocks (give each a width/height).
3. Remove the placeholders (or the attribute) the moment real content arrives.

## Accessibility & performance
- `prefers-reduced-motion`: static skeleton, no sweep. The sweep uses `transform` only (GPU-safe).

## Bundled implementation files

### File: loading-shimmer.css

<!-- source-file: recipes/web/loading-shimmer/loading-shimmer.css; sha256: 29158d9c9cb8115bbfa30d15ec8512f9f4783997925b856f8b60deee25286991 -->
```css
/* loading-shimmer.css — motion-anything recipe · category: loading
 * Skeleton placeholders with a soft sweeping highlight.
 * The sweep is a pseudo-element moved with transform (GPU-safe — no layout/paint thrash).
 * reduced-motion: static skeleton, no sweep. */

[data-skeleton] {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: #e9eaee;
}
[data-skeleton]::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.6) 50%,
    rgba(255, 255, 255, 0) 100%);
  animation: ma-shimmer 1.4s ease-in-out infinite;
  will-change: transform;
}
@keyframes ma-shimmer {
  100% { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  [data-skeleton]::after { animation: none; display: none; }
}
```
