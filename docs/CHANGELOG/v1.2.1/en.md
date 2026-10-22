---
title: "OpenDesign fork 1.2.1 — Cached project previews"
description: "Keep project browsing lightweight with persistent screenshots, source-aware refresh, and deliberately activated live previews."
---

# Cached project previews — in preparation

## Added

- `od project thumbnail <id> --path <file.html> --out <cover.png> --json`
  reads the same authorized screenshot as the UI. Use `--live-artifact <id>`
  instead of `--path` for a live artifact. Existing output files are not replaced.

## Fixed

- Projects and shared Designs-grid HTML/deck covers, Home's recent-project rail,
  and the editor's project switcher use cached screenshots by default rather
  than accumulating running miniature pages. Screenshots persist across restarts
  and refresh after changes to the source or its local assets.
- Live reduced-size previews load only after 350 ms of deliberate hover/focus.
  Leaving allows 900 ms for re-entry, then unloads the iframe. Switching releases
  the prior preview first; scrolling out of view, navigation, and backgrounding
  also dispose of it. Opening a project retains the full interactive experience.

## Security

- Background capture uses a bounded queue, canonical project-file containment,
  source-revision checks, and project authorization on cache reads. The desktop
  renderer is sandboxed, muted, and time-bounded. Captures bundle local assets
  without fetching remote scripts/assets or using the live project's origin.

## Known limitations and validation

- New captures require the desktop renderer. A bare daemon can reuse existing
  cached screenshots, but a cache miss shows the project initial. Documents that
  depend on remote scripts/assets or dynamic fetches may have incomplete covers.
- A separate packaging issue lets Next.js write route-cache files inside signed
  app resources, invalidating post-run signature verification. This version does
  not fix or bypass that issue.
- Thirty synthetic animated projects retained 30 idle card iframes on baseline
  and zero with this fix. One local ten-second warm-cache CPU/RSS sample improved;
  it is not a GPU measurement or general performance guarantee. See the
  [report and screenshots](../../testing/project-previews.md) for methodology,
  focused regression coverage, and unrun platform/full-suite checks.

This addresses [#16](https://github.com/andremolnar/open-open-design/issues/16).
Version 1.2.1 is in preparation: these notes and a PR merge do not publish a tag,
installer, update feed, or release date. Inherited upstream history is unchanged.
