import { readFileSync } from 'node:fs';
import {
  archiveDesignWorkflowRequestSchema,
  checkpointDesignWorkflowRequestSchema,
  getDesignAssetRequestSchema,
  getDesignWorkflowRequestSchema,
  prepareDesignContextRequestSchema,
  registerDesignArtifactRequestSchema,
} from '@open-design/contracts';

const commands = {
  prepare: { endpoint: 'prepare', schema: prepareDesignContextRequestSchema },
  status: { endpoint: 'get', schema: getDesignWorkflowRequestSchema },
  asset: { endpoint: 'asset', schema: getDesignAssetRequestSchema },
  checkpoint: { endpoint: 'checkpoint', schema: checkpointDesignWorkflowRequestSchema },
  'register-artifact': { endpoint: 'register-artifact', schema: registerDesignArtifactRequestSchema },
  archive: { endpoint: 'archive', schema: archiveDesignWorkflowRequestSchema },
} as const;

export type DesignWorkflowCliCommand = keyof typeof commands;
export interface DesignWorkflowCliFlags {
  'request-file': string;
  'prompt-file'?: string;
  'daemon-url'?: string;
  workspace?: string;
  'workspace-member'?: string;
  json?: boolean;
}

const stringFlags = new Set(['request-file', 'prompt-file', 'daemon-url', 'workspace', 'workspace-member']);

/** Require an explicit stable project ID; never resolve a name or UI focus. */
export function parseDesignWorkflowCliArgs(args: string[]): {
  command: DesignWorkflowCliCommand;
  projectId: string;
  flags: DesignWorkflowCliFlags;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg.slice(2) : arg.slice(2, separator);
    if (Object.hasOwn(flags, name)) throw new Error(`Duplicate flag: --${name}`);
    if (name === 'json') {
      if (separator >= 0) throw new Error('--json does not accept a value');
      flags.json = true;
      continue;
    }
    if (!stringFlags.has(name)) throw new Error(`Unknown flag: --${name}`);
    const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
    if (!value?.trim() || (separator < 0 && value.startsWith('-') && value !== '-')) {
      throw new Error(`--${name} requires a value`);
    }
    flags[name] = value;
  }
  const [command, projectId] = positionals;
  if (positionals.length !== 2 || !command || !Object.hasOwn(commands, command) || !projectId?.trim()) {
    throw new Error('Usage: od project work-here <prepare|status|asset|checkpoint|register-artifact|archive> <stable-project-id> --request-file <path|-> [--prompt-file <path|->] [--json]');
  }
  if (!flags['request-file']) throw new Error('--request-file is required');
  if (flags['prompt-file'] && command !== 'prepare') throw new Error('--prompt-file is only supported by prepare');
  if (flags['request-file'] === '-' && flags['prompt-file'] === '-') {
    throw new Error('--request-file and --prompt-file cannot both read stdin');
  }
  if (Boolean(flags.workspace) !== Boolean(flags['workspace-member'])) {
    throw new Error('Pass --workspace and --workspace-member together');
  }
  return { command: command as DesignWorkflowCliCommand, projectId, flags: flags as unknown as DesignWorkflowCliFlags };
}

/** Shared strict schemas validate the complete body before any daemon request. */
export function buildDesignWorkflowCliRequest(input: {
  command: DesignWorkflowCliCommand;
  projectId: string;
  request: unknown;
  prompt?: string;
}): { path: string; init: RequestInit } {
  if (!input.projectId.trim()) throw new Error('An explicit stable project ID is required');
  if (input.prompt !== undefined && input.command !== 'prepare') {
    throw new Error('--prompt-file is only supported by prepare');
  }
  let request = input.request;
  if (input.prompt !== undefined) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('The request file must contain a JSON object');
    }
    request = { ...request, prompt: input.prompt };
  }
  const operation = commands[input.command];
  const body = operation.schema.parse(request);
  if (body.projectId !== input.projectId) {
    throw new Error('The request projectId must exactly match the explicit stable project ID');
  }
  return {
    path: `/api/projects/${encodeURIComponent(input.projectId)}/design-workflow/${operation.endpoint}`,
    init: { method: 'POST', body: JSON.stringify(body) },
  };
}

interface CliDependencies {
  /** Supplied by the existing CLI daemon/workspace discovery boundary. */
  request: (path: string, init: RequestInit, flags: DesignWorkflowCliFlags) => Promise<Response>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readText?: (path: string) => string;
}

export async function runDesignWorkflowCli(args: string[], dependencies: CliDependencies): Promise<number> {
  let request: ReturnType<typeof buildDesignWorkflowCliRequest>;
  let flags: DesignWorkflowCliFlags;
  try {
    const parsed = parseDesignWorkflowCliArgs(args);
    flags = parsed.flags;
    const read = dependencies.readText ?? ((path: string) => readFileSync(path === '-' ? 0 : path, 'utf8'));
    request = buildDesignWorkflowCliRequest({
      ...parsed,
      request: JSON.parse(read(flags['request-file'])),
      ...(flags['prompt-file'] ? { prompt: read(flags['prompt-file']) } : {}),
    });
  } catch (error) {
    dependencies.stderr(`${JSON.stringify({ ok: false, error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) } })}\n`);
    return 2;
  }
  try {
    const response = await dependencies.request(request.path, request.init, flags);
    const data: unknown = await response.json();
    // Preserve daemon conflict/capability errors and binary-asset envelopes.
    (response.ok ? dependencies.stdout : dependencies.stderr)(`${JSON.stringify(data, null, 2)}\n`);
    return response.ok ? 0 : 1;
  } catch (error) {
    dependencies.stderr(`${JSON.stringify({ ok: false, error: { code: 'daemon-request-failed', message: error instanceof Error ? error.message : String(error) } })}\n`);
    return 1;
  }
}
