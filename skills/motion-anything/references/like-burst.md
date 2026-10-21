# like-burst: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original particles use Math.random and a short cleanup timeout. Keep this
user-triggered interactive example out of a rendered-film clock; translate the
idea into a seeded, seekable master timeline for video. Clean up on teardown.

## Upstream usage guidance

# like-burst

A celebratory particle burst for like / favorite / reaction buttons. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- Like / favorite / upvote / reaction buttons.
- A small, *earned* moment of positive feedback.

## When NOT to use it (restraint)
- Destructive or neutral actions (delete, dismiss, close).
- When more than one burst could fire at once — **one celebratory moment per screen**.
- On load / autoplay. This must be **user-triggered**.

## How to apply
1. Copy `like-burst.css` and `like-burst.js` into the project.
2. Link them, and mark the button:
   ```html
   <link rel="stylesheet" href="like-burst.css" />
   <button class="like-btn" data-like-burst aria-pressed="false" aria-label="Like">♥</button>
   <script src="like-burst.js"></script>
   ```
3. It auto-attaches to any `[data-like-burst]`, or call `attachLikeBurst(el)` manually.

## Tuning
- `PARTICLE_COUNT` / `COLORS` in `like-burst.js` (keep particle count modest — taste over spectacle).
- Pop feel: the `lb-pop` keyframe (currently `420ms`, ease-out). Burst spread: `dist` in `spawnParticles`.

## Accessibility & performance
- Honors `prefers-reduced-motion`: particles are suppressed, a quiet color/scale cue remains.
- Animates `transform`/`opacity` only; removes injected particle nodes after ~700ms.

## Framework notes
- React: call `attachLikeBurst(ref.current)` in `useEffect`; or port the click handler into your
  component and keep the CSS as-is.

## Bundled implementation files

### File: like-burst.css

<!-- source-file: recipes/web/like-burst/like-burst.css; sha256: cc46624d67222f225511f42a203f6f70b50f081bf912bc792ebd28e9f4395e04 -->
```css
/* like-burst.css — motion-anything recipe · category: feedback-delight
 * Timing/easing pulled from MOTION-SPEC.md. Transforms + opacity only (GPU-safe).
 * Always ships a prefers-reduced-motion fallback. */

.like-btn {
  --lb-size: 56px;
  --lb-on: #ff4d6d;
  --lb-off: #c9ccd3;
  width: var(--lb-size);
  height: var(--lb-size);
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #fff;
  color: var(--lb-off);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  /* fast band (140–220ms), ease-out default for user-responsive UI */
  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), color 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.like-btn:hover { transform: scale(1.06); }
.like-btn:active { transform: scale(0.92); }
.like-btn.is-liked { color: var(--lb-on); }

/* Icon "pop" on toggle — a punchy scale that settles. */
@keyframes lb-pop {
  0%   { transform: scale(1); }
  30%  { transform: scale(0.8); }
  60%  { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.like-btn.lb-pop { animation: lb-pop 420ms cubic-bezier(0.16, 1, 0.3, 1); }

/* Particle layer is appended to <body>, positioned at the burst origin. */
.lb-particles {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: 9999;
}
.lb-particle {
  position: absolute;
  top: 0;
  left: 0;
  width: 7px;
  height: 7px;
  margin: -3.5px;
  border-radius: 50%;
  /* deliberate band (~600ms) for a celebratory moment */
  animation: lb-fly 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes lb-fly {
  0%   { transform: translate(0, 0) scale(1); opacity: 1; }
  70%  { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; }
}

/* Accessibility: honor reduced-motion. Keep only a minimal color/scale cue. */
@media (prefers-reduced-motion: reduce) {
  .like-btn,
  .like-btn:hover,
  .like-btn:active { transition: color 120ms ease; transform: none; }
  .like-btn.lb-pop { animation: none; }
  .lb-particles { display: none; }
}
```

### File: like-burst.js

<!-- source-file: recipes/web/like-burst/like-burst.js; sha256: 39de6b26a1630ccfe3108191ab7396bbcd5003924ae6e09b1d5f7f4f5983640c -->
```javascript
/* like-burst.js — motion-anything recipe · category: feedback-delight
 *
 * A celebratory particle burst for like / favorite / reaction buttons.
 * - Fires on user tap only (never auto-plays).
 * - Bursts on the "like" transition only, not on un-like.
 * - Respects prefers-reduced-motion (scale-only fallback).
 * - Cleans up its DOM nodes after the animation (per MOTION-SPEC §5).
 *
 * Usage:
 *   <button class="like-btn" data-like-burst aria-pressed="false">♥</button>
 *   // auto-attaches to [data-like-burst], or:  attachLikeBurst(el)
 */
(function (global) {
  'use strict';

  var PARTICLE_COUNT = 14;
  var COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4d96ff', '#c77dff'];

  function prefersReducedMotion() {
    return (
      global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function spawnParticles(btn) {
    var rect = btn.getBoundingClientRect();
    var cx = rect.left + rect.width / 2 + global.scrollX;
    var cy = rect.top + rect.height / 2 + global.scrollY;

    var layer = document.createElement('div');
    layer.className = 'lb-particles';
    layer.style.left = cx + 'px';
    layer.style.top = cy + 'px';
    document.body.appendChild(layer);

    for (var i = 0; i < PARTICLE_COUNT; i++) {
      var p = document.createElement('span');
      p.className = 'lb-particle';
      var angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.4;
      var dist = 26 + Math.random() * 26;
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      p.style.background = COLORS[i % COLORS.length];
      p.style.animationDelay = Math.random() * 40 + 'ms';
      layer.appendChild(p);
    }
    // Clean up after the burst finishes (600ms anim + max 40ms delay + margin).
    setTimeout(function () {
      layer.remove();
    }, 700);
  }

  function attachLikeBurst(btn) {
    if (!btn || btn.__likeBurstBound) return;
    btn.__likeBurstBound = true;

    btn.addEventListener('click', function () {
      var liked = btn.classList.toggle('is-liked');
      btn.setAttribute('aria-pressed', String(liked));

      // Restart the pop animation from the top.
      btn.classList.remove('lb-pop');
      void btn.offsetWidth; // force reflow so the animation re-triggers
      btn.classList.add('lb-pop');

      if (liked && !prefersReducedMotion()) {
        spawnParticles(btn);
      }
    });
  }

  function autoAttach() {
    var els = document.querySelectorAll('[data-like-burst]');
    for (var i = 0; i < els.length; i++) attachLikeBurst(els[i]);
  }

  global.attachLikeBurst = attachLikeBurst;

  if (document.readyState !== 'loading') autoAttach();
  else document.addEventListener('DOMContentLoaded', autoAttach);
})(window);
```
