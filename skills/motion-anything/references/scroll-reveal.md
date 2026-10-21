# scroll-reveal: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original CSS starts targets at opacity: 0 until JavaScript observes them.
Use progressive enhancement: leave content visible unless initialization and
IntersectionObserver support succeed, with a no-JS or failed-initialization
fallback. Reveal interactive descendants on keyboard focus immediately, not
only on a scroll/intersection callback.

## Upstream usage guidance

# scroll-reveal

A gentle rise + fade as elements scroll into view. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Long landing pages and stacked content sections.
- Giving a page a calm sense of pace.

## When NOT to use it (restraint)
- Above-the-fold hero content the reader must see instantly.
- Revealing many elements simultaneously — stagger them, max ~3 at once.

## How to apply
1. Copy `scroll-reveal.css` and `scroll-reveal.js` into the project, and link them.
2. Mark elements:
   ```html
   <section data-reveal>…</section>
   <li data-reveal data-reveal-delay="80">…</li>   <!-- optional stagger, ms -->
   ```
3. An IntersectionObserver adds `.is-in` once, when the element enters the viewport.

## Accessibility & performance
- `prefers-reduced-motion`: everything is shown immediately, no travel.
- Animates `transform`/`opacity` only; unobserves each element after it reveals.

## Framework notes
- React: render `data-reveal` attributes and run the init (or an equivalent `useEffect` +
  IntersectionObserver) after mount.

## Bundled implementation files

### File: scroll-reveal.css

<!-- source-file: recipes/web/scroll-reveal/scroll-reveal.css; sha256: 2c67e6642d80c0636ea2b5241e3d93d451a10804e5718991e32421889292fac0 -->
```css
/* scroll-reveal.css — motion-anything recipe · category: scroll-reveal
 * Transforms + opacity only (GPU-safe). Ships a prefers-reduced-motion fallback. */

[data-reveal] {
  opacity: 0;
  transform: translateY(16px);
  /* base band (~520ms), ease-out for content entering toward the user */
  transition: opacity 520ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 520ms cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: var(--reveal-delay, 0ms);
  will-change: opacity, transform;
}
[data-reveal].is-in {
  opacity: 1;
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1; transform: none; transition: none; }
}
```

### File: scroll-reveal.js

<!-- source-file: recipes/web/scroll-reveal/scroll-reveal.js; sha256: 1ac02dbd6b1da49403d92723af3b1f18debcb6ac7b04a2c79dca2f112ffc7c9f -->
```javascript
/* scroll-reveal.js — motion-anything recipe · category: scroll-reveal
 *
 * Reveals [data-reveal] elements as they scroll into view, once.
 * - Respects prefers-reduced-motion (reveals everything immediately).
 * - Optional per-element stagger via data-reveal-delay="80" (milliseconds).
 * - Cleans up: unobserves each element after it reveals.
 *
 * Usage:
 *   <section data-reveal>…</section>
 *   <li data-reveal data-reveal-delay="80">…</li>
 */
(function () {
  'use strict';

  function revealAll() {
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.classList.add('is-in');
    });
  }

  function init() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;

    var reduce =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    els.forEach(function (el) {
      var d = el.getAttribute('data-reveal-delay');
      if (d) el.style.setProperty('--reveal-delay', parseInt(d, 10) + 'ms');
    });

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' }
    );
    els.forEach(function (el) { io.observe(el); });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
```
