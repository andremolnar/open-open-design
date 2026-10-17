import { randomUUID } from 'node:crypto';
import { link, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ComfyError } from './errors.js';

/** Publish a complete file atomically without replacing a conflicting file or following a symlink. */
export async function importComfyBytes(projectsRoot: string, projectId: string, name: string, bytes: Buffer): Promise<void> {
  const project = path.join(projectsRoot, projectId);
  const resolved = await realpath(project);
  if (resolved !== path.join(await realpath(projectsRoot), projectId) || path.basename(name) !== name) {
    throw new ComfyError('ComfyUI project destination must be a contained file, not a symlink');
  }
  const target = path.join(resolved, name);
  const staging = path.join(resolved, `.comfy-${randomUUID()}.tmp`);
  try {
    await writeFile(staging, bytes, { flag: 'wx' });
    try { await link(staging, target); }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      if (await realpath(target) !== target || !(await readFile(target)).equals(bytes)) {
        throw new ComfyError('ComfyUI import path contains different bytes or a symlink; no file was overwritten');
      }
    }
  } finally { await rm(staging, { force: true }); }
}
