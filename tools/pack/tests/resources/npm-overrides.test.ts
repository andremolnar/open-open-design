import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readRuntimeNpmOverrides } from '@/resources/npm-overrides.js';
import { sqliteRuntimePath } from '@/resources/sqlite-runtime.js';

describe('assembled runtime policy', () => {
  it('preserves reviewed ranges and omits pnpm-only removal syntax', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-runtime-policy-'));
    try {
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'overrides:\n  global-agent@^3: 4.1.3\n  pptxgenjs>image-size: "-"\n');
      expect(await readRuntimeNpmOverrides(root)).toEqual({ 'global-agent@^3': '4.1.3' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('refuses to silently drop an unsupported override selector', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-runtime-policy-'));
    try {
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'overrides:\n  parent>child: 2.0.0\n');
      await expect(readRuntimeNpmOverrides(root)).rejects.toThrow('Unsupported npm runtime dependency selector');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('selects platform-specific Node-API SQLite binaries', () => {
    expect(sqliteRuntimePath('app', 'darwin', 'arm64')).toBe(join('app', 'node_modules', 'better-sqlite3', 'prebuilds', 'darwin-arm64.node'));
    expect(sqliteRuntimePath('app', 'win32', 'x64')).toBe(join('app', 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node'));
    expect(() => sqliteRuntimePath('app', 'darwin', 'ia32')).toThrow('Unsupported SQLite runtime architecture');
  });
});
