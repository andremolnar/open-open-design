import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runComfyCli } from '../../src/media/comfyui/cli.js';

let dir: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('od media comfyui shared API', () => {
  it('discovers only public capabilities through the shared media catalog instead of operator settings', async () => {
    const fetchMock = vi.fn(async () => Response.json({ comfyui: { servers: [{ id: 'gpu', name: 'Studio' }], workflows: [] },
      ignored: 'not-part-of-discovery' }));
    vi.stubGlobal('fetch', fetchMock);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runComfyCli(['discover', '--json'], async () => 'http://127.0.0.1:7456');
    expect(fetchMock.mock.calls[0]).toEqual(['http://127.0.0.1:7456/api/media/models']);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({ servers: [{ id: 'gpu', name: 'Studio' }], workflows: [] });
  });
  it('sends token-file credentials only to the server API and supports validate/enable JSON operations', async () => {
    dir = await mkdtemp(join(tmpdir(), 'od-comfy-cli-'));
    const configFile = join(dir, 'server.json');
    const tokenFile = join(dir, 'token');
    await writeFile(configFile, JSON.stringify({ name: 'GPU', baseUrl: 'http://127.0.0.1:8188', trustedNetwork: true }));
    await writeFile(tokenFile, 'fixture-secret\n');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ id: 'saved', hasToken: true }));
    vi.stubGlobal('fetch', fetchMock);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = async () => 'http://127.0.0.1:7456';
    await runComfyCli(['server-add', '--file', configFile, '--token-file', tokenFile, '--json'], base);
    expect(fetchMock.mock.calls[0]).toMatchObject([
      'http://127.0.0.1:7456/api/media/comfyui/connections', { method: 'POST', body: expect.stringContaining('fixture-secret') },
    ]);
    expect(stdout.mock.calls.flat().join('')).not.toContain('fixture-secret');
    await runComfyCli(['validate', '--workflow', 'workflow', '--version', '1', '--json'], base);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('http://127.0.0.1:7456/api/media/comfyui/workflows/workflow/1/validate');
    await runComfyCli(['enable', '--workflow', 'workflow', '--version', '1', '--json'], base);
    expect(fetchMock.mock.calls.at(-1)).toMatchObject([
      'http://127.0.0.1:7456/api/media/comfyui/workflows/workflow/1/enabled', { body: '{"enabled":true}' },
    ]);
    await runComfyCli(['workflow-show', '--workflow', 'workflow', '--version', '1', '--json'], base);
    expect(fetchMock.mock.calls.at(-1)).toMatchObject([
      'http://127.0.0.1:7456/api/media/comfyui/workflows/workflow/1', { method: 'GET' },
    ]);
  });
});
