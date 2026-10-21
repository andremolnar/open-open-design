# Motion Design

Motion Design is a focused port of [upstream PR #8619](https://github.com/nexu-io/open-design/pull/8619),
as shipped by [`81cbb979`](https://github.com/nexu-io/open-design/commit/81cbb979)
in OpenDesign 0.25.0. It is not a merge of the upstream release.

## Start a project

Choose **Motion Design** after **Prototype** on Home or in Community. Five bundled
examples provide editable reference material: Motion Future, Product Promo,
Showreel, UI Morph, and Visual Lesson. The `@` picker also exposes the motion
design skill and the curated animation helpers. The additional Motion Anything
helper supplies intent routing, timing/restraint guidance and ten portable web
recipe references; see [scope and provenance](motion-anything-skills.md).

The CLI entry is equivalent:

```sh
od project create --name "Product reveal" --task-type motion-design --prompt-file brief.txt --json
```

The brief determines the deliverable. Ask for a video to receive editable source
and an MP4; ask for an interactive animation to retain runnable HTML. Choosing a
category does not authorize a film or execute a plan-only request.

## Source, playback, and export

Video source lives in the project's visible `motion-source/<id>` directory.
`od media scaffold --composition-dir motion-source/<id>` creates local scaffolding
and a pinned GSAP file. Generation uses the existing `hyperframes-html` media
renderer; the source links its actual MP4 output. The exporter checks that the
output is inside the project, contains a decodable video frame, and satisfies
the source's declared audible or silent policy. Audio must be a supported local
file inside the composition. Export failures keep editable source available.

The preview loops video compositions with synchronized audio and stops playback
when the preview is inactive, including switching to Code or Home. Ordinary HTML
prewarming, prototype Back navigation, and native Reveal remain independent.
Motion video exports require the existing desktop Chromium/FFmpeg route so the
authored timeline is checked before rendering. The headless HyperFrames CLI
normalizes the timeline before validation, so marked motion fails closed without
a desktop renderer (even with `HYPERFRAMES_BROWSER_PATH` configured). Legacy,
unmarked HyperFrames compositions retain their existing headless override.
This port does not add an export service or cloud account.

## Scope and privacy

- The fork's existing task contracts, planning, production, settlement, connected
  codebase context, and ComfyUI integrations remain in place.
- No new motion telemetry, click tracking, task analytics dimensions, SDKs, or
  collection endpoints are included. The fork's detached/no-call-home defaults
  are unchanged. Optional providers and deliberate network operations are not
  claimed to be offline.
- The existing HyperFrames CLI subprocess now forces `HYPERFRAMES_NO_TELEMETRY=1`
  and `DO_NOT_TRACK=1`, overriding inherited opt-ins. Motion authoring guidance
  routes scaffold/generate/wait through OD and prohibits direct HyperFrames
  init/preview/render or `npx` calls. Bundled previews do not launch the CLI.
- GSAP 3.14.2 is the only added package dependency; it has no transitive
  dependencies. Example scripts, fonts, and original soundtracks are bundled.
  See [template sources and licenses](motion-template-sources.md).
- Upstream's Vela CLI installation changes, unrelated orchestration migration,
  and automatic preview publishing are not part of this port.
- There is no graphical timeline editor or Remotion adapter in this change.
  Editing remains source- and prompt-based. The shared source-player contract
  and media export boundary are distinct from any future editor or renderer.

## Verification

Relevant checks include the motion source-player contract tests; daemon motion,
audio, scaffold, export, preview/containment, and CLI suites; Home/Community and
preview lifecycle tests; the offline template-package regression; and the
Playwright motion playback/template suites. The pull request records exactly
which checks ran and any environment limits. Source-version preparation does
not publish a binary, tag, update feed, or hosted preview.
