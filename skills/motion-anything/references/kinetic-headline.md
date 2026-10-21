# kinetic-headline: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original letter mode uses UTF-16 text.split(''), not grapheme segmentation.
For emoji, combined marks or complex scripts, adapt it to Intl.Segmenter (with
a compatible fallback) and preserve the accessible unsplit text. Prefer words
mode where appropriate. Wave is a continuous loop: stop it when inactive.

## Upstream usage guidance

# kinetic-headline

Words or letters stagger in, one after another. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- One hero headline or a single key line. Title cards in launch / release videos.

## When NOT to use it (restraint)
- Body copy or must-read content. Never more than one kinetic line per screen.

## How to apply
1. Copy `kinetic-headline.css` and `kinetic-headline.js` and link them.
2. Mark a heading: `<h1 data-kinetic>…</h1>` (or `data-kinetic="letters"` for short lines).

## Accessibility & performance
- `prefers-reduced-motion`: shown immediately. Transform/opacity only.

## Bundled implementation files

### File: kinetic-headline.css

<!-- source-file: recipes/web/kinetic-headline/kinetic-headline.css; sha256: b679698ed57463ec447cfb50b3e63cf27a5a497388549b41108fe3797df89093 -->
```css
/* kinetic-headline.css — motion-anything recipe · category: text-kinetic
 * Words/letters stagger in. The STYLE is chosen by data-kinetic-anim (→ .k-anim-* class in JS),
 * mirroring the video engine's kinetic presets. Transform/opacity/filter only. Reduced-motion safe. */

[data-kinetic] { display: inline-block; }

/* base: hidden units that transition to their resting state on .is-in */
[data-kinetic] .k-unit {
  display: inline-block;
  opacity: 0;
  transition: opacity 520ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 520ms cubic-bezier(0.16, 1, 0.3, 1),
              filter 520ms ease-out;
  transition-delay: var(--k-delay, 0ms);
  will-change: opacity, transform, filter;
}
[data-kinetic].is-in .k-unit { opacity: 1; transform: none; filter: none; }

/* preserve spaces between word units */
[data-kinetic] .k-space { display: inline-block; width: 0.28em; }

/* ── presets: the initial (pre-reveal) state per style ───────────────────────── */
.k-anim-rise  .k-unit { transform: translateY(0.5em); }
.k-anim-drop  .k-unit { transform: translateY(-0.5em); }
.k-anim-fade  .k-unit { transform: none; }
.k-anim-slide .k-unit { transform: translateX(0.6em); }
.k-anim-pop   .k-unit { transform: scale(0.4);
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }   /* overshoot */
.k-anim-blur  .k-unit { transform: none; filter: blur(10px); }
.k-anim-flip  .k-unit { transform: rotateX(-90deg); transform-origin: bottom; }
.k-anim-spin  .k-unit { transform: rotate(-18deg) scale(0.6); }
.k-anim-typewriter .k-unit { transform: none; transition-duration: 1ms; }  /* hard, staggered = typing */

/* continuous, ambient — no reveal; each unit rides a slow wave */
.k-anim-wave .k-unit {
  opacity: 1;
  animation: kh-wave 1.8s ease-in-out infinite;
  animation-delay: var(--k-delay, 0ms);
}
@keyframes kh-wave { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.22em); } }

@media (prefers-reduced-motion: reduce) {
  [data-kinetic] .k-unit {
    opacity: 1 !important; transform: none !important; filter: none !important;
    transition: none; animation: none !important;
  }
}
```

### File: kinetic-headline.js

<!-- source-file: recipes/web/kinetic-headline/kinetic-headline.js; sha256: d787254a7877a0d9bcc42cb25c5291f0b033b8d86a47b5dafa5ded18ba566913 -->
```javascript
/* kinetic-headline.js — motion-anything recipe · category: text-kinetic
 *
 * Splits [data-kinetic] text into words (default) or letters (data-kinetic="letters") and staggers
 * them in on load. The animation STYLE is chosen with data-kinetic-anim (mirrors the video engine's
 * kinetic presets): rise (default) · fade · drop · pop · blur · flip · spin · slide · typewriter ·
 * wave (continuous, ambient). Honors prefers-reduced-motion (shows everything at once).
 *
 * Usage:
 *   <h1 data-kinetic>Words that move</h1>
 *   <h1 data-kinetic="letters" data-kinetic-anim="pop">Short line</h1>
 *   <h1 data-kinetic="letters" data-kinetic-anim="wave">ambient wave</h1>
 */
(function () {
  'use strict';

  function split(el) {
    var mode = el.getAttribute('data-kinetic') || 'words';
    var text = el.textContent;
    el.textContent = '';
    var step = (mode === 'letters') ? 40 : 70;
    var units = (mode === 'letters') ? text.split('') : text.split(/(\s+)/);
    var i = 0;
    units.forEach(function (u) {
      if (u === '') return;
      if (/^\s+$/.test(u)) {
        var sp = document.createElement('span');
        sp.className = 'k-space';
        el.appendChild(sp);
        return;
      }
      var s = document.createElement('span');
      s.className = 'k-unit';
      s.textContent = u;
      s.style.setProperty('--k-delay', (i * step) + 'ms');
      i++;
      el.appendChild(s);
    });
  }

  function init() {
    var els = document.querySelectorAll('[data-kinetic]');
    if (!els.length) return;
    var reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.forEach(function (el) {
      el.classList.add('k-anim-' + (el.getAttribute('data-kinetic-anim') || 'rise'));
      split(el);
    });
    if (reduce) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
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
