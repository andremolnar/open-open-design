import type { ChatSessionMode } from '../api/chat.js';
import type { MediaExecutionPolicy } from '../api/media.js';

/** Host-owned transport rules shared by classic, slim, BYOK and OD Next. */
export const COMFY_WORKFLOW_DISPATCH_CONTRACT = `
## ComfyUI workflow dispatch

Only when media generation is permitted by the active session mode and policy:
for a saved, enabled \`comfyui/<workflow-id>@<version>\` image workflow, these
rules override generic image-generation examples and project aspect defaults.
Use the exact selected workflow version, not the provider name \`comfyui\`.
If no version was selected, inspect the local \`GET /api/media/models\` catalog
and respect the run's allowed models; do not invent an ID or pick a different
workflow silently. Do not call ComfyUI directly or modify its graph yourself.

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
