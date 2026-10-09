import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { publishPackagedMcpEntry } from '../src/mcp-entry.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('packaged MCP entry', () => {
  it.skipIf(process.platform === 'win32')('retains the same paths while following the newest bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-mcp-entry-'));
    roots.push(root);
    const namespaceRoot = join(root, 'namespace');
    const makeBundle = async (version: string) => {
      const bundle = join(root, version, 'Open Design.app');
      const cli = join(bundle, 'Contents', 'Resources', 'app', 'prebundled', 'daemon', 'daemon-cli.mjs');
      const node = join(bundle, 'Contents', 'Frameworks', 'Open Design Helper.app', 'Contents', 'MacOS', 'Open Design Helper');
      await mkdir(join(bundle, 'Contents', 'Resources', 'open-design'), { recursive: true });
      await mkdir(join(bundle, 'Contents', 'Frameworks', 'Open Design Helper.app', 'Contents', 'MacOS'), { recursive: true });
      await mkdir(join(bundle, 'Contents', 'Resources', 'app', 'prebundled', 'daemon'), { recursive: true });
      await writeFile(cli, version);
      await writeFile(node, '#!/bin/sh\nexec cat "$1"\n');
      await chmod(node, 0o755);
      return { bundle, cli, node, resourceRoot: join(bundle, 'Contents', 'Resources', 'open-design') };
    };
    const first = await makeBundle('one');
    const second = await makeBundle('two');
    const a = await publishPackagedMcpEntry({ namespaceRoot, cliPath: first.cli, nodePath: first.node, resourceRoot: first.resourceRoot, platform: 'darwin' });
    expect(execFileSync(a.command, [a.cliPath], { encoding: 'utf8' })).toBe('one');
    const b = await publishPackagedMcpEntry({ namespaceRoot, cliPath: second.cli, nodePath: second.node, resourceRoot: second.resourceRoot, platform: 'darwin' });
    expect(b).toEqual(a);
    expect(execFileSync(a.command, [a.cliPath], { encoding: 'utf8' })).toBe('two');
    expect(await readlink(join(namespaceRoot, 'mcp', 'current'))).toBe(second.bundle);
  });

  it.skipIf(process.platform !== 'win32')('publishes a Windows junction without requiring file-symlink privileges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-mcp-entry-'));
    roots.push(root);
    const bundle = join(root, 'installed');
    const resourceRoot = join(bundle, 'resources', 'open-design');
    const cliPath = join(bundle, 'resources', 'cli.mjs');
    const nodePath = join(bundle, 'Open Design.exe');
    await mkdir(resourceRoot, { recursive: true });
    await writeFile(cliPath, 'cli');
    await writeFile(nodePath, 'node');
    const entry = await publishPackagedMcpEntry({ namespaceRoot: join(root, 'namespace'), resourceRoot, cliPath, nodePath, platform: 'win32' });
    expect(await readlink(join(root, 'namespace', 'mcp', 'current'))).toContain('installed');
    expect(entry.command).toContain('current');
    expect(entry.cliPath).toContain('current');
  });

  it('refuses to replace user files or bridge paths outside the selected bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-mcp-entry-'));
    roots.push(root);
    const bundle = join(root, 'app');
    const resourceRoot = join(bundle, 'resources', 'open-design');
    const cliPath = join(bundle, 'resources', 'cli.mjs');
    const nodePath = join(bundle, 'resources', 'node.exe');
    await mkdir(resourceRoot, { recursive: true });
    await writeFile(cliPath, 'cli');
    await writeFile(nodePath, 'node');
    const namespaceRoot = join(root, 'namespace');
    await mkdir(join(namespaceRoot, 'mcp'), { recursive: true });
    await writeFile(join(namespaceRoot, 'mcp', 'current'), 'user file');
    await expect(publishPackagedMcpEntry({ namespaceRoot, cliPath, nodePath, resourceRoot, platform: 'win32' })).rejects.toThrow();
    await rm(join(namespaceRoot, 'mcp', 'current'));
    await expect(publishPackagedMcpEntry({ namespaceRoot, cliPath: join(root, 'elsewhere'), nodePath, resourceRoot, platform: 'win32' })).rejects.toThrow();
  });
});
