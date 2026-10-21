---
name: motion-anything
description: "Turn a motion intent into restrained, accessible HTML/UI animation using a timing standard and ten bundled recipes. Use existing GSAP helpers for complex choreography and the host Motion Design route for actual video delivery; this does not install an editor."
en_name: "Motion Anything · Intent to Motion"
zh_name: "Motion Anything · 意图到动效"
zh_description: "以节奏、克制与无障碍规范选择十个内置网页动效配方；复用现有 GSAP 技能与宿主视频交付能力，不安装编辑器或额外运行时。"
triggers:
  - "motion-anything"
  - "add motion"
  - "restrained animation"
  - "animated webpage"
  - "motion"
  - "动效"
  - "动画"
  - "加动效"
  - "意图到动效"
license: Apache-2.0
od:
  mode: utility
  category: animation-motion
  upstream: "https://github.com/nexu-io/motion-anything"
  source-commit: b016900d9ee92fc2d3e4dc520359cc8999d2ed4e
---

# Motion Anything: intent to restrained motion

Adapted from motion-anything's router and motion standard. Choose the smallest
amount of movement that communicates the user's intent. Do not turn a request
for polish into a new project, an editor installation, or an unrelated video.

## Open Design execution context

Preserve the active host's route, stage, authorization and output contract.
Planning describes the motion; author files only in the host's authoring stage.
Use the existing plan rather than adding a mandatory review/approval workflow.
Loading this helper does not grant browser, shell, rendering or installation
capabilities. Use only tools actually available and allowed for this task.
Keep files inside the current project and resolve bundled reference paths from
the skill root supplied by the host, including frozen session packages.

Read **references/MOTION-SPEC.md** for timing, easing, restraint, accessibility
and intent categories. Treat it as a default craft standard: existing brand
tokens and the actual brief win. Its UI rules do not impose film-wide duration
or choreography limits. Clarify only if ambiguity materially changes the work;
otherwise choose a restrained interpretation and state the meaningful assumption.

## Choose the real delivery path

- **Interactive page or UI:** edit the project's HTML/CSS/JavaScript or existing
  framework components. Preserve pointer, keyboard, focus and reduced-motion
  behavior. The references below are interactive examples, not video exports.
- **Actual video request:** use the host's Motion Design guidance and existing
  plan/delivery contracts. Author visible editable source with a deterministic,
  seekable, paused GSAP master at `window.__timelines.main`, declared duration/dimensions,
  the motion output/audio markers, and a link to the actual MP4. Render only
  through OD media scaffold/generate/wait. Validated motion MP4 export requires
  the desktop frame renderer; a headless browser override is not a substitute.
  Never label HTML or a queued/failed render as a finished video.

Do not invoke HyperFrames directly for init, preview, render or installation,
including through npx; the OD wrapper owns telemetry suppression. Do not enable
analytics, fetch an editor, install companion skills automatically, or copy
upstream-specific export controls. This helper does not provide a graphical
timeline, a canvas compositor, a Download-to-MP4 button, or a second export API.

CSS keyframes, event listeners, observers, random bursts and browser timers in
the references are **not deterministic film clocks**. For video, translate the
visual idea into the existing GSAP timeline, with seeded randomness where
needed, instead of running these interactive scripts beside the render clock.

## Classify, choose, apply

1. Identify the surface and purpose: feedback, spatial continuity, attention,
   entrance, state transition, loading, or kinetic typography. Existing content,
   exact copy and user intent remain authoritative.
2. Choose the smallest useful recipe set below. Check each recipe's “when not
   to use” guidance. A view gets at most one competing celebration/attention
   moment; short sequences should not delay content the user must read or use.
3. Read the selected reference. Each contains its usage guide and the complete
   named CSS/JavaScript files as fenced blocks. Copy only the necessary code
   into the current project; no upstream checkout or preview file is required.
   Retain attribution and **references/LICENSE.txt** with redistributed code.
4. Adapt selectors and lifecycle to the existing component. Avoid duplicate
   initialization; remove listeners/timers/observers on teardown, stop inactive
   motion, and handle reduced-motion preference changes. Read the reference’s
   portability notes: original examples can need grapheme-safe text splitting,
   shadow/promotion fixes, or bounded loops. Keep keyboard access
   and control semantics intact. Prefer no motion over a decorative delay.
5. Within the host's allowed checks, verify the states actually affected and
   distinguish observed results from unverified visual/performance claims.
   Briefly explain the chosen purpose and anything deliberately left still.

## Bundled recipe reference shelf

| Reference | Purpose | Restraint |
| --- | --- | --- |
| references/fade-in-up.md | Small entrance | Do not hide must-read content |
| references/stagger-list.md | Short sequential list | No long delayed lists; cap total sequence |
| references/scroll-reveal.md | On-view entrance | Content remains reachable without animation |
| references/card-lift-hover.md | Clickable-card feedback | Not decoration on noninteractive cards |
| references/magnetic-button.md | Primary pointer CTA | Disable on touch/reduced motion |
| references/toggle-spring.md | Toggle state feedback | State remains immediate and accessible |
| references/like-burst.md | Earned celebration | User-triggered, on like only, never autoplay |
| references/loading-shimmer.md | Real pending state | Remove when data arrives; no fake progress |
| references/attention-pulse.md | One meaningful attention cue | Do not compete with other loops |
| references/kinetic-headline.md | One short hero line | Not body text or a substitute for reading time |

These are ten curated web recipes, not the upstream full recipe catalogue or
editor. Code is provided as reference material, not an automatically injected
runtime. Source paths and implementation hashes: **references/provenance.json**.
Attribution, changes and excluded material: **references/NOTICE.md**.

## Reuse existing companions without replacing them

If available and allowed by the host, use `gsap-core`, `gsap-timeline`,
`gsap-scrolltrigger`, `gsap-plugins`, `gsap-performance`, `gsap-utils`,
`gsap-frameworks` or `gsap-react` for their specific topics. Their MIT skill
content does not relicense the separate GSAP runtime. Use the fork's existing
`web-clone` only for an authorized website-reproduction task; preserve its
project paths, browser requirements, rights checks and privacy safeguards.

The install-on-demand shader-extraction and website-token wrappers from upstream
are not bundled tools here. Do not promise they exist or download them on behalf
of this helper. The upstream editor and its browser export conventions are not
part of this port.
