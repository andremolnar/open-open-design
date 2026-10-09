import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveDesignSystemAssetPackage, resolveDesignSystemAssets, clearDesignSystemAssetsCacheForTests } from '../../src/design-systems/index.js';
import { captureResources } from '../../src/services/design-workflow/resources.js';

const roots: string[] = [];
afterEach(async () => { clearDesignSystemAssetsCacheForTests(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

it('captures exact canonical fallback sidefiles rather than guessing from the brand summary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-work-here-brand-')); roots.push(root);
  const builtIn = path.join(root, 'built-in'); const installed = path.join(root, 'installed');
  await mkdir(path.join(builtIn, 'sample'), { recursive: true });
  await mkdir(path.join(installed, 'sample/assets'), { recursive: true });
  await writeFile(path.join(builtIn, 'sample/DESIGN.md'), '# Built-in brand');
  await writeFile(path.join(installed, 'sample/USAGE.md'), 'Use assets/logo.svg and tokens.css.');
  await writeFile(path.join(installed, 'sample/tokens.css'), ':root { --brand-ink: #ab124f; }');
  await writeFile(path.join(installed, 'sample/components.html'), '<button>Real fallback component</button>');
  const logo = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>';
  await writeFile(path.join(installed, 'sample/assets/logo.svg'), logo);
  const resolved = await resolveDesignSystemAssetPackage('sample', builtIn, installed, {});
  expect(resolved.assets.usageMd).toContain('assets/logo.svg');
  expect(resolved.resourceRoots).toEqual([path.join(builtIn, 'sample'), path.join(installed, 'sample')]);
  expect(await resolveDesignSystemAssets('sample', builtIn, installed, {})).toEqual(resolved.assets);
  const frozen = captureResources(resolved.resourceRoots.map((directory, index) => ({
    root: directory, prefix: `design-system/${index}`, role: 'design_system', provenance: `sample:${index}`,
  })));
  const resource = frozen.resources.find((entry) => entry.manifest.name.endsWith('/assets/logo.svg'))!;
  expect(Buffer.from(resource.base64, 'base64').toString('utf8')).toBe(logo);
  expect(resource.manifest.provenance).toBe('sample:1');
});

it('does not expose unrelated installed fallback when built-in assets already satisfy resolution', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-work-here-brand-')); roots.push(root);
  const builtIn = path.join(root, 'built-in'); const installed = path.join(root, 'installed');
  await mkdir(path.join(builtIn, 'sample'), { recursive: true });
  await mkdir(path.join(installed, 'sample'), { recursive: true });
  await writeFile(path.join(builtIn, 'sample/tokens.css'), ':root { --brand-ink: #ab124f; }');
  await writeFile(path.join(builtIn, 'sample/components.html'), '<button>Built in</button>');
  await writeFile(path.join(installed, 'sample/USAGE.md'), 'Unselected fallback');
  const resolved = await resolveDesignSystemAssetPackage('sample', builtIn, installed, {});
  expect(resolved.resourceRoots).toEqual([path.join(builtIn, 'sample')]);
  expect(resolved.assets.usageMd).toBeUndefined();
});


it('keeps selected original resources when prompt token injection is disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'od-work-here-brand-')); roots.push(root);
  const builtIn = path.join(root, 'built-in'); const installed = path.join(root, 'installed');
  await mkdir(path.join(builtIn, 'sample/assets'), { recursive: true });
  await writeFile(path.join(builtIn, 'sample/DESIGN.md'), '# Brand with original image');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK9sAAAAASUVORK5CYII=', 'base64');
  await writeFile(path.join(builtIn, 'sample/assets/reference.png'), png);
  await writeFile(path.join(builtIn, 'sample/tokens.css'), ':root { --ink: #abc; }');
  const env = { OD_DESIGN_TOKEN_CHANNEL: '0' };
  const resolved = await resolveDesignSystemAssetPackage('sample', builtIn, installed, env);
  expect(resolved.assets.tokensCss).toBeUndefined();
  expect(await resolveDesignSystemAssets('sample', builtIn, installed, env)).toEqual(resolved.assets);
  expect(resolved.resourceRoots).toEqual([path.join(builtIn, 'sample')]);
  const frozen = captureResources(resolved.resourceRoots.map((directory) => ({
    root: directory, prefix: 'design-system/0', role: 'design_system', provenance: 'sample',
  })));
  expect(frozen.resources.some((entry) => entry.manifest.name.endsWith('/DESIGN.md'))).toBe(true);
  const resource = frozen.resources.find((entry) => entry.manifest.name.endsWith('/reference.png'))!;
  expect(resource.manifest.mimeType).toBe('image/png');
  expect(Buffer.from(resource.base64, 'base64')).toEqual(png);
});
