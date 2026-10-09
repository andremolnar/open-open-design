# Work here: OpenDesign expertise in your current coding session

Use **Work here** when your existing coding agent should implement the design in
its current repository. OpenDesign supplies selected design guidance, resource
bytes and a durable workflow record through the existing MCP connection. Your
current agent owns its plan, edits, tests, permissions and progress. No second
coding Run is started. Existing `start_run` delegated generation remains available.

## Start from an exact connection

Connect the repository and specific app/package to an OpenDesign project first.
The **Connected source** dialog now contains a selectable Work here starter
prompt with that exact project ID, canonical source root, package and binding
revision. Paste it into the coding session already open in that package. The web
dialog does not prepare a synthetic session on the agent's behalf.

If starting from the repository instead, call `resolve_project_context` and
continue only when it returns `ready`. Resolve ambiguous, unavailable or moved
bindings explicitly; the workflow never falls back to the active UI project.

Call `prepare_design_context` with:

```json
{
  "projectId": "<exact-project-id>",
  "sourceRoot": "<canonical-connected-source-root>",
  "appRelativePath": "<selected-relative-package-or-dot>",
  "expectedBindingRevision": 1,
  "hostSessionId": "<stable-current-host-session-id>",
  "requestId": "<unique-logical-prepare-request-id>",
  "prompt": "Implement the requested change here using our native components.",
  "capabilities": {
    "imageContent": true,
    "embeddedResources": true
  }
}
```

Use the actual binding revision, not the example value. Declare only capabilities
your host supports. Image capability here describes transport support; it is not
proof that the chosen model/provider can perceive the image.

The response includes ordered guidance, a required-read resource manifest,
preflight and critique checklists, explicit OD-to-host adaptations, missing
capabilities, `workflowId`, `revision` and `contextRevision`. Keep all those
identities for subsequent calls. For a Team project, also copy the exact
`workspaceId`/`workspaceMemberId` pair from the connection into every MCP call.
The daemon verifies active membership; an unavailable or mismatched explicit
pair never falls back to Personal or a headerless request. The package is frozen, hashed and bounded; report
warnings/truncation rather than assuming a complete project or asset index.

An explicitly pinned OD Next snapshot uses its verified canonical strategy, task
profile and required atoms. Automatic OD Next activation is otherwise Run-scoped;
work-here does not synthesize a Run to obtain it. Without a pinned snapshot, the
response identifies its fallback to the canonical design charter plus the actual
selected skill, design system and craft.

## Inspect pixels and materialize originals

`get_design_asset` requires `projectId`, `workflowId`, `hostSessionId`,
`contextRevision` and an `assetId` from this package.

- `representation: "image"` returns actual original PNG/JPEG/GIF/WebP bytes in an
  MCP image content block, alongside structured provenance/hash metadata. It
  does not merely return `@path`, a filename, a URL or `resource_link`.
- `representation: "original"` returns an embedded JSON text resource containing
  an exact base64 byte chunk. This is deliberately textual: a model seeing an
  image attachment cannot recreate its original bytes. Start at `offset: 0`,
  follow `nextOffset` until null, verify each `chunkSha256`, concatenate decoded
  chunks in byte order and verify the manifest's full `sha256` and `bytes`.
  Default chunk size is 32 KiB; `maxBytes` can be at most 64 KiB. A host that
  supports programmatic tool-result capture can save/decode the envelope without
  echoing base64 in conversation; the CLI below can do the same through native
  shell/file tools. This is data retrieval, not another coding harness.
- Both representations preserve the original hash and report `transformed:false`.
  There is no silently resized preview, SVG-to-raster claim or automatic copy.
  Unsupported images, malformed files and oversized resources are reported.

Only materialize an asset into the repository when the user explicitly requests
that promotion, using the current host's native file tools and permissions.
Otherwise it remains managed design data. Fonts and textual sidefiles use the
original route; scripts are reference material and confer no execution permission.

The package includes the selected skill sidefiles, selected design-system files,
verified strategy guidance and files in that project's Design Files. It does not
scan arbitrary source files, all global uploads, other projects, linked folders,
remote URLs or transient uploads from unrelated chats. Put a required reference
image into this project's Design Files before preparing/refreshing context.

## Stay in the same workflow

1. Perform preflight in the current host: verify the repository/package, read
   applicable `AGENTS.md`, inspect required sidefiles and relevant image pixels,
   reconcile design/repository conflicts and make a visible plan.
2. Call `checkpoint_design_workflow` with the pinned identities,
   `expectedRevision`, a unique `requestId`, phase, summary and check results.
   Phases are `planning`, `implementing`, `critique` and `completed`. Checks are
   explicitly `passed`, `failed` or `not_run`; these are host-reported evidence,
   not an independent daemon verification.
3. Use the host's native tools to edit/test. Apply OpenDesign's visual judgment
   to native components. Standalone HTML/CDN instructions, OD UI markup,
   `native_build` fan-out and Critique Theater directives are reference-only;
   the returned adaptation map replaces their execution behavior.
4. Use `get_design_workflow` to resume after another MCP call or daemon restart.
   It revalidates the exact binding and returns the saved context/progress.
5. To refresh selected design guidance/assets, call `prepare_design_context`
   again with the same workflow/session and its current `expectedRevision`, a
   new `requestId` and the unchanged exact binding. The new context revision
   invalidates old asset/mutation handles; saved history identifies its original
   context revision. A changed source binding requires explicit reconnection and
   a new workflow, not silent rebinding of the old one.
6. Optional preview publication is separate: if authorized, call existing
   `create_artifact` for this exact project, then `register_design_artifact` with
   the managed file name and verified SHA-256. Registration only records a
   matching existing file in the selected project’s design storage, including an
   explicitly imported project folder. This is the same destination used by
   `create_artifact`; source bindings cannot overlap it. Registration never accepts
   an arbitrary host path or copies source.

When finished and no longer needing the frozen package, explicitly call
`archive_design_workflow` with the same identities, revisions, a new `requestId`
and `confirm: true`. It discards cached guidance/resource bytes and frees active
workflow capacity while retaining small replay-protection tombstones. Archived
handles cannot resume; start a new workflow for later work. This never deletes
original design files or repository files, and cleanup is available even when the
source binding has moved or been reconnected.

Reuse the same `requestId` only for an identical logical mutation. Changed input
under the same ID, stale revisions and mismatched project/session identities fail
closed. After an uncertain write, get the current workflow and reconcile before
issuing a different mutation. Replays never authorize a different payload.

## CLI and HTTP

The CLI exercises the same authorized HTTP boundary as MCP:

```sh
od project work-here prepare <project-id> --request-file request.json --prompt-file brief.txt --json
od project work-here status <project-id> --request-file identity.json --json
od project work-here asset <project-id> --request-file asset-request.json --json
od project work-here checkpoint <project-id> --request-file checkpoint.json --json
od project work-here register-artifact <project-id> --request-file artifact.json --json
od project work-here archive <project-id> --request-file archive.json --json
```

`--request-file -` reads JSON from stdin; `--prompt-file -` reads prompt text from
stdin for prepare. They cannot both consume stdin. Existing daemon/workspace
selection flags apply. Each request includes the matching explicit `projectId`.
The routes are POST `/api/projects/:id/design-workflow/prepare`, `/get`, `/asset`,
`/checkpoint`, `/register-artifact` and `/archive`. Durable mutations require the project's
existing `writeFiles` authority; reads retain project/workspace authorization.

## Manual acceptance experiment

Use a disposable connected repository/package with a distinctive `AGENTS.md`
rule, an existing native component and a small real reference PNG/JPEG in the
OpenDesign project's Design Files. Pick an image with an unambiguous visible
detail not described by its filename. Record the initial source diff and Runs.

1. In the already-open OpenCode session, use the dialog's starter prompt. Add:
   “Work in this session. Follow our repository rule. Inspect the reference image,
   describe its distinctive visible detail, then implement this small screen in
   our existing component. Keep the plan, edits and test results visible here.”
2. Verify preparation resolves the expected project/package/revision and returns
   the actual selected brand/skill/craft. Read every required sidefile and request
   the image representation. Check the described visual detail yourself. A
   plausible answer or successful tool result alone is not proof of perception.
3. Verify edits appear in this OpenCode session's native tool activity and the
   actual source diff, honor the repository rule, and use the existing framework.
   Verify no new delegated OpenDesign Run or nested coding harness was launched.
4. Request an original-byte promotion only if desired. Reassemble chunks with
   native tools, then verify the full SHA-256 matches the manifest. The image
   remains unchanged in Design Files.
5. Checkpoint progress, switch OpenDesign's active UI project, and call
   `get_design_workflow`/`get_design_asset` again with the original identities.
   The workflow must still target the original exact project. Restart the daemon
   and confirm the same handle and checkpoints remain available.
6. Change a design asset, explicitly refresh the same workflow, and confirm the
   old context handle fails while the new one returns the new hash. Rebinding or
   moving the source must block the old workflow rather than follow another path.
7. Perform the host critique and repository checks. Record any failed/not-run
   stages. If authorized, save a separate preview via `create_artifact`, register
   its exact hash and confirm registration did not alter source files.

Automated tests establish byte identity, protocol, isolation, persistence and
no-Run routing. The user's installed OpenCode/provider/model and macOS runtime
still require this manual experiment. See [OpenCode image transport](opencode-image-transport.md)
for the verified V2 attachment chain and its limits.

## Bounds and storage

Version 1 caps each resource at 2 MiB, a package at 16 MiB, its resource count at
128 and guidance at 128 KiB. Original chunks are at most 64 KiB. Directory and
read-work budgets also bound preparation. Symlink/hardlink, credential-shaped,
hidden-relative and dependency paths are excluded; this is not a general secret
scanner. Do not put credentials in design files.

Local storage allows 32 active workflows plus separately bounded archive
tombstones and replay hashes. Archive old contexts to free active capacity.
Capacity exhaustion returns an explicit error instead of silently evicting
handles or replay protections. Checkpoints and artifact history are bounded and
retained across refresh; archive explicitly discards their cached context.
Artifact registration uses the same 2 MiB safe managed-file read limit.
No global access, provider credentials, runtime configuration or MCP discovery
namespace is changed. Managed data follows the root
[Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).
