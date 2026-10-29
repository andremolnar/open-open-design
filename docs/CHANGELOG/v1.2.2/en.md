---
title: "OpenDesign fork 1.2.2 — Targeted ComfyUI checks"
description: "Test ComfyUI connectivity without downloading the full node catalogue, and validate only the selected workflow's node classes."
---

# Targeted ComfyUI checks — in preparation

## Fixed

- **Test connection** reads `/system_stats` instead of the full `/object_info`
  catalogue. Large collections of custom nodes/models no longer make this
  lightweight check fail because of unrelated schema response size.
- Schema validation and image submission fetch `/object_info/{node_class}` once
  per distinct class used in the selected workflow. Existing model/enum, numeric
  range, required-input and connection-type checks still run before submission.
- The same behavior applies through Settings and the existing `od media comfyui`
  commands. No new UI controls, CLI flags or dependencies are introduced.

## Limits

Health checks remain read-only and do not test GPU generation or establish
workflow compatibility. Health responses are capped at 64 KiB; node schemas keep
8 MiB per-response and aggregate workflow limits. A required node's metadata can
still include its available model/enum choices. The server/proxy must expose the
health and per-node schema routes; failures never trigger a full-catalogue fallback.

See [ComfyUI setup](../../comfyui.md). Version 1.2.2 is in preparation; these notes
do not publish a release date, tag, installer or update feed. Inherited upstream
release history and independent package versions remain unchanged.
