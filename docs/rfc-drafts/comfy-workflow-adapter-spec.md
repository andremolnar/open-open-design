# OpenDesign ComfyUI adapter specification

Implementation proposal and end user experience • 15 October 2026 • Draft for review

## Recommendation

Add one ComfyUI adapter to the OpenDesign fork, with reusable server connections and independently named, versioned workflow configurations. A single backend can offer “Product render”, “Reference edit”, and other workflow choices in the existing image model picker. OpenDesign owns the job, input mapping, recovery, and project asset import; ComfyUI executes the configured graph.

The MVP accepts the existing prompt and image reference inputs and returns one locally imported image through the existing generation flow. A workflow may consume multiple references without returning multiple images. Multiple output assets, video, arbitrary custom transports, remote workflow URL import, and a node editor are later work.

This is a specification, not an implementation or a tested integration. No ComfyUI server was connected, no workflow executed, no software installed, and no paid inference requested. All example values and responses are illustrative. Existing behavior and official protocol facts are cited; proposed APIs, storage, UI, and limits are explicitly design recommendations.

## The three objects users should understand

### Server connection

A reusable connection identifies a ComfyUI service: stable connection ID, friendly name, base URL, optional trusted proxy path, authentication mode and secret reference, network policy, timeouts, and last connection check. It does not identify a workflow. Version connection settings when the origin, proxy path, authentication mode, or trust policy changes; invalidate affected workflow checks. Existing jobs pin the connection revision and never follow a newly retargeted URL. Secret rotation can replace the credential through an explicit recovery policy, without retaining revoked credentials or changing the pinned destination. Store credentials separately, server side; never embed them in a graph, picker entry, URL query, or exported configuration.

The URL is a base server address such as https://comfy.example.test. The adapter appends documented routes. There is no assumed “run this workflow URL” endpoint. A hosted service with a different API needs a separate transport adapter and explicit compatibility declaration.

### Named workflow configuration

A configuration is an OpenDesign object with its own ID, display name, description, server connection ID, capability tags, immutable version, graph hash, validated node-schema fingerprint, typed input definitions, semantic bindings, designated output nodes, and validation/test status. It is the unit users select. Several configurations can point to one server.

Publish an immutable version whenever the graph, bindings, typed defaults, outputs, or declared capabilities change. In-flight jobs retain their original version and graph snapshot. Renaming a display label need not change executable content; retain the selected label in provenance. Never silently migrate a running job to a new graph.

### ComfyUI graph and editor document

The execution graph is API-format JSON keyed by node ID, each with class_type and inputs; a connection is represented by a node ID and output index pair. This differs from the visual editor JSON with canvas positions, widgets, and links. Import the API-format export. Detect a canvas document and explain how to export the API format; do not submit the canvas document to /prompt or guess widget positions. An optional editor document can be retained for human editing, but is not executable input. [C1, C3]

## Existing OpenDesign integration points

The fork was inspected at commit ffcedd500a3621c6848bf175889ae2b47670e521. This is the implementation baseline, not evidence that a ComfyUI adapter already exists. [O1–O7]

- apps/daemon/src/media/models.ts declares ComfyUI with integrated: false. Its MediaProvider/MediaModel registries are mirrored in apps/web/src/media/models.ts. A workflow choice must fit or deliberately extend these registries, not masquerade as a server URL.
- apps/daemon/src/media/config.ts currently stores provider apiKey/baseUrl/model and aliases. It has no general named-workflow schema. GET masks keys; that is not proof of an encrypted credential vault. New secretRef storage requires an explicit secure storage design. Existing media configuration resolution includes environment overrides and a legacy fallback; that fallback is an implementation detail, not a pattern for new code. Follow the repository’s runtime path helpers for new daemon data.
- apps/daemon/src/media/index.ts exposes generateMedia with projectRoot, projectsRoot, projectId, surface, model, prompt, output, aspect, quality, resolution, image/images, onProgress, workspaceId, requestInit, and onBytesWritten. MediaContext resolves imageRef/imageRefs and distinguishes model from wireModel. The provider-level RenderResult is one {bytes: Buffer, providerNote: string, suggestedExt?: string}. This single-image boundary is the reason for the MVP’s one-output constraint.
- That module’s resolveProjectImage supports project-relative references and a 16 MiB maximum, with lexical containment, stat, and extension checks. Do not assume it already prevents symlink escape. Its final write path adjusts the extension, writes the project file, calls onBytesWritten with exact bytes, and returns file metadata plus provider/model/fallback fields. Preserve this central path and harden it where required rather than implementing a second unrelated output writer.
- apps/daemon/src/routes/media.ts already creates asynchronous media tasks and passes onProgress. Its onBytesWritten callback calls captureChatArtifactSnapshotFromBytes with projectId, runId, and mediaTaskId. The ComfyUI coordinator must keep these identifiers and the exact returned bytes together. Extend this existing task lifecycle for persistence/recovery; do not create a competing task system.
- packages/contracts/src/api/media.ts already defines ProjectMediaTask with queued/running/done/failed/interrupted, progress entries, file metadata, and structured errors. It does not currently establish ComfyUI prompt ownership, durable submission idempotency, or server cancellation. Add the needed recoverable substates/metadata compatibly; an existing interrupted status must never imply confirmed GPU cancellation.
- apps/daemon/src/cli.ts already routes od media generate through /api/tools/media/generate with OD_TOOL_TOKEN or the project media endpoint with workspace context. It receives taskId and waits through /api/media/tasks/{id}/wait; queued/running is a handoff, not completion. od media wait continues polling. Extend the same API/CLI flow, including status and errors.
- UI entry points include SettingsDialog.tsx’s MediaProvidersSection, NewProjectPanel.tsx’s supportedModels filtering, and the mirrored web registry. Update provider visibility and model filtering together with the new workflow picker so an enabled configuration is actually selectable. Historical PR paths are integration clues; verify the current component layout during implementation. [O8]

The repository’s AGENTS.md requires runtime-derived data paths and UI/CLI parity through a shared API. Place this proposal under docs/rfc-drafts, alongside existing draft RFCs. [O9]

PR #4570 in nexu-io/open-design was closed unmerged on 19 August 2026. Its final patch is a useful provider/UI scaffold, not the requested reusable workflow feature: renderComfyUIImage constructs a fixed SDXL graph, submits it, polls history, and fetches node 9’s first image. It has no imported workflow configuration, reference upload, WebSocket correlation, durable recovery, or shared-server cancellation. Reuse integration patterns selectively; do not treat the closed patch as shipped functionality or an implementation to merge wholesale. Its description’s OD_COMFYUI_CHECKPOINT claim is not supported by the final function, which resolves the saved model/wire alias/default instead. A successful live test was reported by the author, not performed for this specification. The reason for closure is not established. [O10, O11]


## End user experience

### Add one server in Settings Media

Add a “ComfyUI” section alongside existing image providers. The server form contains name, base URL, authentication choice, a masked credential field, and “Test connection”. Advanced settings hold timeout/concurrency and trusted-network policy. A token is write-only after save, with separate replace/remove controls. Never display the stored secret in a field value or diagnostic export.

“Test connection” checks connectivity, authentication, route availability, and required node schema access without submitting a graph. Report precise outcomes: unreachable, authentication rejected, unsupported API, or connected. A successful check does not prove that a checkpoint exists or that a generation will fit GPU memory.

### Add named workflow cards

Each card shows its name, connection, version, capability tags, validation badge, and enabled status. Actions are Import API JSON, Edit inputs, Validate schema, Run test, Enable in picker, Duplicate, and Disable. Deleting a configuration used by jobs should archive it while retaining snapshots and provenance.

The simple setup flow is:

1. Select the saved server and import an API graph from a local JSON file.
2. Name the workflow and choose “Generate image” or “Edit using references”.
3. Confirm the suggested prompt input and reference image inputs. Suggestions are candidates based on known node classes, input types, and labels; users must confirm ambiguous matches.
4. Choose the final image output node and image index. Show output labels from the graph, not an unexplained numeric list. Explain that this chooses the returned asset; other executable output branches in the submitted graph can still run.
5. Review the small set of exposed controls and their defaults.
6. Validate, optionally run a test, then enable the card in the image picker.

Advanced bindings expand only when needed. The editor displays both a friendly label and the exact target, for example “Positive prompt · node 6 · text”. It supports explicit semantic slots rather than positional search-and-replace. Importing a new graph opens a new draft version and highlights missing node IDs, changed class types, removed fields, and incompatible defaults. It never rewrites a published mapping by guessing.

### Typed inputs and honest validation

An exposed field has key, label, type, required flag, default, and constraints. MVP types are string, integer, number, boolean, and enum. Reference inputs are ordered semantic image slots with cardinality, accepted MIME types, and size limits. A required field with no default must be provided before submission. An absent optional value preserves the graph literal or an explicitly configured default; null does not mean “erase this node input”.

Recommended common controls are seed, width, height, steps, and negative prompt when those inputs actually exist. Do not present controls that are not bound. Do not assume every workflow supports aspect ratio, seed, a negative prompt, or a generic checkpoint selector. Width and height choices must honor the workflow’s constraints and dimensional steps; do not silently round. Random seed is resolved once when the job is created and remains fixed for recovery. MVP integer values, especially seeds, must be within JavaScript’s safe-integer range as well as server/config bounds. Wider integers require a deliberately implemented lossless representation and JSON serialization, not silent rounding.

Schema validation fetches /object_info or the required per-class schemas and checks node availability, named inputs, expected types, constants, compatible links, output nodes, and model enum values where provided. Custom validation, dynamic input behavior, GPU availability, and file loading may still fail during /prompt validation or execution. Uploaded LoadImage paths are a special file input: accept the actual upload result rather than assuming its path must appear in an earlier top-level file enum. [C1, C4]

Use separate status labels: “Connection checked”, “Schema checked”, and “Test run passed”, each with version and timestamp. “Run test” explicitly submits a real generation and may consume GPU resources or paid API credits if the graph contains remote API nodes. Show the test input and affected server before starting. No test runs happen during import or connection checks.

### Use the existing picker and composer

Show enabled workflow configurations under a ComfyUI group, labeled “Workflow name · Server name” with a short capability badge. Preserve the existing provider/model preferences while making the selected item a stable configuration ID and version, not the server URL or graph filename. Each card has one explicitly activated published version; drafts never appear in the picker. The picker shows the version and submits that exact version. If the active version changes between selection and submission, require an explicit refresh/confirmation rather than silently selecting latest; the backend rejects a no-longer-enabled version with a version-conflict error. A disabled, removed, or incompatible stored selection must show “Choose another workflow”, never fall back silently to a paid provider.

For reference editing, show named attachment slots such as “Source image” and “Style reference”, with drag-to-reorder only when the configuration defines ordered slots. Validate min/max references before starting. For prompt-only workflows, explain that references are unsupported rather than silently dropping attached images. All selected references must be included exactly once or rejected explicitly.

Before generating, the UI snapshots the originating project and configuration version. Switching to project B while project A is generating must not redirect the output. Progress and the completed asset stay attached to A; a link can return the user there. An open panel for B should not inject A’s asset into B’s canvas.

### Error and progress language

Use queued, running, reconnecting, importing, complete, failed, cancel requested, and outcome unknown as meaningful user states. Show node progress only when the event can be correlated to this job. A sampler’s percentage is node progress, not total workflow progress; queue_remaining is server-wide load, not the user’s queue position. Avoid invented ETAs.

Map validation errors to the friendly input and node where possible. For missing models or custom nodes, show the precise dependency and a “Revalidate” action after the user fixes the server. Never auto-install custom nodes. Before every new submission, refresh and compare the required node schemas and relevant model enums against the published version; cache only within that validation/submission attempt. Runtime-only validation and changes between check and execution can still fail, so do not claim the check eliminates races. For schema drift, mark the affected configuration stale and block new runs until revalidated; preserve existing snapshots for jobs already submitted.

## Proposed adapter and persistence contract

### Boundary with the existing generation path

Keep OpenDesign’s caller-facing generation contract stable. Resolve a selected configuration to the ComfyUI adapter behind the provider dispatch, then translate the existing prompt, reference images, dimensions, and project output destination into the internal job request below. This is a proposed internal contract, not an assertion that these names already exist in the fork.

```ts
type ComfyImageJobRequest = {
  requestId: string;                 // durable OpenDesign idempotency key
  originProjectId: string;           // captured at submission, never active UI state
  originOutputDirectory: string;     // snapshot of validated generateMedia destination
  workflowConfigId: string;
  workflowVersion: number;
  prompt: string;
  references: Array<{
    slot: string;
    projectAssetId: string;
    contentHash: string;
    mimeType: string;
  }>;
  parameters: Record<string, string | number | boolean>;
};
type ComfyRenderResult = {
  bytes: Buffer;                    // existing RenderResult payload
  providerNote: string;
  suggestedExt?: string;
};
// Persist jobId, originProjectId, dimensions, and provenance in the
// coordinator/asset record; preserve the caller-facing media file shape.
```

Resolve references from authorized project assets or the existing validated reference-input mechanism, into bytes on the application server. The request must not become a generic arbitrary-URL fetcher. Bind the canonical prompt through one or more explicit prompt targets; multiple prompt targets require an intentional mapping. Keep any negative prompt separate. Patch an immutable graph copy at exact node/input paths. Preserve node connections and JSON types; no global string substitution and no evaluation of templates as code. Bind only compatible literal inputs, never overwrite an existing graph connection implicitly. Reject duplicate/conflicting targets, including prompt and parameter bindings to the same input. Apply values in a documented order: canonical prompt/reference slots are authoritative for their exclusive targets; explicit validated request parameters (including mapped composer dimensions) override configuration defaults; configuration defaults override graph literals; otherwise preserve the graph literal. Reject conflicting composer and parameter values instead of choosing silently.

The adapter returns the downloaded image bytes as the existing RenderResult to generateMedia. The central generation path writes the project file, invokes onBytesWritten, captures the chat artifact snapshot, and returns its existing file/provider metadata. The durable coordinator marks completion only after this import/snapshot path succeeds. Do not pass ComfyUI’s /view URL or a new local-path result through the provider boundary. Explicit ComfyUI selection must fail visibly when unavailable or invalid; do not substitute a stub, another workflow, or another provider. Preserve providerError/usedStubFallback/intentionalStub semantics and never display a stub as a successful ComfyUI result. Carry additional provenance in a linked record or an explicitly versioned contract extension, not an unannounced replacement shape.

### Proposed stored records

Connection: id, label, baseUrl, authMode, secretRef, policyId, limits, checkedAt, capabilities, lastErrorCode. Only the backend can dereference secretRef.

Workflow version: configId, version, name, connectionId, graphJson, graphSha256, requiredNodeTypes, schemaFingerprint, semanticBindings, parameterDefinitions, outputSelection, capabilityTags, status, checkedAt, testedAt. UI canvas metadata, if retained, is separate. A graph can contain private prompts or paths; store/export it with the same access protections as project inputs.

Job: jobId, requestId, originProjectId, outputDirectory snapshot, connection ID and validated URL snapshot, workflow version/hash snapshot, patched graph/hash, resolved seed, parameter snapshot, input asset hashes, upload descriptors, clientId, promptId if known, submission attempt state, timestamps, progress, terminal evidence, downloaded output descriptor/hash, local import record, and sanitized error.

Derive daemon-owned record, cache, and staging paths from RUNTIME_DATA_DIR and existing path helpers. Never hard-code a concrete data root. Project output paths still come from the validated originating project. Expose configuration, validation, generation, and job-status operations through one backend API used by both the UI and CLI; the CLI must support the same new user capabilities and validation rules, with secrets accepted through a safe non-echoing mechanism.

Create the durable job before uploading or submitting. Enforce a unique requestId per owner/project operation and reuse the existing record on browser retries. Bind it to a canonical request payload hash that includes project, configuration/version, prompt, reference identities/hashes/order, and parameters; the same key with a different payload is a conflict, never a mutation or a match to someone else’s job. The uniqueness lock must survive process restarts. One user clicking “Generate again” creates a new requestId and job; transport recovery never does.

### Lifecycle and durable boundaries

```text
created → validating → uploading → submitting → queued → running
                                              ↘ submission_unknown
queued/running → reconnecting → queued/running or terminal evidence
successful execution → fetching → importing → completed
validation/execution failure → failed
cancel request → cancel_requested → cancelled or actual terminal result
unrecoverable missing history → outcome_unknown
```

Persist each externally consequential transition, especially before /prompt and immediately after learning prompt_id. The displayed completion requires a verified local asset and a committed provenance/import record. A successful GPU execution followed by a download failure remains retryable in fetching; it is not a reason to regenerate. Failed import can retry from downloaded bytes. Use a uniqueness constraint on jobId plus selected output node/index for exactly-once local import.

The fork already has asynchronous media tasks and wait endpoints. Extend those tasks with durable ComfyUI submission/recovery state and make their existing status/wait API refresh-safe. Keep taskId stable and link it to the internal jobId and promptId; do not add a parallel job service or force the CLI back to a long-lived generation request. Map compatibility statuses queued/running/done/failed/interrupted carefully while exposing richer reconnecting/importing/outcome-unknown details through a compatible extension. A caller timeout stops waiting; it does not cancel the media task.

## ComfyUI protocol and failure handling

The official sources inspected are pinned to ComfyUI commit ba994879b88d0ebd9950b1e5c1e923d928f216ba where possible. Deployment versions vary. The MVP baseline uses the classic documented routes; newer capabilities require explicit version/capability verification rather than assumptions. [C1–C6]

### Upload inputs

POST /upload/image uses multipart form data with image bytes, type=input, a job-scoped subfolder, and overwrite=false. Treat the returned name, subfolder, and type as authoritative: the server may rename a collision. Persist them before submission. For LoadImage, construct the validated relative image path from returned subfolder/name (with the appropriate supported annotation if needed); do not substitute a local operating-system path. Do not use the request filename after the server returns a different name. [C1, C4]

```text
POST /upload/image
Content-Type: multipart/form-data; boundary=...
image: <bytes>; filename=source.png
type: input
subfolder: opendesign/job-example
overwrite: false

Illustrative response:
{"name":"source.png","subfolder":"opendesign/job-example","type":"input"}

Patched LoadImage input:
{"image":"opendesign/job-example/source.png"}
```

Use a unique job subfolder and deterministic slot filename. Retrying an upload before submission is safe only with collision handling and the returned descriptor; never overwrite another job’s input. Bound dimensions and decoded pixel count as well as compressed bytes. Preserve reference order and slot identity independently from filenames. Uploading private reference images transmits them to the selected server, which the UI should identify clearly.

### Submit the executable graph

Open a backend WebSocket at /ws?clientId=<unique-client-id> before submission when possible. POST /prompt with prompt containing the full API graph and client_id equal to that socket’s client ID. Persist the returned prompt_id, number, and node_errors. HTTP success means accepted, not completed. Surface structured validation errors; nonempty node_errors may coexist with accepted valid outputs, so require the designated output branch to be valid. [C1, C3]

```json
{
  "client_id": "opendesign-client-example",
  "prompt": {
    "4": {"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"installed-model.safetensors"}},
    "5": {"class_type":"EmptyLatentImage","inputs":{"width":1024,"height":1024,"batch_size":1}},
    "6": {"class_type":"CLIPTextEncode","inputs":{"text":"A ceramic cup on a pale background","clip":["4",1]}},
    "7": {"class_type":"CLIPTextEncode","inputs":{"text":"","clip":["4",1]}},
    "3": {"class_type":"KSampler","inputs":{"seed":42,"steps":20,"cfg":7,"sampler_name":"euler","scheduler":"normal","denoise":1,"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]}},
    "8": {"class_type":"VAEDecode","inputs":{"samples":["3",0],"vae":["4",2]}},
    "9": {"class_type":"SaveImage","inputs":{"images":["8",0],"filename_prefix":"opendesign/job-example"}}
  }
}
```

This is a full illustrative API-format graph using conventional built-in nodes, not a verified installation preset. Replace the checkpoint with an installed compatible model and validate against the server. Example accepted response: {"prompt_id":"11111111-1111-4111-8111-111111111111","number":7,"node_errors":{}}. A rejected graph returns error plus node_errors and must not be retried unchanged.

The inspected newer server also accepts an optional client-provided canonical UUID prompt_id. This helps recover a lost response on compatible versions, but is not a deduplication guarantee: the inspected queue insertion does not reject repeated submissions with that ID. Baseline support must work with server-generated IDs. Never label /prompt inherently idempotent. [C1, C5]

### Correlate events and establish completion

Correlate job events by prompt_id, not merely client_id or whichever project is visible. execution_start and executing identify execution; progress may describe a node; execution_cached reports reused nodes. executed is an output/UI update, not universal node completion. execution_success and executing with node=null are completion signals to trigger history retrieval. execution_error and execution_interrupted are terminal failure/interruption signals. Ignore unrelated jobs and uncorrelated binary previews for durable output purposes. [C2]

History can lag the socket signal. Retry safe reads with bounded backoff rather than declaring “no outputs” immediately. Fetch GET /history/{prompt_id}, examine that exact entry’s status and outputs, and reconcile errors before accepting the designated output. A socket closing is a transport event, not failure or success. [C3, C5]

### Recover without duplicate generation

After a socket drop or process restart, reconnect using the recorded client ID where appropriate, query history for known prompt IDs, and use GET /queue only to determine whether that specific job is pending/running. Read just the matching job into the application state; never expose other users’ queue/history contents in the UI or logs. Continue safe polling until terminal evidence, cancellation, a configured deadline, or explicit unresolved status.

If POST /prompt times out after the request may have reached the server, mark submission_unknown. Do not blindly retry. On a supported server with a client-chosen prompt ID, reconcile it in queue/history. With a server-generated ID and a lost response, a unique client ID and an app job marker in extra_data can assist bounded queue/history matching where deployment policy permits; require an exact unique match and verify graph/job fingerprint. No match is not proof of non-submission because of delayed visibility, history eviction, or restart. If ownership cannot be established, preserve “Outcome unknown” and offer a clearly labeled new run warning that the old one may still finish.

An application lock prevents duplicate submissions from the same OpenDesign operation; it does not make an external request atomic across a crash. Document this limit. Exactly-once remote execution requires server-side idempotency support or a cooperating gateway, which is outside the baseline MVP.

Persist execution outputs promptly. ComfyUI history is not permanent storage and may be cleared, evicted, or lost on restart. Missing history and missing queue membership leave an unresolved job unless other persisted terminal evidence proves the result. Preserve the diagnostic and recovery state; never manufacture success or silently regenerate.

### Select outputs and fetch bytes

GET /history/{prompt_id} returns an object keyed by prompt ID. Select only the configured output node and image index from its outputs; image descriptors contain filename, subfolder, and type. Fetch bytes through GET /view using those fields as separately encoded query parameters and the same authenticated connection. Validate the descriptor and resulting MIME signature, byte count, decoded dimensions, and content hash before import. [C3, C4]

```json
{
  "11111111-1111-4111-8111-111111111111": {
    "outputs": {
      "9": {"images":[{"filename":"job-example_00001_.png","subfolder":"opendesign","type":"output"}]}
    },
    "status": {"status_str":"success","completed":true,"messages":[]}
  }
}
```

Illustrative fetch: GET /view?filename=job-example_00001_.png&subfolder=opendesign&type=output. Use the original byte response, not a preview conversion. The wrapper must not search all output nodes and take “the first image” because previews and intermediate images can also be present. Output selection controls import, not server execution. The baseline submits the full graph and must enumerate/disclose all executable output branches during validation; reject undisclosed paid/API or disallowed side-effect branches. Do not promise that choosing one output prunes the others. Graph pruning or supported partial execution is a separate, explicitly validated feature because custom/dynamic nodes can make naive dependency pruning unsafe. For MVP, bind exactly one final output node/index and reject a missing selected image. Additional images are not imported silently. Later multi-output support should define a deterministic ordered selection and update both the provider contract and UI before enabling it.

### Cancel only owned work

Allow POST /queue with {"delete":["<owned-prompt-id>"]} for a pending job after ownership verification. Never send clear=true. A race can move the job to running, so re-read state and show “Cancel requested” until established. The inspected legacy queue route returns an empty 200 without exposing whether deletion succeeded, and deleted queued items do not receive a history entry. Therefore neither that 200 nor later absence from queue/history proves cancellation: retain “Cancel requested” or “Outcome unknown” unless stronger terminal evidence is available. A version-verified atomic targeted-cancel result can provide stronger evidence; it still must be reconciled with any concurrent completion. [C1]

Do not call global /interrupt on a shared server. Some newer servers have targeted cancellation routes; the inspected /api/jobs/{job_id}/cancel uses queue-aware cancellation, while legacy /interrupt behavior varies and a check-then-interrupt can race. Enable running-job cancellation only after verifying an atomic job-targeted implementation and authorization boundary for the deployed version. Otherwise cancel local waiting and explain that server execution may continue. A cancellation request is not a confirmed cancellation. Never clear global history or delete another job’s output as cleanup. [C1, C5, C6]

## Import and provenance

Write downloaded bytes to a temporary file inside the validated originating project’s image destination, then atomically rename the file and commit the import record. The filesystem rename and database update are not one atomic transaction: persist an import intent with the final path and expected hash first, use a deterministic per-job output path, and reconcile on startup. If bytes already exist with the expected hash, finish the record without downloading or inserting again; if they differ, quarantine/report the conflict rather than overwrite. Mark the job completed only after both the asset and record are verified. Use a generated safe filename; ComfyUI’s filename is provenance, not an unchecked local path. Reject path traversal, symlink escape, unsupported active content, and oversized data. If the project has been deleted or its destination is unavailable, retain a recoverable job error instead of placing the asset in whichever project is now active.

Attach provenance to the imported asset or a linked job record: workflow/config version, graph hash, connection label/ID, model identifiers found in the configured graph, resolved seed and parameters, prompt and authorized reference asset IDs/hashes, prompt_id, selected output node/index and descriptor, output hash/dimensions, timestamps, and status. Do not include auth secrets. Prompt provenance should follow existing project access and retention policy, not public image metadata by default.

ComfyUI SaveImage may embed prompt/workflow metadata in PNGs. Treat received metadata as untrusted and potentially private. Decide explicitly whether the project retains originals or strips metadata on export; do not leak server paths, prompts, or credentials through an exported image. Credentials must never have entered the graph in the first place. [C4]

Refresh the originating project’s asset/workspace view through the existing update mechanism after import. If the current view is another project, update the job indicator and offer “Open project A”; do not cause a cross-project insertion. Reopening the original project should show the durable result without needing the original WebSocket session.

For Work Here, generated bytes must first exist as a managed project file through the generation/import path. register_design_artifact verifies an existing name and SHA256; it is not a byte-upload operation. Refresh prepare_design_context in the same workflow/session using the current expectedRevision, a new requestId, and the unchanged exact project/source/app binding. The new contextRevision invalidates old asset and mutation handles. Preserve hostSessionId, expectedBindingRevision, and any workspaceId/workspaceMemberId; never fall back to the active project. A frozen package does not automatically see a newly generated file. [O12, O13]

Respect Work Here’s separate 2 MiB per-resource, 16 MiB package, and 128-resource limits. A valid generated image can exceed packaging limits even if generation/import succeeds; report that limitation and offer an explicitly derived smaller preview rather than claiming the full image was delivered or silently replacing the original. get_design_asset uses current project/workflow/session/contextRevision/assetId and returns authorized image bytes or bounded original chunks with SHA. Source bindings do not authorize unrelated file writes/network access, and repository promotion remains a separate operation. [O12, O13]

## Security and operational limits

All requests originate from the application backend. The browser never receives the backend token and never needs direct access to ComfyUI. Do not assume ComfyUI’s classic routes enforce tenant ownership; app-side ownership checks are necessary but insufficient if unrelated clients can directly access an unauthenticated shared service. Use a trusted authenticated proxy or isolated server as the deployment boundary.

Validate connection URLs at save and request time. Allow only http/https and corresponding ws/wss derived from the same configured origin; reject userinfo, fragments, arbitrary per-job endpoints, and unexpected query strings. Require an explicit trusted-local policy for loopback/private-network backends and still block metadata/link-local destinations and unrelated internal services. Pin/validate resolution against DNS rebinding, revalidate redirects or disable them, and never forward credentials across origins. An administrator-approved LAN server is a deliberate allowlist entry, not permission for unrestricted SSRF.

Baseline endpoint allowlist: GET /object_info and required class schema paths, GET /queue, GET /history/{ownedPromptId}, GET /view with validated descriptors, GET /ws, POST /upload/image, POST /prompt, and owned-ID-only POST /queue. A small bounded history-list read for ambiguous submission recovery requires an explicit deployment policy. Connection diagnostics may use a documented read-only health/statistics route. Optional version-verified targeted cancellation routes are separate capabilities. Block workflow-driven endpoint URLs, arbitrary proxying, global interrupt, queue clearing, history clearing, node installation, filesystem browsing, and arbitrary custom routes.

Proposed conservative defaults, tunable by a trusted operator: 2 MiB API graph; 500 nodes; 4 reference images; 16 MiB per upload (matching the current project reference helper unless deliberately extended) and 40 megapixels decoded per reference; 40 MiB fetched output and 64 megapixels decoded; one image output per job; one active OpenDesign generation per connection and a small bounded local queue (this cannot limit independent clients on the same server); 10-second connect timeout; 60-second upload/download timeout; 15-minute execution deadline; retry safe reads with jitter and capped delay. These are product limits, not ComfyUI guarantees. Report breaches before GPU submission where possible. A deadline stops waiting or marks the job timed out; it does not prove remote execution stopped. Retain an unresolved occupancy marker for submission_unknown and deadline-expired jobs. Do not free the local connection slot and launch another job until terminal evidence arrives or the user/operator explicitly overrides after seeing the possibility that the first job is still running. Independent clients remain outside this scheduler’s control.

Do not log secrets, authorization headers, URL credentials, image bytes, full graphs, or private prompts by default. Sanitize errors from server/proxy responses before display. Store a correlation ID and typed error code; give an explicit diagnostic export control with redacted content. Treat workflow imports and custom nodes as executable capability: schema validation does not sandbox server-side code or prevent a custom node from making network calls. Do not auto-install dependencies or enable unknown paid API nodes through import. Capability tags are declarations to validate, not security boundaries.

## Example configurations

These examples define proposed OpenDesign configuration JSON. They are not native ComfyUI APIs and were not executed. API-format graph content is stored separately or embedded by value when a configuration is published; a filename below is a local import label, not a workflow execution URL.

### Product render with text only

```json
{
  "configId":"product-render",
  "version":1,
  "name":"Product render",
  "connectionId":"studio-gpu",
  "graphImportLabel":"product-render-api.json",
  "capabilityTags":["text-to-image"],
  "references":{"min":0,"max":0},
  "bindings":{
    "prompt":[{"nodeId":"6","input":"text"}],
    "negativePrompt":[{"nodeId":"7","input":"text"}],
    "seed":[{"nodeId":"3","input":"seed"}],
    "width":[{"nodeId":"5","input":"width"}],
    "height":[{"nodeId":"5","input":"height"}],
    "steps":[{"nodeId":"3","input":"steps"}]
  },
  "parameters":{
    "negativePrompt":{"type":"string","required":false,"default":""},
    "seed":{"type":"integer","required":true,"default":42,"minimum":0},
    "width":{"type":"integer","required":true,"default":1024,"minimum":512,"maximum":1536,"multipleOf":64},
    "height":{"type":"integer","required":true,"default":1024,"minimum":512,"maximum":1536,"multipleOf":64},
    "steps":{"type":"integer","required":true,"default":20,"minimum":1,"maximum":50}
  },
  "output":{"nodeId":"9","kind":"image","index":0},
  "enabled":false
}
```

This mapping matches the illustrative API graph above. Keep the checkpoint choice in the imported graph for MVP; a future exposed model dropdown must use actual server enum values. Width/height limits here are proposed configuration constraints, not proof of model support. Enable only after successful schema validation; whether a test run is mandatory is a product policy, and its status stays separate.

### Source and style reference edit

```json
{
  "configId":"reference-edit",
  "version":1,
  "name":"Source and style edit",
  "connectionId":"studio-gpu",
  "graphImportLabel":"reference-edit-api.json",
  "capabilityTags":["image-edit","multi-reference"],
  "references":{
    "min":2,"max":2,
    "slots":[
      {"key":"source","label":"Source image","required":true,"nodeId":"20","input":"image"},
      {"key":"style","label":"Style reference","required":true,"nodeId":"21","input":"image"}
    ]
  },
  "bindings":{
    "prompt":[{"nodeId":"30","input":"text"}],
    "seed":[{"nodeId":"40","input":"seed"}]
  },
  "parameters":{
    "seed":{"type":"integer","required":true,"default":42,"minimum":0}
  },
  "output":{"nodeId":"50","kind":"image","index":0},
  "enabled":false
}
```

This is a concrete binding example for an imported, independently validated reference-edit graph, not a claim that arbitrary LoadImage nodes make a model reference-aware. Nodes 20 and 21 must be compatible image loaders, node 30 a real prompt input, node 40 a real seed input, and node 50 the designated final image output. The actual graph must connect both images into a model/conditioning path designed to use source and style semantics. Require both input branches to be reachable from the chosen output and a test demonstrating each reference affects the result; mere presence of two loaders is insufficient. Do not concatenate images or use a batch node as a substitute for semantic multi-reference support.

For an example run, upload source and style bytes independently; bind their returned relative paths to 20.image and 21.image, bind the prompt “Keep the cup silhouette; use the second image’s color palette” to 30.text, and persist the slot order. Reject a third image or a missing style reference before submission. It remains one output image under the MVP contract.

## Implementation sequence and acceptance gates

### Phase 1 Records and adapter seam

Add migration-backed connection, configuration-version, and durable-job storage under the repository’s RUNTIME_DATA_DIR conventions; keep credentials outside public settings responses. Introduce workflow configuration selection without breaking existing provider/model choices. Define the shared backend API and CLI commands for connection/configuration management, validation, generation, status, and supported cancellation alongside the UI. Add the adapter dispatch and compatibility wrapper, initially feature-flagged and disabled. Acceptance: two named configurations share one connection, persist across restart, and never expose secrets through settings or exports. Existing providers’ tests remain unchanged and pass.

### Phase 2 Import and validation UI

Build the Media section, workflow cards, API JSON detection, input mapping editor, designated-output selector, schema validator, and separate connection/schema/test statuses. Acceptance: canvas JSON is rejected helpfully; a nonexistent node/input or incompatible default is identified before submission; imported graph edits create new versions; stale versions are unavailable for new runs without changing old job snapshots.

### Phase 3 One image execution path

Implement reference byte resolution, upload descriptor persistence, exact patching, prompt submission, socket correlation, history reconciliation, output download, and existing-format result adaptation. Add durable state before each network transition. Acceptance: the text-only example imports one actual image into its origin project; a two-reference graph uploads and binds both references in the correct semantic order and still returns one image.

### Phase 4 Recovery and project integration

Implement request deduplication, startup job reconciliation, refresh-safe status reads, idempotent asset import, project-specific workspace refresh, and actionable errors. Acceptance: closing/reopening the panel or restarting the app does not duplicate a known submitted job; lost socket events recover through history; switching project A to B cannot change destination or leak A’s result into B.

### Phase 5 Shared server hardening and release

Apply endpoint/network allowlists, resource limits, redaction, owned-job queue deletion, capability-gated atomic cancellation, and diagnostics. Validate against at least one supported deployment and document its ComfyUI version, custom-node versions, and checkpoint prerequisites. Acceptance: unrelated jobs remain untouched, no secret reaches browser logs, private-network exceptions are narrow, and current providers still work. Release only after the tests below are demonstrated; this document does not claim they have passed.

## Manual and automated test checklist

- Two workflow cards, one backend: generate with each, verify exact graph hash/version and selected final output.
- API graph versus canvas JSON: accept valid API graph, reject editor JSON, malformed JSON, oversized graph, and unknown node/input with specific messages.
- Typed parameters: preserve integers/booleans, apply defaults once, reject missing required fields and out-of-range dimensions without silent coercion.
- Text-only workflow: attached references are rejected clearly; no image is silently ignored.
- Two-reference edit: swap source/style and verify mappings change; reject missing/excess references; confirm both are used by the actual graph, not just uploaded.
- Upload collision: simulate renamed upload response and prove the patched graph uses returned name/subfolder/type.
- Designated output: include a preview and two SaveImage nodes; only the chosen node/index is imported.
- Project A job, project B UI: switch during queue/run/import; output and provenance remain in A; B’s canvas and media list remain clean.
- UI refresh and process restart: recover the same durable job, seed, workflow version, prompt ID, and import record.
- Socket drop: disconnect during execution and before terminal event; history recovery imports once and /prompt is not sent again.
- Ambiguous submission: drop the HTTP response after server acceptance; retain submission_unknown and reconcile where possible, never blind retry.
- Duplicate click/request retry: same requestId yields one submission attempt; intentional “Generate again” gets a new ID.
- History delay/eviction: delayed history is retried; missing history plus missing queue becomes unresolved, not success or automatic regeneration.
- Auth/network errors: 401/403, DNS failure, proxy HTML, timeout, and changed certificate produce sanitized distinct errors.
- Runtime failure: missing checkpoint, custom-node failure, GPU OOM, interruption, and partial outputs never yield a false completed asset.
- Cancellation race: a queued job becomes running before delete; UI reconciles; unrelated running job is never interrupted; unsupported running cancellation is explained.
- Completed remote job, failed download/import: retry only safe reads or local import, with no new GPU job and no duplicate asset.
- SSRF and file safety: reject metadata IP, redirect to a different origin, DNS rebinding, descriptor traversal, project symlink escape, oversized decoded image, and HTML masquerading as an image.
- Version drift: remove a required node/model or change an input schema after validation; block new stale runs and retain prior job provenance.
- Work Here refresh: new image appears in the originating workspace through the existing refresh mechanism; regenerate/retry does not overwrite unrelated files.
- UI and CLI parity: create/validate/select a workflow and submit/check the same job through both surfaces; verify identical authorization and error semantics.
- Secret/privacy audit: token never appears in client settings, graph JSON, URLs, logs, diagnostic bundle, or image metadata; prompts/reference bytes are omitted from ordinary telemetry.

## Decisions still needed before implementation

Choose the first supported ComfyUI deployment/version and authentication proxy, the two real API-export graphs and their model/custom-node prerequisites, whether test runs are mandatory before enablement, the reference and image-size budgets appropriate to that server, and the retained metadata/export policy. These decisions refine validation and rollout; they do not change the one-server/many-configurations architecture.

## Sources and evidence

Sources were inspected read-only on 15 October 2026. Repository URLs are pinned to inspected revisions; documentation pages may evolve. The citations below identify the inspected sources and their verification scope. Proposed architecture, limits, contracts, and examples are recommendations, not existing product claims.

- [C1] [ComfyUI server routes and validation implementation](https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/server.py)

- [C2] [Official ComfyUI WebSocket message documentation](https://docs.comfy.org/development/comfyui-server/comms_messages)

- [C3] [Official ComfyUI WebSocket API example](https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/script_examples/websockets_api_example.py)

- [C4] [ComfyUI built-in image nodes](https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/nodes.py)

- [C5] [ComfyUI execution and prompt queue implementation](https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/execution.py)

- [C6] [ComfyUI job management implementation](https://github.com/Comfy-Org/ComfyUI/blob/ba994879b88d0ebd9950b1e5c1e923d928f216ba/comfy_execution/jobs.py)

- [C7] [Official ComfyUI server route documentation](https://docs.comfy.org/development/comfyui-server/comms_routes)

- [O1] [OpenDesign daemon media registry](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/media/models.ts)

- [O2] [OpenDesign media configuration](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/media/config.ts)

- [O3] [OpenDesign generation and provider contract](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/media/index.ts)

- [O4] [OpenDesign media task routes and exact-byte snapshots](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/routes/media.ts)

- [O5] [OpenDesign shared media API contracts](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/packages/contracts/src/api/media.ts)

- [O6] [OpenDesign CLI media dispatch and wait](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/cli.ts)

- [O7] [OpenDesign web media registry](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/web/src/media/models.ts)

- [O8] [OpenDesign Media provider settings](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/web/src/components/SettingsDialog.tsx)

- [O9] [Repository agent and data-path conventions](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/AGENTS.md)

- [O12] [Work Here workflow and resource limits](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/docs/work-here.md)

- [O13] [Work Here MCP implementation](https://github.com/andremolnar/open-open-design/blob/ffcedd500a3621c6848bf175889ae2b47670e521/apps/daemon/src/mcp-design-workflow.ts)

- [O10] [Closed unmerged ComfyUI provider PR 4570](https://github.com/nexu-io/open-design/pull/4570)

- [O11] [PR 4570 final fixed SDXL provider implementation](https://github.com/eeromattinen-svg/open-design/blob/80586d0fa5247a545591276d42ab5e840bd08311/apps/daemon/src/media/index.ts#L1121)
