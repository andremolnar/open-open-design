import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyHttpClient } from '../../src/media/comfyui/client.js';

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('ComfyUI HTTP transport', () => {
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
    await expect(client.json('/object_info')).rejects.toMatchObject({ message: expect.stringContaining('authentication was rejected') });
    await expect(client.json('/interrupt', {})).rejects.toThrow('Unsupported ComfyUI route');
    await expect(client.image({ filename: '../secrets.png', subfolder: '', type: 'output' })).rejects.toThrow();
    expect(observed).toEqual(['/object_info']);
    expect(auth).toEqual(['Bearer fixture-secret']);
    await expect(client.json('/prompt', { prompt: {} })).rejects.toMatchObject({ code: 'COMFY_PROMPT_REJECTED' });
    redirect = true;
    await expect(client.json('/object_info')).rejects.toMatchObject({ code: 'COMFY_UNREACHABLE' });
    expect(observed).toEqual(['/object_info', '/prompt', '/object_info']);
  });
});
