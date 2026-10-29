import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyHttpClient } from '../../src/media/comfyui/client.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('ComfyUI HTTP transport', () => {
  it('allows a small health probe and one encoded node schema, but refuses the full catalogue', async () => {
    const observed: string[] = [];
    const nodeClass = 'Image Resize / Custom (v2)';
    const schemaPath = `/object_info/${encodeURIComponent(nodeClass)}`;
    server = createServer((request, response) => {
      observed.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/system_stats') response.end(JSON.stringify({ system: { os: 'fixture' }, devices: [] }));
      else if (request.url === schemaPath) response.end(JSON.stringify({ [nodeClass]: { input: {}, output: ['IMAGE'] } }));
      else { response.statusCode = 500; response.end('full catalogue must not be requested'); }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture address');
    const client = new ComfyHttpClient({ id: 'test', name: 'test', hasToken: false, trustedNetwork: true,
      baseUrl: `http://127.0.0.1:${address.port}` }, null);
    await expect(client.json('/system_stats')).resolves.toMatchObject({ system: { os: 'fixture' } });
    await expect(client.json(schemaPath)).resolves.toHaveProperty(nodeClass);
    await expect(client.json('/object_info')).rejects.toThrow('Unsupported ComfyUI route');
    for (const path of ['/object_info/../prompt', '/object_info/%2E%2E', '/object_info/SaveImage?all=1']) {
      await expect(client.json(path)).rejects.toThrow('Unsupported ComfyUI route');
    }
    expect(observed).toEqual(['/system_stats', schemaPath]);
  });

  it('uses only allowed server routes and does not follow redirects or disclose error bodies', async () => {
    const observed: string[] = [];
    const auth: Array<string | undefined> = [];
    let redirect = false;
    server = createServer((request, response) => {
      observed.push(request.url ?? ''); auth.push(request.headers.authorization);
      if (redirect) {
        response.writeHead(302, { location: '/forbidden' }); response.end();
      } else {
        response.writeHead(401, { 'Content-Type': 'text/html' });
        response.end('token=should-not-be-displayed private upstream diagnostics');
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture address');
    const client = new ComfyHttpClient({ id: 'test', name: 'test', hasToken: true, trustedNetwork: true,
      baseUrl: `http://127.0.0.1:${address.port}` }, 'fixture-secret');
    await expect(client.json('/system_stats')).rejects.toMatchObject({ message: expect.stringContaining('authentication was rejected') });
    await expect(client.json('/interrupt', {})).rejects.toThrow('Unsupported ComfyUI route');
    await expect(client.image({ filename: '../secrets.png', subfolder: '', type: 'output' })).rejects.toThrow();
    expect(observed).toEqual(['/system_stats']);
    expect(auth).toEqual(['Bearer fixture-secret']);
    await expect(client.json('/prompt', { prompt: {} })).rejects.toMatchObject({ code: 'COMFY_PROMPT_REJECTED' });
    redirect = true;
    await expect(client.json('/object_info/SaveImage')).rejects.toMatchObject({ code: 'COMFY_UNREACHABLE' });
    expect(observed).toEqual(['/system_stats', '/prompt', '/object_info/SaveImage']);
  });

  it('keeps a small health-response limit instead of raising the old JSON cap', async () => {
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ system: { os: 'fixture', extra: 'x'.repeat(64 * 1024) }, devices: [] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No fixture address');
    const client = new ComfyHttpClient({ id: 'test', name: 'test', hasToken: false, trustedNetwork: true,
      baseUrl: `http://127.0.0.1:${address.port}` }, null);
    await expect(client.json('/system_stats')).rejects.toThrow('ComfyUI response exceeds the configured size limit');
  });
});
