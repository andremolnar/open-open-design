import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freezeProjectThumbnailSource } from '../../src/artifacts/project-thumbnail-source.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))); });
async function fixture() {
  const projectsRoot = await mkdtemp(join(tmpdir(), 'od-thumb-source-')); roots.push(projectsRoot);
  const directory = join(projectsRoot, 'project'); await mkdir(directory);
  await writeFile(join(directory, 'index.html'), '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello</h1></body></html>');
  await writeFile(join(directory, 'style.css'), 'h1 { color: red; }');
  return { directory, input: { projectsRoot, projectId: 'project', fileName: 'index.html' } };
}

describe('project thumbnail source identity', () => {
  it('changes for stylesheet-only and dynamically referenced asset edits', async () => {
    const { directory, input } = await fixture();
    const a = await freezeProjectThumbnailSource(input);
    expect((await freezeProjectThumbnailSource(input)).revision).toBe(a.revision);
    await writeFile(join(directory, 'style.css'), 'h1 { color: blue; }');
    const b = await freezeProjectThumbnailSource(input);
    expect(b.revision).not.toBe(a.revision);
    await writeFile(join(directory, 'data.json'), '{"title":"new"}');
    expect((await freezeProjectThumbnailSource(input)).revision).not.toBe(b.revision);
    expect(b.html).toContain('Content-Security-Policy');
    expect(b.html).toContain("connect-src 'none'");
    expect(b.html).toContain('color: blue');
  });

  it('rejects traversal and external symlinks before reading screenshot inputs', async () => {
    const { directory, input } = await fixture();
    await writeFile(join(input.projectsRoot, 'secret.html'), 'private');
    await symlink(join(input.projectsRoot, 'secret.html'), join(directory, 'outside.html'));
    await expect(freezeProjectThumbnailSource({ ...input, fileName: '../secret.html' })).rejects.toThrow();
    await expect(freezeProjectThumbnailSource({ ...input, fileName: 'outside.html' })).rejects.toThrow();
  });
});
