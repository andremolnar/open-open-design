# ComfyUI image workflow adapter (experimental)

ComfyUI is an image provider alongside the other Media providers. OpenDesign
manages reusable, named API-format workflows independently of its saved servers.
Each workflow may prefer a server, and a generation may select another server.
This slice imports one PNG into the project that requested the generation.

It uses the classic ComfyUI `/system_stats`, `/object_info/{node_class}`, `/prompt`,
`/history/{prompt_id}` and `/view` routes, never the full `/object_info` catalogue.
A server address is **not** a per-workflow HTTP endpoint. Hosted
services that expose a different API are not supported by this transport.

No configured server, credentials, workflow graph, model filenames or custom-node
preset is bundled. Operators supply their own connection and API export at runtime;
the adapter derives bindings from that saved graph. Repository examples and test
screenshots use synthetic fixtures, not a user's configuration.

## Configure from the interface

1. Start the branch through the normal development entry point:
   `pnpm tools-dev run web --daemon-port 17456 --web-port 17573`.
2. Open **Settings → Media providers → ComfyUI**. This is a provider tab;
   other providers' settings are hidden while ComfyUI is selected.
3. **Active servers** lists saved servers and a **Test connection** action for
   each. “Active” means configured for selection, not proof that a server is
   online or supports a workflow. **Add server** opens its own configuration
   screen; saving returns to the list. Enter a name and the server origin,
   for example `http://127.0.0.1:8188`.
   For an operator-owned loopback/LAN server, explicitly approve the trusted
   network checkbox. HTTP is unencrypted; use HTTPS for untrusted networks.
   A proxy bearer token is optional and write-only. Save, then **Test connection**.
   This read-only operation checks the small `/system_stats` response, not the
   installed-node/model catalogue. It does not submit a workflow, test GPU
   generation, or prove that a particular workflow is compatible.
4. In ComfyUI, export a working workflow using **API format**, not the visual
   editor/canvas document. Its checkpoint and custom nodes must already exist on
   that server. Import the JSON under Workflow or paste it and click **Build
   input form**. Both the node graph and a `{"prompt": {...}}` request envelope
   are accepted; envelope fields such as `client_id` are not imported.
   Give the workflow a name. **Preferred server** is optional and does not pin
   the workflow to that server. Workflows can be saved before any server exists.
   File imports populate the JSON editor and use the filename as an initial name.
   A single recognized prompt input and a single image output are suggested when
   unambiguous; review them rather than assuming every graph has the same layout.
5. The form groups simple typed fields by node. Imported values are **defaults**:
   edit prompt text, seed, dimensions, steps, other numeric values or booleans
   directly. There are no per-field Source selectors or request-key naming steps.
   Every editable field is automatically promptable and discoverable; callers
   supply only the overrides they want. Omitted fields keep the saved default.
   Text with unknown allowed choices (models, samplers, presets, filenames),
   graph links, structured values and multi-image batch controls remain under
   **Stored values (read-only)**. The raw JSON editor collapses after import.
   When several text inputs exist, **Image prompt field** identifies the one that
   receives the main request prompt; no positive/negative encoder is guessed.
   An explicit named override for that field takes precedence over the main prompt.
   Editable defaults are included in discovery: never put secrets in them.
   Then select the exact final `SaveImage` or
   `PreviewImage` node. This slice imports **image index 0 as a PNG**. Confirm
   that you trust the graph: choosing an output does not prune other executable
   branches, and custom nodes can execute server-side code. Import never installs
   dependencies. Known advertised paid/API nodes and non-image output nodes are
   rejected, but schema validation is not a sandbox.
   The **Before saving** checklist names any missing setup. Save stays actionable
   and reports those requirements instead of silently remaining grey. Opening
   and cancelling Add server does not discard unsaved workflow defaults.
6. Save the disabled version and **Enable** it when ready. **Validate schema**
   is an optional, read-only check against the preferred or sole server; the CLI
   can check a different server explicitly. This does not establish compatibility
   with every server, disable the workflow globally, or submit a GPU job.
7. Generate from the current project or image creation interface, not from a
   Settings-only test form. Enabled workflows appear as ComfyUI image model
   choices. An assistant can discover a named workflow and its required inputs
   without asking you to copy an opaque ID. The requesting project owns the
   imported image; there is no Settings destination-project selector.
8. Only the selected workflow's distinct node classes are fetched from the server
   via `/object_info/{node_class}`; unrelated nodes are never enumerated. Each
   class is fetched once per validation/submission, without cross-run caching,
   so changed models, ranges and node types are still checked. These live schemas
   and the substituted graph are checked before
   submission. Missing nodes, models/enums, invalid inputs, authentication and
   connection failures are reported; OpenDesign does not try other servers or
   providers automatically. The operator is responsible for installed models,
   custom nodes and GPU capacity. Protocol-fixture tests do not establish real
   model/server compatibility.

Health responses are capped at 64 KiB. Node schemas retain an 8 MiB per-response
and aggregate workflow budget; history and image-download limits are unchanged.
Per-node metadata may still include that node's model/enum choices, because those
are needed to validate the workflow's fixed and overridden values. Servers or
proxies must expose `/system_stats` and per-node `/object_info/{node_class}`;
OpenDesign does not fall back to downloading the full catalogue if either fails.

Existing saved workflow versions retain their original server as a preference.
Their graph bytes, mappings, enabled state and in-flight job identity survive
the migration. A new version can change or remove the preference without
changing an earlier version or a submitted job.

Server selection is explicit request → workflow preference → sole saved server.
With several servers and no preference, the caller must choose a discovered
server ID. A missing or failing selection never silently falls through to another.

For “use Comfy with the Krea workflow, 4:3”, discovery resolves the saved name,
version, server preference, typed defaults and editable width/height fields.
The assistant can supply 1024/768 (or another supported 4:3 pair) through their
exact discovered keys. Linked dimensions must be changed at their editable
source node, not by replacing a connection. If several resize stages make the
intended size controls ambiguous, ask instead of guessing. An unavailable
ratio must be reported, not ignored or invented. Video/audio is not supported.

For “five versions with a random seed each” or “six different aspect ratios”,
the assistant submits separate sequential image jobs, with concrete seed or
dimension overrides and a unique request ID per job. Each job is awaited and
imports its own PNG; this is not `batch_size` mutation or automatic retry.
Random seeds are explicit safe integers (0..4294967295 is a portable starting
range), not the string `random` or an undocumented sentinel. On failure/unknown
outcome, report completed and remaining variants and stop rather than blindly
resubmitting. Live server schemas still enforce ranges and types.

Use **Edit as new version** on an existing workflow to adopt the simplified
default-based fields. Earlier published versions keep their explicit mappings
and required-input semantics; their defaults are not newly exposed. Save/enable
the new version when ready. No published or in-flight graph is rewritten.
The image-output selection is saved and server schema validation verifies that
it is an executable `PreviewImage` or `SaveImage` node. Other executable image
branches may still run; selecting one does not prune the graph.

Defaults are preserved unless explicitly overridden through discovered fields.
The adapter does not silently change them to match generic composer controls. Reference uploads,
image editing, multiple imported images, non-PNG outputs, and generic
aspect/quality/resolution overrides are not supported in this slice. Use a
managed OpenDesign project for the result; imported-folder destinations are
rejected rather than writing into a different, invisible directory.
The returned filename is generated from the media task ID; omit `--output` for
ComfyUI so recovered runs can reuse that exact safe destination.
Unsupported generic options are rejected before task creation with
`COMFY_UNSUPPORTED_OPTIONS` and `error.nextStep: "revise-options"`. An agent may
remove a default it added and submit the corrected request once; it must not
silently drop a ratio the user explicitly requested. This is not a missing-key
diagnosis and never authorizes resubmitting an unknown remote outcome.

## CLI parity

Use `od media comfyui help` for the complete setup format. Every configuration
action supports `--json` and `--daemon-url` and calls the same local API as Settings.
Configuration is operator-only, not available to sandboxed agents. Read-only
discovery is available through the existing media catalog and excludes server
URLs, tokens, private graphs and read-only values. New automatic versions expose
their editable defaults and node/type/role metadata; old versions expose only
required parameter names/types, not their saved examples.

```sh
od media comfyui server-add --file server.json --token-file /path/to/token --json
od media comfyui list --json
od media comfyui discover --json
od media comfyui check --server <server-id> --json
od media comfyui workflow-add --file workflow.json --json
od media comfyui validate --workflow <workflow-id> --version 1 --server <server-id> --json
od media comfyui enable --workflow <workflow-id> --version 1 --json
od media generate --project <project-id> --surface image \
  --model 'comfyui/<workflow-id>@1' --prompt-file /path/to/prompt \
  --workflow-inputs-file inputs.json --comfy-server <server-id> --json
```

`server.json` contains `name`, `baseUrl`, and `trustedNetwork`. Keep tokens out
of argv and graph JSON; `--token-file -` reads a token from stdin. Tokens are
stored in the daemon database in a separate credential table, **not encrypted**,
and are omitted from settings responses and browser storage. Runtime data follows
the [root data-directory contract](../AGENTS.md#daemon-data-directory-contract).

`workflow.json` contains `name`, optional preferred `connectionId`, the API graph object as `graph`,
`inputMode: "automatic"`, `promptTargets: [{"nodeId":"6","input":"text"}]`, and
`output: {"nodeId":"9","index":0}`. IDs must match your exported graph.
`workflow-add --workflow <id>` appends a disabled immutable version; enablement
never silently changes a running job's selected version. Disable with
`od media comfyui disable --workflow <id> --version 1 --json`.

Automatic fields use stable keys such as `node2_seed` and `node8_width`.
`inputs.json` can contain `{"node2_seed":123}`; all other fields keep defaults.
Legacy versions omit `inputMode` and can declare `parameters`, for example
`[{"name":"seed","nodeId":"2","input":"seed"}]`; those mappings remain
required and discovery marks them `required:true`. Omit the input file entirely
when no overrides or required legacy inputs are needed. The flag
also accepts `-` for stdin, but cannot share stdin with `--prompt-file -`.
Use `od media comfyui workflow-show --workflow <id> --version 1 --json` to inspect
the saved version, including locked values, prompt/parameter mappings and output.

The existing media generation HTTP request accepts `workflowInputs` alongside
`prompt`, `model`, `surface` and `requestId`. Optional `comfyServerId` selects a
saved server for a new submission only, for example:

```json
{"surface":"image","model":"comfyui/<workflow-id>@1","prompt":"A ceramic cup","workflowInputs":{"node2_seed":123},"comfyServerId":"<server-id>","requestId":"a-unique-stable-request-id"}
```

Unknown inputs, missing required legacy inputs, wrong primitive types, duplicate
mappings and attempts to override read-only values are rejected. Server numeric limits
are checked against the substituted graph before `/prompt`. The public model
catalog advertises named request input names/types without disclosing the graph.
Request deduplication includes sorted input values; reusing a request ID with
different values fails rather than reusing the wrong image or submitting again.

`comfyui` is the provider name, **not** a runnable model ID. Before asking an
assistant to generate, save and enable a workflow. The assistant can discover its
name and `comfyui/<workflow-id>@<version>` ID along with declared request inputs.
A bare-provider request is rejected before creating a task or
submitting to the server; its diagnostic lists enabled IDs/input types when
available. Repeating `--model comfyui` cannot fix missing configuration.

Bound projects require the existing `--workspace` and `--workspace-member` flags
on generation and wait commands. Media policy and project write authorization
still apply. New ComfyUI generations accept `--request-id <stable-id>` for safe
HTTP retries; use a new ID only for a deliberately new generation. Explicit
server selection participates in deduplication: the same request ID cannot be
reused to submit to another server.

## Recovery and current limits

- No automatic retry of `/prompt`. A lost submission response is **outcome
  unknown**, not proof of failure. Its connection remains occupied to avoid
  launching another job behind it. Inspect the server before any deliberate
  new generation. Recovery without a known prompt ID is not implemented. After
  inspection, an operator can explicitly acknowledge the risk and **Release
  local server slot**. This does not cancel remote work or change its recorded
  outcome. CLI: `od media comfyui release --task <id> --confirm-unknown --json`.
- Known prompt IDs and the actual selected server are persisted against the
  existing media task. For a failed download or interrupted wait, use **Recorded
  jobs needing attention → Recover recorded result** in ComfyUI Settings. It uses
  the original project's authorization and reads the same server history/output;
  it does not submit again. No project chooser or new server flag is involved.
  CLI equivalent: `od media generate --project <id> --surface image
  --model 'comfyui/<workflow-id>@1' --resume-task <task-id> --json`.
- Browser refresh does not cancel work. After daemon restart the existing task
  is interrupted until explicitly recovered; automatic startup recovery is not
  implemented. History eviction can leave the outcome unresolved.
- The first implementation uses bounded history polling, not WebSocket node
  progress. Its status does not claim queue position, ETA, or confirmed remote
  cancellation. It never calls global interrupt, queue clear, history clear,
  arbitrary node-install routes, or downloads from workflow-supplied URLs.
- DNS is checked and pinned per request. Redirects, link-local/metadata targets,
  and unapproved private addresses are rejected. A user-approved server is one
  saved origin, not a general-purpose network proxy.
- Imported images are bounded to 40 MiB / 64 megapixels (256 MiB decoded pixel
  data) and checked as PNG pixel
  data. Exact returned bytes flow through the existing project writer and
  snapshot callback. ComfyUI may embed private prompt/workflow metadata in PNGs;
  originals are retained, not silently stripped. Review metadata before export.
- Settings labels for this experimental surface currently use explicit English
  fallback in all locales. Existing provider settings and selections are unchanged.
- Enabled workflows appear in image creation pickers and the media API/CLI.
  Named-workflow discovery is available to assistants through `od media comfyui
  discover --json`. Reference-image editors, video/audio, and universal
   quality/aspect translation remain follow-up work. Ambiguous enums/model/file
   choices remain read-only until richer schema-backed controls are designed.

The design guide is [draft PR #7](https://github.com/andremolnar/open-open-design/pull/7).
This slice is not a claim that all acceptance gates in that proposal are complete.
