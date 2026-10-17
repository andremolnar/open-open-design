import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { ComfyConnectionInput, ComfyDiscovery } from '@open-design/contracts';
import { isComfyLiteral } from '@open-design/contracts';

export const COMFY_CLI_HELP = `Usage: od media comfyui <action> [options]
  list                                      List servers and workflow versions
  discover                                  Read-only agent-safe server/workflow/input discovery
  server-add --file <json> [--token-file <path|->]
  check --server <id>                        Read-only connection test
  workflow-add --file <json> [--workflow <id>]
  workflow-show --workflow <id> --version <n>  Inspect graph and input mappings
  validate --workflow <id> --version <n> [--server <id>]  Optional selected-server schema check (does not generate)
  enable|disable --workflow <id> --version <n>
  release --task <id> --confirm-unknown       Release local occupancy after inspecting the server; does not cancel it

All actions accept --json and --daemon-url <url>.
server-add JSON: {"name":"Studio","baseUrl":"http://127.0.0.1:8188","trustedNetwork":true}
Keep secrets out of argv; use --token-file (or - for stdin). Tokens are never returned.
workflow-add JSON contains name, optional preferred connectionId, graph (API export), promptTargets,
and output {nodeId,index:0}. Optional parameters: [{name,nodeId,input}].
Fixed values live in graph.inputs; only promptTargets and parameters are overridden.
With --workflow, append a new disabled version.

After enablement, submit a real, potentially costly GPU run with:
  od media generate --surface image --project <id> --model comfyui/<id>@<version> --prompt-file <path|-> --json
For declared parameters add --workflow-inputs-file <json|->, e.g. {"resolution":"medium"}.
Select a different saved server with --comfy-server <id>. If omitted, use the
workflow preference or the sole saved server; multiple servers require a choice.
All declared parameters are required. Use the existing media wait command to check
the returned task. Generic aspect/quality/resolution flags and image references are unsupported.`;

export async function readComfyWorkflowInputs(file: string): Promise<Record<string, string | number | boolean>> {
  const raw = file === '-' ? readFileSync(0, 'utf8') : await readFile(file, 'utf8');
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Workflow inputs exceed 2 MiB');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32
    || !Object.values(value).every(isComfyLiteral)) throw new Error('Workflow inputs must be an object of at most 32 text, number or boolean values');
  return value as Record<string, string | number | boolean>;
}

export async function runComfyCli(args: string[], resolveBase: (url?: string) => Promise<string>): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    file: { type: 'string' }, 'token-file': { type: 'string' }, server: { type: 'string' },
    workflow: { type: 'string' }, version: { type: 'string' }, 'daemon-url': { type: 'string' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    task: { type: 'string' }, 'confirm-unknown': { type: 'boolean' },
  } });
  const action = positionals[0];
  if (values.help || !action || action === 'help') { console.log(COMFY_CLI_HELP); return; }
  if (action === 'discover') {
    const base = (await resolveBase(values['daemon-url'])).replace(/\/$/, '');
    const response = await fetch(`${base}/api/media/models`);
    if (!response.ok) throw new Error('Could not discover ComfyUI capabilities from the daemon');
    const payload = await response.json() as { comfyui?: ComfyDiscovery };
    if (!payload.comfyui) throw new Error('Daemon does not expose ComfyUI discovery; update the running app.');
    console.log(JSON.stringify(payload.comfyui, null, values.json ? 0 : 2));
    return;
  }
  let path = '/api/media/comfyui';
  let body: unknown;
  const required = (value: string | undefined, flag: string) => {
    if (!value) throw new Error(`--${flag} is required`);
    return encodeURIComponent(value);
  };
  if (action === 'server-add' || action === 'workflow-add') {
    if (!values.file) throw new Error('--file is required');
    body = JSON.parse(await readFile(values.file, 'utf8'));
    if (action === 'server-add') {
      if (values['token-file']) (body as ComfyConnectionInput).token =
        (values['token-file'] === '-' ? readFileSync(0, 'utf8') : await readFile(values['token-file'], 'utf8')).trim();
      path += '/connections';
    } else path += values.workflow ? `/workflows/${encodeURIComponent(values.workflow)}/versions` : '/workflows';
  } else if (action === 'check') {
    path += `/connections/${required(values.server, 'server')}/check`;
    body = {};
  } else if (action === 'workflow-show') {
    path += `/workflows/${required(values.workflow, 'workflow')}/${required(values.version, 'version')}`;
  } else if (['validate', 'enable', 'disable'].includes(action)) {
    path += `/workflows/${required(values.workflow, 'workflow')}/${required(values.version, 'version')}/${action === 'validate' ? 'validate' : 'enabled'}`;
    body = action === 'validate' ? (values.server ? { comfyServerId: values.server } : {}) : { enabled: action === 'enable' };
  } else if (action === 'release') {
    if (!values['confirm-unknown']) throw new Error('--confirm-unknown is required; this does not cancel server execution');
    path += `/executions/${required(values.task, 'task')}/release`;
    body = { confirmUnknown: true };
  } else if (action !== 'list') throw new Error(`Unknown ComfyUI action: ${action}`);
  const base = (await resolveBase(values['daemon-url'])).replace(/\/$/, '');
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const payload = await response.json() as { error?: { message?: string } | string };
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message ?? 'ComfyUI request failed');
  console.log(JSON.stringify(payload, null, values.json ? 0 : 2));
}
