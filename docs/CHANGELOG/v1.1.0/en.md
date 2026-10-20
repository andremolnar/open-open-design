---
title: "OpenDesign fork 1.1.0 — Reveal project files"
description: "Open a project's location or reveal an individual design file or folder in Finder, Explorer, or the native Linux file manager directly from Design Files."
---

# Native file browser actions — in preparation

## Added

- In a **project menu** (`…`), alongside **Connect/Manage codebase**, choose
  **Reveal in Finder** (macOS), **Reveal in Explorer** (Windows), or
  **Reveal in file manager** (Linux) to locate the design project on disk.
  The action is available in recent-project rail menus, project cards, the
  in-project switcher, and **Design Files → Project actions**.
- File and folder menus offer the same action. Right-click a file row, HTML
  preview card, image card, or folder to reveal that item without opening it
  in its associated application. On Linux the containing folder opens because
  file managers do not share a portable item-selection command.
- The CLI exposes the same operation:
  `od project reveal <id> [--path <project-relative-path>] [--json]`.
- The daemon resolves locations from the authorized project, including imported
  folder projects. Absolute paths, traversal, and symlinks outside the project
  are rejected. Missing paths, unavailable native file browsers, and launch
  failures are reported rather than silently ignored.

## Scope and release status

These actions locate **design project storage**, not the separately connected
source repository. They launch the native browser on the **daemon host**; a
remote web browser cannot open its own machine's filesystem through this action.
Existing read-only viewer restrictions on these menus remain in place.

Version 1.1.0 is a backward-compatible enhancement after the
[1.0.0 fork baseline](../v1.0.0/en.md). It is in preparation: these source notes
do not publish a tag, installer, update feed, or hosted highlights document.
Pre-fork versions and attribution remain unchanged in the
[root changelog](../../../CHANGELOG.md).
