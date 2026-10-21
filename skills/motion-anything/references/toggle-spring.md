# toggle-spring: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original form example is illustrative, not a complete accessible control.
Use type="button" (to avoid submitting an enclosing form) and a project-specific
accessible name, for example aria-label="Enable notifications". Synchronize the
initial .on class and aria-pressed state from the real setting. Preserve native
keyboard activation and do not use motion as the sole state indication.

## Upstream usage guidance

# toggle-spring

A switch whose knob springs across on toggle. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- On/off switches in settings and forms; any binary state the user flips themselves.

## When NOT to use it (restraint)
- To convey loading/progress (use a spinner/skeleton). Keep the overshoot subtle, not gimmicky.

## How to apply
1. Copy `toggle-spring.css` and `toggle-spring.js` and link them.
2. Markup: `<button class="ms-toggle" data-toggle aria-pressed="false"><span class="knob"></span></button>`.

## Accessibility & performance
- `prefers-reduced-motion`: quick linear slide, no overshoot. `aria-pressed` reflects state. Transform only.

## Bundled implementation files

### File: toggle-spring.css

<!-- source-file: recipes/web/toggle-spring/toggle-spring.css; sha256: 0804fbda13c42dcc6d72d5e527d41377f0598244c40e64d3ebe53e1a2cfc954b -->
```css
/* toggle-spring.css — motion-anything recipe · category: feedback-delight · target: button
 * A switch whose knob springs across on toggle. Transform only (GPU-safe).
 * reduced-motion: quick linear slide, no overshoot. */

.ms-toggle {
  display: inline-flex;
  align-items: center;
  width: 52px;
  height: 30px;
  border-radius: 999px;
  background: #d8d6cf;
  border: 0;
  padding: 3px;
  cursor: pointer;
  transition: background 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.ms-toggle .knob {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  transform: translateX(0);
  transition: transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1); /* spring overshoot */
  will-change: transform;
}
.ms-toggle.on { background: #8b7cf6; }
.ms-toggle.on .knob { transform: translateX(22px); }

@media (prefers-reduced-motion: reduce) {
  .ms-toggle .knob { transition: transform 0.15s linear; }
}
```

### File: toggle-spring.js

<!-- source-file: recipes/web/toggle-spring/toggle-spring.js; sha256: fa97dcff56fcc611763ddac398046ace8786c6b4b6605c52d3d9d8bb656b7cd0 -->
```javascript
/* toggle-spring.js — motion-anything recipe · category: feedback-delight
 *
 * Click any [data-toggle] to flip its .on state; the knob springs across (CSS handles the spring).
 * Reflects state via aria-pressed for accessibility.
 *
 * Usage:  <button class="ms-toggle" data-toggle aria-pressed="false"><span class="knob"></span></button>
 */
(function () {
  'use strict';
  function init() {
    document.querySelectorAll('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = btn.classList.toggle('on');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
```
