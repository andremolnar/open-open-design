import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

import { listSkills, type SkillInfo } from '../src/skills.js';
import { captureOdNextSessionSkillPackage } from '../src/strategies/od-next/session-skill-package.js';
import { materializeFrozenSkillPackage } from '../src/strategies/od-next/frozen-skill-package.js';

const root = path.resolve(import.meta.dirname, '../../..');
const skillRoot = path.join(root, 'skills/motion-anything');
const commit = 'b016900d9ee92fc2d3e4dc520359cc8999d2ed4e';
const ids = ['like-burst', 'fade-in-up', 'card-lift-hover', 'stagger-list', 'magnetic-button',
  'loading-shimmer', 'attention-pulse', 'scroll-reveal', 'toggle-spring', 'kinetic-headline'];
type SourceFile = { name: string; upstreamPath: string; sha256: string; language: string };
type Recipe = { id: string; license: string; dependencies: string[]; reference: string; files: SourceFile[] };
let catalog: SkillInfo[];
let provenance: { commit: string; recipes: Recipe[] };

beforeAll(async () => {
  catalog = await listSkills([path.join(root, '.tmp/nonexistent-user-skills'), path.join(root, 'skills')]);
  provenance = JSON.parse(await readFile(path.join(skillRoot, 'references/provenance.json'), 'utf8'));
});

async function implementation(recipe: Recipe, file: SourceFile): Promise<string> {
  const reference = await readFile(path.join(skillRoot, recipe.reference), 'utf8');
  const marker = `<!-- source-file: ${file.upstreamPath}; sha256: ${file.sha256} -->\n\`\`\`${file.language}\n`;
  const start = reference.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const from = start + marker.length;
  const end = reference.indexOf('\n```', from);
  expect(end).toBeGreaterThan(from);
  return reference.slice(from, end) + '\n';
}

describe('Motion Anything portable skill integration', () => {
  it('is discoverable once as a localized utility and retains existing companions', async () => {
    const entries = catalog.filter((s) => s.id === 'motion-anything');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'built-in', mode: 'utility', category: 'animation-motion', aggregatesExamples: false });
    expect(entries[0]?.displayName?.['zh-CN']).toBeTruthy();
    expect(entries[0]?.descriptionI18n?.['zh-CN']).toBeTruthy();
    expect(entries[0]?.triggers).toEqual(expect.arrayContaining(['motion', '动效', '动画']));
    for (const id of ['web-clone', 'gsap-core', 'gsap-timeline', 'gsap-scrolltrigger', 'gsap-react',
      'gsap-frameworks', 'gsap-plugins', 'gsap-performance', 'gsap-utils']) {
      expect(catalog.filter((s) => s.id === id)).toHaveLength(1);
    }
    const manifest = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(manifest).toContain(`source-commit: ${commit}`);
    expect(manifest).toContain('mode: utility');
    expect(manifest).toContain('Do not invoke HyperFrames directly');
    expect(manifest).toContain('desktop frame renderer');
    expect(manifest).toContain('window.__timelines.main');
    expect(manifest).not.toMatch(/npx\s+skills\s+add|captureCanvasElement|window\.__maTimeline/);
    expect(await readFile(path.join(skillRoot, 'LICENSE'), 'utf8')).toContain('Apache License');
    expect(await readFile(path.join(skillRoot, 'SOURCES.md'), 'utf8')).toContain('Open Design changes');
  });

  it('freezes and materializes every reference, including licenses and source hashes', async () => {
    const frozen = await captureOdNextSessionSkillPackage({
      metadata: { kind: 'prototype' }, getLocalPluginBySource: undefined,
      selection: { skillIds: ['motion-anything'] }, listSkillCatalog: async () => catalog,
    });
    expect(frozen.selections.map((s) => s.canonicalId)).toEqual(['motion-anything']);
    const files = frozen.selections[0]!.files;
    const expected = (await readdir(path.join(skillRoot, 'references'))).map((p) => `references/${p}`).sort();
    expect(files.map((f) => f.path).sort()).toEqual(expected);
    expect(files).toHaveLength(14);
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'motion-anything-skill-'));
    try {
      const [destination] = await materializeFrozenSkillPackage({ frozen, cwd });
      for (const file of files) {
        expect(await readFile(path.join(cwd, destination!, file.path)))
          .toEqual(await readFile(path.join(skillRoot, file.path)));
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('coexists with Motion Design and GSAP in the existing task-package limits', async () => {
    const selected = ['motion-anything', 'motion-design', 'gsap-core', 'gsap-timeline'];
    const frozen = await captureOdNextSessionSkillPackage({
      metadata: { kind: 'video', intent: 'motion-design', videoModel: 'hyperframes-html' },
      getLocalPluginBySource: undefined, selection: { skillIds: selected }, listSkillCatalog: async () => catalog,
    });
    expect(frozen.selections.map((s) => s.canonicalId)).toEqual(selected);
  });

  it('ships exactly the ten pinned dependency-free recipes with unchanged implementation bytes', async () => {
    expect(provenance.commit).toBe(commit);
    expect(provenance.recipes.map((r) => r.id)).toEqual(ids);
    for (const recipe of provenance.recipes) {
      expect(recipe.license).toBe('Apache-2.0');
      expect(recipe.dependencies).toEqual([]);
      expect(recipe.files.length).toBeGreaterThan(0);
      for (const file of recipe.files) {
        const code = await implementation(recipe, file);
        expect(createHash('sha256').update(code).digest('hex')).toBe(file.sha256);
        expect(file.upstreamPath).toBe(`recipes/web/${recipe.id}/${file.name}`);
        expect(code).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(|https?:\/\/|@import\b/);
        if (file.language === 'javascript') expect(() => new vm.Script(code)).not.toThrow();
        else expect(code).toMatch(/prefers-reduced-motion:\s*reduce/);
      }
    }
  });

  it.each([false, true])('keeps like bursts user-triggered, idempotent and reduced-motion aware (%s)', async (reduced) => {
    const require = createRequire(import.meta.url);
    const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options: object) => { window: any } };
    const dom = new JSDOM('<button data-like-burst aria-pressed="false">Like</button>', { runScripts: 'dangerously' });
    const { window } = dom;
    const cleanup: Array<() => void> = [];
    window.matchMedia = () => ({ matches: reduced });
    window.setTimeout = (fn: () => void) => { cleanup.push(fn); return cleanup.length; };
    try {
      const recipe = provenance.recipes.find((r) => r.id === 'like-burst')!;
      window.eval(await implementation(recipe, recipe.files.find((f) => f.language === 'javascript')!));
      const button = window.document.querySelector('button');
      window.attachLikeBurst(button);
      window.attachLikeBurst(button);
      expect(window.document.querySelectorAll('.lb-particle')).toHaveLength(0);
      button.click();
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(window.document.querySelectorAll('.lb-particle')).toHaveLength(reduced ? 0 : 14);
      cleanup.forEach((fn) => fn());
      expect(window.document.querySelectorAll('.lb-particles')).toHaveLength(0);
      button.click();
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(window.document.querySelectorAll('.lb-particle')).toHaveLength(0);
    } finally {
      window.close();
    }
  });

  it('discloses the retained source examples’ accessible-control and progressive-enhancement gaps', async () => {
    const toggle = await readFile(path.join(skillRoot, 'references/toggle-spring.md'), 'utf8');
    expect(toggle).toContain('type="button"');
    expect(toggle).toContain('accessible name');
    expect(toggle).toContain('initial .on class and aria-pressed state');
    for (const id of ['fade-in-up', 'stagger-list', 'scroll-reveal']) {
      const reference = await readFile(path.join(skillRoot, `references/${id}.md`), 'utf8');
      expect(reference).toContain('progressive enhancement');
      expect(reference).toContain('no-JS');
      expect(reference).toContain('keyboard focus');
    }
  });
});
