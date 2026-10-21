import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const read = (relative: string) => readFile(new URL(relative, root), 'utf8');
const manifest = async (relative: string) => JSON.parse(await read(relative));

describe('workspace dependency security policy', () => {
  it('has one source for overrides and build approvals', async () => {
    const pkg = await manifest('package.json');
    const workspace = await read('pnpm-workspace.yaml');

    expect(pkg.pnpm?.overrides).toBeUndefined();
    expect(pkg.pnpm?.onlyBuiltDependencies).toBeUndefined();
    expect(workspace).toMatch(/^overrides:$/m);
    expect(workspace).toMatch(/^onlyBuiltDependencies:$/m);
  });

  it('excludes retired vulnerable parser and installer chains from the lockfile', async () => {
    const lock = await read('pnpm-lock.yaml');
    const packages = lock.split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0];
    expect(packages).toBeDefined();
    for (const name of ['braces', 'extract-zip', 'sprintf-js', 'roarr', 'image-size']) {
      expect(packages, `${name} must not return through a transitive dependency`).not.toContain(`\n  ${name}@`);
    }
  });

  it('keeps the desktop and packaged Electron runtime on the same reviewed release', async () => {
    const desktop = await manifest('apps/desktop/package.json');
    const packaged = await manifest('apps/packaged/package.json');

    expect(desktop.devDependencies.electron).toBe('45.0.0');
    expect(packaged.devDependencies.electron).toBe(desktop.devDependencies.electron);
  });

  it('keeps both packaging lanes on the reviewed Sharp runtime', async () => {
    const release = await manifest('tools/release/package.json');
    const [mac, win] = await Promise.all([
      read('tools/pack/src/mac/prebundle.ts'),
      read('tools/pack/src/win/prebundle.ts'),
    ]);

    expect(release.dependencies.sharp).toBe('0.35.5');
    for (const source of [mac, win]) {
      expect(source).toContain(`"sharp": "${release.dependencies.sharp}"`);
    }
  });

  it('does not restore the retired native watcher assembly workaround', async () => {
    const source = await read('tools/pack/src/mac/app.ts');
    expect(source).not.toContain('copyMacPrebundleRuntimeDependencies');
    expect(source).not.toContain('chokidar/package.json');
    expect(source).not.toContain('MAC_PREBUNDLE_COPIED_RUNTIME_DEPENDENCIES');
  });
});
