# attention-pulse: portable recipe reference

Adapted packaging from nexu-io/motion-anything at `b016900d9ee92fc2d3e4dc520359cc8999d2ed4e`.
Recipe guidance and CSS/JavaScript below retain their upstream contents.
These are interactive-page recipes, not seekable MP4 compositions. Read the
parent skill’s host, accessibility, timing, and export constraints first.
Copy only the files needed into the current project; retain the bundled Apache
notice. No upstream editor, CLI, preview.html, or external runtime is required.

## Open Design portability notes

The original pulse loops indefinitely. In the actual component, bound it to
the relevant attention state, stop it when inactive or acknowledged, and avoid
restarting it to manufacture urgency. Reduced-motion removes the pulse.

## Upstream usage guidance

# attention-pulse

A soft expanding ring to draw the eye to one element. Part of
[motion-anything](https://github.com/nexu-io/motion-anything); obeys `MOTION-SPEC.md`.

## When to use it
- A single primary CTA, an unread/new badge, or a notification dot.

## When NOT to use it (restraint)
- More than one pulsing element at once. As decoration with no real call to act.

## How to apply
1. Copy `attention-pulse.css` and link it.
2. Add `data-pulse` to the element (set `--pulse-color` to match your accent).

## Accessibility & performance
- `prefers-reduced-motion`: no pulse. Transform/opacity only (GPU-safe).

## Bundled implementation files

### File: attention-pulse.css

<!-- source-file: recipes/web/attention-pulse/attention-pulse.css; sha256: 1ccd89a40335ff09d9dc10ed43f5a2c62664bc557dc2df9a8d82cf2ca64c3a5d -->
```css
/* attention-pulse.css — motion-anything recipe · category: attention
 * A soft expanding ring to draw the eye to ONE element. Transform + opacity only.
 * reduced-motion: no pulse. */

[data-pulse] { position: relative; }
[data-pulse]::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid var(--pulse-color, #8b7cf6);
  opacity: 0;
  transform: scale(1);
  animation: ma-pulse 2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
  pointer-events: none;
  will-change: transform, opacity;
}
@keyframes ma-pulse {
  0%   { opacity: 0.5; transform: scale(1); }
  70%  { opacity: 0;   transform: scale(1.5); }
  100% { opacity: 0;   transform: scale(1.5); }
}

@media (prefers-reduced-motion: reduce) {
  [data-pulse]::after { animation: none; display: none; }
}
```
