---
title: "OpenDesign fork 1.2.0 — Upstream motion and security hardening"
description: "Bring upstream motion capabilities into the fork, audit dependencies and assets, and replace unsafe download-and-execute setup guidance."
---

# Upstream motion capabilities and security hardening — in preparation

## Added

- **Motion Design** appears after Prototype on Home and in Community, with
  five bundled examples: Motion Future, Product Promo, Showreel, UI Morph,
  and Visual Lesson. Curated motion helpers are available in the `@` picker.
- Video briefs produce visible editable HTML/assets and an MP4 through the
  existing HyperFrames renderer. Interactive animation remains runnable HTML;
  selecting the category does not execute a plan-only request.
- Motion source playback loops with synchronized local audio and supports host
  activity controls. Rendering checks source/output linkage, decodable video,
  and the declared audible/silent policy; remaining boundary risks are noted below.
- CLI parity: `od project create --task-type motion-design --prompt-file brief.txt`
  and visible `motion-source/<id>` scaffolding through `od media scaffold`.
- Motion Anything intent-routing helper with a bundled motion standard and ten
  dependency-free web recipe references. Existing GSAP/web-clone integrations
  are reused; no editor, automatic skill installation or telemetry is added.

## Changed

- Update reviewed dependencies and pin pnpm 10.34.7. A single workspace policy
  also governs assembled app dependencies. Electron 45 uses SQLite 13's stable
  Node-API binaries; native macOS file watching avoids the descriptor regression.

## Removed

- Download-and-execute shell pipelines, dynamic evaluation of fetched PowerShell,
  TLS/sandbox bypass guidance, floating CLI commands, and mandates to install
  missing tooling automatically. Missing capabilities are reported; installation
  requires a separately reviewed plan and explicit approval.

## Security

- Audit imported assets and dependency provenance, verify registry integrity and
  signatures, and pin optional Python packages with platform-specific wheel
  hashes. Controlled installs disable dependency lifecycle scripts. Final OSV
  checks found **0 matches across 1,225 workspace npm versions** and **158 npm
  versions in the signed macOS app**; this is not a security certification.
- Preserve macOS quarantine/provenance attributes during builds and artifact
  finalization. A local Apple Development-signed arm64 app passed strict recursive
  verification and was installed via the repository deployment script. No
  notarization or public artifact publication was performed.

## Known limitations

- The HTML preview has no MP4 export or generic recording button. Ask the project
  agent to render the timed motion, then download the resulting MP4 artifact.
- Media read containment/protocol restrictions, destructive optional helper flags,
  telemetry-bearing dependencies, and licensing/notice questions remain open.
  See the [security audit](../../motion-patch-security-audit-2026-10-21.md) and
  [remediation report](../../motion-dependency-remediation-2026-10-21.md).
- Live project-card preview performance is a separate follow-up in
  [#16](https://github.com/andremolnar/open-open-design/issues/16), not fixed here.

## Scope and release status

This selectively ports [upstream PR #8619](https://github.com/nexu-io/open-design/pull/8619)
as shipped in 0.25.0. It preserves fork task orchestration, connected codebase
context, ComfyUI workflows, preview Back navigation and native Reveal.
New motion telemetry and unrelated Vela installation changes are excluded;
the existing no-call-home defaults remain unchanged. GSAP's runtime has no
transitive dependencies; this branch also includes the separately reviewed
dependency remediation and packaging compatibility work above. Excluding new
telemetry does not mean all telemetry-bearing third-party code was removed.

There is no graphical timeline editor or Remotion adapter in this version.
See [Motion Design](../../motion-design.md) for usage, export requirements,
privacy scope and template provenance.

Version 1.2.0 is in preparation. These source notes do not publish a tag,
installer, update feed or hosted preview. Inherited upstream attribution and
version history remain unchanged.
