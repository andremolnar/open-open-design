import type { ChatSessionMode } from '../api/chat.js';
import type { MediaExecutionPolicy } from '../api/media.js';

/** Host-owned transport rules shared by classic, slim, BYOK and OD Next. */
export const COMFY_WORKFLOW_DISPATCH_CONTRACT = `
## ComfyUI workflow dispatch

Only when media generation is permitted by the active session mode and policy:
for a saved, enabled \`comfyui/<workflow-id>@<version>\` image workflow, these
rules override generic image-generation examples and project aspect defaults.
Use the exact selected workflow version, not the provider name \`comfyui\`.
When the user says "use Comfy" or names a workflow such as "Krea", discover
OpenDesign's saved servers, enabled workflow versions and typed inputs first:
\`"$OD_NODE_BIN" "$OD_BIN" media comfyui discover --json\` (the public
\`GET /api/media/models\` catalog carries the same \`comfyui\` metadata).
Resolve the user's workflow name to its discovered versioned model ID. Do not
ask the user to supply an opaque ID that discovery already provides. Ask when
names are ambiguous or no enabled match exists; never invent a workflow.
Respect the run's allowed models. Discovery is read-only and does not contact
the ComfyUI servers or expose their credentials, URLs or private graphs.

Workflows belong to OpenDesign, not to a server. Honor an explicitly requested
saved server using \`--comfy-server <discovered-server-id>\` (HTTP:
\`comfyServerId\`). Otherwise use its preferredServerId, or the sole saved
server. When several servers exist without a preference, choose only with a
clear user instruction or ask. Do not probe and route by guessed compatibility.
The selected server must have the workflow's models/custom nodes; validation
or execution errors must be reported meaningfully, not hidden by switching
servers or providers. No automatic cross-server retry. Recovery always uses
the original recorded server and prompt ID, with no new server flag.
Do not call ComfyUI directly or modify its graph yourself. Image media only.

The saved graph owns dimensions, aspect ratio and seed unless explicitly mapped
as named request inputs; all other values stay locked.
Do not pass \`--aspect\`, \`--quality\`, \`--resolution\`, \`--image\`, or \`--output\`
for this adapter; also omit image lists and generic output/size overrides from
HTTP requests. Do not inherit a default 16:9 flag from a generic example.
If the user explicitly asks for a ratio or option the configured workflow
cannot provide, ask them to revise the saved workflow or choose a compatible
version; do not silently ignore that requirement and generate a different size.

Minimal invocation (replace the model placeholder with the real selected ID):
\`\`\`sh
"$OD_NODE_BIN" "$OD_BIN" media generate --project "$OD_PROJECT_ID" \\
  --surface image --model 'comfyui/<workflow-id>@<version>' \\
  --prompt-file ./image-prompt.txt --json
\`\`\`

Only declared named inputs can vary: provide every required catalog input as
typed JSON via \`--workflow-inputs-file <path>\` (HTTP: \`workflowInputs\`).
The image prompt goes through \`--prompt-file\` or \`--prompt\`. Leave locked
settings alone. The dispatcher chooses the local filename and imports the
selected image output; no \`--output\` flag is needed. Follow the returned
task through \`media wait\` until it ends; dispatch acceptance is not an image.

For \`error.nextStep: "revise-options"\`, the request was rejected before any
provider submission. Correct an agent-added unsupported default once, without
changing the selected workflow, prompt or explicit user requirements. Do not
repeat the unchanged request. A configuration error is not proof of a missing
API key; never invent credential advice. An outcome unknown or known prompt ID
is different: never resubmit it to fix flags; recover its recorded result.
`;

export function renderComfyWorkflowDispatchContract(
  mediaExecution?: MediaExecutionPolicy,
  sessionMode?: ChatSessionMode,
): string {
  return mediaExecution?.mode === 'disabled' || sessionMode === 'chat' ? '' : COMFY_WORKFLOW_DISPATCH_CONTRACT;
}
