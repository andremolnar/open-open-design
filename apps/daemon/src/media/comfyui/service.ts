import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type Database from 'better-sqlite3';
import { parseComfyWorkflowModelId } from '@open-design/contracts';
import type { ComfyWorkflowValidation, ComfyWorkflowDraft, ComfyConnectionSummary } from '@open-design/contracts';
import { ComfyHttpClient, type ComfyClient } from './client.js';
import { ComfyError } from './errors.js';
import { object, validateComfySchema } from './schema.js';
import {
  beginComfyExecution, getComfyConnection, getComfyConnectionToken, listComfyConnections,
  getComfyWorkflowDraft, getComfyWorkflowSummary, setComfyWorkflowValidation, updateComfyExecution,
  getComfyExecution,
} from './store.js';
import { bindComfyInputs } from './workflow.js';

export function comfyClient(db: Database.Database, connectionId: string): ComfyHttpClient {
  const connection = getComfyConnection(db, connectionId);
  if (!connection) throw new ComfyError('Saved ComfyUI server not found');
  return new ComfyHttpClient(connection, getComfyConnectionToken(db, connectionId));
}

/** Select once, without probing other servers or changing the user's preference. */
export function resolveComfyServer(db: Database.Database, workflow: Pick<ComfyWorkflowDraft, 'connectionId'>, override?: unknown): ComfyConnectionSummary {
  if (override !== undefined && (typeof override !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(override))) {
    throw new ComfyError('comfyServerId must be a saved ComfyUI server ID from discovery.');
  }
  const id = typeof override === 'string' ? override : workflow.connectionId;
  if (id) {
    const server = getComfyConnection(db, id);
    if (!server) throw new ComfyError('The selected ComfyUI server was not found. Discover saved servers and choose an existing ID.');
    return server;
  }
  const servers = listComfyConnections(db);
  if (servers.length === 1) return servers[0]!;
  throw new ComfyError(servers.length
    ? 'Several ComfyUI servers are configured. Choose one with comfyServerId (--comfy-server), or save a preferred server for the workflow.'
    : 'No ComfyUI server is configured. Add a server in Settings → Media providers → ComfyUI.');
}

export async function checkComfyWorkflow(
  db: Database.Database, id: string, version: number, client?: ComfyClient, serverId?: unknown,
): Promise<ComfyWorkflowValidation> {
  const draft = getComfyWorkflowDraft(db, id, version);
  if (!draft) throw new ComfyError('Workflow version not found');
  try {
    const server = resolveComfyServer(db, draft, serverId);
    const checked = validateComfySchema(draft, await (client ?? comfyClient(db, server.id)).json('/object_info'));
    setComfyWorkflowValidation(db, id, version, checked.schemaFingerprint);
    return checked;
  } catch (error) {
    setComfyWorkflowValidation(db, id, version, null);
    throw error;
  }
}

/** PNG-only first slice: preserve original bytes, bound dimensions, reject active/non-image payloads. */
export function validateComfyPng(bytes: Buffer): void {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ComfyError('The selected ComfyUI output must be a PNG image');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 64_000_000) throw new ComfyError('ComfyUI image exceeds 64 megapixels');
  if (bytes.length > 40 * 1024 * 1024) throw new ComfyError('ComfyUI image exceeds 40 MiB');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]!];
  const depth = bytes[24]!;
  if (!channels || ![1, 2, 4, 8, 16].includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) {
    throw new ComfyError('Unsupported PNG format; use a standard non-interlaced ComfyUI PNG output');
  }
  const idat: Buffer[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + 12 + length > bytes.length) throw new ComfyError('Truncated ComfyUI PNG output');
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (kind === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!ended || !idat.length) throw new ComfyError('Incomplete ComfyUI PNG output');
  const expectedBytes = (Math.ceil(width * channels * depth / 8) + 1) * height;
  if (expectedBytes > 256 * 1024 * 1024) throw new ComfyError('ComfyUI image exceeds the decoded pixel-data limit');
  try {
    const decoded = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedBytes });
    if (decoded.length !== expectedBytes) throw new Error('Unexpected pixel data length');
  } catch { throw new ComfyError('ComfyUI returned invalid or oversized PNG pixel data'); }
}

export async function renderComfyWorkflow(
  db: Database.Database,
  input: { taskId: string; projectId: string; model: string; prompt: string; workflowInputs?: unknown; comfyServerId?: string; resume?: boolean; onProgress?: (line: string) => void },
  dependencies: { client?: ComfyClient; wait?: () => Promise<void>; maxPolls?: number } = {},
): Promise<{ bytes: Buffer; suggestedExt: string; providerNote: string }> {
  const selected = parseComfyWorkflowModelId(input.model);
  const summary = selected && getComfyWorkflowSummary(db, selected.id, selected.version);
  const draft = selected && getComfyWorkflowDraft(db, selected.id, selected.version);
  if (!selected || !summary || (!summary.enabled && !input.resume) || !draft) throw new ComfyError('This workflow version is unavailable. Save and enable it in Settings.');
  const previous = input.resume ? getComfyExecution(db, input.taskId, input.projectId) : null;
  if (input.resume && (!previous?.promptId || previous.model !== input.model)) {
    throw new ComfyError('This job has no known prompt ID to recover. Inspect the server; a new submission may duplicate remote work.', 'COMFY_OUTCOME_UNKNOWN');
  }
  if (input.resume && input.comfyServerId !== undefined) throw new ComfyError('Recovery uses the original server. Do not supply a new server selection.');
  const server = resolveComfyServer(db, draft, previous?.connectionId ?? input.comfyServerId);
  const patched = input.resume ? null : bindComfyInputs(draft, input.prompt, input.workflowInputs);
  const client = dependencies.client ?? comfyClient(db, server.id);
  if (!input.resume) beginComfyExecution(db, { ...input, connectionId: server.id });
  let submitted = Boolean(input.resume);
  let promptId: string | undefined = previous?.promptId;
  try {
    if (!input.resume) {
      input.onProgress?.(`Validating ${summary.name} on ${server.name}`);
      const schemas = await client.json('/object_info');
      // Request values must satisfy the same live enum/range/link contract as fixed values.
      validateComfySchema({ ...draft, graph: patched! }, schemas);
      updateComfyExecution(db, input.taskId, 'submitting');
      submitted = true;
      // /prompt is not idempotent: exactly one attempt, even after a timeout.
      const accepted = await client.json('/prompt', { prompt: patched, client_id: randomUUID() });
      if (!object(accepted) || typeof accepted.prompt_id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(accepted.prompt_id)) {
        if (object(accepted) && accepted.error) {
          submitted = false;
          throw new ComfyError('ComfyUI rejected the graph. Check required nodes, installed models, and input bindings.');
        }
        throw new ComfyError('ComfyUI submission outcome is unknown. Do not blindly submit again.', 'COMFY_OUTCOME_UNKNOWN');
      }
      promptId = accepted.prompt_id;
    }
    if (!promptId) throw new ComfyError('No known ComfyUI prompt ID', 'COMFY_OUTCOME_UNKNOWN');
    updateComfyExecution(db, input.taskId, 'queued', promptId);
    input.onProgress?.('ComfyUI accepted the workflow; waiting for its image');
    const wait = dependencies.wait ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 1500)));
    const deadline = Date.now() + 15 * 60 * 1000;
    for (let poll = 0; poll < (dependencies.maxPolls ?? 600) && Date.now() < deadline; poll++) {
      let history: unknown;
      try { history = await client.json(`/history/${promptId}`); }
      catch {
        if (poll === 0) input.onProgress?.('ComfyUI connection interrupted; checking recorded history without resubmitting');
        await wait();
        continue;
      }
      const entry = object(history) ? history[promptId] : undefined;
      if (object(entry) && object(entry.status)) {
        if (entry.status.status_str === 'error') {
          submitted = false;
          throw new ComfyError(`Workflow ${summary.name} failed on ${server.name}. Check that server's execution log for missing models, custom-node errors or GPU memory limits.`);
        }
        if (entry.status.completed === true && entry.status.status_str === 'success') {
          // Execution ended: a failed safe download/import must never trigger another GPU submission.
          const outputs = object(entry.outputs) ? entry.outputs : {};
          const output = outputs[draft.output.nodeId];
          const descriptor = object(output) && Array.isArray(output.images) ? output.images[draft.output.index] : undefined;
          if (!object(descriptor) || typeof descriptor.filename !== 'string'
            || typeof descriptor.subfolder !== 'string' || typeof descriptor.type !== 'string') {
            submitted = false;
            throw new ComfyError('The designated ComfyUI output has no image. Choose the final image output node.');
          }
          updateComfyExecution(db, input.taskId, 'fetching');
          input.onProgress?.('Fetching the selected ComfyUI image');
          const bytes = await client.image({ filename: descriptor.filename, subfolder: descriptor.subfolder, type: descriptor.type });
          validateComfyPng(bytes);
          updateComfyExecution(db, input.taskId, 'importing');
          return { bytes, suggestedExt: '.png', providerNote: `ComfyUI · ${summary.name} · v${summary.version}` };
        }
      }
      await wait();
    }
    throw new ComfyError('ComfyUI did not finish before the waiting deadline. The server may still be running; do not blindly submit again.', 'COMFY_OUTCOME_UNKNOWN');
  } catch (error) {
    if (error instanceof ComfyError && error.code === 'COMFY_PROMPT_REJECTED') submitted = false;
    updateComfyExecution(db, input.taskId, submitted ? 'outcome_unknown' : 'failed', promptId);
    if (submitted && !(error instanceof ComfyError && error.code === 'COMFY_OUTCOME_UNKNOWN')) {
      throw new ComfyError('ComfyUI may have accepted or completed this job. Its task and prompt ID were retained; do not blindly submit again.', 'COMFY_OUTCOME_UNKNOWN');
    }
    if (!submitted && error instanceof ComfyError) {
      throw new ComfyError(`${summary.name} on ${server.name}: ${error.message}`, error.code, error.status);
    }
    throw error;
  }
}
