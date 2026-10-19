---
title: "OpenDesign fork 1.0.0 — The local-first baseline"
description: "The first independent fork version collects local-first entry, OpenCode V2, connected-codebase and in-session design workflows, ComfyUI images, safer preview navigation, and explicit manual delivery."
---

# First fork release — in preparation

**1.0.0 starts this fork's own product version sequence.** It collects all
fork-owned work since upstream commit
[`5b19dfa4351b3eed33826ee72746a7c653c23a54`](https://github.com/nexu-io/open-design/commit/5b19dfa4351b3eed33826ee72746a7c653c23a54),
not just the latest enhancement. It is not an upstream OpenDesign release, a
claim of production readiness, or an announcement that binaries have been
published. A release date will be recorded only when publication is authorized.

The inherited product version was `0.23.1`. Existing upstream `0.x` versions,
release notes, links, and contributor credits remain unchanged in the
[pre-fork history](../../../CHANGELOG.md#pre-fork-history--original-opendesign)
and the other version directories. The inherited speaker-notes scrolling and
Nix-retirement entries belong to that history, not this release's fork work.

## Added

- **Connect an existing codebase:** project menus and the `od` CLI can bind a design project to a repository and optional nested app. Connections survive restarts, show unavailable sources, and can be reconnected without moving design files or changing source. ([PR #2](https://github.com/andremolnar/open-open-design/pull/2))
- **Ground designs in read-only source:** use bounded instructions, relevant components, and design tokens from the connected codebase. MCP and CLI clients can resolve exact source/app folders and inspect validated context. Missing, moved, or ambiguous bindings require an explicit selection. No source code is run, installed, or edited by the connection; generated artifacts stay in OpenDesign. ([PR #3](https://github.com/andremolnar/open-open-design/pull/3))
- **Keep work in the coding session already open:** discover authorized project/app connections from the actual caller folder, prepare design guidance and original image assets, track work across restarts, and register finished designs through MCP or `od project discover-context` / `od project work-here`. No second OpenDesign generation run is required. ([PR #5](https://github.com/andremolnar/open-open-design/pull/5), [PR #6](https://github.com/andremolnar/open-open-design/pull/6))
- **Configure MCP for OpenCode:** Settings provides a copyable global configuration. Guides explain background jobs, collaboration data flow, connected codebase context, in-session work, and image attachments. ([PR #4](https://github.com/andremolnar/open-open-design/pull/4))
- **Generate local images with ComfyUI:** Settings → Media providers → ComfyUI manages servers and named OpenDesign-owned API workflows. Import or paste a graph, resolve ambiguous prompt fields, choose PreviewImage/SaveImage output, and enable immutable `comfyui/<workflow-id>@<version>` models. UI and `od media comfyui` / `od media generate` support generation into the requesting project and recovery of recorded submissions without resubmitting to the GPU. ([PR #9](https://github.com/andremolnar/open-open-design/pull/9))
- **Go Back inside previews:** the HTML preview toolbar returns through known SPA/hash history and linked HTML mockups in URL-loaded and inline mode. Back is disabled without known preview-local history, and Return to document remains available. ([#12](https://github.com/andremolnar/open-open-design/issues/12), [PR #13](https://github.com/andremolnar/open-open-design/pull/13))
- **Manual macOS delivery and scoped shipping:** signed builds can launch without installation; `pnpm tools-pack mac deploy` checks signing and installed identity before replacement. `/shipit` documents, validates, commits, and proposes only the identified work. ([PR #1](https://github.com/andremolnar/open-open-design/pull/1), [commit 644b0134f](https://github.com/andremolnar/open-open-design/commit/644b0134f))

## Changed

- **Home without mandatory Cloud login:** fresh and returning users, expired sessions, incomplete old setup flags, and legacy onboarding links reach Home. Signing out keeps local projects/settings available; new installations choose an available local agent rather than a signed-out Cloud agent.
- **No automatic product call-home:** detached builds disable product analytics, replay, traces, automatic crash/startup diagnostics, and default upstream update/offer/highlights checks. Explicit account, provider, and diagnostic-export actions remain possible. Optional hosted integrations are not claimed to be offline.
- **ComfyUI typed defaults:** new versions expose optional prompt, seed, dimension, numeric, and boolean overrides; omitted fields retain defaults. Discovery includes stable keys, defaults, node identity/type, semantic roles, and prompt usage, but excludes graphs, credentials, and read-only values. Unclear strings, model/file/enum choices, links, structured values, and batch controls remain read-only. Previously published versions retain required inputs until edited, saved, and enabled as a new version.
- **Explicit ComfyUI execution choices:** request server override → optional workflow preference → sole saved server; otherwise ask the user. Workflows are not permanently server-bound. Connection tests are per server, Add server is separate, seed/size variants run sequentially with unique request IDs, and recovery preserves the original server/prompt identity. The Settings-only generation test and destination selector are removed.
- **Host-authored previews are not delegated runs:** an existing coding session can save a preview without Cloud login; delegated generation is separate and can use an available local CLI.
- **Independent maintainership and versioning:** contributor/translation/privacy/deployment guidance names this fork and its sole maintainer. Product manifests now use 1.0.0 and future user-visible shipments follow SemVer; independently versioned libraries and vendored packages retain their own versions.

## Fixed

- **OpenCode V2 integration:** session start/resume, models and variants, permissions, MCP, tool events/previews, and BYOK configuration use V2-compatible shapes. Selected images are attached as files rather than text paths. ([PR #1](https://github.com/andremolnar/open-open-design/pull/1), [PR #5](https://github.com/andremolnar/open-open-design/pull/5))
- **Model names remain exact:** provider namespaces, aliases, and spaces survive discovery, picking, custom IDs, connection tests, and generation. Invalid explicit choices fail instead of silently falling back to the CLI default. ([#10](https://github.com/andremolnar/open-open-design/issues/10), [PR #11](https://github.com/andremolnar/open-open-design/pull/11))
- **MCP survives updates and idle time:** packaged registrations launch through a stable installed-app path and rediscover the daemon after socket changes. OpenCode connections no longer expire after 30 idle minutes; resource templates can be listed without a protocol error. ([PR #4](https://github.com/andremolnar/open-open-design/pull/4))
- **Recovered local-only projects stay local:** explicitly recovered Personal projects remain accessible when signed out instead of being silently claimed by later workspace reads; files and assets remain in place.
- **Saved documents can be reopened:** after following a preview link, the toolbar or design-file thumbnail returns to the original document without leaving the project.
- **ComfyUI failures explain the next step:** graph imports populate the editor, Save describes missing setup, and cancelling Add server preserves unsaved fields. Bare `comfyui` requests list enabled versioned workflows. Agent guidance preserves dimensions, distinguishes unsupported options, and avoids diagnosing every configuration error as a missing API key. ([PR #9](https://github.com/andremolnar/open-open-design/pull/9))

## Removed

- Repository-owned GitHub Actions checks, publication, scheduled refreshes, and PR automation. Operators run validation and release tools explicitly; a push or merge does not publish anything.
- Upstream-only contribution machinery and roadmap/governance/program claims as active fork policy. Historical author and contributor attribution is preserved.

## Limitations and release status

- ComfyUI remains experimental and image-only: one standard PNG per job; no reference uploads, video/audio, multi-output/non-PNG import, automatic restart reconciliation, compatibility routing, or blind submission retries. Fixture protocol tests do not establish live inference; real GPU generation and originating-project import remain unverified.
- Preview Back resets ambiguous traversal to a safe baseline. Linked-file Back reopens saved content, not the old in-memory DOM/SPA state; transient file history is capped at 64 transitions and clears on leaving its active project/file chain.
- Hosted integrations still exist. Bring-your-own cloud/collaboration and complete offline or enterprise-certified use remain goals, not guarantees of version 1.0.0.
- This source update does not publish a Git tag, installer, update feed, or hosted What's New document. No new packaged desktop acceptance or real GPU acceptance is claimed by these notes.

See the [root changelog](../../../CHANGELOG.md#fork-release-history) for the
cumulative record and [README](../../../README.md) for the fork's direction.
