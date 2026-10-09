import { randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readlink, rename, symlink, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Expose the active bundle through a namespace-stable path outside the signed
 * app. Payload updates change the symlink target, not the MCP registration.
 * The CLI and its Node-compatible executable must both come from the selected
 * bundle; an outer app's CLI would miss tools added in newer payloads.
 */
export async function publishPackagedMcpEntry(options: {
  namespaceRoot: string;
  resourceRoot: string;
  cliPath: string;
  nodePath: string;
  platform: NodeJS.Platform;
}): Promise<{ command: string; cliPath: string }> {
  const { namespaceRoot, resourceRoot, cliPath, nodePath, platform } = options;
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new Error(`stable packaged MCP entry is unsupported on ${platform}`);
  }
  const bundle = platform === 'darwin'
    ? dirname(dirname(dirname(resourceRoot)))
    : dirname(dirname(resourceRoot));
  const withinBundle = (entry: string): string => {
    const rel = relative(bundle, entry);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`MCP entry must belong to the selected bundle: ${entry}`);
    }
    return rel;
  };
  const cliRelative = withinBundle(cliPath);
  const nodeRelative = withinBundle(nodePath);
  await Promise.all([access(cliPath), access(nodePath)]);
  const directory = join(namespaceRoot, 'mcp');
  const current = join(directory, 'current');
  await mkdir(directory, { recursive: true });
  let existing: Awaited<ReturnType<typeof lstat>> | null = null;
  try { existing = await lstat(current); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing && !existing.isSymbolicLink()) {
    throw new Error(`refusing to replace non-link MCP entry at ${current}`);
  }
  if (!existing || resolve(directory, await readlink(current)) !== resolve(bundle)) {
    const staging = join(directory, `.current-${randomUUID()}`);
    try {
      await symlink(bundle, staging, platform === 'win32' ? 'junction' : 'dir');
      // POSIX rename replaces the link atomically. Windows junctions cannot be
      // replaced by rename, so remove only the verified link (never a folder).
      if (existing && platform === 'win32') await unlink(current);
      await rename(staging, current);
    } finally {
      await unlink(staging).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
  return { command: join(current, nodeRelative), cliPath: join(current, cliRelative) };
}
