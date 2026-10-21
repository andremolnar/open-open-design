# fade-in-up: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original CSS starts content at opacity: 0 until JavaScript initializes.
Use progressive enhancement: keep content visible by default and apply the
hidden starting style only after successful initialization, with a no-JS or
failed-initialization fallback. Never permanently hide must-read content. Reveal
interactive descendants on keyboard focus so a focused control is always visible.

## Upstream usage guidance

# fade-in-up

A clean rise + fade entrance, on load. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Hero content and a few key elements appearing on first paint.

## When NOT to use it (restraint)
- Long lists / off-screen content — use `scroll-reveal`.
- Don't delay must-read content by more than ~300ms; keep to ≤3 staggered elements.

## How to apply
1. Copy `fade-in-up.css` and `fade-in-up.js` and link them.
2. Mark elements: `<h1 data-fade>…</h1>` (optional `data-fade-delay="80"`; auto-staggers otherwise).

## Accessibility & performance
- `prefers-reduced-motion`: shown immediately. Transform/opacity only.

## Bundled implementation files

### File: fade-in-up.css

<!-- source-file: recipes/web/fade-in-up/fade-in-up.css; sha256: a58d3d25f8ba53fffba801c0ebc78da1c6dcfb5d42fad4e2374cc675c8d9764d -->
```css
/* fade-in-up.css — motion-anything recipe · category: entrance
 * Transform + opacity only. Ships a prefers-reduced-motion fallback. */

[data-fade] {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 460ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 460ms cubic-bezier(0.16, 1, 0.3, 1);
  transition-delay: var(--fade-delay, 0ms);
  will-change: opacity, transform;
}
[data-fade].is-in { opacity: 1; transform: none; }

@media (prefers-reduced-motion: reduce) {
  [data-fade] { opacity: 1; transform: none; transition: none; }
}
```

### File: fade-in-up.js

<!-- source-file: recipes/web/fade-in-up/fade-in-up.js; sha256: 34b80163bf7bf944c85b64ebfdf70e5882c0aa6cbfebb111e8427543a516baf1 -->
```javascript
/* fade-in-up.js — motion-anything recipe · category: entrance
 *
 * Rises + fades [data-fade] elements in on load. Optional per-element stagger via
 * data-fade-delay="80" (ms), or auto-staggered by document order when omitted.
 * Honors prefers-reduced-motion (shows everything immediately).
 *
 * Usage:  <h1 data-fade>…</h1>  <p data-fade data-fade-delay="80">…</p>
 */
(function () {
  'use strict';
  function init() {
    var els = document.querySelectorAll('[data-fade]');
    if (!els.length) return;

    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    els.forEach(function (el, i) {
      var d = el.getAttribute('data-fade-delay');
      el.style.setProperty('--fade-delay', (d != null ? parseInt(d, 10) : i * 70) + 'ms');
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        els.forEach(function (el) { el.classList.add('is-in'); });
      });
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
```
