import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { importComfyBytes } from '../../src/media/comfyui/import.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it('atomically publishes a deterministic image, accepts identical recovery and never overwrites conflicts or symlinks', async () => {
  root = await mkdtemp(join(tmpdir(), 'od-comfy-import-'));
  await mkdir(join(root, 'project'));
  const bytes = Buffer.from('image bytes');
  await importComfyBytes(root, 'project', 'result.png', bytes);
  await importComfyBytes(root, 'project', 'result.png', bytes);
  expect(await readFile(join(root, 'project', 'result.png'))).toEqual(bytes);
  await expect(importComfyBytes(root, 'project', 'result.png', Buffer.from('different'))).rejects.toThrow('no file was overwritten');
  await writeFile(join(root, 'private.png'), bytes);
  await symlink(join(root, 'private.png'), join(root, 'project', 'link.png'));
  await expect(importComfyBytes(root, 'project', 'link.png', bytes)).rejects.toThrow('symlink');
  expect(await readdir(join(root, 'project'))).toEqual(['link.png', 'result.png']);
});
