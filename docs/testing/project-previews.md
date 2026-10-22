# Cached project-browsing previews (#16)

## Behavior

HTML/deck project covers in the Projects grid, the shared Designs grid, and
Home's recent-project rail/project switcher use static PNG screenshots. Image
and video cover selections keep their existing media behavior. The full editor
is unchanged; it still opens the interactive document.

- Pointer entry or keyboard focus must dwell for **350 ms** before loading a
  live, reduced-size iframe. Passing quickly across cards loads none.
- Leaving allows **900 ms** for re-entry, then removes the iframe, rather than
  keeping a hidden document running. Selecting another preview releases the
  previous one first. The budget is one live **browsing** preview per window;
  it does not replace or count the full editor's document.
- Unmount, leaving the viewport, backgrounding, window blur, and navigation
  release the preview. Touch entry does not activate hover.
- Near-viewport static covers revalidate every **30 seconds** and on foreground
  return. Offscreen/background cards do not continuously request screenshots.
  A failed capture keeps an existing image or the project initial, never an
  automatic live-iframe fallback. Revoked/missing sources clear the old image.

## Cache and capture boundary

`GET /api/projects/:id/thumbnail` takes exactly one of `fileName` (HTML) or
`liveArtifactId`. GET/HEAD share authorization and private ETag revalidation.
The same endpoint is available through:

```text
od project thumbnail <id> --path <file.html> --out <cover.png> --json
od project thumbnail <id> --live-artifact <id> --out <cover.png> --json
```

An existing output file is never overwritten by this command.

Cache identity includes workspace/member context, project, source, canonical
project root and a digest of the assembled local HTML/asset graph. A visible
file manifest also invalidates dynamically referenced local assets when their
size/mtime changes. Thus CSS/image/font-only edits do not require an HTML edit
or a project rename to refresh the cover. A source changed during capture is
refused rather than silently assigning an old capture to new bytes.

The cache persists across restarts, uses atomic PNG replacement, retains up to
256 images (8 MiB maximum per image), and coalesces duplicate requests. A single
render lane and at most 48 pending identities bound background capture work.
Cache storage follows [the root daemon data directory contract](../../AGENTS.md#daemon-data-directory-contract).

Captures reuse the desktop's sandboxed Chromium renderer; no new browser or
dependency is installed. Local assets are contained and bundled before capture.
Background captures have no remote script/asset access, credential-bearing
project origin, network connections, nested frames, or autoplay audio. The
renderer window has an overall deadline and is destroyed after capture.

**Availability limits:** a daemon without the desktop renderer can reuse cached
PNGs but cannot generate new ones; misses show the project initial until a
renderer is available. Documents that depend on remote scripts/assets or dynamic
fetching may produce an incomplete static cover under this restrictive policy.
Hover/open uses the ordinary live page. Remote-only changes are not a local
source revision. These are not claims of universal website screenshot fidelity.

## Local acceptance, 2026-10-21

Baseline: `f294312775646193df9d19096e0e85d91ec1c024`. Baseline and fix were
built as separate portable macOS arm64 test apps with the maintainer's Apple
Development identity. Nothing was installed into `/Applications`, notarized,
or published. The baseline's frozen, scripts-disabled offline install reused
the existing package store (zero downloads).

Thirty isolated projects were seeded through production project/file APIs.
Each used an inline animation drawing 1,500 canvas particles per frame plus a
local stylesheet. Both apps scrolled all 30 cards, returned to the top, and were
measured without hover. Baseline was stopped before measuring the fix.

| Warm browsing observation | Baseline | Fix |
| --- | ---: | ---: |
| Idle live card iframes after scrolling | 30 | 0 |
| App-tree CPU, one core = 100% | 201.77% | 2.47% |
| Sum of app-tree process RSS | 1,988.61 MiB | 1,509.84 MiB |

CPU is a ten-second OS CPU-time delta for the desktop process and descendants.
RSS sums include shared pages more than once. This is one local synthetic
sample, **not** a statistically controlled benchmark, GPU-memory measurement,
or guarantee for arbitrary projects; cold-cache capture has an initial cost.

Additional real-app observations:

- Sweeping 30 cards at 20 ms per card loaded zero iframes. At 300 ms of dwell
  there was still none; deliberate hover activated one, brief re-entry kept it,
  switching never exceeded one, and the leave grace removed it.
- A stylesheet-only background-color edit changed the screenshot ETag and the
  displayed image without an HTML edit.
- After a full app restart, all 31 PNGs (30 originals plus the revised cover)
  had identical byte hashes and the new desktop log recorded zero captures.
- The full editor's canvas frame counter advanced from 502 to 517 in 250 ms.
- Rail and switcher previews each displayed a cached image and one deliberate
  live preview; the full editor continued independently.

### Screenshots

All screenshots contain synthetic project names/content only.

- [Baseline Projects](../screenshots/issue-16/baseline-projects.png)
- [Cached Projects](../screenshots/issue-16/projects.png)
- [Deliberate project hover](../screenshots/issue-16/project-hover.png)
- [Home recent-project rail](../screenshots/issue-16/home-rail.png)
- [Editor project switcher](../screenshots/issue-16/switcher.png)

### Checks and handoff limits

Focused web, daemon/CLI/cache, and desktop-renderer tests, root `pnpm guard`,
full workspace `pnpm typecheck`, and the production smoke builds passed.
The final focused selection reports **257 passed, one skipped** (web 194/one
skipped, daemon 43, desktop 20).
Full repository/Playwright suites and native Windows/Linux packaging were not
run. This change does not imply a release, deployment, merge, or security audit
of arbitrary artifact scripts.

**Adjacent packaging finding:** after running the fix app, strict recursive
signature verification failed because Next.js generated files inside its signed
standalone `server/route-cache/APP_PAGE` resource tree. A fresh final build passed
`codesign --verify --deep --strict` before launch, but failed after running.
Moving runtime route caching out of sealed app resources needs a separate
packaging follow-up; no attributes/signature checks were bypassed here.

Both test apps were stopped and their synthetic data/build outputs removed.
The isolated baseline worktree, the two new workspace-build cache entries, and
owned validation scratch were also removed; unrelated caches, the installed app,
and existing user data were not cleanup targets. Selected screenshots and
local diagnostic/measurement receipts remain, not a deployed test application.

A final launch attempt with a long, task-local `TMPDIR` hit the platform socket
path limit. The same build launched normally using the host's normal temporary
directory; failure logs were preserved and no socket-path/security checks were
bypassed. Final API capture returned a PNG and left no new export-temp directory.

## Source shipment checks, 2026-10-22

Version **1.2.1** is prepared for the #16 fix. All 17 product-versioned manifests
advance together; independently versioned packages and inherited release history
remain unchanged. Dependency specifications and workspace links did not change,
so no dependency installation or lockfile rewrite was needed. Contract and
consumer build outputs were regenerated.

The focused selection again passed (257 tests, one skipped), along with
`pnpm guard`, full workspace `pnpm typecheck`, `git diff --check`, and the
contracts/daemon/desktop/web package builds. The web build retains the existing
React 18/Next.js 17 deprecation warning. No full-suite or native Windows/Linux
packaging pass is implied.

Separately, at the maintainer's request, the preview fix was built, personally
signed, and deployed to `/Applications/Open Design.local-smoke.app`, preserving
its existing data. That test binary still reports **1.2.0**, because deployment
preceded the source shipment's version bump. Installed strict recursive signing
verification passed before launch. Shipping the source does not replace that
test app, publish a release, or fix the post-launch route-cache signing problem.
