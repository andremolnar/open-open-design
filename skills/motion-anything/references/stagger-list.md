# stagger-list: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original CSS starts list items at opacity: 0 until JavaScript initializes.
Use progressive enhancement: keep items visible by default and apply the hidden
starting style only after successful initialization, with a no-JS or failed-
initialization fallback. Reveal interactive descendants on keyboard focus; do
not leave a focusable item invisible while waiting for a delayed entrance.

## Upstream usage guidance

# stagger-list

List items rise + fade in, one after another. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Short above-the-fold lists, menus, nav items, or a dropdown opening.

## When NOT to use it (restraint)
- Long / off-screen lists — use `scroll-reveal`. Keep the whole sequence under ~600ms.

## How to apply
1. Copy `stagger-list.css` and `stagger-list.js` and link them.
2. Wrap items: `<ul data-stagger>…</ul>` (optional `data-stagger-step="70"`).

## Accessibility & performance
- `prefers-reduced-motion`: shown immediately. Transform/opacity only.

## Bundled implementation files

### File: stagger-list.css

<!-- source-file: recipes/web/stagger-list/stagger-list.css; sha256: 2ae35e43efb2d3face07115c24eb0e7e9032e65601bf0a5a4297b5b6aeb1e37a -->
```css
/* stagger-list.css — motion-anything recipe · category: entrance · target: list
 * Direct children rise + fade in, staggered. Transform + opacity only.
 * Ships a prefers-reduced-motion fallback. */

[data-stagger] > * {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 440ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 440ms cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: var(--st-delay, 0ms);
  will-change: opacity, transform;
}
[data-stagger].is-in > * { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  [data-stagger] > * { opacity: 1; transform: none; transition: none; }
}
```

### File: stagger-list.js

<!-- source-file: recipes/web/stagger-list/stagger-list.js; sha256: 2b309fb14228c20f26593b115e673ef9e7f607e7949dfc7c4ec7026fcf9ebd0c -->
```javascript
/* stagger-list.js — motion-anything recipe · category: entrance · target: list
 *
 * Staggers the direct children of every [data-stagger] container in on load.
 * Optional step in ms via data-stagger-step="70". Honors prefers-reduced-motion.
 *
 * Usage:  <ul data-stagger> <li>…</li> <li>…</li> </ul>
 */
(function () {
  'use strict';
  function init() {
    var lists = document.querySelectorAll('[data-stagger]');
    if (!lists.length) return;
    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    lists.forEach(function (list) {
      var step = parseInt(list.getAttribute('data-stagger-step') || '70', 10);
      [].slice.call(list.children).forEach(function (child, i) {
        child.style.setProperty('--st-delay', (i * step) + 'ms');
      });
    });

    if (reduce) {
      lists.forEach(function (l) { l.classList.add('is-in'); });
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        lists.forEach(function (l) { l.classList.add('is-in'); });
      });
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
```
