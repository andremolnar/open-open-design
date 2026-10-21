# Motion Anything skills: selective integration

The `motion-anything` functional helper is adapted from
[`nexu-io/motion-anything` at b016900d9ee92fc2d3e4dc520359cc8999d2ed4e](https://github.com/nexu-io/motion-anything/tree/b016900d9ee92fc2d3e4dc520359cc8999d2ed4e),
dated July 7, 2026. Select it in the existing `@` skill picker. It is a skill
integration, not the separate application's graphical editor or export engine.

## What is available

- A host-adapted intent router: classify the purpose, choose restrained motion,
  apply the smallest useful recipe set, and retain accessibility/lifecycle care.
- The bundled MOTION-SPEC timing/easing/restraint reference, subordinate to the
  current host's stage, permissions, brand tokens and requested deliverable.
- Ten self-contained web recipe references, including usage and the complete
  original CSS/JavaScript as copyable fenced blocks: `like-burst`, `fade-in-up`,
  `card-lift-hover`, `stagger-list`, `magnetic-button`, `loading-shimmer`,
  `attention-pulse`, `scroll-reveal`, `toggle-spring`, and `kinetic-headline`.
- Reuse of the fork's existing eight `gsap-*` helpers and already-adapted
  `web-clone`. They are not duplicated or overwritten by older upstream copies.

These references are carried by the existing frozen session-skill package,
with source hashes, notices and license. No new package dependency, runtime,
network request, telemetry call or background installation is added.

The snippets are adaptable references, not certified production components.
The original kinetic headline splits UTF-16 units rather than graphemes;
card lift transitions a shadow and retains promotion; attention pulse loops
indefinitely. The toggle example needs an accessible name and non-submit button
type; entrance recipes need progressive enhancement and visible focus when
JavaScript fails. Their references flag these limitations. Adapt to the project's
actual content, reduced-motion preferences, component teardown and host rules.

## Real host/export boundary

Interactive recipes remain HTML/CSS/JavaScript. Their load, pointer, observer,
random and timer clocks do not automatically become seekable film clocks. For
an actual video request, translate the visual idea into the existing paused
GSAP composition and use the [Motion Design delivery contract](motion-design.md).
Marked motion MP4 export requires the connected desktop frame renderer.

No upstream canvas compositor, `window.__maTimeline` interface, editor menu,
browser MP4 export, local server, CLI, BYOK plumbing or Remotion adapter is
imported or promised. The skill cannot grant unavailable tools or authorize
additional execution/verification stages.

## Inventory and deliberate exclusions

The pinned repository contains **12 companion skill manifests and 218
recipe-level skill manifests**. Its larger 403-entry catalogue also includes
reference cards; those counts do not mean 403 installed executable skills.

| Upstream material | Disposition |
| --- | --- |
| Motion Anything router / MOTION-SPEC | Adapted and bundled with Apache-2.0 notice |
| Eight GSAP companions | Existing fork integrations reused; MIT skill text is distinct from the GSAP runtime license |
| Web Clone companion | Existing host-adapted fork integration retained, including its MIT notice |
| Ten selected web recipes | Usage and implementation references bundled; source/manifest attribution identifies Apache-2.0 and no dependencies |
| Web Shader Extractor / Web-to-Design-md | Not installed: upstream provides only wrappers and explicitly states their implementations have no open license; no automatic `npx` instructions |
| 94 Animate.css recipes | Not bulk-imported: declared Hippocratic-2.1, not Apache/MIT |
| React Bits imports/effect ports | Not imported: source attribution claims permission, but no separately transferable grant is bundled; some recipe metadata is ambiguous |
| Ten AnimXYZ recipes / four Lottie recipes | Not imported: shared CSS or external runtime/JSON assets and separate attribution need their own integration |
| Twenty slides effects | Not imported: rely on the OpenDesign HPX/shared canvas runtime; not standalone deterministic film recipes |
| Six app demonstrations | Not imported: original scripts auto-loop and use global selectors; not production-ready control behavior |
| Remaining web recipes and the application/editor | Not included in this curated, bounded skill port |

The ten selected files have first-party-style headers and source manifests,
with no third-party implementation indicators or network calls found in their
code. This is a source/provenance assessment, not independent proof of original
authorship or a blanket privacy certification of the upstream application.

## Attribution and verification

The helper ships the full upstream Apache-2.0 license, modification notices,
pinned source URLs and per-implementation SHA-256 hashes. Original recipe code
bytes are retained inside references; no upstream editor code is executed.
Do not copy the upstream attribution's incorrect claim that the GSAP runtime
is MIT: that statement does not apply to the separately licensed runtime.

Regression checks cover catalogue discovery, frozen-package inclusion and
materialization, exact implementation hashes, JavaScript parseability,
absence of external calls in selected code, and like/unlike/reduced-motion
behavior. These do not substitute for real-browser visual/performance checks.
