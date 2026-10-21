# magnetic-button: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Upstream usage guidance

# magnetic-button

A button that leans toward the cursor, then springs back. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- A single primary call-to-action you want to feel alive (hero "Get started" / "Try it").

## When NOT to use it (restraint)
- Dense UIs with many buttons — it becomes chaotic. Reserve for 1–2 primary targets.
- Touch-only contexts (no cursor). The recipe disables itself there automatically.

## How to apply
1. Copy `magnetic-button.css` and `magnetic-button.js` into the project, and link them.
2. Mark the button:
   ```html
   <button class="magnetic" data-magnet-strength="0.3">Get started</button>
   ```
3. Auto-attaches to `.magnetic`. Keep `strength` small (~0.2–0.4) so the pull stays subtle.

## Accessibility & performance
- Disabled under `prefers-reduced-motion` and on `(hover: none)` touch devices.
- Transform only; resets on `pointerleave`.

## Framework notes
- React: call `attachMagnetic(ref.current)` in `useEffect`, guarded by the same reduced-motion/touch checks.

## Bundled implementation files

### File: magnetic-button.css

<!-- source-file: recipes/web/magnetic-button/magnetic-button.css; sha256: c0fab96127c4ac2332487a38cdfe20a56d3b2a1203d769debd19f89af0dc3a5f -->
```css
/* magnetic-button.css — motion-anything recipe · category: hover-press
 * Transform only (GPU-safe). Static under reduced-motion / touch. */

.magnetic {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: #8b7cf6;
  color: #fff;
  font: 600 15px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 14px 22px;
  border-radius: 12px;
  cursor: pointer;
  /* fast band; snappy spring-like settle back to rest */
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
  -webkit-tap-highlight-color: transparent;
}
.magnetic:active { transform: scale(0.97); }

@media (prefers-reduced-motion: reduce) {
  .magnetic { transition: none; }
}
```

### File: magnetic-button.js

<!-- source-file: recipes/web/magnetic-button/magnetic-button.js; sha256: 41d29b10aec28137dc3818b38f7a8c87c18ea56bbd0d93bc1c7084a6d053d97e -->
```javascript
/* magnetic-button.js — motion-anything recipe · category: hover-press
 *
 * Pulls a button toward the pointer as it nears, then springs back on leave.
 * - Subtle by design (a few px). Strength via data-magnet-strength (default 0.3).
 * - Disabled under prefers-reduced-motion and on touch (no cursor to attract).
 * - Uses transform only; resets cleanly on pointerleave.
 *
 * Usage:
 *   <button class="magnetic" data-magnet-strength="0.3">Get started</button>
 */
(function (global) {
  'use strict';

  function reduced() {
    return global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function isTouch() {
    return global.matchMedia && global.matchMedia('(hover: none)').matches;
  }

  function attach(btn) {
    if (btn.__magnetBound) return;
    btn.__magnetBound = true;
    var strength = parseFloat(btn.getAttribute('data-magnet-strength')) || 0.3;

    btn.addEventListener('pointermove', function (e) {
      var r = btn.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = 'translate(' + dx * strength + 'px,' + dy * strength + 'px)';
    });
    btn.addEventListener('pointerleave', function () {
      btn.style.transform = '';
    });
  }

  function init() {
    if (reduced() || isTouch()) return; // leave buttons static
    var els = document.querySelectorAll('.magnetic');
    for (var i = 0; i < els.length; i++) attach(els[i]);
  }

  global.attachMagnetic = attach;
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})(window);
```
