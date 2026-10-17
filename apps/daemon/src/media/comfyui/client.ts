import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch } from 'undici';
import type { ComfyConnectionSummary } from '@open-design/contracts';
import { isBlockedExternalApiHostname, isLoopbackApiHost } from '@open-design/contracts/api/connectionTest';
import { validateComfyConnection } from './store.js';
import { ComfyError } from './errors.js';

const forbidden = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  forbidden.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['fe80::', 10], ['ff00::', 8]] as const) {
  forbidden.addSubnet(network, prefix, 'ipv6');
}

export function assertComfyAddress(address: string, trusted: boolean): void {
  const family = isIP(address);
  if (!family || address.toLowerCase().startsWith('::ffff:') || forbidden.check(address, family === 6 ? 'ipv6' : 'ipv4')
    || (!trusted && (isLoopbackApiHost(address) || isBlockedExternalApiHostname(address)))) {
    throw new ComfyError('ComfyUI destination is not permitted by this connection network policy', 'COMFY_NETWORK_BLOCKED');
  }
}

export interface ComfyClient {
  json(path: string, body?: unknown): Promise<unknown>;
  image(descriptor: { filename: string; subfolder: string; type: string }): Promise<Buffer>;
}

function allowedPath(path: string, post: boolean): boolean {
  return post ? path === '/prompt' : path === '/object_info' || /^\/history\/[a-zA-Z0-9-]{1,100}$/.test(path);
}

/** Same-origin, direct, DNS-pinned transport: the user's saved server is the only destination. */
export class ComfyHttpClient implements ComfyClient {
  constructor(private readonly connection: ComfyConnectionSummary, private readonly token: string | null) {}

  private async request(path: string, body: unknown, limit: number): Promise<Buffer> {
    validateComfyConnection(this.connection);
    const url = new URL(this.connection.baseUrl);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true });
    } catch {
      throw new ComfyError('Cannot resolve the saved ComfyUI server', 'COMFY_UNREACHABLE', 502);
    }
    if (!addresses.length) throw new ComfyError('Cannot resolve the saved ComfyUI server', 'COMFY_UNREACHABLE', 502);
    for (const entry of addresses) assertComfyAddress(entry.address, this.connection.trustedNetwork);
    const pinned = addresses[0]!;
    const dispatcher = new Agent({ connect: {
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
    } });
    try {
      const response = await fetch(`${url.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        dispatcher,
        redirect: 'error',
        signal: AbortSignal.timeout(path.startsWith('/view?') ? 60_000 : 10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ComfyError(response.status === 401 || response.status === 403
          ? 'ComfyUI authentication was rejected. Check the saved server token.'
          : `ComfyUI request rejected (HTTP ${response.status}). Check the server and workflow.`,
        path === '/prompt' && [400, 401, 403, 422].includes(response.status) ? 'COMFY_PROMPT_REJECTED' : 'COMFY_HTTP_ERROR', response.status);
      }
      const chunks: Buffer[] = [];
      let length = 0;
      if (!response.body) throw new ComfyError('ComfyUI returned an empty response');
      const reader = response.body.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > limit) {
            await reader.cancel();
            throw new ComfyError('ComfyUI response exceeds the configured size limit');
          }
          chunks.push(Buffer.from(next.value));
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof ComfyError) throw error;
      // Never echo proxy bodies, private prompts, URLs or authorization headers.
      throw new ComfyError('Cannot reach ComfyUI, or the request timed out. Check the saved server.', 'COMFY_UNREACHABLE', 502);
    } finally { await dispatcher.close(); }
  }

  async json(path: string, body?: unknown): Promise<unknown> {
    if (!allowedPath(path, body !== undefined)) throw new ComfyError('Unsupported ComfyUI route');
    const bytes = await this.request(path, body, 8 * 1024 * 1024);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch { throw new ComfyError('ComfyUI did not return API JSON. Check the server origin and proxy.', 'COMFY_INVALID_RESPONSE', 502); }
  }

  async image(descriptor: { filename: string; subfolder: string; type: string }): Promise<Buffer> {
    for (const value of [descriptor.filename, descriptor.subfolder]) {
      if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/')
        || value.split('/').some((part) => part === '..' || part === '.') || /[\x00-\x1f]/.test(value)) {
        throw new ComfyError('ComfyUI returned an unsafe image descriptor');
      }
    }
    if (!descriptor.filename || descriptor.filename.includes('/') || !['output', 'temp'].includes(descriptor.type)) {
      throw new ComfyError('ComfyUI returned an unsupported image descriptor');
    }
    return this.request(`/view?${new URLSearchParams(descriptor)}`, undefined, 40 * 1024 * 1024);
  }
}
