# ComfyUI image workflow adapter (experimental)

This branch supports a first manual-test slice: save a server, import a named
API-format workflow, lock fixed inputs, bind request-time inputs, select one image output, validate
and enable the version, then run a test into an open OpenDesign project.

It uses the classic ComfyUI `/object_info`, `/prompt`, `/history/{prompt_id}` and
`/view` routes. A server address is **not** a per-workflow HTTP endpoint. Hosted
services that expose a different API are not supported by this transport.

No configured server, credentials, workflow graph, model filenames or custom-node
preset is bundled. Operators supply their own connection and API export at runtime;
the adapter derives bindings from that saved graph. Repository examples and test
screenshots use synthetic fixtures, not a user's configuration.

## Manual test from the interface

1. Start the branch through the normal development entry point:
   `pnpm tools-dev run web --daemon-port 17456 --web-port 17573`.
2. Create a project if needed. Open **Settings → Media providers** and click
   **Configure ComfyUI** at the top. Select that project in
   **ComfyUI manual-test destination project** below the button.
   This explicit choice is necessary because full-page Settings has its own route.
3. Enter a name and the server origin, for example `http://127.0.0.1:8188`.
   For an operator-owned loopback/LAN server, explicitly approve the trusted
   network checkbox. HTTP is unencrypted; use HTTPS for untrusted networks.
   A proxy bearer token is optional and write-only. Save, then **Test connection**.
   This read-only operation does not submit a workflow or test the GPU.
4. In ComfyUI, export a working workflow using **API format**, not the visual
   editor/canvas document. Its checkpoint and custom nodes must already exist on
   that server. Import the JSON under Workflow or paste it and click **Build
   input form**. Both the node graph and a `{"prompt": {...}}` request envelope
   are accepted; envelope fields such as `client_id` are not imported.
   Give the workflow a name.
   File imports populate the JSON editor and use the filename as an initial name.
   A single recognized prompt input and a single image output are suggested when
   unambiguous; review them rather than assuming every graph has the same layout.
5. The form groups inputs by node and shows each exact node ID/input path.
   Choose a source for each literal:
   - **Locked value**: edit and save it as part of the immutable workflow version.
     For example, save width and height literals for a fixed image size. If a
     dimension comes from another node, leave that connection intact.
   - **Image prompt from media request**: choose this for the positive text input
     shown in your imported graph. The caller's `prompt` replaces that value exactly;
     there is no global search/replace or LLM-generated graph.
   - **Named input from media request**: choose a unique public name such as
     `seed` or `resolution`. Every such input must be supplied in `workflowInputs`
     on each new job. The graph value is the manual-test starting example, not
     a silent fallback for omitted arguments. Text, number and boolean literals
     are supported; connections and structured values stay read-only.
   Then select the exact final `SaveImage` or
   `PreviewImage` node. This slice imports **image index 0 as a PNG**. Confirm
   that you trust the graph: choosing an output does not prune other executable
   branches, and custom nodes can execute server-side code. Import never installs
   dependencies. Known advertised paid/API nodes and non-image output nodes are
   rejected, but schema validation is not a sandbox.
   The **Before saving** checklist names any missing setup. Save stays actionable
   and reports those requirements instead of silently remaining grey. Changing
   the destination project does not discard your unsaved graph or mappings.
6. Save the disabled version. Click **Validate schema**. Resolve missing nodes,
   models/enums, incompatible links, or invalid input values on the server or
   by importing a revised version. Validation discloses executable output node IDs.
7. Click **Enable**. Under **Manual image test**, choose the exact workflow
   version, enter a prompt, fill its named request inputs and confirm a real generation. The selected server
   and originating project are displayed before submission. Click **Run image test**.
8. Wait for the imported filename and preview. It should also appear among that
   project's files. Reload Settings to verify that the server/workflow and task
   result survive the browser session. Verify the result on your real server;
   protocol-fixture tests are not evidence of GPU generation.

Use **Edit as new version** on a saved workflow to inspect its graph/mappings
and change locked values without rewriting a published or in-flight version.
The image-output selection is saved and server schema validation verifies that
it is an executable `PreviewImage` or `SaveImage` node. Other executable image
branches may still run; selecting one does not prune the graph.

Locked dimensions, seed, steps and other literals are preserved. The adapter does
not silently change them to match generic composer controls. Reference uploads,
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
Configuration is operator-only, not available to sandboxed agents.

```sh
od media comfyui server-add --file server.json --token-file /path/to/token --json
od media comfyui list --json
od media comfyui check --server <server-id> --json
od media comfyui workflow-add --file workflow.json --json
od media comfyui validate --workflow <workflow-id> --version 1 --json
od media comfyui enable --workflow <workflow-id> --version 1 --json
od media generate --project <project-id> --surface image \
  --model 'comfyui/<workflow-id>@1' --prompt-file /path/to/prompt \
  --workflow-inputs-file inputs.json --json
```

`server.json` contains `name`, `baseUrl`, and `trustedNetwork`. Keep tokens out
of argv and graph JSON; `--token-file -` reads a token from stdin. Tokens are
stored in the daemon database in a separate credential table, **not encrypted**,
and are omitted from settings responses and browser storage. Runtime data follows
the [root data-directory contract](../AGENTS.md#daemon-data-directory-contract).

`workflow.json` contains `name`, `connectionId`, the API graph object as `graph`,
`promptTargets: [{"nodeId":"6","input":"text"}]`, and
`output: {"nodeId":"9","index":0}`. IDs must match your exported graph.
`workflow-add --workflow <id>` appends a disabled immutable version; enablement
never silently changes a running job's selected version. Disable with
`od media comfyui disable --workflow <id> --version 1 --json`.

`parameters` optionally declares other request inputs, for example
`[{"name":"seed","nodeId":"2","input":"seed"}]`. Their types are inferred
from their saved graph literals. `inputs.json` would then contain `{"seed":123}`;
omit `--workflow-inputs-file` when no named parameters are declared. The flag
also accepts `-` for stdin, but cannot share stdin with `--prompt-file -`.
Use `od media comfyui workflow-show --workflow <id> --version 1 --json` to inspect
the saved version, including locked values, prompt/parameter mappings and output.

The existing media generation HTTP request accepts `workflowInputs` alongside
`prompt`, `model`, `surface` and `requestId`, for example:

```json
{"surface":"image","model":"comfyui/<workflow-id>@1","prompt":"A ceramic cup","workflowInputs":{"seed":123},"requestId":"a-unique-stable-request-id"}
```

Unknown/missing inputs, wrong primitive types, duplicate mappings and attempts
to override locked values are rejected. Server enum choices and numeric limits
are checked against the substituted graph before `/prompt`. The public model
catalog advertises named request input names/types without disclosing the graph.
Request deduplication includes sorted input values; reusing a request ID with
different values fails rather than reusing the wrong image or submitting again.

`comfyui` is the provider name, **not** a runnable model ID. Before asking an
assistant to generate, save, validate and enable a workflow, then give it the exact
`comfyui/<workflow-id>@<version>` ID shown on the workflow card (and any declared
request inputs). A bare-provider request is rejected before creating a task or
submitting to the server; its diagnostic lists enabled IDs/input types when
available. Repeating `--model comfyui` cannot fix missing configuration.

Bound projects require the existing `--workspace` and `--workspace-member` flags
on generation and wait commands. Media policy and project write authorization
still apply. New ComfyUI generations accept `--request-id <stable-id>` for safe
HTTP retries; use a new ID only for a deliberately new generation.

## Recovery and current limits

- No automatic retry of `/prompt`. A lost submission response is **outcome
  unknown**, not proof of failure. Its connection remains occupied to avoid
  launching another job behind it. Inspect the server before any deliberate
  new generation. Recovery without a known prompt ID is not implemented. After
  inspection, an operator can explicitly acknowledge the risk and **Release
  local server slot**. This does not cancel remote work or change its recorded
  outcome. CLI: `od media comfyui release --task <id> --confirm-unknown --json`.
- Known prompt IDs are persisted against the existing media task. For a failed
  download, interrupted wait, or daemon restart, use **Recover recorded result**
  in Settings. It reads the same history and output; it does not submit again.
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
- Workflows are selectable for the Settings manual test and through the
  versioned model ID in the media API/CLI; the general chat/composer workflow
  picker, reference-image editors and universal quality/aspect translation remain follow-up work.

The design guide is [draft PR #7](https://github.com/andremolnar/open-open-design/pull/7).
This slice is not a claim that all acceptance gates in that proposal are complete.
