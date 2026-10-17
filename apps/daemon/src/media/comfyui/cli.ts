import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { ComfyConnectionInput } from '@open-design/contracts';

export const COMFY_CLI_HELP = `Usage: od media comfyui <action> [options]
  list                                      List servers and workflow versions
  server-add --file <json> [--token-file <path|->]
  check --server <id>                        Read-only connection test
  workflow-add --file <json> [--workflow <id>]
  validate --workflow <id> --version <n>      Check schemas (does not generate)
  enable|disable --workflow <id> --version <n>
  release --task <id> --confirm-unknown       Release local occupancy after inspecting the server; does not cancel it

All actions accept --json and --daemon-url <url>.
server-add JSON: {"name":"Studio","baseUrl":"http://127.0.0.1:8188","trustedNetwork":true}
Keep secrets out of argv; use --token-file (or - for stdin). Tokens are never returned.
workflow-add JSON contains name, connectionId, graph (API export), promptTargets,
and output {nodeId,index:0}. With --workflow, append a new disabled version.

After validation and enablement, submit a real, potentially costly GPU run with:
  od media generate --surface image --project <id> --model comfyui/<id>@<version> --prompt-file <path|-> --json
Use the existing media wait command to check the returned task. Dimensions stay
as imported; image references and aspect/quality/resolution overrides are unsupported.`;

export async function runComfyCli(args: string[], resolveBase: (url?: string) => Promise<string>): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    file: { type: 'string' }, 'token-file': { type: 'string' }, server: { type: 'string' },
    workflow: { type: 'string' }, version: { type: 'string' }, 'daemon-url': { type: 'string' },
    json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    task: { type: 'string' }, 'confirm-unknown': { type: 'boolean' },
  } });
  const action = positionals[0];
  if (values.help || !action || action === 'help') { console.log(COMFY_CLI_HELP); return; }
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
  } else if (['validate', 'enable', 'disable'].includes(action)) {
    path += `/workflows/${required(values.workflow, 'workflow')}/${required(values.version, 'version')}/${action === 'validate' ? 'validate' : 'enabled'}`;
    body = action === 'validate' ? {} : { enabled: action === 'enable' };
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
